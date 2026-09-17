package com.opcua.model;

/**
 * 采集方案中单个节点的采集配置项
 */
public class PlanNodeConfig {

    private String nodeId;
    /** 采样周期（ms） */
    private int samplingInterval;
    /** 发布周期（ms） */
    private int publishingInterval;
    /** 队列上限（条） */
    private int queueSize;

    public PlanNodeConfig() {
    }

    public PlanNodeConfig(String nodeId, int samplingInterval, int publishingInterval, int queueSize) {
        this.nodeId = nodeId;
        this.samplingInterval = samplingInterval;
        this.publishingInterval = publishingInterval;
        this.queueSize = queueSize;
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
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
