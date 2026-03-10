import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase } from './db'
import { initConfig, getConfig, setConfig } from './config'
import { registerNodeHandlers } from './ipc/node'
import { registerTunnelHandlers } from './ipc/tunnel'
import { registerSystemHandlers } from './ipc/system'
import { handleWindowClose, refreshTrayMenu } from './tray'
import { frpcManager } from './frpc'
import { checkFrpExists, autoDownloadLatest, getLatestVersion, getInstalledFrpVersion } from './downloader'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 拦截关闭事件，处理托盘逻辑
  mainWindow.on('close', (e) => {
    handleWindowClose(e, mainWindow)
  })

  // 每次 frpc 状态变化时刷新托盘菜单
  mainWindow.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'frpc:status-changed') {
      refreshTrayMenu(mainWindow)
    }
  })

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow.close())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

let updateCheckTimer: ReturnType<typeof setInterval> | null = null

async function performUpdateCheck(win: BrowserWindow): Promise<void> {
  try {
    const currentVersion = getInstalledFrpVersion()
    const latest = await getLatestVersion()
    if (!latest) return

    setConfig({ lastUpdateCheck: Date.now(), latestKnownVersion: latest.version })

    const hasUpdate =
      !!currentVersion &&
      currentVersion !== 'unknown' &&
      latest.version !== currentVersion

    if (hasUpdate && !win.isDestroyed()) {
      win.webContents.send('system:update-available', {
        latestVersion: latest.version,
        currentVersion
      })
    }
  } catch { /* network errors are silently ignored */ }
}

async function startFrpcAutoManagement(win: BrowserWindow): Promise<void> {
  // Auto-download frpc if missing
  if (!checkFrpExists()) {
    try {
      await autoDownloadLatest(win)
    } catch { /* ignore, user can manually install */ }
  }

  const cfg = getConfig()
  if (!cfg.autoCheckUpdate) return

  // Check on startup if interval has elapsed
  const now = Date.now()
  const intervalMs = cfg.updateCheckInterval * 60 * 60 * 1000
  if (!cfg.lastUpdateCheck || now - cfg.lastUpdateCheck >= intervalMs) {
    performUpdateCheck(win)
  }

  // Schedule recurring checks
  if (updateCheckTimer) clearInterval(updateCheckTimer)
  updateCheckTimer = setInterval(() => {
    const current = getConfig()
    if (current.autoCheckUpdate) performUpdateCheck(win)
  }, intervalMs)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.frper')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initConfig()
  await initDatabase()

  registerNodeHandlers()
  registerTunnelHandlers()
  registerSystemHandlers()

  const win = createWindow()

  // frpc 状态变化时刷新托盘菜单
  frpcManager.onStatusChange(() => refreshTrayMenu(win))

  // After renderer is ready: auto-detect frpc + schedule update checks
  win.webContents.on('did-finish-load', () => {
    startFrpcAutoManagement(win)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
