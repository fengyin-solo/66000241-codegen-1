import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { OPCUANode, DataValue, AlarmEvent, SubscriptionConfig, CollectionPlan, PlanNodeConfig, ValidationError, ApplyResult, ApplyNodeResult } from '../types'
import { COLLECTION_LIMITS } from '../config/limits'

const PLANS_STORAGE_KEY = 'opcua.collectionPlans'
const SUBSCRIPTIONS_STORAGE_KEY = 'opcua.subscriptions'
const UNREACHABLE_STORAGE_KEY = 'opcua.unreachableNodes'

// 默认订阅参数（单点订阅入口沿用原默认值，且在统一取值范围内）
export const DEFAULT_SUBSCRIPTION = {
  samplingInterval: 500,
  publishingInterval: 1000,
  queueSize: 10,
  discardOldest: true
}

export const useOpcuaStore = defineStore('opcua', () => {
  // 状态
  const nodeTree = ref<OPCUANode[]>([])
  const selectedNode = ref<OPCUANode | null>(null)
  // 采集配置与订阅共用同一份参数存储：nodeId -> 生效中的参数
  const subscriptions = ref<Map<string, SubscriptionConfig>>(new Map())
  // 可复用的采集方案
  const plans = ref<CollectionPlan[]>([])
  // 连接异常的节点（刷新后保留，恢复后自动重试待生效配置）
  const unreachableNodes = ref<Set<string>>(new Set())
  const alarms = ref<AlarmEvent[]>([])
  const realTimeData = ref<Map<string, DataValue>>(new Map())
  const isConnected = ref(false)
  const dataHistory = ref<Map<string, Array<{ timestamp: number; value: number }>>>(new Map())
  let persistenceLoaded = false

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
      // 连接异常节点不产生新数据，质量码置为 Bad
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

  // 按内部 id 查找节点
  function findNodeById(id: string): OPCUANode | null {
    function search(nodes: OPCUANode[]): OPCUANode | null {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = search(node.children)
          if (found) return found
        }
      }
      return null
    }
    return search(nodeTree.value)
  }

  function isNodeReachable(nodeId: string): boolean {
    return !unreachableNodes.value.has(nodeId)
  }

  // 选择节点
  function selectNode(node: OPCUANode) {
    selectedNode.value = node
  }

  // ---------------- 采集方案 ----------------

  // 校验单份方案的全部配置项；任何一项不满足取值范围都会被收集，整份配置拒绝保存
  function validatePlan(name: string, configs: PlanNodeConfig[]): { nameError: string; fieldErrors: ValidationError[] } {
    const fieldErrors: ValidationError[] = []
    const seen = new Set<string>()

    for (const config of configs) {
      const node = findNodeById(config.nodeId)
      const nodeName = node?.name ?? config.nodeId

      if (seen.has(config.nodeId)) {
        fieldErrors.push({ nodeId: config.nodeId, nodeName, field: 'samplingInterval', message: `节点 ${nodeName} 在方案中重复配置` })
      }
      seen.add(config.nodeId)

      checkRange(fieldErrors, config.nodeId, nodeName, 'samplingInterval', config.samplingInterval)
      checkRange(fieldErrors, config.nodeId, nodeName, 'publishingInterval', config.publishingInterval)
      checkRange(fieldErrors, config.nodeId, nodeName, 'queueSize', config.queueSize)
    }

    let nameError = ''
    if (!name.trim()) {
      nameError = '请输入方案名称'
    } else if (plans.value.some(p => p.name === name.trim() && p.id !== editingPlanId)) {
      nameError = '已存在同名方案'
    }
    if (configs.length === 0) {
      fieldErrors.push({ nodeId: '', nodeName: '', field: 'samplingInterval', message: '请至少选择一个节点' })
    }

    return { nameError, fieldErrors }
  }

  // 保存时用于排除自身重名
  let editingPlanId: string | null = null

  function checkRange(errors: ValidationError[], nodeId: string, nodeName: string, field: keyof typeof COLLECTION_LIMITS, value: number) {
    const limit = COLLECTION_LIMITS[field]
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push({ nodeId, nodeName, field, message: `节点 ${nodeName} 的${limit.label}必须填写数值` })
      return
    }
    if (!Number.isInteger(value)) {
      errors.push({ nodeId, nodeName, field, message: `节点 ${nodeName} 的${limit.label}必须为整数` })
      return
    }
    if (value < limit.min || value > limit.max) {
      errors.push({
        nodeId,
        nodeName,
        field,
        message: `节点 ${nodeName} 的${limit.label} ${value}${limit.unit} 超出允许范围 ${limit.min}~${limit.max}${limit.unit}`
      })
    }
  }

  // 保存方案（新增或更新）；校验不通过时整份配置不保存
  function savePlan(input: { id?: string; name: string; description?: string; configs: PlanNodeConfig[] }): { ok: boolean; nameError: string; fieldErrors: ValidationError[] } {
    editingPlanId = input.id ?? null
    const { nameError, fieldErrors } = validatePlan(input.name, input.configs)
    editingPlanId = null

    if (nameError || fieldErrors.length > 0) {
      return { ok: false, nameError, fieldErrors }
    }

    const now = Date.now()
    if (input.id) {
      const plan = plans.value.find(p => p.id === input.id)
      if (plan) {
        const newNodeIds = new Set(input.configs.map(c => c.nodeId))
        // 已启用方案中被移除的节点：撤销该方案此前写入的订阅参数
        if (plan.enabled) {
          plan.configs.forEach(c => {
            if (!newNodeIds.has(c.nodeId)) {
              const sub = subscriptions.value.get(c.nodeId)
              if (sub && sub.source === 'plan' && sub.planId === plan.id) {
                subscriptions.value.delete(c.nodeId)
              }
            }
          })
        }
        plan.name = input.name.trim()
        plan.description = input.description?.trim() || ''
        plan.configs = input.configs.map(c => ({ ...c }))
        plan.updatedAt = now
        // 已启用方案更新后，按最新配置重新生效（连接异常的节点继续待生效）
        if (plan.enabled) {
          applyPlanToSubscriptions(plan)
        }
        persistPlans()
        persistSubscriptions()
        return { ok: true, nameError: '', fieldErrors: [] }
      }
    }

    const plan: CollectionPlan = {
      id: `plan_${now}_${Math.random().toString(36).substr(2, 6)}`,
      name: input.name.trim(),
      description: input.description?.trim() || '',
      configs: input.configs.map(c => ({ ...c })),
      enabled: false,
      createdAt: now,
      updatedAt: now
    }
    plans.value.push(plan)
    persistPlans()
    return { ok: true, nameError: '', fieldErrors: [] }
  }

  // 删除方案：同时移除该方案写入的订阅参数
  function deletePlan(planId: string) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return
    if (plan.enabled) {
      plan.configs.forEach(c => {
        const sub = subscriptions.value.get(c.nodeId)
        if (sub && sub.source === 'plan' && sub.planId === planId) {
          subscriptions.value.delete(c.nodeId)
        }
      })
    }
    plans.value = plans.value.filter(p => p.id !== planId)
    persistPlans()
    persistSubscriptions()
  }

  // 将方案参数写入共享的订阅存储（不改变启用状态）
  function applyPlanToSubscriptions(plan: CollectionPlan) {
    plan.configs.forEach(c => {
      const reachable = isNodeReachable(c.nodeId)
      const sub: SubscriptionConfig = {
        nodeId: c.nodeId,
        publishingInterval: c.publishingInterval,
        samplingInterval: c.samplingInterval,
        queueSize: c.queueSize,
        discardOldest: true,
        enabled: true,
        source: 'plan',
        planId: plan.id,
        status: reachable ? 'applied' : 'pending'
      }
      subscriptions.value.set(c.nodeId, sub)
    })
  }

  // 启用方案：按节点逐条反馈，连接异常的节点单独列为待生效
  function enablePlan(planId: string): ApplyResult {
    const plan = plans.value.find(p => p.id === planId)
    const appliedNodes: ApplyNodeResult[] = []
    const pendingNodeIds: string[] = []

    if (!plan) {
      return { success: false, appliedNodes, pendingNodeIds }
    }

    plan.enabled = true
    plan.configs.forEach(c => {
      const node = findNodeById(c.nodeId)
      const nodeName = node?.name ?? c.nodeId
      const reachable = isNodeReachable(c.nodeId)

      if (reachable) {
        subscriptions.value.set(c.nodeId, {
          nodeId: c.nodeId,
          publishingInterval: c.publishingInterval,
          samplingInterval: c.samplingInterval,
          queueSize: c.queueSize,
          discardOldest: true,
          enabled: true,
          source: 'plan',
          planId: plan.id,
          status: 'applied'
        })
        appliedNodes.push({
          nodeId: c.nodeId,
          nodeName,
          applied: true,
          message: '已生效',
          samplingInterval: c.samplingInterval,
          publishingInterval: c.publishingInterval,
          queueSize: c.queueSize
        })
      } else {
        // 连接异常：参数同样登记，但标记为待生效，连接恢复后自动生效
        subscriptions.value.set(c.nodeId, {
          nodeId: c.nodeId,
          publishingInterval: c.publishingInterval,
          samplingInterval: c.samplingInterval,
          queueSize: c.queueSize,
          discardOldest: true,
          enabled: true,
          source: 'plan',
          planId: plan.id,
          status: 'pending'
        })
        pendingNodeIds.push(c.nodeId)
        appliedNodes.push({
          nodeId: c.nodeId,
          nodeName,
          applied: false,
          message: '节点连接异常，待连接恢复后生效',
          samplingInterval: c.samplingInterval,
          publishingInterval: c.publishingInterval,
          queueSize: c.queueSize
        })
      }
    })

    persistPlans()
    persistSubscriptions()
    return { success: true, appliedNodes, pendingNodeIds }
  }

  // 停用方案：移除该方案写入的订阅参数
  function disablePlan(planId: string) {
    const plan = plans.value.find(p => p.id === planId)
    if (!plan) return
    plan.enabled = false
    plan.configs.forEach(c => {
      const sub = subscriptions.value.get(c.nodeId)
      if (sub && sub.source === 'plan' && sub.planId === planId) {
        subscriptions.value.delete(c.nodeId)
      }
    })
    persistPlans()
    persistSubscriptions()
  }

  // 重试待生效配置（可限定某份方案），返回本次生效的节点名
  function retryPending(planId?: string): string[] {
    const appliedNames: string[] = []
    subscriptions.value.forEach(sub => {
      if (sub.status !== 'pending') return
      if (planId && sub.planId !== planId) return
      if (isNodeReachable(sub.nodeId)) {
        sub.status = 'applied'
        appliedNames.push(findNodeById(sub.nodeId)?.name ?? sub.nodeId)
      }
    })
    if (appliedNames.length > 0) persistSubscriptions()
    return appliedNames
  }

  // 单节点在某份方案下的生效状态
  function planNodeState(plan: CollectionPlan, nodeId: string): 'applied' | 'pending' | 'overridden' | 'none' {
    const sub = subscriptions.value.get(nodeId)
    if (!sub) return 'none'
    if (sub.source === 'plan' && sub.planId === plan.id) {
      return sub.status === 'pending' ? 'pending' : 'applied'
    }
    // 节点当前被另一份方案或手动订阅占用
    return 'overridden'
  }

  // 方案覆盖节点的统计：已生效 / 待生效（连接异常）/ 被其他配置覆盖
  function planStats(plan: CollectionPlan): { applied: number; pending: number; overridden: number; total: number } {
    const stats = { applied: 0, pending: 0, overridden: 0, total: plan.configs.length }
    plan.configs.forEach(c => {
      const state = planNodeState(plan, c.nodeId)
      if (state === 'applied') stats.applied++
      else if (state === 'pending') stats.pending++
      else if (state === 'overridden') stats.overridden++
    })
    return stats
  }

  // 方案是否完全生效（所有覆盖节点均已生效）
  function isPlanEffective(plan: CollectionPlan): boolean {
    if (!plan.enabled) return false
    return planStats(plan).applied === plan.configs.length
  }

  function getPlanName(planId?: string): string {
    if (!planId) return ''
    return plans.value.find(p => p.id === planId)?.name ?? ''
  }

  // ---------------- 单点订阅（原有入口，参数与方案共用同一存储） ----------------

  // 添加订阅
  function addSubscription(nodeId: string, config: Partial<SubscriptionConfig> = {}) {
    const subscription: SubscriptionConfig = {
      nodeId,
      publishingInterval: config.publishingInterval || DEFAULT_SUBSCRIPTION.publishingInterval,
      samplingInterval: config.samplingInterval || DEFAULT_SUBSCRIPTION.samplingInterval,
      queueSize: config.queueSize || DEFAULT_SUBSCRIPTION.queueSize,
      discardOldest: config.discardOldest ?? DEFAULT_SUBSCRIPTION.discardOldest,
      enabled: true,
      source: 'manual',
      status: isNodeReachable(nodeId) ? 'applied' : 'pending'
    }
    subscriptions.value.set(nodeId, subscription)
    persistSubscriptions()
  }

  // 移除订阅
  function removeSubscription(nodeId: string) {
    subscriptions.value.delete(nodeId)
    persistSubscriptions()
  }

  // ---------------- 节点连接状态（模拟） ----------------

  // 设置节点连接是否异常；恢复时自动重试待生效配置
  function setNodeConnectivity(nodeId: string, reachable: boolean): string[] {
    if (reachable) {
      unreachableNodes.value.delete(nodeId)
      persistUnreachable()
      return retryPending()
    }
    unreachableNodes.value.add(nodeId)
    const node = findNodeById(nodeId)
    if (node) node.quality = 'Bad'
    // 该节点上的生效配置转为待生效
    const sub = subscriptions.value.get(nodeId)
    if (sub && sub.status === 'applied') sub.status = 'pending'
    persistUnreachable()
    persistSubscriptions()
    return []
  }

  // ---------------- 报警 ----------------

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

  // ---------------- 连接与持久化 ----------------

  // 连接模拟
  function connect() {
    isConnected.value = true
    initNodeTree()
    loadPersistedState()
    // 重连后尝试让待生效配置生效
    retryPending()
  }

  // 断开连接
  function disconnect() {
    isConnected.value = false
  }

  function persistPlans() {
    try {
      localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(plans.value))
    } catch { /* 忽略持久化失败 */ }
  }

  function persistSubscriptions() {
    try {
      localStorage.setItem(SUBSCRIPTIONS_STORAGE_KEY, JSON.stringify(Array.from(subscriptions.value.entries())))
    } catch { /* 忽略持久化失败 */ }
  }

  function persistUnreachable() {
    try {
      localStorage.setItem(UNREACHABLE_STORAGE_KEY, JSON.stringify(Array.from(unreachableNodes.value)))
    } catch { /* 忽略持久化失败 */ }
  }

  function loadPersistedState() {
    if (persistenceLoaded) return
    persistenceLoaded = true

    try {
      const rawPlans = localStorage.getItem(PLANS_STORAGE_KEY)
      if (rawPlans) {
        plans.value = JSON.parse(rawPlans)
      }
      const rawUnreachable = localStorage.getItem(UNREACHABLE_STORAGE_KEY)
      if (rawUnreachable) {
        unreachableNodes.value = new Set(JSON.parse(rawUnreachable))
      }
      const rawSubs = localStorage.getItem(SUBSCRIPTIONS_STORAGE_KEY)
      if (rawSubs) {
        const entries = JSON.parse(rawSubs) as Array<[string, SubscriptionConfig]>
        // 按当前连接状态重算待生效/已生效
        entries.forEach(([id, sub]) => {
          sub.status = isNodeReachable(id) ? 'applied' : 'pending'
        })
        subscriptions.value = new Map(entries)
      }
    } catch {
      // 持久化数据损坏时以空状态启动
      plans.value = []
    }
  }

  // 计算属性
  const activeAlarmsCount = computed(() => alarms.value.filter(a => !a.acknowledged).length)
  const criticalAlarmsCount = computed(() => alarms.value.filter(a => a.severity === 'Critical' && !a.acknowledged).length)
  // 待生效节点数（连接异常单独统计）
  const pendingNodeCount = computed(() =>
    Array.from(subscriptions.value.values()).filter(s => s.status === 'pending').length
  )
  // 当前已启用方案数
  const enabledPlanCount = computed(() => plans.value.filter(p => p.enabled).length)

  return {
    // 状态
    nodeTree,
    selectedNode,
    subscriptions,
    plans,
    unreachableNodes,
    alarms,
    realTimeData,
    isConnected,
    dataHistory,
    // 方法
    initNodeTree,
    simulateDataUpdate,
    selectNode,
    findNodeById,
    isNodeReachable,
    validatePlan,
    savePlan,
    deletePlan,
    enablePlan,
    disablePlan,
    retryPending,
    planNodeState,
    planStats,
    isPlanEffective,
    getPlanName,
    addSubscription,
    removeSubscription,
    setNodeConnectivity,
    acknowledgeAlarm,
    clearAlarms,
    connect,
    disconnect,
    getAllVariableNodes,
    // 计算属性
    activeAlarmsCount,
    criticalAlarmsCount,
    pendingNodeCount,
    enabledPlanCount
  }
})
