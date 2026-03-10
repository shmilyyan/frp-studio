import { defineStore } from 'pinia'

export interface AppConfig {
  trayEnabled: boolean
  trayPromptShown: boolean
  activeNodeId: number | null
  autoReconnect: boolean
  reconnectDelay: number
  reconnectMaxRetries: number
  autoCheckUpdate: boolean
  updateCheckInterval: number
  lastUpdateCheck: number | null
  latestKnownVersion: string | null
  proxyUrl: string
  proxyEnabled: boolean
}

export const useConfigStore = defineStore('config', {
  state: (): AppConfig => ({
    trayEnabled: false,
    trayPromptShown: false,
    activeNodeId: null,
    autoReconnect: true,
    reconnectDelay: 5,
    reconnectMaxRetries: 0,
    autoCheckUpdate: true,
    updateCheckInterval: 24,
    lastUpdateCheck: null,
    latestKnownVersion: null,
    proxyUrl: '',
    proxyEnabled: false
  }),
  actions: {
    async fetch() {
      const cfg = await window.api.config.get()
      Object.assign(this, cfg)
    },
    async update(partial: Partial<AppConfig>) {
      const cfg = await window.api.config.set(partial)
      Object.assign(this, cfg)
    }
  }
})
