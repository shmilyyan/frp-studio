import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null
let config = { port: 19528 }

export function loadHandoffConfig(cfg: { port?: number }): void {
  if (cfg.port) config.port = cfg.port
}

export function connectClient(onEvent: (event: string, data: unknown) => void): () => void {
  if (socket) socket.disconnect()

  socket = io(`http://127.0.0.1:${config.port}`, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    timeout: 10000
  })

  socket.on('connect', () => {
    console.log('[FRP Studio] socket.io connected')
    socket!.emit('auth', { role: 'admin' })
  })

  socket.on('auth:ok', () => {
    onEvent('connected', {})
  })

  socket.on('disconnect', (reason) => {
    console.log(`[FRP Studio] socket.io disconnected: ${reason}`)
    onEvent('service-status-change', { status: 'stopped' })
  })

  socket.on('connect_error', (err) => {
    console.error(`[FRP Studio] socket.io error: ${err.message}`)
  })

  // Forward all admin events to main process IPC
  socket.on('device:paired', (data) => onEvent('device:paired', data))
  socket.on('device:revoked', (data) => onEvent('device:revoked', data))
  socket.on('transfer:recorded', (data) => onEvent('transfer:recorded', data))
  socket.on('config:reloaded', () => onEvent('config:reloaded', {}))
  socket.on('service:error', (data) => onEvent('service:error', data))
  socket.on('peer:disconnected', (data) => onEvent('peer:disconnected', data))
  socket.on('peer:connected', (data) => onEvent('peer:connected', data))
  socket.on('bonjour:found', (data) => onEvent('bonjour:found', data))
  socket.on('bonjour:lost', (data) => onEvent('bonjour:lost', data))

  socket.on('connect', () => {
    onEvent('service-status-change', { status: 'running' })
  })

  return () => {
    socket?.disconnect()
    socket = null
  }
}

export async function getHealth(): Promise<{ status: string; uptime: number; connections: number; version: string }> {
  // Use HTTP health endpoint for accurate service info
  return new Promise((resolve) => {
    require('http').get(`http://127.0.0.1:${config.port}/health`, (res: any) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
        catch { resolve({ status: 'stopped', uptime: 0, connections: 0, version: '0.0.0' }) }
      })
    }).on('error', () => {
      resolve({ status: 'stopped', uptime: 0, connections: 0, version: '0.0.0' })
    })
  })
}

export function stopClient(): void {
  socket?.disconnect()
  socket = null
}
