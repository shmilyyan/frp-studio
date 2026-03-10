<template>
  <a-config-provider :theme="darkTheme">
    <div class="app-container">
      <AppHeader />
      <!-- Global download progress bar -->
      <div v-if="updateStore.isDownloading" class="global-progress-bar">
        <div
          class="global-progress-fill"
          :style="{ width: updateStore.downloadPercent + '%' }"
        ></div>
      </div>
      <div class="app-body">
        <AppSidebar />
        <main class="app-content">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </main>
      </div>
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppHeader from './components/layout/AppHeader.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import { darkTheme } from './styles/theme'
import { useMonitorStore } from './stores/monitor'
import { useTunnelStore } from './stores/tunnel'
import { useUpdateStore } from './stores/update'
import { message } from 'ant-design-vue'

const monitorStore = useMonitorStore()
const tunnelStore = useTunnelStore()
const updateStore = useUpdateStore()

let removeListeners: Array<() => void> = []

onMounted(() => {
  removeListeners.push(
    window.api.frpc.onLog((data) => {
      monitorStore.addLog(data)
    })
  )
  removeListeners.push(
    window.api.frpc.onStatus((status) => {
      tunnelStore.frpcStatus = status as typeof tunnelStore.frpcStatus
    })
  )
  removeListeners.push(
    window.api.system.onUpdateAvailable(({ latestVersion, currentVersion }) => {
      updateStore.setUpdateAvailable(latestVersion, currentVersion)
    })
  )
  removeListeners.push(
    window.api.system.onAutoDownloadStart(({ version }) => {
      updateStore.startDownload(version)
      message.info(`正在自动下载 frpc ${version}...`)
    })
  )
  removeListeners.push(
    window.api.system.onDownloadProgress(({ percent }) => {
      updateStore.setProgress(percent)
    })
  )
  removeListeners.push(
    window.api.system.onDownloadComplete(({ version }) => {
      updateStore.finishDownload(version)
      message.success(`FRP ${version} 安装完成`)
    })
  )
})

onUnmounted(() => {
  removeListeners.forEach((fn) => fn())
  removeListeners = []
})
</script>

<style>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-bg-primary);
}

.global-progress-bar {
  height: 2px;
  background: rgba(22, 104, 220, 0.2);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.global-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1668dc, #4096ff);
  transition: width 0.3s ease;
  min-width: 2%;
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.app-content {
  flex: 1;
  overflow: auto;
  padding: 24px;
  background-color: var(--color-bg-primary);
}
</style>
