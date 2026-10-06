/**
 * Serialized proxy restart queue: an older spawn can never kill a newer restart
 * that reused it, and ownership follows the restart that actually spawned it.
 */

import type { HeadroomService } from './service.ts'
import {
  emptyProxyStatus,
  type HeadroomProxyStatus,
} from './proxy-status.ts'

export interface LifecycleHooks {
  getLaunchKey: () => string
  getBaseUrl: () => string
  start: () => Promise<HeadroomService>
  setClient: (client: HeadroomService['client']) => void
  setStatus: (status: HeadroomProxyStatus) => void
  onRestartError: (error: unknown) => void
  prewarm?: (client: NonNullable<HeadroomService['client']>) => void
}

/** Testable core of installProxyLifecycle. */
export function createProxyLifecycle(hooks: LifecycleHooks): {
  restart: () => void
  dispose: () => void
  /** Exposed for tests: wait until the serialized queue drains. */
  idle: () => Promise<void>
} {
  let current: { dispose: () => void } | undefined
  let generation = 0
  let queue: Promise<void> = Promise.resolve()
  let lastLaunchKey = ''

  const restart = (): void => {
    queue = queue.then(async () => {
      const id = ++generation
      const baseUrl = hooks.getBaseUrl()
      hooks.setStatus({
        ...emptyProxyStatus(baseUrl),
        phase: 'starting',
        updatedAt: Date.now(),
      })
      const launchKey = hooks.getLaunchKey()
      // A launch-shape change must replace the running proxy even when it
      // is healthy (e.g. switching the Python interpreter); otherwise the
      // reused service would keep the old interpreter forever.
      if (launchKey !== lastLaunchKey && current !== undefined) {
        current.dispose()
        current = undefined
      }
      lastLaunchKey = launchKey
      const started = await hooks.start()
      if (id !== generation) {
        started.dispose()
        return
      }
      if (started.client !== undefined) {
        hooks.prewarm?.(started.client)
      }
      if (started.reused) {
        // An already-healthy proxy keeps the previous owner's dispose.
        hooks.setClient(started.client)
        hooks.setStatus({
          phase: started.client !== undefined ? 'ready' : 'down',
          baseUrl,
          clientPresent: started.client !== undefined,
          healthy: started.client !== undefined,
          healthReason: started.client !== undefined ? 'ok' : null,
          httpStatus: started.client !== undefined ? 200 : null,
          lastError: started.error,
          updatedAt: Date.now(),
        })
        return
      }
      current?.dispose()
      hooks.setClient(started.client)
      current = { dispose: started.dispose }
      hooks.setStatus({
        phase: started.client !== undefined ? 'ready' : 'down',
        baseUrl,
        clientPresent: started.client !== undefined,
        healthy: started.client !== undefined,
        healthReason: started.client !== undefined ? 'ok' : null,
        httpStatus: started.client !== undefined ? 200 : null,
        lastError: started.error,
        updatedAt: Date.now(),
      })
    }).catch((error: unknown) => {
      // A failed restart must not break later ones: keep the queue alive.
      hooks.onRestartError(error)
      hooks.setClient(undefined)
      hooks.setStatus({
        ...emptyProxyStatus(hooks.getBaseUrl()),
        phase: 'down',
        clientPresent: false,
        healthy: false,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      })
    })
  }

  return {
    restart,
    dispose: () => {
      generation += 1
      current?.dispose()
      current = undefined
      hooks.setClient(undefined)
      hooks.setStatus({
        ...emptyProxyStatus(hooks.getBaseUrl()),
        phase: 'down',
        lastError: 'plugin unloaded',
        updatedAt: Date.now(),
      })
    },
    idle: () => queue.then(() => undefined),
  }
}
