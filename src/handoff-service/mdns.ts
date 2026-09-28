import multicastDns from 'multicast-dns'
import { getConfig } from './config'
import os from 'os'
import { isIP } from 'net'

let mdns: multicastDns.MulticastDNS | null = null
const services = new Map<string, { target: string; port: number }>()
const metadata = new Map<string, Record<string, string>>()
const addresses = new Map<string, string>()

function normalized(name: string): string {
  return name.replace(/\.$/, '').toLowerCase()
}

function usableAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const family = isIP(value)
  if (!family) return false
  if (value === '0.0.0.0' || value === '::' || value === '::1') return false
  if (family === 4) {
    const [first, second] = value.split('.').map(Number)
    if (first === 0 || first === 127 || first >= 224 || (first === 169 && second === 254)) return false
  } else {
    const lower = value.toLowerCase()
    if (lower.startsWith('fe80:') || lower.startsWith('ff')) return false
  }
  return true
}

function parseTXT(data: unknown): Record<string, string> {
  const entries = Array.isArray(data) ? data : [data]
  const result: Record<string, string> = {}
  for (const entry of entries) {
    const value = Buffer.isBuffer(entry) ? entry : Buffer.from(String(entry || ''))
    try {
      const json = JSON.parse(value.toString('utf-8'))
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        for (const [key, field] of Object.entries(json)) {
          if (typeof field === 'string') result[key] = field
        }
        continue
      }
    } catch { /* DNS-SD key=value entries */ }
    Object.assign(result, parseDNSSDTXT(value))
    const plain = value.toString('utf-8')
    const equals = plain.indexOf('=')
    if (equals > 0) result[plain.slice(0, equals)] = plain.slice(equals + 1)
  }
  return result
}

function publishResolvedServices(changedNames: Set<string>): void {
  for (const [name, service] of services) {
    if (!changedNames.has(name) && !changedNames.has(normalized(service.target))) continue
    const txt = metadata.get(name)
    const host = addresses.get(normalized(service.target))
    if (!txt) continue
    const deviceId = txt.deviceId || undefined
    if (deviceId && deviceId === getDeviceId()) continue
    const deviceName = txt.deviceName || txt.name || name.split('._handoff._tcp.local')[0]
    const discoveryId = deviceId || `service:${name}`
    try {
      const { onBonjourDeviceFound } = require('./scanner')
      onBonjourDeviceFound({
        discoveryId, deviceId, deviceName,
        platform: txt.platform || 'unknown',
        ...(host ? { host } : {}),
        ...(service.port > 0 ? { port: service.port } : {})
      })
    } catch { /* scanner may not be started yet */ }
  }
}

function getDeviceId(): string {
  try {
    const { getDeviceIdentity } = require('./pairing')
    return getDeviceIdentity()?.deviceId || ''
  } catch (e) {
    console.error('[mDNS] Failed to get deviceId:', e)
    return ''
  }
}

function getVersion(): string {
  try {
    const fs = require('fs')
    const path = require('path')
    // Try relative to cwd (project root when running via dev:full), then relative to script
    const locations = [
      path.join(process.cwd(), 'VERSION'),
      path.join(__dirname, '..', '..', '..', 'VERSION')
    ]
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return fs.readFileSync(loc, 'utf-8').trim()
      }
    }
  } catch { /* fall through */ }
  return '0.1.0'
}

// Parse DNS-SD TXT record format (length-prefixed key=value strings)
function parseDNSSDTXT(buf: Buffer): Record<string, string> {
  const result: Record<string, string> = {}
  let offset = 0
  while (offset < buf.length) {
    const len = buf[offset]
    offset += 1
    if (len === 0 || offset + len > buf.length) break
    const entry = buf.slice(offset, offset + len).toString('utf-8')
    offset += len
    const eq = entry.indexOf('=')
    if (eq > 0) {
      result[entry.slice(0, eq)] = entry.slice(eq + 1)
    }
  }
  return result
}

export function startMDNSBroadcast(): void {
  const config = getConfig()
  mdns = multicastDns()

  const deviceName = config.device.name || os.hostname()
  const serviceName = `Handoff-${deviceName.replace(/\s+/g, '-')}`

  mdns.on('query', (query) => {
    const hasHandoffQuery = query.questions.some(
      (q) => q.name === '_handoff._tcp.local'
    )
    if (!hasHandoffQuery) return

    mdns!.respond({
      answers: [{
        name: '_handoff._tcp.local',
        type: 'PTR',
        class: 'IN',
        ttl: 120,
        data: `${serviceName}._handoff._tcp.local`
      }, {
        name: `${serviceName}._handoff._tcp.local`,
        type: 'SRV',
        class: 'IN',
        ttl: 120,
        data: {
          port: config.server.port,
          target: os.hostname() + '.local'
        }
      }, {
        name: `${serviceName}._handoff._tcp.local`,
        type: 'TXT',
        class: 'IN',
        ttl: 120,
        data: Buffer.from(JSON.stringify({
          deviceId: getDeviceId(),
          deviceName: deviceName,
          platform: 'windows',
          version: getVersion()
        }))
      }]
    })
  })

  // Keep SRV, TXT and address records independently: Bonjour may deliver them
  // in separate responses, and A/AAAA records belong to the SRV target.
  mdns.on('response', (response) => {
    const records = [...response.answers, ...(response.additionals || [])]
    const changedNames = new Set<string>()
    for (const record of records) {
      const name = normalized(record.name)
      if (record.type === 'PTR' && name === '_handoff._tcp.local' &&
          typeof record.data === 'string') {
        const instance = normalized(record.data)
        if (!services.has(instance) || !metadata.has(instance)) {
          mdns?.query({ questions: [
            { name: record.data, type: 'SRV' },
            { name: record.data, type: 'TXT' }
          ] })
        }
      } else if (record.type === 'SRV' && name.endsWith('._handoff._tcp.local')) {
        const data = record.data as { target?: string; port?: number }
        if (data?.target && Number.isInteger(data.port) && data.port! >= 0 && data.port! <= 65535) {
          services.set(name, { target: data.target, port: data.port! })
          changedNames.add(name)
          if (!addresses.has(normalized(data.target))) {
            mdns?.query({ questions: [
              { name: data.target, type: 'A' },
              { name: data.target, type: 'AAAA' }
            ] })
          }
        }
      } else if (record.type === 'TXT' && name.endsWith('._handoff._tcp.local')) {
        const txt = parseTXT(record.data)
        if (Object.keys(txt).length) {
          metadata.set(name, txt)
          changedNames.add(name)
        }
      } else if ((record.type === 'A' || record.type === 'AAAA') && usableAddress(record.data)) {
        const previous = addresses.get(name)
        if (!previous || (isIP(record.data) === 4 && isIP(previous) === 6)) {
          addresses.set(name, record.data)
        }
        changedNames.add(name)
      }
    }
    publishResolvedServices(changedNames)
  })

  // Periodic announcement every 30 seconds (triggers responses + proactive query)
  setInterval(() => {
    mdns!.query({ questions: [{ name: '_handoff._tcp.local', type: 'PTR' }] })
    // Also send a proactive announcement so iOS can discover without querying first
    mdns!.respond({
      answers: [{
        name: '_handoff._tcp.local',
        type: 'PTR',
        class: 'IN',
        ttl: 120,
        data: `${serviceName}._handoff._tcp.local`
      }, {
        name: `${serviceName}._handoff._tcp.local`,
        type: 'SRV',
        class: 'IN',
        ttl: 120,
        data: {
          port: config.server.port,
          target: os.hostname() + '.local'
        }
      }, {
        name: `${serviceName}._handoff._tcp.local`,
        type: 'TXT',
        class: 'IN',
        ttl: 120,
        data: Buffer.from(JSON.stringify({
          deviceId: getDeviceId(),
          deviceName: deviceName,
          platform: 'windows',
          version: getVersion()
        }))
      }]
    })
  }, 30000)

  console.log(`[HandoffService] mDNS broadcasting as "${serviceName}"`)
}

export function stopMDNSBroadcast(): void {
  if (mdns) {
    mdns.destroy()
    mdns = null
  }
  services.clear()
  metadata.clear()
  addresses.clear()
}

export function queryMDNS(): void {
  if (!mdns) return
  mdns.query({ questions: [{ name: '_handoff._tcp.local', type: 'PTR' }] })
}
