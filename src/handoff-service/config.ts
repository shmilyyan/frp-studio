import fs from 'fs'
import path from 'path'

export interface HandoffConfig {
  server: {
    port: number
    bindAddress: string
  }
  device: {
    name: string
    downloadDir: string
  }
  features: {
    clipboardSync: boolean
    fileTransfer: boolean
    clipboardMaxSize: number
  }
  frpTunnel: {
    enabled: boolean
    nodeId: number | null
    remotePort: number
  }
}

const defaultConfig: HandoffConfig = {
  server: { port: 19528, bindAddress: '0.0.0.0' },
  device: { name: 'My-Windows-PC', downloadDir: '' },
  features: { clipboardSync: true, fileTransfer: true, clipboardMaxSize: 1048576 },
  frpTunnel: { enabled: false, nodeId: null, remotePort: 19528 }
}

let configPath = ''
let config: HandoffConfig = { ...defaultConfig }

export function loadConfig(configDir: string): HandoffConfig {
  configPath = path.join(configDir, 'handoff.json')
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      config = {
        ...defaultConfig,
        ...parsed,
        server: { ...defaultConfig.server, ...(parsed.server || {}) },
        device: { ...defaultConfig.device, ...(parsed.device || {}) },
        features: { ...defaultConfig.features, ...(parsed.features || {}) },
        frpTunnel: { ...defaultConfig.frpTunnel, ...(parsed.frpTunnel || {}) }
      }
      if (parsed.pairedDevices && parsed.pairedDevices.length > 0) {
        console.log(`[HandoffService] Found ${parsed.pairedDevices.length} legacy paired devices in config — migration is handled by main process`)
      }
    } else {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
      config = { ...defaultConfig }
    }
  } catch {
    config = { ...defaultConfig }
  }
  return config
}

export function getConfig(): HandoffConfig {
  return config
}

export function reloadConfig(): HandoffConfig {
  if (!configPath) return config
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw)
    config = {
      ...defaultConfig,
      ...parsed,
      server: { ...defaultConfig.server, ...(parsed.server || {}) },
      device: { ...defaultConfig.device, ...(parsed.device || {}) },
      features: { ...defaultConfig.features, ...(parsed.features || {}) },
      frpTunnel: { ...defaultConfig.frpTunnel, ...(parsed.frpTunnel || {}) }
    }
    if (parsed.pairedDevices && parsed.pairedDevices.length > 0) {
      console.log(`[HandoffService] Found ${parsed.pairedDevices.length} legacy paired devices in config — migration is handled by main process`)
    }
  } catch { /* keep current config */ }
  return config
}
