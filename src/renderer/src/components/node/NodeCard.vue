<template>
  <div class="node-card">
    <div class="node-card-header">
      <div class="node-info">
        <span class="status-dot" :class="statusClass"></span>
        <h3 class="node-name">{{ node.name }}</h3>
      </div>
      <div class="node-actions">
        <a-tooltip title="测试连接">
          <a-button size="small" @click="$emit('test', node)">测试</a-button>
        </a-tooltip>
        <a-tooltip title="配置管理">
          <a-button size="small" @click="$emit('config', node)">配置</a-button>
        </a-tooltip>
        <a-dropdown :trigger="['click']">
          <a-button size="small">···</a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item @click="$emit('edit', node)">编辑</a-menu-item>
              <a-menu-item @click="$emit('start', node)" :disabled="frpcStatus.running">
                启动隧道
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item @click="$emit('delete', node)" danger>删除</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
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
          <span class="meta-label">隧道数</span>
          <span class="meta-value">{{ tunnelCount }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Node } from '../../stores/node'
import { useTunnelStore } from '../../stores/tunnel'

interface Props {
  node: Node
}

const props = defineProps<Props>()
defineEmits<{
  test: [node: Node]
  config: [node: Node]
  edit: [node: Node]
  delete: [node: Node]
  start: [node: Node]
}>()

const tunnelStore = useTunnelStore()
const frpcStatus = computed(() => tunnelStore.frpcStatus)

const tunnelCount = computed(
  () => tunnelStore.tunnels.filter((t) => t.node_id === props.node.id).length
)

const statusClass = computed(() => {
  if (frpcStatus.value.running && frpcStatus.value.nodeId === props.node.id) return 'online'
  return 'offline'
})
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
</style>
