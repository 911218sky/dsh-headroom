/**
 * Minimal `@deepseek-ai/dsh-client-runtime/client` mock: only the snapshot-store
 * primitives the controller tests need. A vitest alias swaps the browser
 * closure bundle (`window.__ModuleLoader__`) for this loadable module.
 */

/** Subscribable snapshot container (minimal createSnapshotStore stand-in). */
export interface SnapshotStore<T> {
  getSnapshot(): T
  set(value: T): void
}

export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}
