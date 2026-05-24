import { app } from 'electron'
import { spawn, ChildProcess, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

let serviceProcess: ChildProcess | null = null
let restartCount = 0
const MAX_RESTART = 3
const RESTART_DELAY = 3000

function getServiceJsPath(): string {
  const devPath = path.join(app.getAppPath(), 'out', 'handoff-service', 'index.js')
  const packagedPath = path.join(process.resourcesPath, 'out', 'handoff-service', 'index.js')

  if (app.isPackaged) {
    if (fs.existsSync(packagedPath)) return packagedPath
    return devPath
  }
  return devPath
}

function getUserDataPath(): string {
  return app.getPath('userData')
}

function getPidFilePath(): string {
  return path.join(getUserDataPath(), 'handoff-service.pid')
}

function isServiceRunning(): boolean {
  try {
    const pidFile = getPidFilePath()
    if (!fs.existsSync(pidFile)) return false
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
    try {
      process.kill(pid, 0)
      return true
    } catch {
      try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
      return false
    }
  } catch {
    return false
  }
}

function killPortProcess(port: number): void {
  if (process.platform !== 'win32') return
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', windowsHide: true })
    const lines = output.trim().split('\n')
    for (const line of lines) {
      const match = line.match(/:(\d+)\s+.*LISTENING\s+(\d+)/)
      if (match && parseInt(match[1]) === port) {
        const pid = match[2]
        console.log(`[FRP Studio] Killing process on port ${port} (PID ${pid})`)
        execSync(`taskkill //PID ${pid} //F //T`, { windowsHide: true, stdio: 'ignore' })
      }
    }
  } catch { /* port not in use or command failed */ }
}

export function startHandoffService(): boolean {
  // Kill any process holding port 19528, then clean up PID file
  killPortProcess(19528)
  stopHandoffService()

  const jsPath = getServiceJsPath()
  const userDataPath = getUserDataPath()

  if (!fs.existsSync(jsPath)) {
    console.error(`[FRP Studio] HandoffService binary not found: ${jsPath}`)
    return false
  }

  console.log(`[FRP Studio] Starting HandoffService: ${jsPath}`)

  serviceProcess = spawn('node', [jsPath, userDataPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, LC_ALL: 'en_US.UTF-8' }
  })

  serviceProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(`[HandoffService] ${line}`)
  })

  serviceProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.error(`[HandoffService ERR] ${line}`)
  })

  serviceProcess.on('exit', (code, signal) => {
    console.log(`[FRP Studio] HandoffService exited (code=${code}, signal=${signal})`)
    serviceProcess = null
    restartCount++

    if (restartCount < MAX_RESTART) {
      console.log(`[FRP Studio] Restarting HandoffService in ${RESTART_DELAY}ms (attempt ${restartCount}/${MAX_RESTART})`)
      setTimeout(() => startHandoffService(), RESTART_DELAY)
    } else {
      console.error(`[FRP Studio] HandoffService failed after ${MAX_RESTART} restarts`)
    }
  })

  setTimeout(() => { restartCount = 0 }, 30000)
  return true
}

export function stopHandoffService(): void {
  const pidFile = getPidFilePath()
  try {
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      if (process.platform === 'win32') {
        try { execSync(`taskkill //PID ${pid} //F //T`, { windowsHide: true, stdio: 'ignore' }) } catch { /* already dead */ }
      } else {
        try { process.kill(pid, 'SIGTERM') } catch { /* already dead */ }
      }
      try { fs.unlinkSync(pidFile) } catch { /* ignore */ }
    }
  } catch (e) {
    console.error('[FRP Studio] Failed to stop HandoffService:', e)
  }

  if (serviceProcess) {
    try { serviceProcess.kill() } catch { /* ignore */ }
    serviceProcess = null
  }
}

export function restartHandoffService(): void {
  stopHandoffService()
  setTimeout(() => startHandoffService(), 1000)
}

export function getServiceStatus(): 'running' | 'stopped' | 'error' {
  return isServiceRunning() ? 'running' : 'stopped'
}

export function getServiceUptime(): number {
  const pidFile = getPidFilePath()
  if (!fs.existsSync(pidFile)) return 0
  try {
    const { execSync } = require('child_process')
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
    const output = execSync(`powershell -WindowStyle Hidden -Command "(Get-Process -Id ${pid}).StartTime"`, { encoding: 'utf-8', windowsHide: true }).trim()
    const startTime = new Date(output).getTime()
    return Date.now() - startTime
  } catch {
    return 0
  }
}
