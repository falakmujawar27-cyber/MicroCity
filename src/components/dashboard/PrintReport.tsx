import type { ReactNode } from 'react'
import { buildReportMarkdown } from '../../lib/reports'
import type { ReportInputWithSummary } from '../../lib/reports'

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.replace(/\\\|/g, '|'),
  )
}

export default function PrintReport(props: ReportInputWithSummary) {
  const lines = buildReportMarkdown(props).split('\n')
  const content: ReactNode[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    if (line.startsWith('| ')) {
      const rows: string[][] = []
      const key = index
      while (index < lines.length && lines[index].startsWith('| ')) {
        const cells = lines[index].slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim())
        if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells)
        index += 1
      }
      index -= 1
      content.push(
        <div key={key} className="my-3 max-w-full overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[0.65rem] print:min-w-0 print:table-fixed">
            <thead><tr>{rows[0].map((cell, column) => <th key={column} className="border border-black/25 p-1.5 align-top [overflow-wrap:anywhere]">{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, column) => <td key={column} className="border border-black/20 p-1.5 align-top [overflow-wrap:anywhere]">{inline(cell)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>,
      )
    } else if (line.startsWith('# ')) {
      content.push(<h1 key={index} className="mb-4 border-b-2 border-black pb-3 text-2xl font-semibold">{inline(line.slice(2))}</h1>)
    } else if (line.startsWith('## ')) {
      content.push(<h2 key={index} className="mb-2 mt-6 break-after-avoid text-lg font-semibold">{inline(line.slice(3))}</h2>)
    } else if (line.startsWith('### ')) {
      content.push(<h3 key={index} className="mb-2 mt-4 break-after-avoid text-sm font-semibold">{inline(line.slice(4))}</h3>)
    } else {
      content.push(<p key={index} className={`my-1 text-xs leading-relaxed [overflow-wrap:anywhere] ${line.startsWith('> ') ? 'border-l-2 border-black/30 pl-3' : ''}`}>{inline(line.replace(/^> /, ''))}</p>)
    }
  }
  return (
    <section className="print-sheet mt-2 min-w-0 max-w-full border border-black/20 bg-white p-4 text-[#1c1a24] md:p-8" aria-label="Print-friendly infrastructure report">
      {content}
    </section>
  )
}
