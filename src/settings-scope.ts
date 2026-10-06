/**
 * Live settings adapter for DSH 0.2+: SettingsForms replaced
 * `settings.register` / SettingsScope. Plugin config is the cordis entry
 * (`dsh-headroom`); this module flattens nested Config into the card/command
 * HeadroomSettings shape and writes back through describe/mutate.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_HEADROOM_PORT } from './service.ts'

/** Profile entry id — SettingsForms namespace on 0.2 hosts. */
export const HEADROOM_ENTRY_ID = 'dsh-headroom'

/** Settings namespace branded for command / describe lookups. */
export const HEADROOM_SETTINGS_NS = HEADROOM_ENTRY_ID as SettingsNamespace

/** Fields the settings card and /headroom command edit. */
export interface HeadroomSettings {
  /** Headroom executable path. */
  command?: string
  /**
   * Python interpreter path; when set, headroom runs as `python -m headroom`,
   * so the user can pin the Python version that serves the proxy.
   */
  pythonPath?: string
  /** uv executable path used when auto-installing headroom. */
  uvCommand?: string
  /** Proxy port for a spawned service. */
  port?: number
  /** Proxy base URL; empty reuses the port-derived default. */
  baseUrl?: string
  /** Auto-install headroom-ai via uv when the command is missing. */
  autoInstall?: boolean
  /** Tool-result compression switch; absent falls back to the composition layer. */
  resultCompressionEnabled?: boolean
  /** Tool-result compression threshold in characters; absent falls back to the composition layer. */
  resultCompressionThresholdChars?: number
}

/** Structural composition / describe value (avoids importing apply()'s Config). */
export interface HeadroomConfigSlice {
  headroom?: {
    command?: string
    pythonPath?: string
    uvCommand?: string
    port?: number
    baseUrl?: string
    autoInstall?: boolean
  }
  resultCompression?: {
    enabled?: boolean
    thresholdChars?: number
  }
}

/** Flat settings face used by proxy lifecycle, /headroom, and the card. */
export interface HeadroomLiveScope {
  get(): HeadroomSettings
  watch(listener: () => void): () => void
  update(patch: object): Promise<void>
  unset(key: string): Promise<void>
}

/** Path from a flat HeadroomSettings key to the nested Config document. */
function pathFor(key: string): readonly string[] {
  switch (key) {
    case 'resultCompressionEnabled':
      return ['resultCompression', 'enabled']
    case 'resultCompressionThresholdChars':
      return ['resultCompression', 'thresholdChars']
    case 'command':
    case 'pythonPath':
    case 'uvCommand':
    case 'port':
    case 'baseUrl':
    case 'autoInstall':
      return ['headroom', key]
    default:
      return [key]
  }
}

/** Flatten composition or describe() Config into HeadroomSettings. */
export function flattenHeadroomSettings(source: HeadroomConfigSlice | undefined): HeadroomSettings {
  const headroom = source?.headroom
  const result = source?.resultCompression
  return {
    command: headroom?.command,
    pythonPath: headroom?.pythonPath,
    uvCommand: headroom?.uvCommand,
    port: headroom?.port ?? DEFAULT_HEADROOM_PORT,
    baseUrl: headroom?.baseUrl,
    autoInstall: headroom?.autoInstall ?? true,
    resultCompressionEnabled: result?.enabled,
    resultCompressionThresholdChars: result?.thresholdChars,
  }
}

/** Structural slice of SettingsForms used by the adapter. */
interface SettingsFormsFace {
  configure?(presentation: { auto?: boolean }, owner?: unknown): () => void
  describe?(): Array<{ ns: string; value?: unknown; user?: unknown; revision?: number }>
  mutate?(
    ns: string,
    ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>,
    expectedRevision?: number,
  ): Promise<void>
  update?(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

function settingsOf(ctx: Context): SettingsFormsFace | undefined {
  return (ctx as unknown as { settings?: SettingsFormsFace }).settings
}

function readLiveConfig(ctx: Context, fallback: HeadroomConfigSlice): HeadroomConfigSlice {
  const settings = settingsOf(ctx)
  const descriptor = settings?.describe?.().find((entry) => entry.ns === HEADROOM_ENTRY_ID)
  if (descriptor?.value !== undefined && typeof descriptor.value === 'object' && descriptor.value !== null) {
    return descriptor.value as HeadroomConfigSlice
  }
  return fallback
}

/**
 * Enable auto-generated settings UI when SettingsForms.configure exists.
 */
export function installHeadroomSettingsPresentation(ctx: Context): void {
  const settings = settingsOf(ctx)
  if (typeof settings?.configure !== 'function') return
  ctx.effect(
    () => settings.configure!({ auto: true }, ctx.fiber),
    'dsh-headroom: settings presentation',
  )
}

/**
 * Build a live scope over the `dsh-headroom` profile entry.
 * Falls back to composition `config` when describe is unavailable.
 */
export function createHeadroomLiveScope(ctx: Context, config: HeadroomConfigSlice): HeadroomLiveScope {
  const get = (): HeadroomSettings => flattenHeadroomSettings(readLiveConfig(ctx, config))

  const watch = (listener: () => void): (() => void) => {
    const events = ctx as unknown as {
      on?(event: string, handler: (ns: unknown) => void): () => void
    }
    if (typeof events.on !== 'function') return () => undefined
    return events.on('settings/document-updated', (ns) => {
      if (String(ns) === HEADROOM_ENTRY_ID) listener()
    })
  }

  const mutate = async (
    ops: Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>,
  ): Promise<void> => {
    const settings = settingsOf(ctx)
    if (typeof settings?.mutate === 'function') {
      const descriptor = settings.describe?.().find((entry) => entry.ns === HEADROOM_ENTRY_ID)
      await settings.mutate(HEADROOM_ENTRY_ID, ops, descriptor?.revision)
      return
    }
    if (typeof settings?.update === 'function') {
      const patch: Record<string, unknown> = {}
      for (const op of ops) {
        if (op.op !== 'set') continue
        if (op.path.length === 1) {
          patch[op.path[0]!] = op.value
        } else if (op.path[0] === 'headroom') {
          const headroom = (patch.headroom as Record<string, unknown> | undefined) ?? {}
          headroom[op.path[1]!] = op.value
          patch.headroom = headroom
        } else if (op.path[0] === 'resultCompression') {
          const result = (patch.resultCompression as Record<string, unknown> | undefined) ?? {}
          result[op.path[1]!] = op.value
          patch.resultCompression = result
        }
      }
      await settings.update(HEADROOM_ENTRY_ID, patch)
    }
  }

  return {
    get,
    watch,
    async update(patch: object): Promise<void> {
      const ops = Object.entries(patch as Record<string, unknown>).map(([key, value]) => ({
        op: 'set' as const,
        path: pathFor(key),
        value,
      }))
      if (ops.length === 0) return
      await mutate(ops)
    },
    async unset(key: string): Promise<void> {
      await mutate([{ op: 'unset', path: pathFor(key) }])
    },
  }
}
