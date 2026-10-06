/**
 * Minimal HTTP client for the local Headroom compression proxy.
 *
 * The wire contract mirrors the official headroom-ai TypeScript SDK:
 * `POST /v1/compress` compresses an OpenAI-style message list, `POST
 * /v1/retrieve` restores original content from the CCR store, and `GET
 * /health` reports service readiness.
 */

import { classifyHealthError, type HealthReason } from './proxy-status.ts'

/** Compressed message list plus the proxy's token accounting. */
export interface HeadroomCompressResponse {
  /** Compressed OpenAI-style messages. */
  messages: unknown[]
  tokens_before: number
  tokens_after: number
  tokens_saved: number
  compression_ratio: number
  transforms_applied: string[]
  /** CCR store hashes; original content is retrievable with them. */
  ccr_hashes: string[]
}

/** Detailed /health probe result (boolean `health()` stays for callers). */
export interface HeadroomHealthProbe {
  ok: boolean
  reason: HealthReason
  httpStatus: number | null
  detail: string | null
}

export class HeadroomClient {
  constructor(
    readonly baseUrl: string,
    private readonly timeoutMs = 30_000,
  ) {}

  /** Whether the proxy answers /health successfully right now. */
  async health(): Promise<boolean> {
    return (await this.probeHealth()).ok
  }

  /** Probe /health with a classified reason for diagnostics. */
  async probeHealth(): Promise<HeadroomHealthProbe> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) {
        return { ok: true, reason: 'ok', httpStatus: response.status, detail: null }
      }
      const classified = classifyHealthError(undefined, response.status)
      return {
        ok: false,
        reason: classified.reason,
        httpStatus: response.status,
        detail: classified.detail,
      }
    } catch (error) {
      const classified = classifyHealthError(error)
      return {
        ok: false,
        reason: classified.reason,
        httpStatus: null,
        detail: classified.detail,
      }
    }
  }

  /**
   * Compress an OpenAI-style message list through the local proxy. The proxy
   * requires the `model` field for token estimation; callers may pass the
   * conversation's routed model, and the harness default stands in when they
   * have none. `mode: 'ccr'` makes the proxy write CCR retrieval hashes for
   * lossy replacements, so `headroom_retrieve` can restore the originals.
   */
  async compress(messages: unknown[], model = 'deepseek-chat', mode = 'ccr'): Promise<HeadroomCompressResponse> {
    const body = { messages, model, config: { mode } }
    const response = await fetch(`${this.baseUrl}/v1/compress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`headroom /v1/compress failed: HTTP ${response.status} ${detail}`)
    }
    return (await response.json()) as HeadroomCompressResponse
  }

  /** Restore original content from the CCR store by its hash. */
  async retrieve(hash: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`headroom /v1/retrieve failed: HTTP ${response.status} ${detail}`)
    }
    return response.json()
  }
}
