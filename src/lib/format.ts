import { formatIstDate, formatIstDateTime } from './time.ts'

const numberFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const plainNumberFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDate(value: string | null | undefined, fallback = 'Not recorded'): string {
  if (!value) return fallback
  return formatIstDate(value) ?? fallback
}

export function formatDateTime(value: string | null | undefined, fallback = 'Not recorded'): string {
  if (!value) return fallback
  return formatIstDateTime(value) ?? fallback
}

export function formatNumber(value: number | null | undefined, fallback = 'Not recorded'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return numberFormatter.format(value)
}

export function formatCurrency(
  value: number | null | undefined,
  currency: string | null | undefined,
  fallback = 'Not recorded',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  if (!currency) return formatNumber(value)
  const code = currency.trim().toUpperCase()
  if (code === 'INR' || currency.trim() === '₹') {
    return `₹${plainNumberFormatter.format(value)}`
  }
  // Show the ISO code rather than another country's symbol.
  return `${code} ${formatNumber(value)}`
}

export function percentage(value: number | null | undefined, digits = 0, fallback = 'Not available'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return `${(value * 100).toFixed(digits)}%`
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

export function truncate(value: string, max = 120): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

export function isoDateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 10)
}

export function toDateTimeLocal(value: string | null | undefined): string {
  if (!value) return ''
  const time = Date.parse(value)
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString()
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
