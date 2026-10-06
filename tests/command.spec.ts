/**
 * `/headroom` command semantics: argument parsing (show / set / unset), value
 * coercion by key kind, and host-side settings writes through the live scope.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { HeadroomCommandScope } from '../src/command.ts'
import { executeHeadroomCommand, parseHeadroomCommand } from '../src/command.ts'

const NS = 'dsh-headroom' as const

function makeScope(initial: Record<string, unknown> = {}) {
  const value: Record<string, unknown> = { ...initial }
  return {
    get: () => ({ ...value }),
    update: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(value, patch) }),
    unset: vi.fn(async (key: string) => { delete value[key] }),
  } as unknown as HeadroomCommandScope
}

function makeCtx() {
  return {} as unknown as Context
}

describe('parseHeadroomCommand', () => {
  it('shows settings without arguments', () => {
    expect(parseHeadroomCommand('')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('   ')).toEqual({ kind: 'show' })
  })

  it('parses typed set commands', () => {
    expect(parseHeadroomCommand('set port 9000')).toEqual({ kind: 'set', key: 'port', value: 9000 })
    expect(parseHeadroomCommand('set autoInstall false')).toEqual({ kind: 'set', key: 'autoInstall', value: false })
    expect(parseHeadroomCommand('set command C:/x/headroom.exe')).toEqual({
      kind: 'set', key: 'command', value: 'C:/x/headroom.exe',
    })
    expect(parseHeadroomCommand('set resultCompressionThresholdChars 4096')).toEqual({
      kind: 'set', key: 'resultCompressionThresholdChars', value: 4096,
    })
  })

  it('rejects malformed values and unknown keys as a show', () => {
    expect(parseHeadroomCommand('set port abc')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set port 70000')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set autoInstall yes')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set unknownKey 1')).toEqual({ kind: 'show' })
    expect(parseHeadroomCommand('set port')).toEqual({ kind: 'show' })
  })

  it('parses unset for known keys only', () => {
    expect(parseHeadroomCommand('unset port')).toEqual({ kind: 'unset', key: 'port' })
    expect(parseHeadroomCommand('unset unknownKey')).toEqual({ kind: 'show' })
  })
})

describe('executeHeadroomCommand', () => {
  it('shows the current settings', async () => {
    const scope = makeScope({ port: 8787, autoInstall: true })
    const result = await executeHeadroomCommand(makeCtx(), scope, NS, { kind: 'show' })
    expect(result.kind).toBe('success')
    const text = (result as { text: string }).text
    expect(text).toContain('"port": 8787')
    expect(text).toContain('Proxy status:')
    expect(text).toContain('/headroom always works')
  })

  it('writes a typed value host-side', async () => {
    const scope = makeScope()
    const result = await executeHeadroomCommand(makeCtx(), scope, NS, { kind: 'set', key: 'port', value: 9000 })
    expect(result.kind).toBe('success')
    expect(scope.update).toHaveBeenCalledWith({ port: 9000 })
  })

  it('clears a key through scope.unset', async () => {
    const scope = makeScope({ port: 9000, autoInstall: true })
    const result = await executeHeadroomCommand(makeCtx(), scope, NS, { kind: 'unset', key: 'port' })
    expect(result.kind).toBe('success')
    expect(scope.unset).toHaveBeenCalledWith('port')
  })

  it('reports scope failures as an error result', async () => {
    const scope = makeScope()
    scope.update = vi.fn(async () => { throw new Error('schema rejected') })
    const result = await executeHeadroomCommand(makeCtx(), scope, NS, { kind: 'set', key: 'port', value: 9000 })
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('schema rejected')
  })
})
