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

// 订阅配置（采集方案与单点订阅共用的参数结构）
export interface SubscriptionConfig {
  nodeId: string
  publishingInterval: number
  samplingInterval: number
  queueSize: number
  discardOldest: boolean
  enabled: boolean
  /** 参数来源：手动单点订阅，或来自某份采集方案 */
  source: 'manual' | 'plan'
  /** 来自采集方案时的方案 id */
  planId?: string
  /** 生效状态：已生效 / 节点连接异常，待生效 */
  status?: 'applied' | 'pending'
}

// 采集方案中单个节点的配置项
export interface PlanNodeConfig {
  nodeId: string
  samplingInterval: number
  publishingInterval: number
  queueSize: number
}

// 采集方案
export interface CollectionPlan {
  id: string
  name: string
  description?: string
  configs: PlanNodeConfig[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

// 方案启用时单节点反馈
export interface ApplyNodeResult {
  nodeId: string
  nodeName: string
  applied: boolean
  message: string
  samplingInterval: number
  publishingInterval: number
  queueSize: number
}

// 方案启用结果：逐条反馈 + 连接异常待生效节点
export interface ApplyResult {
  success: boolean
  appliedNodes: ApplyNodeResult[]
  pendingNodeIds: string[]
}

// 保存校验错误：精确定位到哪个节点的哪一项
export interface ValidationError {
  nodeId: string
  nodeName: string
  field: 'samplingInterval' | 'publishingInterval' | 'queueSize'
  message: string
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
