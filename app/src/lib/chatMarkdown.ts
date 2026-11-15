/**
 * A small, safe Markdown subset for AI answers (blind test M5: answers showed raw `**`).
 *
 * The parser returns plain data (blocks of text runs). The chat renders it with React
 * elements only, so no HTML from the answer ever reaches the page: `<b>` in an answer
 * stays the text "<b>". Supported:
 *   - paragraphs (a blank line between them) and line breaks inside a paragraph;
 *   - bullet lists ("- ", "* ", "+ ", "• ") and numbered lists ("1. ", "1) ");
 *   - headings ("# " to "###### "): shown as a bold line;
 *   - **bold** and __bold__, *italic* and _italic_, `code` (shown as plain text);
 *   - [text](https://link): shown as "text (https://link)", plain text, not a link.
 * Markers that do not close (for example a cut answer) are removed, never shown raw.
 */

export interface ChatRun {
  text: string
  bold?: true
  italic?: true
}

export type ChatLine = ChatRun[]

export type ChatBlock =
  | { kind: 'paragraph'; lines: ChatLine[] }
  | { kind: 'heading'; line: ChatLine }
  | { kind: 'bullets'; items: ChatLine[] }
  | { kind: 'numbers'; start: number; items: ChatLine[] }

const BULLET = /^\s{0,3}[-*+•]\s+(.*)$/
const NUMBER = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/

function pushRun(runs: ChatRun[], text: string, bold: boolean, italic: boolean): void {
  if (!text) return
  const last = runs.at(-1)
  if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) {
    last.text += text
    return
  }
  const run: ChatRun = { text }
  if (bold) run.bold = true
  if (italic) run.italic = true
  runs.push(run)
}

/** Text runs of one line: bold, italic and plain. */
export function parseChatInline(source: string): ChatLine {
  // Links become "text (url)"; images become their alt text. Plain text only.
  const text = source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_all, alt: string) => alt)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label: string, url: string) =>
      label === url ? url : `${label} (${url})`,
    )
  const runs: ChatRun[] = []
  let bold = false
  let italic = false
  let buffer = ''
  let i = 0
  const closes = (marker: string, from: number) => text.indexOf(marker, from) !== -1
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    const one = text[i]
    if (one === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        buffer += text.slice(i + 1, end)
        i = end + 1
        continue
      }
      i += 1
      continue
    }
    if (two === '**' || two === '__') {
      // Opens only when a closing marker follows; a lone marker is dropped.
      if (bold || closes(two, i + 2)) {
        pushRun(runs, buffer, bold, italic)
        buffer = ''
        bold = !bold
      }
      i += 2
      continue
    }
    if (one === '*' || one === '_') {
      const before = text[i - 1] ?? ' '
      const after = text[i + 1] ?? ' '
      // snake_case and 2*3 stay as they are: a marker sits next to a space or a line end.
      const wordInside = /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)
      const canOpen = !italic && after !== ' ' && closes(one, i + 1) && !wordInside
      const canClose = italic && before !== ' '
      if (canOpen || canClose) {
        pushRun(runs, buffer, bold, italic)
        buffer = ''
        italic = !italic
        i += 1
        continue
      }
    }
    buffer += one
    i += 1
  }
  pushRun(runs, buffer, bold, italic)
  return runs
}

/** Blocks of an AI answer. */
export function parseChatMarkdown(source: string): ChatBlock[] {
  const blocks: ChatBlock[] = []
  let paragraph: ChatLine[] = []
  let list: Extract<ChatBlock, { kind: 'bullets' } | { kind: 'numbers' }> | null = null

  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph })
    paragraph = []
  }
  const endList = () => {
    if (list) blocks.push(list)
    list = null
  }

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim() || RULE.test(line)) {
      endParagraph()
      endList()
      continue
    }
    const bullet = BULLET.exec(line)
    const number = bullet ? null : NUMBER.exec(line)
    const heading = bullet || number ? null : HEADING.exec(line)
    if (bullet) {
      endParagraph()
      if (list?.kind !== 'bullets') {
        endList()
        list = { kind: 'bullets', items: [] }
      }
      list.items.push(parseChatInline(bullet[1]))
    } else if (number) {
      endParagraph()
      if (list?.kind !== 'numbers') {
        endList()
        list = { kind: 'numbers', start: Number(number[1]), items: [] }
      }
      list.items.push(parseChatInline(number[2]))
    } else if (heading) {
      endParagraph()
      endList()
      blocks.push({ kind: 'heading', line: parseChatInline(heading[1]) })
    } else if (list && /^\s{2,}\S/.test(raw) && list.items.length) {
      // An indented line continues the last list item.
      const last = list.items[list.items.length - 1]
      last.push({ text: ' ' }, ...parseChatInline(line.trim()))
    } else {
      endList()
      paragraph.push(parseChatInline(line.trim()))
    }
  }
  endParagraph()
  endList()
  return blocks
}

/** The answer as plain text without Markdown markers (for copy and screen readers). */
export function chatPlainText(source: string): string {
  return parseChatMarkdown(source)
    .map((block) => {
      const line = (runs: ChatLine) => runs.map((run) => run.text).join('')
      if (block.kind === 'paragraph') return block.lines.map(line).join('\n')
      if (block.kind === 'heading') return line(block.line)
      if (block.kind === 'bullets') return block.items.map((item) => `• ${line(item)}`).join('\n')
      return block.items.map((item, index) => `${block.start + index}. ${line(item)}`).join('\n')
    })
    .join('\n\n')
}
