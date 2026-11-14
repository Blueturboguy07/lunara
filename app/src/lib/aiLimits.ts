/**
 * How much Lunara AI sends with one message. The sender (lib/assistant.ts), the
 * tracker context (lib/assistantContext.ts) and the agreement screen
 * (lib/healthConsent.ts) all read these numbers, so the screen always says
 * what the code sends.
 */
export const AI_LIMITS = {
  /** The message and the earlier messages of the chat, at most this many. */
  chatMessages: 16,
  /** Each of those messages is cut at this many characters. */
  messageChars: 6_000,
  /** Cycle summary: the last period start dates. */
  periodStarts: 8,
  /** Symptoms and mood, and fertility observations: the most recent logged days. */
  loggedDays: 30,
  /** Private notes: the most recent notes. */
  notes: 12,
  /** Each note is cut at this many characters. */
  noteChars: 400,
} as const
