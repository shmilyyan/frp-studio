<template>
  <a-form layout="vertical" style="max-width: 480px;">
    <a-form-item label="设备名称">
      <a-input v-model:value="deviceName" placeholder="My-Windows-PC" />
    </a-form-item>

    <a-form-item label="服务端口">
      <a-input-number v-model:value="servicePort" :min="1024" :max="65535" style="width: 100%;" />
    </a-form-item>

    <a-form-item label="文件下载目录">
      <a-input v-model:value="downloadDir" placeholder="Downloads/FrpTransfer" />
    </a-form-item>

    <a-form-item label="剪贴板大小限制">
      <a-input-number v-model:value="clipboardMaxSize" :min="1024" :max="104857600" style="width: 100%;" addon-after="bytes" />
    </a-form-item>

    <a-divider>FRP 隧道</a-divider>

    <a-form-item label="启用 FRP 隧道中转">
      <a-switch v-model:checked="frpTunnelEnabled" />
      <span style="margin-left: 8px; color: #8c9aab; font-size: 12px;">局域网不可达时自动通过 FRP 隧道通信</span>
    </a-form-item>

    <a-form-item>
      <a-button type="primary" @click="handleSave">保存设置</a-button>
      <span v-if="saved" style="margin-left: 12px; color: #52c41a;">设置已保存</span>
    </a-form-item>
  </a-form>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const deviceName = ref('My-Windows-PC')
const servicePort = ref(19528)
const downloadDir = ref('Downloads/FrpTransfer')
const clipboardMaxSize = ref(1048576)
const frpTunnelEnabled = ref(false)
const saved = ref(false)

onMounted(async () => {
  try {
    const status = await window.api.handoff.serviceStatus()
    if (status.health) {
      // Populate with current config values when available
    }
  } catch { /* service may not be running */ }
})

async function handleSave(): Promise<void> {
  try {
    await window.api.config.set({
      handoffDeviceName: deviceName.value,
      handoffPort: servicePort.value,
      handoffDownloadDir: downloadDir.value,
      handoffClipboardMaxSize: clipboardMaxSize.value,
      handoffFrpTunnelEnabled: frpTunnelEnabled.value
    } as unknown as Partial<import('../stores/config').AppConfig>)
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } catch {
    // Silently handle
  }
}
</script>
