<template>
  <div>
    <a-row :gutter="16">
      <a-col :span="8">
        <a-card size="small" title="服务状态">
          <p>版本: {{ version }}</p>
          <p>运行时间: {{ uptime }}s</p>
          <p>WS 客户端: {{ wsClients }}</p>
          <p>剪贴板缓存: {{ clipboardCache }}</p>
          <p>已配对设备: {{ pairedDevices }}</p>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card size="small" title="剪贴板测试">
          <a-space direction="vertical" style="width: 100%;">
            <a-button block @click="testGet" :loading="getLoading">
              获取 Windows 剪贴板
            </a-button>
            <a-input v-model:value="testText" placeholder="输入测试文本" />
            <a-button block type="primary" @click="testSend" :loading="sendLoading">
              发送到 Windows 剪贴板
            </a-button>
            <div v-if="testResult" style="color: #52c41a; word-break: break-all;">
              {{ testResult }}
            </div>
            <div v-if="testError" style="color: #ff4d4f;">
              {{ testError }}
            </div>
          </a-space>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card size="small" title="事件日志">
          <div ref="logContainer" style="max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px;">
            <div v-for="(log, i) in logs" :key="i" style="padding: 2px 0; border-bottom: 1px solid #3a3f47;">
              <span style="color: #8c9aab;">{{ log.time }}</span>
              <span :style="{ color: log.level === 'error' ? '#ff4d4f' : log.level === 'warn' ? '#faad14' : '#8c9aab' }">
                [{{ log.level }}]
              </span>
              {{ log.msg }}
            </div>
            <div v-if="logs.length === 0" style="color: #555;">等待事件...</div>
          </div>
          <a-button size="small" @click="logs = []" style="margin-top: 8px;">清空</a-button>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

interface LogEntry { time: string; level: string; msg: string }

const version = ref('')
const uptime = ref(0)
const wsClients = ref(0)
const clipboardCache = ref('')
const pairedDevices = ref(0)
const testText = ref('')
const testResult = ref('')
const testError = ref('')
const getLoading = ref(false)
const sendLoading = ref(false)
const logs = ref<LogEntry[]>([])
const logContainer = ref<HTMLElement | null>(null)

let cleanupEvent: (() => void) | null = null
let cleanupStatus: (() => void) | null = null

function addLog(level: string, msg: string): void {
  const time = new Date().toLocaleTimeString()
  logs.value.push({ time, level, msg })
  if (logs.value.length > 50) logs.value.shift()
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

async function fetchStatus(): Promise<void> {
  try {
    const res = await window.api.handoff.serviceStatus()
    if (res.health) {
      version.value = res.health.version || '?'
      uptime.value = Math.floor(res.health.uptime || 0)
      wsClients.value = res.health.connections || 0
      const cfg = (res.health as any).config
      if (cfg) pairedDevices.value = cfg.pairedDevices?.length || 0
    }
    // Also try /debug/status via fetch
    const debugRes = await fetch('http://127.0.0.1:19528/debug/status')
    if (debugRes.ok) {
      const debug = await debugRes.json()
      wsClients.value = debug.wsClients || wsClients.value
      clipboardCache.value = debug.clipboardCache || ''
      pairedDevices.value = debug.pairedDevices || pairedDevices.value
    }
  } catch {
    addLog('error', '无法获取服务状态')
  }
}

async function testGet(): Promise<void> {
  getLoading.value = true
  testResult.value = ''
  testError.value = ''
  addLog('info', '测试: 获取剪贴板')
  try {
    const res = await fetch('http://127.0.0.1:19528/clipboard/latest')
    const data = await res.json()
    if (data.payload) {
      testResult.value = data.payload
      addLog('info', `剪贴板获取成功 (${data.payload.length} 字符)`)
    } else {
      testError.value = '剪贴板为空'
      addLog('warn', '剪贴板为空')
    }
  } catch (e) {
    testError.value = '请求失败: ' + String(e)
    addLog('error', '请求失败: ' + String(e))
  }
  getLoading.value = false
}

async function testSend(): Promise<void> {
  if (!testText.value) return
  sendLoading.value = true
  testResult.value = ''
  testError.value = ''
  addLog('info', `测试: 发送剪贴板 (${testText.value.length} 字符)`)
  try {
    await fetch('http://127.0.0.1:19528/clipboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: testText.value })
    })
    testResult.value = '已发送'
    addLog('info', '剪贴板发送成功')
  } catch (e) {
    testError.value = '请求失败: ' + String(e)
    addLog('error', '请求失败: ' + String(e))
  }
  sendLoading.value = false
}

function handleServiceStatusChange(data: { status: 'running' | 'stopped' }): void {
  addLog(data.status === 'running' ? 'info' : 'warn', `服务状态: ${data.status === 'running' ? '运行中' : '已停止'}`)
}

onMounted(async () => {
  await fetchStatus()
  cleanupEvent = window.api.handoff.onEvent(({ event, data }) => {
    const anyData = data as any
    if (event === 'ws-connection') addLog('info', `WS 连接: ${anyData.clientId?.slice(0,8)} (共 ${anyData.connected})`)
    else if (event === 'ws-disconnection') addLog('info', `WS 断开 (共 ${anyData.connected})`)
    else if (event === 'device-paired') addLog('info', `设备配对: ${anyData.deviceName}`)
    else if (event === 'device-revoked') addLog('info', `设备撤销: ${anyData.deviceId}`)
    else if (event === 'config-reloaded') addLog('info', '配置已重载')
    else if (event === 'restarting') addLog('warn', '服务正在重启')
    else addLog('debug', `${event}: ${JSON.stringify(anyData)}`)
  })
  cleanupStatus = window.api.handoff.onServiceStatusChange(handleServiceStatusChange)
})

onUnmounted(() => {
  if (cleanupEvent) cleanupEvent()
  if (cleanupStatus) cleanupStatus()
})
</script>
