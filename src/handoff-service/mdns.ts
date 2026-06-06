import multicastDns from 'multicast-dns'
import { getConfig } from './config'
import os from 'os'

let mdns: multicastDns.MulticastDNS | null = null

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
          deviceName: deviceName,
          platform: 'windows',
          version: getVersion()
        }))
      }]
    })
  })

  // 监听 mDNS 响应 — 解析 iOS 设备的 Bonjour 宣告
  mdns.on('response', (response) => {
    for (const answer of response.answers) {
      if (answer.type === 'TXT' && answer.name.endsWith('._handoff._tcp.local')) {
        try {
          let txtData: Record<string, string> = {}
          const txtBuf = Buffer.isBuffer(answer.data) ? answer.data : Buffer.from(String(answer.data || ''))
          // Parse key=value TXT record format (DNS-SD style)
          const txtStr = txtBuf.toString('utf-8')
          // Try JSON first, then key=value pairs
          try {
            txtData = JSON.parse(txtStr)
          } catch {
            // key=value format: split by non-printable separators or commas
            const pairs = txtStr.split(/[\x00-\x1f,]+/).filter(Boolean)
            for (const pair of pairs) {
              const eq = pair.indexOf('=')
              if (eq > 0) {
                txtData[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
              }
            }
          }
          const deviceId = txtData['deviceId']
          const platform = txtData['platform'] || ''
          if (deviceId && platform === 'ios') {
            // Try to get IP from additional records
            let ip = '0.0.0.0'
            for (const add of (response.additionals || [])) {
              if (add.type === 'A' && add.name === answer.name) {
                ip = String(add.data || '0.0.0.0')
                break
              }
            }
            try {
              const { onBonjourDeviceFound } = require('./scanner')
              onBonjourDeviceFound(deviceId, ip)
            } catch { /* scanner may not be started yet */ }
          }
        } catch { /* 解析失败跳过 */ }
      }
    }
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
}

export function queryMDNS(): void {
  if (!mdns) return
  mdns.query({ questions: [{ name: '_handoff._tcp.local', type: 'PTR' }] })
}
