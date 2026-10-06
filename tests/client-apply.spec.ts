/**
 * Client apply + flat SettingsFormScope adapter tests.
 */

import { describe, expect, it } from 'vitest'
import * as clientPlugin from '../src/client/index.ts'
import type { ConfigFormLike, NestedHeadroomConfig } from '../src/client/config-form-adapter.ts'
import { flatSettingsFormScope } from '../src/client/config-form-adapter.ts'

function stubConfigForm(initial: NestedHeadroomConfig = {}): ConfigFormLike<NestedHeadroomConfig> {
  const value: NestedHeadroomConfig | undefined = { ...initial }
  return {
    getSnapshot: () => ({
      status: 'ready',
      value,
      base: null,
      user: value,
      revision: 1,
      writable: true,
      mode: 'host',
    }),
    subscribe: () => () => undefined,
    mutate: async () => true,
  }
}

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

describe('flatSettingsFormScope', () => {
  it('flattens nested Config and remaps mutate paths', async () => {
    const ops: unknown[] = []
    const form: ConfigFormLike<NestedHeadroomConfig> = {
      getSnapshot: () => ({
        status: 'ready',
        value: {
          headroom: { command: '/bin/hr', port: 9000, autoInstall: true },
          resultCompression: { enabled: false, thresholdChars: 4096 },
        },
        base: {},
        user: {},
        revision: 2,
        writable: true,
        mode: 'host',
      }),
      subscribe: () => () => undefined,
      mutate: async (next) => {
        ops.push(...next)
        return true
      },
    }
    const scope = flatSettingsFormScope(form)
    expect(scope.getSnapshot().value).toEqual({
      command: '/bin/hr',
      pythonPath: undefined,
      uvCommand: undefined,
      port: 9000,
      baseUrl: undefined,
      autoInstall: true,
      resultCompressionEnabled: false,
      resultCompressionThresholdChars: 4096,
    })
    await scope.mutate([{ op: 'set', path: ['port'], value: 8787 }])
    expect(ops).toEqual([{ op: 'set', path: ['headroom', 'port'], value: 8787 }])
  })
})

describe('client apply', () => {
  it('registers the card into settings.plugin.item under the dsh-headroom key', () => {
    const registrations: Registration[] = []
    const localeNamespaces: string[] = []
    const formIds: string[] = []

    const ctx = {
      slots: {
        inject: (_name: string, generator: () => Iterator<unknown>) => {
          for (const _item of generator()) { /* captured via register */ }
        },
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      locale: {
        register: (namespace: string) => { localeNamespaces.push(namespace) },
      },
      configForms: {
        get: (entryId: string) => {
          formIds.push(entryId)
          return stubConfigForm({ headroom: { port: 8787 } })
        },
      },
      effect: (callback: () => void) => {
        callback()
        return () => {}
      },
    }

    clientPlugin.apply(ctx as never)

    expect(localeNamespaces).toEqual(['dsh-headroom'])
    expect(formIds).toEqual(['dsh-headroom'])
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.options.name).toBe('settings.plugin.item')
    expect(registrations[0]?.options.key).toBe('dsh-headroom')
  })

  it('skips the card when configForms is unavailable', () => {
    const registrations: Registration[] = []
    const ctx = {
      slots: {
        inject: () => {},
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      locale: { register: () => {} },
      effect: (callback: () => void) => {
        callback()
        return () => {}
      },
    }

    clientPlugin.apply(ctx as never)
    expect(registrations).toHaveLength(0)
  })
})
