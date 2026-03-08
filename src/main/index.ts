import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase } from './db'
import { initConfig } from './config'
import { registerNodeHandlers } from './ipc/node'
import { registerTunnelHandlers } from './ipc/tunnel'
import { registerSystemHandlers } from './ipc/system'
import { handleWindowClose, refreshTrayMenu } from './tray'
import { frpcManager } from './frpc'

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

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.frpstudio')

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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
