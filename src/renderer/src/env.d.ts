/// <reference types="vite/client" />

import type { FrpVersion } from '../../main/downloader'

interface FrpcStatus {
  running: boolean
  pid?: number
  nodeId?: number
  startedAt?: number
}

interface ConnectTestResult {
  tcpReachable: boolean
  tokenValid: boolean | null
  frpRunning: boolean
  latency?: number
  error?: string
}

interface AppConfig {
  trayEnabled: boolean
  trayPromptShown: boolean
  activeNodeId: number | null
  autoReconnect: boolean
  reconnectDelay: number
  reconnectMaxRetries: number
  autoCheckUpdate: boolean
  updateCheckInterval: number
  lastUpdateCheck: number | null
  latestKnownVersion: string | null
  proxyUrl: string
  proxyEnabled: boolean
}

interface ImportResult {
  success: boolean
  error?: string
  nodeId?: number
  imported?: number
  skipped?: number
}

declare global {
  type ServiceStatus =
    | 'not-installed'
    | 'stopped'
    | 'running'
    | 'starting'
    | 'stopping'
    | 'unknown'

  interface BackupInfo {
    filename: string
    version: string
    date: string
    size: number
  }

  interface Window {
    api: {
      node: {
        list(): Promise<unknown[]>
        add(data: unknown): Promise<unknown>
        update(id: number, data: unknown): Promise<unknown>
        delete(id: number): Promise<{ success: boolean }>
        test(host: string, port: number, token?: string): Promise<ConnectTestResult>
        validateConfig(toml: string): Promise<{
          valid: boolean
          errors: string[]
          extracted?: Record<string, unknown>
        }>
      }
      tunnel: {
        list(nodeId?: number): Promise<unknown[]>
        add(data: unknown): Promise<unknown>
        update(id: number, data: unknown): Promise<unknown>
        delete(id: number): Promise<{ success: boolean }>
        listGroups(): Promise<string[]>
        bulkEnable(ids: number[]): Promise<{ success: boolean }>
        bulkDisable(ids: number[]): Promise<{ success: boolean }>
        bulkDelete(ids: number[]): Promise<{ success: boolean }>
      }
      frpc: {
        start(nodeId: number): Promise<FrpcStatus>
        stop(): Promise<FrpcStatus>
        status(): Promise<FrpcStatus>
        onLog(
          cb: (data: {
            type: 'stdout' | 'stderr' | 'system' | 'error'
            line: string
            timestamp: number
          }) => void
        ): () => void
        onStatus(cb: (status: FrpcStatus) => void): () => void
      }
      system: {
        getFrpVersions(): Promise<FrpVersion[]>
        downloadFrp(version: FrpVersion): Promise<{ success: boolean }>
        getInstalledVersion(): Promise<string | null>
        setAutostart(enabled: boolean): Promise<{ success: boolean }>
        getAutostart(): Promise<boolean>
        checkUpdate(): Promise<{ hasUpdate: boolean; latestVersion: string | null; currentVersion: string | null }>
        importFrpc(): Promise<{ success: boolean; version: string | null; error?: string }>
        listBackups(): Promise<BackupInfo[]>
        restoreBackup(filename: string): Promise<{ success: boolean; version: string | null; error?: string }>
        onDownloadProgress(
          cb: (data: { percent: number; downloaded: number; total: number }) => void
        ): () => void
        onDownloadComplete(cb: (data: { version: string }) => void): () => void
        onUpdateAvailable(
          cb: (data: { latestVersion: string; currentVersion: string }) => void
        ): () => void
        onAutoDownloadStart(cb: (data: { version: string }) => void): () => void
      }
      config: {
        get(): Promise<AppConfig>
        set(partial: Partial<AppConfig>): Promise<AppConfig>
        exportToml(nodeId?: number): Promise<{ success: boolean; error?: string }>
        importToml(): Promise<ImportResult>
      }
      winsvc: {
        platform: string
        status(nodeId: number): Promise<ServiceStatus>
        install(nodeId: number): Promise<{ success: boolean; message: string }>
        uninstall(nodeId: number): Promise<{ success: boolean; message: string }>
        start(nodeId: number): Promise<{ success: boolean; message: string }>
        stop(nodeId: number): Promise<{ success: boolean; message: string }>
      }
      window: {
        minimize(): void
        maximize(): void
        close(): void
      }
    }
  }
}
