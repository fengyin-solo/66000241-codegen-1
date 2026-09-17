package com.opcua.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 可复用的节点采集方案
 */
public class CollectionScheme {

    private String id;
    private String name;
    private String description;
    private List<CollectionNodeConfig> nodes = new ArrayList<>();
    private boolean active;        // 当前是否生效
    private long createdAt;
    private long updatedAt;

    public CollectionScheme() {
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

    public List<CollectionNodeConfig> getNodes() {
        return nodes;
    }

    public void setNodes(List<CollectionNodeConfig> nodes) {
        this.nodes = nodes == null ? new ArrayList<>() : nodes;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
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
        this.updatedAt = updated;
    }
}
