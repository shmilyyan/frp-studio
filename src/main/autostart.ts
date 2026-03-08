import { app } from 'electron'

export function setAutostart(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false
  })
}

export function getAutostart(): boolean {
  return app.getLoginItemSettings().openAtLogin
}
