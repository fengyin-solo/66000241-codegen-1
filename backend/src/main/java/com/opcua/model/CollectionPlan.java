package com.opcua.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 可复用的节点采集方案
 */
public class CollectionPlan {

    private String id;
    private String name;
    private String description;
    private List<PlanNodeConfig> configs = new ArrayList<>();
    /** 是否启用（刷新/重启后保留） */
    private boolean enabled;
    private long createdAt;
    private long updatedAt;

    public CollectionPlan() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public List<PlanNodeConfig> getConfigs() {
        return configs;
    }

    public void setConfigs(List<PlanNodeConfig> configs) {
        this.configs = configs;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(long createdAt) {
        this.createdAt = createdAt;
    }

    public long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(long updatedAt) {
        this.updatedAt = updatedAt;
    }
}
