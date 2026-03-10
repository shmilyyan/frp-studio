// One-off script: renders icons/option-c.svg → resources/icon.png (512x512) via Electron offscreen
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svgPath = path.join(__dirname, '../icons/option-c.svg')
  const svgContent = fs.readFileSync(svgPath, 'utf-8')
  const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;background:transparent}</style></head>
<body><div style="width:512px;height:512px">${svgContent}</div></body></html>`

  const win = new BrowserWindow({
    width: 512, height: 512, show: false,
    webPreferences: { offscreen: true }
  })

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  win.webContents.on('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 300))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
    const png = image.toPNG()
    const out = path.join(__dirname, '../resources/icon.png')
    fs.writeFileSync(out, png)
    console.log('icon.png written:', out, png.length, 'bytes')
    app.quit()
  })
})
