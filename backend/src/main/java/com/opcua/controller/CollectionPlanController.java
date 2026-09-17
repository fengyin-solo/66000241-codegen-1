package com.opcua.controller;

import com.opcua.model.ApplyResult;
import com.opcua.model.CollectionPlan;
import com.opcua.model.ParamLimit;
import com.opcua.model.SavePlanRequest;
import com.opcua.service.CollectionPlanService;
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
public class CollectionPlanController {

    private final CollectionPlanService planService;

    public CollectionPlanController(CollectionPlanService planService) {
        this.planService = planService;
    }

    /**
     * 采集参数统一取值范围（前端保存与后端校验共用同一份标准）
     */
    @GetMapping("/limits")
    public ResponseEntity<Map<String, Object>> limits() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("samplingInterval", new ParamLimit("samplingInterval", "采样周期", "ms",
                CollectionPlanService.MIN_SAMPLING_INTERVAL, CollectionPlanService.MAX_SAMPLING_INTERVAL));
        result.put("publishingInterval", new ParamLimit("publishingInterval", "发布周期", "ms",
                CollectionPlanService.MIN_PUBLISHING_INTERVAL, CollectionPlanService.MAX_PUBLISHING_INTERVAL));
        result.put("queueSize", new ParamLimit("queueSize", "队列上限", "条",
                CollectionPlanService.MIN_QUEUE_SIZE, CollectionPlanService.MAX_QUEUE_SIZE));
        result.put("maxQueueSize", CollectionPlanService.MAX_QUEUE_SIZE);
        return ResponseEntity.ok(result);
    }

    /**
     * 采集方案列表（含覆盖节点与启用状态，刷新后保留）
     */
    @GetMapping("/plans")
    public ResponseEntity<List<CollectionPlan>> listPlans() {
        return ResponseEntity.ok(planService.listPlans());
    }

    /**
     * 保存方案（新增/更新）。任一项不满足取值范围时整份配置不允许保存，
     * 返回 400 并列出是哪个节点的哪一项超出标准
     */
    @PostMapping("/plans")
    public ResponseEntity<?> savePlan(@RequestBody SavePlanRequest request) {
        List<String> errors = planService.savePlan(
                request.getId(), request.getName(), request.getDescription(), request.getConfigs());
        if (!errors.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", "配置校验未通过，整份配置未保存",
                    "errors", errors
            ));
        }
        return ResponseEntity.ok(Map.of("success", true));
    }

    /**
     * 删除方案
     */
    @DeleteMapping("/plans/{id}")
    public ResponseEntity<Map<String, Object>> deletePlan(@PathVariable String id) {
        boolean success = planService.deletePlan(id);
        return ResponseEntity.ok(Map.of("success", success));
    }

    /**
     * 启用方案：按节点逐条反馈，连接异常的节点单独列为待生效
     */
    @PostMapping("/plans/{id}/enable")
    public ResponseEntity<ApplyResult> enablePlan(@PathVariable String id) {
        ApplyResult result = planService.enablePlan(id);
        if (!result.isSuccess()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(result);
    }

    /**
     * 停用方案
     */
    @PostMapping("/plans/{id}/disable")
    public ResponseEntity<Map<String, Object>> disablePlan(@PathVariable String id) {
        planService.disablePlan(id);
        return ResponseEntity.ok(Map.of("success", true));
    }

    /**
     * 重试待生效节点（连接恢复后调用，可限定方案）
     */
    @PostMapping("/pending/retry")
    public ResponseEntity<Map<String, Object>> retryPending(@RequestParam(required = false) String planId) {
        List<String> appliedNodeIds = planService.retryPending(planId);
        return ResponseEntity.ok(Map.of(
                "success", true,
                "appliedNodeIds", appliedNodeIds
        ));
    }
}
