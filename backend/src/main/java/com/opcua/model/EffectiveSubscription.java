package com.opcua.model;

import java.util.List;

/**
 * 节点当前生效的采集/订阅参数（配置与订阅共用同一份参数）
 */
public class EffectiveSubscription {

    private String nodeId;
    private Integer samplingInterval;
    private Integer publishingInterval;
    private Integer queueSize;
    private String source;              // scheme / manual
    private String sourceSchemeId;      // 参数来自哪份采集方案
    private String sourceSchemeName;
    private boolean pending;            // 方案覆盖但连接异常、待生效
    private boolean subscribed;

    public EffectiveSubscription() {
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    public Integer getSamplingInterval() {
        return samplingInterval;
    }

    public void setSamplingInterval(Integer samplingInterval) {
        this.samplingInterval = samplingInterval;
    }

    public Integer getPublishingInterval() {
        return publishingInterval;
    }

    public void setPublishingInterval(Integer publishingInterval) {
        this.publishingInterval = publishingInterval;
    }

    public Integer getQueueSize() {
        return queueSize;
    }

    public void setQueueSize(Integer queueSize) {
        this.queueSize = queueSize;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getSourceSchemeId() {
        return sourceSchemeId;
    }

    public void setSourceSchemeId(String sourceSchemeId) {
        this.sourceSchemeId = sourceSchemeId;
    }

    public String getSourceSchemeName() {
        return sourceSchemeName;
    }

    public void setSourceSchemeName(String sourceSchemeName) {
        this.sourceSchemeName = sourceSchemeName;
    }

    public boolean isPending() {
        return pending;
    }

    public void setPending(boolean pending) {
        this.pending = pending;
    }

    public boolean isSubscribed() {
        return subscribed;
    }

    public void setSubscribed(boolean subscribed) {
        this.subscribed = subscribed;
    }
}
