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

      <!-- Update available banner -->
      <a-alert
        v-if="updateStore.hasUpdate"
        style="margin-top: 12px"
        type="warning"
        show-icon
        :message="`发现新版本 ${updateStore.latestVersion}`"
        :description="`当前版本：${updateStore.currentVersion}，点击右侧按钮立即更新`"
      >
        <template #action>
          <a-button
            size="small"
            type="primary"
            :loading="!!downloadingVersion"
            @click="downloadLatest"
          >
            立即更新
          </a-button>
        </template>
      </a-alert>

      <a-divider />

      <div class="version-actions">
        <a-button @click="loadVersions" :loading="loadingVersions">刷新版本列表</a-button>
        <a-button style="margin-left: 8px" @click="handleImportFrpc" :loading="importing">
          导入本地 frpc
        </a-button>
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

    <!-- Version History / Restore -->
    <a-card title="历史版本恢复" class="settings-card">
      <div class="version-actions">
        <a-button @click="loadBackups" :loading="loadingBackups" size="small">刷新备份列表</a-button>
      </div>

      <div v-if="backups.length === 0 && !loadingBackups" class="backup-empty">
        暂无备份记录，每次更新或导入时将自动备份当前版本
      </div>

      <div v-if="backups.length > 0" class="backup-list">
        <div v-for="b in backups" :key="b.filename" class="backup-item">
          <div class="backup-info">
            <span class="version-tag">{{ b.version }}</span>
            <span class="version-date">{{ formatBackupDate(b.date) }}</span>
            <span class="backup-size">{{ formatSize(b.size) }}</span>
          </div>
          <a-button
            size="small"
            :loading="restoringBackup === b.filename"
            :disabled="!!restoringBackup"
            @click="handleRestoreBackup(b)"
          >
            恢复
          </a-button>
        </div>
      </div>
    </a-card>

    <!-- Auto Update Settings -->
    <a-card title="自动更新检测" class="settings-card">
      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label">自动检测更新</div>
          <div class="setting-desc">定期检查 frpc 是否有新版本发布（仅通知，不自动安装）</div>
        </div>
        <a-switch
          v-model:checked="configStore.autoCheckUpdate"
          @change="(val: boolean) => handleConfigChange({ autoCheckUpdate: val })"
        />
      </div>

      <template v-if="configStore.autoCheckUpdate">
        <a-divider style="margin: 12px 0" />
        <div class="setting-item">
          <div class="setting-info">
            <div class="setting-label">检测间隔（小时）</div>
            <div class="setting-desc">每隔多少小时自动检查一次</div>
          </div>
          <a-input-number
            v-model:value="configStore.updateCheckInterval"
            :min="1"
            :max="168"
            style="width: 100px"
            @change="(val: number) => handleConfigChange({ updateCheckInterval: val })"
          />
        </div>
      </template>

      <a-divider style="margin: 12px 0" />

      <div class="update-check-row">
        <div class="setting-info">
          <div class="setting-label">手动检测</div>
          <div v-if="lastCheckTime" class="setting-desc">
            上次检测：{{ lastCheckTime }}
          </div>
          <div v-else class="setting-desc">从未检测过</div>
        </div>
        <a-button :loading="checkingUpdate" @click="handleCheckUpdate">立即检测</a-button>
      </div>
    </a-card>

    <!-- System Settings -->
    <a-card title="系统配置" class="settings-card">
      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label">开机自启动</div>
          <div class="setting-desc">登录系统时自动启动 Frper</div>
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

    <!-- Proxy Settings -->
    <a-card title="代理设置" class="settings-card">
      <!-- Enable switch -->
      <div class="setting-item">
        <div class="setting-info">
          <div class="setting-label">启用代理</div>
          <div class="setting-desc">开启后所有版本检测和下载请求均经过代理</div>
        </div>
        <a-switch
          :checked="configStore.proxyEnabled"
          :disabled="!configStore.proxyUrl"
          @change="(val: boolean) => handleConfigChange({ proxyEnabled: val })"
        />
      </div>

      <a-divider style="margin: 12px 0" />

      <!-- URL input -->
      <div class="setting-item" style="align-items: flex-start; gap: 16px">
        <div class="setting-info">
          <div class="setting-label">代理地址</div>
          <div class="setting-desc">
            格式：<code>http://127.0.0.1:7890</code> 或 <code>socks5://127.0.0.1:1080</code>
          </div>
        </div>
        <div class="proxy-input-group">
          <a-input
            v-model:value="proxyUrlInput"
            placeholder="留空表示直连"
            style="width: 260px"
            allow-clear
          />
          <a-button
            type="primary"
            style="margin-left: 8px"
            @click="handleSaveProxy"
          >
            保存
          </a-button>
        </div>
      </div>
    </a-card>

    <!-- Windows Service (Windows only) -->
    <a-card v-if="isWindows" title="Windows 服务" class="settings-card">
      <div class="service-desc">
        将 frpc 注册为 Windows 系统服务，可在后台独立运行，无需保持本应用开启，并随系统自动启动。
        <br />
        <span class="service-hint">安装和卸载操作需要管理员权限，将弹出 UAC 授权提示。</span>
      </div>

      <a-divider style="margin: 14px 0" />

      <div class="setting-item" style="margin-bottom: 14px">
        <div class="setting-info">
          <div class="setting-label">选择节点</div>
          <div class="setting-desc">为该节点的已启用隧道安装服务</div>
        </div>
        <a-select
          v-model:value="svcNodeId"
          style="width: 200px"
          placeholder="请选择节点"
          :options="nodeOptions"
          @change="onSvcNodeChange"
        />
      </div>

      <div v-if="svcNodeId" class="service-status-row">
        <div class="setting-info">
          <div class="setting-label">服务状态</div>
        </div>
        <div class="service-status-right">
          <a-tag :color="statusColor">{{ statusLabel }}</a-tag>
          <a-button
            size="small"
            :loading="svcLoading"
            @click="refreshStatus"
            style="margin-left: 8px"
          >
            刷新
          </a-button>
        </div>
      </div>

      <a-divider v-if="svcNodeId" style="margin: 14px 0" />

      <div v-if="svcNodeId" class="service-actions">
        <!-- 未安装 -->
        <template v-if="svcStatus === 'not-installed'">
          <a-button type="primary" :loading="svcLoading" @click="handleInstall">
            安装服务
          </a-button>
        </template>

        <!-- 已停止 -->
        <template v-else-if="svcStatus === 'stopped'">
          <a-button type="primary" :loading="svcLoading" @click="handleStart">启动</a-button>
          <a-button danger :loading="svcLoading" @click="handleUninstall" style="margin-left: 8px">
            卸载服务
          </a-button>
        </template>

        <!-- 运行中 -->
        <template v-else-if="svcStatus === 'running'">
          <a-button :loading="svcLoading" @click="handleStop">停止</a-button>
          <a-button danger :loading="svcLoading" @click="handleUninstall" style="margin-left: 8px">
            卸载服务
          </a-button>
        </template>

        <!-- 启动中 / 停止中 / 未知 -->
        <template v-else>
          <a-button disabled>{{ statusLabel }}...</a-button>
        </template>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { useConfigStore } from '../stores/config'
import { useNodeStore } from '../stores/node'
import { useUpdateStore } from '../stores/update'

interface FrpVersion {
  version: string
  publishedAt: string
  downloadUrl: string
}

const configStore = useConfigStore()
const nodeStore = useNodeStore()
const updateStore = useUpdateStore()

const installedVersion = ref<string | null>(null)
const versions = ref<FrpVersion[]>([])
const loadingVersions = ref(false)
const downloadingVersion = ref<string | null>(null)
const downloadProgress = ref(0)
const autostart = ref(false)
const checkingUpdate = ref(false)
const importing = ref(false)
const proxyUrlInput = ref('')
const backups = ref<BackupInfo[]>([])
const loadingBackups = ref(false)
const restoringBackup = ref<string | null>(null)

const lastCheckTime = computed(() => {
  const ts = configStore.lastUpdateCheck
  if (!ts) return null
  return new Date(ts).toLocaleString('zh-CN')
})

// Sync download state from global updateStore
watch(
  () => updateStore.isDownloading,
  (val) => {
    if (!val && updateStore.downloadingVersion === null) {
      // Download finished
      if (updateStore.currentVersion) {
        installedVersion.value = updateStore.currentVersion
        message.success(`FRP ${updateStore.currentVersion} 安装完成`)
      }
      downloadingVersion.value = null
      downloadProgress.value = 0
    }
  }
)
watch(() => updateStore.downloadPercent, (val) => { downloadProgress.value = val })
watch(() => updateStore.downloadingVersion, (val) => { downloadingVersion.value = val })

async function loadBackups() {
  loadingBackups.value = true
  try {
    backups.value = await window.api.system.listBackups()
  } finally {
    loadingBackups.value = false
  }
}

async function handleRestoreBackup(b: BackupInfo) {
  Modal.confirm({
    title: '恢复历史版本',
    content: `确定将 frpc 恢复为备份版本 ${b.version}（${formatBackupDate(b.date)}）？当前版本将自动备份。`,
    okText: '确认恢复',
    cancelText: '取消',
    async onOk() {
      restoringBackup.value = b.filename
      try {
        const result = await window.api.system.restoreBackup(b.filename)
        if (result.success) {
          installedVersion.value = result.version ?? 'unknown'
          await loadBackups()
          message.success(`已恢复至 ${result.version ?? b.version}`)
        } else {
          message.error(`恢复失败：${result.error}`)
        }
      } finally {
        restoringBackup.value = null
      }
    }
  })
}

function formatBackupDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN')
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

async function handleSaveProxy() {
  await configStore.update({ proxyUrl: proxyUrlInput.value.trim() })
  message.success('代理设置已保存')
}

async function handleCheckUpdate() {
  checkingUpdate.value = true
  try {
    const result = await window.api.system.checkUpdate()
    await configStore.fetch()  // refresh lastUpdateCheck display
    if (result.hasUpdate) {
      updateStore.setUpdateAvailable(result.latestVersion!, result.currentVersion!)
      message.info(`发现新版本 ${result.latestVersion}，请在上方更新`)
    } else {
      message.success('当前已是最新版本')
    }
  } catch {
    message.error('检测失败，请检查网络连接')
  } finally {
    checkingUpdate.value = false
  }
}

async function downloadLatest() {
  if (!updateStore.latestVersion) return
  const allVersions = versions.value.length ? versions.value : await window.api.system.getFrpVersions()
  const target = allVersions.find((v: FrpVersion) => v.version === updateStore.latestVersion)
  if (target) {
    await downloadVersion(target)
  } else {
    message.error('未找到对应版本下载链接，请刷新版本列表后重试')
  }
}

async function handleImportFrpc() {
  importing.value = true
  try {
    const result = await window.api.system.importFrpc()
    if (result.success) {
      installedVersion.value = result.version ?? 'unknown'
      message.success(`frpc 导入成功，版本：${result.version ?? '未知'}`)
    } else if (result.error !== 'cancelled') {
      message.error(`导入失败：${result.error}`)
    }
  } finally {
    importing.value = false
  }
}

// ─── Windows Service ──────────────────────────────────────────────────────────

const isWindows = window.api.winsvc.platform === 'win32'
const svcNodeId = ref<number | null>(null)
const svcStatus = ref<ServiceStatus>('not-installed')
const svcLoading = ref(false)

const nodeOptions = computed(() =>
  nodeStore.nodes.map((n) => ({ value: n.id, label: n.name }))
)

const statusLabel = computed(() => {
  const map: Record<ServiceStatus, string> = {
    'not-installed': '未安装',
    stopped: '已停止',
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    unknown: '未知'
  }
  return map[svcStatus.value]
})

const statusColor = computed(() => {
  const map: Record<ServiceStatus, string> = {
    'not-installed': 'default',
    stopped: 'warning',
    running: 'success',
    starting: 'processing',
    stopping: 'processing',
    unknown: 'default'
  }
  return map[svcStatus.value]
})

async function refreshStatus() {
  if (!svcNodeId.value) return
  svcLoading.value = true
  try {
    svcStatus.value = await window.api.winsvc.status(svcNodeId.value)
  } finally {
    svcLoading.value = false
  }
}

async function onSvcNodeChange() {
  await refreshStatus()
}

async function handleInstall() {
  if (!svcNodeId.value) return
  svcLoading.value = true
  try {
    const res = await window.api.winsvc.install(svcNodeId.value)
    if (res.success) {
      message.success(res.message)
      await refreshStatus()
    } else {
      message.error(res.message)
    }
  } finally {
    svcLoading.value = false
  }
}

async function handleUninstall() {
  if (!svcNodeId.value) return
  svcLoading.value = true
  try {
    const res = await window.api.winsvc.uninstall(svcNodeId.value)
    if (res.success) {
      message.success(res.message)
      await refreshStatus()
    } else {
      message.error(res.message)
    }
  } finally {
    svcLoading.value = false
  }
}

async function handleStart() {
  if (!svcNodeId.value) return
  svcLoading.value = true
  try {
    const res = await window.api.winsvc.start(svcNodeId.value)
    if (res.success) {
      message.success(res.message)
      await refreshStatus()
    } else {
      message.error(res.message)
    }
  } finally {
    svcLoading.value = false
  }
}

async function handleStop() {
  if (!svcNodeId.value) return
  svcLoading.value = true
  try {
    const res = await window.api.winsvc.stop(svcNodeId.value)
    if (res.success) {
      message.success(res.message)
      await refreshStatus()
    } else {
      message.error(res.message)
    }
  } finally {
    svcLoading.value = false
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  await configStore.fetch()
  await nodeStore.fetchNodes()
  installedVersion.value = await window.api.system.getInstalledVersion()
  autostart.value = await window.api.system.getAutostart()
  proxyUrlInput.value = configStore.proxyUrl ?? ''
  loadBackups()
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
  updateStore.startDownload(v.version)
  try {
    await window.api.system.downloadFrp({ ...v })
  } catch (err: unknown) {
    message.error(err instanceof Error ? err.message : '下载失败')
    downloadingVersion.value = null
    downloadProgress.value = 0
    updateStore.finishDownload('')
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

.service-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.service-hint {
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.service-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.service-status-right {
  display: flex;
  align-items: center;
}

.service-actions {
  display: flex;
  align-items: center;
}

.backup-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--color-bg-card);
  border-radius: 6px;
}

.backup-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.backup-size {
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-family: 'Consolas', monospace;
}

.backup-empty {
  font-size: 13px;
  color: var(--color-text-tertiary);
  padding: 16px 0;
  text-align: center;
}

.update-check-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.proxy-input-group {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

code {
  font-family: 'Consolas', monospace;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
