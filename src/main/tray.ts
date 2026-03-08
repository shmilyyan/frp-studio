import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { frpcManager } from './frpc'
import { getConfig, setConfig } from './config'

let tray: Tray | null = null

function getTrayIcon(): Electron.NativeImage {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const candidates = [
    is.dev
      ? path.join(__dirname, '../../resources', iconFile)
      : path.join(process.resourcesPath, 'resources', iconFile),
    is.dev
      ? path.join(__dirname, '../../resources/icon.png')
      : path.join(process.resourcesPath, 'resources/icon.png')
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
    } catch {
      // try next
    }
  }
  return nativeImage.createEmpty()
}

export function createTray(win: BrowserWindow): void {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('FRP Studio')
  refreshTrayMenu(win)

  tray.on('double-click', () => {
    win.show()
    win.focus()
  })
}

export function refreshTrayMenu(win: BrowserWindow): void {
  if (!tray) return
  const status = frpcManager.getStatus()
  const statusLabel = status.running ? `● 运行中  PID ${status.pid}` : '○ 已停止'

  const menu = Menu.buildFromTemplate([
    { label: 'FRP Studio', enabled: false },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: '显示主界面',
      click: () => {
        win.show()
        win.focus()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        setConfig({ trayEnabled: false })
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

export function hasTray(): boolean {
  return tray !== null
}

/** 拦截窗口 close 事件，首次弹 dialog，后续依配置决定 hide/quit */
export async function handleWindowClose(
  e: Electron.Event,
  win: BrowserWindow
): Promise<void> {
  const cfg = getConfig()

  if (!cfg.trayPromptShown) {
    e.preventDefault()
    const { dialog } = await import('electron')
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'FRP Studio',
      message: '选择关闭方式',
      detail: '最小化到托盘时，frpc 将继续在后台运行。',
      buttons: ['最小化到托盘', '直接退出'],
      defaultId: 0,
      cancelId: 1
    })
    const toTray = response === 0
    setConfig({ trayEnabled: toTray, trayPromptShown: true })
    if (toTray) {
      createTray(win)
      win.hide()
    } else {
      app.quit()
    }
    return
  }

  if (cfg.trayEnabled) {
    e.preventDefault()
    if (!hasTray()) createTray(win)
    win.hide()
  }
  // else: 正常退出
}
