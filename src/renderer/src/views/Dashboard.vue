<template>
  <div class="dashboard-view">
    <div class="page-header">
      <h1 class="page-title">仪表盘</h1>
      <p class="page-subtitle">FRP Studio 运行概览</p>
    </div>

    <!-- Status cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">◉</div>
        <div class="stat-body">
          <div class="stat-value">{{ nodeStore.nodes.length }}</div>
          <div class="stat-label">节点总数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⇋</div>
        <div class="stat-body">
          <div class="stat-value">{{ tunnelStore.tunnels.length }}</div>
          <div class="stat-label">隧道总数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">◎</div>
        <div class="stat-body">
          <div class="stat-value">{{ tunnelStore.enabledTunnels.length }}</div>
          <div class="stat-label">启用隧道</div>
        </div>
      </div>
      <div class="stat-card" :class="{ 'stat-card--active': frpcStatus.running }">
        <div class="stat-icon">{{ frpcStatus.running ? '●' : '○' }}</div>
        <div class="stat-body">
          <div class="stat-value" :class="{ 'text-success': frpcStatus.running }">
            {{ frpcStatus.running ? '运行中' : '已停止' }}
          </div>
          <div class="stat-label">frpc 状态</div>
        </div>
      </div>
    </div>

    <!-- Quick tunnel list -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">快捷隧道</h2>
        <router-link to="/tunnels" class="section-link">查看全部 →</router-link>
      </div>
      <div v-if="tunnelStore.tunnels.length === 0" class="empty-hint">
        <router-link to="/tunnels">前往创建隧道</router-link>
      </div>
      <div v-else class="tunnel-quick-list">
        <div
          v-for="tunnel in recentTunnels"
          :key="tunnel.id"
          class="tunnel-quick-item"
        >
          <div class="tunnel-quick-left">
            <a-tag :color="typeColor(tunnel.type)" size="small">
              {{ tunnel.type.toUpperCase() }}
            </a-tag>
            <span class="tunnel-quick-name">{{ tunnel.name }}</span>
          </div>
          <div class="tunnel-quick-right">
            <span class="tunnel-quick-addr">
              {{ tunnel.local_ip }}:{{ tunnel.local_port }}
              {{ tunnel.remote_port ? `→ :${tunnel.remote_port}` : '' }}
            </span>
            <span
              class="status-dot"
              :class="tunnel.enabled === 1 ? 'online' : 'offline'"
            ></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Nodes quick list -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">节点状态</h2>
        <router-link to="/nodes" class="section-link">管理节点 →</router-link>
      </div>
      <div v-if="nodeStore.nodes.length === 0" class="empty-hint">
        <router-link to="/nodes">前往添加节点</router-link>
      </div>
      <div v-else class="nodes-quick-list">
        <div v-for="node in nodeStore.nodes" :key="node.id" class="node-quick-item">
          <span
            class="status-dot"
            :class="frpcStatus.running && frpcStatus.nodeId === node.id ? 'online' : 'offline'"
          ></span>
          <span class="node-quick-name">{{ node.name }}</span>
          <span class="node-quick-host">{{ node.host }}:{{ node.port }}</span>
          <span class="node-quick-tunnels">
            {{ tunnelStore.tunnels.filter((t) => t.node_id === node.id).length }} 条隧道
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useNodeStore } from '../stores/node'
import { useTunnelStore } from '../stores/tunnel'

const nodeStore = useNodeStore()
const tunnelStore = useTunnelStore()

const frpcStatus = computed(() => tunnelStore.frpcStatus)
const recentTunnels = computed(() => tunnelStore.tunnels.slice(0, 8))

onMounted(async () => {
  await Promise.all([nodeStore.fetchNodes(), tunnelStore.fetchTunnels()])
})

function typeColor(type: string): string {
  const map: Record<string, string> = { tcp: 'blue', udp: 'purple', http: 'green', https: 'cyan' }
  return map[type] || 'default'
}
</script>

<style scoped>
.dashboard-view {
  max-width: 1200px;
}

.page-header {
  margin-bottom: 24px;
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: border-color 0.2s;
}

.stat-card--active {
  border-color: var(--color-success);
  background: rgba(73, 170, 25, 0.05);
}

.stat-icon {
  font-size: 28px;
  color: var(--color-text-tertiary);
  width: 36px;
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.text-success {
  color: var(--color-success);
}

.stat-label {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.section-link {
  font-size: 12px;
  color: var(--color-primary);
  text-decoration: none;
}

.empty-hint {
  color: var(--color-text-tertiary);
  font-size: 13px;
  padding: 20px;
  text-align: center;
  background: var(--color-bg-elevated);
  border-radius: 8px;
  border: 1px dashed var(--color-border);
}

.tunnel-quick-list,
.nodes-quick-list {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.tunnel-quick-item,
.node-quick-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
}

.tunnel-quick-item:last-child,
.node-quick-item:last-child {
  border-bottom: none;
}

.tunnel-quick-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.tunnel-quick-name,
.node-quick-name {
  color: var(--color-text-primary);
}

.tunnel-quick-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tunnel-quick-addr {
  font-family: 'Consolas', monospace;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.node-quick-host {
  font-family: 'Consolas', monospace;
  color: var(--color-text-secondary);
  font-size: 12px;
  flex: 1;
}

.node-quick-tunnels {
  color: var(--color-text-tertiary);
  font-size: 12px;
}
</style>
