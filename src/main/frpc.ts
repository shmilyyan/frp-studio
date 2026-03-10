import { ChildProcess, spawn } from 'child_process'
import { BrowserWindow, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { getConfig } from './config'
import { getFrpcPath } from './paths'

export interface FrpcStatus {
  running: boolean
  pid?: number
  nodeId?: number
  startedAt?: number
}

export interface FrpcConfig {
  serverAddr: string
  serverPort: number
  token?: string
  tunnels: Array<{
    name: string
    type: string
    localIP: string
    localPort: number
    remotePort?: number
    customDomain?: string
    extraAttrs?: Record<string, string>
  }>
}

class FrpcManager {
  private process: ChildProcess | null = null
  private status: FrpcStatus = { running: false }
  private configPath: string
  private frpcPath: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private lastConfig: FrpcConfig | null = null
  private lastNodeId: number | null = null
  private lastWin: BrowserWindow | null = null
  private statusChangeListeners: Array<() => void> = []
  private manualStop = false

  constructor() {
    const userData = app.getPath('userData')
    this.configPath = path.join(userData, 'frpc.toml')
    this.frpcPath = getFrpcPath()
  }

  private generateConfig(config: FrpcConfig): string {
    let toml = `serverAddr = "${config.serverAddr}"\n`
    toml += `serverPort = ${config.serverPort}\n`
    if (config.token) {
      toml += `\n[auth]\nmethod = "token"\ntoken = "${config.token}"\n`
    }
    for (const tunnel of config.tunnels) {
      const ea = tunnel.extraAttrs ?? {}
      toml += `\n[[proxies]]\n`
      toml += `name = "${tunnel.name}"\n`
      toml += `type = "${tunnel.type}"\n`

      if (['tcp', 'udp', 'stcp', 'sudp'].includes(tunnel.type)) {
        toml += `localIP = "${tunnel.localIP}"\n`
        toml += `localPort = ${tunnel.localPort}\n`
        if (tunnel.remotePort && ['tcp', 'udp'].includes(tunnel.type)) {
          toml += `remotePort = ${tunnel.remotePort}\n`
        }
      } else if (['http', 'https'].includes(tunnel.type)) {
        toml += `localIP = "${tunnel.localIP}"\n`
        toml += `localPort = ${tunnel.localPort}\n`
        if (tunnel.customDomain) toml += `customDomains = ["${tunnel.customDomain}"]\n`
      }

      // HTTP / HTTPS 扩展字段
      if (['http', 'https'].includes(tunnel.type)) {
        if (ea.subdomain) toml += `subdomain = "${ea.subdomain}"\n`
        if (ea.locations) {
          try {
            const locs = JSON.parse(ea.locations) as string[]
            if (locs.length > 0) toml += `locations = [${locs.map((l) => `"${l}"`).join(', ')}]\n`
          } catch { /* ignore */ }
        }
        if (ea.httpUser) toml += `httpUser = "${ea.httpUser}"\n`
        if (ea.httpPassword) toml += `httpPassword = "${ea.httpPassword}"\n`
        if (ea.hostHeaderRewrite) toml += `hostHeaderRewrite = "${ea.hostHeaderRewrite}"\n`
      }

      // STCP / SUDP 扩展字段
      if (['stcp', 'sudp'].includes(tunnel.type)) {
        if (ea.secretKey) toml += `secretKey = "${ea.secretKey}"\n`
        if (ea.allowUsers) {
          try {
            const users = JSON.parse(ea.allowUsers) as string[]
            if (users.length > 0) toml += `allowUsers = [${users.map((u) => `"${u}"`).join(', ')}]\n`
          } catch { /* ignore */ }
        }
      }

      // [proxies.transport] 子块
      const transportLines: string[] = []
      if (ea.useEncryption === 'true') transportLines.push(`  useEncryption = true`)
      if (ea.useCompression === 'true') transportLines.push(`  useCompression = true`)
      if (ea.bandwidthLimit) transportLines.push(`  bandwidthLimit = "${ea.bandwidthLimit}"`)
      if (transportLines.length > 0) {
        toml += `[proxies.transport]\n`
        toml += transportLines.join('\n') + '\n'
      }
    }
    return toml
  }

  private sendLog(
    win: BrowserWindow,
    type: 'stdout' | 'stderr' | 'system' | 'error',
    line: string
  ): void {
    if (!win.isDestroyed()) {
      win.webContents.send('frpc:log', { type, line, timestamp: Date.now() })
    }
  }

  private sendStatus(win: BrowserWindow): void {
    if (!win.isDestroyed()) {
      win.webContents.send('frpc:status', this.status)
    }
    this.statusChangeListeners.forEach((cb) => cb())
  }

  private scheduleReconnect(): void {
    const win = this.lastWin
    if (!win || win.isDestroyed()) return

    const cfg = getConfig()
    if (!cfg.autoReconnect || this.manualStop) return
    if (cfg.reconnectMaxRetries > 0 && this.retryCount >= cfg.reconnectMaxRetries) {
      this.sendLog(win, 'error', `已达最大重连次数（${cfg.reconnectMaxRetries}），停止重连`)
      new Notification({
        title: 'Frper',
        body: `连接失败，已达最大重试次数 ${cfg.reconnectMaxRetries}，请手动检查`
      }).show()
      return
    }

    this.retryCount++
    const delay = cfg.reconnectDelay
    this.sendLog(win, 'system', `${delay} 秒后自动重连（第 ${this.retryCount} 次）...`)

    new Notification({
      title: 'Frper',
      body: `连接断开，${delay} 秒后自动重连（第 ${this.retryCount} 次）`
    }).show()

    this.reconnectTimer = setTimeout(() => {
      if (this.lastConfig && this.lastNodeId !== null && this.lastWin) {
        this.start(this.lastConfig, this.lastNodeId, this.lastWin)
      }
    }, delay * 1000)
  }

  start(config: FrpcConfig, nodeId: number, win: BrowserWindow): void {
    if (this.process) this.stop()
    this.clearReconnectTimer()

    if (!fs.existsSync(this.frpcPath)) {
      throw new Error('frpc binary not found. Please download FRP first.')
    }

    this.manualStop = false
    this.lastConfig = config
    this.lastNodeId = nodeId
    this.lastWin = win

    const configContent = this.generateConfig(config)
    fs.writeFileSync(this.configPath, configContent, 'utf-8')

    this.process = spawn(this.frpcPath, ['-c', this.configPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.status = {
      running: true,
      pid: this.process.pid,
      nodeId,
      startedAt: Date.now()
    }
    this.sendStatus(win)

    this.process.stdout?.on('data', (data: Buffer) => {
      this.sendLog(win, 'stdout', data.toString())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      this.sendLog(win, 'stderr', data.toString())
    })

    this.process.on('exit', (code) => {
      const wasRunning = this.status.running
      this.status = { running: false }
      this.process = null
      this.sendLog(win, 'system', `frpc exited with code ${code}`)
      this.sendStatus(win)

      if (wasRunning && code !== 0 && code !== null) {
        this.scheduleReconnect()
      } else if (wasRunning && this.retryCount > 0) {
        // 重连成功
        this.retryCount = 0
        new Notification({
          title: 'Frper',
          body: '连接已恢复'
        }).show()
      }
    })

    this.process.on('error', (err) => {
      this.status = { running: false }
      this.process = null
      this.sendLog(win, 'error', `frpc error: ${err.message}`)
      this.sendStatus(win)
      this.scheduleReconnect()
    })
  }

  stop(): void {
    this.manualStop = true
    this.clearReconnectTimer()
    this.retryCount = 0
    if (this.process) {
      this.process.kill()
      this.process = null
      this.status = { running: false }
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  getStatus(): FrpcStatus {
    return { ...this.status }
  }

  getFrpcPath(): string {
    return this.frpcPath
  }

  onStatusChange(cb: () => void): void {
    this.statusChangeListeners.push(cb)
  }
}

export const frpcManager = new FrpcManager()
