/**
 * Number guard for AI-generated text (Phase G).
 *
 * Deterministic code computes every number in MicroCity. Before an AI answer
 * is shown, this module extracts every number the model wrote and checks it
 * against the facts object that was sent to the model. One unsupported number
 * rejects the whole answer; the caller then shows the rule-based explanation.
 *
 * Rules implemented here (documented for the audit trail):
 *
 * - Plain numbers in the answer must appear in the facts, either as a numeric
 *   fact value (rounding to the shown precision is allowed: the value, its
 *   rounding, one decimal and two decimals are all accepted) or inside a
 *   string fact such as a room code, ticket number or date label.
 * - Percentages: if the facts contain a ratio r (0..1 scale), a percentage
 *   is supported only when round(r * 100, d) equals the answer at its shown
 *   precision d (zero decimals for "33%", one for "33.3%").
 *   Percentages whose number is a supported plain number are also allowed.
 *   (Formula stated here as required by the feature specification.)
 * - Spelled-out numbers: cardinals zero to twenty, the tens (thirty..ninety),
 *   simple compounds ("twenty five") and scale words ("two hundred", "three
 *   thousand") are converted to digits and checked exactly like digits. A
 *   spelled-out invented number is therefore rejected.
 * - Ranges ("3 to 5", "3-5"): both endpoints are checked independently, so a
 *   range passes only if every number in it is supported.
 * - Dates: numbers inside an ISO (YYYY-MM-DD) or DD/MM/YYYY date token are
 *   allowed only when that exact date appears inside a facts label; otherwise
 *   the numbers are validated as ordinary numbers, so an invented date is
 *   rejected.
 * - Ordinals: numeric ordinals ("3rd") are validated like any number; word
 *   ordinals ("first", "second") carry no quantity and are ignored.
 * - Numbers inside labels in the facts (for example "Room 1.01") are allowed.
 */

export interface GuardFailure {
  /** The number as written in the answer. */
  text: string
  /** Numeric value after normalisation, when parseable. */
  value: number | null
  kind: 'digit' | 'percent' | 'word'
}

export interface GuardResult {
  ok: boolean
  unsupported: GuardFailure[]
}

const UNIT_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
}

const SCALE_WORDS: Record<string, number> = { hundred: 100, thousand: 1_000 }

const WORD_NUMBER_SOURCE =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|' +
  'sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)'

/** Word ordinals carry no quantity, so they are deliberately not checked. */
const WORD_ORDINALS =
  /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth)\b/gi

function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/,(?=\d{3}\b)/g, '').replace(',', '.')
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/**
 * Numbers allowed as plain values: numeric fact values (with rounding
 * variants) and every number that appears inside a facts string (labels,
 * room codes, ticket numbers, dates).
 */
function collectAllowed(facts: unknown): { digits: Set<number>; ratioFacts: number[] } {
  const digits = new Set<number>()
  const ratioFacts: number[] = []

  const addNumber = (value: number, ratioEligible = false) => {
    if (!Number.isFinite(value)) return
    digits.add(value)
    digits.add(Math.round(value))
    digits.add(Number(value.toFixed(1)))
    digits.add(Number(value.toFixed(2)))
    if (ratioEligible && Math.abs(value) <= 1.5) ratioFacts.push(value)
  }

  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'number') {
      addNumber(value, /(?:ratio|share|utili[sz]|fraction|percent|pct)/i.test(key))
      return
    }
    if (typeof value === 'string') {
      // Numbers embedded in labels, codes and dates in the facts.
      for (const match of value.matchAll(/\d+(?:[.,]\d+)?/g)) {
        const parsed = parseDecimal(match[0])
        if (parsed !== null) addNumber(parsed)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key)
      return
    }
    if (typeof value === 'object' && value !== null) {
      for (const [childKey, item] of Object.entries(value as Record<string, unknown>)) {
        visit(item, childKey)
      }
    }
  }

  visit(facts)
  return { digits, ratioFacts }
}

function wordNumbers(text: string): { text: string; value: number }[] {
  const results: { text: string; value: number }[] = []
  const sequence = new RegExp(`${WORD_NUMBER_SOURCE}(?:[\\s-]+${WORD_NUMBER_SOURCE})*`, 'gi')
  for (const match of text.matchAll(sequence)) {
    const tokens = match[0].toLowerCase().split(/[\s-]+/)
    let total = 0
    let current = 0
    let sawWord = false
    for (const token of tokens) {
      if (token in SCALE_WORDS) {
        current = Math.max(1, current) * SCALE_WORDS[token]
        total += current
        current = 0
        sawWord = true
      } else if (token in UNIT_WORDS) {
        current += UNIT_WORDS[token]
        sawWord = true
      }
    }
    if (sawWord) {
      total += current
      results.push({ text: match[0], value: total })
    }
  }
  return results
}

/** Removes matched spans so later passes do not double-count them. */
function blankSpans(text: string, matches: RegExpMatchArray[]): string {
  let blanked = text
  for (const match of matches) {
    const index = blanked.indexOf(match[0])
    if (index >= 0) {
      blanked =
        blanked.slice(0, index) +
        ' '.repeat(match[0].length) +
        blanked.slice(index + match[0].length)
    }
  }
  return blanked
}

function dateIsoMatchesFact(date: string, strings: string[]): boolean {
  return strings.some((label) => label.includes(date))
}

function collectFactStrings(facts: unknown): string[] {
  const strings: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value === 'object' && value !== null) {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item)
    }
  }
  visit(facts)
  return strings
}

/**
 * Checks an AI answer against the facts object that produced it.
 * Returns ok:false with the first unsupported numbers when the answer
 * must be discarded.
 */
export function guardAiNumbers(text: string, facts: unknown): GuardResult {
  const unsupported: GuardFailure[] = []
  const push = (failure: GuardFailure) => {
    if (unsupported.length < 10) unsupported.push(failure)
  }

  const { digits, ratioFacts } = collectAllowed(facts)
  const factStrings = collectFactStrings(facts)
  const digitOk = (value: number) =>
    digits.has(value) ||
    // rounding to one decimal place of shown precision
    [...digits].some((allowed) => Math.abs(allowed - value) < 0.005)

  let working = text

  // Word ordinals carry no quantity and are ignored by design.
  working = working.replace(WORD_ORDINALS, (match) => ' '.repeat(match.length))

  // 1. Percentages. A percentage is supported when the number is allowed as a
  //    plain number, or when it is derived from a ratio fact by the formula
  //    documented in the module header: round(r * 100) == n, tolerating one
  //    decimal of rounding in the displayed percentage.
  const percentMatches = [...working.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)]
  for (const match of percentMatches) {
    const value = parseDecimal(match[1])
    const decimalPlaces = (match[1].split(/[.,]/)[1] ?? '').length
    const ok =
      value !== null &&
      (digitOk(value) ||
        ratioFacts.some(
          (ratio) => Number((ratio * 100).toFixed(decimalPlaces)) === value,
        ))
    if (!ok && value !== null) push({ text: match[0].trim(), value, kind: 'percent' })
  }
  working = blankSpans(working, percentMatches)

  // 2. Dates. A date whose full form appears in a facts label is allowed as a
  //    label; otherwise the numbers inside it are checked like any number.
  const isoDates = [...working.matchAll(/\d{4}-\d{2}-\d{2}/g)]
  const dmyDates = [...working.matchAll(/\d{1,2}\/\d{1,2}\/\d{4}/g)]
  const allowedDates = new Set<string>()
  for (const match of [...isoDates, ...dmyDates]) {
    if (dateIsoMatchesFact(match[0], factStrings)) allowedDates.add(match[0])
  }
  for (const match of [...isoDates, ...dmyDates]) {
    if (!allowedDates.has(match[0])) {
      for (const part of match[0].split(/[-/]/)) {
        const value = Number(part)
        if (Number.isFinite(value) && !digitOk(value)) {
          push({ text: match[0], value, kind: 'digit' })
          break
        }
      }
    }
  }
  working = blankSpans(working, [...isoDates, ...dmyDates])

  // 3. Spelled-out numbers, checked exactly like digits.
  for (const word of wordNumbers(working)) {
    if (!digitOk(word.value)) push({ text: word.text, value: word.value, kind: 'word' })
  }
  working = working.replace(
    new RegExp(`${WORD_NUMBER_SOURCE}(?:[\\s-]+${WORD_NUMBER_SOURCE})*`, 'gi'),
    (match) => ' '.repeat(match.length),
  )

  // 4. Every remaining number must be supported.
  for (const match of working.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const value = parseDecimal(match[0])
    if (value === null) continue
    if (!digitOk(value)) push({ text: match[0], value, kind: 'digit' })
  }

  return { ok: unsupported.length === 0, unsupported }
}
