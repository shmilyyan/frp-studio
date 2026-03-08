<template>
  <a-config-provider :theme="darkTheme">
    <div class="app-container">
      <AppHeader />
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

const monitorStore = useMonitorStore()
const tunnelStore = useTunnelStore()

let removeLogListener: (() => void) | null = null
let removeStatusListener: (() => void) | null = null

onMounted(() => {
  removeLogListener = window.api.frpc.onLog((data) => {
    monitorStore.addLog(data)
  })
  removeStatusListener = window.api.frpc.onStatus((status) => {
    tunnelStore.frpcStatus = status as typeof tunnelStore.frpcStatus
  })
})

onUnmounted(() => {
  removeLogListener?.()
  removeStatusListener?.()
})
</script>

<style>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--color-bg-primary);
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
