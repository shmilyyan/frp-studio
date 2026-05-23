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
  pairedDevices: Array<{
    deviceId: string
    deviceName: string
    publicKey: string
    enabled: boolean
  }>
}

const defaultConfig: HandoffConfig = {
  server: { port: 19528, bindAddress: '0.0.0.0' },
  device: { name: 'My-Windows-PC', downloadDir: '' },
  features: { clipboardSync: true, fileTransfer: true, clipboardMaxSize: 1048576 },
  frpTunnel: { enabled: false, nodeId: null, remotePort: 19528 },
  pairedDevices: []
}

let configPath = ''
let config: HandoffConfig = { ...defaultConfig }

export function loadConfig(configDir: string): HandoffConfig {
  configPath = path.join(configDir, 'handoff.json')
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      config = { ...defaultConfig, ...JSON.parse(raw) }
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
    config = { ...defaultConfig, ...JSON.parse(raw) }
  } catch { /* keep current config */ }
  return config
}
