import { app } from 'electron'
import path from 'path'

/**
 * frp 二进制目录：
 *   生产环境 → exe 同级目录下的 frp/
 *   开发环境 → userData/frp/（避免污染 electron 二进制目录）
 */
export function getFrpDir(): string {
  if (!app.isPackaged) {
    return path.join(app.getPath('userData'), 'frp')
  }
  return path.join(path.dirname(app.getPath('exe')), 'frp')
}

export const FRP_BIN_NAME = process.platform === 'win32' ? 'frpc.exe' : 'frpc'

export function getFrpcPath(): string {
  return path.join(getFrpDir(), FRP_BIN_NAME)
}

export function getBackupDir(): string {
  return path.join(getFrpDir(), 'back')
}
