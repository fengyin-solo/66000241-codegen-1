// 轻量逻辑测试：校验范围、整单拒绝、启用反馈、待生效、持久化
import { setActivePinia, createPinia } from 'pinia'
import { useOpcuaStore } from './src/store/opcua.ts'

const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear()
}

let pass = 0
let fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.error('  ✗', msg) }
}

setActivePinia(createPinia())
const store = useOpcuaStore()
store.connect()

const base = {
  name: '测试方案',
  configs: [
    { nodeId: 'temp_sensor', samplingInterval: 500, publishingInterval: 1000, queueSize: 10 },
    { nodeId: 'flow_meter', samplingInterval: 1000, publishingInterval: 2000, queueSize: 20 }
  ]
}

console.log('1. 正常保存')
let r = store.savePlan(base)
assert(r.ok, '合法方案保存成功')
const plan = store.plans[0]
assert(plan && !plan.enabled, '新方案默认未启用')

console.log('2. 越界时整份拒绝，并定位到节点+字段')
r = store.savePlan({
  name: '越界方案',
  configs: [
    { nodeId: 'temp_sensor', samplingInterval: 10, publishingInterval: 1000, queueSize: 10 },
    { nodeId: 'flow_meter', samplingInterval: 500, publishingInterval: 500000, queueSize: 200 }
  ]
})
assert(!r.ok, '含越界项的整份配置不保存')
assert(r.fieldErrors.length === 3, `共收集 3 个越界项（实际 ${r.fieldErrors.length}）`)
const byKey = new Set(r.fieldErrors.map(e => `${e.nodeId}:${e.field}`))
assert(byKey.has('temp_sensor:samplingInterval'), '指出 temp_sensor 采样周期越界')
assert(byKey.has('flow_meter:publishingInterval'), '指出 flow_meter 发布周期越界')
assert(byKey.has('flow_meter:queueSize'), '指出 flow_meter 队列上限超系统上限')
assert(store.plans.length === 1, '被拒绝的方案没有落库')

console.log('3. 边界值允许保存')
r = store.savePlan({
  name: '边界方案',
  configs: [
    { nodeId: 'pump_status', samplingInterval: 50, publishingInterval: 100, queueSize: 1 },
    { nodeId: 'motor_speed', samplingInterval: 60000, publishingInterval: 300000, queueSize: 100 }
  ]
})
assert(r.ok, '采样50/发布100/队列1 与 采样60000/发布300000/队列100 均通过')

console.log('4. 启用反馈：正常节点已生效')
const res = store.enablePlan(plan.id)
assert(res.success && res.appliedNodes.length === 2, '逐条反馈 2 个节点')
assert(res.appliedNodes.every(n => n.applied), '连接正常时全部已生效')
assert(res.pendingNodeIds.length === 0, '无待生效节点')
assert(store.isPlanEffective(plan), '方案标记为完全生效')
const sub = store.subscriptions.get('temp_sensor')
assert(sub.source === 'plan' && sub.planId === plan.id, '节点参数来源指向该方案')

console.log('5. 节点连接异常 -> 待生效，恢复后自动生效')
store.setNodeConnectivity('temp_sensor', false)
assert(store.subscriptions.get('temp_sensor').status === 'pending', '异常节点订阅转待生效')
assert(!store.isPlanEffective(plan), '方案不再完全生效')
assert(store.planStats(plan).pending === 1, '待生效计数为 1')
const applied = store.setNodeConnectivity('temp_sensor', true)
assert(applied.includes('Temperature_Sensor'), '恢复连接后待生效配置自动生效')
assert(store.isPlanEffective(plan), '方案恢复完全生效')

console.log('6. 异常节点启用方案：单独列出待生效，可重试')
store.setNodeConnectivity('flow_meter', false)
const res2 = store.enablePlan(plan.id)
assert(res2.pendingNodeIds[0] === 'flow_meter', '连接异常节点单独列为待生效')
const res2Node = res2.appliedNodes.find(n => n.nodeId === 'flow_meter')
assert(res2Node && !res2Node.applied && res2Node.message.includes('连接异常'), '逐条反馈中标注连接异常待生效')
const retried = store.retryPending(plan.id)
assert(retried.length === 0, '仍异常时重试不生效')
store.setNodeConnectivity('flow_meter', true)
assert(store.subscriptions.get('flow_meter').status === 'applied', '恢复连接后配置自动生效')
assert(store.isPlanEffective(plan), '方案恢复完全生效')

console.log('7. 刷新后保留：重新加载 store')
const store2 = useOpcuaStore(createPinia())
store2.connect()
const reloaded = store2.plans.find(p => p.id === plan.id)
assert(reloaded && reloaded.enabled, '方案启用状态刷新后保留')
assert(store2.subscriptions.get('temp_sensor')?.source === 'plan', '订阅参数刷新后保留')
assert(store2.isPlanEffective(reloaded), '生效状态刷新后仍可计算')

console.log('8. 停用与单点订阅')
store.disablePlan(plan.id)
assert(!store.subscriptions.has('temp_sensor'), '停用方案移除其订阅参数')
store.addSubscription('pump_status')
const manual = store.subscriptions.get('pump_status')
assert(manual.source === 'manual' && manual.status === 'applied', '单点订阅入口参数正常，来源 manual')
store.removeSubscription('pump_status')
assert(!store.subscriptions.has('pump_status'), '取消订阅正常')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
