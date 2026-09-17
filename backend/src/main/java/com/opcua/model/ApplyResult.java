package com.opcua.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 采集方案启用结果：逐条节点反馈 + 连接异常待生效节点
 */
public class ApplyResult {

    private boolean success;
    private List<ApplyNodeResult> appliedNodes = new ArrayList<>();
    private List<String> pendingNodeIds = new ArrayList<>();

    public ApplyResult() {
    }

    public ApplyResult(boolean success, List<ApplyNodeResult> appliedNodes, List<String> pendingNodeIds) {
        this.success = success;
        this.appliedNodes = appliedNodes;
        this.pendingNodeIds = pendingNodeIds;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public List<ApplyNodeResult> getAppliedNodes() {
        return appliedNodes;
    }

    public void setAppliedNodes(List<ApplyNodeResult> appliedNodes) {
        this.appliedNodes = appliedNodes;
    }

    public List<String> getPendingNodeIds() {
        return pendingNodeIds;
    }

    public void setPendingNodeIds(List<String> pendingNodeIds) {
        this.pendingNodeIds = pendingNodeIds;
    }
}
