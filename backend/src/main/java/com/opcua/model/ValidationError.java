package com.opcua.model;

/**
 * 采集方案校验错误：指明是哪个节点的哪一项超出标准
 */
public class ValidationError {

    private String nodeId;
    private String nodeName;
    private String field;       // samplingInterval / publishingInterval / queueSize / nodeId
    private String message;

    public ValidationError() {
    }

    public ValidationError(String nodeId, String nodeName, String field, String message) {
        this.nodeId = nodeId;
        this.nodeName = nodeName;
        this.field = field;
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

    public String getField() {
        return field;
    }

    public void setField(String field) {
        this.field = field;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
