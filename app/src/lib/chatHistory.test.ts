import { describe, expect, it } from 'vitest'
import { chatDestination, historyForSend } from './chatHistory'

const earlier = [
  { role: 'user' as const, content: 'My period is 9 days late.' },
  { role: 'assistant' as const, content: 'Here is what can delay a period…' },
]

describe('chat history goes only to the provider that received it', () => {
  it('the same provider and base URL: the earlier messages go with the next question', () => {
    const to = chatDestination('anthropic')
    expect(historyForSend({ destination: to, messages: earlier }, chatDestination('anthropic', ''))).toEqual({ messages: earlier, cleared: false })
    const custom = chatDestination('openai', 'https://llm.example.org/v1/')
    expect(historyForSend({ destination: custom, messages: earlier }, chatDestination('openai', 'https://LLM.example.org/v1'))).toEqual({ messages: earlier, cleared: false })
  })

  it('another provider: a new chat, nothing earlier is sent', () => {
    const result = historyForSend({ destination: chatDestination('publik'), messages: earlier }, chatDestination('anthropic'))
    expect(result).toEqual({ messages: [], cleared: true })
  })

  it('the same provider with another base URL: a new chat, nothing earlier is sent', () => {
    const from = chatDestination('openai')
    const result = historyForSend({ destination: from, messages: earlier }, chatDestination('openai', 'https://llm.example.org/v1'))
    expect(result).toEqual({ messages: [], cleared: true })
  })

  it('an empty chat starts with no notice', () => {
    expect(historyForSend({ destination: null, messages: [] }, chatDestination('openai'))).toEqual({ messages: [], cleared: false })
  })

  it('history kept from an unknown provider is never sent', () => {
    expect(historyForSend({ destination: null, messages: earlier }, chatDestination('publik'))).toEqual({ messages: [], cleared: true })
  })
})
