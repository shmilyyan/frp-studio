import TOML from '@iarna/toml'

export interface TomlValidateResult {
  valid: boolean
  errors: string[]
  parsed?: Record<string, unknown>
}

export function validateFrpsToml(content: string): TomlValidateResult {
  const errors: string[] = []
  let parsed: Record<string, unknown> | undefined

  // Step 1: Syntax check
  try {
    parsed = TOML.parse(content) as Record<string, unknown>
  } catch (err: unknown) {
    return {
      valid: false,
      errors: [`TOML syntax error: ${err instanceof Error ? err.message : String(err)}`]
    }
  }

  // Step 2: Required fields
  if (!parsed.bindPort && !parsed.bind_port) {
    errors.push('Missing required field: bindPort (or bind_port)')
  }

  const bindPort = (parsed.bindPort ?? parsed.bind_port) as number | undefined
  if (bindPort !== undefined) {
    if (typeof bindPort !== 'number' || bindPort < 1 || bindPort > 65535) {
      errors.push('bindPort must be a valid port number (1-65535)')
    }
  }

  // Step 3: Auth section validation
  const auth = parsed.auth as Record<string, unknown> | undefined
  if (auth) {
    if (auth.method && !['token', 'oidc'].includes(String(auth.method))) {
      errors.push('auth.method must be "token" or "oidc"')
    }
    if (auth.method === 'token' && !auth.token) {
      errors.push('auth.token is required when auth.method is "token"')
    }
  }

  // Step 4: Dashboard validation
  const webServer = parsed.webServer as Record<string, unknown> | undefined
  if (webServer) {
    const wsPort = webServer.port as number | undefined
    if (wsPort !== undefined && (wsPort < 1 || wsPort > 65535)) {
      errors.push('webServer.port must be a valid port number')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed
  }
}

export function extractNodeConfig(content: string): {
  host?: string
  port?: number
  token?: string
} {
  try {
    const parsed = TOML.parse(content) as Record<string, unknown>
    const auth = parsed.auth as Record<string, unknown> | undefined
    return {
      port: (parsed.bindPort ?? parsed.bind_port) as number | undefined,
      token: auth?.token as string | undefined
    }
  } catch {
    return {}
  }
}
