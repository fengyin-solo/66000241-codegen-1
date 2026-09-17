package com.opcua.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.opcua.model.ApplyNodeResult;
import com.opcua.model.ApplyResult;
import com.opcua.model.CollectionPlan;
import com.opcua.model.PlanNodeConfig;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 节点采集方案服务
 * <p>
 * - 用户可为若干节点分别设定采样周期、发布周期与队列上限，保存成可复用方案；
 * - 任一项不满足取值范围时整份配置不允许保存，并精确定位到哪个节点的哪一项；
 * - 方案持久化到本地 JSON，刷新/重启后仍然保留；
 * - 启用时按节点逐条反馈，连接异常的节点单独列为待生效。
 */
@Service
public class CollectionPlanService {

    private static final Logger log = LoggerFactory.getLogger(CollectionPlanService.class);

    // 采样周期 / 发布周期取值范围（ms）
    public static final int MIN_SAMPLING_INTERVAL = 50;
    public static final int MAX_SAMPLING_INTERVAL = 60000;
    public static final int MIN_PUBLISHING_INTERVAL = 100;
    public static final int MAX_PUBLISHING_INTERVAL = 300000;
    // 队列上限取值范围，上限即系统允许的最大队列
    public static final int MIN_QUEUE_SIZE = 1;
    public static final int MAX_QUEUE_SIZE = 100;

    private final OpcuaClientService clientService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, CollectionPlan> plans = new LinkedHashMap<>();
    private final File storeFile = new File("data/collection-plans.json");

    public CollectionPlanService(OpcuaClientService clientService) {
        this.clientService = clientService;
    }

    @PostConstruct
    public void init() {
        load();
        // 重启后按保留的方案重新建立订阅，连接异常的节点自动为待生效
        plans.values().stream().filter(CollectionPlan::isEnabled).forEach(this::applyPlanToSubscriptions);
    }

    public synchronized List<CollectionPlan> listPlans() {
        return new ArrayList<>(plans.values());
    }

    public synchronized Optional<CollectionPlan> getPlan(String id) {
        return Optional.ofNullable(plans.get(id));
    }

    /**
     * 保存（新增或更新）方案。校验不通过时整份配置不保存。
     *
     * @return 字段级错误列表；为空表示保存成功
     */
    public synchronized List<String> savePlan(String id, String name, String description, List<PlanNodeConfig> configs) {
        List<String> errors = validate(name, configs);
        if (!errors.isEmpty()) {
            return errors;
        }

        long now = System.currentTimeMillis();
        CollectionPlan plan;
        if (id != null && plans.containsKey(id)) {
            plan = plans.get(id);
            // 已启用方案：先撤销被移除节点上由本方案写入的订阅
            if (plan.isEnabled()) {
                Set<String> newNodeIds = new HashSet<>();
                configs.forEach(c -> newNodeIds.add(c.getNodeId()));
                clientService.getSubscriptionsByPlan(plan.getId()).forEach(record -> {
                    if (!newNodeIds.contains(record.getNodeId())) {
                        clientService.unsubscribe(record.getNodeId());
                    }
                });
            }
            plan.setName(name.trim());
            plan.setDescription(description == null ? "" : description.trim());
            plan.setConfigs(copyConfigs(configs));
            plan.setUpdatedAt(now);
            if (plan.isEnabled()) {
                applyPlanToSubscriptions(plan);
            }
        } else {
            plan = new CollectionPlan();
            plan.setId("plan_" + now + "_" + (int) (Math.random() * 1_000_000));
            plan.setName(name.trim());
            plan.setDescription(description == null ? "" : description.trim());
            plan.setConfigs(copyConfigs(configs));
            plan.setEnabled(false);
            plan.setCreatedAt(now);
            plan.setUpdatedAt(now);
        }

        plans.put(plan.getId(), plan);
        persist();
        return List.of();
    }

    /**
     * 删除方案（同步移除其写入的订阅参数）
     */
    public synchronized boolean deletePlan(String id) {
        CollectionPlan plan = plans.remove(id);
        if (plan == null) {
            return false;
        }
        if (plan.isEnabled()) {
            clientService.getSubscriptionsByPlan(id).forEach(record ->
                    clientService.unsubscribe(record.getNodeId()));
        }
        persist();
        return true;
    }

    /**
     * 启用方案：按节点逐条反馈，连接异常的节点单独列为待生效
     */
    public synchronized ApplyResult enablePlan(String id) {
        CollectionPlan plan = plans.get(id);
        if (plan == null) {
            return new ApplyResult(false, List.of(), List.of());
        }
        plan.setEnabled(true);
        plan.setUpdatedAt(System.currentTimeMillis());

        List<ApplyNodeResult> results = new ArrayList<>();
        List<String> pendingNodeIds = new ArrayList<>();

        for (PlanNodeConfig config : plan.getConfigs()) {
            String nodeId = config.getNodeId();
            String nodeName = nodeName(nodeId);
            boolean reachable = clientService.isNodeReachable(nodeId);

            clientService.subscribe(nodeId, config.getPublishingInterval(),
                    config.getSamplingInterval(), config.getQueueSize(), "plan", plan.getId());

            if (reachable) {
                results.add(new ApplyNodeResult(nodeId, nodeName, true, "已生效", config));
            } else {
                pendingNodeIds.add(nodeId);
                results.add(new ApplyNodeResult(nodeId, nodeName, false,
                        "节点连接异常，待连接恢复后生效", config));
            }
        }

        persist();
        return new ApplyResult(true, results, pendingNodeIds);
    }

    /**
     * 停用方案：移除该方案写入的订阅参数
     */
    public synchronized void disablePlan(String id) {
        CollectionPlan plan = plans.get(id);
        if (plan == null) {
            return;
        }
        plan.setEnabled(false);
        plan.setUpdatedAt(System.currentTimeMillis());
        clientService.getSubscriptionsByPlan(id).forEach(record ->
                clientService.unsubscribe(record.getNodeId()));
        persist();
    }

    /**
     * 重试待生效节点（可限定方案），返回本次转为已生效的节点 id
     */
    public synchronized List<String> retryPending(String planId) {
        List<String> applied = clientService.retryPending(planId);
        return applied;
    }

    /**
     * 按已启用方案把参数写入共享订阅存储（状态依据当前连通性）
     */
    private void applyPlanToSubscriptions(CollectionPlan plan) {
        for (PlanNodeConfig config : plan.getConfigs()) {
            if (clientService.getNode(config.getNodeId()) == null) {
                continue;
            }
            clientService.subscribe(config.getNodeId(), config.getPublishingInterval(),
                    config.getSamplingInterval(), config.getQueueSize(), "plan", plan.getId());
        }
    }

    private String nodeName(String nodeId) {
        var node = clientService.getNode(nodeId);
        return node != null ? node.getName() : nodeId;
    }

    private List<PlanNodeConfig> copyConfigs(List<PlanNodeConfig> configs) {
        List<PlanNodeConfig> copy = new ArrayList<>();
        for (PlanNodeConfig c : configs) {
            copy.add(new PlanNodeConfig(c.getNodeId(), c.getSamplingInterval(),
                    c.getPublishingInterval(), c.getQueueSize()));
        }
        return copy;
    }

    /**
     * 整份配置校验：任一项越界都会被收集并精确定位到节点与字段
     */
    private List<String> validate(String name, List<PlanNodeConfig> configs) {
        List<String> errors = new ArrayList<>();

        if (name == null || name.trim().isEmpty()) {
            errors.add("请输入方案名称");
        }
        if (configs == null || configs.isEmpty()) {
            errors.add("请至少选择一个节点");
            return errors;
        }

        Set<String> seen = new HashSet<>();
        for (PlanNodeConfig config : configs) {
            String nodeId = config.getNodeId();
            String nodeName = nodeName(nodeId);

            if (!seen.add(nodeId)) {
                errors.add(String.format("节点 %s 在方案中重复配置", nodeName));
            }
            if (clientService.getNode(nodeId) == null) {
                errors.add(String.format("节点 %s 不存在", nodeName));
            }

            checkRange(errors, nodeName, "采样周期", config.getSamplingInterval(),
                    MIN_SAMPLING_INTERVAL, MAX_SAMPLING_INTERVAL, "ms");
            checkRange(errors, nodeName, "发布周期", config.getPublishingInterval(),
                    MIN_PUBLISHING_INTERVAL, MAX_PUBLISHING_INTERVAL, "ms");
            checkRange(errors, nodeName, "队列上限", config.getQueueSize(),
                    MIN_QUEUE_SIZE, MAX_QUEUE_SIZE, "条");
        }
        return errors;
    }

    private void checkRange(List<String> errors, String nodeName, String field,
                            int value, int min, int max, String unit) {
        if (value < min || value > max) {
            errors.add(String.format("节点 %s 的%s %d%s 超出允许范围 %d~%d%s",
                    nodeName, field, value, unit, min, max, unit));
        }
    }

    private void persist() {
        try {
            File parent = storeFile.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(storeFile, listPlans());
        } catch (Exception e) {
            log.error("采集方案持久化失败", e);
        }
    }

    @SuppressWarnings("unchecked")
    private void load() {
        if (!storeFile.exists()) {
            return;
        }
        try {
            List<CollectionPlan> loaded = objectMapper.readValue(storeFile,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, CollectionPlan.class));
            loaded.forEach(plan -> plans.put(plan.getId(), plan));
            log.info("已加载 {} 份采集方案", loaded.size());
        } catch (Exception e) {
            log.error("采集方案加载失败，以空方案启动", e);
        }
    }
}
