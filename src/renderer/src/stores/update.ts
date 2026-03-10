import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUpdateStore = defineStore('update', () => {
  const hasUpdate = ref(false)
  const latestVersion = ref<string | null>(null)
  const currentVersion = ref<string | null>(null)
  const isDownloading = ref(false)
  const downloadPercent = ref(0)
  const downloadingVersion = ref<string | null>(null)

  function setUpdateAvailable(latest: string, current: string) {
    hasUpdate.value = true
    latestVersion.value = latest
    currentVersion.value = current
  }

  function startDownload(version: string) {
    isDownloading.value = true
    downloadPercent.value = 0
    downloadingVersion.value = version
  }

  function setProgress(percent: number) {
    downloadPercent.value = percent
  }

  function finishDownload(version: string) {
    isDownloading.value = false
    downloadPercent.value = 0
    downloadingVersion.value = null
    // Clear update badge if the downloaded version matches latest
    if (version === latestVersion.value) {
      hasUpdate.value = false
    }
    currentVersion.value = version
  }

  return {
    hasUpdate,
    latestVersion,
    currentVersion,
    isDownloading,
    downloadPercent,
    downloadingVersion,
    setUpdateAvailable,
    startDownload,
    setProgress,
    finishDownload
  }
})
