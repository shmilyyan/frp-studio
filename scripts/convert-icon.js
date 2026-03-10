/**
 * Renders icons/option-c.svg (circular, transparent bg) to:
 *   resources/icon.png  (512×512, for tray / in-app use)
 *   resources/icon.ico  (256/64/48/32/16 multi-size, for Windows)
 *   src/renderer/src/assets/icon.png
 *   src/renderer/public/icon.png
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

// Must be called before app is ready
app.disableHardwareAcceleration()

function svgHtml(svgContent, size) {
  const svg = svgContent.replace('<svg ', `<svg width="${size}" height="${size}" `)
  return `<!DOCTYPE html><html><head>
<style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}</style>
</head><body>${svg}</body></html>`
}

function buildIco(entries) {
  const headerSize = 6
  const dirEntrySize = 16
  let offset = headerSize + entries.length * dirEntrySize
  const dirs = [], images = []
  for (const { size, data } of entries) {
    const e = Buffer.alloc(dirEntrySize)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    dirs.push(e)
    images.push(data)
    offset += data.length
  }
  const hdr = Buffer.alloc(headerSize)
  hdr.writeUInt16LE(0, 0)
  hdr.writeUInt16LE(1, 2)
  hdr.writeUInt16LE(entries.length, 4)
  return Buffer.concat([hdr, ...dirs, ...images])
}

async function captureSize(win, svgContent, size) {
  const html = svgHtml(svgContent, size)
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
  win.setSize(size, size)
  await new Promise(resolve => {
    win.webContents.once('did-finish-load', resolve)
    win.loadURL(url)
  })
  await new Promise(r => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  return img.toPNG()
}

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..')
  const svgRaw = fs.readFileSync(path.join(root, 'icons/option-c.svg'), 'utf-8')

  // Transparent window for circular icon (alpha channel preserved)
  const win = new BrowserWindow({
    width: 512, height: 512, show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })

  // 512×512 PNG
  process.stdout.write('Rendering 512×512 PNG... ')
  const png512 = await captureSize(win, svgRaw, 512)
  for (const dest of [
    'resources/icon.png',
    'src/renderer/icon.png',
    'src/renderer/public/icon.png',
    'src/renderer/src/assets/icon.png'
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true })
    fs.writeFileSync(path.join(root, dest), png512)
  }
  console.log('ok')

  // Multi-size ICO
  const icoSizes = [256, 64, 48, 32, 16]
  const entries = []
  for (const size of icoSizes) {
    process.stdout.write(`Rendering ${size}×${size}... `)
    const png = await captureSize(win, svgRaw, size)
    entries.push({ size, data: png })
    console.log('ok')
  }
  win.destroy()

  const ico = buildIco(entries)
  fs.writeFileSync(path.join(root, 'resources/icon.ico'), ico)
  console.log(`icon.ico written — ${(ico.length / 1024).toFixed(1)} KB, ${entries.length} sizes`)

  app.quit()
})
