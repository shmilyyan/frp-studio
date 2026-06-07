import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
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

  // Health check
  if (req.method === 'GET' && url === '/health') {
    const cfg = getConfig()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      status: 'running',
      uptime: process.uptime(),
      connections: 0,  // now tracked by socket.io
      version: getAppVersion(),
      config: {
        deviceName: cfg.device.name,
        port: cfg.server.port,
        downloadDir: cfg.device.downloadDir || '',
        clipboardMaxSize: cfg.features.clipboardMaxSize,
        fileMaxSize: cfg.features.fileMaxSize,
        frpTunnelEnabled: cfg.frpTunnel.enabled,
        scannerInterval: cfg.scanner.interval
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
    // Config reloaded — notified via socket.io
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // Restart service
  if (req.method === 'POST' && url === '/restart') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: true }))
    // Restart signal — notified via socket.io
    setTimeout(() => process.exit(0), 500)
    return
  }

  // Device registration — iOS calls this after scanning QR
  if (req.method === 'POST' && url === '/register') {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { chunks.push(c) })
    req.on('end', () => {
      try {
        const { deviceId, deviceName, platform } = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
        if (!deviceId || !deviceName) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'deviceId and deviceName required' }))
          return
        }
        const postData = JSON.stringify({ deviceId, deviceName, publicKey: deviceId, platform: platform || 'ios' })
        const saveReq = http.request({
          hostname: '127.0.0.1', port: 19529, path: '/internal/paired-device',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (cbRes) => {
          let cbData = ''
          cbRes.on('data', (c: Buffer) => { cbData += c.toString('utf-8') })
          cbRes.on('end', () => {
            res.writeHead(200)
            res.end(JSON.stringify({ success: true }))
            // Device paired — notified via socket.io
            console.log(`[HandoffService] Device registered via HTTP: ${deviceName} (${deviceId})`)
          })
        })
        saveReq.on('error', (e: Error) => {
          console.error('[HandoffService] Failed to save device:', e.message)
          res.writeHead(500)
          res.end(JSON.stringify({ error: 'internal error' }))
        })
        saveReq.write(postData)
        saveReq.end()
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // Generate pairing QR data
  if (req.method === 'POST' && url === '/pair/generate') {
    const MAX_BODY = 1024 * 1024 // 1MB
    const chunks: Buffer[] = []
    let bodyLength = 0
    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'request body too large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        const { deviceName, devicePublicKey } = JSON.parse(body)
        const { generatePairRequest, getDeviceIdentity } = require('./pairing')
        const effectivePublicKey = devicePublicKey || getDeviceIdentity().publicKey
        const result = generatePairRequest(deviceName, effectivePublicKey)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ success: true, qrData: result.qrData }))
        // Device will be registered via WebSocket 'register' message when iOS connects
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
    const chunks: Buffer[] = []
    let bodyLength = 0
    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'request body too large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
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

        // Device paired — notified via socket.io
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
    // Device revoked — notified via socket.io
    return
  }

  // ─── Debug endpoints ────────────────────────────────────────────────────

  if (req.method === 'GET' && url === '/debug/status') {
    const cfg = getConfig()
    const { getLatestClipboard } = require('./clipboard')
    const { getConnectedClients } = require('./socket')
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
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
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

  // ─── Scanner control endpoints ───────────────────────────────────────────

  // 手动触发一次扫描
  if (req.method === 'POST' && url === '/scanner/scan') {
    try {
      const { refreshScan } = require('./scanner')
      const { queryMDNS } = require('./mdns')
      refreshScan()
      queryMDNS()
      res.writeHead(200)
      res.end(JSON.stringify({ success: true }))
    } catch (e) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: String(e) }))
    }
    return
  }

  // 设置扫描间隔
  if (req.method === 'POST' && url === '/scanner/interval') {
    const MAX_BODY = 64 * 1024 // 64KB is plenty for {"interval": 30}
    const chunks: Buffer[] = []
    let bodyLength = 0
    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'request body too large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const { interval } = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
        const { setScanInterval } = require('./scanner')
        setScanInterval(Math.max(5, interval || 30))
        res.writeHead(200)
        res.end(JSON.stringify({ success: true, interval: Math.max(5, interval || 30) }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
    })
    return
  }

  // ─── File upload endpoint ─────────────────────────────────────────────────

  if (req.method === 'POST' && url === '/file/upload') {
    const cfg = getConfig()
    const maxSize = cfg.features.fileMaxSize || 524288000
    const contentLength = parseInt(req.headers['content-length'] || '0', 10)
    const contentType = req.headers['content-type'] || ''
    console.log(`[HandoffService] /file/upload: content-length=${contentLength}, content-type=${contentType}`)

    if (contentLength > maxSize) {
      res.writeHead(413)
      res.end(JSON.stringify({ error: 'file too large', maxSize }))
      return
    }

    const boundaryMatch = contentType.match(/boundary=([^;\s]+)/)
    if (!boundaryMatch) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: 'multipart/form-data required', contentType }))
      return
    }
    const boundary = boundaryMatch[1].trim()
    console.log(`[HandoffService] /file/upload: boundary="${boundary}"`)

    const MAX_BODY = maxSize + 1024 * 1024
    const chunks: Buffer[] = []
    let bodyLength = 0
    req.on('data', (chunk: Buffer) => {
      bodyLength += chunk.length
      if (bodyLength > MAX_BODY) {
        res.writeHead(413)
        res.end(JSON.stringify({ error: 'file too large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks)
        console.log(`[HandoffService] /file/upload: body received, size=${body.length}, first 200 bytes=${body.slice(0, 200).toString('hex')}`)
        const parts = parseMultipart(body, boundary)
        console.log(`[HandoffService] /file/upload: parts keys=[${Array.from(parts.keys()).join(', ')}]`)
        const deviceId = parts.get('deviceId')?.toString('utf-8')
        const fileData = parts.get('file')
        const filename = parts.get('_filename')?.toString('utf-8') || 'unknown.bin'

        if (!deviceId) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'deviceId required' }))
          return
        }

        if (!fileData || fileData.length === 0) {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'file required' }))
          return
        }

        // DEBUG: deviceId check skipped for file transfer debugging

        // Save file
        const downloadDir = cfg.device.downloadDir ||
          path.join(os.homedir(), 'Downloads', 'FrpTransfer')
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true })
        }

        const safeName = path.basename(filename)
        let destPath = path.join(downloadDir, safeName)
        if (fs.existsSync(destPath)) {
          const ext = path.extname(safeName)
          const base = path.basename(safeName, ext)
          const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
          destPath = path.join(downloadDir, `${base}_${ts}${ext}`)
        }

        fs.writeFileSync(destPath, fileData)
        const fileSize = fileData.length

        // Auto-extract if it's a .zip file (folder transfer)
        if (destPath.toLowerCase().endsWith('.zip')) {
          try {
            const extractDir = destPath.slice(0, -4) // remove .zip
            const { execSync } = require('child_process')
            if (process.platform === 'win32') {
              execSync(`powershell -Command "Expand-Archive -Path '${destPath}' -DestinationPath '${extractDir}' -Force"`, { timeout: 60000 })
            } else {
              execSync(`unzip -o "${destPath}" -d "${extractDir}"`, { timeout: 60000 })
            }
            console.log(`[HandoffService] Zip extracted: ${extractDir}`)
            destPath = extractDir // record extraction dir path
          } catch (e) {
            console.error(`[HandoffService] Zip extraction failed:`, e)
          }
        }

        // Record transfer via internal HTTP
        const recordPost = JSON.stringify({
          deviceId,
          type: 'file',
          direction: 'receive',
          detail: destPath,
          size: fileSize,
          status: 'success'
        })
        const recordReq = http.request({
          hostname: '127.0.0.1', port: 19529, path: '/internal/transfer-record',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(recordPost) }
        }, () => {})
        recordReq.on('error', () => {})
        recordReq.write(recordPost)
        recordReq.end()

        // Notify admin
        try {
          const { notifyAdmin } = require('./socket')
          notifyAdmin('transfer:recorded', {
            type: 'file', direction: 'receive', detail: destPath, size: fileSize, status: 'success'
          })
        } catch {}

        console.log(`[HandoffService] File received: ${destPath} (${fileSize} bytes)`)
        res.writeHead(200)
        res.end(JSON.stringify({ success: true, path: destPath, size: fileSize }))
      } catch (e) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'internal error' }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not found' }))
}

function parseMultipart(body: Buffer, boundary: string): Map<string, Buffer> {
  const result = new Map<string, Buffer>()
  const boundaryBuf = Buffer.from('--' + boundary)

  let start = body.indexOf(boundaryBuf)
  if (start < 0) return result

  while (start >= 0) {
    const partStart = start + boundaryBuf.length
    // Skip \r\n after boundary
    let contentStart = partStart
    if (body[contentStart] === 13) contentStart += 2 // \r\n

    const nextBoundary = body.indexOf(boundaryBuf, contentStart)
    const partEnd = nextBoundary >= 0 ? nextBoundary : body.length
    const part = body.slice(contentStart, partEnd)

    // Find end of headers (\r\n\r\n)
    let headerEnd = -1
    for (let i = 0; i < part.length - 3; i++) {
      if (part[i] === 13 && part[i+1] === 10 && part[i+2] === 13 && part[i+3] === 10) {
        headerEnd = i
        break
      }
    }
    if (headerEnd < 0) { start = nextBoundary; continue }

    const headerStr = part.slice(0, headerEnd).toString('utf-8')
    let content = part.slice(headerEnd + 4)
    // Remove trailing \r\n
    if (content.length >= 2 && content[content.length - 2] === 13 && content[content.length - 1] === 10) {
      content = content.slice(0, content.length - 2)
    }

    // Extract name
    const nameMatch = headerStr.match(/name="([^"]+)"/)
    if (nameMatch) {
      result.set(nameMatch[1], content)
      // Extract filename
      const filenameMatch = headerStr.match(/filename="([^"]+)"/)
      if (filenameMatch) {
        result.set('_filename', Buffer.from(filenameMatch[1], 'utf-8'))
      }
    }

    start = nextBoundary
  }
  return result
}

export function startHTTPServer(): http.Server {
  const config = getConfig()
  const server = http.createServer(handleRequest)
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[HandoffService] FATAL: Port ${config.server.port} is already in use. Exiting.`)
      process.exit(1)
    }
    console.error('[HandoffService] HTTP server error:', err.message)
  })
  server.listen(config.server.port, config.server.bindAddress, () => {
    console.log(`[HandoffService] HTTP server listening on ${config.server.bindAddress}:${config.server.port}`)
  })
  return server
}
