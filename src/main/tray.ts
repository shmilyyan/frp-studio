import { Tray, Menu, BrowserWindow, app, nativeImage, Notification } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { frpcManager, FrpcConfig } from './frpc'
import { listNodes, listTunnels } from './db'
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
  tray.setToolTip('Frper')
  refreshTrayMenu(win)

  tray.on('double-click', () => {
    win.show()
    win.focus()
  })
}

export function refreshTrayMenu(win: BrowserWindow): void {
  if (!tray) return

  const nodes = listNodes()
  const runningStatuses: string[] = []

  for (const node of nodes) {
    const status = frpcManager.getStatus(node.id)
    if (status.running) {
      runningStatuses.push(`${node.name} (PID ${status.pid})`)
    }
  }

  let statusLabel: string
  if (runningStatuses.length === 0) {
    statusLabel = '○ 所有节点已停止'
  } else if (runningStatuses.length === 1) {
    statusLabel = `● ${runningStatuses[0]}`
  } else {
    statusLabel = `● ${runningStatuses.length} 个节点运行中`
  }

  // Build node submenu with start/stop options
  const nodeItems: Electron.MenuItemConstructorOptions[] = nodes.map((node) => {
    const status = frpcManager.getStatus(node.id)
    return {
      label: `${status.running ? '●' : '○'} ${node.name}`,
      sublabel: status.running ? `PID ${status.pid}` : '已停止',
      click: async () => {
        if (status.running) {
          // Stop node
          frpcManager.stop(node.id)
          new Notification({
            title: 'Frper',
            body: `节点 ${node.name} 已停止`
          }).show()
        } else {
          // Start node directly from tray
          const tunnels = listTunnels(node.id).filter((t) => t.enabled === 1)
          if (tunnels.length === 0) {
            new Notification({
              title: 'Frper',
              body: `节点 ${node.name} 没有启用的隧道，无法启动`
            }).show()
            return
          }

          try {
            const config: FrpcConfig = {
              serverAddr: node.host,
              serverPort: node.port,
              token: node.token ?? undefined,
              tunnels: tunnels.map((t) => ({
                name: t.name,
                type: t.type,
                localIP: t.local_ip,
                localPort: t.local_port,
                remotePort: t.remote_port ?? undefined,
                customDomain: t.custom_domain ?? undefined,
                extraAttrs: (() => {
                  try { return JSON.parse(t.extra_attrs || '{}') as Record<string, string> }
                  catch { return {} }
                })()
              }))
            }
            frpcManager.start(config, node.id, win)
            new Notification({
              title: 'Frper',
              body: `节点 ${node.name} 已启动`
            }).show()
          } catch (err) {
            new Notification({
              title: 'Frper',
              body: `节点 ${node.name} 启动失败: ${err instanceof Error ? err.message : '未知错误'}`
            }).show()
          }
        }
      }
    }
  })

  const menu = Menu.buildFromTemplate([
    { label: 'Frper', enabled: false },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    ...(nodeItems.length > 0
      ? [
          { type: 'separator' as const },
          {
            label: '节点',
            submenu: nodeItems
          } as Electron.MenuItemConstructorOptions
        ]
      : []),
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
        // Stop all frpc processes before quit
        frpcManager.stopAll()
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
      title: 'Frper',
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
      // Stop all frpc before quit
      frpcManager.stopAll()
      app.quit()
    }
    return
  }

  if (cfg.trayEnabled) {
    e.preventDefault()
    if (!hasTray()) createTray(win)
    win.hide()
  } else {
    // Stop all frpc before quit
    frpcManager.stopAll()
  }
}
