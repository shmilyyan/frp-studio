<template>
  <div class="monitor-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">监控面板</h1>
        <p class="page-subtitle">实时日志与运行状态</p>
      </div>
    </div>

    <!-- Stats row -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value" :class="{ running: frpcStatus.running }">
          {{ frpcStatus.running ? '运行中' : '已停止' }}
        </div>
        <div class="stat-label">frpc 状态</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ frpcStatus.pid || '-' }}</div>
        <div class="stat-label">进程 PID</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ enabledCount }}</div>
        <div class="stat-label">启用隧道数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ totalConnections }}</div>
        <div class="stat-label">连接次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ runningTime }}</div>
        <div class="stat-label">运行时长</div>
      </div>
    </div>

    <!-- Traffic chart -->
    <div class="chart-section">
      <TrafficChart />
    </div>

    <!-- Log panel -->
    <div class="log-section">
      <LogPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useTunnelStore } from '../stores/tunnel'
import { useMonitorStore } from '../stores/monitor'
import LogPanel from '../components/monitor/LogPanel.vue'
import TrafficChart from '../components/monitor/TrafficChart.vue'

const tunnelStore = useTunnelStore()
const monitorStore = useMonitorStore()

const frpcStatus = computed(() => tunnelStore.frpcStatus)
const enabledCount = computed(() => tunnelStore.enabledTunnels.length)
const totalConnections = computed(() =>
  monitorStore.traffic.reduce((sum, p) => sum + p.connections, 0)
)

const runningTime = ref('-')
let timer: ReturnType<typeof setInterval>

onMounted(() => {
  timer = setInterval(() => {
    if (frpcStatus.value.running && frpcStatus.value.startedAt) {
      const ms = Date.now() - frpcStatus.value.startedAt
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      runningTime.value =
        h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
    } else {
      runningTime.value = '-'
    }
  }, 1000)
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

.stats-row {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
  flex-shrink: 0;
}

.stat-card {
  flex: 1;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px 16px;
  text-align: center;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-family: 'Consolas', monospace;
}

.stat-value.running {
  color: var(--color-success);
}

.stat-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
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
