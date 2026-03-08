import { defineStore } from 'pinia'

export interface LogEntry {
  id: number
  type: 'stdout' | 'stderr' | 'system' | 'error'
  line: string
  timestamp: number
}

export interface TrafficPoint {
  timestamp: number  // minute-level bucket
  connections: number
  errors: number
}

const BUCKET_MS = 60_000 // 1 minute per bucket

export const useMonitorStore = defineStore('monitor', {
  state: () => ({
    logs: [] as LogEntry[],
    maxLogs: 1000,
    logCounter: 0,
    traffic: [] as TrafficPoint[],
    maxTrafficPoints: 360 // keep 6 hours
  }),
  getters: {
    recentTraffic: (state) => (minutes: number) => {
      const cutoff = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS - minutes * BUCKET_MS
      return state.traffic.filter((p) => p.timestamp >= cutoff)
    }
  },
  actions: {
    addLog(entry: Omit<LogEntry, 'id'>) {
      const log: LogEntry = { ...entry, id: ++this.logCounter }
      this.logs.push(log)
      if (this.logs.length > this.maxLogs) {
        this.logs.splice(0, this.logs.length - this.maxLogs)
      }
      this._trackTraffic(entry)
    },
    _trackTraffic(entry: Omit<LogEntry, 'id'>) {
      const bucket = Math.floor(entry.timestamp / BUCKET_MS) * BUCKET_MS
      let point = this.traffic.find((p) => p.timestamp === bucket)
      if (!point) {
        point = { timestamp: bucket, connections: 0, errors: 0 }
        this.traffic.push(point)
        if (this.traffic.length > this.maxTrafficPoints) {
          this.traffic.shift()
        }
      }
      const line = entry.line.toLowerCase()
      if (line.includes('start proxy') || line.includes('new proxy') || line.includes('connected')) {
        point.connections++
      }
      if (entry.type === 'error' || line.includes('error') || line.includes('failed')) {
        point.errors++
      }
    },
    clearLogs() {
      this.logs = []
    },
    exportLogs(): string {
      return this.logs
        .map((l) => {
          const time = new Date(l.timestamp).toISOString()
          return `[${time}] [${l.type.toUpperCase()}] ${l.line}`
        })
        .join('\n')
    }
  }
})
