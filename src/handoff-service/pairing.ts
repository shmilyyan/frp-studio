import { generateDeviceId, generateKeyPair, generatePairingToken, verify } from './crypto'
import { getConfig } from './config'
import fs from 'fs'

interface PendingPairing {
  token: string
  deviceId: string
  publicKey: string
  deviceName: string
  createdAt: number
}

const pendingPairings: Map<string, PendingPairing> = new Map()

let deviceId = ''
let keyPair: { publicKey: string; privateKey: string } | null = null

export function initDeviceIdentity(configDir: string): void {
  const identityPath = configDir + '/handoff-identity.json'
  try {
    if (fs.existsSync(identityPath)) {
      const saved = JSON.parse(fs.readFileSync(identityPath, 'utf-8'))
      deviceId = saved.deviceId
      keyPair = { publicKey: saved.publicKey, privateKey: saved.privateKey }
    }
  } catch { /* ignore */ }

  if (!deviceId || !keyPair) {
    deviceId = generateDeviceId()
    keyPair = generateKeyPair()
    fs.writeFileSync(identityPath, JSON.stringify({
      deviceId,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    }), 'utf-8')
  }
}

export function getDeviceIdentity(): { deviceId: string; publicKey: string; privateKey: string } {
  if (!keyPair || !deviceId) throw new Error('Device identity not initialized')
  return { deviceId, publicKey: keyPair.publicKey, privateKey: keyPair.privateKey }
}

export function generatePairRequest(deviceName: string, devicePublicKey: string): { token: string; qrData: string } {
  const token = generatePairingToken()
  const serverId = getDeviceIdentity()
  const config = getConfig()

  pendingPairings.set(token, {
    token,
    deviceId: '',
    publicKey: devicePublicKey,
    deviceName,
    createdAt: Date.now()
  })

  const qrData = JSON.stringify({
    token,
    deviceId: serverId.deviceId,
    publicKey: serverId.publicKey,
    host: config.server.bindAddress === '0.0.0.0' ? 'localhost' : config.server.bindAddress,
    port: config.server.port
  })

  return { token, qrData }
}

export function confirmPairing(token: string, signedToken: string): PendingPairing | null {
  const pending = pendingPairings.get(token)
  if (!pending) return null

  // Remove expired pairings (5 minutes)
  if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
    pendingPairings.delete(token)
    return null
  }

  if (!verify(pending.publicKey, token, signedToken)) return null

  pendingPairings.delete(token)
  return pending
}

export function cleanupExpiredPairings(): void {
  const now = Date.now()
  for (const [token, pending] of pendingPairings) {
    if (now - pending.createdAt > 5 * 60 * 1000) {
      pendingPairings.delete(token)
    }
  }
}
