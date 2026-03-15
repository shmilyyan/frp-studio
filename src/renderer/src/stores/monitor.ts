import { defineStore } from 'pinia'

export interface LogEntry {
  id: number
  nodeId: number
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

interface NodeLogs {
  logs: LogEntry[]
  logCounter: number
}

export const useMonitorStore = defineStore('monitor', () => {
  const nodeLogs = new Map<number, NodeLogs>()
  const nodeTraffic = new Map<number, TrafficPoint[]>()
  const maxTrafficPoints = 360 // keep 6 hours
  const maxLogs = 1000

  function getOrCreateNodeLogs(nodeId: number): NodeLogs {
    if (!nodeLogs.has(nodeId)) {
      nodeLogs.set(nodeId, { logs: [], logCounter: 0 })
    }
    return nodeLogs.get(nodeId)!
  }

  function getOrCreateTraffic(nodeId: number): TrafficPoint[] {
    if (!nodeTraffic.has(nodeId)) {
      nodeTraffic.set(nodeId, [])
    }
    return nodeTraffic.get(nodeId)!
  }

  function getLogs(nodeId: number): LogEntry[] {
    return getOrCreateNodeLogs(nodeId).logs
  }

  function addLog(nodeId: number, entry: { type: LogEntry['type']; line: string; timestamp: number }) {
    const nodeLog = getOrCreateNodeLogs(nodeId)
    const log: LogEntry = { ...entry, nodeId, id: ++nodeLog.logCounter }
    nodeLog.logs.push(log)
    if (nodeLog.logs.length > maxLogs) {
      nodeLog.logs.splice(0, nodeLog.logs.length - maxLogs)
    }
    _trackTraffic(nodeId, log)
  }

  function _trackTraffic(nodeId: number, entry: Omit<LogEntry, 'id'>) {
    const traffic = getOrCreateTraffic(nodeId)
    const bucket = Math.floor(entry.timestamp / BUCKET_MS) * BUCKET_MS
    let point = traffic.find((p) => p.timestamp === bucket)
    if (!point) {
      point = { timestamp: bucket, connections: 0, errors: 0 }
      traffic.push(point)
      if (traffic.length > maxTrafficPoints) {
        traffic.shift()
      }
    }
    const line = entry.line.toLowerCase()
    if (line.includes('start proxy') || line.includes('new proxy') || line.includes('connected')) {
      point.connections++
    }
    if (entry.type === 'error' || line.includes('error') || line.includes('failed')) {
      point.errors++
    }
  }

  function clearLogs(nodeId?: number) {
    if (nodeId !== undefined) {
      const nodeLog = nodeLogs.get(nodeId)
      if (nodeLog) {
        nodeLog.logs = []
      }
      // Also clear traffic for this node
      nodeTraffic.delete(nodeId)
    } else {
      nodeLogs.clear()
      nodeTraffic.clear()
    }
  }

  function exportLogs(nodeId: number): string {
    const logs = getLogs(nodeId)
    return logs
      .map((l) => {
        const time = new Date(l.timestamp).toISOString()
        return `[${time}] [${l.type.toUpperCase()}] ${l.line}`
      })
      .join('\n')
  }

  // Get traffic for a specific node
  function getRecentTraffic(nodeId: number, minutes: number) {
    const traffic = getOrCreateTraffic(nodeId)
    const cutoff = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS - minutes * BUCKET_MS
    return traffic.filter((p) => p.timestamp >= cutoff)
  }

  // Get aggregated traffic from all nodes (for "all nodes" view)
  function getAggregatedTraffic(minutes: number): TrafficPoint[] {
    const cutoff = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS - minutes * BUCKET_MS
    const aggregated = new Map<number, TrafficPoint>()

    for (const traffic of nodeTraffic.values()) {
      for (const point of traffic) {
        if (point.timestamp >= cutoff) {
          if (!aggregated.has(point.timestamp)) {
            aggregated.set(point.timestamp, { timestamp: point.timestamp, connections: 0, errors: 0 })
          }
          const agg = aggregated.get(point.timestamp)!
          agg.connections += point.connections
          agg.errors += point.errors
        }
      }
    }

    return Array.from(aggregated.values()).sort((a, b) => a.timestamp - b.timestamp)
  }

  return {
    nodeLogs,
    nodeTraffic,
    getLogs,
    addLog,
    clearLogs,
    exportLogs,
    getRecentTraffic,
    getAggregatedTraffic
  }
})
