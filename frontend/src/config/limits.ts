// 采集参数统一取值范围（采集配置与单点订阅共用同一份标准）
export interface ParamLimit {
  min: number
  max: number
  label: string
  unit: string
}

export interface CollectionLimits {
  samplingInterval: ParamLimit
  publishingInterval: ParamLimit
  queueSize: ParamLimit
}

// 采样周期 / 发布周期单位为 ms，队列上限为条数
export const COLLECTION_LIMITS: CollectionLimits = {
  samplingInterval: { min: 50, max: 60000, label: '采样周期', unit: 'ms' },
  publishingInterval: { min: 100, max: 300000, label: '发布周期', unit: 'ms' },
  queueSize: { min: 1, max: 100, label: '队列上限', unit: '条' }
}

// 系统允许的队列上限
export const MAX_QUEUE_SIZE = COLLECTION_LIMITS.queueSize.max
