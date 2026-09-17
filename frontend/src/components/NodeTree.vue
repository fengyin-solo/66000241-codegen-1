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
          <el-tooltip
            v-if="data.type === 'Variable' && coveringPlan(data.id)"
            :content="`已纳入采集方案：${coveringPlan(data.id)!.name}`"
            placement="top"
          >
            <el-icon class="plan-cover-icon"><Aim /></el-icon>
          </el-tooltip>
          <el-tag
            v-if="data.type === 'Variable' && (!store.isNodeReachable(data.id) || data.quality === 'Bad')"
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
          <span v-if="data.type === 'Variable' && data.value !== undefined && store.isNodeReachable(data.id)" class="node-value">
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
          <span class="text-green-400 font-mono">
            {{ store.selectedNode.value }}{{ store.selectedNode.unit ? ' ' + store.selectedNode.unit : '' }}
          </span>
        </el-descriptions-item>
        <el-descriptions-item v-if="store.selectedNode.quality" label="质量码">
          <el-tag
            :type="store.selectedNode.quality === 'Good' ? 'success' : 'danger'"
            size="small"
          >
            {{ store.selectedNode.quality }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item v-if="store.selectedNode.description" label="描述">
          {{ store.selectedNode.description }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 当前采集/订阅参数：配置与订阅共用同一份参数，并标明来自哪份配置 -->
      <template v-if="store.selectedNode.type === 'Variable'">
        <div v-if="activeSubscription" class="param-section">
          <div class="param-section-title">
            当前采集参数
            <el-tag :type="activeSubscription.status === 'pending' ? 'warning' : 'success'" size="small" effect="dark">
              {{ activeSubscription.status === 'pending' ? '待生效（连接异常）' : '已生效' }}
            </el-tag>
          </div>
          <el-descriptions :column="1" size="small" border class="dark-descriptions">
            <el-descriptions-item label="参数来源">
              <el-tag v-if="activeSubscription.source === 'plan'" type="primary" size="small" effect="plain">
                采集方案：{{ activeSubscription.planName }}
              </el-tag>
              <el-tag v-else type="info" size="small" effect="plain">单点订阅（手动）</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="采样周期">{{ activeSubscription.samplingInterval }} ms</el-descriptions-item>
            <el-descriptions-item label="发布周期">{{ activeSubscription.publishingInterval }} ms</el-descriptions-item>
            <el-descriptions-item label="队列上限">{{ activeSubscription.queueSize }} 条</el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 未订阅但被方案覆盖的提示 -->
        <div v-else-if="coveringPlan(store.selectedNode.id)" class="param-section">
          <el-alert
            type="info"
            :closable="false"
            show-icon
            :title="`该节点已纳入采集方案「${coveringPlan(store.selectedNode.id)!.name}」，方案启用后开始采集`"
          />
        </div>
      </template>

      <div class="mt-3 flex gap-2">
        <el-button
          v-if="store.selectedNode.type === 'Variable' && activeSubscription"
          type="danger"
          size="small"
          @click="handleSubscribe"
        >
          取消订阅
        </el-button>
        <el-button
          v-else-if="store.selectedNode.type === 'Variable'"
          type="primary"
          size="small"
          @click="handleSubscribe"
        >
          订阅
        </el-button>
        <el-button
          v-if="store.selectedNode.type === 'Variable'"
          type="info"
          size="small"
          @click="handleReadValue"
        >
          读取
        </el-button>
        <el-button
          v-if="store.selectedNode.type === 'Variable'"
          :type="store.isNodeReachable(store.selectedNode.id) ? 'warning' : 'success'"
          size="small"
          @click="toggleConnectivity"
        >
          {{ store.isNodeReachable(store.selectedNode.id) ? '模拟连接异常' : '模拟恢复连接' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Folder, DataLine, Aim } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useOpcuaStore } from '../store/opcua'
import type { OPCUANode, CollectionPlan, SubscriptionConfig } from '../types'

const store = useOpcuaStore()

const treeProps = {
  children: 'children',
  label: 'name'
}

const isSubscribed = computed(() => {
  if (!store.selectedNode) return false
  return store.subscriptions.has(store.selectedNode.id)
})

// 当前生效参数（配置与订阅共用同一份参数），并附带来源方案名称
const activeSubscription = computed<(SubscriptionConfig & { planName: string }) | null>(() => {
  if (!store.selectedNode) return null
  const sub = store.subscriptions.get(store.selectedNode.id)
  if (!sub) return null
  return { ...sub, planName: store.getPlanName(sub.planId) }
})

// 节点被哪份（已启用的）方案覆盖
function coveringPlan(nodeId: string): CollectionPlan | null {
  return store.plans.find(p => p.enabled && p.configs.some(c => c.nodeId === nodeId)) ?? null
}

function handleNodeClick(data: OPCUANode) {
  store.selectNode(data)
}

function handleSubscribe() {
  if (!store.selectedNode) return
  if (isSubscribed.value) {
    store.removeSubscription(store.selectedNode.id)
    ElMessage.success(`已取消订阅: ${store.selectedNode.name}`)
  } else {
    store.addSubscription(store.selectedNode.id)
    ElMessage.success(`已订阅: ${store.selectedNode.name}`)
  }
}

function handleReadValue() {
  if (!store.selectedNode) return
  if (!store.isNodeReachable(store.selectedNode.id)) {
    ElMessage.warning(`${store.selectedNode.name} 连接异常，无法读取`)
    return
  }
  ElMessage.success(`${store.selectedNode.name} = ${store.selectedNode.value} ${store.selectedNode.unit || ''}`)
}

// 模拟节点连接异常 / 恢复；恢复时自动让待生效配置生效
function toggleConnectivity() {
  if (!store.selectedNode) return
  const nodeId = store.selectedNode.id
  const reachable = store.isNodeReachable(nodeId)
  const applied = store.setNodeConnectivity(nodeId, !reachable)
  if (reachable) {
    ElMessage.warning(`已模拟节点 ${store.selectedNode.name} 连接异常，相关配置转为待生效`)
  } else {
    ElMessage.success(`节点 ${store.selectedNode.name} 连接已恢复${applied.length ? `，${applied.join('、')} 的配置已自动生效` : ''}`)
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

.plan-cover-icon {
  color: #22d3ee;
  margin-left: 4px;
}

.param-section {
  margin-top: 10px;
}

.param-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: bold;
  color: #67e8f9;
  margin-bottom: 6px;
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
