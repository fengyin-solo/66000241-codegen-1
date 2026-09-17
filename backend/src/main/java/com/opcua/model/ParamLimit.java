package com.opcua.model;

/**
 * 采集参数取值范围（采样周期、发布周期、队列上限）
 */
public class ParamLimit {

    private String field;
    private String label;
    private String unit;
    private int min;
    private int max;

    public ParamLimit() {
    }

    public ParamLimit(String field, String label, String unit, int min, int max) {
        this.field = field;
        this.label = label;
        this.unit = unit;
        this.min = min;
        this.max = max;
    }

    public String getField() {
        return field;
    }

    public void setField(String field) {
        this.field = field;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getUnit() {
        return unit;
    }

    public void setUnit(String unit) {
        this.unit = unit;
    }

    public int getMin() {
        return min;
    }

    public void setMin(int min) {
        this.min = min;
    }

    public int getMax() {
        return max;
    }

    public void setMax(int max) {
        this.max = max;
    }
}
