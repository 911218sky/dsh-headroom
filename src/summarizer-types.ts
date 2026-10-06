/**
 * Local mirrors of BasicCompactionEngine's summarizer types.
 *
 * `@deepseek-ai/dsh-compaction-basic` does not re-export these from the
 * package root, and the old deep path (`…/src/summarizer.ts`) is not shipped
 * in the published package. Structural typing keeps the override compatible.
 */

import type { ContentBlock, Message, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'

/** Replayed conversation surface the summarizer condenses. */
export interface SummarizationInput {
  readonly tools?: readonly ToolSchema[]
  /** System head (when present) followed by the shadowed region in surface order. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  usage?: TokenUsage
} & (
  | {
    rawOutput: ContentBlock[]
    llmStreamCall: true
  }
  | {
    rawOutput?: ContentBlock[]
    llmStreamCall?: never
  }
)
