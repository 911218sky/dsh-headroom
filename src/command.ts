/**
 * `/headroom` human command: view or change the plugin's settings without the
 * browser card. The card depends on the harness settings-exposure allowlist,
 * which external plugins cannot extend; the command writes the same settings
 * entry host-side through SettingsForms, so it works on every harness version.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { HeadroomClient } from './client.ts'
import { renderProxyStatus, type HeadroomProxyStatus } from './proxy-status.ts'
import type { HeadroomSettings } from './settings-scope.ts'

const USAGE = 'Usage: /headroom (no args) | /headroom set <key> <value> | /headroom unset <key>'

/** Settings keys the command accepts, mapped to their value kinds. */
const KEY_KINDS: Record<string, 'number' | 'boolean' | 'string'> = {
  port: 'number',
  baseUrl: 'string',
  command: 'string',
  pythonPath: 'string',
  uvCommand: 'string',
  autoInstall: 'boolean',
  resultCompressionEnabled: 'boolean',
  resultCompressionThresholdChars: 'number',
}

/** One parsed command request. */
export type HeadroomCommand =
  | { kind: 'show' }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'unset'; key: string }

/**
 * Parse a `/headroom` raw input into a command request.
 * @param raw - the invocation's raw input (arguments only).
 * @returns the parsed request.
 */
export function parseHeadroomCommand(raw: string): HeadroomCommand {
  const tokens = raw.trim().split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return { kind: 'show' }
  const first = tokens[0]
  const key = tokens[1]
  if (first === 'unset' && tokens.length === 2 && key !== undefined && key in KEY_KINDS) {
    return { kind: 'unset', key }
  }
  if (first === 'set' && tokens.length >= 3 && key !== undefined && key in KEY_KINDS) {
    const value = parseValue(key, tokens.slice(2).join(' '))
    if (value !== undefined) return { kind: 'set', key, value }
  }
  return { kind: 'show' }
}

/** Parse one value string by the key's kind; `undefined` on malformed input. */
function parseValue(key: string, text: string): unknown {
  const kind = KEY_KINDS[key]
  if (kind === 'number') {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return undefined
    if (key === 'port' && (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)) return undefined
    if (key === 'resultCompressionThresholdChars' && (!Number.isInteger(parsed) || parsed < 1)) return undefined
    return parsed
  }
  if (kind === 'boolean') {
    if (text === 'true') return true
    if (text === 'false') return false
    return undefined
  }
  return text
}

/** Render the current resolved settings as the command's success text. */
export function renderSettings(settings: HeadroomSettings): string {
  return JSON.stringify(settings, null, 2)
}

/** The settings-scope surface the command writes through. */
export interface HeadroomCommandScope {
  get(): HeadroomSettings
  update(patch: object): Promise<void>
  unset(key: string): Promise<void>
}

type HeadroomCommandContext = Context & {
  headroomClient?: HeadroomClient
  headroomProxyStatus?: HeadroomProxyStatus
}

/** Build the show payload: settings JSON plus live proxy diagnostics. */
export async function renderHeadroomShow(
  ctx: HeadroomCommandContext,
  settings: HeadroomSettings,
): Promise<string> {
  const stored = ctx.headroomProxyStatus
  const client = ctx.headroomClient
  const baseUrl = stored?.baseUrl
    || settings.baseUrl
    || (settings.port !== undefined ? `http://127.0.0.1:${settings.port}` : '')
  let status: HeadroomProxyStatus = stored ?? {
    phase: client !== undefined ? 'ready' : 'down',
    baseUrl,
    clientPresent: client !== undefined,
    healthy: null,
    healthReason: null,
    httpStatus: null,
    lastError: null,
    updatedAt: Date.now(),
  }
  if (client !== undefined) {
    const probe = await client.probeHealth()
    status = {
      ...status,
      baseUrl: client.baseUrl,
      clientPresent: true,
      healthy: probe.ok,
      healthReason: probe.reason,
      httpStatus: probe.httpStatus,
      phase: probe.ok ? 'ready' : 'down',
      lastError: probe.ok ? status.lastError : (probe.detail ?? status.lastError),
      updatedAt: Date.now(),
    }
  } else {
    status = {
      ...status,
      clientPresent: false,
      healthy: false,
      phase: status.phase === 'starting' ? 'starting' : 'down',
      updatedAt: Date.now(),
    }
  }
  return [
    renderProxyStatus(status),
    '',
    'Current settings:',
    renderSettings(settings),
    '',
    'Tip: if the settings card is missing, the host WEB_SETTINGS_NAMESPACES allowlist may omit dsh-headroom — /headroom always works.',
  ].join('\n')
}

/** Execute one parsed command against the settings service and scope. */
export async function executeHeadroomCommand(
  ctx: Context,
  scope: HeadroomCommandScope,
  _ns: SettingsNamespace,
  command: HeadroomCommand,
): Promise<CommandResult> {
  try {
    if (command.kind === 'show') {
      const text = await renderHeadroomShow(ctx as HeadroomCommandContext, scope.get())
      return { kind: 'success', text }
    }
    if (command.kind === 'unset') {
      await scope.unset(command.key)
      return { kind: 'success', text: `Cleared ${command.key}; the composition default applies.` }
    }
    await scope.update({ [command.key]: command.value })
    return { kind: 'success', text: `Set ${command.key} = ${JSON.stringify(command.value)}.` }
  } catch (error: unknown) {
    return { kind: 'error', text: `Failed to update settings: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Register the `/headroom` command.
 * @param ctx - context carrying the command registry and settings service.
 * @param scope - the plugin's settings scope, written host-side.
 * @param ns - the plugin's settings namespace.
 */
export function installHeadroomCommand(
  ctx: Context,
  scope: HeadroomCommandScope,
  ns: SettingsNamespace,
): void {
  ctx.effect(() => ctx.commands.register({
    name: 'headroom',
    description: 'View or change Headroom compression settings',
    handler: (invocation: CommandInvocation): Promise<CommandResult> => {
      const command = parseHeadroomCommand(invocation.rawInput)
      if (command.kind === 'show' && invocation.rawInput.trim().length > 0) {
        return Promise.resolve({ kind: 'error', text: USAGE })
      }
      return executeHeadroomCommand(ctx, scope, ns, command)
    },
  }), 'dsh-headroom: command')
}
