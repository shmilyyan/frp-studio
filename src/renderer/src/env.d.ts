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
}

interface ImportResult {
  success: boolean
  error?: string
  nodeId?: number
  imported?: number
  skipped?: number
}

declare global {
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
        onDownloadProgress(
          cb: (data: { percent: number; downloaded: number; total: number }) => void
        ): () => void
        onDownloadComplete(cb: (data: { version: string }) => void): () => void
      }
      config: {
        get(): Promise<AppConfig>
        set(partial: Partial<AppConfig>): Promise<AppConfig>
        exportToml(nodeId?: number): Promise<{ success: boolean; error?: string }>
        importToml(): Promise<ImportResult>
      }
      window: {
        minimize(): void
        maximize(): void
        close(): void
      }
    }
  }
}
