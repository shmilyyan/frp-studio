import { ipcMain, BrowserWindow, dialog } from 'electron'
import {
  getFrpVersions,
  downloadFrp,
  getInstalledFrpVersion,
  getLatestVersion,
  importFrpcBinary,
  retryDownloadWithNewProxy,
  listBackups,
  restoreBackup
} from '../downloader'
import { setAutostart, getAutostart } from '../autostart'
import { getConfig, setConfig, AppConfig } from '../config'
import { listNodes, addNode, listTunnels, addTunnel, getNodeById } from '../db'
import { parse as parseTOML } from '@iarna/toml'
import type { NodeRow, TunnelRow } from '../db/schema'
import {
  getServiceStatus,
  installService,
  uninstallService,
  startService,
  stopService
} from '../winsvc'

function generateFrpcConfig(node: NodeRow, tunnels: TunnelRow[]): string {
  let toml = `serverAddr = "${node.host}"\n`
  toml += `serverPort = ${node.port}\n`
  if (node.token) {
    toml += `\n[auth]\nmethod = "token"\ntoken = "${node.token}"\n`
  }
  for (const t of tunnels) {
    const ea: Record<string, string> = (() => {
      try { return JSON.parse(t.extra_attrs || '{}') }
      catch { return {} }
    })()

    toml += `\n[[proxies]]\n`
    toml += `name = "${t.name}"\n`
    toml += `type = "${t.type}"\n`

    if (['tcp', 'udp', 'stcp', 'sudp'].includes(t.type)) {
      toml += `localIP = "${t.local_ip}"\n`
      toml += `localPort = ${t.local_port}\n`
      if (t.remote_port && ['tcp', 'udp'].includes(t.type)) {
        toml += `remotePort = ${t.remote_port}\n`
      }
    } else if (['http', 'https'].includes(t.type)) {
      toml += `localIP = "${t.local_ip}"\n`
      toml += `localPort = ${t.local_port}\n`
      if (t.custom_domain) toml += `customDomains = ["${t.custom_domain}"]\n`
    }

    // HTTP / HTTPS 扩展字段
    if (['http', 'https'].includes(t.type)) {
      if (ea.subdomain) toml += `subdomain = "${ea.subdomain}"\n`
      if (ea.locations) {
        try {
          const locs = JSON.parse(ea.locations) as string[]
          if (locs.length) toml += `locations = [${locs.map((l) => `"${l}"`).join(', ')}]\n`
        } catch { /* ignore */ }
      }
      if (ea.httpUser) toml += `httpUser = "${ea.httpUser}"\n`
      if (ea.httpPassword) toml += `httpPassword = "${ea.httpPassword}"\n`
      if (ea.hostHeaderRewrite) toml += `hostHeaderRewrite = "${ea.hostHeaderRewrite}"\n`
    }

    // STCP / SUDP 扩展字段
    if (['stcp', 'sudp'].includes(t.type)) {
      if (ea.secretKey) toml += `secretKey = "${ea.secretKey}"\n`
      if (ea.allowUsers) {
        try {
          const users = JSON.parse(ea.allowUsers) as string[]
          if (users.length) toml += `allowUsers = [${users.map((u) => `"${u}"`).join(', ')}]\n`
        } catch { /* ignore */ }
      }
    }

    // [proxies.transport] 子块
    const transportLines: string[] = []
    if (ea.useEncryption === 'true') transportLines.push(`  useEncryption = true`)
    if (ea.useCompression === 'true') transportLines.push(`  useCompression = true`)
    if (ea.bandwidthLimit) transportLines.push(`  bandwidthLimit = "${ea.bandwidthLimit}"`)
    if (transportLines.length) {
      toml += `[proxies.transport]\n`
      toml += transportLines.join('\n') + '\n'
    }
  }
  return toml
}

export function registerSystemHandlers(): void {
  ipcMain.handle('system:get-frp-versions', async () => {
    return getFrpVersions()
  })

  ipcMain.handle('system:download-frp', async (event, version) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    await downloadFrp(version, win)
    return { success: true }
  })

  ipcMain.handle('system:get-installed-version', () => {
    return getInstalledFrpVersion()
  })

  ipcMain.handle('system:autostart', (_e, enabled: boolean) => {
    setAutostart(enabled)
    return { success: true }
  })

  ipcMain.handle('system:get-autostart', () => {
    return getAutostart()
  })

  // ─── Global config ────────────────────────────────────────────────────────

  ipcMain.handle('config:get', () => getConfig())

  ipcMain.handle('config:set', (_e, partial: Partial<AppConfig>) => {
    const cfg = getConfig()
    const proxyChanged =
      ('proxyUrl' in partial && partial.proxyUrl !== cfg.proxyUrl) ||
      ('proxyEnabled' in partial && partial.proxyEnabled !== cfg.proxyEnabled)
    setConfig(partial)
    if (proxyChanged) retryDownloadWithNewProxy()
    return getConfig()
  })

  // ─── Export frpc TOML ─────────────────────────────────────────────────────

  ipcMain.handle('config:export', async (event, nodeId?: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const nodes = listNodes()
    const exportNodes = nodeId ? nodes.filter((n) => n.id === nodeId) : nodes

    if (exportNodes.length === 0) return { success: false, error: '没有可导出的节点' }

    const node = exportNodes[0]
    const tunnels = listTunnels(node.id).filter((t) => t.enabled === 1)

    const { filePath } = await dialog.showSaveDialog(win, {
      title: '导出 frpc 配置',
      defaultPath: `frpc-${node.name}.toml`,
      filters: [{ name: 'TOML 配置文件', extensions: ['toml'] }]
    })

    if (!filePath) return { success: false, error: 'cancelled' }

    const fs = await import('fs')
    const content =
      `# Frper 导出配置 - 节点: ${node.name}\n` +
      `# 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n` +
      generateFrpcConfig(node, tunnels)

    fs.writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  })

  // ─── Import frpc TOML ─────────────────────────────────────────────────────

  ipcMain.handle('config:import', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const { filePaths } = await dialog.showOpenDialog(win, {
      title: '导入 frpc 配置',
      filters: [{ name: 'TOML 配置文件', extensions: ['toml'] }],
      properties: ['openFile']
    })

    if (!filePaths[0]) return { success: false, error: 'cancelled' }

    const fs = await import('fs')
    const content = fs.readFileSync(filePaths[0], 'utf-8')

    let parsed: Record<string, unknown>
    try {
      parsed = parseTOML(content) as Record<string, unknown>
    } catch (e) {
      return { success: false, error: `TOML 解析失败: ${(e as Error).message}` }
    }

    const serverAddr = parsed['serverAddr'] as string
    const serverPort = (parsed['serverPort'] as number) || 7000
    const auth = parsed['auth'] as Record<string, string> | undefined
    const token = auth?.['token'] || null

    if (!serverAddr) return { success: false, error: '配置中缺少 serverAddr 字段' }

    // 检查节点是否已存在
    const existingNodes = listNodes()
    let targetNode = existingNodes.find(
      (n) => n.host === serverAddr && n.port === serverPort
    )

    if (!targetNode) {
      targetNode = addNode({
        name: `导入-${serverAddr}`,
        host: serverAddr,
        port: serverPort,
        token: token
      })
    }

    const proxies = (parsed['proxies'] as Record<string, unknown>[]) || []
    const existingTunnels = listTunnels(targetNode.id)
    const importedNames: string[] = []
    let skipped = 0

    for (const proxy of proxies) {
      let name = proxy['name'] as string
      if (existingTunnels.some((t) => t.name === name)) {
        name = `${name}_imported`
        if (existingTunnels.some((t) => t.name === name)) {
          skipped++
          continue
        }
      }
      addTunnel({
        node_id: targetNode.id,
        name,
        type: (proxy['type'] as string) || 'tcp',
        local_ip: (proxy['localIP'] as string) || '127.0.0.1',
        local_port: (proxy['localPort'] as number) || 0,
        remote_port: (proxy['remotePort'] as number) || null,
        custom_domain:
          ((proxy['customDomains'] as string[]) || [])[0] || null,
        enabled: 1,
        group_name: '导入',
        extra_attrs: '{}'
      })
      importedNames.push(name)
    }

    return {
      success: true,
      nodeId: targetNode.id,
      imported: importedNames.length,
      skipped
    }
  })

  // ─── Check for frpc updates ───────────────────────────────────────────────

  ipcMain.handle('system:check-update', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const currentVersion = getInstalledFrpVersion()
    const latest = await getLatestVersion()
    const latestVersion = latest?.version ?? null

    const hasUpdate =
      !!latestVersion &&
      !!currentVersion &&
      currentVersion !== 'unknown' &&
      latestVersion !== currentVersion

    // Persist last-check time and latest known version
    setConfig({ lastUpdateCheck: Date.now(), latestKnownVersion: latestVersion })

    if (hasUpdate) {
      win.webContents.send('system:update-available', { latestVersion, currentVersion })
    }

    return { hasUpdate, latestVersion, currentVersion }
  })

  // ─── Import frpc binary from local file ──────────────────────────────────

  ipcMain.handle('system:import-frpc', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const filters =
      process.platform === 'win32'
        ? [{ name: 'frpc 可执行文件', extensions: ['exe'] }]
        : [{ name: 'frpc 可执行文件', extensions: ['*'] }]

    const { filePaths } = await dialog.showOpenDialog(win, {
      title: '选择 frpc 可执行文件',
      filters,
      properties: ['openFile']
    })

    if (!filePaths[0]) return { success: false, version: null, error: 'cancelled' }

    return importFrpcBinary(filePaths[0], win)
  })

  // ─── Backup management ────────────────────────────────────────────────────

  ipcMain.handle('system:list-backups', () => {
    try { return listBackups() } catch { return [] }
  })

  ipcMain.handle('system:restore-backup', async (event, filename: string) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, version: null, error: '无法获取窗口' }
      return await restoreBackup(filename, win)
    } catch (e) {
      return { success: false, version: null, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ─── Windows Service Management ───────────────────────────────────────────

  ipcMain.handle('winsvc:status', async (_e, nodeId: number) => {
    return getServiceStatus(nodeId)
  })

  ipcMain.handle('winsvc:install', async (_e, nodeId: number) => {
    const node = getNodeById(nodeId)
    if (!node) return { success: false, message: '节点不存在' }

    const tunnels = listTunnels(nodeId).filter((t) => t.enabled === 1)
    if (tunnels.length === 0) {
      return { success: false, message: '该节点没有已启用的隧道，请先启用至少一条隧道' }
    }

    const configContent = generateFrpcConfig(node, tunnels)
    return installService(nodeId, node.name, configContent)
  })

  ipcMain.handle('winsvc:uninstall', async (_e, nodeId: number) => {
    return uninstallService(nodeId)
  })

  ipcMain.handle('winsvc:start', async (_e, nodeId: number) => {
    return startService(nodeId)
  })

  ipcMain.handle('winsvc:stop', async (_e, nodeId: number) => {
    return stopService(nodeId)
  })
}
