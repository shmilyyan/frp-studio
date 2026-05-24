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
