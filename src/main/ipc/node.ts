import { ipcMain } from 'electron'
import { listNodes, addNode, updateNode, deleteNode } from '../db'
import { testNodeConnection } from '../network'
import { validateFrpsToml, extractNodeConfig } from '../toml'

export function registerNodeHandlers(): void {
  ipcMain.handle('node:list', () => listNodes())

  ipcMain.handle('node:add', (_e, data) => addNode(data))

  ipcMain.handle('node:update', (_e, id, data) => updateNode(id, data))

  ipcMain.handle('node:delete', (_e, id) => {
    deleteNode(id)
    return { success: true }
  })

  ipcMain.handle('node:test', async (_e, host, port, token) => {
    return testNodeConnection(host, port, token)
  })

  ipcMain.handle('node:validate-config', (_e, tomlContent: string) => {
    const result = validateFrpsToml(tomlContent)
    const extracted = result.valid ? extractNodeConfig(tomlContent) : {}
    return { ...result, extracted }
  })
}
