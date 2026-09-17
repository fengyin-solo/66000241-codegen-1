package com.opcua.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.opcua.config.CollectionLimits;
import com.opcua.exception.ValidationException;
import com.opcua.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * 节点采集方案服务
 * - 方案保存前按节点逐项校验采样周期/发布周期/队列上限，任一不合法整单拒绝
 * - 启用时逐节点反馈结果，连接异常的节点列入 pending（待生效），恢复后自动补发
 * - 方案持久化到本地文件，服务重启（前端刷新后重新拉取）仍然保留
 * - 采集方案与单点订阅共用 OpcuaClientService 的同一份订阅参数
 */
@Service
public class CollectionSchemeService {

    private static final Logger log = LoggerFactory.getLogger(CollectionSchemeService.class);

    private final OpcuaClientService opcuaClientService;
    private final ObjectMapper objectMapper;
    private final ReentrantLock lock = new ReentrantLock();

    private final Map<String, CollectionScheme> schemes = new ConcurrentHashMap<>();
    /** 单点订阅的参数快照，停用方案后恢复，保证单点订阅入口行为不变 */
    private final Map<String, CollectionNodeConfig> manualSubscriptions = new ConcurrentHashMap<>();
    /** 启用时连接异常、待连接恢复后生效的节点 */
    private final Set<String> pendingNodes = ConcurrentHashMap.newKeySet();
    private volatile String activeSchemeId;

    @Value("${opcua.collection.storage-file:data/collection-schemes.json}")
    private String storageFile;

    public CollectionSchemeService(OpcuaClientService opcuaClientService, ObjectMapper objectMapper) {
        this.opcuaClientService = opcuaClientService;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        load();
        reapplyActiveScheme();
    }

    // ---- 查询 ----

    public List<CollectionScheme> listSchemes() {
        List<CollectionScheme> list = new ArrayList<>(schemes.values());
        list.sort(Comparator.comparingLong(CollectionScheme::getUpdatedAt).reversed());
        return list;
    }

    public CollectionScheme getScheme(String id) {
        CollectionScheme scheme = schemes.get(id);
        if (scheme == null) {
            throw new IllegalArgumentException("采集方案不存在: " + id);
        }
        return scheme;
    }

    public String getActiveSchemeId() {
        return activeSchemeId;
    }

    // ---- 保存（整单校验） ----

    public CollectionScheme createScheme(CollectionScheme scheme) {
        lock.lock();
        try {
            validate(scheme);
            long now = System.currentTimeMillis();
            scheme.setId("scheme_" + now + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8));
            scheme.setActive(false);
            scheme.setCreatedAt(now);
            scheme.setUpdatedAt(now);
            schemes.put(scheme.getId(), scheme);
            persist();
            log.info("采集方案已保存: {} ({})，覆盖 {} 个节点", scheme.getName(), scheme.getId(), scheme.getNodes().size());
            return scheme;
        } finally {
            lock.unlock();
        }
    }

    public CollectionScheme updateScheme(String id, CollectionScheme updated) {
        lock.lock();
        try {
            CollectionScheme existing = getScheme(id);
            validate(updated);
            existing.setName(updated.getName());
            existing.setDescription(updated.getDescription());
            existing.setNodes(new ArrayList<>(updated.getNodes()));
            existing.setUpdatedAt(System.currentTimeMillis());
            // 已生效的方案保存后立即按新参数重新应用
            if (Objects.equals(activeSchemeId, id)) {
                applyActiveScheme(existing);
            }
            persist();
            return existing;
        } finally {
            lock.unlock();
        }
    }

    public void deleteScheme(String id) {
        lock.lock();
        try {
            CollectionScheme existing = getScheme(id);
            if (Objects.equals(activeSchemeId, id)) {
                deactivateScheme(id);
            }
            schemes.remove(id);
            pendingNodes.removeIf(nodeId -> belongsToScheme(nodeId, existing));
            persist();
            log.info("采集方案已删除: {} ({})", existing.getName(), id);
        } finally {
            lock.unlock();
        }
    }

    // ---- 启用 / 停用（逐节点反馈） ----

    public SchemeActivationResult activateScheme(String id) {
        lock.lock();
        try {
            CollectionScheme target = getScheme(id);
            if (activeSchemeId != null && !Objects.equals(activeSchemeId, id)) {
                deactivateScheme(activeSchemeId);
            }
            SchemeActivationResult result = applyActiveScheme(target);
            target.setActive(true);
            activeSchemeId = id;
            target.setUpdatedAt(System.currentTimeMillis());
            persist();
            return result;
        } finally {
            lock.unlock();
        }
    }

    public void deactivateScheme(String id) {
        lock.lock();
        try {
            CollectionScheme scheme = getScheme(id);
            if (!Objects.equals(activeSchemeId, id)) {
                scheme.setActive(false);
                persist();
                return;
            }
            // 恢复为启用前的单点订阅参数；原本没有单点订阅的节点取消订阅
            for (CollectionNodeConfig node : scheme.getNodes()) {
                CollectionNodeConfig manual = manualSubscriptions.get(node.getNodeId());
                if (manual != null) {
                    opcuaClientService.applySubscription(manual);
                } else {
                    opcuaClientService.unsubscribe(node.getNodeId());
                }
                pendingNodes.remove(node.getNodeId());
            }
            scheme.setActive(false);
            activeSchemeId = null;
            persist();
            log.info("采集方案已停用: {} ({})", scheme.getName(), id);
        } finally {
            lock.unlock();
        }
    }

    /**
     * 对待生效节点重试一次（例如手动重连后）
     */
    public SchemeActivationResult retryPending() {
        lock.lock();
        try {
            CollectionScheme scheme = activeSchemeId == null ? null : schemes.get(activeSchemeId);
            SchemeActivationResult result = new SchemeActivationResult();
            if (scheme != null) {
                result = applyActiveScheme(scheme);
                persist();
            }
            return result;
        } finally {
            lock.unlock();
        }
    }

    /**
     * 逐节点应用方案，返回每个节点的成功/待生效结果
     */
    private SchemeActivationResult applyActiveScheme(CollectionScheme scheme) {
        SchemeActivationResult result = new SchemeActivationResult();
        result.setSchemeId(scheme.getId());
        result.setSchemeName(scheme.getName());
        result.setActive(true);

        for (CollectionNodeConfig nodeConfig : scheme.getNodes()) {
            String nodeId = nodeConfig.getNodeId();
            String nodeName = opcuaClientService.getNodeName(nodeId);
            if (!opcuaClientService.isNodeReachable(nodeId)) {
                pendingNodes.add(nodeId);
                result.getResults().add(new SchemeNodeResult(nodeId, nodeName, "pending",
                        "节点连接异常，配置将在连接恢复后自动生效"));
                continue;
            }
            opcuaClientService.applySubscription(nodeConfig);
            pendingNodes.remove(nodeId);
            result.getResults().add(new SchemeNodeResult(nodeId, nodeName, "success",
                    String.format("已生效：采样 %dms / 发布 %dms / 队列上限 %d",
                            nodeConfig.getSamplingInterval(),
                            nodeConfig.getPublishingInterval(),
                            nodeConfig.getQueueSize())));
        }
        return result;
    }

    /**
     * 节点连接恢复事件：自动补发待生效配置
     */
    @EventListener
    public void onNodeReachability(OpcuaClientService.NodeReachabilityEvent event) {
        if (!event.reachable() || !pendingNodes.contains(event.nodeId())) {
            return;
        }
        lock.lock();
        try {
            CollectionScheme scheme = activeSchemeId == null ? null : schemes.get(activeSchemeId);
            CollectionNodeConfig config = scheme == null ? null : findNodeConfig(scheme, event.nodeId());
            if (config != null) {
                opcuaClientService.applySubscription(config);
                pendingNodes.remove(event.nodeId());
                persist();
                log.info("节点 {} 连接恢复，采集方案 {} 的配置已自动补发生效", event.nodeId(), scheme.getName());
            }
        } finally {
            lock.unlock();
        }
    }

    // ---- 单点订阅（与方案共用同一份参数） ----

    public void manualSubscribe(CollectionNodeConfig config) {
        lock.lock();
        try {
            List<ValidationError> errors = validateNodeConfig(config);
            if (!errors.isEmpty()) {
                throw new ValidationException(errors);
            }
            manualSubscriptions.put(config.getNodeId(), config);
            // 若该节点当前由生效方案覆盖，方案参数优先；否则立即采用单点订阅参数
            if (!isCoveredByActiveScheme(config.getNodeId())) {
                opcuaClientService.applySubscription(config);
            }
            persist();
        } finally {
            lock.unlock();
        }
    }

    public void manualUnsubscribe(String nodeId) {
        lock.lock();
        try {
            manualSubscriptions.remove(nodeId);
            if (!isCoveredByActiveScheme(nodeId)) {
                opcuaClientService.unsubscribe(nodeId);
            }
            persist();
        } finally {
            lock.unlock();
        }
    }

    // ---- 生效参数视图 ----

    public EffectiveSubscription getEffectiveSubscription(String nodeId) {
        CollectionScheme scheme = activeSchemeId == null ? null : schemes.get(activeSchemeId);
        CollectionNodeConfig activeConfig = null;
        if (scheme != null) {
            activeConfig = findNodeConfig(scheme, nodeId);
        }
        CollectionNodeConfig current = opcuaClientService.getSubscriptionParams(nodeId);

        EffectiveSubscription view = new EffectiveSubscription();
        view.setNodeId(nodeId);
        view.setSubscribed(opcuaClientService.getAllSubscriptionParams().containsKey(nodeId));
        if (activeConfig != null) {
            view.setSource("scheme");
            view.setSourceSchemeId(scheme.getId());
            view.setSourceSchemeName(scheme.getName());
            view.setSamplingInterval(activeConfig.getSamplingInterval());
            view.setPublishingInterval(activeConfig.getPublishingInterval());
            view.setQueueSize(activeConfig.getQueueSize());
            view.setPending(pendingNodes.contains(nodeId));
        } else {
            CollectionNodeConfig manual = manualSubscriptions.get(nodeId);
            if (manual != null) {
                view.setSource("manual");
                view.setSamplingInterval(manual.getSamplingInterval());
                view.setPublishingInterval(manual.getPublishingInterval());
                view.setQueueSize(manual.getQueueSize());
            } else if (current != null) {
                view.setSource("manual");
                view.setSamplingInterval(current.getSamplingInterval());
                view.setPublishingInterval(current.getPublishingInterval());
                view.setQueueSize(current.getQueueSize());
            }
        }
        return view;
    }

    private boolean isCoveredByActiveScheme(String nodeId) {
        CollectionScheme scheme = activeSchemeId == null ? null : schemes.get(activeSchemeId);
        return scheme != null && findNodeConfig(scheme, nodeId) != null;
    }

    private boolean belongsToScheme(String nodeId, CollectionScheme scheme) {
        return findNodeConfig(scheme, nodeId) != null;
    }

    private CollectionNodeConfig findNodeConfig(CollectionScheme scheme, String nodeId) {
        for (CollectionNodeConfig config : scheme.getNodes()) {
            if (Objects.equals(config.getNodeId(), nodeId)) {
                return config;
            }
        }
        return null;
    }

    // ---- 校验 ----

    /**
     * 整份配置校验：方案名、节点重复、节点存在性、各字段取值范围
     * 任一不合法都抛出包含全部错误的异常，整单不保存
     */
    private void validate(CollectionScheme scheme) {
        List<ValidationError> errors = new ArrayList<>();
        if (scheme.getName() == null || scheme.getName().isBlank()) {
            errors.add(new ValidationError(null, null, "name", "方案名称不能为空"));
        }
        if (scheme.getNodes() == null || scheme.getNodes().isEmpty()) {
            errors.add(new ValidationError(null, null, "nodes", "方案至少需要覆盖一个节点"));
        } else {
            Set<String> seen = new HashSet<>();
            for (CollectionNodeConfig node : scheme.getNodes()) {
                String nodeId = node == null ? null : node.getNodeId();
                if (nodeId == null || nodeId.isBlank()) {
                    errors.add(new ValidationError(null, null, "nodeId", "存在未选择节点的配置项"));
                    continue;
                }
                if (!seen.add(nodeId)) {
                    errors.add(new ValidationError(nodeId, opcuaClientService.getNodeName(nodeId),
                            "nodeId", "同一节点在方案中重复出现"));
                    continue;
                }
                if (!opcuaClientService.nodeExists(nodeId)) {
                    errors.add(new ValidationError(nodeId, null, "nodeId", "节点不存在"));
                    continue;
                }
                errors.addAll(validateNodeConfig(node));
            }
        }
        if (!errors.isEmpty()) {
            throw new ValidationException(errors);
        }
    }

    /**
     * 单项节点参数校验，错误中明确节点与越界字段
     */
    private List<ValidationError> validateNodeConfig(CollectionNodeConfig node) {
        List<ValidationError> errors = new ArrayList<>();
        String nodeId = node.getNodeId();
        String nodeName = opcuaClientService.getNodeName(nodeId);

        if (node.getSamplingInterval() < CollectionLimits.MIN_SAMPLING_INTERVAL
                || node.getSamplingInterval() > CollectionLimits.MAX_SAMPLING_INTERVAL) {
            errors.add(new ValidationError(nodeId, nodeName, "samplingInterval",
                    "节点 [" + display(nodeId, nodeName) + "] 的采样周期 "
                            + node.getSamplingInterval() + "ms 超出允许范围 "
                            + CollectionLimits.MIN_SAMPLING_INTERVAL + "~"
                            + CollectionLimits.MAX_SAMPLING_INTERVAL + "ms"));
        }
        if (node.getPublishingInterval() < CollectionLimits.MIN_PUBLISHING_INTERVAL
                || node.getPublishingInterval() > CollectionLimits.MAX_PUBLISHING_INTERVAL) {
            errors.add(new ValidationError(nodeId, nodeName, "publishingInterval",
                    "节点 [" + display(nodeId, nodeName) + "] 的发布周期 "
                            + node.getPublishingInterval() + "ms 超出允许范围 "
                            + CollectionLimits.MIN_PUBLISHING_INTERVAL + "~"
                            + CollectionLimits.MAX_PUBLISHING_INTERVAL + "ms"));
        }
        if (node.getQueueSize() < CollectionLimits.MIN_QUEUE_SIZE
                || node.getQueueSize() > CollectionLimits.MAX_QUEUE_SIZE) {
            errors.add(new ValidationError(nodeId, nodeName, "queueSize",
                    "节点 [" + display(nodeId, nodeName) + "] 的队列上限 "
                            + node.getQueueSize() + " 超过系统允许的上限 "
                            + CollectionLimits.MAX_QUEUE_SIZE));
        }
        return errors;
    }

    private String display(String nodeId, String nodeName) {
        return nodeName != null ? nodeName + "（" + nodeId + "）" : nodeId;
    }

    // ---- 持久化（刷新/重启后保留） ----

    private void persist() {
        try {
            File file = new File(storageFile);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                log.warn("无法创建持久化目录: {}", parent);
            }
            PersistedState state = new PersistedState(
                    new ArrayList<>(schemes.values()),
                    new HashMap<>(manualSubscriptions),
                    new ArrayList<>(pendingNodes),
                    activeSchemeId);
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(file, state);
        } catch (IOException e) {
            log.error("采集方案持久化失败", e);
        }
    }

    private void load() {
        try {
            File file = new File(storageFile);
            if (!file.exists()) {
                return;
            }
            PersistedState state = objectMapper.readValue(file, PersistedState.class);
            if (state.schemes != null) {
                for (CollectionScheme scheme : state.schemes) {
                    scheme.setActive(Objects.equals(scheme.getId(), state.activeSchemeId));
                    schemes.put(scheme.getId(), scheme);
                }
            }
            if (state.manualSubscriptions != null) {
                manualSubscriptions.putAll(state.manualSubscriptions);
            }
            if (state.pendingNodes != null) {
                pendingNodes.addAll(state.pendingNodes);
            }
            activeSchemeId = state.activeSchemeId;
            log.info("已加载 {} 份采集方案，当前生效方案: {}", schemes.size(), activeSchemeId);
        } catch (IOException e) {
            log.error("采集方案加载失败，将以空配置启动", e);
        }
    }

    /**
     * 重启后重新应用生效方案：可达节点立即生效，仍异常的节点继续保留为待生效
     */
    private void reapplyActiveScheme() {
        if (activeSchemeId == null) {
            return;
        }
        CollectionScheme scheme = schemes.get(activeSchemeId);
        if (scheme != null) {
            scheme.setActive(true);
            applyActiveScheme(scheme);
            // 单点订阅参数中未被方案覆盖的节点也一并恢复
            for (CollectionNodeConfig manual : manualSubscriptions.values()) {
                if (!isCoveredByActiveScheme(manual.getNodeId())
                        && opcuaClientService.isNodeReachable(manual.getNodeId())) {
                    opcuaClientService.applySubscription(manual);
                }
            }
        } else {
            activeSchemeId = null;
        }
    }

    /**
     * 持久化文件结构
     */
    private record PersistedState(
            List<CollectionScheme> schemes,
            Map<String, CollectionNodeConfig> manualSubscriptions,
            List<String> pendingNodes,
            String activeSchemeId) {
    }
}
