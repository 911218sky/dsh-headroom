/**
 * Minimal SnapshotStore mock for node vitest — the real dsh-client-store
 * pulls browser peers (zustand/immer) that are not needed for controller unit tests.
 */

export interface SnapshotStore<T> {
  getSnapshot(): T
  set(next: T): void
  subscribe(listener: () => void): () => void
}

export function createSnapshotStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
