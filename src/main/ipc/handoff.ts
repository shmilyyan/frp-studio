import { ipcMain, BrowserWindow } from 'electron'
import http from 'http'
import {
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
  getPairedDevices,
  notifyConfigChanged,
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
    try {
      return await getPairedDevices()
    } catch {
      return []
    }
  })

  ipcMain.handle('handoff:delete-device', async (_e, deviceId: string) => {
    const result = await revokeServiceDevice(deviceId)
    return result
  })

  ipcMain.handle('handoff:notify-config', async () => {
    await notifyConfigChanged()
    return { success: true }
  })

  // ─── Pairing ────────────────────────────────────────────────────────────

  ipcMain.handle('handoff:generate-pairing', async (_e, deviceName: string, devicePublicKey: string) => {
    try {
      return await generatePairingQR(deviceName, devicePublicKey)
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // ─── Transfer history ───────────────────────────────────────────────────

  ipcMain.handle('handoff:transfer-history', async (_e, type?: string, limit?: number) => {
    return listTransferHistory(limit || 50, type)
  })

  ipcMain.handle('handoff:clear-history', async () => {
    clearTransferHistory()
    return { success: true }
  })

  // ─── Clipboard test helpers (via IPC, bypasses browser CSP) ─────────────

  ipcMain.handle('handoff:clipboard-get', async () => {
    return new Promise((resolve) => {
      http.get('http://127.0.0.1:19528/clipboard/latest', (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => { chunks.push(c) })
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8')
          try { resolve(JSON.parse(data)) }
          catch { resolve({ payload: '', error: 'parse failed' }) }
        })
      }).on('error', (e) => resolve({ payload: '', error: e.message }))
    })
  })

  ipcMain.handle('handoff:clipboard-send', async (_e, text: string) => {
    return new Promise((resolve) => {
      const body = JSON.stringify({ payload: text })
      const req = http.request({
        hostname: '127.0.0.1', port: 19528, path: '/clipboard',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => { chunks.push(c) })
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8')
          try { resolve(JSON.parse(data)) }
          catch { resolve({ success: false, error: 'parse failed' }) }
        })
      })
      req.on('error', (e) => resolve({ success: false, error: e.message }))
      req.write(body)
      req.end()
    })
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
