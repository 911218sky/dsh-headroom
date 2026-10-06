/**
 * Host live-scope adapter: no settings.register; flatten Config and write via mutate.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  createHeadroomLiveScope,
  flattenHeadroomSettings,
  HEADROOM_ENTRY_ID,
  installHeadroomSettingsPresentation,
} from '../src/settings-scope.ts'

describe('flattenHeadroomSettings', () => {
  it('maps nested Config into the flat card/command shape', () => {
    expect(
      flattenHeadroomSettings({
        headroom: { command: '/bin/headroom', port: 9000, autoInstall: false },
        resultCompression: { enabled: true, thresholdChars: 4096 },
      }),
    ).toEqual({
      command: '/bin/headroom',
      pythonPath: undefined,
      uvCommand: undefined,
      port: 9000,
      baseUrl: undefined,
      autoInstall: false,
      resultCompressionEnabled: true,
      resultCompressionThresholdChars: 4096,
    })
  })
})

describe('createHeadroomLiveScope', () => {
  it('reads composition config when describe is empty', () => {
    const ctx = {
      settings: { describe: () => [] },
      on: undefined,
    } as unknown as Context
    const scope = createHeadroomLiveScope(ctx, {
      headroom: { port: 8787, autoInstall: true },
      resultCompression: { enabled: false },
    })
    expect(scope.get().port).toBe(8787)
    expect(scope.get().autoInstall).toBe(true)
    expect(scope.get().resultCompressionEnabled).toBe(false)
  })

  it('prefers describe() value for the dsh-headroom entry', () => {
    const ctx = {
      settings: {
        describe: () => [{
          ns: HEADROOM_ENTRY_ID,
          value: {
            headroom: { port: 9999 },
            resultCompression: { enabled: true, thresholdChars: 100 },
          },
          revision: 3,
        }],
      },
    } as unknown as Context
    const scope = createHeadroomLiveScope(ctx, { headroom: { port: 8787 } })
    expect(scope.get().port).toBe(9999)
    expect(scope.get().resultCompressionThresholdChars).toBe(100)
  })

  it('writes flat patches as nested mutate ops', async () => {
    const mutate = vi.fn(async () => undefined)
    const ctx = {
      settings: {
        describe: () => [{ ns: HEADROOM_ENTRY_ID, revision: 2 }],
        mutate,
      },
    } as unknown as Context
    const scope = createHeadroomLiveScope(ctx, {})
    await scope.update({ port: 9000, resultCompressionEnabled: false })
    expect(mutate).toHaveBeenCalledWith(
      HEADROOM_ENTRY_ID,
      [
        { op: 'set', path: ['headroom', 'port'], value: 9000 },
        { op: 'set', path: ['resultCompression', 'enabled'], value: false },
      ],
      2,
    )
  })

  it('unsets through nested mutate paths', async () => {
    const mutate = vi.fn(async () => undefined)
    const ctx = {
      settings: {
        describe: () => [{ ns: HEADROOM_ENTRY_ID, revision: 1 }],
        mutate,
      },
    } as unknown as Context
    const scope = createHeadroomLiveScope(ctx, {})
    await scope.unset('command')
    expect(mutate).toHaveBeenCalledWith(
      HEADROOM_ENTRY_ID,
      [{ op: 'unset', path: ['headroom', 'command'] }],
      1,
    )
  })

  it('does not call settings.register', () => {
    const register = vi.fn()
    const ctx = {
      settings: {
        register,
        describe: () => [],
        configure: undefined,
      },
    } as unknown as Context
    createHeadroomLiveScope(ctx, {})
    expect(register).not.toHaveBeenCalled()
  })
})

describe('installHeadroomSettingsPresentation', () => {
  it('registers configure({ auto: true }) when available', () => {
    const dispose = vi.fn()
    const configure = vi.fn(() => dispose)
    const effect = vi.fn((install: () => unknown) => {
      install()
      return () => undefined
    })
    const ctx = {
      fiber: {},
      effect,
      settings: { configure },
    } as unknown as Context
    installHeadroomSettingsPresentation(ctx)
    expect(configure).toHaveBeenCalledWith({ auto: true }, ctx.fiber)
  })

  it('no-ops when configure is missing (does not throw)', () => {
    const ctx = {
      effect: vi.fn(),
      settings: {},
    } as unknown as Context
    expect(() => installHeadroomSettingsPresentation(ctx)).not.toThrow()
  })
})
