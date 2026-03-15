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

interface FrpcInstance {
  process: ChildProcess | null
  status: FrpcStatus
  configPath: string
  reconnectTimer: ReturnType<typeof setTimeout> | null
  retryCount: number
  lastConfig: FrpcConfig | null
  lastWin: BrowserWindow | null
  manualStop: boolean
}

class FrpcManager {
  private instances: Map<number, FrpcInstance> = new Map()
  private frpcPath: string
  private statusChangeListeners: Array<(nodeId?: number) => void> = []

  constructor() {
    this.frpcPath = getFrpcPath()
  }

  private getInstance(nodeId: number): FrpcInstance {
    if (!this.instances.has(nodeId)) {
      const userData = app.getPath('userData')
      this.instances.set(nodeId, {
        process: null,
        status: { running: false },
        configPath: path.join(userData, `frpc_node_${nodeId}.toml`),
        reconnectTimer: null,
        retryCount: 0,
        lastConfig: null,
        lastWin: null,
        manualStop: false
      })
    }
    return this.instances.get(nodeId)!
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
    nodeId: number,
    type: 'stdout' | 'stderr' | 'system' | 'error',
    line: string
  ): void {
    if (!win.isDestroyed()) {
      win.webContents.send('frpc:log', { nodeId, type, line, timestamp: Date.now() })
    }
  }

  private sendStatus(win: BrowserWindow, nodeId: number): void {
    const instance = this.getInstance(nodeId)
    if (!win.isDestroyed()) {
      win.webContents.send('frpc:status', { nodeId, status: instance.status })
    }
    this.statusChangeListeners.forEach((cb) => cb(nodeId))
  }

  private scheduleReconnect(nodeId: number): void {
    const instance = this.getInstance(nodeId)
    const win = instance.lastWin
    if (!win || win.isDestroyed()) return

    const cfg = getConfig()
    if (!cfg.autoReconnect || instance.manualStop) return
    if (cfg.reconnectMaxRetries > 0 && instance.retryCount >= cfg.reconnectMaxRetries) {
      this.sendLog(win, nodeId, 'error', `已达最大重连次数（${cfg.reconnectMaxRetries}），停止重连`)
      new Notification({
        title: 'Frper',
        body: `节点 ${nodeId} 连接失败，已达最大重试次数 ${cfg.reconnectMaxRetries}，请手动检查`
      }).show()
      return
    }

    instance.retryCount++
    const delay = cfg.reconnectDelay
    this.sendLog(win, nodeId, 'system', `${delay} 秒后自动重连（第 ${instance.retryCount} 次）...`)

    new Notification({
      title: 'Frper',
      body: `节点 ${nodeId} 连接断开，${delay} 秒后自动重连（第 ${instance.retryCount} 次）`
    }).show()

    instance.reconnectTimer = setTimeout(() => {
      if (instance.lastConfig && instance.lastWin) {
        this.start(instance.lastConfig, nodeId, instance.lastWin)
      }
    }, delay * 1000)
  }

  start(config: FrpcConfig, nodeId: number, win: BrowserWindow): void {
    const instance = this.getInstance(nodeId)

    if (instance.process) this.stop(nodeId)
    this.clearReconnectTimer(nodeId)

    if (!fs.existsSync(this.frpcPath)) {
      throw new Error('frpc binary not found. Please download FRP first.')
    }

    instance.manualStop = false
    instance.lastConfig = config
    instance.lastWin = win

    const configContent = this.generateConfig(config)
    fs.writeFileSync(instance.configPath, configContent, 'utf-8')

    instance.process = spawn(this.frpcPath, ['-c', instance.configPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    instance.status = {
      running: true,
      pid: instance.process.pid,
      nodeId,
      startedAt: Date.now()
    }
    this.sendStatus(win, nodeId)

    instance.process.stdout?.on('data', (data: Buffer) => {
      this.sendLog(win, nodeId, 'stdout', data.toString())
    })

    instance.process.stderr?.on('data', (data: Buffer) => {
      this.sendLog(win, nodeId, 'stderr', data.toString())
    })

    instance.process.on('exit', (code) => {
      const wasRunning = instance.status.running
      instance.status = { running: false }
      instance.process = null
      this.sendLog(win, nodeId, 'system', `frpc exited with code ${code}`)
      this.sendStatus(win, nodeId)

      if (wasRunning && code !== 0 && code !== null) {
        this.scheduleReconnect(nodeId)
      } else if (wasRunning && instance.retryCount > 0) {
        // 重连成功
        instance.retryCount = 0
        new Notification({
          title: 'Frper',
          body: `节点 ${nodeId} 连接已恢复`
        }).show()
      }
    })

    instance.process.on('error', (err) => {
      instance.status = { running: false }
      instance.process = null
      this.sendLog(win, nodeId, 'error', `frpc error: ${err.message}`)
      this.sendStatus(win, nodeId)
      this.scheduleReconnect(nodeId)
    })
  }

  stop(nodeId: number): void {
    const instance = this.getInstance(nodeId)
    instance.manualStop = true
    this.clearReconnectTimer(nodeId)
    instance.retryCount = 0
    if (instance.process) {
      instance.process.kill()
      instance.process = null
      instance.status = { running: false }
    }
  }

  stopAll(): void {
    for (const nodeId of this.instances.keys()) {
      this.stop(nodeId)
    }
  }

  private clearReconnectTimer(nodeId: number): void {
    const instance = this.getInstance(nodeId)
    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer)
      instance.reconnectTimer = null
    }
  }

  getStatus(nodeId: number): FrpcStatus {
    return { ...this.getInstance(nodeId).status }
  }

  getAllStatus(): Map<number, FrpcStatus> {
    const result = new Map<number, FrpcStatus>()
    for (const [nodeId, instance] of this.instances) {
      result.set(nodeId, { ...instance.status })
    }
    return result
  }

  getRunningNodeIds(): number[] {
    const result: number[] = []
    for (const [nodeId, instance] of this.instances) {
      if (instance.status.running) result.push(nodeId)
    }
    return result
  }

  isRunning(nodeId: number): boolean {
    return this.getInstance(nodeId).status.running
  }

  getFrpcPath(): string {
    return this.frpcPath
  }

  onStatusChange(cb: (nodeId?: number) => void): void {
    this.statusChangeListeners.push(cb)
  }
}

export const frpcManager = new FrpcManager()
