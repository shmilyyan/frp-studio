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

  // Attach socket.io server to the same HTTP server
  const { startSocketServer, broadcastClipboard } = await import('./socket')
  startSocketServer(server)

  // Start mDNS broadcast for LAN device discovery
  const { startMDNSBroadcast } = await import('./mdns')
  startMDNSBroadcast()

  // Start clipboard watcher (broadcasts changes to all connected peers)
  const { startClipboardWatcher } = await import('./clipboard')
  startClipboardWatcher((content) => {
    const { getLatestClipboard } = require('./clipboard')
    const { hash } = getLatestClipboard()
    broadcastClipboard(content, hash)
  })

  console.log('[HandoffService] All modules started')
}

main().catch((err) => {
  console.error('[HandoffService] Fatal error:', err)
  process.exit(1)
})
