import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function newSalt(): string {
  return randomBytes(16).toString('hex')
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
