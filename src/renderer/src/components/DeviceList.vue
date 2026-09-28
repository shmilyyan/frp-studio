<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <span style="color: #8c9aab;">共 {{ store.devices.length }} 台已配对设备</span>
      <a-space>
        <a-button size="small" @click="store.fetchDevices()">刷新</a-button>
        <a-button type="primary" @click="showQRModal = true" :disabled="!store.isRunning">生成配对码</a-button>
      </a-space>
    </div>

    <a-list
      :data-source="store.devices"
      :locale="{ emptyText: '暂无已配对设备，点击 生成配对码 开始配对' }"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #avatar>
              <span style="font-size: 20px;">
                <span v-if="store.onlineDevices[item.deviceId] === 'online'" style="color: #52c41a;">●</span>
                <span v-else style="color: #8c9aab;">●</span>
              </span>
            </template>
            <template #title>
              {{ item.deviceName }}
              <a-tag :color="item.enabled ? 'green' : 'default'" style="margin-left: 8px;">
                {{ item.enabled ? '已启用' : '已停用' }}
              </a-tag>
              <a-tag v-if="store.onlineDevices[item.deviceId] === 'online'" color="green" style="margin-left: 4px;">在线</a-tag>
              <a-tag v-else color="default" style="margin-left: 4px;">离线</a-tag>
            </template>
            <template #description>
              <div>ID: {{ item.deviceId }}</div>
              <div v-if="item.lastIp">IP: {{ item.lastIp }}</div>
              <div v-if="item.lastSeen">最后在线: {{ new Date(item.lastSeen * 1000).toLocaleString() }}</div>
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-button size="small" type="link" danger @click="handleDelete(item.deviceId)">解除配对</a-button>
          </template>
        </a-list-item>
      </template>
    </a-list>

    <div style="margin: 24px 0 12px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-weight: 600;">局域网发现</span>
      <a-button size="small" @click="handleScan" :loading="scanning" :disabled="!store.isRunning">手动扫描</a-button>
    </div>
    <a-list
      :data-source="discoveredList"
      :locale="{ emptyText: '暂无局域网发现设备' }"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #title>
              {{ item.deviceName }}
              <a-tag :color="item.status === 'reachable' ? 'orange' : 'default'" style="margin-left: 8px;">
                {{ item.status === 'offline' ? '离线' : !item.port ? '已发现，等待客户端连接' : !item.host ? '已发现，地址待解析' : '可达' }}
              </a-tag>
            </template>
            <template #description>
              <div>平台: {{ item.platform }}</div>
              <div v-if="item.host">地址: {{ item.host }}<span v-if="item.port">:{{ item.port }}</span></div>
              <div v-else>地址: 待解析</div>
              <div>最后发现: {{ new Date(item.lastSeen).toLocaleString() }}</div>
            </template>
          </a-list-item-meta>
        </a-list-item>
      </template>
    </a-list>

    <PairingQRModal :open="showQRModal" @close="showQRModal = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHandoffStore } from '../stores/handoff'
import PairingQRModal from './PairingQRModal.vue'

const store = useHandoffStore()
const showQRModal = ref(false)
const scanning = ref(false)
const discoveredList = computed(() =>
  Object.values(store.discoveredPeers).sort((a, b) => b.lastSeen - a.lastSeen)
)

async function handleDelete(deviceId: string): Promise<void> {
  await store.deleteDevice(deviceId)
}

async function handleScan(): Promise<void> {
  scanning.value = true
  try {
    await store.scanDevices()
    await new Promise(resolve => setTimeout(resolve, 1600))
  } finally {
    scanning.value = false
  }
}
</script>
