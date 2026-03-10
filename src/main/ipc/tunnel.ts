import { ipcMain, BrowserWindow } from 'electron'
import {
  listTunnels,
  addTunnel,
  updateTunnel,
  deleteTunnel,
  listNodes,
  listGroups,
  bulkSetEnabled,
  bulkDeleteTunnels
} from '../db'
import { frpcManager } from '../frpc'

export function registerTunnelHandlers(): void {
  ipcMain.handle('tunnel:list', (_e, nodeId?: number) => listTunnels(nodeId))

  ipcMain.handle('tunnel:add', (_e, data) => addTunnel(data))

  ipcMain.handle('tunnel:update', (_e, id, data) => updateTunnel(id, data))

  ipcMain.handle('tunnel:delete', (_e, id) => {
    deleteTunnel(id)
    return { success: true }
  })

  ipcMain.handle('tunnel:list-groups', () => listGroups())

  ipcMain.handle('tunnel:bulk-enable', (_e, ids: number[]) => {
    bulkSetEnabled(ids, 1)
    return { success: true }
  })

  ipcMain.handle('tunnel:bulk-disable', (_e, ids: number[]) => {
    bulkSetEnabled(ids, 0)
    return { success: true }
  })

  ipcMain.handle('tunnel:bulk-delete', (_e, ids: number[]) => {
    bulkDeleteTunnels(ids)
    return { success: true }
  })

  ipcMain.handle('frpc:start', (event, nodeId: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)!
    const nodes = listNodes()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error('Node not found')

    const tunnels = listTunnels(nodeId).filter((t) => t.enabled === 1)
    if (tunnels.length === 0) throw new Error('No enabled tunnels for this node')

    frpcManager.start(
      {
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
      },
      nodeId,
      win
    )
    return frpcManager.getStatus()
  })

  ipcMain.handle('frpc:stop', () => {
    frpcManager.stop()
    return { running: false }
  })

  ipcMain.handle('frpc:status', () => frpcManager.getStatus())
}
