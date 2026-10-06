/**
 * Headroom settings card using DSH SettingsForm / SettingsValueField /
 * Checkbox — same chrome as official settings plugins, no plugin CSS.
 */

import {
  Checkbox,
  SettingsForm,
  SettingsValueField,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slots.ts'
import type { HeadroomCardFace, HeadroomCardState } from './headroom-card-controller.ts'
import type { HeadroomKey } from './locales.ts'

/** Props the renderer binds for the Headroom settings card. */
export type HeadroomCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'dsh-headroom'>
  & InjectFace<HeadroomCardFace>

function formLabels(t: (key: HeadroomKey) => string) {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

const TEXT_FIELDS: Array<{
  field: keyof Pick<HeadroomCardState, 'command' | 'pythonPath' | 'uvCommand' | 'port' | 'baseUrl' | 'resultCompressionThresholdChars'>
  label: HeadroomKey
  hint: HeadroomKey
  invalid: HeadroomKey
  numeric?: boolean
  placeholder?: HeadroomKey
}> = [
  { field: 'command', label: 'commandLabel', hint: 'commandHint', invalid: 'invalidText', placeholder: 'commandPlaceholder' },
  { field: 'pythonPath', label: 'pythonPathLabel', hint: 'pythonPathHint', invalid: 'invalidText', placeholder: 'pythonPathPlaceholder' },
  { field: 'uvCommand', label: 'uvCommandLabel', hint: 'uvCommandHint', invalid: 'invalidText', placeholder: 'uvCommandPlaceholder' },
  { field: 'port', label: 'portLabel', hint: 'portHint', invalid: 'invalidPort', numeric: true, placeholder: 'portPlaceholder' },
  { field: 'baseUrl', label: 'baseUrlLabel', hint: 'baseUrlHint', invalid: 'invalidText', placeholder: 'baseUrlPlaceholder' },
  {
    field: 'resultCompressionThresholdChars',
    label: 'thresholdLabel',
    hint: 'thresholdHint',
    invalid: 'invalidThreshold',
    numeric: true,
    placeholder: 'thresholdPlaceholder',
  },
]

/**
 * Render the Headroom settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the form, or a summary one-liner when the Plugins page asks.
 */
export function HeadroomCard(props: HeadroomCardProps) {
  const { t } = props
  const state = props.useHeadroomCard((snapshot) => snapshot)

  // plugins.item pages pass view:"summary"; settings.plugin.item may omit it.
  if ('view' in props && (props as { view?: string }).view === 'summary') {
    return t('cardDescription')
  }
  if (!state.available) return null

  const disabled = !state.writable

  return (
    <SettingsForm
      labels={formLabels(t)}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {TEXT_FIELDS.map(({ field, label, hint, invalid, numeric, placeholder }) => (
        <SettingsValueField
          key={field}
          id={`dsh-headroom-${field}`}
          label={t(label)}
          hint={t(hint)}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t(invalid)}
          numeric={numeric}
          placeholder={placeholder === undefined ? undefined : t(placeholder)}
          disabled={disabled}
          {...state[field]}
          onEdit={(text) => props.edit(field, text)}
          onReset={() => props.resetField(field)}
        />
      ))}

      <Checkbox
        label={t('autoInstallLabel')}
        checked={state.autoInstall.text !== 'false'}
        disabled={disabled}
        onChange={(checked) => props.edit('autoInstall', checked ? 'true' : 'false')}
      />

      <Checkbox
        label={t('resultCompressionLabel')}
        checked={state.resultCompressionEnabled.text !== 'false'}
        disabled={disabled}
        onChange={(checked) => props.edit('resultCompressionEnabled', checked ? 'true' : 'false')}
      />
    </SettingsForm>
  )
}
