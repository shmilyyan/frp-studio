import http from 'http'
import fs from 'fs'
import path from 'path'
import { getConfig } from './config'

type SSEClient = http.ServerResponse

const sseClients: Set<SSEClient> = new Set()

export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    client.write(payload)
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || '/'

  // SSE event stream
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })
    res.write(`event: connected\ndata: {}\n\n`)
    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
    return
  }

  // Health check
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'running',
      uptime: process.uptime(),
      connections: sseClients.size,
      version: '0.1.0'
    }))
    return
  }

  // List paired devices
  if (req.method === 'GET' && url === '/devices') {
    const config = getConfig()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(config.pairedDevices))
    return
  }

  // Reload config (notifies service to hot-reload without restart)
  if (req.method === 'POST' && url === '/config') {
    const { reloadConfig } = require('./config')
    reloadConfig()
    broadcastSSE('config-reloaded', {})
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // Restart service
  if (req.method === 'POST' && url === '/restart') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    broadcastSSE('restarting', {})
    setTimeout(() => process.exit(0), 500)
    return
  }

  // Generate pairing QR data
  if (req.method === 'POST' && url === '/pair/generate') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const { deviceName, devicePublicKey } = JSON.parse(body)
        const { generatePairRequest } = require('./pairing')
        const result = generatePairRequest(deviceName, devicePublicKey)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, qrData: result.qrData }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // Confirm pairing
  if (req.method === 'POST' && url === '/pair/confirm') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const { token, signedToken, deviceInfo } = JSON.parse(body)
        const { confirmPairing } = require('./pairing')
        const pending = confirmPairing(token, signedToken)
        if (!pending) {
          res.writeHead(400)
          res.end(JSON.stringify({ success: false, error: 'invalid or expired pairing' }))
          return
        }
        // Add to paired devices config
        const config = getConfig()
        const configPath = path.join(process.argv[2] || path.join(process.env.APPDATA || '', 'frp-studio'), 'handoff.json')
        config.pairedDevices.push({
          deviceId: deviceInfo?.deviceId || pending.publicKey.slice(0, 16),
          deviceName: pending.deviceName,
          publicKey: pending.publicKey,
          enabled: true
        })
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
        broadcastSSE('device-paired', { deviceName: pending.deviceName })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // Revoke paired device
  if (req.method === 'POST' && url?.startsWith('/pair/revoke/')) {
    const deviceIdToRevoke = url.split('/').pop()
    const config = getConfig()
    const configPath = path.join(process.argv[2] || path.join(process.env.APPDATA || '', 'frp-studio'), 'handoff.json')
    config.pairedDevices = config.pairedDevices.filter((d) => d.deviceId !== deviceIdToRevoke)
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    broadcastSSE('device-revoked', { deviceId: deviceIdToRevoke })
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not found' }))
}

export function startHTTPServer(): http.Server {
  const config = getConfig()
  const server = http.createServer(handleRequest)
  server.listen(config.server.port, config.server.bindAddress, () => {
    console.log(`[HandoffService] HTTP server listening on ${config.server.bindAddress}:${config.server.port}`)
  })
  return server
}
