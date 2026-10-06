/**
 * Client apply: card must register into keyed slot settings.plugin.item,
 * keyed by the profile entry id (`dsh-headroom`) that SettingsForms serves.
 */

import { describe, expect, it } from 'vitest'
import * as clientPlugin from '../src/client/index.ts'
import { HeadroomCardController } from '../src/client/headroom-card-controller.ts'
import type { HeadroomSettings } from '../src/client/headroom-card-controller.ts'
import type { FlatSettingsScope } from '../src/client/config-form-adapter.ts'
import type { ConfigFormLike, NestedHeadroomConfig } from '../src/client/config-form-adapter.ts'

/** Minimal flat scope stub for the controller smoke check. */
function stubScope(initial: HeadroomSettings = {}): FlatSettingsScope {
  let value: HeadroomSettings | undefined = { ...initial }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({
      status: 'ready',
      value,
      writable: true,
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, next) => {
      value = { ...value, [field]: next }
    },
    unset: async (field) => {
      value = { ...value }
      delete (value as Record<string, unknown>)[field]
    },
  }
}

function stubConfigForm(initial: NestedHeadroomConfig = {}): ConfigFormLike<NestedHeadroomConfig> {
  let value: NestedHeadroomConfig | undefined = { ...initial }
  const listeners = new Set<() => void>()
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
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async () => true,
    unset: async () => true,
    mutate: async () => true,
  }
}

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

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
    expect(registrations[0]?.options.locale).toBe('dsh-headroom')
    expect(typeof registrations[0]?.options.inject).toBe('function')
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

  it('inject face exposes the card snapshot and form actions', () => {
    const scope = stubScope({ port: 8787 })
    const controller = new HeadroomCardController(scope)
    const face = controller.inject()
    expect(face.hooks.headroomCard.getSnapshot().port).toBe('8787')
    expect(typeof face.save).toBe('function')
    expect(typeof face.discard).toBe('function')
  })
})
