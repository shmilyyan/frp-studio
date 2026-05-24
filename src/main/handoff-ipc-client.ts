import http from 'http'

let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let config = { port: 19528 }

export function loadHandoffConfig(cfg: { port?: number }): void {
  if (cfg.port) config.port = cfg.port
}

async function httpGet(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${config.port}${path}`, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    }).on('error', reject)
  })
}

async function httpPost(path: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : ''
    const req = http.request({
      hostname: '127.0.0.1',
      port: config.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getHealth(): Promise<{ status: string; uptime: number; connections: number; version: string }> {
  return httpGet('/health') as Promise<{ status: string; uptime: number; connections: number; version: string }>
}

export async function getPairedDevices(): Promise<unknown[]> {
  return httpGet('/devices') as Promise<unknown[]>
}

export async function notifyConfigChanged(): Promise<void> {
  await httpPost('/config')
}

export async function restartService(): Promise<void> {
  await httpPost('/restart')
}

export async function generatePairingQR(deviceName: string, devicePublicKey: string): Promise<{ success: boolean; qrData?: string; error?: string }> {
  return httpPost('/pair/generate', { deviceName, devicePublicKey }) as Promise<{ success: boolean; qrData?: string; error?: string }>
}

export async function confirmPairing(token: string, signedToken: string): Promise<{ success: boolean; error?: string }> {
  return httpPost('/pair/confirm', { token, signedToken }) as Promise<{ success: boolean; error?: string }>
}

export async function revokeDevice(deviceId: string): Promise<{ success: boolean }> {
  return httpPost(`/pair/revoke/${deviceId}`) as Promise<{ success: boolean }>
}

// ─── SSE Event Stream ───────────────────────────────────────────────────────

export function connectSSE(onEvent: (event: string, data: unknown) => void): () => void {
  let currentReq: http.ClientRequest | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0
  let stopped = false
  let reconnecting = false

  function createConnection(): void {
    if (stopped) return

    currentReq = http.get(`http://127.0.0.1:${config.port}/events`, (res) => {
      retryCount = 0
      reconnecting = false

      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              onEvent(currentEvent, data)
            } catch { /* ignore */ }
          }
        }
      })

      res.on('error', () => { scheduleRetry() })
      res.on('end', () => { scheduleRetry() })
    })

    currentReq.on('error', () => { scheduleRetry() })
  }

  function scheduleRetry(): void {
    if (stopped || reconnecting) return
    reconnecting = true
    retryCount++
    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 15000)
    retryTimer = setTimeout(() => {
      retryTimer = null
      createConnection()
    }, delay)
  }

  createConnection()

  return () => {
    stopped = true
    if (currentReq) { currentReq.destroy(); currentReq = null }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  }
}

// ─── Health Check Loop ──────────────────────────────────────────────────────

export function startHealthCheck(onStatusChange: (status: 'running' | 'stopped') => void): void {
  let lastStatus: 'running' | 'stopped' = 'stopped'

  healthCheckTimer = setInterval(async () => {
    try {
      await getHealth()
      if (lastStatus !== 'running') {
        lastStatus = 'running'
        onStatusChange('running')
      }
    } catch {
      if (lastStatus !== 'stopped') {
        lastStatus = 'stopped'
        onStatusChange('stopped')
      }
    }
  }, 3000)
}

export function stopHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
}
