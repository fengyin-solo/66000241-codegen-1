import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  OPCUANode,
  DataValue,
  AlarmEvent,
  SubscriptionConfig,
  CollectionScheme,
  CollectionNodeConfig,
  CollectionValidationError,
  SchemeActivationResult,
  SchemeNodeResult,
  EffectiveSubscription
} from '../types'
import { DEFAULT_SUBSCRIPTION, validateScheme } from '../config/collection'

const LS_SCHEMES = 'opcua_collection_schemes'
const LS_ACTIVE_SCHEME = 'opcua_active_scheme'
const LS_PENDING = 'opcua_pending_nodes'
const LS_MANUAL_SUBS = 'opcua_manual_subscriptions'

export interface ConnectionEvent {
  flapped: string[]
  recovered: string[]
  recoveredPending: string[]
}

export const useOpcuaStore = defineStore('opcua', () => {
  // 状态
  const nodeTree = ref<OPCUANode[]>([])
  const selectedNode = ref<OPCUANode | null>(null)
  const alarms = ref<AlarmEvent[]>([])
  const realTimeData = ref<Map<string, DataValue>>(new Map())
  const isConnected = ref(false)
  const dataHistory = ref<Map<string, Array<{ timestamp: number; value: number }>>>(new Map())

  // 采集方案状态
  const schemes = ref<CollectionScheme[]>([])
  const activeSchemeId = ref<string | null>(null)
  /** 方案启用时连接异常、待连接恢复后生效的节点 */
  const pendingNodes = ref<Set<string>>(new Set())
  /** 单点订阅（原有入口），持久化保留 */
  const manualSubscriptions = ref<Map<string, SubscriptionConfig>>(new Map())

  // 连接异常模拟（不持久化，刷新后全部恢复可达）
  const unreachableNodes = ref<Set<string>>(new Set())
  const manualOfflineNodes = new Set<string>()
  let flapAccumulator = 0

  // 初始化模拟节点树
  function initNodeTree() {
    nodeTree.value = [
      {
        id: 'server',
        name: 'Server',
        nodeId: 'ns=0;i=2253',
        type: 'Object',
        description: 'OPC-UA 服务器根节点',
        children: [
          {
            id: 'objects',
            name: 'Objects',
            nodeId: 'ns=0;i=85',
            type: 'Object',
            description: '对象文件夹',
            children: [
              {
                id: 'plc_area1',
                name: 'PLC_Area1',
                nodeId: 'ns=2;i=1001',
                type: 'Object',
                description: '1号生产区域 PLC',
                children: [
                  {
                    id: 'temp_sensor',
                    name: 'Temperature_Sensor',
                    nodeId: 'ns=2;i=1002',
                    type: 'Variable',
                    dataType: 'Double',
                    value: 25.6,
                    unit: '°C',
                    quality: 'Good',
                    description: '温度传感器'
                  },
                  {
                    id: 'pressure_transmitter',
                    name: 'Pressure_Transmitter',
                    nodeId: 'ns=2;i=1003',
                    type: 'Variable',
                    dataType: 'Double',
                    value: 3.45,
                    unit: 'MPa',
                    quality: 'Good',
                    description: '压力变送器'
                  },
                  {
                    id: 'pump_status',
                    name: 'Pump_Status',
                    nodeId: 'ns=2;i=1004',
                    type: 'Variable',
                    dataType: 'Boolean',
                    value: true,
                    quality: 'Good',
                    description: '泵运行状态'
                  }
                ]
              },
              {
                id: 'plc_area2',
                name: 'PLC_Area2',
                nodeId: 'ns=2;i=2001',
                type: 'Object',
                description: '2号生产区域 PLC',
                children: [
                  {
                    id: 'flow_meter',
                    name: 'Flow_Meter',
                    nodeId: 'ns=2;i=2002',
                    type: 'Variable',
                    dataType: 'Double',
                    value: 156.7,
                    unit: 'L/min',
                    quality: 'Good',
                    description: '流量计'
                  },
                  {
                    id: 'valve_position',
                    name: 'Valve_Position',
                    nodeId: 'ns=2;i=2003',
                    type: 'Variable',
                    dataType: 'Double',
                    value: 75,
                    unit: '%',
                    quality: 'Good',
                    description: '阀门开度'
                  },
                  {
                    id: 'motor_speed',
                    name: 'Motor_Speed',
                    nodeId: 'ns=2;i=2004',
                    type: 'Variable',
                    dataType: 'Int32',
                    value: 1480,
                    unit: 'RPM',
                    quality: 'Good',
                    description: '电机转速'
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }

  // 模拟实时数据更新
  function simulateDataUpdate() {
    const nodes = getAllVariableNodes()
    nodes.forEach(node => {
      // 连接异常的节点不刷新数据，质量码置为 Bad
      if (unreachableNodes.value.has(node.id)) {
        node.quality = 'Bad'
        return
      }

      const currentValue = realTimeData.value.get(node.id)?.value ?? node.value

      let newValue: number | boolean | string
      if (node.dataType === 'Double') {
        const numVal = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue))
        const variation = (Math.random() - 0.5) * 2
        newValue = Math.round((numVal + variation) * 100) / 100
      } else if (node.dataType === 'Int32') {
        const numVal = typeof currentValue === 'number' ? currentValue : parseInt(String(currentValue))
        const variation = Math.floor((Math.random() - 0.5) * 10)
        newValue = numVal + variation
      } else if (node.dataType === 'Boolean') {
        newValue = Math.random() > 0.95 ? !currentValue : currentValue
      } else {
        newValue = currentValue
      }

      const dataValue: DataValue = {
        nodeId: node.nodeId,
        value: newValue,
        quality: Math.random() > 0.98 ? 'Uncertain' : 'Good',
        timestamp: Date.now(),
        sourceTimestamp: Date.now(),
        serverTimestamp: Date.now()
      }

      realTimeData.value.set(node.id, dataValue)
      node.value = newValue
      node.quality = dataValue.quality

      // 记录历史数据
      const history = dataHistory.value.get(node.id) || []
      history.push({ timestamp: Date.now(), value: typeof newValue === 'number' ? newValue : 0 })
      if (history.length > 100) history.shift()
      dataHistory.value.set(node.id, history)

      // 检查报警条件
      checkAlarms(node, newValue)
    })
  }

  // 检查报警
  function checkAlarms(node: OPCUANode, value: number | boolean | string) {
    if (node.id === 'temp_sensor' && typeof value === 'number' && value > 28) {
      addAlarm({
        nodeId: node.nodeId,
        nodeName: node.name,
        severity: 'High',
        message: `温度过高: ${value}°C (阈值: 28°C)`,
        value,
        threshold: 28
      })
    }
    if (node.id === 'pressure_transmitter' && typeof value === 'number' && value > 4.0) {
      addAlarm({
        nodeId: node.nodeId,
        nodeName: node.name,
        severity: 'Critical',
        message: `压力超限: ${value} MPa (阈值: 4.0 MPa)`,
        value,
        threshold: 4.0
      })
    }
    if (node.id === 'motor_speed' && typeof value === 'number' && value > 1550) {
      addAlarm({
        nodeId: node.nodeId,
        nodeName: node.name,
        severity: 'Medium',
        message: `电机转速偏高: ${value} RPM (阈值: 1550 RPM)`,
        value,
        threshold: 1550
      })
    }
  }

  // 添加报警
  function addAlarm(alarm: Omit<AlarmEvent, 'id' | 'timestamp' | 'acknowledged'>) {
    const newAlarm: AlarmEvent = {
      ...alarm,
      id: `alarm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      acknowledged: false
    }
    alarms.value.unshift(newAlarm)
    if (alarms.value.length > 50) alarms.value.pop()
  }

  // 获取所有变量节点
  function getAllVariableNodes(): OPCUANode[] {
    const variables: OPCUANode[] = []
    function traverse(nodes: OPCUANode[]) {
      nodes.forEach(node => {
        if (node.type === 'Variable') {
          variables.push(node)
        }
        if (node.children) {
          traverse(node.children)
        }
      })
    }
    traverse(nodeTree.value)
    return variables
  }

  function findNodeById(id: string): OPCUANode | undefined {
    function search(nodes: OPCUANode[]): OPCUANode | undefined {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = search(node.children)
          if (found) return found
        }
      }
      return undefined
    }
    return search(nodeTree.value)
  }

  function nodeNameOf(id: string): string | undefined {
    return findNodeById(id)?.name
  }

  // 选择节点
  function selectNode(node: OPCUANode) {
    selectedNode.value = node
  }

  // ---- 采集方案：保存（整单校验，任一不合法整单拒绝） ----

  function saveScheme(draft: {
    id?: string
    name: string
    description?: string
    nodes: CollectionNodeConfig[]
  }): CollectionScheme {
    const errors = validateScheme(
      draft,
      id => !!findNodeById(id),
      id => nodeNameOf(id)
    )
    if (errors.length > 0) {
      throw errors
    }

    if (draft.id) {
      const scheme = schemes.value.find(s => s.id === draft.id)
      if (!scheme) throw new Error('采集方案不存在')
      scheme.name = draft.name
      scheme.description = draft.description
      scheme.nodes = draft.nodes.map(n => ({ ...n }))
      scheme.updatedAt = Date.now()
      // 已生效方案保存后按新参数重新应用，仍异常的节点继续待生效
      if (activeSchemeId.value === scheme.id) {
        const covered = new Set(scheme.nodes.map(n => n.nodeId))
        pendingNodes.value.forEach(id => {
          if (!covered.has(id)) pendingNodes.value.delete(id)
        })
        scheme.nodes.forEach(n => {
          if (unreachableNodes.value.has(n.nodeId)) {
            pendingNodes.value.add(n.nodeId)
          } else {
            pendingNodes.value.delete(n.nodeId)
          }
        })
      }
      persist()
      return scheme
    }

    const now = Date.now()
    const scheme: CollectionScheme = {
      id: `scheme_${now}_${Math.random().toString(36).substr(2, 9)}`,
      name: draft.name.trim(),
      description: draft.description,
      nodes: draft.nodes.map(n => ({ ...n })),
      active: false,
      createdAt: now,
      updatedAt: now
    }
    schemes.value.unshift(scheme)
    persist()
    return scheme
  }

  function deleteScheme(id: string) {
    const scheme = schemes.value.find(s => s.id === id)
    if (!scheme) return
    if (activeSchemeId.value === id) {
      deactivateScheme(id)
    }
    schemes.value = schemes.value.filter(s => s.id !== id)
    persist()
  }

  // ---- 启用 / 停用：按节点逐条反馈 ----

  function activateScheme(id: string): SchemeActivationResult {
    const scheme = schemes.value.find(s => s.id === id)
    if (!scheme) throw new Error('采集方案不存在')

    if (activeSchemeId.value && activeSchemeId.value !== id) {
      deactivateScheme(activeSchemeId.value)
    }

    const results: SchemeNodeResult[] = scheme.nodes.map(cfg => {
      const name = nodeNameOf(cfg.nodeId) ?? null
      if (unreachableNodes.value.has(cfg.nodeId)) {
        pendingNodes.value.add(cfg.nodeId)
        return {
          nodeId: cfg.nodeId,
          nodeName: name,
          status: 'pending',
          message: '节点连接异常，配置将在连接恢复后自动生效'
        }
      }
      pendingNodes.value.delete(cfg.nodeId)
      return {
        nodeId: cfg.nodeId,
        nodeName: name,
        status: 'success',
        message: `已生效：采样 ${cfg.samplingInterval}ms / 发布 ${cfg.publishingInterval}ms / 队列上限 ${cfg.queueSize}`
      }
    })

    activeSchemeId.value = id
    scheme.active = true
    scheme.updatedAt = Date.now()
    persist()

    return { schemeId: scheme.id, schemeName: scheme.name, active: true, results }
  }

  function deactivateScheme(id: string) {
    const scheme = schemes.value.find(s => s.id === id)
    if (scheme) {
      scheme.active = false
      scheme.nodes.forEach(n => pendingNodes.value.delete(n.nodeId))
    }
    if (activeSchemeId.value === id) {
      activeSchemeId.value = null
    }
    persist()
  }

  /** 对待生效节点重新下发 */
  function retryPending(): SchemeActivationResult | null {
    const scheme = activeSchemeId.value ? schemes.value.find(s => s.id === activeSchemeId.value) : undefined
    if (!scheme) return null

    const results: SchemeNodeResult[] = scheme.nodes
      .filter(n => pendingNodes.value.has(n.nodeId))
      .map(cfg => {
        const name = nodeNameOf(cfg.nodeId) ?? null
        if (unreachableNodes.value.has(cfg.nodeId)) {
          return {
            nodeId: cfg.nodeId,
            nodeName: name,
            status: 'pending' as const,
            message: '节点连接异常，配置将在连接恢复后自动生效'
          }
        }
        pendingNodes.value.delete(cfg.nodeId)
        return {
          nodeId: cfg.nodeId,
          nodeName: name,
          status: 'success' as const,
          message: `已生效：采样 ${cfg.samplingInterval}ms / 发布 ${cfg.publishingInterval}ms / 队列上限 ${cfg.queueSize}`
        }
      })

    persist()
    return { schemeId: scheme.id, schemeName: scheme.name, active: true, results }
  }

  // ---- 单点订阅（原有入口保持原样，与方案共用同一份参数标准） ----

  function addSubscription(nodeId: string, config: Partial<SubscriptionConfig> = {}) {
    const subscription: SubscriptionConfig = {
      nodeId,
      publishingInterval: config.publishingInterval || DEFAULT_SUBSCRIPTION.publishingInterval,
      samplingInterval: config.samplingInterval || DEFAULT_SUBSCRIPTION.samplingInterval,
      queueSize: config.queueSize || DEFAULT_SUBSCRIPTION.queueSize,
      discardOldest: config.discardOldest ?? true,
      enabled: true
    }
    manualSubscriptions.value.set(nodeId, subscription)
    persist()
  }

  function removeSubscription(nodeId: string) {
    manualSubscriptions.value.delete(nodeId)
    persist()
  }

  // ---- 生效参数视图（节点详情展示“当前周期来自哪份配置”） ----

  const activeScheme = computed<CollectionScheme | null>(
    () => schemes.value.find(s => s.id === activeSchemeId.value) ?? null
  )

  function schemeConfigOf(nodeId: string): CollectionNodeConfig | null {
    const scheme = activeScheme.value
    if (!scheme) return null
    return scheme.nodes.find(n => n.nodeId === nodeId) ?? null
  }

  /** 当前节点是否处于采集/订阅状态（方案覆盖或单点订阅） */
  function isSubscribedNode(nodeId: string): boolean {
    return !!schemeConfigOf(nodeId) || manualSubscriptions.value.has(nodeId)
  }

  /** 节点当前生效参数；未订阅返回 null */
  function getEffectiveSubscription(nodeId: string): EffectiveSubscription | null {
    const schemeCfg = schemeConfigOf(nodeId)
    if (schemeCfg) {
      return {
        nodeId,
        samplingInterval: schemeCfg.samplingInterval,
        publishingInterval: schemeCfg.publishingInterval,
        queueSize: schemeCfg.queueSize,
        source: 'scheme',
        sourceSchemeId: activeScheme.value!.id,
        sourceSchemeName: activeScheme.value!.name,
        pending: pendingNodes.value.has(nodeId),
        subscribed: true
      }
    }
    const manual = manualSubscriptions.value.get(nodeId)
    if (manual) {
      return {
        nodeId,
        samplingInterval: manual.samplingInterval,
        publishingInterval: manual.publishingInterval,
        queueSize: manual.queueSize,
        source: 'manual',
        sourceSchemeId: null,
        sourceSchemeName: null,
        pending: false,
        subscribed: true
      }
    }
    return null
  }

  /**
   * 兼容原有 store.subscriptions Map 的只读视图
   */
  const subscriptions = computed<Map<string, SubscriptionConfig>>(() => {
    const map = new Map<string, SubscriptionConfig>()
    manualSubscriptions.value.forEach((cfg, id) => map.set(id, cfg))
    activeScheme.value?.nodes.forEach(n => {
      map.set(n.nodeId, {
        nodeId: n.nodeId,
        publishingInterval: n.publishingInterval,
        samplingInterval: n.samplingInterval,
        queueSize: n.queueSize,
        discardOldest: true,
        enabled: !pendingNodes.value.has(n.nodeId)
      })
    })
    return map
  })

  // ---- 节点连通性模拟（连接异常 → 待生效） ----

  function isNodeReachable(nodeId: string): boolean {
    return !unreachableNodes.value.has(nodeId)
  }

  /**
   * 手动设置节点连接状态（演示断连/恢复）。
   * 恢复时若该节点有待生效配置，自动补发。
   */
  function setNodeReachable(nodeId: string, reachable: boolean): string[] {
    if (reachable) {
      const wasUnreachable = unreachableNodes.value.delete(nodeId)
      manualOfflineNodes.delete(nodeId)
      const recoveredPending: string[] = []
      if (wasUnreachable && pendingNodes.value.has(nodeId) && schemeConfigOf(nodeId)) {
        pendingNodes.value.delete(nodeId)
        recoveredPending.push(nodeId)
        persist()
      }
      return recoveredPending
    }
    unreachableNodes.value.add(nodeId)
    manualOfflineNodes.add(nodeId)
    return []
  }

  /**
   * 标记节点为自然发生的连接异常（区别于手动断连）：可被自动恢复机制恢复。
   * 供测试及连接异常演示使用。
   */
  function markNodeUnreachable(nodeId: string) {
    if (!findNodeById(nodeId)) return
    unreachableNodes.value.add(nodeId)
    manualOfflineNodes.delete(nodeId)
  }

  /**
   * 每秒调用：模拟偶发连接抖动与自动恢复，恢复后自动补发待生效配置
   */
  function reconcileConnections(): ConnectionEvent {
    const flapped: string[] = []
    const recovered: string[] = []
    const recoveredPending: string[] = []

    // 偶发抖动（约每 100 个变量 tick 一次，人为离线的节点不受影响）
    flapAccumulator += 1
    const variables = getAllVariableNodes().map(n => n.id)
    if (flapAccumulator >= 100) {
      flapAccumulator = 0
      const candidates = variables.filter(
        id => !manualOfflineNodes.has(id) && !unreachableNodes.value.has(id)
      )
      if (candidates.length > 0) {
        const target = candidates[Math.floor(Math.random() * candidates.length)]
        unreachableNodes.value.add(target)
        flapped.push(target)
      }
    }

    // 非人为离线的异常节点按概率恢复
    unreachableNodes.value.forEach(id => {
      if (!manualOfflineNodes.has(id) && Math.random() > 0.7) {
        unreachableNodes.value.delete(id)
        recovered.push(id)
        if (pendingNodes.value.has(id) && schemeConfigOf(id)) {
          pendingNodes.value.delete(id)
          recoveredPending.push(id)
        }
      }
    })

    if (recoveredPending.length > 0) persist()
    return { flapped, recovered, recoveredPending }
  }

  // ---- 持久化（刷新后保留） ----

  function persist() {
    try {
      localStorage.setItem(LS_SCHEMES, JSON.stringify(schemes.value))
      localStorage.setItem(LS_ACTIVE_SCHEME, JSON.stringify(activeSchemeId.value))
      localStorage.setItem(LS_PENDING, JSON.stringify([...pendingNodes.value]))
      localStorage.setItem(LS_MANUAL_SUBS, JSON.stringify([...manualSubscriptions.value.entries()]))
    } catch (e) {
      // localStorage 不可用时静默降级为内存态
    }
  }

  function restore() {
    try {
      const rawSchemes = localStorage.getItem(LS_SCHEMES)
      if (rawSchemes) {
        schemes.value = JSON.parse(rawSchemes)
      }
      activeSchemeId.value = JSON.parse(localStorage.getItem(LS_ACTIVE_SCHEME) || 'null')
      const pending = JSON.parse(localStorage.getItem(LS_PENDING) || '[]') as string[]
      pendingNodes.value = new Set(pending)
      const manualEntries = JSON.parse(localStorage.getItem(LS_MANUAL_SUBS) || '[]') as [string, SubscriptionConfig][]
      manualSubscriptions.value = new Map(manualEntries)
    } catch (e) {
      // 持久化数据损坏时以空配置启动
    }
  }

  /**
   * 节点树就绪后重新应用生效方案：
   * 可达节点立即生效（含刷新前待生效、当前已恢复的节点）；仍处于连接异常的节点继续保留为待生效
   */
  function reapplyActiveScheme() {
    const scheme = activeScheme.value
    if (!scheme) {
      pendingNodes.value.clear()
      return
    }
    scheme.active = true
    const covered = new Set(scheme.nodes.map(n => n.nodeId))
    scheme.nodes.forEach(n => {
      if (unreachableNodes.value.has(n.nodeId)) {
        pendingNodes.value.add(n.nodeId)
      } else {
        pendingNodes.value.delete(n.nodeId)
      }
    })
    // 清理已不在方案中或已删除方案的残留
    pendingNodes.value.forEach(id => {
      if (!covered.has(id)) pendingNodes.value.delete(id)
    })
  }

  // 确认报警
  function acknowledgeAlarm(alarmId: string) {
    const alarm = alarms.value.find(a => a.id === alarmId)
    if (alarm) {
      alarm.acknowledged = true
    }
  }

  // 清空报警
  function clearAlarms() {
    alarms.value = []
  }

  // 连接模拟
  function connect() {
    isConnected.value = true
    initNodeTree()
    reapplyActiveScheme()
  }

  // 断开连接
  function disconnect() {
    isConnected.value = false
  }

  // 计算属性
  const activeAlarmsCount = computed(() => alarms.value.filter(a => !a.acknowledged).length)
  const criticalAlarmsCount = computed(() => alarms.value.filter(a => a.severity === 'Critical' && !a.acknowledged).length)
  const pendingNodeList = computed(() =>
    activeScheme.value?.nodes.filter(n => pendingNodes.value.has(n.nodeId)) ?? []
  )

  return {
    // 状态
    nodeTree,
    selectedNode,
    subscriptions,
    alarms,
    realTimeData,
    isConnected,
    dataHistory,
    schemes,
    activeSchemeId,
    activeScheme,
    pendingNodes,
    pendingNodeList,
    unreachableNodes,
    manualSubscriptions,
    // 方法
    initNodeTree,
    simulateDataUpdate,
    reconcileConnections,
    selectNode,
    findNodeById,
    nodeNameOf,
    getAllVariableNodes,
    saveScheme,
    deleteScheme,
    activateScheme,
    deactivateScheme,
    retryPending,
    addSubscription,
    removeSubscription,
    isSubscribedNode,
    getEffectiveSubscription,
    schemeConfigOf,
    isNodeReachable,
    setNodeReachable,
    markNodeUnreachable,
    restore,
    reapplyActiveScheme,
    acknowledgeAlarm,
    clearAlarms,
    connect,
    disconnect,
    // 计算属性
    activeAlarmsCount,
    criticalAlarmsCount
  }
})
