package com.opcua.model;

/**
 * 采集方案启用时单个节点的反馈结果
 */
public class SchemeNodeResult {

    private String nodeId;
    private String nodeName;
    private String status;  // success / pending
    private String message;

    public SchemeNodeResult() {
    }

    public SchemeNodeResult(String nodeId, String nodeName, String status, String message) {
        this.nodeId = nodeId;
        this.nodeName = nodeName;
        this.status = status;
        this.message = message;
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public String getNodeName() {
        return nodeName;
    }

    public void setNodeName(String nodeName) {
        this.nodeName = nodeName;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
