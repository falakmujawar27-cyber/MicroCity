import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyDemoLocalisation, createDatabase, seedDatabase } from '../server/db.ts'
import { SEED_TARIFF_PLACEHOLDER_NOTE } from '../server/seed.ts'

const MARKER = 'phase-a-localisation-2026-10d'

function tempDatabasePath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'microcity-db-'))
  return { dir, path: join(dir, 'microcity.sqlite') }
}

test('fresh database: seeding and localisation complete on a new file', () => {
  const { dir, path } = tempDatabasePath()
  try {
    assert.equal(existsSync(path), false)
    const db = createDatabase(path, true)
    let buildingCount = 0
    try {
      assert.equal(existsSync(path), true)
      assert.equal(db.listColleges().length, 2)
      assert.deepEqual(
        db.listColleges().map((college) => college.id).sort(),
        ['clg-bv', 'clg-fd'],
      )
      assert.equal(db.findCollegeByCode('VIDYA-NAGAR')?.id, 'clg-bv')
      assert.equal(db.findCollegeByCode('seva-nagar')?.id, 'clg-fd')
      assert.equal(db.findCollegeByCode('NOT-A-COLLEGE'), null)

      for (const username of [
        'sample-admin',
        'sample-estates',
        'sample-maintenance',
        'sample-faculty',
        'sample-student',
        'sample-fd-admin',
        'sample-fd-estates',
        'sample-fd-student',
      ]) {
        assert.ok(db.getUserByUsername(username), `${username} should exist`)
      }

      assert.equal(db.getMeta('localisation'), MARKER)
      const provenance = JSON.parse(String(db.getMeta('provenance'))) as Record<string, unknown>
      assert.equal(provenance.synthetic, true)
      assert.doesNotMatch(String(provenance.notes), /smartcampus/i)

      for (const collegeId of ['clg-bv', 'clg-fd']) {
        assert.ok(db.countEntity('buildings', collegeId) > 0)
        assert.ok(db.countEntity('complaints', collegeId) > 0)
        for (const tariff of db.listRecords('tariffs', collegeId)) {
          assert.equal(tariff.data.ratePerUnit, null)
          assert.equal(tariff.data.standingChargePerPeriod, null)
          assert.equal(tariff.data.note, SEED_TARIFF_PLACEHOLDER_NOTE)
          assert.equal(tariff.source, 'seed')
        }
      }

      assert.equal(db.listImportLogs('clg-bv').filter((row) => row.kind === 'seed').length, 1)
      assert.equal(db.listImportLogs('clg-fd').filter((row) => row.kind === 'seed').length, 1)
      buildingCount = db.countEntity('buildings', 'clg-bv')
    } finally {
      db.close()
    }

    // Reopening the same file must not seed twice or re-run migrations.
    const reopened = createDatabase(path, true)
    try {
      assert.equal(reopened.listColleges().length, 2)
      assert.equal(reopened.countEntity('buildings', 'clg-bv'), buildingCount)
      assert.equal(reopened.getMeta('localisation'), MARKER)
      assert.equal(reopened.listImportLogs('clg-bv').filter((row) => row.kind === 'seed').length, 1)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ticket numbers: the database rejects a duplicate ticket inside a college but allows the same number in another college', () => {
  const db = createDatabase(':memory:', true)
  try {
    const make = (id: string, collegeId: string, ticket: string) => ({
      id,
      entity: 'complaints',
      collegeId,
      data: { id, collegeId, ticketNumber: ticket },
    })
    db.insertRecord(make('cmp-ticket-a', 'clg-bv', 'MC-9001'))
    assert.throws(
      () => db.insertRecord(make('cmp-ticket-b', 'clg-bv', 'MC-9001')),
      /UNIQUE constraint failed/,
      'a second complaint in the same college must not reuse a ticket number',
    )
    db.insertRecord(make('cmp-ticket-c', 'clg-fd', 'MC-9001'))
    assert.equal(db.getRecord('cmp-ticket-c')?.data.ticketNumber, 'MC-9001')
  } finally {
    db.close()
  }
})

test('migration: an existing database without college codes gains the column and codes', () => {
  const { dir, path } = tempDatabasePath()
  try {
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE colleges (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO colleges (id, name) VALUES
        ('clg-bv', 'Vidya Nagar College (fictional)'),
        ('clg-fd', 'Seva Nagar College (fictional)');
    `)
    legacy.close()

    const db = createDatabase(path, true)
    try {
      const columns = db.sql.prepare('PRAGMA table_info(colleges)').all() as { name?: string }[]
      assert.ok(columns.some((column) => column.name === 'code'))
      assert.equal(db.findCollegeByCode('VIDYA-NAGAR')?.id, 'clg-bv')
      assert.equal(db.findCollegeByCode('SEVA-NAGAR')?.id, 'clg-fd')
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('localisation: legacy seed tariffs become blank placeholders, user rates are kept', () => {
  const { dir, path } = tempDatabasePath()
  try {
    const db = createDatabase(path, false)
    try {
      seedDatabase(db)

      const legacy = db.getRecord('trf-bv-e')
      assert.ok(legacy)
      db.updateRecord('trf-bv-e', {
        ...legacy.data,
        currency: 'GBP',
        ratePerUnit: 0.24,
        standingChargePerPeriod: 35,
        note: 'Synthetic demonstration tariff - not a real supplier price.',
      })

      const edited = db.getRecord('trf-bv-w')
      assert.ok(edited)
      db.updateRecord('trf-bv-w', {
        ...edited.data,
        currency: 'INR',
        ratePerUnit: 17.25,
        standingChargePerPeriod: 120,
        note: 'Rate copied from a bill by the estates officer.',
      })

      db.sql.prepare('DELETE FROM meta WHERE key = ?').run('localisation')
      applyDemoLocalisation(db)

      const migrated = db.getRecord('trf-bv-e')
      assert.ok(migrated)
      assert.equal(migrated.data.currency, 'INR')
      assert.equal(migrated.data.ratePerUnit, null)
      assert.equal(migrated.data.standingChargePerPeriod, null)
      assert.equal(migrated.data.note, SEED_TARIFF_PLACEHOLDER_NOTE)

      const kept = db.getRecord('trf-bv-w')
      assert.ok(kept)
      assert.equal(kept.data.ratePerUnit, 17.25)
      assert.equal(kept.data.standingChargePerPeriod, 120)
      assert.equal(kept.data.note, 'Rate copied from a bill by the estates officer.')
      assert.equal(db.getMeta('localisation'), MARKER)

      // Running the migration again is a no-op.
      const before = db.getRecord('trf-bv-e')?.data
      applyDemoLocalisation(db)
      assert.deepEqual(db.getRecord('trf-bv-e')?.data, before)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
