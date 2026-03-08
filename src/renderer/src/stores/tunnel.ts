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
  group_name: string
  created_at: number
}

export interface FrpcStatus {
  running: boolean
  pid?: number
  nodeId?: number
  startedAt?: number
}

export const useTunnelStore = defineStore('tunnel', {
  state: () => ({
    tunnels: [] as Tunnel[],
    groups: [] as string[],
    frpcStatus: { running: false } as FrpcStatus,
    loading: false
  }),
  getters: {
    enabledTunnels: (state) => state.tunnels.filter((t) => t.enabled === 1),
    tunnelsByNode: (state) => (nodeId: number) => state.tunnels.filter((t) => t.node_id === nodeId),
    tunnelsByGroup: (state) => (group: string) =>
      state.tunnels.filter((t) => t.group_name === group)
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
    },
    async startFrpc(nodeId: number) {
      this.frpcStatus = await window.api.frpc.start(nodeId)
    },
    async stopFrpc() {
      this.frpcStatus = await window.api.frpc.stop()
    },
    async fetchFrpcStatus() {
      this.frpcStatus = await window.api.frpc.status()
    }
  }
})
