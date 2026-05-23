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

  const { loadConfig } = await import('./config')
  const config = loadConfig(userDataPath)
  console.log(`[HandoffService] Starting on port ${config.server.port}`)
  console.log(`[HandoffService] Device name: ${config.device.name}`)
}

main().catch((err) => {
  console.error('[HandoffService] Fatal error:', err)
  process.exit(1)
})
