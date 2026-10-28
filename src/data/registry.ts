/**
 * Expected external datasets registry — Phase 4B.
 *
 * Lists every dataset the project expects to receive from outside, and its
 * current availability status. This registry is the single source of truth
 * for "which data should exist": loaders (Phase 4C) must consult it and must
 * never fabricate records for entries marked 'unavailable' or 'pending'.
 *
 * Note: smartcampus_test_data.xlsx was audited in Phase 4A (2026-10-24) and
 * found to be missing everywhere on the machine (project folder, Desktop,
 * Documents, Downloads, OneDrive, profile root, sibling project folders).
 * It is recorded as unavailable — it must NOT be treated as existing.
 */

export type ExpectedDatasetStatus =
  /** File present on disk and verified readable. */
  | 'available'
  /** Expected but not yet supplied. */
  | 'pending'
  /** Audited and confirmed missing; must not be invented or faked. */
  | 'unavailable'

export interface ExpectedDatasetEntry {
  /** Exact expected filename, e.g. "smartcampus_test_data.xlsx". */
  filename: string
  status: ExpectedDatasetStatus
  /** Evidence / audit note explaining the status. */
  note: string
}

export const EXPECTED_EXTERNAL_DATASETS: ExpectedDatasetEntry[] = [
  {
    filename: 'smartcampus_test_data.xlsx',
    status: 'unavailable',
    note:
      'Audited 2026-10-24 (Phase 4A): file does not exist anywhere searched ' +
      '(project folder, Desktop, Documents, Downloads, OneDrive, profile root, ' +
      'sibling project folders). Needs to be supplied before any campus data work.',
  },
]

export function findExpectedDataset(filename: string): ExpectedDatasetEntry | undefined {
  return EXPECTED_EXTERNAL_DATASETS.find((d) => d.filename === filename)
}
