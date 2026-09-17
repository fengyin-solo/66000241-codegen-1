package com.opcua.model;

/**
 * 采集方案中单个节点的采集参数
 */
public class CollectionNodeConfig {

    private String nodeId;
    private int samplingInterval;  // 采样周期（毫秒）
    private int publishingInterval; // 发布周期（毫秒）
    private int queueSize;          // 队列上限

    public CollectionNodeConfig() {
    }

    public CollectionNodeConfig(String nodeId, int samplingInterval, int publishingInterval, int queueSize) {
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
