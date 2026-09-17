package com.opcua.service;

import com.opcua.config.CollectionLimits;
import com.opcua.model.CollectionNodeConfig;
import com.opcua.model.DataValueModel;
import com.opcua.model.NodeModel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/**
 * OPC-UA 客户端服务
 * 当前为模拟实现，生产环境中应使用 Eclipse Milo OpcUaClient 连接真实 OPC-UA 服务器
 */
@Service
public class OpcuaClientService {

    private static final Logger log = LoggerFactory.getLogger(OpcuaClientService.class);

    private final Map<String, NodeModel> nodeCache = new ConcurrentHashMap<>();
    private final Set<String> subscriptions = ConcurrentHashMap.newKeySet();
    /** 各节点当前生效的订阅参数（采集方案与单点订阅共用） */
    private final Map<String, CollectionNodeConfig> subscriptionParams = new ConcurrentHashMap<>();
    /** 当前连接异常的节点（含人为断连与自然抖动） */
    private final Set<String> unreachableNodes = ConcurrentHashMap.newKeySet();
    /** 人为设置为离线的节点，不参与自动恢复 */
    private final Set<String> manualOfflineNodes = ConcurrentHashMap.newKeySet();

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
    private final Random random = new Random();
    private final ApplicationEventPublisher eventPublisher;

    private boolean connected = false;
    private String serverUrl = "opc.tcp://localhost:4840";

    public OpcuaClientService(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    @PostConstruct
    public void init() {
        initMockNodes();
        startSimulation();
        startRecoveryMonitor();
        connected = true;
        log.info("OPC-UA 客户端服务已初始化（模拟模式）");
    }

    /**
     * 初始化模拟节点树
     */
    private void initMockNodes() {
        // PLC_Area1 节点
        NodeModel plcArea1 = new NodeModel("plc_area1", "PLC_Area1", "ns=2;i=1001", "Object", null, null, null);
        plcArea1.setDescription("1号生产区域 PLC");

        NodeModel tempSensor = new NodeModel("temp_sensor", "Temperature_Sensor", "ns=2;i=1002", "Variable", "Double", 25.6, "Good");
        tempSensor.setUnit("°C");
        tempSensor.setDescription("温度传感器");

        NodeModel pressureTransmitter = new NodeModel("pressure_transmitter", "Pressure_Transmitter", "ns=2;i=1003", "Variable", "Double", 3.45, "Good");
        pressureTransmitter.setUnit("MPa");
        pressureTransmitter.setDescription("压力变送器");

        NodeModel pumpStatus = new NodeModel("pump_status", "Pump_Status", "ns=2;i=1004", "Variable", "Boolean", true, "Good");
        pumpStatus.setDescription("泵运行状态");

        plcArea1.setChildren(List.of(tempSensor, pressureTransmitter, pumpStatus));

        // PLC_Area2 节点
        NodeModel plcArea2 = new NodeModel("plc_area2", "PLC_Area2", "ns=2;i=2001", "Object", null, null, null);
        plcArea2.setDescription("2号生产区域 PLC");

        NodeModel flowMeter = new NodeModel("flow_meter", "Flow_Meter", "ns=2;i=2002", "Variable", "Double", 156.7, "Good");
        flowMeter.setUnit("L/min");
        flowMeter.setDescription("流量计");

        NodeModel valvePosition = new NodeModel("valve_position", "Valve_Position", "ns=2;i=2003", "Variable", "Double", 75.0, "Good");
        valvePosition.setUnit("%");
        valvePosition.setDescription("阀门开度");

        NodeModel motorSpeed = new NodeModel("motor_speed", "Motor_Speed", "ns=2;i=2004", "Variable", "Int32", 1480, "Good");
        motorSpeed.setUnit("RPM");
        motorSpeed.setDescription("电机转速");

        plcArea2.setChildren(List.of(flowMeter, valvePosition, motorSpeed));

        // Objects 节点
        NodeModel objects = new NodeModel("objects", "Objects", "ns=0;i=85", "Object", null, null, null);
        objects.setDescription("对象文件夹");
        objects.setChildren(List.of(plcArea1, plcArea2));

        // Server 节点
        NodeModel server = new NodeModel("server", "Server", "ns=0;i=2253", "Object", null, null, null);
        server.setDescription("OPC-UA 服务器根节点");
        server.setChildren(List.of(objects));

        // 缓存所有节点
        cacheNode(server);
        cacheNode(objects);
        cacheNode(plcArea1);
        cacheNode(plcArea2);
        cacheNode(tempSensor);
        cacheNode(pressureTransmitter);
        cacheNode(pumpStatus);
        cacheNode(flowMeter);
        cacheNode(valvePosition);
        cacheNode(motorSpeed);

        nodeCache.put("server", server);
    }

    private void cacheNode(NodeModel node) {
        nodeCache.put(node.getId(), node);
    }

    /**
     * 启动数据模拟
     */
    private void startSimulation() {
        scheduler.scheduleAtFixedRate(() -> {
            try {
                simulateValue("temp_sensor", 25.6, 2.0, "Double");
                simulateValue("pressure_transmitter", 3.45, 0.3, "Double");
                simulateValue("flow_meter", 156.7, 10.0, "Double");
                simulateValue("valve_position", 75.0, 5.0, "Double");
                simulateValue("motor_speed", 1480, 30, "Int32");

                // 偶尔翻转泵状态
                if (random.nextDouble() > 0.98) {
                    NodeModel pump = nodeCache.get("pump_status");
                    if (pump != null) {
                        pump.setValue(!(Boolean) pump.getValue());
                    }
                }

                // 偶发的节点连接抖动（人为离线的节点除外）
                if (random.nextDouble() > 0.995) {
                    List<String> candidates = new ArrayList<>(nodeCache.keySet());
                    String candidate = candidates.get(random.nextInt(candidates.size()));
                    if (!manualOfflineNodes.contains(candidate) && unreachableNodes.add(candidate)) {
                        log.warn("节点连接异常（模拟抖动）: {}", candidate);
                    }
                }
            } catch (Exception e) {
                log.error("数据模拟异常", e);
            }
        }, 1, 1, TimeUnit.SECONDS);
    }

    /**
     * 连接恢复监测：非人为离线的异常节点按概率恢复，恢复后发布事件以补发待生效配置
     */
    private void startRecoveryMonitor() {
        scheduler.scheduleAtFixedRate(() -> {
            try {
                for (String nodeId : new ArrayList<>(unreachableNodes)) {
                    if (!manualOfflineNodes.contains(nodeId) && random.nextDouble() > 0.6) {
                        unreachableNodes.remove(nodeId);
                        log.info("节点连接已恢复: {}", nodeId);
                        eventPublisher.publishEvent(new NodeReachabilityEvent(nodeId, true));
                    }
                }
            } catch (Exception e) {
                log.error("连接恢复监测异常", e);
            }
        }, 5, 5, TimeUnit.SECONDS);
    }

    private void simulateValue(String nodeId, double baseValue, double range, String dataType) {
        NodeModel node = nodeCache.get(nodeId);
        if (node != null && "Variable".equals(node.getType())) {
            double variation = (random.nextDouble() - 0.5) * 2 * range;
            if ("Int32".equals(dataType)) {
                node.setValue((int) (baseValue + variation));
            } else {
                node.setValue(Math.round((baseValue + variation) * 100.0) / 100.0);
            }
            // 模拟质量码
            node.setQuality(random.nextDouble() > 0.97 ? "Uncertain" : "Good");
        }
    }

    /**
     * 浏览节点树
     */
    public List<NodeModel> browseNodes() {
        NodeModel root = nodeCache.get("server");
        if (root != null) {
            return List.of(root);
        }
        return Collections.emptyList();
    }

    /**
     * 读取节点值
     */
    public DataValueModel readValue(String nodeId) {
        NodeModel node = nodeCache.get(nodeId);
        if (node == null || !"Variable".equals(node.getType())) {
            return null;
        }

        DataValueModel dataValue = new DataValueModel();
        dataValue.setNodeId(node.getNodeId());
        dataValue.setValue(node.getValue());
        dataValue.setQuality(node.getQuality());
        dataValue.setTimestamp(Instant.now());
        dataValue.setSourceTimestamp(Instant.now());
        dataValue.setServerTimestamp(Instant.now());
        return dataValue;
    }

    /**
     * 订阅节点（保持原有单点订阅入口行为，参数取系统默认值）
     */
    public boolean subscribe(String nodeId, int publishingInterval, int samplingInterval) {
        return subscribe(nodeId, publishingInterval, samplingInterval, 10);
    }

    /**
     * 订阅节点。采集方案与单点订阅共用同一份参数标准，任一项越界均拒绝
     */
    public boolean subscribe(String nodeId, int publishingInterval, int samplingInterval, int queueSize) {
        if (!nodeCache.containsKey(nodeId)) {
            log.warn("订阅失败：节点 {} 不存在", nodeId);
            return false;
        }
        if (!isValidInterval(samplingInterval, CollectionLimits.MIN_SAMPLING_INTERVAL,
                CollectionLimits.MAX_SAMPLING_INTERVAL)
                || !isValidInterval(publishingInterval, CollectionLimits.MIN_PUBLISHING_INTERVAL,
                CollectionLimits.MAX_PUBLISHING_INTERVAL)
                || queueSize < CollectionLimits.MIN_QUEUE_SIZE
                || queueSize > CollectionLimits.MAX_QUEUE_SIZE) {
            log.warn("订阅失败：节点 {} 参数超出允许范围（采样 {}ms / 发布 {}ms / 队列 {}）",
                    nodeId, samplingInterval, publishingInterval, queueSize);
            return false;
        }
        applySubscription(new CollectionNodeConfig(nodeId, samplingInterval, publishingInterval, queueSize));
        return true;
    }

    private boolean isValidInterval(int value, int min, int max) {
        return value >= min && value <= max;
    }

    /**
     * 应用一份已校验通过的节点采集参数
     */
    public void applySubscription(CollectionNodeConfig config) {
        if (!nodeCache.containsKey(config.getNodeId())) {
            throw new IllegalArgumentException("节点不存在: " + config.getNodeId());
        }
        subscriptions.add(config.getNodeId());
        subscriptionParams.put(config.getNodeId(), config);
        log.info("已订阅节点: {}, 采样间隔: {}ms, 发布间隔: {}ms, 队列上限: {}",
                config.getNodeId(), config.getSamplingInterval(),
                config.getPublishingInterval(), config.getQueueSize());
    }

    /**
     * 取消订阅
     */
    public boolean unsubscribe(String nodeId) {
        boolean removed = subscriptions.remove(nodeId);
        subscriptionParams.remove(nodeId);
        if (removed) {
            log.info("已取消订阅节点: {}", nodeId);
        }
        return removed;
    }

    public CollectionNodeConfig getSubscriptionParams(String nodeId) {
        return subscriptionParams.get(nodeId);
    }

    public Map<String, CollectionNodeConfig> getAllSubscriptionParams() {
        return Collections.unmodifiableMap(subscriptionParams);
    }

    public String getNodeName(String nodeId) {
        NodeModel node = nodeCache.get(nodeId);
        return node == null ? null : node.getName();
    }

    public boolean nodeExists(String nodeId) {
        return nodeCache.containsKey(nodeId);
    }

    // ---- 节点连通性（模拟连接异常/恢复） ----

    public boolean isNodeReachable(String nodeId) {
        return nodeCache.containsKey(nodeId) && !unreachableNodes.contains(nodeId);
    }

    public Set<String> getUnreachableNodes() {
        return Collections.unmodifiableSet(unreachableNodes);
    }

    /**
     * 手动设置节点连接状态（模拟断连/恢复）
     */
    public void setNodeReachable(String nodeId, boolean reachable) {
        if (!nodeCache.containsKey(nodeId)) {
            throw new IllegalArgumentException("节点不存在: " + nodeId);
        }
        if (reachable) {
            boolean recovered = unreachableNodes.remove(nodeId);
            manualOfflineNodes.remove(nodeId);
            if (recovered) {
                log.info("节点连接已手动恢复: {}", nodeId);
                eventPublisher.publishEvent(new NodeReachabilityEvent(nodeId, true));
            }
        } else {
            if (unreachableNodes.add(nodeId)) {
                log.warn("节点连接已手动断开: {}", nodeId);
            }
            manualOfflineNodes.add(nodeId);
        }
    }

    public boolean isConnected() {
        return connected;
    }

    public String getServerUrl() {
        return serverUrl;
    }

    /**
     * 节点连通性变化事件
     */
    public record NodeReachabilityEvent(String nodeId, boolean reachable) {
    }
}
