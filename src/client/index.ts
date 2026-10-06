/**
 * dsh-headroom, browser half: settings card via DSH SettingsForm primitives
 * and configForms.get('dsh-headroom'). No plugin CSS modules.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './slots.ts'
import { flatSettingsFormScope, type ConfigFormLike, type NestedHeadroomConfig } from './config-form-adapter.ts'
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
  if (form === undefined) return

  const controller = new HeadroomCardController(flatSettingsFormScope(form))
  ctx.effect(() => () => controller.dispose(), 'dsh-headroom: card controller lifetime')

  face.slots.inject('settings.plugin.item', function* () {
    yield face.slots.register(
      {
        name: 'settings.plugin.item',
        key: HEADROOM_NS,
        locale: NS,
        inject: () => controller.inject(),
      },
      HeadroomCard,
    )
  })
}
