import { ipcMain, BrowserWindow, dialog } from 'electron'
import { getFrpVersions, downloadFrp, getInstalledFrpVersion } from '../downloader'
import { setAutostart, getAutostart } from '../autostart'
import { getConfig, setConfig, AppConfig } from '../config'
import { listNodes, addNode, listTunnels, addTunnel } from '../db'
import { parse as parseTOML, stringify as stringifyTOML } from '@iarna/toml'

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
    setConfig(partial)
    return getConfig()
  })

  // ─── Export frpc TOML ─────────────────────────────────────────────────────

  ipcMain.handle('config:export', async (event, nodeId?: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const nodes = listNodes()
    const exportNodes = nodeId ? nodes.filter((n) => n.id === nodeId) : nodes

    if (exportNodes.length === 0) return { success: false, error: '没有可导出的节点' }

    // 只取第一个节点（导出当前节点模式）
    const node = exportNodes[0]
    const tunnels = listTunnels(node.id).filter((t) => t.enabled === 1)

    const tomlObj: Record<string, unknown> = {
      serverAddr: node.host,
      serverPort: node.port
    }
    if (node.token) {
      tomlObj['auth'] = { method: 'token', token: node.token }
    }
    tomlObj['proxies'] = tunnels.map((t) => {
      const proxy: Record<string, unknown> = {
        name: t.name,
        type: t.type,
        localIP: t.local_ip,
        localPort: t.local_port
      }
      if (t.remote_port) proxy['remotePort'] = t.remote_port
      if (t.custom_domain) proxy['customDomains'] = [t.custom_domain]
      return proxy
    })

    const { filePath } = await dialog.showSaveDialog(win, {
      title: '导出 frpc 配置',
      defaultPath: `frpc-${node.name}.toml`,
      filters: [{ name: 'TOML 配置文件', extensions: ['toml'] }]
    })

    if (!filePath) return { success: false, error: 'cancelled' }

    const fs = await import('fs')
    const content =
      `# FRP Studio 导出配置 - 节点: ${node.name}\n` +
      `# 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n` +
      stringifyTOML(tomlObj as Parameters<typeof stringifyTOML>[0])

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
        group_name: '导入'
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
}
