/**
 * Shared complaint rules used by both the browser form and the server.
 * The server remains the authority; the client uses these only for hints.
 */

export const COMPLAINT_DESCRIPTION_MIN = 15
export const COMPLAINT_DESCRIPTION_MIN_WORDS = 4

const VAGUE_PHRASES = new Set([
  'broken',
  'not working',
  'not working please fix',
  'does not work',
  'doesnt work',
  'fix it',
  'fix this',
  'please fix',
  'please repair',
  'issue',
  'problem',
  'fault',
  'faulty',
  'bad',
  'urgent',
  'help',
  'repair',
  'broken please fix',
])

/** Words that carry no location or object detail on their own. */
const EMPTY_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'of', 'to', 'it', 'this', 'that', 'these', 'those',
  'there', 'here', 'not', 'no', 'never', 'very', 'really', 'so', 'and', 'or',
  'with', 'for', 'from', 'my', 'our', 'we', 'i', 'you', 'please', 'kindly',
  'work', 'works', 'working', 'worked', 'broken', 'break', 'breaks',
  'fault', 'faulty', 'issue', 'issues', 'problem', 'problems',
  'fix', 'fixed', 'repair', 'help', 'urgent', 'bad', 'need', 'needs', 'needed',
])

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns a plain-English error for a complaint description, or null when the
 * text carries enough specific detail to act on.
 */
export function complaintDescriptionError(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!text) return 'Description is required.'
  if (text.length < COMPLAINT_DESCRIPTION_MIN) {
    return `Describe the problem in at least ${COMPLAINT_DESCRIPTION_MIN} characters — say what is wrong, where and when.`
  }
  const normalised = normalise(text)
  if (VAGUE_PHRASES.has(normalised)) {
    return 'That description is too vague. Say what is wrong, where, and when you noticed it.'
  }
  const words = normalised.split(' ').filter(Boolean)
  if (words.length < COMPLAINT_DESCRIPTION_MIN_WORDS) {
    return 'Add a little more detail: what is wrong, which room or area, and when.'
  }
  const detailWords = words.filter((word) => !EMPTY_WORDS.has(word))
  if (detailWords.length < 2) {
    return 'That description is too vague. Say what is wrong, where, and when you noticed it.'
  }
  return null
}
