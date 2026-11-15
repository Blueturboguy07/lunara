import type { AssistantProvider, ChatMessage } from './assistant'

/**
 * Lunara AI sends the earlier messages of a chat with every question. Those
 * messages can hold health details, so they go only to the provider that
 * already received them. When the provider or its base URL changes, the chat
 * starts again and nothing earlier is sent to the new provider.
 */

/** Where a chat goes: the provider and, for a provider with its own base URL, that URL. */
export function chatDestination(provider: AssistantProvider, baseUrl?: string): string {
  const url = provider === 'publik' ? '' : (baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
  return `${provider}|${url}`
}

export interface Conversation {
  /** chatDestination() of the provider that received these messages; null for an empty chat. */
  destination: string | null
  messages: ChatMessage[]
}

/** The earlier messages that go with the next question to `destination`. cleared: the chat started again. */
export function historyForSend(conversation: Conversation, destination: string): { messages: ChatMessage[]; cleared: boolean } {
  if (conversation.messages.length === 0 || conversation.destination === destination) {
    return { messages: conversation.messages, cleared: false }
  }
  return { messages: [], cleared: true }
}

export const NEW_CHAT_NOTICE = 'The AI provider changed, so Lunara AI started a new chat. The earlier messages were not sent to the new provider.'

/** The chat lives only in memory: say so clearly (blind test L10: the chat was gone after a relaunch). */
export const CHAT_NOT_SAVED = 'Chats are not saved. Lunara AI forgets this chat when you close the app.'
