import http from 'http'
import { addTransferHistory, listPairedDevices, addPairedDevice, deletePairedDevice } from './db'

let server: http.Server | null = null

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || '/'
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => { chunks.push(chunk) })

  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf-8')

    // GET /internal/devices
    if (req.method === 'GET' && url === '/internal/devices') {
      const devices = listPairedDevices().map((d) => ({
        deviceId: d.device_id,
        deviceName: d.device_name,
        publicKey: d.public_key,
        enabled: !!d.enabled,
        lastSeen: d.last_seen || 0,
        lastIp: d.last_ip || ''
      }))
      res.writeHead(200)
      res.end(JSON.stringify(devices))
      return
    }

    // POST /internal/transfer-record
    if (req.method === 'POST' && url === '/internal/transfer-record') {
      try {
        const { deviceId, type, direction, detail, size, status } = JSON.parse(body || '{}')
        const devices = listPairedDevices()
        const device = deviceId ? devices.find((d) => d.device_id === deviceId) : undefined
        addTransferHistory({
          device_id: device?.id || 0,
          type: type || 'clipboard',
          direction: direction || 'send',
          detail: detail || '',
          size: size || 0,
          status: status || 'success'
        })
        // Event notified via socket.io
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    // POST /internal/paired-device
    if (req.method === 'POST' && url === '/internal/paired-device') {
      try {
        const { deviceId, deviceName, publicKey, platform } = JSON.parse(body || '{}')
        const existing = listPairedDevices().find((d) => d.device_id === deviceId)
        if (!existing) {
          addPairedDevice({
            device_id: deviceId,
            device_name: deviceName,
            platform: platform || 'ios',
            public_key: publicKey
          })
        }
        // Event notified via socket.io
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    // POST /internal/revoke-device
    if (req.method === 'POST' && url === '/internal/revoke-device') {
      try {
        const { deviceId } = JSON.parse(body || '{}')
        const device = listPairedDevices().find((d) => d.device_id === deviceId)
        if (device) {
          deletePairedDevice(device.id)
          // Event notified via socket.io
          res.writeHead(200)
          res.end(JSON.stringify({ success: true }))
        } else {
          res.writeHead(404)
          res.end(JSON.stringify({ error: 'device not found' }))
        }
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    // POST /internal/device-status — update device online status
    if (req.method === 'POST' && url === '/internal/device-status') {
      try {
        const { deviceId, ip } = JSON.parse(body || '{}')
        const { updateDeviceStatus, getPairedDeviceByDeviceId } = require('./db')
        const device = getPairedDeviceByDeviceId(deviceId)
        if (device) {
          const now = Math.floor(Date.now() / 1000)
          const updateData: { last_seen?: number; last_ip?: string } = { last_seen: now }
          if (ip && ip !== '0.0.0.0' && ip !== '::1' && ip !== '127.0.0.1') {
            updateData.last_ip = ip
          }
          updateDeviceStatus(deviceId, updateData)
        }
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    // POST /internal/scan-devices — proxy to HandoffService
    if (req.method === 'POST' && url === '/internal/scan-devices') {
      const proxyReq = http.request({
        hostname: '127.0.0.1', port: 19528, path: '/scanner/scan',
        method: 'POST'
      }, (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (c: Buffer) => chunks.push(c))
        proxyRes.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8')
          res.writeHead(proxyRes.statusCode || 200)
          res.end(data)
        })
      })
      proxyReq.on('error', () => {
        res.writeHead(503)
        res.end(JSON.stringify({ error: 'handoff service not reachable' }))
      })
      proxyReq.end()
      return
    }

    // POST /internal/set-scan-interval — proxy to HandoffService
    if (req.method === 'POST' && url === '/internal/set-scan-interval') {
      try {
        const { interval } = JSON.parse(body || '{}')
        const postData = JSON.stringify({ interval: Math.max(5, interval || 30) })
        const proxyReq = http.request({
          hostname: '127.0.0.1', port: 19528, path: '/scanner/interval',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, (proxyRes) => {
          const chunks: Buffer[] = []
          proxyRes.on('data', (c: Buffer) => chunks.push(c))
          proxyRes.on('end', () => {
            const data = Buffer.concat(chunks).toString('utf-8')
            res.writeHead(proxyRes.statusCode || 200)
            res.end(data)
          })
        })
        proxyReq.on('error', () => {
          res.writeHead(503)
          res.end(JSON.stringify({ error: 'handoff service not reachable' }))
        })
        proxyReq.write(postData)
        proxyReq.end()
      } catch (e) {
        res.writeHead(400)
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
  })
}

export function startInternalHTTPServer(): void {
  server = http.createServer(handleRequest)
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[FRP Studio] Internal HTTP server error: ${err.message}`)
  })
  server.listen(19529, '127.0.0.1', () => {
    console.log('[FRP Studio] Internal HTTP server on 127.0.0.1:19529')
  })
}

export function stopInternalHTTPServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
