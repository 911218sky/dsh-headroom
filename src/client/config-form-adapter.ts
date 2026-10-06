/**
 * Present nested plugin Config as a flat SettingsFormScope for DSH's
 * SettingsFormModel (which mutates with path: [field] only).
 */

import type { HeadroomSettings } from '../settings-scope.ts'

/** Minimal ConfigForm surface from dsh-client-ui-settings. */
export interface ConfigFormLike<T> {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: T | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable: boolean
    mode: 'host' | 'memory'
  }
  subscribe(listener: () => void): () => void
  mutate(
    ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>,
    expectedRevision?: number,
  ): Promise<boolean>
}

/** Nested plugin Config slice the Host form mirrors. */
export interface NestedHeadroomConfig {
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

/** SettingsFormScope-shaped face SettingsFormModel expects. */
export interface FlatSettingsFormScope {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: HeadroomSettings | undefined
    base: unknown
    user: unknown
    revision: number | undefined
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  mutate(
    ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>,
    expectedRevision?: number,
  ): Promise<boolean>
}

function nestedPath(field: string): string[] {
  switch (field) {
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
      return ['headroom', field]
    default:
      return [field]
  }
}

function flatten(value: NestedHeadroomConfig | undefined): HeadroomSettings | undefined {
  if (value === undefined) return undefined
  return {
    command: value.headroom?.command,
    pythonPath: value.headroom?.pythonPath,
    uvCommand: value.headroom?.uvCommand,
    port: value.headroom?.port,
    baseUrl: value.headroom?.baseUrl,
    autoInstall: value.headroom?.autoInstall,
    resultCompressionEnabled: value.resultCompression?.enabled,
    resultCompressionThresholdChars: value.resultCompression?.thresholdChars,
  }
}

function flattenLayer(layer: unknown): unknown {
  if (layer === undefined || layer === null || typeof layer !== 'object') return layer
  return flatten(layer as NestedHeadroomConfig)
}

/** Adapt ConfigForm&lt;nested Config&gt; into the flat scope SettingsFormModel uses. */
export function flatSettingsFormScope(
  form: ConfigFormLike<NestedHeadroomConfig>,
): FlatSettingsFormScope {
  return {
    getSnapshot() {
      const snap = form.getSnapshot()
      return {
        status: snap.status,
        value: flatten(snap.value),
        base: flattenLayer(snap.base),
        user: flattenLayer(snap.user),
        revision: snap.revision,
        writable: snap.writable,
      }
    },
    subscribe(listener) {
      return form.subscribe(listener)
    },
    mutate(ops, expectedRevision) {
      const nested = ops.map((op) => {
        const field = op.path[0]
        const path = typeof field === 'string' ? nestedPath(field) : [...op.path]
        return op.op === 'set'
          ? { op: 'set' as const, path, value: op.value }
          : { op: 'unset' as const, path }
      })
      return form.mutate(nested, expectedRevision)
    },
  }
}
