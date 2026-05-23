import { getConfig } from './config'
import { execSync } from 'child_process'
import { createHash } from 'crypto'

let cachedContent = ''
let cachedHash = ''
let pollingTimer: ReturnType<typeof setInterval> | null = null

function execPowerShell(script: string): Promise<string> {
  try {
    return Promise.resolve(execSync(`powershell -Command "${script}"`, { encoding: 'utf-8' }).trim())
  } catch {
    return Promise.resolve('')
  }
}

async function getClipboardText(): Promise<string> {
  return execPowerShell('Get-Clipboard -Format Text')
}

function hashContent(content: string): string {
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
  const escaped = text.replace(/'/g, "''")
  execSync(`powershell -Command "Set-Clipboard -Value '${escaped}'"`, { encoding: 'utf-8' })
  cachedContent = text
  cachedHash = hashContent(text)
}

export function getLatestClipboard(): { hash: string; payload: string } {
  return { hash: cachedHash, payload: cachedContent }
}
