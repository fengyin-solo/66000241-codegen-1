package com.opcua.controller;

import com.opcua.model.DataValueModel;
import com.opcua.model.NodeModel;
import com.opcua.service.OpcuaClientService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class NodeController {

    private final OpcuaClientService opcuaClientService;

    public NodeController(OpcuaClientService opcuaClientService) {
        this.opcuaClientService = opcuaClientService;
    }

    /**
     * 获取所有 OPC-UA 节点（树形结构）
     */
    @GetMapping("/nodes")
    public ResponseEntity<List<NodeModel>> getAllNodes() {
        List<NodeModel> nodes = opcuaClientService.browseNodes();
        return ResponseEntity.ok(nodes);
    }

    /**
     * 获取指定节点的当前值
     */
    @GetMapping("/nodes/{id}/value")
    public ResponseEntity<DataValueModel> getNodeValue(@PathVariable String id) {
        DataValueModel value = opcuaClientService.readValue(id);
        if (value != null) {
            return ResponseEntity.ok(value);
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * 订阅节点数据变更（单点订阅入口保持原样，参数与采集方案共用同一份标准）
     */
    @PostMapping("/subscribe")
    public ResponseEntity<Map<String, Object>> subscribe(@RequestBody Map<String, Object> request) {
        String nodeId = (String) request.get("nodeId");
        Integer publishingInterval = (Integer) request.getOrDefault("publishingInterval", 1000);
        Integer samplingInterval = (Integer) request.getOrDefault("samplingInterval", 500);
        Integer queueSize = (Integer) request.getOrDefault("queueSize", 10);

        boolean success = opcuaClientService.subscribe(
                nodeId, publishingInterval, samplingInterval, queueSize, "manual", null);

        return ResponseEntity.ok(Map.of(
                "success", success,
                "nodeId", nodeId,
                "publishingInterval", publishingInterval,
                "samplingInterval", samplingInterval,
                "queueSize", queueSize
        ));
    }

    /**
     * 取消订阅
     */
    @DeleteMapping("/subscribe/{nodeId}")
    public ResponseEntity<Map<String, Object>> unsubscribe(@PathVariable String nodeId) {
        boolean success = opcuaClientService.unsubscribe(nodeId);
        return ResponseEntity.ok(Map.of(
                "success", success,
                "nodeId", nodeId
        ));
    }

    /**
     * 查询节点当前生效的采集参数（含参数来源：manual / plan）
     */
    @GetMapping("/nodes/{id}/subscription")
    public ResponseEntity<Map<String, Object>> getSubscription(@PathVariable String id) {
        OpcuaClientService.SubscriptionRecord record = opcuaClientService.getSubscription(id);
        if (record == null) {
            return ResponseEntity.ok(Map.of("subscribed", false));
        }
        Map<String, Object> result = new java.util.HashMap<>();
        result.put("subscribed", true);
        result.put("nodeId", record.getNodeId());
        result.put("samplingInterval", record.getSamplingInterval());
        result.put("publishingInterval", record.getPublishingInterval());
        result.put("queueSize", record.getQueueSize());
        result.put("source", record.getSource());
        result.put("planId", record.getPlanId() == null ? "" : record.getPlanId());
        result.put("status", record.getStatus());
        return ResponseEntity.ok(result);
    }

    /**
     * 设置节点连接状态（模拟连接异常/恢复），恢复时返回转为已生效的节点
     */
    @PostMapping("/nodes/{id}/connectivity")
    public ResponseEntity<Map<String, Object>> setConnectivity(@PathVariable String id,
                                                               @RequestBody Map<String, Object> request) {
        boolean reachable = Boolean.TRUE.equals(request.get("reachable"));
        if (opcuaClientService.getNode(id) == null) {
            return ResponseEntity.notFound().build();
        }
        java.util.List<String> applied = opcuaClientService.setNodeConnectivity(id, reachable);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "nodeId", id,
                "reachable", reachable,
                "appliedNodeIds", applied
        ));
    }

    /**
     * 获取连接状态
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        return ResponseEntity.ok(Map.of(
                "connected", opcuaClientService.isConnected(),
                "serverUrl", opcuaClientService.getServerUrl()
        ));
    }
}
