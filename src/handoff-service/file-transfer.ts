import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { WebSocket } from 'ws'
import { getConfig } from './config'
import { sendToClient } from './ws-server'

const CHUNK_SIZE = 256 * 1024 // 256KB

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

  const destPath = path.join(downloadDir, transfer.filename)

  if (success) {
    fs.writeFileSync(destPath, fullFile)
    sendToClient(transfer.ws, 'file:complete', { transferId, status: 'ok', path: destPath })
    console.log(`[HandoffService] File received: ${destPath} (${transfer.size} bytes)`)
  } else {
    sendToClient(transfer.ws, 'file:complete', { transferId, status: 'checksum_mismatch' })
  }

  activeTransfers.delete(transferId)
}

export function handleFileRequest(ws: WebSocket, msg: { filePath: string }): void {
  const filePath = msg.filePath
  if (!fs.existsSync(filePath)) {
    sendToClient(ws, 'file:error', { error: 'file not found' })
    return
  }

  const stat = fs.statSync(filePath)
  const filename = path.basename(filePath)
  const fileBuffer = fs.readFileSync(filePath)
  const checksum = 'sha256:' + crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const totalChunks = Math.ceil(stat.size / CHUNK_SIZE)

  const transferId = crypto.randomBytes(8).toString('hex')

  sendToClient(ws, 'file:offer', { filename, size: stat.size, checksum, transferId })

  // Send chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, stat.size)
    const chunkData = fileBuffer.subarray(start, end)

    const header = Buffer.alloc(1 + 8 + 4)
    const idBuf = Buffer.from(transferId, 'utf-8')
    header.writeUInt8(idBuf.length, 0)
    idBuf.copy(header, 1)
    header.writeUInt32LE(i, 9)
    ws.send(Buffer.concat([header, chunkData]))
  }

  console.log(`[HandoffService] File sent: ${filePath} (${stat.size} bytes)`)
}
