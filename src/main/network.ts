import net from 'net'
import http from 'http'

export interface ConnectTestResult {
  tcpReachable: boolean
  tokenValid: boolean | null
  frpRunning: boolean
  latency?: number
  error?: string
}

function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    socket.connect(port, host, () => {
      const latency = Date.now() - start
      socket.destroy()
      resolve(latency)
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Connection timed out'))
    })
    socket.on('error', (err) => {
      socket.destroy()
      reject(err)
    })
  })
}

function httpTokenProbe(host: string, port: number, token?: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Try to connect to frps admin API - if no admin API, just check if server is responding
    // frps admin API default port is 7400, but we check the server port
    // A simple TCP handshake at the server port means frp server is running
    const options = {
      hostname: host,
      port: port + 400, // Admin panel default
      path: '/api/serverinfo',
      method: 'GET',
      timeout: 3000,
      headers: token
        ? {
            Authorization: `Basic ${Buffer.from('admin:' + token).toString('base64')}`
          }
        : {}
    }
    const req = http.request(options, (res) => {
      resolve(res.statusCode !== 401)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

export async function testNodeConnection(
  host: string,
  port: number,
  token?: string
): Promise<ConnectTestResult> {
  const result: ConnectTestResult = {
    tcpReachable: false,
    tokenValid: null,
    frpRunning: false
  }

  // Step 1: TCP probe
  try {
    const latency = await tcpProbe(host, port)
    result.tcpReachable = true
    result.latency = latency
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err)
    return result
  }

  // Step 2: frp running check (TCP means frpc server is listening)
  result.frpRunning = true

  // Step 3: Token validation via admin API (optional)
  if (token) {
    result.tokenValid = await httpTokenProbe(host, port, token)
  } else {
    result.tokenValid = null
  }

  return result
}
