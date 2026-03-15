<template>
  <div class="node-card" :class="{ 'node-card--running': isRunning }">
    <div class="node-card-header">
      <div class="node-info">
        <span class="status-dot" :class="isRunning ? 'online' : 'offline'"></span>
        <h3 class="node-name">{{ node.name }}</h3>
      </div>
      <div class="node-actions">
        <!-- Start/Stop button -->
        <a-button
          v-if="!isRunning"
          type="primary"
          size="small"
          @click="$emit('start', node)"
        >
          启动
        </a-button>
        <a-button
          v-else
          danger
          size="small"
          @click="$emit('stop', node)"
        >
          停止
        </a-button>
        <a-tooltip title="测试连接">
          <a-button size="small" @click="$emit('test', node)">测试</a-button>
        </a-tooltip>
        <a-dropdown :trigger="['click']">
          <a-button size="small">···</a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item @click="$emit('config', node)">配置管理</a-menu-item>
              <a-menu-item @click="$emit('edit', node)">编辑</a-menu-item>
              <a-menu-divider />
              <a-menu-item @click="$emit('delete', node)" danger>删除</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </div>

    <!-- Running status bar -->
    <div v-if="isRunning && frpcStatus" class="running-status-bar">
      <span class="status-info">
        <span class="status-label">运行中</span>
        <span class="status-pid">PID: {{ frpcStatus.pid }}</span>
      </span>
      <span class="status-time">
        启动于 {{ formatTime(frpcStatus.startedAt) }}
      </span>
    </div>

    <div class="node-card-body">
      <div class="node-meta">
        <span class="meta-item">
          <span class="meta-label">地址</span>
          <span class="meta-value">{{ node.host }}:{{ node.port }}</span>
        </span>
        <span class="meta-item">
          <span class="meta-label">认证</span>
          <span class="meta-value">{{ node.token ? 'Token' : '无' }}</span>
        </span>
        <span class="meta-item">
          <span class="meta-label">隧道</span>
          <span class="meta-value">{{ tunnelCount }} 条 / {{ enabledTunnelCount }} 启用</span>
        </span>
      </div>

      <!-- Auto-start setting -->
      <div class="auto-start-setting">
        <a-switch
          :checked="node.auto_start === 1"
          size="small"
          @change="(checked: boolean) => $emit('toggle-auto-start', node, checked)"
        />
        <span class="auto-start-label">应用启动后自动启动</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Node, FrpcStatus } from '../../stores/node'
import { useTunnelStore } from '../../stores/tunnel'

interface Props {
  node: Node
  isRunning: boolean
  frpcStatus?: FrpcStatus
}

const props = defineProps<Props>()

defineEmits<{
  test: [node: Node]
  config: [node: Node]
  edit: [node: Node]
  delete: [node: Node]
  start: [node: Node]
  stop: [node: Node]
  'toggle-auto-start': [node: Node, enabled: boolean]
}>()

const tunnelStore = useTunnelStore()

const tunnelCount = computed(
  () => tunnelStore.tunnels.filter((t) => t.node_id === props.node.id).length
)

const enabledTunnelCount = computed(
  () => tunnelStore.tunnels.filter((t) => t.node_id === props.node.id && t.enabled === 1).length
)

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<style scoped>
.node-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
  transition: border-color 0.2s;
}

.node-card:hover {
  border-color: var(--color-primary);
}

.node-card--running {
  border-color: var(--color-success);
  background: rgba(73, 170, 25, 0.03);
}

.node-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.node-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.node-actions {
  display: flex;
  gap: 6px;
}

.running-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(73, 170, 25, 0.1);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 12px;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-label {
  color: var(--color-success);
  font-weight: 500;
}

.status-pid {
  color: var(--color-text-secondary);
  font-family: 'Consolas', monospace;
}

.status-time {
  color: var(--color-text-tertiary);
}

.node-card-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.node-meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-value {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-family: 'Consolas', monospace;
}

.auto-start-setting {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.auto-start-label {
  font-size: 12px;
  color: var(--color-text-secondary);
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

.status-dot.offline {
  background: var(--color-text-tertiary);
}
</style>
