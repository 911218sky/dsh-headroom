/**
 * Headroom settings card using DSH SettingsForm / SettingsValueField /
 * Checkbox — same chrome as official settings plugins, no plugin CSS.
 */

import { useEffect, useState } from 'react'
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

type ProxyUiPhase = 'checking' | 'ready' | 'starting' | 'down'

function resolveProbeUrl(state: HeadroomCardState): string {
  const explicit = state.baseUrl.text.trim()
  if (explicit.length > 0) return explicit.replace(/\/$/, '')
  const portText = state.port.text.trim()
  const port = portText.length > 0 ? Number(portText) : 8787
  const safePort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8787
  return `http://127.0.0.1:${safePort}`
}

function ProxyStatusRow({
  state,
  t,
}: {
  state: HeadroomCardState
  t: (key: HeadroomKey) => string
}) {
  const [phase, setPhase] = useState<ProxyUiPhase>('checking')
  const [detail, setDetail] = useState<string | null>(null)
  const probeUrl = resolveProbeUrl(state)

  useEffect(() => {
    let cancelled = false
    setPhase('checking')
    setDetail(null)
    void (async () => {
      try {
        const response = await fetch(`${probeUrl}/health`, {
          signal: AbortSignal.timeout(2_000),
        })
        if (cancelled) return
        if (response.ok) {
          setPhase('ready')
          setDetail(probeUrl)
          return
        }
        setPhase('down')
        setDetail(`HTTP ${response.status}`)
      } catch (error) {
        if (cancelled) return
        setPhase('down')
        setDetail(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { cancelled = true }
  }, [probeUrl, state.baseUrl.text, state.port.text])

  const label = phase === 'ready'
    ? t('proxyStatusReady')
    : phase === 'checking'
      ? t('proxyStatusChecking')
      : phase === 'starting'
        ? t('proxyStatusStarting')
        : t('proxyStatusDown')

  return (
    <div style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.45 }}>
      <div>
        <strong>{t('proxyStatusLabel')}:</strong>
        {' '}
        {label}
        {detail !== null && detail.length > 0 ? ` — ${detail}` : ''}
      </div>
      <div style={{ opacity: 0.75, marginTop: 4 }}>{t('proxyStatusHint')}</div>
    </div>
  )
}

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
      <ProxyStatusRow state={state} t={t} />

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
