<template>
  <aside class="app-sidebar">
    <nav class="sidebar-nav">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ active: currentPath === item.path }"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span class="nav-label">{{ item.label }}</span>
      </router-link>
    </nav>
    <div class="sidebar-footer">
      <div class="frpc-indicator" :class="{ running: frpcStatus.running }">
        <span class="status-dot" :class="frpcStatus.running ? 'online' : 'offline'"></span>
        <span class="indicator-text">{{ frpcStatus.running ? 'frpc 运行中' : 'frpc 已停止' }}</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTunnelStore } from '../../stores/tunnel'

const route = useRoute()
const tunnelStore = useTunnelStore()

const currentPath = computed(() => route.path)
const frpcStatus = computed(() => tunnelStore.frpcStatus)

const navItems = [
  { path: '/dashboard', label: '仪表盘', icon: '◈' },
  { path: '/nodes', label: '节点管理', icon: '◉' },
  { path: '/tunnels', label: '隧道管理', icon: '⇋' },
  { path: '/monitor', label: '监控面板', icon: '◎' },
  { path: '/settings', label: '系统设置', icon: '⚙' }
]
</script>

<style scoped>
.app-sidebar {
  width: var(--sidebar-width);
  background-color: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--color-text-secondary);
  font-size: 13px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.nav-item:hover {
  background-color: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.nav-item.active {
  background-color: rgba(22, 104, 220, 0.15);
  color: #4096ff;
}

.nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.nav-label {
  font-size: 13px;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--color-border);
}

.frpc-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
}

.frpc-indicator.running {
  background: rgba(73, 170, 25, 0.08);
}

.indicator-text {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.frpc-indicator.running .indicator-text {
  color: var(--color-success);
}
</style>
