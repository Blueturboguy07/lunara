import type { ReactNode } from 'react'
import { parseChatMarkdown, type ChatLine } from '../lib/chatMarkdown'

/** One line of text runs. React elements only: the answer text is never parsed as HTML. */
function Runs({ line }: { line: ChatLine }) {
  return (
    <>
      {line.map((run, index) => {
        let node: ReactNode = run.text
        if (run.italic) node = <em>{node}</em>
        if (run.bold) node = <strong>{node}</strong>
        return <span key={index}>{node}</span>
      })}
    </>
  )
}

/** An AI answer with bold text, bullet lists and numbered lists (a safe Markdown subset). */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseChatMarkdown(text)
  return (
    <div className="chat-markdown">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <p key={index} className="chat-markdown-heading">
              <strong>
                <Runs line={block.line} />
              </strong>
            </p>
          )
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Runs line={item} />
                </li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'numbers') {
          return (
            <ol key={index} start={block.start}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Runs line={item} />
                </li>
              ))}
            </ol>
          )
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                <Runs line={line} />
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
