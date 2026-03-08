<template>
  <div class="nodes-view">
    <div class="page-header">
      <div>
        <h1 class="page-title">节点管理</h1>
        <p class="page-subtitle">管理 FRP 服务器节点</p>
      </div>
      <a-button type="primary" @click="openAddModal">+ 添加节点</a-button>
    </div>

    <a-spin :spinning="nodeStore.loading">
      <!-- Empty state -->
      <div v-if="nodeStore.nodes.length === 0" class="empty-state">
        <div class="empty-icon">◉</div>
        <h3>暂无节点</h3>
        <p>添加一个 FRP 服务器节点开始使用</p>
        <a-button type="primary" @click="openAddModal">添加第一个节点</a-button>

        <div class="deploy-guide">
          <a-divider>部署引导</a-divider>
          <div class="guide-steps">
            <div class="guide-step">
              <span class="guide-num">1</span>
              <div>
                <strong>安装 frps</strong>
                <p>在服务器上下载并运行 frps，配置 bindPort 和 token</p>
              </div>
            </div>
            <div class="guide-step">
              <span class="guide-num">2</span>
              <div>
                <strong>添加节点</strong>
                <p>填写服务器 IP、端口和 token，完成节点添加</p>
              </div>
            </div>
            <div class="guide-step">
              <span class="guide-num">3</span>
              <div>
                <strong>创建隧道</strong>
                <p>为节点配置转发规则，启动 frpc</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Node grid -->
      <div v-else class="nodes-grid">
        <div
          v-for="node in nodeStore.nodes"
          :key="node.id"
          class="node-wrapper"
          :class="{ active: configStore.activeNodeId === node.id }"
        >
          <div v-if="configStore.activeNodeId === node.id" class="active-badge">★ 活动节点</div>
          <NodeCard
            :node="node"
            @test="openTestModal"
            @config="openConfigModal"
            @edit="openEditModal"
            @delete="confirmDelete"
            @start="handleStart"
          />
          <a-button
            v-if="configStore.activeNodeId !== node.id"
            class="set-active-btn"
            size="small"
            @click="setActiveNode(node.id)"
          >
            设为活动节点
          </a-button>
        </div>
      </div>
    </a-spin>

    <!-- Add/Edit Modal -->
    <NodeForm
      v-model:open="formOpen"
      :node="editingNode"
      @submit="handleFormSubmit"
    />

    <!-- Connect Test Modal -->
    <ConnectTest
      v-model:open="testOpen"
      :host="testNode?.host || ''"
      :port="testNode?.port || 7000"
      :token="testNode?.token"
    />

    <!-- Config Manager Modal -->
    <ConfigManager
      v-model:open="configOpen"
      :node="configNode"
      @apply="handleApplyConfig"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { useNodeStore, type Node } from '../stores/node'
import { useTunnelStore } from '../stores/tunnel'
import { useConfigStore } from '../stores/config'
import NodeCard from '../components/node/NodeCard.vue'
import NodeForm from '../components/node/NodeForm.vue'
import ConnectTest from '../components/node/ConnectTest.vue'
import ConfigManager from '../components/node/ConfigManager.vue'

const nodeStore = useNodeStore()
const tunnelStore = useTunnelStore()
const configStore = useConfigStore()

const formOpen = ref(false)
const testOpen = ref(false)
const configOpen = ref(false)
const editingNode = ref<Node | null>(null)
const testNode = ref<Node | null>(null)
const configNode = ref<Node | null>(null)

onMounted(async () => {
  await Promise.all([nodeStore.fetchNodes(), tunnelStore.fetchTunnels(), configStore.fetch()])
})

function openAddModal() {
  editingNode.value = null
  formOpen.value = true
}

function openEditModal(node: Node) {
  editingNode.value = node
  formOpen.value = true
}

function openTestModal(node: Node) {
  testNode.value = node
  testOpen.value = true
}

function openConfigModal(node: Node) {
  configNode.value = node
  configOpen.value = true
}

async function handleFormSubmit(data: Omit<Node, 'id' | 'created_at'>) {
  if (editingNode.value) {
    await nodeStore.updateNode(editingNode.value.id, data)
    message.success('节点已更新')
  } else {
    const node = await nodeStore.addNode(data)
    // 首个节点自动设为活动节点
    if (nodeStore.nodes.length === 1) {
      await configStore.update({ activeNodeId: node.id })
    }
    message.success('节点已添加')
  }
}

async function handleApplyConfig(data: Partial<Node>) {
  if (configNode.value) {
    await nodeStore.updateNode(configNode.value.id, data)
    message.success('配置已应用')
  }
}

function confirmDelete(node: Node) {
  Modal.confirm({
    title: '删除节点',
    content: `确定要删除节点"${node.name}"吗？相关隧道也会被删除。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      await nodeStore.deleteNode(node.id)
      if (configStore.activeNodeId === node.id) {
        const first = nodeStore.nodes[0]
        await configStore.update({ activeNodeId: first?.id ?? null })
      }
      message.success('节点已删除')
    }
  })
}

async function setActiveNode(id: number) {
  await configStore.update({ activeNodeId: id })
  message.success('活动节点已切换')
}

async function handleStart(node: Node) {
  try {
    await tunnelStore.startFrpc(node.id)
    await configStore.update({ activeNodeId: node.id })
    message.success('frpc 已启动')
  } catch (err: unknown) {
    message.error(err instanceof Error ? err.message : '启动失败')
  }
}
</script>

<style scoped>
.nodes-view {
  max-width: 1200px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
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

.nodes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

.node-wrapper {
  position: relative;
}

.node-wrapper.active {
  filter: drop-shadow(0 0 6px rgba(64, 150, 255, 0.35));
}

.active-badge {
  position: absolute;
  top: -10px;
  left: 14px;
  background: var(--color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  z-index: 1;
}

.set-active-btn {
  display: block;
  width: 100%;
  margin-top: 6px;
  font-size: 12px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--color-text-secondary);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  color: var(--color-text-tertiary);
}

.empty-state h3 {
  font-size: 16px;
  color: var(--color-text-primary);
  margin-bottom: 8px;
}

.empty-state p {
  margin-bottom: 20px;
}

.deploy-guide {
  max-width: 500px;
  margin: 8px auto 0;
  text-align: left;
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.guide-step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.guide-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  flex-shrink: 0;
}

.guide-step strong {
  display: block;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.guide-step p {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0;
}
</style>
