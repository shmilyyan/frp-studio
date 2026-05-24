import http from 'http'
import { getConfig, reloadConfig } from './config'

function getAppVersion(): string {
  try {
    const fs = require('fs')
    const path = require('path')
    // Try multiple locations: project root, then cwd
    const locations = [
      path.join(process.cwd(), 'VERSION'),
      path.join(process.cwd(), '..', '..', '..', 'VERSION')
    ]
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return fs.readFileSync(loc, 'utf-8').trim()
      }
    }
  } catch { /* fall through */ }
  return '0.0.0'
}

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
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

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
    const cfg = getConfig()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      status: 'running',
      uptime: process.uptime(),
      connections: sseClients.size,
      version: getAppVersion(),
      config: {
        deviceName: cfg.device.name,
        port: cfg.server.port,
        downloadDir: cfg.device.downloadDir || '',
        clipboardMaxSize: cfg.features.clipboardMaxSize,
        frpTunnelEnabled: cfg.frpTunnel.enabled
      }
    }))
    return
  }

  // List paired devices — proxy to main process SQLite
  if (req.method === 'GET' && url === '/devices') {
    http.get('http://127.0.0.1:19529/internal/devices', (proxyRes) => {
      const chunks: Buffer[] = []
      proxyRes.on('data', (c: Buffer) => { chunks.push(c) })
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        res.writeHead(200)
        res.end(data)
      })
    }).on('error', () => {
      res.writeHead(200)
      res.end('[]')
    })
    return
  }

  // Reload config (notifies service to hot-reload without restart)
  if (req.method === 'POST' && url === '/config') {
    reloadConfig()
    broadcastSSE('config-reloaded', {})
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // Restart service
  if (req.method === 'POST' && url === '/restart') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true }))
    broadcastSSE('restarting', {})
    setTimeout(() => process.exit(0), 500)
    return
  }

  // Generate pairing QR data
  if (req.method === 'POST' && url === '/pair/generate') {
    const MAX_BODY = 1024 * 1024 // 1MB
    let body = ''
    let bodyLength = 0
    req.on('data', (chunk) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'request body too large' }))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => {
      try {
        const { deviceName, devicePublicKey } = JSON.parse(body)
        const { generatePairRequest } = require('./pairing')
        const result = generatePairRequest(deviceName, devicePublicKey)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
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
    const MAX_BODY = 1024 * 1024 // 1MB
    let body = ''
    let bodyLength = 0
    req.on('data', (chunk) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'request body too large' }))
        req.destroy()
        return
      }
      body += chunk
    })
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
        // Callback to main process internal HTTP server to save device
        const postData = JSON.stringify({
          deviceId: deviceInfo?.deviceId || pending.publicKey.slice(0, 16),
          deviceName: pending.deviceName,
          publicKey: pending.publicKey,
          platform: deviceInfo?.platform || 'ios'
        })
        const req = http.request({
          hostname: '127.0.0.1', port: 19529, path: '/internal/paired-device',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (cbRes) => {
          let cbData = ''
          cbRes.on('data', (c: Buffer) => { cbData += c.toString('utf-8') })
          cbRes.on('end', () => {
            try { JSON.parse(cbData) } catch { /* ignore */ }
          })
        })
        req.on('error', (e) => console.error('[HandoffService] Failed to save device:', e.message))
        req.write(postData)
        req.end()

        broadcastSSE('device-paired', { deviceName: pending.deviceName })
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // Revoke paired device — proxy to main process SQLite
  if (req.method === 'POST' && url?.startsWith('/pair/revoke/')) {
    const deviceId = url.split('/').pop()
    const postData = JSON.stringify({ deviceId })
    const revokeReq = http.request({
      hostname: '127.0.0.1', port: 19529, path: '/internal/revoke-device',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (cbRes) => {
      let cbData = ''
      cbRes.on('data', (c: Buffer) => { cbData += c.toString('utf-8') })
      cbRes.on('end', () => {
        try { JSON.parse(cbData) } catch { /* ignore */ }
      })
    })
    revokeReq.on('error', (e) => console.error('[HandoffService] Failed to revoke device:', e.message))
    revokeReq.write(postData)
    revokeReq.end()

    res.writeHead(200)
    res.end(JSON.stringify({ success: true }))
    broadcastSSE('device-revoked', { deviceId })
    return
  }

  // ─── Debug endpoints ────────────────────────────────────────────────────

  if (req.method === 'GET' && url === '/debug/status') {
    const cfg = getConfig()
    const { getLatestClipboard } = require('./clipboard')
    const { getConnectedClients } = require('./ws-server')
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      uptime: process.uptime(),
      version: getAppVersion(),
      wsClients: getConnectedClients(),
      clipboardCache: getLatestClipboard().hash ? 'has content' : 'empty',
      clipboardSync: cfg.features.clipboardSync,
      fileTransfer: cfg.features.fileTransfer
    }))
    return
  }

  // ─── Independent clipboard HTTP endpoints ─────────────────────────────────

  if (req.method === 'GET' && url === '/clipboard/latest') {
    const { getLatestClipboard } = require('./clipboard')
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(getLatestClipboard()))
    return
  }

  if (req.method === 'POST' && url === '/clipboard') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const { payload } = JSON.parse(body)
        if (payload && typeof payload === 'string') {
          const { writeClipboard } = require('./clipboard')
          writeClipboard(payload)
          res.writeHead(200)
          res.end(JSON.stringify({ success: true, written: payload.length }))
          console.log(`[HandoffService] Clipboard received via HTTP (${payload.length} chars)`)
        } else {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'missing payload' }))
        }
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
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
