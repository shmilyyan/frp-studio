import { Server as SocketIOServer, Socket } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import http from 'http'

let io: SocketIOServer | null = null

export function startSocketServer(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 5000,
    connectTimeout: 10000
  })

  io.on('connection', (socket: Socket) => {
    console.log(`[socket.io] Client connected: ${socket.id}`)

    // All clients must authenticate within 5 seconds
    const authTimer = setTimeout(() => {
      if (!socket.data.authenticated) {
        console.log(`[socket.io] Auth timeout: ${socket.id}`)
        socket.emit('error', { message: 'authentication required' })
        socket.disconnect()
      }
    }, 5000)

    socket.on('auth', (msg: { role?: string; deviceId?: string; deviceName?: string; platform?: string }) => {
      clearTimeout(authTimer)

      if (msg.role === 'admin') {
        socket.data.authenticated = true
        socket.data.role = 'admin'
        socket.join('admin')
        console.log(`[socket.io] Admin authenticated: ${socket.id}`)
        socket.emit('auth:ok', { role: 'admin' })
        return
      }

      // iOS peer: auto-register device
      if (msg.deviceId && msg.deviceName) {
        socket.data.authenticated = true
        socket.data.role = 'peer'
        socket.data.deviceId = msg.deviceId
        socket.join('peers')

        // Register device in SQLite via internal HTTP
        const postData = JSON.stringify({
          deviceId: msg.deviceId,
          deviceName: msg.deviceName,
          publicKey: msg.deviceId,
          platform: msg.platform || 'ios'
        })
        const req = http.request({
          hostname: '127.0.0.1', port: 19529, path: '/internal/paired-device',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        }, () => {})
        req.on('error', (e: Error) => console.error('[socket.io] Failed to save device:', e.message))
        req.write(postData)
        req.end()

        // Notify admin
        io!.to('admin').emit('device:paired', { deviceId: msg.deviceId, deviceName: msg.deviceName })
        socket.emit('auth:ok', { role: 'peer', deviceId: msg.deviceId })
        console.log(`[socket.io] Peer registered: ${msg.deviceName} (${msg.deviceId})`)
        return
      }

      // Invalid auth
      socket.emit('error', { message: 'invalid authentication' })
      socket.disconnect()
    })

    // Clipboard from iOS peer → broadcast to admin + other peers
    socket.on('clipboard', (msg: { payload: string; hash?: string }) => {
      if (!socket.data.authenticated) return
      const { writeClipboard, getLatestClipboard } = require('./clipboard')
      if (msg.payload && typeof msg.payload === 'string') {
        writeClipboard(msg.payload)
        const { hash } = getLatestClipboard()
        socket.to('admin').emit('clipboard', { payload: msg.payload, hash, sourceId: socket.id })
        socket.to('peers').emit('clipboard', { payload: msg.payload, hash, sourceId: socket.id })
        console.log(`[socket.io] Clipboard from ${socket.id.slice(0,8)} (${msg.payload.length} chars)`)
      }
    })

    socket.on('clipboard:latest', () => {
      const { getLatestClipboard } = require('./clipboard')
      socket.emit('clipboard', getLatestClipboard())
    })

    socket.on('file:offer', (msg) => {
      socket.to('peers').emit('file:offer', msg)
    })

    socket.on('file:accept', (msg) => {
      socket.to('peers').emit('file:accept', msg)
    })

    socket.on('disconnect', (reason) => {
      console.log(`[socket.io] Client disconnected: ${socket.id} (${reason})`)
      if (socket.data.role === 'peer') {
        io!.to('admin').emit('peer:disconnected', { socketId: socket.id, deviceId: socket.data.deviceId })
      }
    })
  })

  console.log('[HandoffService] socket.io server attached')
  return io
}

// For clipboard watcher: broadcast Windows clipboard changes to all peers
export function broadcastClipboard(payload: string, hash: string): void {
  if (!io) return
  io.to('peers').emit('clipboard', { payload, hash, sourceId: 'server', timestamp: Date.now() })
}

// For notifying admin of events
export function notifyAdmin(event: string, data: unknown): void {
  if (!io) return
  io.to('admin').emit(event, data)
}
