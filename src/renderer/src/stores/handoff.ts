import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PairedDevice {
  deviceId: string
  deviceName: string
  publicKey: string
  enabled: boolean
  lastSeen: number
  lastIp: string
}

export interface DiscoveredPeer {
  discoveryId: string
  deviceId?: string
  deviceName: string
  platform: string
  host?: string
  port?: number
  lastSeen: number
  status: 'reachable' | 'offline'
}

export interface TransferRecord {
  id: number
  device_id: number
  type: string
  direction: string
  detail: string
  size: number
  status: string
  created_at: number
}

export interface ClipboardDelivery {
  transferId: string
  deviceId: string
  deviceName: string
  direction: 'send' | 'receive'
  success: boolean
  error?: string
  size: number
}

export const useHandoffStore = defineStore('handoff', () => {
  const serviceStatus = ref<'running' | 'stopped'>('stopped')
  const serviceUptime = ref(0)
  const serviceConnections = ref(0)
  const devices = ref<PairedDevice[]>([])
  const discoveredPeers = ref<Record<string, DiscoveredPeer>>({})
  const transferHistory = ref<TransferRecord[]>([])
  const sseCleanup = ref<(() => void) | null>(null)
  const onlineDevices = ref<Record<string, 'online' | 'offline'>>({})
  const latestClipboardDelivery = ref<{ sequence: number; result: ClipboardDelivery } | null>(null)
  let deliverySequence = 0

  const isRunning = computed(() => serviceStatus.value === 'running')

  async function fetchServiceStatus(): Promise<void> {
    const result = await window.api.handoff.serviceStatus()
    serviceStatus.value = result.status
    serviceUptime.value = result.uptime
    if (result.health) {
      serviceConnections.value = result.health.connections
    }
  }

  async function startService(): Promise<void> {
    await window.api.handoff.startService()
    await fetchServiceStatus()
  }

  async function stopService(): Promise<void> {
    await window.api.handoff.stopService()
    serviceStatus.value = 'stopped'
    for (const peer of Object.values(discoveredPeers.value)) peer.status = 'offline'
    for (const deviceId of Object.keys(onlineDevices.value)) onlineDevices.value[deviceId] = 'offline'
  }

  async function restartService(): Promise<void> {
    await window.api.handoff.restartService()
    // Status is tracked by socket.io connect/disconnect events — no timeout needed
  }

  async function fetchDevices(): Promise<void> {
    devices.value = (await window.api.handoff.listDevices()) as PairedDevice[]
  }

  async function deleteDevice(deviceId: string): Promise<void> {
    await window.api.handoff.deleteDevice(deviceId)
    devices.value = devices.value.filter((d) => d.deviceId !== deviceId)
  }

  async function generatePairing(deviceName: string, devicePublicKey: string): Promise<{ success: boolean; qrData?: string; error?: string }> {
    return window.api.handoff.generatePairing(deviceName, devicePublicKey)
  }

  async function fetchTransferHistory(type?: string): Promise<void> {
    transferHistory.value = (await window.api.handoff.transferHistory(type)) as TransferRecord[]
  }

  async function clearHistory(): Promise<void> {
    await window.api.handoff.clearHistory()
    transferHistory.value = []
  }

  function connectSSE(): void {
    if (sseCleanup.value) return
    window.api.handoff.connectSSE()
    const clean1 = window.api.handoff.onEvent(({ event, data }) => {
      if (event === 'connected') {
        void scanDevices()
      } else if (event === 'ws-connection' || event === 'ws-disconnection') {
        serviceConnections.value = (data as { connected: number }).connected
      } else if (event === 'config:reloaded') {
        fetchDevices()
      } else if (event === 'device:paired') {
        fetchDevices()
      } else if (event === 'device:revoked') {
        fetchDevices()
      } else if (event === 'transfer:recorded') {
        const record = data as TransferRecord
        transferHistory.value.unshift(record)
      } else if (event === 'clipboard:delivery') {
        latestClipboardDelivery.value = { sequence: ++deliverySequence, result: data as ClipboardDelivery }
      } else if (event === 'peer:connected') {
        const { deviceId } = data as { deviceId: string }
        onlineDevices.value[deviceId] = 'online'
      } else if (event === 'peer:disconnected') {
        const { deviceId } = data as { deviceId: string }
        onlineDevices.value[deviceId] = 'offline'
      } else if (event === 'bonjour:found') {
        const peer = data as Omit<DiscoveredPeer, 'status'>
        if (peer.discoveryId) {
          discoveredPeers.value[peer.discoveryId] = { ...peer, status: 'reachable' }
        }
      } else if (event === 'bonjour:lost') {
        const { discoveryId } = data as { discoveryId: string }
        if (discoveredPeers.value[discoveryId]) discoveredPeers.value[discoveryId].status = 'offline'
      }
    })
    const clean2 = window.api.handoff.onServiceStatusChange(({ status }) => {
      serviceStatus.value = status
      if (status === 'stopped') {
        for (const peer of Object.values(discoveredPeers.value)) peer.status = 'offline'
        for (const deviceId of Object.keys(onlineDevices.value)) onlineDevices.value[deviceId] = 'offline'
      }
    })
    sseCleanup.value = () => { clean1(); clean2() }
  }

  function disconnectSSE(): void {
    if (sseCleanup.value) {
      sseCleanup.value()
      sseCleanup.value = null
    }
    window.api.handoff.disconnectSSE()
  }

  async function scanDevices(): Promise<void> {
    await window.api.handoff.scanDevices()
  }

  async function setScanInterval(seconds: number): Promise<void> {
    await window.api.handoff.setScanInterval(seconds)
  }

  return {
    serviceStatus, serviceUptime, serviceConnections, devices, discoveredPeers, transferHistory,
    isRunning,
    fetchServiceStatus, startService, stopService, restartService,
    fetchDevices, deleteDevice, generatePairing,
    fetchTransferHistory, clearHistory,
    connectSSE, disconnectSSE,
    onlineDevices, latestClipboardDelivery,
    scanDevices, setScanInterval
  }
})
