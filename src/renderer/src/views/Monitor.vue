<template>
  <div class="monitor-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">监控面板</h1>
        <p class="page-subtitle">实时日志与运行状态</p>
      </div>
    </div>

    <!-- Running nodes summary -->
    <div class="nodes-summary">
      <div v-if="runningNodes.length === 0" class="no-running">
        <span class="no-running-icon">○</span>
        <span>暂无运行中的节点</span>
        <router-link to="/nodes">前往节点管理</router-link>
      </div>
      <div v-else class="running-nodes-grid">
        <!-- All nodes option -->
        <div
          class="running-node-card all-nodes"
          :class="{ active: selectedNodeId === 0 }"
          @click="selectedNodeId = 0"
        >
          <div class="node-header">
            <span class="status-dot" :class="runningNodes.length > 0 ? 'online' : 'offline'"></span>
            <span class="node-name">全部节点</span>
          </div>
          <div class="node-stats">
            <div class="node-stat">
              <span class="stat-value">{{ runningNodes.length }}</span>
              <span class="stat-label">运行中</span>
            </div>
            <div class="node-stat">
              <span class="stat-value">{{ totalTunnels }}</span>
              <span class="stat-label">隧道数</span>
            </div>
          </div>
        </div>
        <!-- Individual nodes -->
        <div
          v-for="node in runningNodes"
          :key="node.id"
          class="running-node-card"
          :class="{ active: selectedNodeId === node.id }"
          @click="selectedNodeId = node.id"
        >
          <div class="node-header">
            <span class="status-dot online"></span>
            <span class="node-name">{{ node.name }}</span>
          </div>
          <div class="node-stats">
            <div class="node-stat">
              <span class="stat-value">{{ getFrpcStatus(node.id)?.pid || '-' }}</span>
              <span class="stat-label">PID</span>
            </div>
            <div class="node-stat">
              <span class="stat-value">{{ getRunningTime(node.id) }}</span>
              <span class="stat-label">运行时长</span>
            </div>
            <div class="node-stat">
              <span class="stat-value">{{ getEnabledTunnelCount(node.id) }}</span>
              <span class="stat-label">隧道数</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Traffic chart -->
    <div class="chart-section">
      <TrafficChart :node-id="selectedNodeId" />
    </div>

    <!-- Log panel -->
    <div class="log-section">
      <LogPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useNodeStore, type FrpcStatus } from '../stores/node'
import { useTunnelStore } from '../stores/tunnel'
import LogPanel from '../components/monitor/LogPanel.vue'
import TrafficChart from '../components/monitor/TrafficChart.vue'

const nodeStore = useNodeStore()
const tunnelStore = useTunnelStore()

const selectedNodeId = ref(0)
const runningTimes = ref(new Map<number, string>())
let timer: ReturnType<typeof setInterval>

const runningNodes = computed(() => nodeStore.runningNodes)

const totalTunnels = computed(() => {
  return runningNodes.value.reduce((sum, node) => sum + getEnabledTunnelCount(node.id), 0)
})

function getFrpcStatus(nodeId: number): FrpcStatus | undefined {
  return nodeStore.frpcStatuses[nodeId]
}

function getEnabledTunnelCount(nodeId: number): number {
  return tunnelStore.enabledTunnelsByNode(nodeId).length
}

function getRunningTime(nodeId: number): string {
  return runningTimes.value.get(nodeId) || '-'
}

function updateRunningTimes() {
  for (const node of nodeStore.nodes) {
    const status = nodeStore.frpcStatuses[node.id]
    if (status?.running && status.startedAt) {
      const ms = Date.now() - status.startedAt
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      runningTimes.value.set(
        node.id,
        h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
      )
    } else {
      runningTimes.value.delete(node.id)
    }
  }
}

onMounted(async () => {
  await Promise.all([
    nodeStore.fetchNodes(),
    nodeStore.fetchAllFrpcStatus(),
    tunnelStore.fetchTunnels()
  ])
  updateRunningTimes()
  timer = setInterval(updateRunningTimes, 1000)
})

onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.monitor-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--header-height) - 48px);
  max-width: 1400px;
}

.page-header {
  margin-bottom: 16px;
  flex-shrink: 0;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.page-subtitle {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
}

.nodes-summary {
  margin-bottom: 14px;
  flex-shrink: 0;
}

.no-running {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--color-bg-elevated);
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.no-running-icon {
  font-size: 20px;
  color: var(--color-text-tertiary);
}

.no-running a {
  color: var(--color-primary);
  margin-left: auto;
}

.running-nodes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.running-node-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.running-node-card:hover {
  border-color: var(--color-primary);
}

.running-node-card.active {
  border-color: var(--color-success);
  background: rgba(73, 170, 25, 0.05);
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.node-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.node-stats {
  display: flex;
  gap: 16px;
}

.node-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.node-stat .stat-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-family: 'Consolas', monospace;
}

.node-stat .stat-label {
  font-size: 10px;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online {
  background: var(--color-success);
  box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.2);
}

.chart-section {
  margin-bottom: 14px;
  flex-shrink: 0;
}

.log-section {
  flex: 1;
  min-height: 0;
}
</style>
