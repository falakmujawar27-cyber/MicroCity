/**
 * Display-time helpers. Records stay stored in UTC ISO strings; every
 * timestamp shown to a person is rendered in India Standard Time.
 */
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata'
export const DISPLAY_TIME_ZONE_LABEL = 'IST'

export interface ZonedParts {
  day: string
  month: string
  year: string
  hour: string
  minute: string
}

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function zonedParts(value: string | number | Date): ZonedParts | null {
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  if (Number.isNaN(time)) return null
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const { day, month, year, hour, minute } = parts
  if (!day || !month || !year || !hour || !minute) return null
  return { day, month, year, hour, minute }
}

export function formatIstDate(value: string | number | Date): string | null {
  const parts = zonedParts(value)
  return parts ? `${parts.day}-${parts.month}-${parts.year}` : null
}

export function formatIstDateTime(value: string | number | Date): string | null {
  const parts = zonedParts(value)
  return parts ? `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute} ${DISPLAY_TIME_ZONE_LABEL}` : null
}

/** Calendar date in IST as YYYY-MM-DD, used for attendance session dates. */
export function istDateKey(value: string | number | Date = Date.now()): string | null {
  const parts = zonedParts(value)
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : null
}

export function formatIstTime(value: string | number | Date): string | null {
  const parts = zonedParts(value)
  return parts ? `${parts.hour}:${parts.minute}` : null
}

export function formatIstDateKey(value: string): string | null {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : null
}
