import { getConfig } from './config'

export interface BonjourDiscovery {
  discoveryId: string
  deviceId?: string
  deviceName: string
  platform: string
  host?: string
  port?: number
  lastSeen: number
}

interface DiscoveryState {
  device: BonjourDiscovery
  missedScans: number
  lastMissedStart: number
}

interface ScanWindow {
  startedAt: number
  seen: Set<string>
  timeout: ReturnType<typeof setTimeout>
}

const RESPONSE_WINDOW_MS = 1500
const MISSED_INTERVALS = 2
const discoveries = new Map<string, DiscoveryState>()
const windows = new Map<number, ScanWindow>()
let scanTimer: ReturnType<typeof setInterval> | null = null
let nextScanId = 0
let onScanQuery: (() => void) | null = null
let scanIntervalMs = 30000

function notifyAdmin(event: string, data: unknown): void {
  try {
    const { notifyAdmin: send } = require('./socket')
    send(event, data)
  } catch { /* socket may not be initialized yet */ }
}

function finalizeScan(id: number): void {
  const window = windows.get(id)
  if (!window) return
  windows.delete(id)

  for (const [discoveryId, state] of discoveries) {
    if (window.seen.has(discoveryId) || state.device.lastSeen >= window.startedAt) continue
    if (window.startedAt <= state.lastMissedStart) continue
    if (state.lastMissedStart && window.startedAt - state.lastMissedStart < scanIntervalMs) continue
    state.lastMissedStart = window.startedAt
    state.missedScans += 1
    if (state.missedScans >= MISSED_INTERVALS) {
      discoveries.delete(discoveryId)
      notifyAdmin('bonjour:lost', { discoveryId, deviceId: state.device.deviceId })
    }
  }
}

function beginScan(): void {
  if (!onScanQuery) return
  const id = ++nextScanId
  const window: ScanWindow = {
    startedAt: Date.now(),
    seen: new Set(),
    timeout: setTimeout(() => finalizeScan(id), RESPONSE_WINDOW_MS)
  }
  windows.set(id, window)
  onScanQuery()
}

export function refreshScan(): void {
  console.log('[scanner] 手动扫描触发')
  beginScan()
}

export function startScanner(onScan: () => void): void {
  stopScanner()
  onScanQuery = onScan
  const config = getConfig()
  const interval = Math.max(5, config.scanner.interval || 30) * 1000
  scanIntervalMs = interval
  console.log(`[scanner] 定时扫描已启动 (间隔 ${interval / 1000}s)`)
  beginScan()
  scanTimer = setInterval(beginScan, interval)
}

export function setScanInterval(seconds: number): void {
  if (seconds < 5) seconds = 5
  const config = getConfig()
  config.scanner.interval = seconds
  scanIntervalMs = seconds * 1000
  try {
    const { saveScannerInterval } = require('./config')
    saveScannerInterval(seconds)
  } catch { /* best effort */ }
  const query = onScanQuery || (() => require('./mdns').queryMDNS())
  if (scanTimer) clearInterval(scanTimer)
  for (const window of windows.values()) clearTimeout(window.timeout)
  windows.clear()
  onScanQuery = query
  scanTimer = setInterval(beginScan, seconds * 1000)
  beginScan()
}

export function stopScanner(): void {
  if (scanTimer) clearInterval(scanTimer)
  scanTimer = null
  for (const window of windows.values()) clearTimeout(window.timeout)
  windows.clear()
  discoveries.clear()
  onScanQuery = null
}

export function onBonjourDeviceFound(device: Omit<BonjourDiscovery, 'lastSeen'>): void {
  const lastSeen = Date.now()
  const next = { ...device, lastSeen }
  if (device.deviceId) {
    for (const [key, state] of discoveries) {
      if (!key.startsWith('service:')) continue
      if (state.device.deviceName === device.deviceName &&
          state.device.platform === device.platform &&
          state.device.host === device.host &&
          state.device.port === device.port) {
        discoveries.delete(key)
        notifyAdmin('bonjour:lost', { discoveryId: key })
      }
    }
  }
  for (const window of windows.values()) {
    if (lastSeen >= window.startedAt) window.seen.add(device.discoveryId)
  }
  discoveries.set(device.discoveryId, { device: next, missedScans: 0, lastMissedStart: 0 })
  notifyAdmin('bonjour:found', next)
}
