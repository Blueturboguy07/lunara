/**
 * How much Lunara AI sends with one message. The payload (lib/aiPayload.ts)
 * and the AI chat screen (lib/healthConsent.ts) both read these numbers, so
 * the screen always says what the code sends.
 */
export const AI_LIMITS = {
  /** The message and the earlier messages of the chat, at most this many. */
  chatMessages: 16,
  /** Each of those messages is cut at this many characters. */
  messageChars: 6_000,
  /** Cycle summary: the last period starts (sent as "days ago"). */
  periodStarts: 8,
  /** Symptoms and mood, and fertility observations: the most recent logged days. */
  loggedDays: 30,
} as const
