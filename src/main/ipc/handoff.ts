import { ipcMain, BrowserWindow, shell } from 'electron'
import http from 'http'
import {
  listTransferHistory,
  clearTransferHistory,
  listPairedDevices,
  deletePairedDevice
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
  connectClient,
  stopClient
} from '../handoff-ipc-client'

let sseCleanup: (() => void) | null = null
let lastServiceStatus: 'running' | 'stopped' = 'stopped'

function httpPost(path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : ''
    const req = http.request({
      hostname: '127.0.0.1',
      port: 19528,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

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
    return listPairedDevices().map((d) => ({
      deviceId: d.device_id,
      deviceName: d.device_name,
      publicKey: d.public_key,
      enabled: !!d.enabled,
      lastSeen: d.last_seen || 0,
      lastIp: d.last_ip || ''
    }))
  })

  ipcMain.handle('handoff:delete-device', async (_e, deviceId: string) => {
    const device = listPairedDevices().find((d) => d.device_id === deviceId)
    if (device) {
      deletePairedDevice(device.id)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle('handoff:notify-config', async () => {
    await httpPost('/config')
    return { success: true }
  })

  // ─── Device scanning ────────────────────────────────────────────────────

  ipcMain.handle('handoff:scan-devices', async () => {
    await httpPost('/internal/scan-devices')
    return { success: true }
  })

  ipcMain.handle('handoff:set-scan-interval', async (_e, seconds: number) => {
    await httpPost('/internal/set-scan-interval', { interval: Math.max(5, seconds) })
    return { success: true }
  })

  ipcMain.handle('handoff:open-folder', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })

  // ─── Pairing ────────────────────────────────────────────────────────────

  ipcMain.handle('handoff:generate-pairing', async (_e, deviceName: string, devicePublicKey: string) => {
    try {
      return await httpPost('/pair/generate', { deviceName, devicePublicKey })
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

    sseCleanup = connectClient((evt, data) => {
      if (rendererWin.isDestroyed()) return
      if (evt === 'service-status-change') {
        const status = (data as { status: 'running' | 'stopped' }).status
        if (status !== lastServiceStatus) {
          lastServiceStatus = status
          rendererWin.webContents.send('handoff:service-status-change', { status })
        }
      } else {
        rendererWin.webContents.send('handoff:event', { event: evt, data })
      }
    })
  })

  ipcMain.handle('handoff:disconnect-sse', async () => {
    if (sseCleanup) {
      sseCleanup()
      sseCleanup = null
    }
    stopClient()
  })
}
