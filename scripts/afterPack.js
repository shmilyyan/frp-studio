/**
 * electron-builder afterPack hook
 * Embeds icon.ico into the Windows executable using rcedit.
 */
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const { rcedit } = await import('rcedit')
  const appOutDir = context.appOutDir
  const productName = context.packager.appInfo.productName
  const exePath = path.join(appOutDir, `${productName}.exe`)
  const icoPath = path.resolve(context.packager.projectDir, 'resources/icon.ico')

  console.log(`[afterPack] Embedding icon into ${exePath}`)
  await rcedit(exePath, { icon: icoPath })
  console.log('[afterPack] Icon embedded.')
}
