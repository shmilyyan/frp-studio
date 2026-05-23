import { ipcMain, BrowserWindow } from 'electron'
import {
  listPairedDevices,
  updatePairedDevice,
  deletePairedDevice,
  listTransferHistory,
  clearTransferHistory
} from '../db'
import {
  startHandoffService,
  stopHandoffService,
  restartHandoffService,
  getServiceStatus,
  getServiceUptime
} from '../handoff-service-manager'
import {
  getHealth,
  generatePairingQR,
  revokeDevice as revokeServiceDevice,
  connectSSE,
  startHealthCheck,
  stopHealthCheck
} from '../handoff-ipc-client'

let sseCleanup: (() => void) | null = null
let lastServiceStatus: 'running' | 'stopped' = 'stopped'

export function registerHandoffHandlers(): void {
  // ─── Service lifecycle ──────────────────────────────────────────────────

  ipcMain.handle('handoff:start-service', async () => {
    return { success: startHandoffService() }
  })

  ipcMain.handle('handoff:stop-service', async () => {
    stopHandoffService()
    return { success: true }
  })

  ipcMain.handle('handoff:restart-service', async () => {
    restartHandoffService()
    return { success: true }
  })

  ipcMain.handle('handoff:service-status', async () => {
    return {
      status: getServiceStatus(),
      uptime: getServiceUptime(),
      health: await getHealth().catch(() => null)
    }
  })

  // ─── Paired devices ─────────────────────────────────────────────────────

  ipcMain.handle('handoff:list-devices', async () => {
    return listPairedDevices()
  })

  ipcMain.handle('handoff:delete-device', async (_e, id: number) => {
    const devices = listPairedDevices()
    const device = devices.find((d) => d.id === id)
    if (device) {
      await revokeServiceDevice(device.device_id).catch(() => {})
      deletePairedDevice(id)
    }
    return { success: true }
  })

  ipcMain.handle('handoff:update-device', async (_e, id: number, data: { device_name?: string; enabled?: number }) => {
    updatePairedDevice(id, data)
    return { success: true }
  })

  // ─── Pairing ────────────────────────────────────────────────────────────

  ipcMain.handle('handoff:generate-pairing', async (_e, deviceName: string, devicePublicKey: string) => {
    const result = await generatePairingQR(deviceName, devicePublicKey)
    return result
  })

  // ─── Transfer history ───────────────────────────────────────────────────

  ipcMain.handle('handoff:transfer-history', async (_e, type?: string, limit?: number) => {
    return listTransferHistory(limit || 50, type)
  })

  ipcMain.handle('handoff:clear-history', async () => {
    clearTransferHistory()
    return { success: true }
  })

  // ─── SSE events forwarded to renderer ───────────────────────────────────

  ipcMain.handle('handoff:connect-sse', async (event) => {
    const rendererWin = BrowserWindow.fromWebContents(event.sender)
    if (!rendererWin) return

    if (sseCleanup) sseCleanup()

    sseCleanup = connectSSE((evt, data) => {
      if (rendererWin.isDestroyed()) return
      rendererWin.webContents.send('handoff:event', { event: evt, data })
    })

    startHealthCheck((status) => {
      if (rendererWin.isDestroyed()) return
      if (status !== lastServiceStatus) {
        lastServiceStatus = status
        rendererWin.webContents.send('handoff:service-status-change', { status })
      }
    })
  })

  ipcMain.handle('handoff:disconnect-sse', async () => {
    if (sseCleanup) {
      sseCleanup()
      sseCleanup = null
    }
    stopHealthCheck()
  })
}
