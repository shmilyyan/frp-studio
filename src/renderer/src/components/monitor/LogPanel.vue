<template>
  <div class="log-panel">
    <div class="log-toolbar">
      <span class="log-count">{{ logs.length }} 条日志</span>
      <div class="toolbar-actions">
        <a-checkbox v-model:checked="autoScroll" size="small">自动滚动</a-checkbox>
        <a-button size="small" @click="clearLogs">清空</a-button>
        <a-button size="small" @click="exportLogs">导出</a-button>
      </div>
    </div>
    <div class="log-container" ref="logContainer">
      <div
        v-for="log in logs"
        :key="log.id"
        class="log-line"
        :class="log.type"
      >
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <span class="log-type-badge">{{ log.type }}</span>
        <span class="log-text">{{ log.line.trimEnd() }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-empty">
        暂无日志 · 启动 frpc 后日志将显示在这里
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useMonitorStore, type LogEntry } from '../../stores/monitor'
import { message } from 'ant-design-vue'

const monitorStore = useMonitorStore()
const logs = ref<LogEntry[]>(monitorStore.logs)
const logContainer = ref<HTMLElement>()
const autoScroll = ref(true)

watch(
  () => monitorStore.logs,
  (newLogs) => {
    logs.value = newLogs
    if (autoScroll.value) {
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight
        }
      })
    }
  },
  { deep: true }
)

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function clearLogs() {
  monitorStore.clearLogs()
  logs.value = []
}

function exportLogs() {
  const content = monitorStore.exportLogs()
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `frpc-log-${new Date().toISOString().slice(0, 10)}.txt`
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

.log-count {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
