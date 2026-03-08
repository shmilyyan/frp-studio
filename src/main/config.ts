import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface AppConfig {
  trayEnabled: boolean
  trayPromptShown: boolean
  activeNodeId: number | null
  autoReconnect: boolean
  reconnectDelay: number
  reconnectMaxRetries: number
}

const DEFAULT_CONFIG: AppConfig = {
  trayEnabled: false,
  trayPromptShown: false,
  activeNodeId: null,
  autoReconnect: true,
  reconnectDelay: 5,
  reconnectMaxRetries: 0
}

let configPath: string
let config: AppConfig = { ...DEFAULT_CONFIG }

export function initConfig(): void {
  const userData = app.getPath('userData')
  configPath = path.join(userData, 'config.json')

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    } catch {
      config = { ...DEFAULT_CONFIG }
    }
  }
}

export function getConfig(): AppConfig {
  return { ...config }
}

export function setConfig(partial: Partial<AppConfig>): void {
  config = { ...config, ...partial }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}
