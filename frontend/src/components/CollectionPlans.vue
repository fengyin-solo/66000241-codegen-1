<template>
  <el-dialog
    v-model="visible"
    title="节点采集方案"
    width="900px"
    top="6vh"
    custom-class="plan-dialog"
    @closed="handleClosed"
  >
    <!-- ============ 方案列表视图 ============ -->
    <div v-if="mode === 'list'">
      <div class="toolbar">
        <div class="toolbar-tip">
          采样周期 {{ limits.samplingInterval.min }}~{{ limits.samplingInterval.max }} ms，
          发布周期 {{ limits.publishingInterval.min }}~{{ limits.publishingInterval.max }} ms，
          队列上限 ≤ {{ limits.queueSize.max }} 条；任一项越界整份方案不可保存
        </div>
        <el-button type="primary" size="small" @click="openCreate">
          <el-icon class="mr-1"><Plus /></el-icon>新建方案
        </el-button>
      </div>

      <el-table :data="store.plans" class="dark-table" empty-text="暂无采集方案，点击右上角新建" size="small">
        <el-table-column label="方案名称" min-width="130">
          <template #default="{ row }">
            <span class="text-cyan-300 font-bold">{{ row.name }}</span>
            <div v-if="row.description" class="text-xs text-slate-400 mt-0.5">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="覆盖节点" min-width="220">
          <template #default="{ row }">
            <div class="node-tags">
              <el-tag
                v-for="c in row.configs"
                :key="c.nodeId"
                size="small"
                :type="stateTagType(row, c.nodeId)"
                effect="plain"
                class="node-tag"
              >
                {{ nodeName(c.nodeId) }}{{ stateSuffix(row, c.nodeId) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="生效状态" width="140">
          <template #default="{ row }">
            <el-tag v-if="!row.enabled" type="info" size="small" effect="dark">未启用</el-tag>
            <el-tag v-else-if="store.isPlanEffective(row)" type="success" size="small" effect="dark">
              <el-icon class="mr-0.5"><CircleCheckFilled /></el-icon>已生效
            </el-tag>
            <template v-else>
              <el-tag type="warning" size="small" effect="dark">
                <el-icon class="mr-0.5"><WarningFilled /></el-icon>{{ store.planStats(row).pending }} 个待生效
              </el-tag>
              <el-tag
                v-if="store.planStats(row).overridden > 0"
                type="info"
                size="small"
                effect="plain"
                class="ml-1"
              >{{ store.planStats(row).overridden }} 个被覆盖</el-tag>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230">
          <template #default="{ row }">
            <el-button
              v-if="!row.enabled"
              type="success"
              size="small"
              text
              @click="handleEnable(row)"
            >启用</el-button>
            <el-button v-else type="warning" size="small" text @click="store.disablePlan(row.id)">停用</el-button>
            <el-button
              v-if="row.enabled && store.planStats(row).pending > 0"
              type="primary"
              size="small"
              text
              @click="openResult(row)"
            >反馈{{ pendingCount(row) }}</el-button>
            <el-button size="small" text @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="删除方案将同时停用其订阅，确认删除？" @confirm="store.deletePlan(row.id)">
              <template #reference>
                <el-button type="danger" size="small" text>删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="store.pendingNodeCount > 0" class="global-pending">
        <el-icon class="text-yellow-400"><WarningFilled /></el-icon>
        当前有 {{ store.pendingNodeCount }} 个节点因连接异常配置待生效，连接恢复后可自动生效
      </div>
    </div>

    <!-- ============ 方案编辑视图 ============ -->
    <div v-else-if="mode === 'edit'">
      <el-form label-width="80px" class="plan-form">
        <el-form-item label="方案名称" :error="formErrors.nameError">
          <el-input v-model="form.name" placeholder="例如：区域一高频采集" size="small" maxlength="30" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" placeholder="可选" size="small" maxlength="80" />
        </el-form-item>
        <el-form-item label="覆盖节点">
          <el-checkbox-group v-model="selectedNodeIds" class="node-check-group">
            <el-checkbox
              v-for="n in store.getAllVariableNodes()"
              :key="n.id"
              :value="n.id"
              class="node-check"
            >
              {{ n.name }}
              <span class="text-xs text-slate-500">({{ n.nodeId }})</span>
              <el-tag v-if="!store.isNodeReachable(n.id)" type="danger" size="small" effect="plain" class="ml-1">连接异常</el-tag>
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>

      <div v-if="formErrors.fieldErrors.length > 0" class="error-box">
        <div class="error-box-title">
          <el-icon><CircleCloseFilled /></el-icon>
          以下项目不满足取值范围，整份配置未保存：
        </div>
        <div v-for="(e, i) in formErrors.fieldErrors" :key="i" class="error-line">
          <el-tag size="small" type="danger" effect="plain">{{ fieldLabel(e.field) }}</el-tag>
          {{ e.message }}
        </div>
      </div>

      <el-table :data="rows" class="dark-table mt-2" size="small">
        <el-table-column label="节点" min-width="180">
          <template #default="{ row }">
            {{ nodeName(row.nodeId) }}
            <el-tag v-if="!store.isNodeReachable(row.nodeId)" type="danger" size="small" effect="plain" class="ml-1">连接异常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="采样周期 (ms)" width="200">
          <template #default="{ row }">
            <el-input-number
              v-model="row.samplingInterval"
              :step="50"
              controls-position="right"
              size="small"
              :class="{ 'param-invalid': isInvalid(row.nodeId, 'samplingInterval') }"
            />
            <div class="range-hint">{{ limits.samplingInterval.min }}~{{ limits.samplingInterval.max }} ms</div>
          </template>
        </el-table-column>
        <el-table-column label="发布周期 (ms)" width="200">
          <template #default="{ row }">
            <el-input-number
              v-model="row.publishingInterval"
              :step="100"
              controls-position="right"
              size="small"
              :class="{ 'param-invalid': isInvalid(row.nodeId, 'publishingInterval') }"
            />
            <div class="range-hint">{{ limits.publishingInterval.min }}~{{ limits.publishingInterval.max }} ms</div>
          </template>
        </el-table-column>
        <el-table-column label="队列上限 (条)" width="190">
          <template #default="{ row }">
            <el-input-number
              v-model="row.queueSize"
              :step="1"
              controls-position="right"
              size="small"
              :class="{ 'param-invalid': isInvalid(row.nodeId, 'queueSize') }"
            />
            <div class="range-hint">1~{{ limits.queueSize.max }} 条（系统上限）</div>
          </template>
        </el-table-column>
        <el-table-column width="60">
          <template #default="{ $index }">
            <el-button type="danger" size="small" text @click="removeRow($index)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="dialog-footer">
        <el-button @click="mode = 'list'">取消</el-button>
        <el-button type="primary" @click="handleSave">保存方案</el-button>
      </div>
    </div>

    <!-- ============ 启用反馈视图（按节点逐条反馈） ============ -->
    <div v-else-if="mode === 'result' && currentResult">
      <div class="result-header">
        <span class="text-cyan-300 font-bold">{{ currentResult.planName }}</span>
        启用反馈：
        <el-tag type="success" size="small" effect="dark" class="mx-1">{{ currentResult.result.appliedNodes.filter(n => n.applied).length }} 个已生效</el-tag>
        <el-tag v-if="currentResult.result.pendingNodeIds.length" type="warning" size="small" effect="dark" class="mx-1">
          {{ currentResult.result.pendingNodeIds.length }} 个待生效
        </el-tag>
      </div>

      <el-table :data="currentResult.result.appliedNodes" class="dark-table mt-3" size="small">
        <el-table-column label="节点" prop="nodeName" min-width="160" />
        <el-table-column label="采样周期" width="110">
          <template #default="{ row }">{{ row.samplingInterval }} ms</template>
        </el-table-column>
        <el-table-column label="发布周期" width="110">
          <template #default="{ row }">{{ row.publishingInterval }} ms</template>
        </el-table-column>
        <el-table-column label="队列上限" width="90">
          <template #default="{ row }">{{ row.queueSize }} 条</template>
        </el-table-column>
        <el-table-column label="结果" min-width="160">
          <template #default="{ row }">
            <el-tag v-if="row.applied" type="success" size="small" effect="plain">
              <el-icon class="mr-0.5"><CircleCheckFilled /></el-icon>{{ row.message }}
            </el-tag>
            <el-tag v-else-if="row.message.includes('待生效')" type="warning" size="small" effect="plain">
              <el-icon class="mr-0.5"><WarningFilled /></el-icon>{{ row.message }}
            </el-tag>
            <el-tag v-else type="info" size="small" effect="plain">{{ row.message }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <!-- 连接异常节点单独列出 -->
      <div v-if="pendingRows.length > 0" class="pending-box">
        <div class="pending-title">
          <el-icon class="text-yellow-400"><WarningFilled /></el-icon>
          连接异常节点（参数已登记，连接恢复后自动生效，也可立即重试）
        </div>
        <div v-for="nodeId in pendingRows" :key="nodeId" class="pending-node">
          <span>{{ nodeName(nodeId) }}</span>
          <el-button size="small" type="primary" plain @click="handleRetry(nodeId)">重试</el-button>
        </div>
      </div>

      <div class="dialog-footer">
        <el-button @click="mode = 'list'">返回方案列表</el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Plus, CircleCheckFilled, CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useOpcuaStore } from '../store/opcua'
import { COLLECTION_LIMITS as limits } from '../config/limits'
import type { CollectionPlan, PlanNodeConfig, ApplyResult, ValidationError } from '../types'

const store = useOpcuaStore()

const visible = defineModel<boolean>('modelValue', { default: false })
type Mode = 'list' | 'edit' | 'result'
const mode = ref<Mode>('list')

// ---------- 编辑表单 ----------
const editingId = ref<string | null>(null)
const form = ref({ name: '', description: '' })
const rows = ref<PlanNodeConfig[]>([])
const selectedNodeIds = ref<string[]>([])
const formErrors = ref<{ nameError: string; fieldErrors: ValidationError[] }>({ nameError: '', fieldErrors: [] })
// 程序化填充（打开编辑）时暂停 watch，避免用默认行覆盖方案原有参数
let syncingSelection = false

watch(selectedNodeIds, (ids, oldIds) => {
  if (syncingSelection) return
  const added = ids.filter(id => !(oldIds || []).includes(id))
  const removed = (oldIds || []).filter(id => !ids.includes(id))
  added.forEach(id => {
    rows.value.push({ nodeId: id, samplingInterval: 500, publishingInterval: 1000, queueSize: 10 })
  })
  rows.value = rows.value.filter(r => !removed.includes(r.nodeId))
})

function openCreate() {
  editingId.value = null
  form.value = { name: '', description: '' }
  syncingSelection = true
  rows.value = []
  selectedNodeIds.value = []
  nextTick(() => { syncingSelection = false })
  formErrors.value = { nameError: '', fieldErrors: [] }
  mode.value = 'edit'
}

function openEdit(plan: CollectionPlan) {
  editingId.value = plan.id
  form.value = { name: plan.name, description: plan.description || '' }
  syncingSelection = true
  rows.value = plan.configs.map(c => ({ ...c }))
  selectedNodeIds.value = plan.configs.map(c => c.nodeId)
  nextTick(() => { syncingSelection = false })
  formErrors.value = { nameError: '', fieldErrors: [] }
  mode.value = 'edit'
}

function removeRow(index: number) {
  const id = rows.value[index].nodeId
  selectedNodeIds.value = selectedNodeIds.value.filter(n => n !== id)
}

function isInvalid(nodeId: string, field: ValidationError['field']): boolean {
  return formErrors.value.fieldErrors.some(e => e.nodeId === nodeId && e.field === field)
}

function handleSave() {
  const result = store.savePlan({
    id: editingId.value ?? undefined,
    name: form.value.name,
    description: form.value.description,
    configs: rows.value
  })
  if (!result.ok) {
    formErrors.value = { nameError: result.nameError, fieldErrors: result.fieldErrors }
    ElMessage.error(`配置未保存：${result.fieldErrors.length} 个参数不满足取值范围${result.nameError ? '，' + result.nameError : ''}`)
    return
  }
  ElMessage.success('采集方案已保存')
  mode.value = 'list'
}

// ---------- 启用反馈 ----------
const currentResult = ref<{ planName: string; result: ApplyResult } | null>(null)

function handleEnable(plan: CollectionPlan) {
  const result = store.enablePlan(plan.id)
  currentResult.value = { planName: plan.name, result }
  mode.value = 'result'
  if (result.pendingNodeIds.length === 0) {
    ElMessage.success(`方案「${plan.name}」已全部生效`)
  } else {
    ElMessage.warning(`${result.pendingNodeIds.length} 个节点连接异常，已列为待生效`)
  }
}

function openResult(plan: CollectionPlan) {
  // 依据当前共享订阅参数实时重建逐条反馈
  const appliedNodes = plan.configs.map(c => {
    const state = store.planNodeState(plan, c.nodeId)
    return {
      nodeId: c.nodeId,
      nodeName: nodeName(c.nodeId),
      applied: state === 'applied',
      message:
        state === 'applied' ? '已生效'
        : state === 'pending' ? '节点连接异常，待连接恢复后生效'
        : state === 'overridden' ? '当前参数被其他配置覆盖'
        : '未生效',
      samplingInterval: c.samplingInterval,
      publishingInterval: c.publishingInterval,
      queueSize: c.queueSize
    }
  })
  currentResult.value = {
    planName: plan.name,
    result: { success: true, appliedNodes, pendingNodeIds: plan.configs.filter(c => store.planNodeState(plan, c.nodeId) === 'pending').map(c => c.nodeId) }
  }
  mode.value = 'result'
}

const pendingRows = computed(() => currentResult.value?.result.pendingNodeIds ?? [])

function handleRetry(nodeId: string) {
  const plan = store.plans.find(p => p.name === currentResult.value?.planName)
  const names = store.retryPending(plan?.id)
  if (names.includes(nodeName(nodeId)) || store.planNodeState(plan!, nodeId) === 'applied') {
    ElMessage.success(`节点 ${nodeName(nodeId)} 已连接，配置生效`)
  } else {
    ElMessage.error(`节点 ${nodeName(nodeId)} 仍然连接异常`)
  }
  if (plan) openResult(plan)
}

// ---------- 列表辅助 ----------
function nodeName(id: string): string {
  return store.findNodeById(id)?.name ?? id
}

function pendingCount(plan: CollectionPlan): number {
  return store.planStats(plan).pending
}

function stateTagType(plan: CollectionPlan, nodeId: string): 'success' | 'warning' | 'info' {
  const state = store.planNodeState(plan, nodeId)
  if (state === 'applied') return 'success'
  if (state === 'pending') return 'warning'
  return 'info'
}

function stateSuffix(plan: CollectionPlan, nodeId: string): string {
  if (!plan.enabled) return ''
  const state = store.planNodeState(plan, nodeId)
  if (state === 'applied') return ' ·已生效'
  if (state === 'pending') return ' ·待生效'
  if (state === 'overridden') return ' ·被覆盖'
  return ''
}

function fieldLabel(field: ValidationError['field']): string {
  return limits[field].label
}

function handleClosed() {
  mode.value = 'list'
  currentResult.value = null
}
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.toolbar-tip {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}

.node-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.node-tag {
  margin: 0;
}

.global-pending {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(234, 179, 8, 0.08);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 6px;
  font-size: 12px;
  color: #fcd34d;
}

.node-check-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.node-check {
  margin-right: 0;
  height: 24px;
}

.error-box {
  margin: 8px 0 4px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 6px;
}

.error-box-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #fca5a5;
  font-size: 13px;
  font-weight: bold;
  margin-bottom: 6px;
}

.error-line {
  font-size: 12px;
  color: #e2e8f0;
  line-height: 1.9;
}

.range-hint {
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
}

:deep(.param-invalid .el-input__wrapper) {
  box-shadow: 0 0 0 1px #ef4444 inset;
  background: rgba(239, 68, 68, 0.08);
}

.result-header {
  font-size: 13px;
  color: #cbd5e1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.pending-box {
  margin-top: 14px;
  padding: 10px 12px;
  background: rgba(234, 179, 8, 0.06);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 6px;
}

.pending-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #fcd34d;
  font-weight: bold;
  margin-bottom: 8px;
}

.pending-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px;
  font-size: 13px;
  color: #e2e8f0;
  border-top: 1px dashed rgba(148, 163, 184, 0.2);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

:deep(.plan-dialog) {
  background: #1e293b;
  border: 1px solid rgba(71, 85, 105, 0.6);
  border-radius: 10px;
}

:deep(.plan-dialog .el-dialog__title) {
  color: #22d3ee;
}

:deep(.plan-dialog .el-dialog__headerbtn .el-dialog__close) {
  color: #94a3b8;
}

:deep(.plan-dialog .el-dialog__body) {
  color: #e2e8f0;
  max-height: 70vh;
  overflow-y: auto;
}

:deep(.dark-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(15, 23, 42, 0.6);
  --el-table-border-color: rgba(71, 85, 105, 0.4);
  --el-table-header-text-color: #94a3b8;
  --el-table-text-color: #e2e8f0;
  --el-table-row-hover-bg-color: rgba(6, 182, 212, 0.08);
}

:deep(.plan-dialog .el-input__wrapper),
:deep(.plan-dialog .el-input-number),
:deep(.plan-dialog .el-input-number .el-input__wrapper) {
  background: rgba(15, 23, 42, 0.6);
}

:deep(.plan-dialog .el-input__inner) {
  color: #e2e8f0;
}

:deep(.plan-dialog .el-form-item__label) {
  color: #cbd5e1;
}

:deep(.plan-dialog .el-checkbox__label) {
  color: #cbd5e1;
}
</style>
