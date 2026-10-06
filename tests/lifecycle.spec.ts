/**
 * Serialized proxy lifecycle: queue, generation discard, and status updates.
 */

import { describe, expect, it, vi } from 'vitest'
import { createProxyLifecycle } from '../src/proxy-lifecycle.ts'
import type { HeadroomService } from '../src/service.ts'
import type { HeadroomProxyStatus } from '../src/proxy-status.ts'
import { HeadroomClient } from '../src/client.ts'
import { classifyHealthError } from '../src/proxy-status.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeService(partial: Partial<HeadroomService> = {}): HeadroomService {
  return {
    client: undefined,
    dispose: vi.fn(),
    reused: false,
    error: null,
    ...partial,
  }
}

describe('classifyHealthError', () => {
  it('classifies timeouts, refused, and http status', () => {
    expect(classifyHealthError(undefined, 503).reason).toBe('http_status')
    expect(classifyHealthError(new Error('connect ECONNREFUSED 127.0.0.1:8787')).reason).toBe('refused')
    expect(classifyHealthError(new Error('The operation was aborted due to timeout')).reason).toBe('timeout')
  })
})

describe('createProxyLifecycle', () => {
  it('serializes restarts and publishes ready status', async () => {
    const statuses: HeadroomProxyStatus[] = []
    const clients: Array<HeadroomService['client']> = []
    const first = deferred<HeadroomService>()
    const second = deferred<HeadroomService>()
    let startCount = 0
    const lifecycle = createProxyLifecycle({
      getLaunchKey: () => 'k1',
      getBaseUrl: () => 'http://127.0.0.1:8787',
      start: async () => {
        startCount += 1
        return startCount === 1 ? first.promise : second.promise
      },
      setClient: (client) => { clients.push(client) },
      setStatus: (status) => { statuses.push(status) },
      onRestartError: vi.fn(),
    })

    lifecycle.restart()
    lifecycle.restart()
    expect(startCount).toBe(0)
    await Promise.resolve()
    expect(startCount).toBe(1)

    const client = { baseUrl: 'http://127.0.0.1:8787' } as HeadroomClient
    first.resolve(fakeService({ client, reused: false }))
    await vi.waitFor(() => expect(startCount).toBe(2))
    expect(clients.at(-1)).toBe(client)
    expect(statuses.some((row) => row.phase === 'ready')).toBe(true)

    second.resolve(fakeService({ client: undefined, reused: false, error: 'proxy down' }))
    await lifecycle.idle()
    expect(clients.at(-1)).toBeUndefined()
    expect(statuses.at(-1)?.phase).toBe('down')
    expect(statuses.at(-1)?.lastError).toBe('proxy down')
  })

  it('discards a stale spawn when a newer generation wins', async () => {
    const disposed: string[] = []
    const first = deferred<HeadroomService>()
    let launchKey = 'a'
    const lifecycle = createProxyLifecycle({
      getLaunchKey: () => launchKey,
      getBaseUrl: () => 'http://127.0.0.1:8787',
      start: async () => {
        if (launchKey === 'a') return first.promise
        return fakeService({
          client: { baseUrl: 'http://127.0.0.1:8787' } as HeadroomClient,
          reused: false,
        })
      },
      setClient: vi.fn(),
      setStatus: vi.fn(),
      onRestartError: vi.fn(),
    })

    lifecycle.restart()
    await Promise.resolve()
    launchKey = 'b'
    lifecycle.restart()
    first.resolve(fakeService({
      dispose: () => { disposed.push('stale') },
      reused: false,
      client: { baseUrl: 'http://127.0.0.1:8787' } as HeadroomClient,
    }))
    await lifecycle.idle()
    expect(disposed).toEqual(['stale'])
  })

  it('keeps the queue alive after a failed restart', async () => {
    const errors: unknown[] = []
    const clients: Array<HeadroomService['client']> = []
    let startCount = 0
    const lifecycle = createProxyLifecycle({
      getLaunchKey: () => 'k',
      getBaseUrl: () => 'http://127.0.0.1:8787',
      start: async () => {
        startCount += 1
        if (startCount === 1) throw new Error('boom')
        return fakeService({
          client: { baseUrl: 'http://127.0.0.1:8787' } as HeadroomClient,
          reused: false,
        })
      },
      setClient: (client) => { clients.push(client) },
      setStatus: vi.fn(),
      onRestartError: (error) => { errors.push(error) },
    })

    lifecycle.restart()
    await lifecycle.idle()
    expect(errors).toHaveLength(1)
    expect(clients.at(-1)).toBeUndefined()

    lifecycle.restart()
    await lifecycle.idle()
    expect(clients.at(-1)).toBeTruthy()
  })
})
