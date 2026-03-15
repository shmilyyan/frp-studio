import { defineStore } from 'pinia'

export interface Tunnel {
  id: number
  node_id: number
  name: string
  type: string
  local_ip: string
  local_port: number
  remote_port: number | null
  custom_domain: string | null
  enabled: number
  auto_start: number
  group_name: string
  extra_attrs: string  // JSON: Record<string, string>
  created_at: number
}

export const useTunnelStore = defineStore('tunnel', {
  state: () => ({
    tunnels: [] as Tunnel[],
    groups: [] as string[],
    loading: false
  }),
  getters: {
    enabledTunnels: (state) => state.tunnels.filter((t) => t.enabled === 1),
    tunnelsByNode: (state) => (nodeId: number) => state.tunnels.filter((t) => t.node_id === nodeId),
    tunnelsByGroup: (state) => (group: string) =>
      state.tunnels.filter((t) => t.group_name === group),
    enabledTunnelsByNode: (state) => (nodeId: number) =>
      state.tunnels.filter((t) => t.node_id === nodeId && t.enabled === 1),
    // 获取节点启动时自动启用的隧道（同时满足 enabled 和 auto_start）
    autoStartTunnelsByNode: (state) => (nodeId: number) =>
      state.tunnels.filter((t) => t.node_id === nodeId && t.enabled === 1 && t.auto_start === 1)
  },
  actions: {
    async fetchTunnels(nodeId?: number) {
      this.loading = true
      try {
        this.tunnels = (await window.api.tunnel.list(nodeId)) as Tunnel[]
      } finally {
        this.loading = false
      }
    },
    async fetchGroups() {
      this.groups = await window.api.tunnel.listGroups()
    },
    async addTunnel(data: Omit<Tunnel, 'id' | 'created_at'>) {
      const tunnel = (await window.api.tunnel.add(data)) as Tunnel
      this.tunnels.unshift(tunnel)
      if (!this.groups.includes(tunnel.group_name)) {
        this.groups.push(tunnel.group_name)
      }
      return tunnel
    },
    async updateTunnel(id: number, data: Partial<Omit<Tunnel, 'id' | 'created_at'>>) {
      const tunnel = (await window.api.tunnel.update(id, data)) as Tunnel
      const idx = this.tunnels.findIndex((t) => t.id === id)
      if (idx !== -1) this.tunnels[idx] = tunnel
      return tunnel
    },
    async deleteTunnel(id: number) {
      await window.api.tunnel.delete(id)
      this.tunnels = this.tunnels.filter((t) => t.id !== id)
    },
    async bulkEnable(ids: number[]) {
      await window.api.tunnel.bulkEnable(ids)
      ids.forEach((id) => {
        const t = this.tunnels.find((t) => t.id === id)
        if (t) t.enabled = 1
      })
    },
    async bulkDisable(ids: number[]) {
      await window.api.tunnel.bulkDisable(ids)
      ids.forEach((id) => {
        const t = this.tunnels.find((t) => t.id === id)
        if (t) t.enabled = 0
      })
    },
    async bulkDelete(ids: number[]) {
      await window.api.tunnel.bulkDelete(ids)
      this.tunnels = this.tunnels.filter((t) => !ids.includes(t.id))
    }
  }
})
