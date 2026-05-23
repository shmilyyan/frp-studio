import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import { broadcastSSE } from './http-server'

type MessageHandler = (ws: WebSocket, message: unknown) => void

const handlers: Map<string, MessageHandler> = new Map()
let wss: WebSocketServer | null = null
const connectedClients: Map<string, WebSocket> = new Map()

export function registerHandler(type: string, handler: MessageHandler): void {
  handlers.set(type, handler)
}

export function startWebSocketServer(server: http.Server): WebSocketServer {
  wss = new WebSocketServer({ server })

  wss.on('connection', (ws, _req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    connectedClients.set(clientId, ws)
    broadcastSSE('ws-connection', { clientId, connected: connectedClients.size })

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // Binary file chunk: [transferId length (1B)][transferId][chunk_index (4B LE)][chunk_data]
        try {
          const buf = raw as Buffer
          const idLen = buf.readUInt8(0)
          const transferId = buf.subarray(1, 1 + idLen).toString('utf-8')
          const chunkIndex = buf.readUInt32LE(1 + idLen)
          const chunkData = buf.subarray(1 + idLen + 4)
          const { handleFileChunk } = require('./file-transfer')
          handleFileChunk(ws, transferId, chunkIndex, chunkData)
        } catch { /* ignore malformed binary */ }
        return
      }
      try {
        const msg = JSON.parse(raw.toString())
        const handler = handlers.get(msg.type)
        if (handler) {
          handler(ws, msg)
        }
      } catch { /* ignore malformed messages */ }
    })

    ws.on('close', () => {
      connectedClients.delete(clientId)
      broadcastSSE('ws-disconnection', { clientId, connected: connectedClients.size })
    })

    ws.on('error', () => {
      connectedClients.delete(clientId)
    })
  })

  console.log('[HandoffService] WebSocket server attached to HTTP server')
  return wss
}

export function getConnectedClients(): number {
  return connectedClients.size
}

export function sendToClient(ws: WebSocket, type: string, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...(data as object) }))
  }
}

export function broadcastToAll(type: string, data: unknown): void {
  const payload = JSON.stringify({ type, ...(data as object) })
  for (const ws of connectedClients.values()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}
