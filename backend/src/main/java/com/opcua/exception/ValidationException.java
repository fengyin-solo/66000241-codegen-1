package com.opcua.exception;

import com.opcua.model.ValidationError;

import java.util.List;

/**
 * 采集方案校验失败：整份配置不允许保存，并逐项指出越界的节点与字段
 */
public class ValidationException extends RuntimeException {

    private final transient List<ValidationError> errors;

    public ValidationException(List<ValidationError> errors) {
        super("采集配置校验失败，共 " + errors.size() + " 项不合法");
        this.errors = errors;
    }

    public List<ValidationError> getErrors() {
        return errors;
    }
}
