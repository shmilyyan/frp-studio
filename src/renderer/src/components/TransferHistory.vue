<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between;">
      <a-radio-group v-model:value="filter" button-style="solid" size="small">
        <a-radio-button value="">全部</a-radio-button>
        <a-radio-button value="clipboard">剪贴板</a-radio-button>
        <a-radio-button value="file">文件</a-radio-button>
      </a-radio-group>
      <a-space>
        <a-button size="small" @click="handleRefresh">刷新</a-button>
        <a-button size="small" @click="handleClear">清空记录</a-button>
      </a-space>
    </div>

    <a-table
      :dataSource="store.transferHistory"
      :columns="columns"
      :pagination="{ pageSize: 20, showSizeChanger: false }"
      size="small"
      rowKey="id"
      :locale="{ emptyText: '暂无传输记录' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <a-tag :color="record.type === 'clipboard' ? 'blue' : 'green'">
            {{ record.type === 'clipboard' ? '剪贴板' : '文件' }}
          </a-tag>
        </template>
        <template v-if="column.key === 'direction'">
          <span :style="{ color: record.direction === 'send' ? '#faad14' : '#4096ff' }">
            {{ record.direction === 'send' ? '发送' : '接收' }}
          </span>
        </template>
        <template v-if="column.key === 'size'">
          {{ formatSize(record.size) }}
        </template>
        <template v-if="column.key === 'status'">
          <span :style="{ color: record.status === 'success' ? '#52c41a' : '#ff4d4f' }">
            {{ record.status === 'success' ? '✓' : '✗' }}
          </span>
        </template>
        <template v-if="column.key === 'created_at'">
          {{ new Date(record.created_at * 1000).toLocaleString() }}
        </template>
        <template v-if="column.key === 'action'">
          <a-button
            v-if="record.type === 'file' && record.status === 'success'"
            size="small"
            type="link"
            @click="openFolder(record.detail)"
          >打开文件夹</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useHandoffStore } from '../stores/handoff'

const store = useHandoffStore()
const filter = ref('')

const columns = [
  { title: '时间', key: 'created_at', dataIndex: 'created_at' },
  { title: '类型', key: 'type', dataIndex: 'type' },
  { title: '方向', key: 'direction', dataIndex: 'direction' },
  { title: '详情', key: 'detail', dataIndex: 'detail' },
  { title: '大小', key: 'size', dataIndex: 'size' },
  { title: '状态', key: 'status', dataIndex: 'status' },
  { title: '操作', key: 'action', dataIndex: 'action' }
]

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

watch(filter, (val) => {
  store.fetchTransferHistory(val || undefined)
})

let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  store.fetchTransferHistory()
  pollTimer = setInterval(() => store.fetchTransferHistory(filter.value || undefined), 3000)
})

onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
})

async function handleRefresh(): Promise<void> {
  await store.fetchTransferHistory(filter.value || undefined)
}

async function handleClear(): Promise<void> {
  await store.clearHistory()
}

async function openFolder(filePath: string): Promise<void> {
  await window.api.handoff.openFolder(filePath)
}
</script>
