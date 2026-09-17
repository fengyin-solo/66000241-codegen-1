import type {
  CollectionLimits,
  CollectionNodeConfig,
  CollectionScheme,
  CollectionValidationError
} from '../types'

/**
 * 采集参数取值范围（系统级约束）
 * 采集方案保存与单点订阅共用同一份参数标准；与后端 CollectionLimits 保持一致
 */
export const COLLECTION_LIMITS: CollectionLimits = {
  samplingInterval: { min: 10, max: 60000, hint: '采样周期需在 10~60000 ms 之间' },
  publishingInterval: { min: 50, max: 60000, hint: '发布周期需在 50~60000 ms 之间' },
  queueSize: { min: 1, max: 1000, hint: '队列上限需在 1~1000 之间（系统上限 1000）' }
}

/** 单点订阅默认参数（原入口行为不变） */
export const DEFAULT_SUBSCRIPTION = {
  samplingInterval: 500,
  publishingInterval: 1000,
  queueSize: 10
}

export function isInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

/**
 * 校验单个节点参数；返回该节点所有越界项
 */
export function validateNodeConfig(
  config: CollectionNodeConfig,
  nodeName?: string | null
): CollectionValidationError[] {
  const errors: CollectionValidationError[] = []
  const display = nodeName ? `${nodeName}（${config.nodeId}）` : config.nodeId

  if (!isInteger(config.samplingInterval)
    || config.samplingInterval < COLLECTION_LIMITS.samplingInterval.min
    || config.samplingInterval > COLLECTION_LIMITS.samplingInterval.max) {
    errors.push({
      nodeId: config.nodeId,
      nodeName: nodeName ?? null,
      field: 'samplingInterval',
      message: `节点 [${display}] 的采样周期 ${config.samplingInterval}ms 超出允许范围 ${COLLECTION_LIMITS.samplingInterval.min}~${COLLECTION_LIMITS.samplingInterval.max}ms`
    })
  }
  if (!isInteger(config.publishingInterval)
    || config.publishingInterval < COLLECTION_LIMITS.publishingInterval.min
    || config.publishingInterval > COLLECTION_LIMITS.publishingInterval.max) {
    errors.push({
      nodeId: config.nodeId,
      nodeName: nodeName ?? null,
      field: 'publishingInterval',
      message: `节点 [${display}] 的发布周期 ${config.publishingInterval}ms 超出允许范围 ${COLLECTION_LIMITS.publishingInterval.min}~${COLLECTION_LIMITS.publishingInterval.max}ms`
    })
  }
  if (!isInteger(config.queueSize)
    || config.queueSize < COLLECTION_LIMITS.queueSize.min
    || config.queueSize > COLLECTION_LIMITS.queueSize.max) {
    errors.push({
      nodeId: config.nodeId,
      nodeName: nodeName ?? null,
      field: 'queueSize',
      message: `节点 [${display}] 的队列上限 ${config.queueSize} 超过系统允许的上限 ${COLLECTION_LIMITS.queueSize.max}`
    })
  }
  return errors
}

/**
 * 整份方案校验：方案名、节点重复/缺失、每项取值范围
 * 任一不合法都返回全部错误，整单不允许保存
 */
export function validateScheme(
  scheme: Pick<CollectionScheme, 'name' | 'nodes'>,
  nodeExists: (id: string) => boolean,
  nodeNameOf: (id: string) => string | undefined
): CollectionValidationError[] {
  const errors: CollectionValidationError[] = []

  if (!scheme.name || !scheme.name.trim()) {
    errors.push({ nodeId: null, nodeName: null, field: 'name', message: '方案名称不能为空' })
  }
  if (!scheme.nodes || scheme.nodes.length === 0) {
    errors.push({ nodeId: null, nodeName: null, field: 'nodes', message: '方案至少需要覆盖一个节点' })
    return errors
  }

  const seen = new Set<string>()
  scheme.nodes.forEach(node => {
    if (!node.nodeId) {
      errors.push({ nodeId: null, nodeName: null, field: 'nodeId', message: '存在未选择节点的配置项' })
      return
    }
    if (seen.has(node.nodeId)) {
      errors.push({
        nodeId: node.nodeId,
        nodeName: nodeNameOf(node.nodeId) ?? null,
        field: 'nodeId',
        message: `节点 [${nodeNameOf(node.nodeId) ?? node.nodeId}] 在方案中重复出现`
      })
      return
    }
    seen.add(node.nodeId)
    if (!nodeExists(node.nodeId)) {
      errors.push({
        nodeId: node.nodeId,
        nodeName: null,
        field: 'nodeId',
        message: `节点 [${node.nodeId}] 不存在`
      })
      return
    }
    errors.push(...validateNodeConfig(node, nodeNameOf(node.nodeId)))
  })

  return errors
}
