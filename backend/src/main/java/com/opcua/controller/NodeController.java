package com.opcua.controller;

import com.opcua.model.CollectionNodeConfig;
import com.opcua.model.DataValueModel;
import com.opcua.model.NodeModel;
import com.opcua.service.CollectionSchemeService;
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
    private final CollectionSchemeService collectionSchemeService;

    public NodeController(OpcuaClientService opcuaClientService,
                          CollectionSchemeService collectionSchemeService) {
        this.opcuaClientService = opcuaClientService;
        this.collectionSchemeService = collectionSchemeService;
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
     * 订阅节点数据变更（原有单点订阅入口，保持原有请求/响应结构）
     * 内部与采集方案共用同一份订阅参数标准
     */
    @PostMapping("/subscribe")
    public ResponseEntity<Map<String, Object>> subscribe(@RequestBody Map<String, Object> request) {
        String nodeId = (String) request.get("nodeId");
        Integer publishingInterval = asInt(request.get("publishingInterval"), 1000);
        Integer samplingInterval = asInt(request.get("samplingInterval"), 500);
        Integer queueSize = asInt(request.get("queueSize"), 10);

        // 与采集方案共用同一份参数及存储
        collectionSchemeService.manualSubscribe(
                new CollectionNodeConfig(nodeId, samplingInterval, publishingInterval, queueSize));

        return ResponseEntity.ok(Map.of(
                "success", true,
                "nodeId", nodeId,
                "publishingInterval", publishingInterval,
                "samplingInterval", samplingInterval,
                "queueSize", queueSize
        ));
    }

    private Integer asInt(Object value, int defaultValue) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return defaultValue;
    }

    /**
     * 取消订阅（原有单点订阅入口）
     */
    @DeleteMapping("/subscribe/{nodeId}")
    public ResponseEntity<Map<String, Object>> unsubscribe(@PathVariable String nodeId) {
        collectionSchemeService.manualUnsubscribe(nodeId);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "nodeId", nodeId
        ));
    }

    /**
     * 获取连接状态
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getStatus() {
        return ResponseEntity.ok(Map.of(
                "connected", opcuaClientService.isConnected(),
                "serverUrl", opcuaClientService.getServerUrl(),
                "unreachableNodes", opcuaClientService.getUnreachableNodes()
        ));
    }

    /**
     * 模拟节点连接异常/恢复（演示待生效机制）
     */
    @PostMapping("/nodes/{id}/reachability")
    public ResponseEntity<Map<String, Object>> setReachability(@PathVariable String id,
                                                               @RequestBody Map<String, Object> request) {
        boolean reachable = Boolean.TRUE.equals(request.get("reachable"));
        opcuaClientService.setNodeReachable(id, reachable);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "nodeId", id,
                "reachable", reachable
        ));
    }
}
