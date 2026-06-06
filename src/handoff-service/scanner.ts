import http from 'http'
import { getConfig } from './config'

let scanTimer: ReturnType<typeof setInterval> | null = null
let knownOnlineDevices: Set<string> = new Set()

function notifyDeviceFound(deviceId: string, ip: string): void {
  if (knownOnlineDevices.has(deviceId)) return
  knownOnlineDevices.add(deviceId)

  console.log(`[scanner] Bonjour 发现设备: ${deviceId} @ ${ip}`)

  // Update device status via internal HTTP
  const postData = JSON.stringify({ deviceId, online: true, ip, source: 'bonjour' })
  const req = http.request({
    hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
  }, () => {})
  req.on('error', () => { /* silent */ })
  req.write(postData)
  req.end()

  // Notify admin via socket.io
  try {
    const { notifyAdmin } = require('./socket')
    notifyAdmin('bonjour:found', { deviceId, ip })
  } catch { /* socket may not be initialized yet */ }
}

function notifyDevicesOffline(): void {
  for (const deviceId of knownOnlineDevices) {
    const postData = JSON.stringify({ deviceId, online: false, source: 'bonjour' })
    const req = http.request({
      hostname: '127.0.0.1', port: 19529, path: '/internal/device-status',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, () => {})
    req.on('error', () => { /* silent */ })
    req.write(postData)
    req.end()

    try {
      const { notifyAdmin } = require('./socket')
      notifyAdmin('bonjour:lost', { deviceId })
    } catch { /* silent */ }
  }
  knownOnlineDevices.clear()
}

export function refreshScan(): void {
  console.log('[scanner] 手动扫描触发')
  notifyDevicesOffline()
}

export function startScanner(onScan: () => void): void {
  stopScanner()
  const config = getConfig()
  const interval = Math.max(5, config.scanner.interval || 30) * 1000
  console.log(`[scanner] 定时扫描已启动 (间隔 ${interval / 1000}s)`)

  scanTimer = setInterval(() => {
    notifyDevicesOffline()
    onScan()
  }, interval)
}

export function setScanInterval(seconds: number): void {
  if (seconds < 5) seconds = 5
  const config = getConfig()
  config.scanner.interval = seconds
  // Restart timer with new interval
  const { queryMDNS } = require('./mdns')
  startScanner(() => queryMDNS())
}

export function stopScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}

export function onBonjourDeviceFound(deviceId: string, ip: string): void {
  notifyDeviceFound(deviceId, ip)
}
