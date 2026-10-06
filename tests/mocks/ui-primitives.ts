/**
 * Minimal SettingsFormModel mock for node vitest — avoids loading the browser
 * primitives closure that pulls React DOM peers.
 */

export function settingsTextField(field: string) {
  return { field, format: () => '', parse: () => ({ kind: 'clear' as const }) }
}

export function settingsNumberField(field: string) {
  return { field, format: () => '', parse: () => ({ kind: 'clear' as const }) }
}

export class SettingsFormModel {
  bind(project: () => unknown) {
    const value = project()
    return {
      getSnapshot: () => value,
      set: () => undefined,
      subscribe: () => () => undefined,
    }
  }
  shell() {
    return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }
  }
  field() {
    return { text: '', overridden: false, invalid: false }
  }
  actions() {
    return {
      edit: () => undefined,
      resetField: () => undefined,
      save: () => undefined,
      discard: () => undefined,
    }
  }
  dispose() {}
}

export function SettingsForm() {
  return null
}

export function SettingsValueField() {
  return null
}

export function Checkbox() {
  return null
}
