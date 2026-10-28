export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))].join('\r\n')
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  downloadFile(filename, `\uFEFF${toCsv(headers, rows)}`, 'text/csv;charset=utf-8')
}
