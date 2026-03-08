<template>
  <div class="settings-view">
    <div class="page-header">
      <h1 class="page-title">系统设置</h1>
      <p class="page-subtitle">FRP 版本管理与系统配置</p>
    </div>

    <!-- FRP Version Management -->
    <a-card title="FRP 版本管理" class="settings-card">
      <div class="installed-info">
        <span class="info-label">当前安装版本：</span>
        <span class="info-value">{{ installedVersion || '未安装' }}</span>
        <a-tag v-if="installedVersion" color="success">已安装</a-tag>
      </div>

      <a-divider />

      <div class="version-actions">
        <a-button @click="loadVersions" :loading="loadingVersions">刷新版本列表</a-button>
      </div>

      <div v-if="versions.length > 0" class="version-list">
        <div v-for="v in versions" :key="v.version" class="version-item">
          <div class="version-info">
            <span class="version-tag">{{ v.version }}</span>
            <span class="version-date">{{ formatDate(v.publishedAt) }}</span>
          </div>
          <a-button
            size="small"
            type="primary"
            :loading="downloadingVersion === v.version"
            :disabled="!!downloadingVersion"
            @click="downloadVersion(v)"
          >
            {{ installedVersion === v.version ? '重新安装' : '安装' }}
          </a-button>
        </div>
      </div>

      <div v-if="downloadProgress > 0 && downloadProgress < 100" class="download-progress">
        <div class="progress-label">下载中... {{ downloadProgress }}%</div>
        <a-progress :percent="downloadProgress" size="small" />
      </div>
    </a-card>

    <!-- System Settings -->
    <a-card title="系统配置" class="settings-card">
      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label">开机自启动</div>
          <div class="setting-desc">登录系统时自动启动 FRP Studio</div>
        </div>
        <a-switch v-model:checked="autostart" @change="handleAutostartChange" />
      </div>

      <a-divider style="margin: 12px 0" />

      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label">常驻系统托盘</div>
          <div class="setting-desc">关闭窗口时最小化到托盘，frpc 在后台保持运行</div>
        </div>
        <a-switch
          v-model:checked="configStore.trayEnabled"
          @change="(val: boolean) => handleConfigChange({ trayEnabled: val })"
        />
      </div>
    </a-card>

    <!-- Auto Reconnect -->
    <a-card title="自动重连" class="settings-card">
      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label">自动重连</div>
          <div class="setting-desc">frpc 意外断开时自动尝试重新连接</div>
        </div>
        <a-switch
          v-model:checked="configStore.autoReconnect"
          @change="(val: boolean) => handleConfigChange({ autoReconnect: val })"
        />
      </div>

      <template v-if="configStore.autoReconnect">
        <a-divider style="margin: 12px 0" />

        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">重连延迟（秒）</div>
            <div class="setting-desc">断线后等待多少秒开始尝试重连</div>
          </div>
          <a-input-number
            v-model:value="configStore.reconnectDelay"
            :min="1"
            :max="60"
            style="width: 100px"
            @change="(val: number) => handleConfigChange({ reconnectDelay: val })"
          />
        </div>

        <a-divider style="margin: 12px 0" />

        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">最大重试次数</div>
            <div class="setting-desc">0 表示无限重试</div>
          </div>
          <a-input-number
            v-model:value="configStore.reconnectMaxRetries"
            :min="0"
            :max="100"
            style="width: 100px"
            @change="(val: number) => handleConfigChange({ reconnectMaxRetries: val })"
          />
        </div>
      </template>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { useConfigStore } from '../stores/config'

interface FrpVersion {
  version: string
  publishedAt: string
  downloadUrl: string
}

const configStore = useConfigStore()

const installedVersion = ref<string | null>(null)
const versions = ref<FrpVersion[]>([])
const loadingVersions = ref(false)
const downloadingVersion = ref<string | null>(null)
const downloadProgress = ref(0)
const autostart = ref(false)

onMounted(async () => {
  await configStore.fetch()
  installedVersion.value = await window.api.system.getInstalledVersion()
  autostart.value = await window.api.system.getAutostart()

  window.api.system.onDownloadProgress(({ percent }) => {
    downloadProgress.value = percent
  })
  window.api.system.onDownloadComplete(({ version }) => {
    message.success(`FRP ${version} 安装完成`)
    installedVersion.value = version
    downloadingVersion.value = null
    downloadProgress.value = 0
  })
})

async function loadVersions() {
  loadingVersions.value = true
  try {
    versions.value = await window.api.system.getFrpVersions()
  } catch {
    message.error('获取版本列表失败，请检查网络连接')
  } finally {
    loadingVersions.value = false
  }
}

async function downloadVersion(v: FrpVersion) {
  downloadingVersion.value = v.version
  downloadProgress.value = 1
  try {
    await window.api.system.downloadFrp(v)
  } catch (err: unknown) {
    message.error(err instanceof Error ? err.message : '下载失败')
    downloadingVersion.value = null
    downloadProgress.value = 0
  }
}

async function handleAutostartChange(val: boolean) {
  await window.api.system.setAutostart(val)
  message.success(val ? '已开启开机自启' : '已关闭开机自启')
}

async function handleConfigChange(partial: Parameters<typeof configStore.update>[0]) {
  await configStore.update(partial)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.settings-view {
  max-width: 700px;
}

.page-header {
  margin-bottom: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}

.page-subtitle {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
}

.settings-card {
  margin-bottom: 16px;
}

.installed-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.info-label {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.info-value {
  font-family: 'Consolas', monospace;
  color: var(--color-text-primary);
  font-size: 14px;
}

.version-actions {
  margin-bottom: 16px;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--color-bg-card);
  border-radius: 6px;
}

.version-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.version-tag {
  font-family: 'Consolas', monospace;
  font-size: 13px;
  color: var(--color-text-primary);
}

.version-date {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.download-progress {
  margin-top: 16px;
}

.progress-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.setting-label {
  font-size: 14px;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.setting-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
