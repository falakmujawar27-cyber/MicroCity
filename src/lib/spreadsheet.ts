import * as XLSX from 'xlsx'
import { ENTITY_BY_NAME } from '../domain/entities'
import { NEARBY_TYPE_LABELS } from '../domain/types'

export interface ParsedSheet {
  name: string
  headers: string[]
  rows: Record<string, unknown>[]
  rawRowCount: number
  truncated: boolean
}

const MAX_ROWS = 4001

export function normaliseKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((value, index) => {
    const base = String(value ?? '').trim() || `Column ${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((value) => value === null || value === undefined || String(value).trim() === '')
}

export async function parseWorkbook(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets: ParsedSheet[] = []
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name]
    if (!worksheet) continue
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    })
    const headerIndex = matrix.findIndex((row) => !isEmptyRow(row))
    if (headerIndex < 0) continue
    const headers = uniqueHeaders(matrix[headerIndex])
    const rows: Record<string, unknown>[] = []
    for (const row of matrix.slice(headerIndex + 1)) {
      if (isEmptyRow(row)) continue
      const record: Record<string, unknown> = {}
      headers.forEach((header, index) => {
        record[header] = row[index] ?? null
      })
      rows.push(record)
    }
    sheets.push({
      name,
      headers,
      rows: rows.slice(0, MAX_ROWS),
      rawRowCount: rows.length,
      truncated: rows.length > MAX_ROWS,
    })
  }
  return sheets
}

export function suggestEntity(sheetName: string): string {
  const target = normaliseKey(sheetName)
  const candidates = [...ENTITY_BY_NAME.values()].filter((spec) => spec.importable)
  const exact = candidates.find(
    (spec) => normaliseKey(spec.entity) === target || normaliseKey(spec.label) === target,
  )
  if (exact) return exact.entity
  const loose = candidates.find(
    (spec) => target.includes(normaliseKey(spec.entity)) || normaliseKey(spec.label).includes(target),
  )
  return loose?.entity ?? ''
}

export function suggestMapping(headers: string[], entity: string): Record<string, string> {
  const spec = ENTITY_BY_NAME.get(entity)
  if (!spec) return {}
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  for (const header of headers) {
    const key = normaliseKey(header)
    // A timetable sheet usually carries a separate date plus HH:MM start and
    // end columns; those are composed into full timestamps below instead of
    // mapping a bare time onto an ISO date field.
    if (entity === 'timetableSlots' && (key === 'start' || key === 'end')) {
      mapping[header] = ''
      continue
    }
    const field = spec.fields.find((candidate) => {
      if (used.has(candidate.key)) return false
      const names = [candidate.key, candidate.label, ...candidate.aliases].map(normaliseKey)
      return names.includes(key)
    })
    if (field) {
      mapping[header] = field.key
      used.add(field.key)
    } else {
      mapping[header] = ''
    }
  }
  return mapping
}

function dateFromExcelNumber(value: number): string | null {
  const parsed = XLSX.SSF.parse_date_code(value)
  if (!parsed) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`
}

function headerLookup(headers: string[]): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const header of headers) lookup.set(normaliseKey(header), header)
  return lookup
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function timeText(value: unknown): string {
  const raw = text(value)
  if (!raw) return ''
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hours, minutes] = raw.split(':')
    return `${hours.padStart(2, '0')}:${minutes}`
  }
  if (/^\d{1,2}$/.test(raw)) return `${raw.padStart(2, '0')}:00`
  return ''
}

function nearbyTypeKey(value: string): string {
  if (!value) return ''
  const target = normaliseKey(value)
  const match = Object.entries(NEARBY_TYPE_LABELS).find(
    ([key, label]) => key === value || normaliseKey(label) === target,
  )
  return match ? match[0] : value
}

export function mappedRows(
  sheet: ParsedSheet,
  entity: string,
  mapping: Record<string, string>,
  limit = 4000,
): Record<string, unknown>[] {
  const spec = ENTITY_BY_NAME.get(entity)
  if (!spec) return []
  const targets = new Map(
    sheet.headers
      .map((header) => [header, mapping[header] ?? ''] as const)
      .filter(([, target]) => Boolean(target)),
  )
  const mappedTargets = new Set(targets.values())
  const headers = headerLookup(sheet.headers)
  const findHeader = (...names: string[]) => {
    for (const name of names) {
      const header = headers.get(normaliseKey(name))
      if (header) return header
    }
    return null
  }
  const dateHeader = findHeader('date')
  const startHeader = findHeader('start')
  const endHeader = findHeader('end')

  return sheet.rows.slice(0, limit).map((row) => {
    const output: Record<string, unknown> = {}
    for (const [header, target] of targets) {
      let value = row[header]
      const field = spec.fields.find((candidate) => candidate.key === target)
      if (field?.type === 'iso-date' || field?.type === 'nullable-iso-date') {
        if (value instanceof Date) value = value.toISOString()
        else if (typeof value === 'number') value = dateFromExcelNumber(value)
        else if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value.trim())) {
          value = `${value.trim()}-01`
        }
      }
      if (typeof value === 'string' && value.trim() === '') value = null
      output[target] = value
    }

    if (entity === 'timetableSlots' && !mappedTargets.has('startsAt') && dateHeader && startHeader && endHeader) {
      const date = text(row[dateHeader])
      const start = timeText(row[startHeader])
      const end = timeText(row[endHeader])
      if (date && start && end) {
        output.startsAt = `${date}T${start}:00Z`
        output.endsAt = `${date}T${end}:00Z`
      }
    }

    if (entity === 'complaints') {
      const roomValue = output.roomId === undefined || output.roomId === null ? '' : text(output.roomId)
      if (!mappedTargets.has('roomChoice')) {
        output.roomChoice = roomValue && roomValue.toLowerCase() !== 'not sure' ? 'room' : 'not_sure'
      }
      if (roomValue.toLowerCase() === 'not sure') output.roomId = null
    }

    if (entity === 'rooms' && !mappedTargets.has('code')) {
      const id = output.id === undefined || output.id === null ? '' : text(output.id)
      if (id) output.code = id
    }

    if (entity === 'assets' && !mappedTargets.has('category')) {
      const name = output.name === undefined || output.name === null ? '' : text(output.name)
      if (name) output.category = name
    }

    if (entity === 'nearbyAssets' && typeof output.type === 'string') {
      output.type = nearbyTypeKey(output.type)
    }

    return output
  })
}
