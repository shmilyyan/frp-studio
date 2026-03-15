<template>
  <div class="log-panel">
    <div class="log-toolbar">
      <div class="toolbar-left">
        <a-select
          v-model:value="selectedNodeId"
          placeholder="选择节点"
          style="width: 150px"
          size="small"
        >
          <a-select-option :value="0">全部节点</a-select-option>
          <a-select-option
            v-for="node in runningNodes"
            :key="node.id"
            :value="node.id"
          >
            <span class="node-option">
              <span class="status-dot online"></span>
              {{ node.name }}
            </span>
          </a-select-option>
        </a-select>
        <span class="log-count">{{ displayLogs.length }} 条日志</span>
      </div>
      <div class="toolbar-actions">
        <a-checkbox v-model:checked="autoScroll" size="small">自动滚动</a-checkbox>
        <a-button size="small" @click="clearLogs">清空</a-button>
        <a-button size="small" @click="exportLogs" :disabled="displayLogs.length === 0">导出</a-button>
      </div>
    </div>
    <div class="log-container" ref="logContainer">
      <div
        v-for="log in displayLogs"
        :key="`${log.nodeId}-${log.id}`"
        class="log-line"
        :class="log.type"
      >
        <span class="log-node" v-if="selectedNodeId === 0">{{ getNodeName(log.nodeId) }}</span>
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <span class="log-type-badge">{{ log.type }}</span>
        <span class="log-text">{{ log.line.trimEnd() }}</span>
      </div>
      <div v-if="displayLogs.length === 0" class="log-empty">
        暂无日志 · 在节点管理页面启动 frpc 后日志将显示在这里
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useMonitorStore, type LogEntry } from '../../stores/monitor'
import { useNodeStore } from '../../stores/node'
import { message } from 'ant-design-vue'

const monitorStore = useMonitorStore()
const nodeStore = useNodeStore()

const selectedNodeId = ref(0) // 0 means all nodes
const logContainer = ref<HTMLElement>()
const autoScroll = ref(true)

const runningNodes = computed(() => nodeStore.runningNodes)

const displayLogs = computed(() => {
  if (selectedNodeId.value === 0) {
    // Combine all logs and sort by timestamp
    const allLogs: LogEntry[] = []
    for (const node of nodeStore.nodes) {
      allLogs.push(...monitorStore.getLogs(node.id))
    }
    return allLogs.sort((a, b) => a.timestamp - b.timestamp)
  }
  return monitorStore.getLogs(selectedNodeId.value)
})

function getNodeName(nodeId: number): string {
  const node = nodeStore.nodes.find((n) => n.id === nodeId)
  return node?.name || `Node ${nodeId}`
}

watch(
  () => displayLogs.value.length,
  () => {
    if (autoScroll.value) {
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight
        }
      })
    }
  }
)

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function clearLogs() {
  if (selectedNodeId.value === 0) {
    monitorStore.clearLogs()
  } else {
    monitorStore.clearLogs(selectedNodeId.value)
  }
  message.success('日志已清空')
}

function exportLogs() {
  const nodeId = selectedNodeId.value === 0 ? nodeStore.runningNodes[0]?.id : selectedNodeId.value
  if (!nodeId) {
    message.warning('没有可导出的日志')
    return
  }
  const content = monitorStore.exportLogs(nodeId)
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const nodeName = getNodeName(nodeId)
  a.download = `frpc-${nodeName}-log-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
  message.success('日志已导出')
}
</script>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d0d0d;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.log-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.log-count {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.node-option {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online {
  background: var(--color-success);
  box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.2);
}

.log-container {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  font-family: 'Cascadia Code', 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}

.log-line {
  display: flex;
  gap: 8px;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1.6;
}

.log-line:hover {
  background: rgba(255, 255, 255, 0.03);
}

.log-line.stderr .log-text {
  color: #ff7875;
}
.log-line.error .log-text {
  color: #ff4d4f;
}
.log-line.system .log-text {
  color: #8c8c8c;
}
.log-line.stdout .log-text {
  color: #b7eb8f;
}

.log-node {
  color: var(--color-primary);
  font-size: 11px;
  flex-shrink: 0;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-time {
  color: #595959;
  flex-shrink: 0;
  font-size: 11px;
}

.log-type-badge {
  color: #434343;
  font-size: 10px;
  text-transform: uppercase;
  flex-shrink: 0;
  width: 44px;
}

.log-text {
  color: #d9d9d9;
  word-break: break-all;
  white-space: pre-wrap;
}

.log-empty {
  text-align: center;
  color: #434343;
  padding: 60px 20px;
  font-family: sans-serif;
}
</style>
