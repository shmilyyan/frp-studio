/**
 * electron-builder afterPack hook
 * Embeds icon.ico into the Windows executable using rcedit.
 */
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  try {
    const { rcedit } = await import('rcedit')
    const appOutDir = context.appOutDir
    const productName = context.packager.appInfo.productName
    const exePath = path.join(appOutDir, `${productName}.exe`)
    const icoPath = path.resolve(context.packager.projectDir, 'resources/icon.ico')

    console.log(`[afterPack] Executable path: ${exePath}`)
    console.log(`[afterPack] Icon path: ${icoPath}`)

    // Verify paths exist
    if (!fs.existsSync(exePath)) {
      console.warn(`[afterPack] Executable not found, skipping icon embedding`)
      return
    }
    if (!fs.existsSync(icoPath)) {
      console.warn(`[afterPack] Icon file not found, skipping icon embedding`)
      return
    }

    console.log(`[afterPack] Embedding icon into ${exePath}`)
    await rcedit(exePath, { icon: icoPath })
    console.log('[afterPack] Icon embedded.')
  } catch (error) {
    console.warn('[afterPack] Icon embedding failed:', error.message)
    // Don't fail the build if icon embedding fails
  }
}
