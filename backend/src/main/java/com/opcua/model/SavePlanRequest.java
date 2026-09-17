package com.opcua.model;

import java.util.List;

/**
 * 采集方案保存请求
 */
public class SavePlanRequest {

    /** 更新时传入；新增时为空 */
    private String id;
    private String name;
    private String description;
    private List<PlanNodeConfig> configs;

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
}
