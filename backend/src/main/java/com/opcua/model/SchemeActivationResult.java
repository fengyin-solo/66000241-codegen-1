package com.opcua.model;

import java.util.ArrayList;
import java.util.List;

/**
 * 采集方案启用结果：按节点逐条反馈，连接异常的节点列入 pending
 */
public class SchemeActivationResult {

    private String schemeId;
    private String schemeName;
    private boolean active;
    private List<SchemeNodeResult> results = new ArrayList<>();

    public SchemeActivationResult() {
    }

    public List<SchemeNodeResult> getSuccessResults() {
        List<SchemeNodeResult> list = new ArrayList<>();
        for (SchemeNodeResult r : results) {
            if ("success".equals(r.getStatus())) {
                list.add(r);
            }
        }
        return list;
    }

    public List<SchemeNodeResult> getPendingResults() {
        List<SchemeNodeResult> list = new ArrayList<>();
        for (SchemeNodeResult r : results) {
            if ("pending".equals(r.getStatus())) {
                list.add(r);
            }
        }
        return list;
    }

    public String getSchemeId() {
        return schemeId;
    }

    public void setSchemeId(String schemeId) {
        this.schemeId = schemeId;
    }

    public String getSchemeName() {
        return schemeName;
    }

    public void setSchemeName(String schemeName) {
        this.schemeName = schemeName;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public List<SchemeNodeResult> getResults() {
        return results;
    }

    public void setResults(List<SchemeNodeResult> results) {
        this.results = results == null ? new ArrayList<>() : results;
    }
}
