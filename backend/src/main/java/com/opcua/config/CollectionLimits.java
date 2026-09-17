package com.opcua.config;

/**
 * 采集参数取值范围（系统级约束）
 * 采集方案保存与单点订阅共用同一份参数标准
 */
public final class CollectionLimits {

    private CollectionLimits() {
    }

    /** 采样周期（毫秒）允许范围 */
    public static final int MIN_SAMPLING_INTERVAL = 10;
    public static final int MAX_SAMPLING_INTERVAL = 60_000;

    /** 发布周期（毫秒）允许范围 */
    public static final int MIN_PUBLISHING_INTERVAL = 50;
    public static final int MAX_PUBLISHING_INTERVAL = 60_000;

    /** 队列上限允许范围 */
    public static final int MIN_QUEUE_SIZE = 1;
    public static final int MAX_QUEUE_SIZE = 1_000;

    public static String samplingHint() {
        return "采样周期需在 " + MIN_SAMPLING_INTERVAL + "~" + MAX_SAMPLING_INTERVAL + " ms 之间";
    }

    public static String publishingHint() {
        return "发布周期需在 " + MIN_PUBLISHING_INTERVAL + "~" + MAX_PUBLISHING_INTERVAL + " ms 之间";
    }

    public static String queueHint() {
        return "队列上限需在 " + MIN_QUEUE_SIZE + "~" + MAX_QUEUE_SIZE + " 之间";
    }
}
