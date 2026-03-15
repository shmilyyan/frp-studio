import { defineStore } from 'pinia'

export interface FrpcStatus {
  running: boolean
  pid?: number
  nodeId?: number
  startedAt?: number
}

export interface Node {
  id: number
  name: string
  host: string
  port: number
  token: string | null
  auto_start: number
  created_at: number
}

export const useNodeStore = defineStore('node', {
  state: () => ({
    nodes: [] as Node[],
    frpcStatuses: {} as Record<number, FrpcStatus>,
    loading: false
  }),
  getters: {
    runningNodes: (state) => {
      return state.nodes.filter((n) => state.frpcStatuses[n.id]?.running)
    },
    getNodeById: (state) => (id: number) => {
      return state.nodes.find((n) => n.id === id)
    },
    isNodeRunning: (state) => (id: number) => {
      return state.frpcStatuses[id]?.running ?? false
    }
  },
  actions: {
    async fetchNodes() {
      this.loading = true
      try {
        this.nodes = (await window.api.node.list()) as Node[]
      } finally {
        this.loading = false
      }
    },
    async addNode(data: Omit<Node, 'id' | 'created_at'>) {
      const node = (await window.api.node.add(data)) as Node
      this.nodes.unshift(node)
      return node
    },
    async updateNode(id: number, data: Partial<Omit<Node, 'id' | 'created_at'>>) {
      const node = (await window.api.node.update(id, data)) as Node
      const idx = this.nodes.findIndex((n) => n.id === id)
      if (idx !== -1) this.nodes[idx] = node
      return node
    },
    async deleteNode(id: number) {
      await window.api.node.delete(id)
      this.nodes = this.nodes.filter((n) => n.id !== id)
      delete this.frpcStatuses[id]
    },
    async startFrpc(nodeId: number) {
      const status = (await window.api.frpc.start(nodeId)) as FrpcStatus
      this.frpcStatuses[nodeId] = status
      return status
    },
    async stopFrpc(nodeId: number) {
      await window.api.frpc.stop(nodeId)
      this.frpcStatuses[nodeId] = { running: false }
    },
    async fetchFrpcStatus(nodeId: number) {
      this.frpcStatuses[nodeId] = (await window.api.frpc.status(nodeId)) as FrpcStatus
    },
    async fetchAllFrpcStatus() {
      const statuses = await window.api.frpc.statusAll()
      this.frpcStatuses = statuses
    },
    updateFrpcStatus(nodeId: number, status: FrpcStatus) {
      this.frpcStatuses[nodeId] = status
    }
  }
})
