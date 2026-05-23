<template>
  <div>
    <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
      <span style="color: #8c9aab;">共 {{ store.devices.length }} 台已配对设备</span>
      <a-button type="primary" @click="showQRModal = true" :disabled="!store.isRunning">生成配对码</a-button>
    </div>

    <a-list
      :data-source="store.devices"
      :locale="{ emptyText: '暂无已配对设备，点击 生成配对码 开始配对' }"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <a-list-item-meta>
            <template #avatar>
              <span style="font-size: 24px;">📱</span>
            </template>
            <template #title>
              {{ item.device_name }}
              <a-tag :color="item.enabled ? 'green' : 'default'" style="margin-left: 8px;">
                {{ item.enabled ? '已启用' : '已停用' }}
              </a-tag>
            </template>
            <template #description>
              {{ item.platform }} · ID: {{ item.device_id }} · 配对于 {{ new Date(item.paired_at * 1000).toLocaleDateString() }}
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-button size="small" type="link" danger @click="handleDelete(item.id)">解除配对</a-button>
          </template>
        </a-list-item>
      </template>
    </a-list>

    <PairingQRModal :open="showQRModal" @close="showQRModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useHandoffStore } from '../stores/handoff'
import PairingQRModal from './PairingQRModal.vue'

const store = useHandoffStore()
const showQRModal = ref(false)

async function handleDelete(id: number): Promise<void> {
  await store.deleteDevice(id)
}
</script>
