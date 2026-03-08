import https from 'https'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { BrowserWindow } from 'electron'

const GITHUB_API = 'https://api.github.com/repos/fatedier/frp/releases'

export interface FrpVersion {
  version: string
  publishedAt: string
  downloadUrl: string
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'frp-studio',
        Accept: 'application/vnd.github.v3+json'
      }
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
  const userData = app.getPath('userData')
  const frpDir = path.join(userData, 'frp')
  fs.mkdirSync(frpDir, { recursive: true })

  const isZip = version.downloadUrl.endsWith('.zip')
  const archiveName = isZip ? 'frp.zip' : 'frp.tar.gz'
  const archivePath = path.join(frpDir, archiveName)

  await new Promise<void>((resolve, reject) => {
    const download = (url: string) => {
      https.get(url, { headers: { 'User-Agent': 'frp-studio' } }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          download(res.headers.location!)
          return
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const file = fs.createWriteStream(archivePath)
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length
          const percent = total ? Math.round((downloaded / total) * 100) : 0
          win.webContents.send('system:download-progress', { percent, downloaded, total })
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        file.on('error', reject)
      }).on('error', reject)
    }
    download(version.downloadUrl)
  })

  // Extract frpc binary
  const { execFile } = await import('child_process')
  const util = await import('util')
  const execFileAsync = util.promisify(execFile)

  if (isZip) {
    // Use PowerShell on Windows to extract
    if (process.platform === 'win32') {
      await execFileAsync('powershell', [
        '-Command',
        `Expand-Archive -Path "${archivePath}" -DestinationPath "${frpDir}" -Force`
      ])
    }
  } else {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', frpDir, '--strip-components=1'])
  }

  // Clean up archive
  fs.unlinkSync(archivePath)

  win.webContents.send('system:download-complete', { version: version.version })
}

export function getInstalledFrpVersion(): string | null {
  const userData = app.getPath('userData')
  const versionFile = path.join(userData, 'frp', 'version.txt')
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf-8').trim()
  }
  // Try to find frpc and get its version
  const frpDir = path.join(userData, 'frp')
  const binName = process.platform === 'win32' ? 'frpc.exe' : 'frpc'
  const frpcPath = path.join(frpDir, binName)
  return fs.existsSync(frpcPath) ? 'unknown' : null
}
