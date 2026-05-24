import path from 'path'
import fs from 'fs'

const userDataPath = process.argv[2] || path.join(process.env.APPDATA || '', 'frp-studio')

async function main(): Promise<void> {
  // Write PID file for FRP Studio to discover
  const pidFile = path.join(userDataPath, 'handoff-service.pid')
  fs.writeFileSync(pidFile, String(process.pid), 'utf-8')
  console.log(`[HandoffService] PID ${process.pid} written to ${pidFile}`)

  // Cleanup on exit
  process.on('exit', () => {
    try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
  })
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))

  // Load config
  const { loadConfig } = await import('./config')
  const config = loadConfig(userDataPath)
  console.log(`[HandoffService] Starting on port ${config.server.port}`)
  console.log(`[HandoffService] Device name: ${config.device.name}`)

  // Initialize device identity for pairing
  const { initDeviceIdentity } = await import('./pairing')
  initDeviceIdentity(userDataPath)
  console.log('[HandoffService] Device identity initialized')

  // Start HTTP server (also serves as upgrade base for WebSocket)
  const { startHTTPServer } = await import('./http-server')
  const server = startHTTPServer()

  // Attach WebSocket server to the same HTTP server
  const { startWebSocketServer, registerHandler, sendToClient } = await import('./ws-server')
  startWebSocketServer(server)

  // Register WebSocket message handlers
  const { handleFileOffer } = await import('./file-transfer')

  // Device registration: iOS sends this on first WebSocket connection
  registerHandler('register', (_ws, msg) => {
    const { deviceName, deviceId, platform } = msg as { deviceName: string; deviceId: string; platform: string }
    if (deviceId && deviceName) {
      const postData = JSON.stringify({ deviceId, deviceName, publicKey: deviceId, platform: platform || 'ios' })
      const req = require('http').request({
        hostname: '127.0.0.1', port: 19529, path: '/internal/paired-device',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, () => {})
      req.on('error', (e: Error) => console.error('[HandoffService] Failed to save device:', e.message))
      req.write(postData)
      req.end()
      console.log(`[HandoffService] Device registered: ${deviceName} (${deviceId})`)
    }
  })

  registerHandler('file:offer', (ws, msg) => {
    handleFileOffer(ws, msg as { filename: string; size: number; checksum: string })
  })

  registerHandler('file:accept', (ws, msg) => {
    // Client accepted a file offer, transfer will proceed via binary frames
    console.log('[HandoffService] File offer accepted:', msg)
  })

  registerHandler('clipboard:latest', (ws) => {
    const { getLatestClipboard } = require('./clipboard')
    sendToClient(ws, 'clipboard', getLatestClipboard())
  })

  // Receive clipboard content from iOS peers
  registerHandler('clipboard', (ws, msg) => {
    const { writeClipboard, getLatestClipboard, hashContent } = require('./clipboard')
    const { getClientId, broadcastToAll } = require('./ws-server')
    const { getConfig } = require('./config')
    const payload = (msg as { payload: string }).payload
    if (payload && typeof payload === 'string' && payload.length > 0) {
      // Enforce clipboardMaxSize limit
      const maxSize = getConfig().features.clipboardMaxSize
      if (payload.length > maxSize) return
      // Dedup: skip if content already matches cache
      const incomingHash = hashContent(payload)
      if (incomingHash === getLatestClipboard().hash) return
      writeClipboard(payload)
      const sourceId = getClientId(ws)
      const { hash } = getLatestClipboard()
      broadcastToAll('clipboard', { payload, hash, sourceId }, sourceId)
      console.log(`[HandoffService] Clipboard received from iOS (${payload.length} chars)`)
    }
  })

  // Start mDNS broadcast for LAN device discovery
  const { startMDNSBroadcast } = await import('./mdns')
  startMDNSBroadcast()

  // Start clipboard watcher (broadcasts changes to all connected peers)
  const { startClipboardWatcher } = await import('./clipboard')
  const { broadcastToAll } = await import('./ws-server')
  startClipboardWatcher((content) => {
    const { getLatestClipboard } = require('./clipboard')
    const { hash } = getLatestClipboard()
    broadcastToAll('clipboard', { payload: content, hash, timestamp: Date.now() })
  })

  console.log('[HandoffService] All modules started')
}

main().catch((err) => {
  console.error('[HandoffService] Fatal error:', err)
  process.exit(1)
})
