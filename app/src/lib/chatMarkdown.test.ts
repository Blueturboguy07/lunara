import { describe, expect, it } from 'vitest'
import { chatPlainText, parseChatInline, parseChatMarkdown } from './chatMarkdown'

describe('AI answers: safe Markdown subset (blind test M5)', () => {
  it('turns **bold** into a bold run and removes the markers', () => {
    expect(parseChatInline('Track **cramps** and **mood** daily.')).toEqual([
      { text: 'Track ' },
      { text: 'cramps', bold: true },
      { text: ' and ' },
      { text: 'mood', bold: true },
      { text: ' daily.' },
    ])
  })

  it('reads __bold__, *italic* and _italic_', () => {
    expect(parseChatInline('__Note:__ this is *only* an _estimate_')).toEqual([
      { text: 'Note:', bold: true },
      { text: ' this is ' },
      { text: 'only', italic: true },
      { text: ' an ' },
      { text: 'estimate', italic: true },
    ])
  })

  it('never shows a marker that does not close (a cut answer)', () => {
    const runs = parseChatInline('Drink water **and rest')
    expect(runs.map((run) => run.text).join('')).toBe('Drink water and rest')
    expect(runs.some((run) => run.text.includes('**'))).toBe(false)
  })

  it('keeps snake_case words and 2*3 as they are', () => {
    expect(parseChatInline('cycle_day is 2*3')).toEqual([{ text: 'cycle_day is 2*3' }])
  })

  it('shows code as plain text and a link as "text (url)", not as an anchor', () => {
    expect(parseChatInline('Use `Settings` or see [ACOG](https://www.acog.org)')).toEqual([
      { text: 'Use Settings or see ACOG (https://www.acog.org)' },
    ])
  })

  it('keeps HTML in an answer as text (the chat never parses HTML)', () => {
    const blocks = parseChatMarkdown('<img src=x onerror=alert(1)> **hi**')
    expect(blocks).toEqual([
      {
        kind: 'paragraph',
        lines: [[{ text: '<img src=x onerror=alert(1)> ' }, { text: 'hi', bold: true }]],
      },
    ])
  })

  it('makes bullet lists, numbered lists, headings and paragraphs', () => {
    const answer = [
      '## What can help',
      '',
      'A few ideas:',
      '- **Heat** on your belly',
      '* Gentle movement',
      '• Rest',
      '',
      '1. Log the pain',
      '2) Note the day',
      '   of your cycle',
      '',
      '---',
      'See a clinician if pain is severe.',
    ].join('\n')
    expect(parseChatMarkdown(answer)).toEqual([
      { kind: 'heading', line: [{ text: 'What can help' }] },
      { kind: 'paragraph', lines: [[{ text: 'A few ideas:' }]] },
      {
        kind: 'bullets',
        items: [
          [{ text: 'Heat', bold: true }, { text: ' on your belly' }],
          [{ text: 'Gentle movement' }],
          [{ text: 'Rest' }],
        ],
      },
      {
        kind: 'numbers',
        start: 1,
        items: [[{ text: 'Log the pain' }], [{ text: 'Note the day' }, { text: ' ' }, { text: 'of your cycle' }]],
      },
      { kind: 'paragraph', lines: [[{ text: 'See a clinician if pain is severe.' }]] },
    ])
  })

  it('keeps line breaks inside a paragraph', () => {
    expect(parseChatMarkdown('Line one\nLine two')).toEqual([
      { kind: 'paragraph', lines: [[{ text: 'Line one' }], [{ text: 'Line two' }]] },
    ])
  })

  it('gives plain text without any Markdown marker', () => {
    const plain = chatPlainText('**Tip:** rest\n\n- one\n- **two**\n\n3. three')
    expect(plain).toBe('Tip: rest\n\n• one\n• two\n\n3. three')
    expect(plain).not.toMatch(/\*\*|__/)
  })
})
