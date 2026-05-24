<template>
  <div class="handoff-page">
    <a-page-header title="设备接力" sub-title="iOS &amp; Windows 剪贴板 · 文件 · 设备发现">
      <template #extra>
        <a-space>
          <a-badge :status="store.isRunning ? 'processing' : 'default'" />
          <span style="color: #8c9aab;">{{ store.isRunning ? '服务运行中' : '服务已停止' }}</span>
          <a-button size="small" @click="store.restartService()">重启服务</a-button>
        </a-space>
      </template>
    </a-page-header>

    <a-tabs v-model:activeKey="activeTab" style="padding: 0 24px;">
      <a-tab-pane key="devices" tab="设备管理">
        <DeviceList />
      </a-tab-pane>
      <a-tab-pane key="history" tab="传输记录">
        <TransferHistory />
      </a-tab-pane>
      <a-tab-pane key="settings" tab="服务设置">
        <HandoffSettings />
      </a-tab-pane>
      <a-tab-pane key="diagnostic" tab="诊断">
        <DiagnosticTab />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useHandoffStore } from '../stores/handoff'
import DeviceList from '../components/DeviceList.vue'
import TransferHistory from '../components/TransferHistory.vue'
import HandoffSettings from '../components/HandoffSettings.vue'
import DiagnosticTab from '../components/DiagnosticTab.vue'

const store = useHandoffStore()
const activeTab = ref('devices')

onMounted(async () => {
  await store.fetchServiceStatus()
  await store.fetchDevices()
  store.connectSSE()
})

onUnmounted(() => {
  store.disconnectSSE()
})
</script>
