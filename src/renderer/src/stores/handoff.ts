import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface PairedDevice {
  deviceId: string
  deviceName: string
  publicKey: string
  enabled: boolean
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

export const useHandoffStore = defineStore('handoff', () => {
  let restartTimeout: ReturnType<typeof setTimeout> | null = null

  const serviceStatus = ref<'running' | 'stopped'>('stopped')
  const serviceUptime = ref(0)
  const serviceConnections = ref(0)
  const devices = ref<PairedDevice[]>([])
  const transferHistory = ref<TransferRecord[]>([])
  const sseCleanup = ref<(() => void) | null>(null)

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
  }

  async function restartService(): Promise<void> {
    await window.api.handoff.restartService()
    if (restartTimeout) clearTimeout(restartTimeout)
    restartTimeout = setTimeout(() => {
      serviceStatus.value = 'stopped'
    }, 10000)
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
    window.api.handoff.connectSSE()
    const clean1 = window.api.handoff.onEvent(({ event, data }) => {
      if (event === 'ws-connection' || event === 'ws-disconnection') {
        serviceConnections.value = (data as { connected: number }).connected
      } else if (event === 'config-reloaded') {
        fetchDevices()
      } else if (event === 'device-paired') {
        fetchDevices()
      } else if (event === 'device-revoked') {
        fetchDevices()
      } else if (event === 'transfer-recorded') {
        const record = data as TransferRecord
        transferHistory.value.unshift(record)
      }
    })
    const clean2 = window.api.handoff.onServiceStatusChange(({ status }) => {
      serviceStatus.value = status
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

  return {
    serviceStatus, serviceUptime, serviceConnections, devices, transferHistory,
    isRunning,
    fetchServiceStatus, startService, stopService, restartService,
    fetchDevices, deleteDevice, generatePairing,
    fetchTransferHistory, clearHistory,
    connectSSE, disconnectSSE
  }
})
