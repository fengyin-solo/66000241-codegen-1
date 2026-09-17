<template>
  <div class="app-container">
    <!-- 顶部导航栏 -->
    <header class="app-header">
      <div class="header-left">
        <el-icon :size="24" class="text-cyan-400"><Monitor /></el-icon>
        <h1 class="app-title">OPC-UA 工业节点浏览与数据采集</h1>
      </div>
      <div class="header-right">
        <!-- 视图切换：实时监控 / 采集方案 -->
        <el-radio-group v-model="currentView" size="small" class="view-switcher">
          <el-radio-button value="dashboard">实时监控</el-radio-button>
          <el-radio-button value="schemes">
            采集方案
            <el-badge
              v-if="store.pendingNodeList.length > 0"
              :value="store.pendingNodeList.length"
              class="pending-badge"
            />
          </el-radio-button>
        </el-radio-group>

        <el-badge :value="store.activeAlarmsCount" :max="99" class="alarm-badge">
          <el-icon :size="20" class="text-yellow-400"><Bell /></el-icon>
        </el-badge>
        <el-tag type="success" v-if="store.isConnected" class="status-tag">
          <el-icon><CircleCheck /></el-icon>
          在线
        </el-tag>
        <el-tag type="danger" v-else class="status-tag">
          <el-icon><CircleClose /></el-icon>
          离线
        </el-tag>
        <el-button
          :type="store.isConnected ? 'danger' : 'success'"
          size="small"
          @click="toggleConnection"
        >
          {{ store.isConnected ? '断开' : '连接' }}
        </el-button>
      </div>
    </header>

    <!-- 主内容区域 -->
    <div class="app-main">
      <!-- 左侧面板: 节点树 -->
      <aside class="left-panel">
        <NodeTree />
      </aside>

      <!-- 中央区域: 仪表盘 / 采集方案 -->
      <main class="center-panel">
        <DataDashboard v-if="currentView === 'dashboard'" />
        <CollectionSchemePanel v-else />
      </main>

      <!-- 右侧面板: 报警列表 -->
      <aside class="right-panel">
        <div class="alarm-panel">
          <div class="alarm-header">
            <h3 class="text-lg font-bold text-yellow-400">报警事件</h3>
            <el-button type="danger" size="small" text @click="store.clearAlarms()" v-if="store.alarms.length > 0">
              清空
            </el-button>
          </div>

          <div class="alarm-stats">
            <el-tag type="danger" size="small">严重: {{ criticalCount }}</el-tag>
            <el-tag type="warning" size="small">活跃: {{ store.activeAlarmsCount }}</el-tag>
            <el-tag type="info" size="small">总计: {{ store.alarms.length }}</el-tag>
          </div>

          <div class="alarm-list">
            <div
              v-for="alarm in store.alarms"
              :key="alarm.id"
              class="alarm-item"
              :class="{
                'alarm-critical': alarm.severity === 'Critical',
                'alarm-high': alarm.severity === 'High',
                'alarm-medium': alarm.severity === 'Medium',
                'alarm-acknowledged': alarm.acknowledged
              }"
            >
              <div class="alarm-item-header">
                <el-tag
                  :type="getSeverityType(alarm.severity)"
                  size="small"
                  effect="dark"
                >
                  {{ getSeverityLabel(alarm.severity) }}
                </el-tag>
                <span class="alarm-time">{{ formatTime(alarm.timestamp) }}</span>
              </div>
              <div class="alarm-item-body">
                <span class="alarm-node">{{ alarm.nodeName }}</span>
                <p class="alarm-message">{{ alarm.message }}</p>
              </div>
              <el-button
                v-if="!alarm.acknowledged"
                type="primary"
                size="small"
                text
                @click="store.acknowledgeAlarm(alarm.id)"
              >
                确认
              </el-button>
            </div>

            <div v-if="store.alarms.length === 0" class="no-alarms">
              <el-empty description="暂无报警" :image-size="60" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Monitor, Bell, CircleCheck, CircleClose } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useOpcuaStore } from './store/opcua'
import NodeTree from './components/NodeTree.vue'
import DataDashboard from './components/DataDashboard.vue'
import CollectionSchemePanel from './components/CollectionSchemePanel.vue'
import type { AlarmEvent } from './types'

const store = useOpcuaStore()
const updateTimer = ref<number | null>(null)
const currentView = ref<'dashboard' | 'schemes'>('dashboard')

const criticalCount = computed(() =>
  store.alarms.filter(a => a.severity === 'Critical' && !a.acknowledged).length
)

function toggleConnection() {
  if (store.isConnected) {
    store.disconnect()
    if (updateTimer.value) {
      clearInterval(updateTimer.value)
      updateTimer.value = null
    }
    ElMessage.warning('已断开 OPC-UA 连接')
  } else {
    store.connect()
    startSimulation()
    ElMessage.success('已连接 OPC-UA 服务器')
  }
}

function startSimulation() {
  updateTimer.value = window.setInterval(() => {
    store.simulateDataUpdate()
    // 连接抖动/恢复检测：恢复的待生效节点自动补发
    const event = store.reconcileConnections()
    event.flapped.forEach(id => {
      ElMessage.warning(`节点 ${store.nodeNameOf(id) || id} 连接异常`)
    })
    event.recoveredPending.forEach(id => {
      ElMessage.success(`节点 ${store.nodeNameOf(id) || id} 连接恢复，采集配置已自动补发生效`)
    })
  }, 1000)
}

function getSeverityType(severity: AlarmEvent['severity']) {
  switch (severity) {
    case 'Critical': return 'danger'
    case 'High': return 'danger'
    case 'Medium': return 'warning'
    case 'Low': return 'info'
    case 'Info': return 'info'
  }
}

function getSeverityLabel(severity: AlarmEvent['severity']) {
  switch (severity) {
    case 'Critical': return '严重'
    case 'High': return '高'
    case 'Medium': return '中'
    case 'Low': return '低'
    case 'Info': return '信息'
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

onMounted(() => {
  // 先恢复持久化的采集方案，再建立连接并重新应用生效方案（刷新后保留）
  store.restore()
  store.connect()
  startSimulation()
})

onUnmounted(() => {
  if (updateTimer.value) {
    clearInterval(updateTimer.value)
  }
})
</script>

<style scoped>
.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0f172a;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 56px;
  background: rgba(15, 23, 42, 0.95);
  border-bottom: 1px solid rgba(71, 85, 105, 0.5);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title {
  font-size: 18px;
  font-weight: bold;
  background: linear-gradient(90deg, #06b6d4, #22d3ee);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.view-switcher {
  margin-right: 4px;
}

.pending-badge {
  margin-left: 6px;
}

.status-tag {
  display: flex;
  align-items: center;
  gap: 4px;
}

.app-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-panel {
  width: 320px;
  background: rgba(30, 41, 59, 0.6);
  border-right: 1px solid rgba(71, 85, 105, 0.5);
  overflow-y: auto;
  flex-shrink: 0;
}

.center-panel {
  flex: 1;
  overflow-y: auto;
  background: #0f172a;
}

.right-panel {
  width: 340px;
  background: rgba(30, 41, 59, 0.6);
  border-left: 1px solid rgba(71, 85, 105, 0.5);
  overflow-y: auto;
  flex-shrink: 0;
}

.alarm-panel {
  padding: 12px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.alarm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.alarm-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.alarm-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alarm-item {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(71, 85, 105, 0.5);
  border-radius: 6px;
  padding: 10px;
  border-left: 3px solid #64748b;
}

.alarm-critical {
  border-left-color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.alarm-high {
  border-left-color: #f97316;
  background: rgba(249, 115, 22, 0.05);
}

.alarm-medium {
  border-left-color: #eab308;
  background: rgba(234, 179, 8, 0.05);
}

.alarm-acknowledged {
  opacity: 0.5;
}

.alarm-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.alarm-time {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}

.alarm-node {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 500;
}

.alarm-message {
  font-size: 13px;
  color: #cbd5e1;
  margin-top: 4px;
}

.no-alarms {
  display: flex;
  justify-content: center;
  padding-top: 40px;
}

.alarm-badge {
  cursor: pointer;
}
</style>
