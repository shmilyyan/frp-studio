import https from 'https'
import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getConfig } from './config'
import { getFrpDir, getFrpcPath, getBackupDir, FRP_BIN_NAME } from './paths'

const GITHUB_API = 'https://api.github.com/repos/fatedier/frp/releases'

export interface FrpVersion {
  version: string
  publishedAt: string
  downloadUrl: string
}

export interface BackupInfo {
  filename: string
  version: string
  date: string   // ISO string
  size: number   // bytes
}

// ── Active download tracking ──────────────────────────────────────────────────

interface ActiveDownload {
  version: FrpVersion
  win: BrowserWindow
  abort: () => void
}

let _activeDownload: ActiveDownload | null = null

/** Abort the current download and restart it with the current proxy config. */
export function retryDownloadWithNewProxy(): void {
  if (!_activeDownload) return
  const { version, win, abort } = _activeDownload
  abort()
  setTimeout(() => downloadFrp(version, win), 300)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAgent(): HttpsProxyAgent<string> | undefined {
  const cfg = getConfig()
  const proxy = cfg.proxyEnabled ? cfg.proxyUrl?.trim() : ''
  return proxy ? new HttpsProxyAgent(proxy) : undefined
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = getAgent()
    const options: https.RequestOptions = {
      headers: {
        'User-Agent': 'frp-studio',
        Accept: 'application/vnd.github.v3+json'
      },
      ...(agent ? { agent } : {})
    }
    https
      .get(url, options, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          httpsGet(res.headers.location!).then(resolve).catch(reject)
          return
        }
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve(data))
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

// ── Backup helpers ────────────────────────────────────────────────────────────

/** Back up the current frpc binary before overwriting it. */
export function backupCurrentFrpc(currentVersion: string): void {
  const frpcPath = getFrpcPath()
  if (!fs.existsSync(frpcPath)) return

  const backDir = getBackupDir()
  fs.mkdirSync(backDir, { recursive: true })

  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const datePart =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const timePart =
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

  const ver = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`
  const ext = process.platform === 'win32' ? '.exe' : ''
  const backupName = `frpc_${ver}_${datePart}_${timePart}${ext}`

  try {
    fs.copyFileSync(frpcPath, path.join(backDir, backupName))
  } catch { /* ignore — backup failure should not block the update */ }
}

/** List all backups, newest first. */
export function listBackups(): BackupInfo[] {
  const backDir = getBackupDir()
  if (!fs.existsSync(backDir)) return []

  const ext = process.platform === 'win32' ? '.exe' : ''
  const results: BackupInfo[] = []

  for (const filename of fs.readdirSync(backDir)) {
    if (!filename.startsWith('frpc_')) continue
    if (ext && !filename.endsWith(ext)) continue

    try {
      const stat = fs.statSync(path.join(backDir, filename))
      const m = filename.match(/^frpc_(v[\w.]+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/)
      const version = m ? String(m[1]) : 'unknown'
      const date = m
        ? `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}`
        : new Date(stat.mtimeMs).toISOString()
      results.push({
        filename: String(filename),
        version: String(version),
        date: String(date),
        size: Number(stat.size)
      })
    } catch { /* skip unreadable entries */ }
  }

  return results.sort((a, b) => b.date.localeCompare(a.date))
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getFrpVersions(): Promise<FrpVersion[]> {
  const data = await httpsGet(`${GITHUB_API}?per_page=10`)
  const releases = JSON.parse(data) as Array<{
    tag_name: string
    published_at: string
    assets: Array<{ name: string; browser_download_url: string }>
  }>

  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : 'amd64'

  return releases
    .map((r) => {
      const asset = r.assets.find(
        (a) =>
          a.name.includes(platform) &&
          a.name.includes(arch) &&
          (a.name.endsWith('.tar.gz') || a.name.endsWith('.zip'))
      )
      if (!asset) return null
      return {
        version: r.tag_name,
        publishedAt: r.published_at,
        downloadUrl: asset.browser_download_url
      }
    })
    .filter(Boolean) as FrpVersion[]
}

export async function downloadFrp(
  version: FrpVersion,
  win: BrowserWindow
): Promise<void> {
  const frpDir = getFrpDir()
  fs.mkdirSync(frpDir, { recursive: true })

  const isZip = version.downloadUrl.endsWith('.zip')
  const archiveName = isZip ? 'frp.zip' : 'frp.tar.gz'
  const archivePath = path.join(frpDir, archiveName)

  // Returns true if the download was aborted
  const aborted = await new Promise<boolean>((resolve, reject) => {
    let wasAborted = false
    let currentReq: ReturnType<typeof https.get> | null = null

    _activeDownload = {
      version,
      win,
      abort() {
        wasAborted = true
        currentReq?.destroy()
        try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath) } catch { /* ignore */ }
        resolve(true)
      }
    }

    const agent = getAgent()
    const reqOptions: https.RequestOptions = {
      headers: { 'User-Agent': 'frp-studio' },
      ...(agent ? { agent } : {})
    }

    const download = (url: string) => {
      const req = https.get(url, reqOptions, (res) => {
        if (wasAborted) return
        if (res.statusCode === 302 || res.statusCode === 301) {
          download(res.headers.location!)
          return
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = fs.createWriteStream(archivePath)

        res.on('data', (chunk: Buffer) => {
          if (wasAborted) return
          downloaded += chunk.length
          const percent = total ? Math.round((downloaded / total) * 100) : 0
          win.webContents.send('system:download-progress', { percent, downloaded, total })
        })

        res.pipe(file)

        file.on('finish', () => {
          if (wasAborted) { resolve(true); return }
          file.close(() => resolve(false))
        })
        file.on('error', (err) => {
          if (wasAborted) { resolve(true) } else { reject(err) }
        })
      })

      currentReq = req
      req.on('error', (err) => {
        if (wasAborted) { resolve(true) } else { reject(err) }
      })
    }

    download(version.downloadUrl)
  })

  _activeDownload = null

  if (aborted) return

  // Backup current frpc before overwriting
  const currentVersion = getInstalledFrpVersion()
  if (currentVersion && currentVersion !== 'unknown') {
    backupCurrentFrpc(currentVersion)
  }

  // Extract frpc binary
  const { execFile } = await import('child_process')
  const util = await import('util')
  const execFileAsync = util.promisify(execFile)

  if (isZip) {
    if (process.platform === 'win32') {
      await execFileAsync('powershell', [
        '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${frpDir}" -Force`
      ])
      // Zip contains a versioned subdirectory — move frpc.exe up
      const destBin = getFrpcPath()
      if (!fs.existsSync(destBin)) {
        const subDirs = fs.readdirSync(frpDir).filter((e) =>
          fs.statSync(path.join(frpDir, e)).isDirectory() && e !== 'back'
        )
        for (const sub of subDirs) {
          const candidate = path.join(frpDir, sub, FRP_BIN_NAME)
          if (fs.existsSync(candidate)) {
            fs.renameSync(candidate, destBin)
            fs.rmSync(path.join(frpDir, sub), { recursive: true, force: true })
            break
          }
        }
      }
    }
  } else {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', frpDir, '--strip-components=1'])
  }

  fs.unlinkSync(archivePath)
  fs.writeFileSync(path.join(frpDir, 'version.txt'), version.version, 'utf-8')

  win.webContents.send('system:download-complete', { version: version.version })
}

export function getInstalledFrpVersion(): string | null {
  const frpDir = getFrpDir()
  const versionFile = path.join(frpDir, 'version.txt')
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf-8').trim()
  }
  return fs.existsSync(getFrpcPath()) ? 'unknown' : null
}

export function checkFrpExists(): boolean {
  return fs.existsSync(getFrpcPath())
}

export async function getLatestVersion(): Promise<FrpVersion | null> {
  try {
    const versions = await getFrpVersions()
    return versions[0] ?? null
  } catch {
    return null
  }
}

export async function autoDownloadLatest(win: BrowserWindow): Promise<void> {
  const latest = await getLatestVersion()
  if (!latest) return
  win.webContents.send('system:auto-download-start', { version: latest.version })
  await downloadFrp(latest, win)
}

export async function getFrpcVersionFromBinary(binPath: string): Promise<string | null> {
  const { execFile } = await import('child_process')
  const util = await import('util')
  const execFileAsync = util.promisify(execFile)
  try {
    const { stdout } = await execFileAsync(binPath, ['--version'])
    const match = stdout.match(/frpc\s+version\s+([\w.\-]+)/i)
    if (match) return match[1].startsWith('v') ? match[1] : `v${match[1]}`
    return null
  } catch {
    return null
  }
}

export async function restoreBackup(
  filename: string,
  win: BrowserWindow
): Promise<{ success: boolean; version: string | null; error?: string }> {
  const backupPath = path.join(getBackupDir(), filename)
  if (!fs.existsSync(backupPath)) {
    return { success: false, version: null, error: '备份文件不存在' }
  }

  const frpcPath = getFrpcPath()
  const frpDir = getFrpDir()
  try {
    // Backup current version before restoring, but skip if a backup of this version already exists
    const current = getInstalledFrpVersion()
    if (current && current !== 'unknown' && !listBackups().some((b) => b.version === current)) {
      backupCurrentFrpc(current)
    }

    fs.copyFileSync(backupPath, frpcPath)
    if (process.platform !== 'win32') fs.chmodSync(frpcPath, 0o755)

    let version = await getFrpcVersionFromBinary(frpcPath)
    // Fall back to version encoded in the backup filename
    if (!version) {
      const m = filename.match(/^frpc_(v[\w.]+)_\d{8}_\d{6}/)
      version = m ? m[1] : null
    }
    if (version) {
      fs.writeFileSync(path.join(frpDir, 'version.txt'), version, 'utf-8')
    }

    if (!win.isDestroyed()) {
      win.webContents.send('system:download-complete', { version: version ?? 'unknown' })
    }
    return { success: true, version }
  } catch (e) {
    return { success: false, version: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function importFrpcBinary(
  sourcePath: string,
  win: BrowserWindow
): Promise<{ success: boolean; version: string | null; error?: string }> {
  const frpcPath = getFrpcPath()
  const frpDir = getFrpDir()

  try {
    fs.mkdirSync(frpDir, { recursive: true })

    // Backup current before importing
    const current = getInstalledFrpVersion()
    if (current && current !== 'unknown') backupCurrentFrpc(current)

    fs.copyFileSync(sourcePath, frpcPath)
    if (process.platform !== 'win32') fs.chmodSync(frpcPath, 0o755)

    const version = await getFrpcVersionFromBinary(frpcPath)
    if (version) {
      fs.writeFileSync(path.join(frpDir, 'version.txt'), version, 'utf-8')
    }

    if (!win.isDestroyed()) {
      win.webContents.send('system:download-complete', { version: version ?? 'unknown' })
    }
    return { success: true, version }
  } catch (e) {
    return { success: false, version: null, error: e instanceof Error ? e.message : String(e) }
  }
}
