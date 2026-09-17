// 采集方案模块核心流程冒烟测试（Node 直跑，内存版 localStorage）
import { createPinia, setActivePinia } from 'pinia'

const memStore = new Map()
globalThis.localStorage = {
  getItem: k => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: k => memStore.delete(k),
  clear: () => memStore.clear()
}

const { useOpcuaStore } = await import('./src/store/opcua.ts')
const { COLLECTION_LIMITS, validateScheme } = await import('./src/config/collection.ts')

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name} ${extra}`)
  }
}

setActivePinia(createPinia())
const store = useOpcuaStore()
store.initNodeTree()

const N = {
  temp: 'temp_sensor',
  pressure: 'pressure_transmitter',
  pump: 'pump_status',
  flow: 'flow_meter'
}

// ---------- 1. 越界整单拒绝，并指出节点+字段 ----------
console.log('1) 保存校验')
const badDraft = {
  name: '坏方案',
  nodes: [
    { nodeId: N.temp, samplingInterval: 500, publishingInterval: 1000, queueSize: 10 }, // 合法
    { nodeId: N.pressure, samplingInterval: 5, publishingInterval: 1000, queueSize: 10 }, // 采样过小
    { nodeId: N.pump, samplingInterval: 500, publishingInterval: 10, queueSize: 2000 }, // 发布过小 + 队列超上限
    { nodeId: N.temp, samplingInterval: 500, publishingInterval: 1000, queueSize: 10 }, // 重复节点
    { nodeId: 'ghost', samplingInterval: 500, publishingInterval: 1000, queueSize: 10 } // 不存在
  ]
}
const errors = validateScheme(badDraft, id => !!store.findNodeById(id), id => store.nodeNameOf(id))
check('整份配置未保存', store.schemes.length === 0)
check('采样周期越界被检出', errors.some(e => e.nodeId === N.pressure && e.field === 'samplingInterval'))
check('发布周期越界被检出', errors.some(e => e.nodeId === N.pump && e.field === 'publishingInterval'))
check('队列上限越界被检出', errors.some(e => e.nodeId === N.pump && e.field === 'queueSize'))
check('队列上限错误信息含系统上限', errors.some(e => e.field === 'queueSize' && e.message.includes(String(COLLECTION_LIMITS.queueSize.max))))
check('重复节点被检出', errors.some(e => e.nodeId === N.temp && e.field === 'nodeId'))
check('不存在节点被检出', errors.some(e => e.nodeId === 'ghost' && e.field === 'nodeId'))
check('错误信息含节点名称', errors.some(e => e.message.includes('Pressure_Transmitter')))

const saveWithErrors = () => store.saveScheme(badDraft)
let threw = false
try { saveWithErrors() } catch (e) { threw = Array.isArray(e) }
check('saveScheme 直接抛出错误数组', threw)
check('抛出后仍未保存', store.schemes.length === 0)

// 边界值
const edgeErrors = validateScheme({
  name: '边界',
  nodes: [
    { nodeId: N.temp, samplingInterval: COLLECTION_LIMITS.samplingInterval.min, publishingInterval: COLLECTION_LIMITS.publishingInterval.min, queueSize: COLLECTION_LIMITS.queueSize.min },
    { nodeId: N.pressure, samplingInterval: COLLECTION_LIMITS.samplingInterval.max, publishingInterval: COLLECTION_LIMITS.publishingInterval.max, queueSize: COLLECTION_LIMITS.queueSize.max }
  ]
}, id => !!store.findNodeById(id), id => store.nodeNameOf(id))
check('边界值（min/max 端点）全部合法', edgeErrors.length === 0, JSON.stringify(edgeErrors))

// 空名称 / 空节点
const emptyErrors = validateScheme({ name: '  ', nodes: [] }, () => true, () => undefined)
check('空名称与空节点列表被检出', emptyErrors.some(e => e.field === 'name') && emptyErrors.some(e => e.field === 'nodes'))

// ---------- 2. 合法方案保存 ----------
console.log('2) 合法方案保存')
const scheme = store.saveScheme({
  name: '区域一标准采集',
  description: '测试方案',
  nodes: [
    { nodeId: N.temp, samplingInterval: 500, publishingInterval: 1000, queueSize: 100 },
    { nodeId: N.pressure, samplingInterval: 200, publishingInterval: 500, queueSize: 50 },
    { nodeId: N.pump, samplingInterval: 1000, publishingInterval: 2000, queueSize: 20 }
  ]
})
check('方案已保存', store.schemes.length === 1)
check('新方案默认未生效', !scheme.active && store.activeSchemeId === null)

// ---------- 3. 启用：全部正常时逐节点成功 ----------
console.log('3) 启用反馈')
let result = store.activateScheme(scheme.id)
check('激活结果含 3 个节点', result.results.length === 3)
check('全部 success', result.results.every(r => r.status === 'success'))
check('activeSchemeId 已记录', store.activeSchemeId === scheme.id)
const effTemp = store.getEffectiveSubscription(N.temp)
check('生效参数来自方案', effTemp.source === 'scheme' && effTemp.sourceSchemeName === '区域一标准采集')
check('生效参数值正确', effTemp.samplingInterval === 500 && effTemp.publishingInterval === 1000 && effTemp.queueSize === 100)

// ---------- 4. 断连节点启用时列入待生效 ----------
console.log('4) 连接异常 → 待生效')
store.setNodeReachable(N.pressure, false)
result = store.activateScheme(scheme.id)
const pressureResult = result.results.find(r => r.nodeId === N.pressure)
check('断连节点状态为 pending', pressureResult.status === 'pending')
check('pendingNodes 含断连节点', store.pendingNodes.has(N.pressure))
check('正常节点仍 success', result.results.filter(r => r.status === 'success').length === 2)
const effPressure = store.getEffectiveSubscription(N.pressure)
check('待生效节点标记 pending=true 且仍展示方案参数', effPressure.pending === true && effPressure.source === 'scheme')

// ---------- 5. 重试：仍断连则继续 pending ----------
console.log('5) 待生效重试与自动补发')
const retry1 = store.retryPending()
check('重试结果只含待生效节点', retry1.results.length === 1 && retry1.results[0].nodeId === N.pressure)
check('仍断连时保持 pending', retry1.results[0].status === 'pending')

// ---------- 6. 连接恢复后自动补发 ----------
const recovered = store.setNodeReachable(N.pressure, true)
check('手动恢复返回待补发节点', recovered.includes(N.pressure))
check('恢复后 pending 被清除', !store.pendingNodes.has(N.pressure))
check('恢复后生效参数仍来自方案', store.getEffectiveSubscription(N.pressure).pending === false)

// 自动恢复路径（reconcileConnections）：自然发生的断连（非人为）会被自动恢复并补发
store.activateScheme(scheme.id)
const flapId = N.pump
store.markNodeUnreachable(flapId) // 自然异常：未加入 manualOffline
store.activateScheme(scheme.id)
check('自然连接异常节点列入待生效', flapId && store.pendingNodes.has(flapId))
let autoRecovered = []
for (let i = 0; i < 100 && autoRecovered.length === 0; i++) {
  autoRecovered = store.reconcileConnections().recoveredPending
}
check('模拟自动恢复后补发待生效配置', autoRecovered.includes(flapId) && !store.pendingNodes.has(flapId))
check('人为断连节点不会自动恢复', (() => {
  store.setNodeReachable(N.temp, false)
  store.activateScheme(scheme.id)
  for (let i = 0; i < 30; i++) store.reconcileConnections()
  const stillPending = store.pendingNodes.has(N.temp)
  store.setNodeReachable(N.temp, true) // 手动恢复
  return stillPending
})())

// ---------- 7. 单点订阅与方案共用参数、原入口行为 ----------
console.log('7) 单点订阅')
store.addSubscription(N.flow) // 默认参数
check('非方案节点显示 manual 来源', store.getEffectiveSubscription(N.flow)?.source === 'manual')
check('原 isSubscribedNode 语义（方案或手动）', store.isSubscribedNode(N.flow) && store.isSubscribedNode(N.temp))
// 方案覆盖节点：手动订阅记录存在但展示以方案优先
store.removeSubscription(N.flow)
check('取消手动订阅后无生效参数', store.getEffectiveSubscription(N.flow) === null)
check('方案覆盖节点取消手动订阅不影响方案参数', store.getEffectiveSubscription(N.temp)?.source === 'scheme')

// ---------- 8. 刷新后持久化恢复 ----------
console.log('8) 持久化')
check('方案已写入 localStorage', JSON.parse(memStore.get('opcua_collection_schemes')).length === 1)
check('activeSchemeId 已持久化', JSON.parse(memStore.get('opcua_active_scheme')) === scheme.id)

setActivePinia(createPinia())
const store2 = useOpcuaStore()
store2.restore()
store2.initNodeTree()
store2.reapplyActiveScheme()
check('刷新后方案保留', store2.schemes.length === 1 && store2.schemes[0].name === '区域一标准采集')
check('刷新后仍标记为生效', store2.activeSchemeId === scheme.id && store2.schemes[0].active)
check('刷新后节点参数仍来自该方案', store2.getEffectiveSubscription(N.temp)?.sourceSchemeId === scheme.id)

// 刷新时若节点处于断连，应恢复为待生效
store2.setNodeReachable(N.temp, false)
setActivePinia(createPinia())
const store3 = useOpcuaStore()
store3.restore() // 此时 nodeTree 为空；模拟刷新时断连状态不持久化，全部可达 → 应自动补发
store3.initNodeTree()
store3.reapplyActiveScheme()
check('刷新后节点可达时待生效自动清除（补发）', !store3.pendingNodes.has(N.temp))

// ---------- 9. 停用 / 删除 ----------
console.log('9) 停用与删除')
store3.deactivateScheme(scheme.id)
check('停用后 activeSchemeId 清空', store3.activeSchemeId === null && !store3.schemes[0].active)
check('停用后方案节点无生效参数', store3.getEffectiveSubscription(N.temp) === null)
store3.deleteScheme(scheme.id)
check('删除后方案消失', store3.schemes.length === 0)

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
