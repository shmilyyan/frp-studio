<template>
  <div class="tunnels-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">隧道管理</h1>
        <p class="page-subtitle">管理 FRP 转发隧道</p>
      </div>
      <div class="header-actions">
        <!-- frpc controls -->
        <template v-if="tunnelStore.frpcStatus.running">
          <a-button danger @click="stopFrpc">停止 frpc</a-button>
        </template>
        <template v-else>
          <a-select
            v-model:value="startNodeId"
            placeholder="选择节点启动"
            style="width: 150px"
          >
            <a-select-option v-for="n in nodeStore.nodes" :key="n.id" :value="n.id">
              {{ n.name }}
            </a-select-option>
          </a-select>
          <a-button
            type="primary"
            :disabled="!startNodeId"
            @click="startFrpc"
            :loading="starting"
          >启动 frpc</a-button>
        </template>

        <!-- Import / Export -->
        <a-dropdown>
          <a-button>
            导入/导出
            <span style="margin-left:4px">▾</span>
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item @click="handleImport">导入 TOML 配置</a-menu-item>
              <a-menu-item @click="handleExport(undefined)">导出当前节点</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>

        <a-button type="primary" @click="wizardOpen = true">+ 新建隧道</a-button>
      </div>
    </div>

    <!-- Status bar -->
    <div v-if="tunnelStore.frpcStatus.running" class="frpc-status-bar">
      <span class="status-dot online"></span>
      <span>frpc 运行中 · PID {{ tunnelStore.frpcStatus.pid }}</span>
      <span class="status-node" v-if="runningNode">节点: {{ runningNode.name }}</span>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar">
      <a-select
        v-model:value="filterNodeId"
        placeholder="全部节点"
        style="width: 140px"
        allowClear
      >
        <a-select-option v-for="n in nodeStore.nodes" :key="n.id" :value="n.id">
          {{ n.name }}
        </a-select-option>
      </a-select>

      <!-- Batch action bar -->
      <template v-if="selectedIds.length > 0">
        <span class="selected-hint">已选 {{ selectedIds.length }} 条</span>
        <a-button size="small" @click="batchEnable">批量启用</a-button>
        <a-button size="small" @click="batchDisable">批量停用</a-button>
        <a-button size="small" danger @click="batchDelete">批量删除</a-button>
        <a-button size="small" @click="selectedIds = []">取消选择</a-button>
      </template>
    </div>

    <!-- Grouped tunnel list -->
    <div class="groups-container">
      <div
        v-for="group in displayGroups"
        :key="group"
        class="group-block"
      >
        <div class="group-header" @click="toggleGroup(group)">
          <span class="group-arrow">{{ collapsedGroups.has(group) ? '▶' : '▼' }}</span>
          <span class="group-name">{{ group }}</span>
          <span class="group-count">
            {{ runningInGroup(group) }}/{{ tunnelsInGroup(group).length }} 运行中
          </span>
          <span class="group-select-all" @click.stop="selectGroup(group)">全选本组</span>
        </div>

        <div v-if="!collapsedGroups.has(group)" class="group-body">
          <div
            v-for="tunnel in tunnelsInGroup(group)"
            :key="tunnel.id"
            class="tunnel-row"
            :class="{ selected: selectedIds.includes(tunnel.id) }"
          >
            <input
              type="checkbox"
              class="tunnel-check"
              :checked="selectedIds.includes(tunnel.id)"
              @change="toggleSelect(tunnel.id)"
            />
            <a-tag :color="typeColor(tunnel.type)" class="type-tag">
              {{ tunnel.type.toUpperCase() }}
            </a-tag>
            <span class="tunnel-name">{{ tunnel.name }}</span>
            <span class="tunnel-addr mono">
              {{ tunnel.local_ip }}:{{ tunnel.local_port }}
            </span>
            <span class="tunnel-arrow">→</span>
            <span class="tunnel-remote mono">
              <template v-if="tunnel.remote_port">:{{ tunnel.remote_port }}</template>
              <template v-else-if="tunnel.custom_domain">{{ tunnel.custom_domain }}</template>
              <template v-else>-</template>
            </span>
            <div class="tunnel-actions">
              <a-switch
                :checked="tunnel.enabled === 1"
                @change="(val: boolean) => toggleTunnel(tunnel, val)"
                size="small"
              />
              <a-button size="small" @click="editTunnel(tunnel)">编辑</a-button>
              <a-button size="small" danger @click="deleteTunnel(tunnel)">删除</a-button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="displayGroups.length === 0" class="empty-hint">
        暂无隧道，点击「新建隧道」开始
      </div>
    </div>

    <TunnelWizard v-model:open="wizardOpen" @created="handleCreated" />
    <TunnelEditModal v-model:open="editOpen" :tunnel="editingTunnel" @updated="handleUpdated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { useNodeStore } from '../stores/node'
import { useTunnelStore, type Tunnel } from '../stores/tunnel'
import { useConfigStore } from '../stores/config'
import TunnelWizard from '../components/tunnel/TunnelWizard.vue'
import TunnelEditModal from '../components/tunnel/TunnelEditModal.vue'

const nodeStore = useNodeStore()
const tunnelStore = useTunnelStore()
const configStore = useConfigStore()

const wizardOpen = ref(false)
const editOpen = ref(false)
const editingTunnel = ref<Tunnel | null>(null)
const filterNodeId = ref<number | null>(null)
const startNodeId = ref<number | null>(null)
const starting = ref(false)
const selectedIds = ref<number[]>([])
const collapsedGroups = ref(new Set<string>())

onMounted(async () => {
  await Promise.all([
    nodeStore.fetchNodes(),
    tunnelStore.fetchTunnels(),
    tunnelStore.fetchGroups(),
    configStore.fetch()
  ])
  if (configStore.activeNodeId) {
    startNodeId.value = configStore.activeNodeId
  }
})

const filteredTunnels = computed(() => {
  if (filterNodeId.value) {
    return tunnelStore.tunnels.filter((t) => t.node_id === filterNodeId.value)
  }
  return tunnelStore.tunnels
})

const displayGroups = computed(() => {
  const groups = new Set(filteredTunnels.value.map((t) => t.group_name || '默认分组'))
  return Array.from(groups).sort()
})

function tunnelsInGroup(group: string): Tunnel[] {
  return filteredTunnels.value.filter((t) => (t.group_name || '默认分组') === group)
}

function runningInGroup(group: string): number {
  return tunnelsInGroup(group).filter((t) => t.enabled === 1).length
}

const runningNode = computed(() => {
  const id = tunnelStore.frpcStatus.nodeId
  return id ? nodeStore.nodes.find((n) => n.id === id) : null
})

function typeColor(type: string) {
  const map: Record<string, string> = { tcp: 'blue', udp: 'purple', http: 'green', https: 'cyan' }
  return map[type] || 'default'
}

function toggleGroup(group: string) {
  if (collapsedGroups.value.has(group)) {
    collapsedGroups.value.delete(group)
  } else {
    collapsedGroups.value.add(group)
  }
}

function toggleSelect(id: number) {
  const idx = selectedIds.value.indexOf(id)
  if (idx === -1) selectedIds.value.push(id)
  else selectedIds.value.splice(idx, 1)
}

function selectGroup(group: string) {
  const ids = tunnelsInGroup(group).map((t) => t.id)
  ids.forEach((id) => {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
  })
}

async function toggleTunnel(tunnel: Tunnel, enabled: boolean) {
  await tunnelStore.updateTunnel(tunnel.id, { enabled: enabled ? 1 : 0 })
}

function editTunnel(tunnel: Tunnel) {
  editingTunnel.value = tunnel
  editOpen.value = true
}

function handleUpdated(_tunnel: Tunnel) {
  tunnelStore.fetchGroups()
}

function deleteTunnel(tunnel: Tunnel) {
  Modal.confirm({
    title: '删除隧道',
    content: `确定删除隧道"${tunnel.name}"？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await tunnelStore.deleteTunnel(tunnel.id)
      message.success('隧道已删除')
    }
  })
}

async function batchEnable() {
  await tunnelStore.bulkEnable(selectedIds.value)
  message.success(`已启用 ${selectedIds.value.length} 条隧道`)
  selectedIds.value = []
}

async function batchDisable() {
  await tunnelStore.bulkDisable(selectedIds.value)
  message.success(`已停用 ${selectedIds.value.length} 条隧道`)
  selectedIds.value = []
}

function batchDelete() {
  const ids = [...selectedIds.value]
  Modal.confirm({
    title: '批量删除',
    content: `确定删除选中的 ${ids.length} 条隧道？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await tunnelStore.bulkDelete(ids)
      selectedIds.value = []
      message.success(`已删除 ${ids.length} 条隧道`)
    }
  })
}

async function startFrpc() {
  if (!startNodeId.value) return
  starting.value = true
  try {
    await tunnelStore.startFrpc(startNodeId.value)
    await configStore.update({ activeNodeId: startNodeId.value })
    message.success('frpc 已启动')
  } catch (err: unknown) {
    message.error(err instanceof Error ? err.message : '启动失败')
  } finally {
    starting.value = false
  }
}

async function stopFrpc() {
  await tunnelStore.stopFrpc()
  message.success('frpc 已停止')
}

function handleCreated(_tunnel: Tunnel) {
  tunnelStore.fetchGroups()
}

async function handleImport() {
  const result = await window.api.config.importToml()
  if (result.success) {
    await Promise.all([tunnelStore.fetchTunnels(), tunnelStore.fetchGroups()])
    message.success(`导入成功：${result.imported} 条隧道${result.skipped ? `，跳过 ${result.skipped} 条` : ''}`)
  } else if (result.error !== 'cancelled') {
    message.error(`导入失败：${result.error}`)
  }
}

async function handleExport(nodeId: number | undefined) {
  const activeNode = configStore.activeNodeId
  const targetId = nodeId ?? activeNode ?? nodeStore.nodes[0]?.id
  if (!targetId) {
    message.warning('请先选择或添加节点')
    return
  }
  const result = await window.api.config.exportToml(targetId)
  if (result.success) {
    message.success('导出成功')
  } else if (result.error !== 'cancelled') {
    message.error(`导出失败：${result.error}`)
  }
}
</script>

<style scoped>
.tunnels-view {
  max-width: 1200px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
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

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.frpc-status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: rgba(73, 170, 25, 0.08);
  border: 1px solid rgba(73, 170, 25, 0.2);
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--color-success);
}

.status-node {
  color: var(--color-text-secondary);
  margin-left: 8px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.selected-hint {
  font-size: 13px;
  color: var(--color-primary);
  font-weight: 500;
}

.groups-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-block {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-bg-elevated);
  cursor: pointer;
  user-select: none;
}

.group-header:hover {
  background: var(--color-bg-card);
}

.group-arrow {
  font-size: 10px;
  color: var(--color-text-tertiary);
  width: 12px;
}

.group-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
}

.group-count {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.group-select-all {
  font-size: 11px;
  color: var(--color-primary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 3px;
}

.group-select-all:hover {
  background: rgba(64, 150, 255, 0.1);
}

.group-body {
  display: flex;
  flex-direction: column;
}

.tunnel-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-top: 1px solid var(--color-border);
  transition: background 0.15s;
}

.tunnel-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tunnel-row.selected {
  background: rgba(64, 150, 255, 0.06);
}

.tunnel-check {
  flex-shrink: 0;
  accent-color: var(--color-primary);
}

.type-tag {
  flex-shrink: 0;
  font-size: 11px;
}

.tunnel-name {
  font-size: 13px;
  color: var(--color-text-primary);
  min-width: 120px;
  flex: 1;
}

.tunnel-addr,
.tunnel-remote {
  font-family: 'Consolas', monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
  min-width: 100px;
}

.tunnel-arrow {
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.tunnel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.empty-hint {
  text-align: center;
  padding: 40px;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online {
  background: var(--color-success);
  box-shadow: 0 0 0 2px rgba(82, 196, 26, 0.2);
}

.mono {
  font-family: 'Consolas', monospace;
}
</style>
