<template>
  <div class="node-tree-container">
    <div class="tree-header">
      <h3 class="text-lg font-bold text-cyan-400">OPC-UA 节点树</h3>
      <el-tag :type="store.isConnected ? 'success' : 'danger'" size="small">
        {{ store.isConnected ? '已连接' : '未连接' }}
      </el-tag>
    </div>

    <el-tree
      :data="store.nodeTree"
      :props="treeProps"
      node-key="id"
      highlight-current
      default-expand-all
      @node-click="handleNodeClick"
      class="dark-tree"
    >
      <template #default="{ node, data }">
        <span class="custom-tree-node">
          <el-icon v-if="data.type === 'Object'" class="text-yellow-400">
            <Folder />
          </el-icon>
          <el-icon v-else-if="data.type === 'Variable'" class="text-green-400">
            <DataLine />
          </el-icon>
          <span class="node-label">{{ data.name }}</span>
          <el-tag
            v-if="data.type === 'Variable' && store.unreachableNodes.has(data.id)"
            type="danger"
            size="small"
            class="ml-2"
          >
            连接异常
          </el-tag>
          <el-tag
            v-else-if="data.type === 'Variable' && data.quality"
            :type="data.quality === 'Good' ? 'success' : data.quality === 'Bad' ? 'danger' : 'warning'"
            size="small"
            class="ml-2"
          >
            {{ data.quality }}
          </el-tag>
          <span v-if="data.type === 'Variable' && data.value !== undefined" class="node-value">
            {{ data.value }}{{ data.unit ? ' ' + data.unit : '' }}
          </span>
        </span>
      </template>
    </el-tree>

    <!-- 节点详情面板 -->
    <div v-if="store.selectedNode" class="node-detail-panel">
      <el-divider />
      <h4 class="text-sm font-bold text-cyan-300 mb-2">节点详情</h4>
      <el-descriptions :column="1" size="small" border class="dark-descriptions">
        <el-descriptions-item label="名称">{{ store.selectedNode.name }}</el-descriptions-item>
        <el-descriptions-item label="Node ID">{{ store.selectedNode.nodeId }}</el-descriptions-item>
        <el-descriptions-item label="类型">
          <el-tag size="small">{{ store.selectedNode.type }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="store.selectedNode.dataType" label="数据类型">
          {{ store.selectedNode.dataType }}
        </el-descriptions-item>
        <el-descriptions-item v-if="store.selectedNode.value !== undefined" label="当前值">
          <span :class="reachable ? 'text-green-400 font-mono' : 'text-red-400 font-mono'">
            <template v-if="reachable">
              {{ store.selectedNode.value }}{{ store.selectedNode.unit ? ' ' + store.selectedNode.unit : '' }}
            </template>
            <template v-else>-- 连接异常 --</template>
          </span>
        </el-descriptions-item>
        <el-descriptions-item v-if="store.selectedNode.quality" label="质量码">
          <el-tag
            :type="store.selectedNode.quality === 'Good' ? 'success' : store.selectedNode.quality === 'Bad' ? 'danger' : 'warning'"
            size="small"
          >
            {{ store.selectedNode.quality }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="store.selectedNode.description" label="描述">
          {{ store.selectedNode.description }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 连接状态（可模拟断连/恢复，用于演示待生效） -->
      <div v-if="store.selectedNode.type === 'Variable'" class="connection-row">
        <span class="conn-label">连接状态：</span>
        <el-tag :type="reachable ? 'success' : 'danger'" size="small">
          {{ reachable ? '连接正常' : '连接异常' }}
        </el-tag>
        <el-button
          size="small"
          text
          :type="reachable ? 'danger' : 'success'"
          @click="toggleReachability"
        >
          {{ reachable ? '模拟断连' : '模拟恢复' }}
        </el-button>
      </div>

      <!-- 当前采集参数及来源（配置与订阅共用同一份参数） -->
      <div v-if="store.selectedNode.type === 'Variable' && effective" class="effective-panel">
        <div class="effective-header">
          <span class="effective-title">当前采集参数</span>
          <el-tag v-if="effective.source === 'scheme'" type="success" size="small">
            来自采集方案
          </el-tag>
          <el-tag v-else type="info" size="small">单点订阅</el-tag>
          <el-tag v-if="effective.pending" type="warning" size="small">待生效</el-tag>
        </div>
        <el-descriptions :column="1" size="small" border class="dark-descriptions">
          <el-descriptions-item label="参数来源">
            <span v-if="effective.source === 'scheme'" class="text-cyan-300">
              采集方案「{{ effective.sourceSchemeName }}」
            </span>
            <span v-else class="text-slate-300">单点订阅（默认参数）</span>
          </el-descriptions-item>
          <el-descriptions-item label="采样周期">
            {{ effective.samplingInterval }} ms
          </el-descriptions-item>
          <el-descriptions-item label="发布周期">
            {{ effective.publishingInterval }} ms
          </el-descriptions-item>
          <el-descriptions-item label="队列上限">
            {{ effective.queueSize }}
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="mt-3 flex gap-2">
        <el-button
          v-if="store.selectedNode.type === 'Variable'"
          type="primary"
          size="small"
          @click="handleSubscribe"
        >
          {{ manualSubscribed ? '取消单点订阅' : '单点订阅' }}
        </el-button>
        <el-button
          v-if="store.selectedNode.type === 'Variable'"
          type="info"
          size="small"
          @click="handleReadValue"
        >
          读取
        </el-button>
      </div>
      <p v-if="effective?.source === 'scheme'" class="source-hint">
        该节点当前由生效中的采集方案「{{ effective.sourceSchemeName }}」统一采集，
        单点订阅入口保持可用但不改变方案参数；停用方案后单点订阅按默认参数继续。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Folder, DataLine } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useOpcuaStore } from '../store/opcua'
import type { OPCUANode } from '../types'

const store = useOpcuaStore()

const treeProps = {
  children: 'children',
  label: 'name'
}

const reachable = computed(() =>
  store.selectedNode ? store.isNodeReachable(store.selectedNode.id) : true
)

// 当前节点生效参数（含来源：采集方案 / 单点订阅）
const effective = computed(() =>
  store.selectedNode ? store.getEffectiveSubscription(store.selectedNode.id) : null
)

// 原有单点订阅入口：只表示手动订阅状态，方案覆盖不改变其行为
const manualSubscribed = computed(() =>
  store.selectedNode ? store.manualSubscriptions.has(store.selectedNode.id) : false
)

function handleNodeClick(data: OPCUANode) {
  store.selectNode(data)
}

// 原有单点订阅入口，保持原行为
function handleSubscribe() {
  if (!store.selectedNode) return
  if (manualSubscribed.value) {
    store.removeSubscription(store.selectedNode.id)
    ElMessage.success(`已取消单点订阅: ${store.selectedNode.name}`)
  } else {
    store.addSubscription(store.selectedNode.id)
    ElMessage.success(`已单点订阅: ${store.selectedNode.name}`)
  }
}

function handleReadValue() {
  if (!store.selectedNode) return
  if (!reachable.value) {
    ElMessage.error(`${store.selectedNode.name} 连接异常，无法读取`)
    return
  }
  ElMessage.success(`${store.selectedNode.name} = ${store.selectedNode.value} ${store.selectedNode.unit || ''}`)
}

// 模拟节点连接异常/恢复
function toggleReachability() {
  if (!store.selectedNode) return
  const node = store.selectedNode
  if (reachable.value) {
    store.setNodeReachable(node.id, false)
    ElMessage.warning(`已模拟节点 ${node.name} 连接异常`)
  } else {
    const recoveredPending = store.setNodeReachable(node.id, true)
    ElMessage.success(`节点 ${node.name} 连接已恢复`)
    if (recoveredPending.length > 0) {
      ElMessage.success(`节点 ${node.name} 的待生效采集配置已自动补发`)
    }
  }
}
</script>

<style scoped>
.node-tree-container {
  height: 100%;
  overflow-y: auto;
  padding: 12px;
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.custom-tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  flex: 1;
  overflow: hidden;
}

.node-label {
  white-space: nowrap;
}

.node-value {
  margin-left: auto;
  font-family: monospace;
  font-size: 12px;
  color: #67c23a;
  padding-left: 8px;
}

.node-detail-panel {
  padding: 8px 0;
}

.connection-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
}

.conn-label {
  color: #94a3b8;
}

.effective-panel {
  margin-top: 10px;
  padding: 8px;
  background: rgba(6, 182, 212, 0.06);
  border: 1px solid rgba(6, 182, 212, 0.25);
  border-radius: 6px;
}

.effective-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.effective-title {
  font-size: 12px;
  font-weight: bold;
  color: #67e8f9;
}

.source-hint {
  margin-top: 8px;
  font-size: 11px;
  color: #7dd3fc;
  line-height: 1.6;
  background: rgba(6, 182, 212, 0.08);
  border-radius: 4px;
  padding: 6px 8px;
}

:deep(.el-tree) {
  background: transparent !important;
  color: #e0e0e0 !important;
}

:deep(.el-tree-node__content:hover) {
  background: rgba(6, 182, 212, 0.1) !important;
}

:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: rgba(6, 182, 212, 0.2) !important;
}

:deep(.el-descriptions) {
  --el-descriptions-item-bordered-label-background: #1f2937;
}
</style>
