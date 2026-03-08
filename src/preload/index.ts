import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Node management
  node: {
    list: () => ipcRenderer.invoke('node:list'),
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
  // frpc control
  frpc: {
    start: (nodeId: number) => ipcRenderer.invoke('frpc:start', nodeId),
    stop: () => ipcRenderer.invoke('frpc:stop'),
    status: () => ipcRenderer.invoke('frpc:status'),
    onLog: (cb: (data: { type: string; line: string; timestamp: number }) => void) => {
      ipcRenderer.on('frpc:log', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('frpc:log')
    },
    onStatus: (cb: (status: unknown) => void) => {
      ipcRenderer.on('frpc:status', (_e, status) => cb(status))
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
    onDownloadProgress: (
      cb: (data: { percent: number; downloaded: number; total: number }) => void
    ) => {
      ipcRenderer.on('system:download-progress', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('system:download-progress')
    },
    onDownloadComplete: (cb: (data: { version: string }) => void) => {
      ipcRenderer.on('system:download-complete', (_e, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('system:download-complete')
    }
  },
  // Global app config
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial: unknown) => ipcRenderer.invoke('config:set', partial),
    exportToml: (nodeId?: number) => ipcRenderer.invoke('config:export', nodeId),
    importToml: () => ipcRenderer.invoke('config:import')
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
