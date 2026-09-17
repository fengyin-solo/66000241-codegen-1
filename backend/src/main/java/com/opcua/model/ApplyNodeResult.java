package com.opcua.model;

/**
 * 采集方案启用时单节点反馈
 */
public class ApplyNodeResult {

    private String nodeId;
    private String nodeName;
    /** true=已生效；false=节点连接异常，待生效 */
    private boolean applied;
    private String message;
    private int samplingInterval;
    private int publishingInterval;
    private int queueSize;

    public ApplyNodeResult() {
    }

    public ApplyNodeResult(String nodeId, String nodeName, boolean applied, String message,
                           PlanNodeConfig config) {
        this.nodeId = nodeId;
        this.nodeName = nodeName;
        this.applied = applied;
        this.message = message;
        this.samplingInterval = config.getSamplingInterval();
        this.publishingInterval = config.getPublishingInterval();
        this.queueSize = config.getQueueSize();
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

    public boolean isApplied() {
        return applied;
    }

    public void setApplied(boolean applied) {
        this.applied = applied;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public int getSamplingInterval() {
        return samplingInterval;
    }

    public void setSamplingInterval(int samplingInterval) {
        this.samplingInterval = samplingInterval;
    }

    public int getPublishingInterval() {
        return publishingInterval;
    }

    public void setPublishingInterval(int publishingInterval) {
        this.publishingInterval = publishingInterval;
    }

    public int getQueueSize() {
        return queueSize;
    }

    public void setQueueSize(int queueSize) {
        this.queueSize = queueSize;
    }
}
