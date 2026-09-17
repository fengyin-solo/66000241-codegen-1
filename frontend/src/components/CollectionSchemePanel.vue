<template>
  <div class="collection-panel">
    <div class="panel-header">
      <div>
        <h3 class="section-title">节点采集方案</h3>
        <p class="section-desc">
          为若干节点分别设定采样周期、发布周期与队列上限，保存为可复用方案；启用后按节点逐一生效，连接异常的节点将在恢复后自动补发。
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建方案</el-button>
    </div>

    <!-- 参数取值范围提示 -->
    <el-alert type="info" :closable="false" class="limits-alert">
      <template #title>
        <span class="limits-text">
          参数标准（采集方案与单点订阅共用）：采样周期
          <b>{{ limits.samplingInterval.min }}~{{ limits.samplingInterval.max }}ms</b>
          ｜发布周期 <b>{{ limits.publishingInterval.min }}~{{ limits.publishingInterval.max }}ms</b>
          ｜队列上限 <b>{{ limits.queueSize.min }}~{{ limits.queueSize.max }}</b>
          （系统上限 {{ limits.queueSize.max }}）。任一项越界，整份配置均不允许保存。
        </span>
      </template>
    </el-alert>

    <!-- 待生效节点提醒 -->
    <el-alert
      v-if="store.pendingNodeList.length > 0"
      type="warning"
      show-icon
      :closable="false"
      class="pending-alert"
    >
      <template #title>
        <div class="pending-bar">
          <span>
            方案「{{ store.activeScheme?.name }}」有
            <b>{{ store.pendingNodeList.length }}</b>
            个节点连接异常、配置待生效：
            <el-tag
              v-for="n in store.pendingNodeList"
              :key="n.nodeId"
              size="small"
              type="warning"
              class="pending-tag"
            >
              {{ store.nodeNameOf(n.nodeId) || n.nodeId }}
            </el-tag>
          </span>
          <el-button size="small" type="warning" plain :loading="retrying" @click="handleRetryPending">
            重新下发
          </el-button>
        </div>
      </template>
    </el-alert>

    <!-- 方案列表 -->
    <div v-if="store.schemes.length === 0" class="empty-schemes">
      <el-empty description="暂无采集方案，点击「新建方案」开始配置" />
    </div>

    <div v-else class="scheme-grid">
      <el-card
        v-for="scheme in store.schemes"
        :key="scheme.id"
        class="scheme-card"
        :class="{ 'scheme-active': scheme.active }"
        shadow="hover"
      >
        <template #header>
          <div class="scheme-card-header">
            <div class="scheme-title-group">
              <span class="scheme-name">{{ scheme.name }}</span>
              <el-tag v-if="scheme.active" type="success" size="small" effect="dark">生效中</el-tag>
              <el-tag v-else type="info" size="small">未生效</el-tag>
            </div>
            <div class="scheme-actions">
              <el-button
                v-if="!scheme.active"
                type="success"
                size="small"
                :icon="VideoPlay"
                @click="handleActivate(scheme)"
              >
                启用
              </el-button>
              <el-button v-else type="warning" size="small" @click="handleDeactivate(scheme)">
                停用
              </el-button>
              <el-button type="primary" size="small" text :icon="Edit" @click="openEdit(scheme)" />
              <el-popconfirm
                :title="`确定删除方案「${scheme.name}」吗？`"
                @confirm="handleDelete(scheme)"
              >
                <template #reference>
                  <el-button type="danger" size="small" text :icon="Delete" />
                </template>
              </el-popconfirm>
            </div>
          </div>
        </template>

        <p v-if="scheme.description" class="scheme-desc">{{ scheme.description }}</p>

        <!-- 覆盖节点 -->
        <div class="covered-nodes">
          <div class="covered-label">
            覆盖节点（{{ scheme.nodes.length }}）
          </div>
          <div class="node-chips">
            <el-tag
              v-for="n in scheme.nodes"
              :key="n.nodeId"
              size="small"
              :type="chipType(scheme, n.nodeId)"
              effect="plain"
              class="node-chip"
            >
              {{ store.nodeNameOf(n.nodeId) || n.nodeId }}
              <span v-if="scheme.active && store.pendingNodes.has(n.nodeId)" class="chip-suffix">
                ·待生效
              </span>
            </el-tag>
          </div>
        </div>

        <!-- 参数明细 -->
        <el-table :data="scheme.nodes" size="small" class="scheme-table" :show-header="true">
          <el-table-column label="节点" min-width="150">
            <template #default="{ row }">
              {{ store.nodeNameOf(row.nodeId) || row.nodeId }}
            </template>
          </el-table-column>
          <el-table-column prop="samplingInterval" label="采样周期(ms)" width="110" align="right" />
          <el-table-column prop="publishingInterval" label="发布周期(ms)" width="110" align="right" />
          <el-table-column prop="queueSize" label="队列上限" width="90" align="right" />
          <el-table-column v-if="scheme.active" label="状态" width="80">
            <template #default="{ row }">
              <el-tag
                :type="store.pendingNodes.has(row.nodeId) ? 'warning' : 'success'"
                size="small"
              >
                {{ store.pendingNodes.has(row.nodeId) ? '待生效' : '已生效' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>

        <div class="scheme-footer">
          <span>更新于 {{ formatTime(scheme.updatedAt) }}</span>
        </div>
      </el-card>
    </div>

    <!-- 新建 / 编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑采集方案' : '新建采集方案'"
      width="820px"
      top="6vh"
      class="scheme-dialog"
    >
      <el-form label-width="82px" class="scheme-form">
        <el-form-item label="方案名称" required>
          <el-input v-model="form.name" placeholder="例如：1号区域高频采集" maxlength="50" />
        </el-form-item>
        <el-form-item label="方案描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="可选" />
        </el-form-item>

        <div class="form-toolbar">
          <span class="form-toolbar-label">节点参数（{{ form.nodes.length }}）</span>
          <el-button size="small" type="primary" plain :icon="Plus" :disabled="availableVariables.length === 0" @click="addNodeRow">
            添加节点
          </el-button>
        </div>

        <el-table :data="form.nodes" size="small" class="form-table">
          <el-table-column label="节点" min-width="170">
            <template #default="{ row, $index }">
              <el-select
                v-model="row.nodeId"
                placeholder="选择节点"
                size="small"
                filterable
                class="node-select"
              >
                <el-option
                  v-for="v in variableOptions"
                  :key="v.id"
                  :label="`${v.name} (${v.nodeId})`"
                  :value="v.id"
                  :disabled="isNodeUsedByOtherRow(row.nodeId, $index)"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column :label="`采样周期(ms)`" width="160">
            <template #default="{ row, $index }">
              <el-input-number
                v-model="row.samplingInterval"
                :min="limits.samplingInterval.min"
                :max="limits.samplingInterval.max"
                :step="100"
                :step-strictly="true"
                size="small"
                controls-position="right"
                class="param-input"
                :class="fieldErrorClass($index, 'samplingInterval')"
              />
            </template>
          </el-table-column>
          <el-table-column label="发布周期(ms)" width="160">
            <template #default="{ row, $index }">
              <el-input-number
                v-model="row.publishingInterval"
                :min="limits.publishingInterval.min"
                :max="limits.publishingInterval.max"
                :step="100"
                :step-strictly="true"
                size="small"
                controls-position="right"
                class="param-input"
                :class="fieldErrorClass($index, 'publishingInterval')"
              />
            </template>
          </el-table-column>
          <el-table-column label="队列上限" width="140">
            <template #default="{ row, $index }">
              <el-input-number
                v-model="row.queueSize"
                :min="limits.queueSize.min"
                :max="limits.queueSize.max"
                :step="10"
                :step-strictly="true"
                size="small"
                controls-position="right"
                class="param-input"
                :class="fieldErrorClass($index, 'queueSize')"
              />
            </template>
          </el-table-column>
          <el-table-column width="50" align="center">
            <template #default="{ $index }">
              <el-button type="danger" size="small" text :icon="Delete" @click="removeNodeRow($index)" />
            </template>
          </el-table-column>
        </el-table>

        <div class="range-hints">
          <span>采样周期 {{ limits.samplingInterval.min }}~{{ limits.samplingInterval.max }}ms</span>
          <span>发布周期 {{ limits.publishingInterval.min }}~{{ limits.publishingInterval.max }}ms</span>
          <span>队列上限不超过 {{ limits.queueSize.max }}</span>
        </div>

        <!-- 校验错误：明确节点与字段 -->
        <div v-if="validationErrors.length > 0" class="validation-box">
          <div class="validation-title">配置无法保存，请修正以下 {{ validationErrors.length }} 项：</div>
          <div v-for="(err, i) in validationErrors" :key="i" class="validation-error-item">
            <el-icon class="error-icon"><WarningFilled /></el-icon>
            <span>{{ err.message }}</span>
          </div>
        </div>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存方案</el-button>
      </template>
    </el-dialog>

    <!-- 启用结果对话框 -->
    <el-dialog v-model="resultVisible" title="方案启用结果" width="560px">
      <template v-if="activationResult">
        <el-result
          :icon="hasPending ? 'warning' : 'success'"
          :title="hasPending
            ? `方案「${activationResult.schemeName}」已启用，部分节点待生效`
            : `方案「${activationResult.schemeName}」已全部生效`"
          :sub-title="`成功 ${successResults.length} 个 / 待生效 ${pendingResults.length} 个`"
        />
        <el-table :data="activationResult.results" size="small" max-height="280">
          <el-table-column label="节点" min-width="160">
            <template #default="{ row }">{{ row.nodeName || row.nodeId }}</template>
          </el-table-column>
          <el-table-column label="结果" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'success' ? 'success' : 'warning'" size="small">
                {{ row.status === 'success' ? '已生效' : '待生效' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
        </el-table>
      </template>
      <template #footer>
        <el-button type="primary" @click="resultVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Plus, Edit, Delete, VideoPlay, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useOpcuaStore } from '../store/opcua'
import { COLLECTION_LIMITS, DEFAULT_SUBSCRIPTION } from '../config/collection'
import type {
  CollectionNodeConfig,
  CollectionScheme,
  CollectionValidationError,
  SchemeActivationResult
} from '../types'

const store = useOpcuaStore()
const limits = COLLECTION_LIMITS

const dialogVisible = ref(false)
const resultVisible = ref(false)
const retrying = ref(false)
const editingId = ref<string | null>(null)
const validationErrors = ref<CollectionValidationError[]>([])
const activationResult = ref<SchemeActivationResult | null>(null)

interface FormState {
  name: string
  description: string
  nodes: CollectionNodeConfig[]
}

const form = reactive<FormState>({
  name: '',
  description: '',
  nodes: []
})

const variableOptions = computed(() => store.getAllVariableNodes())
const availableVariables = computed(() =>
  variableOptions.value.filter(v => !form.nodes.some(n => n.nodeId === v.id))
)

const successResults = computed(
  () => activationResult.value?.results.filter(r => r.status === 'success') ?? []
)
const pendingResults = computed(
  () => activationResult.value?.results.filter(r => r.status === 'pending') ?? []
)
const hasPending = computed(() => pendingResults.value.length > 0)

function resetForm() {
  form.name = ''
  form.description = ''
  form.nodes = []
  editingId.value = null
  validationErrors.value = []
}

function openCreate() {
  resetForm()
  dialogVisible.value = true
}

function openEdit(scheme: CollectionScheme) {
  resetForm()
  editingId.value = scheme.id
  form.name = scheme.name
  form.description = scheme.description ?? ''
  form.nodes = scheme.nodes.map(n => ({ ...n }))
  dialogVisible.value = true
}

function addNodeRow() {
  const candidate = availableVariables.value[0]
  form.nodes.push({
    nodeId: candidate?.id ?? '',
    samplingInterval: DEFAULT_SUBSCRIPTION.samplingInterval,
    publishingInterval: DEFAULT_SUBSCRIPTION.publishingInterval,
    queueSize: DEFAULT_SUBSCRIPTION.queueSize
  })
}

function removeNodeRow(index: number) {
  form.nodes.splice(index, 1)
}

function isNodeUsedByOtherRow(currentValue: string, rowIndex: number): boolean {
  if (!currentValue) return false
  return form.nodes.some((n, i) => i !== rowIndex && n.nodeId === currentValue)
}

function fieldErrorClass(index: number, field: CollectionValidationError['field']): string {
  const nodeId = form.nodes[index]?.nodeId
  return validationErrors.value.some(e => e.field === field && (!nodeId || e.nodeId === nodeId))
    ? 'param-error'
    : ''
}

function handleSave() {
  let errors: CollectionValidationError[]
  try {
    store.saveScheme({
      id: editingId.value ?? undefined,
      name: form.name,
      description: form.description,
      nodes: form.nodes
    })
    errors = []
  } catch (e) {
    errors = e as CollectionValidationError[]
  }
  validationErrors.value = errors
  if (errors.length > 0) {
    ElMessage.error(`配置存在 ${errors.length} 项不合规，整份配置未保存`)
    return
  }
  ElMessage.success(editingId.value ? '采集方案已更新' : '采集方案已保存')
  dialogVisible.value = false
}

function handleActivate(scheme: CollectionScheme) {
  activationResult.value = store.activateScheme(scheme.id)
  resultVisible.value = true
  const pendingCount = pendingResults.value.length
  if (pendingCount > 0) {
    ElMessage.warning(`方案已启用，${pendingCount} 个节点连接异常，已列入待生效`)
  } else {
    ElMessage.success('方案已全部生效')
  }
}

function handleDeactivate(scheme: CollectionScheme) {
  store.deactivateScheme(scheme.id)
  ElMessage.info(`方案「${scheme.name}」已停用`)
}

function handleDelete(scheme: CollectionScheme) {
  store.deleteScheme(scheme.id)
  ElMessage.info(`方案「${scheme.name}」已删除`)
}

function handleRetryPending() {
  retrying.value = true
  const result = store.retryPending()
  setTimeout(() => {
    retrying.value = false
    if (result) {
      activationResult.value = result
      const stillPending = result.results.filter(r => r.status === 'pending').length
      if (stillPending === 0 && result.results.length > 0) {
        ElMessage.success('待生效节点已全部补发生效')
      } else {
        resultVisible.value = true
        ElMessage.warning(`仍有 ${stillPending} 个节点连接异常`)
      }
    }
  }, 300)
}

function chipType(scheme: CollectionScheme, nodeId: string): 'success' | 'warning' | 'info' {
  if (scheme.active) {
    return store.pendingNodes.has(nodeId) ? 'warning' : 'success'
  }
  return 'info'
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
</script>

<style scoped>
.collection-panel {
  padding: 16px;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: bold;
  color: #22d3ee;
  padding-left: 8px;
  border-left: 3px solid #06b6d4;
}

.section-desc {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 6px;
  max-width: 820px;
  line-height: 1.6;
}

.limits-alert {
  margin-bottom: 12px;
}

.limits-text b {
  color: #22d3ee;
  font-family: monospace;
}

.pending-alert {
  margin-bottom: 12px;
}

.pending-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.pending-tag {
  margin-left: 6px;
}

.empty-schemes {
  padding-top: 60px;
}

.scheme-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scheme-card {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(71, 85, 105, 0.5);
  border-radius: 8px;
}

.scheme-card.scheme-active {
  border-color: rgba(34, 211, 238, 0.6);
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.25);
}

.scheme-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.scheme-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scheme-name {
  font-size: 15px;
  font-weight: bold;
  color: #e2e8f0;
}

.scheme-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.scheme-desc {
  font-size: 12px;
  color: #94a3b8;
  margin: 0 0 10px;
}

.covered-nodes {
  margin-bottom: 10px;
}

.covered-label {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}

.node-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.node-chip {
  font-size: 12px;
}

.chip-suffix {
  color: #f59e0b;
}

.scheme-table {
  margin-bottom: 8px;
}

.scheme-footer {
  display: flex;
  justify-content: flex-end;
  font-size: 11px;
  color: #64748b;
}

.form-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: 8px;
}

.form-toolbar-label {
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.node-select {
  width: 100%;
}

.param-input {
  width: 100%;
}

.range-hints {
  display: flex;
  gap: 16px;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 8px;
}

.validation-box {
  width: 100%;
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 6px;
}

.validation-title {
  font-size: 13px;
  font-weight: 600;
  color: #ef4444;
  margin-bottom: 6px;
}

.validation-error-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: #fca5a5;
  line-height: 1.7;
}

.error-icon {
  margin-top: 3px;
  flex-shrink: 0;
}

:deep(.param-error .el-input__wrapper) {
  box-shadow: 0 0 0 1px #ef4444 inset;
}

:deep(.el-card) {
  background: rgba(30, 41, 59, 0.8);
  color: #e2e8f0;
}

:deep(.el-card__header) {
  border-bottom-color: rgba(71, 85, 105, 0.5);
}
</style>
