// OPC-UA 节点类型定义
export interface OPCUANode {
  id: string
  name: string
  nodeId: string
  type: 'Object' | 'Variable' | 'Method' | 'DataType'
  dataType?: string
  value?: any
  unit?: string
  quality?: 'Good' | 'Bad' | 'Uncertain'
  children?: OPCUANode[]
  description?: string
  browseName?: string
}

// 数据值模型
export interface DataValue {
  nodeId: string
  value: number | boolean | string
  quality: 'Good' | 'Bad' | 'Uncertain'
  timestamp: number
  sourceTimestamp?: number
  serverTimestamp?: number
}

// 报警事件
export interface AlarmEvent {
  id: string
  nodeId: string
  nodeName: string
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info'
  message: string
  timestamp: number
  acknowledged: boolean
  value?: number | boolean | string
  threshold?: number
}

// 订阅配置
export interface SubscriptionConfig {
  nodeId: string
  publishingInterval: number
  samplingInterval: number
  queueSize: number
  discardOldest: boolean
  enabled: boolean
}

// 采集方案中单个节点的参数
export interface CollectionNodeConfig {
  nodeId: string
  samplingInterval: number
  publishingInterval: number
  queueSize: number
}

// 可复用的采集方案
export interface CollectionScheme {
  id: string
  name: string
  description?: string
  nodes: CollectionNodeConfig[]
  active: boolean
  createdAt: number
  updatedAt: number
}

// 校验错误：哪个节点的哪一项超出标准
export interface CollectionValidationError {
  nodeId: string | null
  nodeName: string | null
  field: 'samplingInterval' | 'publishingInterval' | 'queueSize' | 'nodeId' | 'name' | 'nodes'
  message: string
}

// 方案启用时单节点反馈
export interface SchemeNodeResult {
  nodeId: string
  nodeName: string | null
  status: 'success' | 'pending'
  message: string
}

// 方案启用结果
export interface SchemeActivationResult {
  schemeId: string
  schemeName: string
  active: boolean
  results: SchemeNodeResult[]
}

// 节点当前生效参数（节点详情展示参数来源）
export interface EffectiveSubscription {
  nodeId: string
  samplingInterval: number | null
  publishingInterval: number | null
  queueSize: number | null
  source: 'scheme' | 'manual' | null
  sourceSchemeId: string | null
  sourceSchemeName: string | null
  pending: boolean
  subscribed: boolean
}

// 参数取值范围
export interface CollectionLimits {
  samplingInterval: { min: number; max: number; hint: string }
  publishingInterval: { min: number; max: number; hint: string }
  queueSize: { min: number; max: number; hint: string }
}

// 历史数据点
export interface HistoryDataPoint {
  timestamp: number
  value: number
  quality: 'Good' | 'Bad' | 'Uncertain'
}

// 节点详情
export interface NodeDetail {
  node: OPCUANode
  currentValue?: DataValue
  history?: HistoryDataPoint[]
  subscriptions?: SubscriptionConfig[]
}
