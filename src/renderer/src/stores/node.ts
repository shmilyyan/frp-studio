import { defineStore } from 'pinia'

export interface Node {
  id: number
  name: string
  host: string
  port: number
  token: string | null
  created_at: number
}

export const useNodeStore = defineStore('node', {
  state: () => ({
    nodes: [] as Node[],
    loading: false
  }),
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
    }
  }
})
