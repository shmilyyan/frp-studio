import { ipcMain } from 'electron'
import {
  listTunnels,
  addTunnel,
  updateTunnel,
  deleteTunnel,
  listGroups,
  bulkSetEnabled,
  bulkDeleteTunnels
} from '../db'

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
}
