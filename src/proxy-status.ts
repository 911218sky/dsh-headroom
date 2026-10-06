/** Shared proxy readiness status for /headroom and the settings card. */

export type HealthReason =
  | 'ok'
  | 'timeout'
  | 'refused'
  | 'http_status'
  | 'network'
  | 'unknown'

export type HeadroomProxyPhase = 'starting' | 'ready' | 'down'

export interface HeadroomProxyStatus {
  phase: HeadroomProxyPhase
  baseUrl: string
  clientPresent: boolean
  healthy: boolean | null
  healthReason: HealthReason | null
  httpStatus: number | null
  lastError: string | null
  updatedAt: number
}

export function emptyProxyStatus(baseUrl = ''): HeadroomProxyStatus {
  return {
    phase: 'starting',
    baseUrl,
    clientPresent: false,
    healthy: null,
    healthReason: null,
    httpStatus: null,
    lastError: null,
    updatedAt: Date.now(),
  }
}

/** Classify a failed /health probe for logs and /headroom. */
export function classifyHealthError(error: unknown, httpStatus?: number): {
  reason: HealthReason
  detail: string
} {
  if (httpStatus !== undefined) {
    return { reason: 'http_status', detail: `HTTP ${httpStatus}` }
  }
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { reason: 'timeout', detail: message }
  }
  if (lower.includes('timeout') || lower.includes('aborted') || lower.includes('abort')) {
    return { reason: 'timeout', detail: message }
  }
  if (
    lower.includes('econnrefused')
    || lower.includes('connection refused')
    || lower.includes('fetch failed')
  ) {
    return { reason: 'refused', detail: message }
  }
  if (lower.includes('network') || lower.includes('enotfound')) {
    return { reason: 'network', detail: message }
  }
  return { reason: 'unknown', detail: message }
}

/** Human-readable block for `/headroom` show. */
export function renderProxyStatus(status: HeadroomProxyStatus): string {
  const lines = [
    `Proxy status: ${status.phase}`,
    `baseUrl: ${status.baseUrl || '(unset)'}`,
    `clientPresent: ${status.clientPresent}`,
    `healthy: ${status.healthy === null ? 'unknown' : String(status.healthy)}`,
  ]
  if (status.healthReason !== null) lines.push(`healthReason: ${status.healthReason}`)
  if (status.httpStatus !== null) lines.push(`httpStatus: ${status.httpStatus}`)
  if (status.lastError !== null && status.lastError.length > 0) {
    lines.push(`lastError: ${status.lastError}`)
  }
  lines.push(`updatedAt: ${new Date(status.updatedAt).toISOString()}`)
  return lines.join('\n')
}
