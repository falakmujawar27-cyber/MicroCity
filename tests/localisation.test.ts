import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '../src/lib/format.ts'
import {
  COMPLAINT_DESCRIPTION_MIN,
  complaintDescriptionError,
} from '../src/domain/complaint-rules.ts'

test('format: rupee currency and Indian digit grouping', () => {
  assert.equal(formatCurrency(118830, 'INR'), '₹1,18,830')
  assert.equal(formatCurrency(12345678.5, '₹'), '₹1,23,45,678.5')
  assert.equal(formatCurrency(1500, 'usd'), 'USD 1,500')
  assert.equal(formatNumber(1000000), '10,00,000')
  assert.ok(!formatCurrency(99, 'INR').includes('£'))
})

test('format: dates and times are shown in IST', () => {
  assert.equal(formatDate('2026-10-07T08:40:00Z'), '07-10-2026')
  assert.equal(formatDateTime('2026-10-07T08:40:00Z'), '07-10-2026 14:10 IST')
  // A UTC timestamp late in the day belongs to the next IST day.
  assert.equal(formatDate('2026-10-07T20:00:00Z'), '08-10-2026')
  assert.equal(formatDateTime('2026-10-07T20:00:00Z'), '08-10-2026 01:30 IST')
  assert.equal(formatDate(null), 'Not recorded')
  assert.equal(formatDate('not a date'), 'Not recorded')
})

test('complaint description: rejects short and vague entries', () => {
  assert.ok(complaintDescriptionError(''))
  assert.ok(complaintDescriptionError('Leak'))
  assert.ok(complaintDescriptionError('broken'))
  assert.ok(complaintDescriptionError('Not working please fix'))
  assert.ok(complaintDescriptionError('The projector is broken'))
  assert.ok(COMPLAINT_DESCRIPTION_MIN === 15)
})

test('complaint description: accepts specific reports', () => {
  assert.equal(
    complaintDescriptionError('Ceiling fan in room 1.04 sparks when switched on; noticed this morning.'),
    null,
  )
  assert.equal(
    complaintDescriptionError('Tap in the ground-floor washroom runs continuously since Monday.'),
    null,
  )
})
