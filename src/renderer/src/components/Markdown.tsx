// Just enough Markdown for the shipped documents (PRIVACY.md, THIRD_PARTY_NOTICES.md): headings, paragraphs, lists,
// tables, block quotes and code blocks. Text only; nothing is rendered as HTML.
import type { ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith('`')) return <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code>
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) return <span key={i}>{link[1]}</span>
    return part
  })
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i])
      i++
      out.push(<pre key={i} className="selectable overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{body.join('\n')}</pre>)
    } else if (/^#{1,3} /.test(l)) {
      const level = l.indexOf(' ')
      const cls = ['', 'text-lg font-bold', 'mt-2 text-base font-semibold', 'text-sm font-semibold'][level]
      out.push(<div key={i} role="heading" aria-level={level} className={cls}>{inline(l.slice(level + 1))}</div>)
      i++
    } else if (l.startsWith('|')) {
      const rows: string[][] = []
      for (; i < lines.length && lines[i].startsWith('|'); i++)
        if (!/^\|[\s|:-]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()))
      out.push(
        <table key={i} className="w-full text-left text-xs">
          <tbody>
            {rows.map((r, k) => (
              <tr key={k} className={k === 0 ? 'font-semibold' : 'border-t border-border'}>
                {r.map((c, j) => <td key={j} className="py-1.5 pr-3 align-top">{inline(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )
    } else if (/^\s*[-*] /.test(l)) {
      const items: string[] = []
      for (; i < lines.length && (/^\s*[-*] /.test(lines[i]) || /^ {2,}\S/.test(lines[i])); i++)
        if (/^\s*[-*] /.test(lines[i])) items.push(lines[i].replace(/^\s*[-*] /, ''))
        else items[items.length - 1] += ' ' + lines[i].trim()
      out.push(<ul key={i} className="list-disc space-y-1 pl-5">{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>)
    } else if (/^\s*>/.test(l)) {
      const body: string[] = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*> ?/, ''))
      out.push(<blockquote key={i} className="border-l-2 border-border pl-3 text-xs text-muted-foreground whitespace-pre-line">{body.join('\n')}</blockquote>)
    } else if (l.trim()) {
      const body: string[] = []
      for (; i < lines.length && lines[i].trim() && !/^(#|\||```|\s*[-*] |\s*>)/.test(lines[i]); i++) body.push(lines[i])
      out.push(<p key={i}>{inline(body.join(' '))}</p>)
    } else i++
  }
  return <div className="selectable space-y-3 text-sm leading-relaxed">{out}</div>
}
