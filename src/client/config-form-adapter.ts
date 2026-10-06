/**
 * Wrap a 0.2 ConfigForm (nested Config document) as the flat HeadroomSettings
 * face the card controller already speaks (getSnapshot / set / unset).
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
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
  mutate(
    ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>,
    expectedRevision?: number,
  ): Promise<boolean>
}

/** Nested plugin Config slice the form mirrors. */
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

/** Flat settings-scope face expected by HeadroomCardController. */
export interface FlatSettingsScope {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    value: HeadroomSettings | undefined
    writable: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

function pathFor(field: string): string[] {
  switch (field) {
    case 'resultCompressionEnabled':
      return ['resultCompression', 'enabled']
    case 'resultCompressionThresholdChars':
    case 'thresholdChars':
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

/** Adapt ConfigForm&lt;nested Config&gt; into the flat scope the card controller uses. */
export function flatScopeFromConfigForm(
  form: ConfigFormLike<NestedHeadroomConfig>,
): FlatSettingsScope {
  return {
    getSnapshot() {
      const snap = form.getSnapshot()
      return {
        status: snap.status,
        value: flatten(snap.value),
        writable: snap.writable,
      }
    },
    subscribe(listener) {
      return form.subscribe(listener)
    },
    set(field, value) {
      const path = pathFor(field === 'thresholdChars' ? 'resultCompressionThresholdChars' : field)
      if (path.length === 1) return form.set(path[0]!, value)
      return form.mutate([{ op: 'set', path, value }])
    },
    unset(field) {
      const path = pathFor(field === 'thresholdChars' ? 'resultCompressionThresholdChars' : field)
      if (path.length === 1) return form.unset(path[0]!)
      return form.mutate([{ op: 'unset', path }])
    },
  }
}
