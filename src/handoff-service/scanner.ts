import http from 'http'
import { getConfig } from './config'

let scanTimer: ReturnType<typeof setInterval> | null = null
let previousDevices: Set<string> = new Set()
let currentScanDevices: Set<string> = new Set()

function notifyDeviceFound(deviceId: string, ip: string): void {
  currentScanDevices.add(deviceId)
  if (previousDevices.has(deviceId)) return  // already known from previous scan

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

function finalizeScan(): void {
  // Devices in previous but not in current → went offline
  for (const deviceId of previousDevices) {
    if (!currentScanDevices.has(deviceId)) {
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
  }
  previousDevices = currentScanDevices
  currentScanDevices = new Set()
}

export function refreshScan(): void {
  console.log('[scanner] 手动扫描触发')
  currentScanDevices.clear()
}

export function startScanner(onScan: () => void): void {
  stopScanner()
  const config = getConfig()
  const interval = Math.max(5, config.scanner.interval || 30) * 1000
  console.log(`[scanner] 定时扫描已启动 (间隔 ${interval / 1000}s)`)

  scanTimer = setInterval(() => {
    onScan()
    // Finalize after giving mDNS time to collect responses (1s grace period)
    setTimeout(() => finalizeScan(), 1000)
  }, interval)
}

export function setScanInterval(seconds: number): void {
  if (seconds < 5) seconds = 5
  const config = getConfig()
  config.scanner.interval = seconds
  // Persist to disk
  try {
    const { saveScannerInterval } = require('./config')
    saveScannerInterval(seconds)
  } catch { /* best effort */ }
  // Restart timer with new interval
  const { queryMDNS } = require('./mdns')
  startScanner(() => queryMDNS())
}

export function stopScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
  previousDevices.clear()
  currentScanDevices.clear()
}

export function onBonjourDeviceFound(deviceId: string, ip: string): void {
  notifyDeviceFound(deviceId, ip)
}
