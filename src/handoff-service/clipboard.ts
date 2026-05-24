import { getConfig } from './config'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import http from 'http'

let cachedContent = ''
let cachedHash = ''
let pollingTimer: ReturnType<typeof setInterval> | null = null

function execPowerShell(script: string): Promise<string> {
  try {
    return Promise.resolve(execSync(`powershell -WindowStyle Hidden -Command "${script}"`, { encoding: 'utf-8', windowsHide: true }).trim())
  } catch {
    return Promise.resolve('')
  }
}

async function getClipboardText(): Promise<string> {
  return execPowerShell('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Format Text')
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function startClipboardWatcher(onChange: (content: string) => void): void {
  const config = getConfig()
  if (!config.features.clipboardSync) return

  pollingTimer = setInterval(async () => {
    try {
      const content = await getClipboardText()
      if (!content) return

      if (content.length > config.features.clipboardMaxSize) return

      const hash = hashContent(content)
      if (hash !== cachedHash) {
        cachedContent = content
        cachedHash = hash
        onChange(content)
        notifyTransferRecord('clipboard', 'send', content.slice(0, 100), content.length)
      }
    } catch { /* ignore clipboard errors */ }
  }, 1000)

  console.log('[HandoffService] Clipboard watcher started (polling every 1s)')
}

export function stopClipboardWatcher(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

export function writeClipboard(text: string): void {
  const cmd = `Set-Clipboard -Value ${JSON.stringify(text)}`
  const encoded = Buffer.from(cmd, 'utf-16le').toString('base64')
  execSync(`powershell -WindowStyle Hidden -EncodedCommand ${encoded}`, { encoding: 'utf-8', windowsHide: true })
  cachedContent = text
  cachedHash = hashContent(text)
  notifyTransferRecord('clipboard', 'receive', text.slice(0, 100), text.length)
}

export function getLatestClipboard(): { hash: string; payload: string } {
  return { hash: cachedHash, payload: cachedContent }
}

function notifyTransferRecord(type: string, direction: string, detail: string, size: number): void {
  const body = JSON.stringify({ type, direction, detail, size, status: 'success' })
  const req = http.request({
    hostname: '127.0.0.1', port: 19529, path: '/internal/transfer-record',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, () => {})
  req.on('error', () => { /* internal server may not be running */ })
  req.write(body)
  req.end()
}
