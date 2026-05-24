import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Node management (including frpc control)
  node: {
    list: () => ipcRenderer.invoke('node:list'),
    listAutoStart: () => ipcRenderer.invoke('node:list-auto-start'),
    add: (data: unknown) => ipcRenderer.invoke('node:add', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('node:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('node:delete', id),
    test: (host: string, port: number, token?: string) =>
      ipcRenderer.invoke('node:test', host, port, token),
    validateConfig: (toml: string) => ipcRenderer.invoke('node:validate-config', toml)
  },
  // Tunnel management
  tunnel: {
    list: (nodeId?: number) => ipcRenderer.invoke('tunnel:list', nodeId),
    add: (data: unknown) => ipcRenderer.invoke('tunnel:add', data),
    update: (id: number, data: unknown) => ipcRenderer.invoke('tunnel:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('tunnel:delete', id),
    listGroups: () => ipcRenderer.invoke('tunnel:list-groups'),
    bulkEnable: (ids: number[]) => ipcRenderer.invoke('tunnel:bulk-enable', ids),
    bulkDisable: (ids: number[]) => ipcRenderer.invoke('tunnel:bulk-disable', ids),
    bulkDelete: (ids: number[]) => ipcRenderer.invoke('tunnel:bulk-delete', ids)
  },
  // frpc control (now per-node)
  frpc: {
    start: (nodeId: number) => ipcRenderer.invoke('frpc:start', nodeId),
    stop: (nodeId: number) => ipcRenderer.invoke('frpc:stop', nodeId),
    status: (nodeId: number) => ipcRenderer.invoke('frpc:status', nodeId),
    statusAll: () => ipcRenderer.invoke('frpc:status-all') as Promise<Record<number, { running: boolean; pid?: number; nodeId?: number; startedAt?: number }>>,
    onLog: (cb: (data: { nodeId: number; type: string; line: string; timestamp: number }) => void) => {
      ipcRenderer.on('frpc:log', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('frpc:log')
    },
    onStatus: (cb: (data: { nodeId: number; status: { running: boolean; pid?: number; nodeId?: number; startedAt?: number } }) => void) => {
      ipcRenderer.on('frpc:status', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('frpc:status')
    }
  },
  // System settings
  system: {
    getFrpVersions: () => ipcRenderer.invoke('system:get-frp-versions'),
    downloadFrp: (version: unknown) => ipcRenderer.invoke('system:download-frp', version),
    getInstalledVersion: () => ipcRenderer.invoke('system:get-installed-version'),
    setAutostart: (enabled: boolean) => ipcRenderer.invoke('system:autostart', enabled),
    getAutostart: () => ipcRenderer.invoke('system:get-autostart'),
    checkUpdate: () => ipcRenderer.invoke('system:check-update'),
    importFrpc: () => ipcRenderer.invoke('system:import-frpc'),
    listBackups: () => ipcRenderer.invoke('system:list-backups'),
    restoreBackup: (filename: string) => ipcRenderer.invoke('system:restore-backup', filename),
    onDownloadProgress: (
      cb: (data: { percent: number; downloaded: number; total: number }) => void
    ) => {
      ipcRenderer.on('system:download-progress', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('system:download-progress')
    },
    onDownloadComplete: (cb: (data: { version: string }) => void) => {
      ipcRenderer.on('system:download-complete', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('system:download-complete')
    },
    onUpdateAvailable: (
      cb: (data: { latestVersion: string; currentVersion: string }) => void
    ) => {
      ipcRenderer.on('system:update-available', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('system:update-available')
    },
    onAutoDownloadStart: (cb: (data: { version: string }) => void) => {
      ipcRenderer.on('system:auto-download-start', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('system:auto-download-start')
    }
  },
  // Global app config
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial: unknown) => ipcRenderer.invoke('config:set', partial),
    exportToml: (nodeId?: number) => ipcRenderer.invoke('config:export', nodeId),
    importToml: () => ipcRenderer.invoke('config:import')
  },
  // Windows Service management (Windows only)
  winsvc: {
    platform: process.platform,
    status: (nodeId: number) => ipcRenderer.invoke('winsvc:status', nodeId),
    install: (nodeId: number) => ipcRenderer.invoke('winsvc:install', nodeId),
    uninstall: (nodeId: number) => ipcRenderer.invoke('winsvc:uninstall', nodeId),
    start: (nodeId: number) => ipcRenderer.invoke('winsvc:start', nodeId),
    stop: (nodeId: number) => ipcRenderer.invoke('winsvc:stop', nodeId)
  },
  // Handoff (device pairing & transfer)
  handoff: {
    startService: () => ipcRenderer.invoke('handoff:start-service'),
    stopService: () => ipcRenderer.invoke('handoff:stop-service'),
    restartService: () => ipcRenderer.invoke('handoff:restart-service'),
    serviceStatus: () => ipcRenderer.invoke('handoff:service-status'),
    listDevices: () => ipcRenderer.invoke('handoff:list-devices'),
    deleteDevice: (deviceId: string) => ipcRenderer.invoke('handoff:delete-device', deviceId),
    generatePairing: (deviceName: string, devicePublicKey: string) =>
      ipcRenderer.invoke('handoff:generate-pairing', deviceName, devicePublicKey),
    transferHistory: (type?: string, limit?: number) =>
      ipcRenderer.invoke('handoff:transfer-history', type, limit),
    clearHistory: () => ipcRenderer.invoke('handoff:clear-history'),
    notifyConfig: () => ipcRenderer.invoke('handoff:notify-config'),
    clipboardGet: () => ipcRenderer.invoke('handoff:clipboard-get'),
    clipboardSend: (text: string) => ipcRenderer.invoke('handoff:clipboard-send', text),
    connectSSE: () => ipcRenderer.invoke('handoff:connect-sse'),
    disconnectSSE: () => ipcRenderer.invoke('handoff:disconnect-sse'),
    onEvent: (cb: (data: { event: string; data: unknown }) => void) => {
      ipcRenderer.on('handoff:event', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('handoff:event')
    },
    onServiceStatusChange: (cb: (data: { status: 'running' | 'stopped' }) => void) => {
      ipcRenderer.on('handoff:service-status-change', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('handoff:service-status-change')
    }
  },
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
