import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getFrpcPath } from './paths'

const execFileP = promisify(execFile)

export type ServiceStatus =
  | 'not-installed'
  | 'stopped'
  | 'running'
  | 'starting'
  | 'stopping'
  | 'unknown'

export function getServiceName(nodeId: number): string {
  return `FrpStudio_${nodeId}`
}

function getServiceDir(nodeId: number): string {
  return path.join(app.getPath('userData'), 'services', String(nodeId))
}

export function getConfigPath(nodeId: number): string {
  return path.join(getServiceDir(nodeId), 'frpc.toml')
}

export function getFrpcExePath(): string {
  return getFrpcPath()
}

export function writeServiceConfig(nodeId: number, content: string): void {
  fs.mkdirSync(getServiceDir(nodeId), { recursive: true })
  fs.writeFileSync(getConfigPath(nodeId), content, 'utf-8')
}

async function isAdminProcess(): Promise<boolean> {
  try {
    await execFileP('net', ['session'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

/**
 * 执行 PowerShell 脚本，如果当前进程没有管理员权限则通过 UAC 提权后执行。
 * 结果通过临时 JSON 文件传回主进程。
 */
async function runPsScript(script: string): Promise<{ success: boolean; output: string }> {
  const ts = Date.now()
  const tempDir = path.join(app.getPath('userData'), '.tmp')
  fs.mkdirSync(tempDir, { recursive: true })

  const resultPath = path.join(tempDir, `result_${ts}.json`)
  const scriptPath = path.join(tempDir, `script_${ts}.ps1`)

  // PowerShell 字符串中反斜杠需要转义
  const psResultPath = resultPath.replace(/\\/g, '\\\\')

  const wrappedScript = `
$ErrorActionPreference = 'Stop'
try {
${script}
  $__json = [ordered]@{ success = $true; output = 'OK' } | ConvertTo-Json
} catch {
  $__json = [ordered]@{ success = $false; output = ($_.Exception.Message | Out-String).Trim() } | ConvertTo-Json
}
[IO.File]::WriteAllText("${psResultPath}", $__json, [Text.Encoding]::UTF8)
`

  fs.writeFileSync(scriptPath, wrappedScript, 'utf-8')

  try {
    const admin = await isAdminProcess()

    if (admin) {
      await execFileP(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { windowsHide: true }
      )
    } else {
      // 通过 Start-Process -Verb RunAs 触发 UAC 提权弹窗
      // 脚本路径若含空格则用双引号包裹，双引号位于单引号串内，PS 视为字面量
      const fileArg = `"${scriptPath.replace(/"/g, '\\"')}"`
      const command = `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ${fileArg}'`
      await execFileP(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { windowsHide: true }
      )
    }

    if (fs.existsSync(resultPath)) {
      const json = JSON.parse(fs.readFileSync(resultPath, 'utf-8'))
      try { fs.unlinkSync(resultPath) } catch { /* ignore */ }
      return json
    }

    return { success: false, output: '操作已取消（UAC 授权被拒绝）' }
  } catch (e: unknown) {
    const err = e as { message?: string }
    return { success: false, output: err.message ?? '执行失败' }
  } finally {
    try { fs.unlinkSync(scriptPath) } catch { /* ignore */ }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getServiceStatus(nodeId: number): Promise<ServiceStatus> {
  if (process.platform !== 'win32') return 'unknown'

  try {
    const { stdout } = await execFileP('sc.exe', ['query', getServiceName(nodeId)], {
      windowsHide: true
    })
    const text = stdout.toUpperCase()
    if (text.includes('RUNNING')) return 'running'
    if (text.includes('START_PENDING')) return 'starting'
    if (text.includes('STOP_PENDING')) return 'stopping'
    if (text.includes('STOPPED')) return 'stopped'
    return 'unknown'
  } catch (e: unknown) {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    const msg = [err.stderr, err.stdout, err.message].join(' ').toLowerCase()
    if (msg.includes('1060') || msg.includes('does not exist')) return 'not-installed'
    return 'unknown'
  }
}

export async function installService(
  nodeId: number,
  nodeName: string,
  configContent: string
): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Windows 服务仅支持 Windows 平台' }
  }

  const frpcPath = getFrpcExePath()
  if (!fs.existsSync(frpcPath)) {
    return { success: false, message: '未找到 frpc.exe，请先在设置页下载 FRP' }
  }

  writeServiceConfig(nodeId, configContent)

  const serviceName = getServiceName(nodeId)
  const configPath = getConfigPath(nodeId)

  // 转义 PowerShell 单引号字符串中的单引号（用 '' 代替）
  const psServiceName = serviceName.replace(/'/g, "''")
  // 路径用双引号包裹以支持含空格的路径，反斜杠在 PS 双引号串中无需额外转义
  const psBinPath = `\`"${frpcPath}\`" -c \`"${configPath}\`"`
  const psDisplayName = `Frper - ${nodeName.replace(/'/g, "''")}`
  const psDescription = `由 Frper 管理的 frpc 服务（节点: ${nodeName.replace(/'/g, "''")}）`

  const script = `
  $svcName = '${psServiceName}'
  $binPath = "${psBinPath}"
  sc.exe create $svcName binPath= $binPath start= auto DisplayName= '${psDisplayName}' | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "sc create 失败，退出码: $LASTEXITCODE" }
  sc.exe description $svcName '${psDescription}' | Out-Null
`

  const result = await runPsScript(script)
  if (!result.success) {
    return { success: false, message: `安装失败: ${result.output}` }
  }
  return { success: true, message: '服务安装成功' }
}

export async function uninstallService(nodeId: number): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Windows 服务仅支持 Windows 平台' }
  }

  const status = await getServiceStatus(nodeId)
  if (status === 'not-installed') {
    return { success: true, message: '服务不存在，无需卸载' }
  }

  const psServiceName = getServiceName(nodeId).replace(/'/g, "''")

  const script = `
  $svcName = '${psServiceName}'
  $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
  if ($null -ne $svc -and $svc.Status -ne 'Stopped') {
    sc.exe stop $svcName | Out-Null
    Start-Sleep -Seconds 2
  }
  sc.exe delete $svcName | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "sc delete 失败，退出码: $LASTEXITCODE" }
`

  const result = await runPsScript(script)
  if (!result.success) {
    return { success: false, message: `卸载失败: ${result.output}` }
  }

  // 清理配置文件（可选，忽略错误）
  try {
    const dir = path.join(app.getPath('userData'), 'services', String(nodeId))
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  } catch { /* ignore */ }

  return { success: true, message: '服务已成功卸载' }
}

export async function startService(nodeId: number): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Windows 服务仅支持 Windows 平台' }
  }

  const psServiceName = getServiceName(nodeId).replace(/'/g, "''")
  const script = `
  sc.exe start '${psServiceName}' | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "sc start 失败，退出码: $LASTEXITCODE" }
`
  const result = await runPsScript(script)
  if (!result.success) {
    return { success: false, message: `启动失败: ${result.output}` }
  }
  return { success: true, message: '服务已启动' }
}

export async function stopService(nodeId: number): Promise<{ success: boolean; message: string }> {
  if (process.platform !== 'win32') {
    return { success: false, message: 'Windows 服务仅支持 Windows 平台' }
  }

  const psServiceName = getServiceName(nodeId).replace(/'/g, "''")
  const script = `
  sc.exe stop '${psServiceName}' | Out-String | Write-Verbose
  if ($LASTEXITCODE -ne 0) { throw "sc stop 失败，退出码: $LASTEXITCODE" }
`
  const result = await runPsScript(script)
  if (!result.success) {
    return { success: false, message: `停止失败: ${result.output}` }
  }
  return { success: true, message: '服务已停止' }
}
