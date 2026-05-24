<template>
  <a-modal
    :open="open"
    title="配对二维码"
    @cancel="$emit('close')"
    :footer="null"
    width="400px"
  >
    <div style="text-align: center;">
      <p style="color: #8c9aab; margin-bottom: 16px;">使用 iOS Handoff App 扫描此二维码完成配对</p>
      <div style="background: #fff; padding: 16px; display: inline-block; border-radius: 8px;">
        <canvas ref="qrCanvas" width="256" height="256"></canvas>
      </div>
      <p style="color: #8c9aab; margin-top: 12px; font-size: 12px;">二维码有效期：5 分钟</p>
      <a-button type="link" @click="handleRefresh" style="margin-top: 8px;">刷新二维码</a-button>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { message } from 'ant-design-vue'
import { useHandoffStore } from '../stores/handoff'
import QRCode from 'qrcode'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useHandoffStore()
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const initialDeviceCount = ref(0)

watch(() => props.open, async (val) => {
  if (val) {
    initialDeviceCount.value = store.devices.length
    await nextTick()
    await generateQR()
  }
})

// Auto-close when a new device is paired
watch(() => store.devices.length, (count) => {
  if (props.open && count > initialDeviceCount.value) {
    emit('close')
  }
})

async function generateQR(): Promise<void> {
  if (!qrCanvas.value) return
  try {
    const result = await store.generatePairing('My iPhone', '')
    if (result.success && result.qrData) {
      drawQR(qrCanvas.value, result.qrData)
    } else {
      message.error(result.error || '生成配对码失败')
    }
  } catch {
    message.error('无法连接接力服务，请确认服务已启动')
  }
}

async function handleRefresh(): Promise<void> {
  await generateQR()
}

function drawQR(canvas: HTMLCanvasElement, data: string): void {
  QRCode.toCanvas(canvas, data, { width: 256 }, (err) => {
    if (err) message.error('二维码生成失败')
  })
}
</script>
