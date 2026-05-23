import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { WebSocket } from 'ws'
import { getConfig } from './config'
import { sendToClient } from './ws-server'

const CHUNK_SIZE = 256 * 1024 // 256KB
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB

interface ActiveTransfer {
  filename: string
  size: number
  receivedChunks: number
  totalChunks: number
  chunks: Map<number, Buffer>
  checksum: string
  ws: WebSocket
  direction: 'send' | 'receive'
}

const activeTransfers: Map<string, ActiveTransfer> = new Map()

export function handleFileOffer(ws: WebSocket, msg: { filename: string; size: number; checksum: string }): void {
  if (msg.size <= 0 || msg.size > MAX_FILE_SIZE) {
    sendToClient(ws, 'file:error', { error: `file size must be between 1 and ${MAX_FILE_SIZE} bytes` })
    return
  }

  const transferId = crypto.randomBytes(8).toString('hex')
  const totalChunks = Math.ceil(msg.size / CHUNK_SIZE)

  activeTransfers.set(transferId, {
    filename: msg.filename,
    size: msg.size,
    receivedChunks: 0,
    totalChunks,
    chunks: new Map(),
    checksum: msg.checksum,
    ws,
    direction: 'receive'
  })

  sendToClient(ws, 'file:offer-ack', { transferId, accept: true })
}

export function handleFileChunk(ws: WebSocket, transferId: string, chunkIndex: number, data: Buffer): void {
  const transfer = activeTransfers.get(transferId)
  if (!transfer) {
    sendToClient(ws, 'file:error', { transferId, error: 'unknown transfer' })
    return
  }

  transfer.chunks.set(chunkIndex, data)
  transfer.receivedChunks++

  if (transfer.receivedChunks === transfer.totalChunks) {
    completeReceive(transferId)
  }
}

function completeReceive(transferId: string): void {
  const transfer = activeTransfers.get(transferId)
  if (!transfer) return

  const config = getConfig()
  const downloadDir = config.device.downloadDir || path.join(os.homedir(), 'Downloads', 'FrpTransfer')
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true })
  }

  const chunks: Buffer[] = []
  for (let i = 0; i < transfer.totalChunks; i++) {
    chunks.push(transfer.chunks.get(i) || Buffer.alloc(0))
  }
  const fullFile = Buffer.concat(chunks)

  const actualChecksum = 'sha256:' + crypto.createHash('sha256').update(fullFile).digest('hex')
  const success = actualChecksum === transfer.checksum

  const safeName = path.basename(transfer.filename)
  const resolvedDest = path.resolve(path.join(downloadDir, safeName))
  if (!resolvedDest.startsWith(path.resolve(downloadDir))) {
    sendToClient(transfer.ws, 'file:error', { transferId, error: 'path traversal blocked' })
    activeTransfers.delete(transferId)
    return
  }
  const destPath = resolvedDest

  if (success) {
    fs.writeFileSync(destPath, fullFile)
    sendToClient(transfer.ws, 'file:complete', { transferId, status: 'ok', path: destPath })
    console.log(`[HandoffService] File received: ${destPath} (${transfer.size} bytes)`)
  } else {
    sendToClient(transfer.ws, 'file:complete', { transferId, status: 'checksum_mismatch' })
  }

  activeTransfers.delete(transferId)
}

