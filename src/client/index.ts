/**
 * dsh-headroom, browser half: registers the Headroom settings card into the
 * settings plugin section. On DSH 0.2 the card binds the profile entry through
 * `configForms.get('dsh-headroom')` (SettingsForms); older `settingsScope`
 * / `settings.register` are gone.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './slots.ts'
import { flatScopeFromConfigForm, type ConfigFormLike, type NestedHeadroomConfig } from './config-form-adapter.ts'
import { HeadroomCard } from './HeadroomCard.tsx'
import { HeadroomCardController, HEADROOM_NS } from './headroom-card-controller.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-headroom'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms'] as const

/** Structural view of the client services this entry needs. */
interface ClientFace {
  locale: { register(ns: string, dicts: unknown): () => void }
  slots: {
    inject(slotName: string, factory: () => unknown): () => void
    register(options: unknown, component: unknown): () => void
  }
  configForms?: {
    get(entryId: string): ConfigFormLike<NestedHeadroomConfig> | undefined
  }
}

/**
 * Mount the Headroom settings card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const face = ctx as unknown as ClientFace
  ctx.effect(() => face.locale.register(NS, { zh, en }), 'dsh-headroom: dictionaries')

  const form = face.configForms?.get?.(HEADROOM_NS)
  if (form === undefined) {
    // Headless probes / older profiles: skip the card rather than crash load.
    return
  }

  const controller = new HeadroomCardController(flatScopeFromConfigForm(form) as never)
  ctx.effect(() => () => controller.dispose(), 'dsh-headroom: card controller lifetime')

  face.slots.inject('settings.plugin.item', function* () {
    yield face.slots.register(
      {
        name: 'settings.plugin.item',
        // Pair the card to the profile entry id SettingsForms serves.
        key: HEADROOM_NS,
        locale: NS,
        inject: () => controller.inject(),
      },
      HeadroomCard,
    )
  })
}
