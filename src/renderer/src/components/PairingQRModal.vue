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
import { useHandoffStore } from '../stores/handoff'

const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()

const store = useHandoffStore()
const qrCanvas = ref<HTMLCanvasElement | null>(null)

watch(() => props.open, async (val) => {
  if (val) {
    await nextTick()
    await generateQR()
  }
})

async function generateQR(): Promise<void> {
  if (!qrCanvas.value) return
  const result = await store.generatePairing('My iPhone', 'placeholder-key')
  if (result.success && result.qrData) {
    drawQR(qrCanvas.value, result.qrData)
  }
}

async function handleRefresh(): Promise<void> {
  await generateQR()
}

function drawQR(canvas: HTMLCanvasElement, data: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // Simple QR placeholder — install 'qrcode' package for real QR rendering:
  // pnpm add qrcode && pnpm add -D @types/qrcode
  // Then: import QRCode from 'qrcode'; QRCode.toCanvas(canvas, data);
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 256, 256)
  ctx.fillStyle = '#000'
  ctx.font = '12px monospace'
  ctx.textAlign = 'center'
  const lines = data.match(/.{1,40}/g) || [data]
  lines.forEach((line, i) => {
    ctx.fillText(line, 128, 120 + i * 16)
  })
}
</script>
