/**
 * Settings card controller built on DSH SettingsFormModel — same pattern as
 * @deepseek-ai/dsh-client-ui-settings-shell. No custom CSS or hand-rolled
 * draft/save state.
 */

import {
  SettingsFormModel,
  settingsNumberField,
  settingsTextField,
  type SettingsFieldSpec,
  type SettingsFormShell,
  type SettingsFieldState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { FlatSettingsFormScope } from './config-form-adapter.ts'

/** Profile entry id — SettingsForms / configForms key on DSH 0.2. */
export const HEADROOM_NS = 'dsh-headroom'

/** Boolean field as draft text for SettingsFormModel (no built-in boolean helper). */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (value === true ? 'true' : value === false ? 'false' : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/** Port must be an integer in 1–65535 (schema default sits on the Host). */
function settingsPortField(): SettingsFieldSpec {
  return {
    field: 'port',
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return undefined
      return { kind: 'set', value: parsed }
    },
  }
}

const FIELD_SPECS: SettingsFieldSpec[] = [
  settingsTextField('command'),
  settingsTextField('pythonPath'),
  settingsTextField('uvCommand'),
  settingsPortField(),
  settingsTextField('baseUrl'),
  settingsBooleanField('autoInstall'),
  settingsBooleanField('resultCompressionEnabled'),
  settingsNumberField('resultCompressionThresholdChars'),
]

/** What the card renders through the snapshot store. */
export interface HeadroomCardState extends SettingsFormShell {
  command: SettingsFieldState
  pythonPath: SettingsFieldState
  uvCommand: SettingsFieldState
  port: SettingsFieldState
  baseUrl: SettingsFieldState
  autoInstall: SettingsFieldState
  resultCompressionEnabled: SettingsFieldState
  resultCompressionThresholdChars: SettingsFieldState
}

/** Slot inject face for the settings.plugin.item registration. */
export interface HeadroomCardFace {
  hooks: {
    headroomCard: SnapshotStore<HeadroomCardState>
  }
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
  save: () => void
  discard: () => void
}

export class HeadroomCardController {
  private readonly form: SettingsFormModel<Record<string, unknown>>
  private readonly store: SnapshotStore<HeadroomCardState>

  constructor(scope: FlatSettingsFormScope) {
    this.form = new SettingsFormModel(scope as never, FIELD_SPECS)
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): HeadroomCardState {
    return {
      ...this.form.shell(),
      command: this.form.field('command'),
      pythonPath: this.form.field('pythonPath'),
      uvCommand: this.form.field('uvCommand'),
      port: this.form.field('port'),
      baseUrl: this.form.field('baseUrl'),
      autoInstall: this.form.field('autoInstall'),
      resultCompressionEnabled: this.form.field('resultCompressionEnabled'),
      resultCompressionThresholdChars: this.form.field('resultCompressionThresholdChars'),
    }
  }

  inject(): HeadroomCardFace {
    return {
      hooks: { headroomCard: this.store },
      ...this.form.actions(),
    }
  }

  dispose(): void {
    this.form.dispose()
  }
}
