import { Server as SocketIOServer, Socket } from 'socket.io'
import type { Server as HTTPServer } from 'http'
import http from 'http'
import { getDeviceIdentity } from './pairing'
import { getLatestClipboard, writeClipboard } from './clipboard'
import { getConfig } from './config'

let io: SocketIOServer | null = null
type ClipboardAck = { success: boolean; transferId: string; error?: string; written?: number }
type OutboundTransfer = {
  size: number
  targetDeviceIds: Set<string>
  receiptStatusByDevice: Map<string, boolean>
  pushSocketByDevice: Map<string, string>
  retryUsedByDevice: Set<string>
  retryTimersByDevice: Map<string, ReturnType<typeof setTimeout>>
  createdAt: number
}
const outboundTransfers = new Map<string, OutboundTransfer>()
const receivedTransfers = new Map<string, ClipboardAck>()
const transferLifetimeMs = 5 * 60 * 1000
const localCopyRetryDelayMs = 2200

function newOutboundTransfer(size: number): OutboundTransfer {
  return {
    size, targetDeviceIds: new Set(), receiptStatusByDevice: new Map(),
    pushSocketByDevice: new Map(), retryUsedByDevice: new Set(),
    retryTimersByDevice: new Map(), createdAt: Date.now()
  }
}

function cancelClipboardRetry(transfer: OutboundTransfer, deviceId: string): void {
  const timer = transfer.retryTimersByDevice.get(deviceId)
  if (timer) clearTimeout(timer)
  transfer.retryTimersByDevice.delete(deviceId)
}

function pruneTransfers(): void {
  const oldest = Date.now() - transferLifetimeMs
  for (const [id, transfer] of outboundTransfers) {
    if (transfer.createdAt < oldest) {
      for (const deviceId of transfer.retryTimersByDevice.keys()) cancelClipboardRetry(transfer, deviceId)
      outboundTransfers.delete(id)
    }
  }
  // Map insertion order provides a bounded cache for retries after a lost ACK.
  while (receivedTransfers.size > 500) receivedTransfers.delete(receivedTransfers.keys().next().value!)
}

function sendClipboardToPeers(payload: string, hash: string, transferId: string, exceptSocketId?: string): void {
  if (!io) return
  pruneTransfers()
  const targets = new Set<string>()
  const transfer = newOutboundTransfer(payload.length)
  for (const peer of io.sockets.sockets.values()) {
    if (peer.data.authenticated && peer.data.role === 'peer' && peer.id !== exceptSocketId) {
      targets.add(peer.data.deviceId)
      transfer.pushSocketByDevice.set(peer.data.deviceId, peer.id)
      peer.emit('clipboard', { payload, hash, transferId, sourceId: 'server', timestamp: Date.now() })
    }
  }
  if (targets.size) {
    transfer.targetDeviceIds = targets
    outboundTransfers.set(transferId, transfer)
  }
}

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
        socket.data.deviceName = msg.deviceName
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

        // Update device online status (last_seen + last_ip)
        const statusPost = JSON.stringify({
          deviceId: msg.deviceId,
          online: true,
          ip: socket.handshake.address
        })
        const statusReq = http.request({
          hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(statusPost) }
        }, () => {})
        statusReq.on('error', (e: Error) => console.error('[socket.io] Failed to update device status:', e.message))
        statusReq.write(statusPost)
        statusReq.end()

        // Notify admin
        io!.to('admin').emit('device:paired', { deviceId: msg.deviceId, deviceName: msg.deviceName })
        io!.to('admin').emit('peer:connected', {
          deviceId: msg.deviceId,
          ip: socket.handshake.address
        })
        socket.emit('auth:ok', {
          role: 'peer',
          deviceId: msg.deviceId,
          serverDeviceId: getDeviceIdentity().deviceId
        })
        console.log(`[socket.io] Peer registered: ${msg.deviceName} (${msg.deviceId})`)
        return
      }

      // Invalid auth
      socket.emit('error', { message: 'invalid authentication' })
      socket.disconnect()
    })

    // ACK only after Windows has written the clipboard. A retry with the same
    // transfer ID returns its prior ACK without writing or announcing twice.
    socket.on('clipboard', (msg: { payload?: unknown; transferId?: unknown }, ack?: (result: ClipboardAck) => void) => {
      const transferId = typeof msg?.transferId === 'string' ? msg.transferId : ''
      const payload = typeof msg?.payload === 'string' ? msg.payload : ''
      const fail = (error: string): void => { ack?.({ success: false, transferId, error }) }
      if (!socket.data.authenticated || socket.data.role !== 'peer') return fail('authentication required')
      if (!transferId || !payload) return fail('invalid clipboard payload')
      if (payload.length > getConfig().features.clipboardMaxSize) return fail('clipboard payload too large')
      const key = `${socket.data.deviceId}:${transferId}`
      const prior = receivedTransfers.get(key)
      if (prior) { ack?.(prior); return }
      try {
        writeClipboard(payload)
        const { hash, transferId: outgoingId } = getLatestClipboard()
        const result: ClipboardAck = { success: true, transferId, written: payload.length }
        receivedTransfers.set(key, result)
        pruneTransfers()
        ack?.(result)
        notifyAdmin('clipboard:delivery', {
          transferId, deviceId: socket.data.deviceId, deviceName: socket.data.deviceName,
          direction: 'receive', success: true, size: payload.length
        })
        sendClipboardToPeers(payload, hash, outgoingId, socket.id)
        console.log(`[socket.io] Clipboard from ${socket.id.slice(0, 8)} (${payload.length} chars)`)
      } catch (error) {
        fail(error instanceof Error ? error.message : 'clipboard write failed')
      }
    })

    socket.on('clipboard:received', (msg: { transferId?: unknown; deviceId?: unknown; success?: unknown; error?: unknown }) => {
      if (!socket.data.authenticated || socket.data.role !== 'peer' || msg?.deviceId !== socket.data.deviceId) return
      if (typeof msg.transferId !== 'string' || typeof msg.success !== 'boolean') return
      let transfer = outboundTransfers.get(msg.transferId)
      // A device-targeted HTTP pull reads the same latest transfer ID but was
      // not part of the original push (for example, it reconnected later).
      if (getLatestClipboard().transferId === msg.transferId) {
        if (!transfer) {
          transfer = newOutboundTransfer(getLatestClipboard().payload.length)
          outboundTransfers.set(msg.transferId, transfer)
        }
        transfer.targetDeviceIds.add(socket.data.deviceId)
      }
      if (!transfer || !transfer.targetDeviceIds.has(socket.data.deviceId)) return
      const trackedTransfer = transfer
      const priorStatus = trackedTransfer.receiptStatusByDevice.get(socket.data.deviceId)
      if (priorStatus === msg.success || priorStatus === true) return
      trackedTransfer.receiptStatusByDevice.set(socket.data.deviceId, msg.success)
      if (msg.success) cancelClipboardRetry(trackedTransfer, socket.data.deviceId)
      notifyAdmin('clipboard:delivery', {
        transferId: msg.transferId, deviceId: socket.data.deviceId, deviceName: socket.data.deviceName,
        direction: 'send', success: msg.success,
        error: msg.success ? undefined : (typeof msg.error === 'string' ? msg.error : 'clipboard write failed'),
        size: trackedTransfer.size
      })
      if (!msg.success && msg.error === 'local-copy-protection' &&
          !trackedTransfer.retryUsedByDevice.has(socket.data.deviceId) &&
          trackedTransfer.pushSocketByDevice.get(socket.data.deviceId) === socket.id) {
        const deviceId = socket.data.deviceId as string
        const transferId = msg.transferId
        trackedTransfer.retryUsedByDevice.add(deviceId)
        const timer = setTimeout(() => {
          trackedTransfer.retryTimersByDevice.delete(deviceId)
          const latest = getLatestClipboard()
          const peer = io?.sockets.sockets.get(socket.id)
          if (outboundTransfers.get(transferId) !== trackedTransfer || latest.transferId !== transferId ||
              trackedTransfer.receiptStatusByDevice.get(deviceId) === true || !peer?.connected ||
              !peer.data.authenticated || peer.data.role !== 'peer' || peer.data.deviceId !== deviceId) return
          peer.emit('clipboard', { ...latest, sourceId: 'server', timestamp: Date.now() })
        }, localCopyRetryDelayMs)
        trackedTransfer.retryTimersByDevice.set(deviceId, timer)
      }
    })

    socket.on('clipboard:latest', () => {
      const latest = getLatestClipboard()
      if (socket.data.role !== 'peer' || !latest.payload) return
      const transfer = outboundTransfers.get(latest.transferId) ?? newOutboundTransfer(latest.payload.length)
      transfer.targetDeviceIds.add(socket.data.deviceId)
      transfer.pushSocketByDevice.set(socket.data.deviceId, socket.id)
      outboundTransfers.set(latest.transferId, transfer)
      socket.emit('clipboard', { ...latest, sourceId: 'server', timestamp: Date.now() })
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
        for (const transfer of outboundTransfers.values()) {
          if (transfer.pushSocketByDevice.get(socket.data.deviceId) === socket.id) {
            cancelClipboardRetry(transfer, socket.data.deviceId)
          }
        }
        // Update device offline status
        if (socket.data.deviceId) {
          const offlinePost = JSON.stringify({
            deviceId: socket.data.deviceId,
            online: false
          })
          const offlineReq = http.request({
            hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(offlinePost) }
          }, () => {})
          offlineReq.on('error', () => { /* silent */ })
          offlineReq.write(offlinePost)
          offlineReq.end()
        }
        io!.to('admin').emit('peer:disconnected', { socketId: socket.id, deviceId: socket.data.deviceId })
      }
    })
  })

  console.log('[HandoffService] socket.io server attached')
  return io
}

// For clipboard watcher: broadcast Windows clipboard changes to all peers
export function broadcastClipboard(payload: string, hash: string, transferId: string): void {
  sendClipboardToPeers(payload, hash, transferId)
}

// For notifying admin of events
export function notifyAdmin(event: string, data: unknown): void {
  if (!io) return
  io.to('admin').emit(event, data)
}

// For debug/status endpoint: return list of connected clients
export function getConnectedClients(): Array<{ id: string; role: string; deviceId?: string }> {
  if (!io) return []
  const clients: Array<{ id: string; role: string; deviceId?: string }> = []
  io.sockets.sockets.forEach((socket) => {
    clients.push({
      id: socket.id,
      role: socket.data.role || 'unknown',
      deviceId: socket.data.deviceId
    })
  })
  return clients
}
