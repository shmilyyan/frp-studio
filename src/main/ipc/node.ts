import { ipcMain, BrowserWindow } from 'electron'
import {
  listNodes,
  addNode,
  updateNode,
  deleteNode,
  listNodesWithAutoStart,
  listTunnels
} from '../db'
import { testNodeConnection } from '../network'
import { validateFrpsToml, extractNodeConfig } from '../toml'
import { frpcManager, FrpcConfig } from '../frpc'

export function registerNodeHandlers(): void {
  ipcMain.handle('node:list', () => listNodes())

  ipcMain.handle('node:list-auto-start', () => listNodesWithAutoStart())

  ipcMain.handle('node:add', (_e, data) => addNode(data))

  ipcMain.handle('node:update', (_e, id, data) => updateNode(id, data))

  ipcMain.handle('node:delete', (_e, id) => {
    // Stop frpc if running for this node
    if (frpcManager.isRunning(id)) {
      frpcManager.stop(id)
    }
    deleteNode(id)
    return { success: true }
  })

  ipcMain.handle('node:test', async (_e, host, port, token) => {
    return testNodeConnection(host, port, token)
  })

  ipcMain.handle('node:validate-config', (_e, tomlContent: string) => {
    const result = validateFrpsToml(tomlContent)
    const extracted = result.valid ? extractNodeConfig(tomlContent) : {}
    return { ...result, extracted }
  })

  // Frpc control moved from tunnel handlers
  ipcMain.handle('frpc:start', (event, nodeId: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const nodes = listNodes()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error('Node not found')

    const tunnels = listTunnels(nodeId).filter((t) => t.enabled === 1)
    if (tunnels.length === 0) throw new Error('No enabled tunnels for this node')

    const config: FrpcConfig = {
      serverAddr: node.host,
      serverPort: node.port,
      token: node.token ?? undefined,
      tunnels: tunnels.map((t) => ({
        name: t.name,
        type: t.type,
        localIP: t.local_ip,
        localPort: t.local_port,
        remotePort: t.remote_port ?? undefined,
        customDomain: t.custom_domain ?? undefined,
        extraAttrs: (() => {
          try { return JSON.parse(t.extra_attrs || '{}') as Record<string, string> }
          catch { return {} }
        })()
      }))
    }

    frpcManager.start(config, nodeId, win)
    return frpcManager.getStatus(nodeId)
  })

  ipcMain.handle('frpc:stop', (_e, nodeId: number) => {
    frpcManager.stop(nodeId)
    return { running: false }
  })

  ipcMain.handle('frpc:status', (_e, nodeId: number) => frpcManager.getStatus(nodeId))

  ipcMain.handle('frpc:status-all', () => {
    const statuses: Record<number, { running: boolean; pid?: number; nodeId?: number; startedAt?: number }> = {}
    for (const [nodeId, status] of frpcManager.getAllStatus()) {
      statuses[nodeId] = status
    }
    return statuses
  })
}
