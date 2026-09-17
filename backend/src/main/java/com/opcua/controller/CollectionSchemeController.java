package com.opcua.controller;

import com.opcua.config.CollectionLimits;
import com.opcua.model.CollectionScheme;
import com.opcua.model.EffectiveSubscription;
import com.opcua.model.SchemeActivationResult;
import com.opcua.service.CollectionSchemeService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 节点采集方案接口
 */
@RestController
@RequestMapping("/api/collection")
@CrossOrigin(origins = "*")
public class CollectionSchemeController {

    private final CollectionSchemeService collectionSchemeService;

    public CollectionSchemeController(CollectionSchemeService collectionSchemeService) {
        this.collectionSchemeService = collectionSchemeService;
    }

    /**
     * 参数取值范围（前端表单与后端校验共用同一份标准）
     */
    @GetMapping("/limits")
    public ResponseEntity<Map<String, Object>> getLimits() {
        Map<String, Object> limits = new LinkedHashMap<>();
        limits.put("samplingInterval", Map.of(
                "min", CollectionLimits.MIN_SAMPLING_INTERVAL,
                "max", CollectionLimits.MAX_SAMPLING_INTERVAL,
                "hint", CollectionLimits.samplingHint()));
        limits.put("publishingInterval", Map.of(
                "min", CollectionLimits.MIN_PUBLISHING_INTERVAL,
                "max", CollectionLimits.MAX_PUBLISHING_INTERVAL,
                "hint", CollectionLimits.publishingHint()));
        limits.put("queueSize", Map.of(
                "min", CollectionLimits.MIN_QUEUE_SIZE,
                "max", CollectionLimits.MAX_QUEUE_SIZE,
                "hint", CollectionLimits.queueHint()));
        return ResponseEntity.ok(limits);
    }

    /**
     * 采集方案列表：每份方案可见覆盖节点与是否生效
     */
    @GetMapping("/schemes")
    public ResponseEntity<List<CollectionScheme>> listSchemes() {
        return ResponseEntity.ok(collectionSchemeService.listSchemes());
    }

    @GetMapping("/schemes/{id}")
    public ResponseEntity<CollectionScheme> getScheme(@PathVariable String id) {
        return ResponseEntity.ok(collectionSchemeService.getScheme(id));
    }

    /**
     * 保存采集方案（整单校验，任一节点任一项越界均拒绝保存）
     */
    @PostMapping("/schemes")
    public ResponseEntity<CollectionScheme> createScheme(@RequestBody CollectionScheme scheme) {
        return ResponseEntity.ok(collectionSchemeService.createScheme(scheme));
    }

    @PutMapping("/schemes/{id}")
    public ResponseEntity<CollectionScheme> updateScheme(@PathVariable String id,
                                                         @RequestBody CollectionScheme scheme) {
        return ResponseEntity.ok(collectionSchemeService.updateScheme(id, scheme));
    }

    @DeleteMapping("/schemes/{id}")
    public ResponseEntity<Map<String, Object>> deleteScheme(@PathVariable String id) {
        collectionSchemeService.deleteScheme(id);
        return ResponseEntity.ok(Map.of("success", true, "id", id));
    }

    /**
     * 启用方案：按节点逐条反馈结果，连接异常的节点列入待生效
     */
    @PostMapping("/schemes/{id}/activate")
    public ResponseEntity<SchemeActivationResult> activateScheme(@PathVariable String id) {
        return ResponseEntity.ok(collectionSchemeService.activateScheme(id));
    }

    @PostMapping("/schemes/{id}/deactivate")
    public ResponseEntity<Map<String, Object>> deactivateScheme(@PathVariable String id) {
        collectionSchemeService.deactivateScheme(id);
        return ResponseEntity.ok(Map.of("success", true, "id", id));
    }

    /**
     * 对待生效节点重新下发
     */
    @PostMapping("/retry-pending")
    public ResponseEntity<SchemeActivationResult> retryPending() {
        return ResponseEntity.ok(collectionSchemeService.retryPending());
    }

    /**
     * 节点当前生效参数：节点详情用于展示周期来自哪份配置
     */
    @GetMapping("/effective/{nodeId}")
    public ResponseEntity<EffectiveSubscription> getEffective(@PathVariable String nodeId) {
        return ResponseEntity.ok(collectionSchemeService.getEffectiveSubscription(nodeId));
    }
}
