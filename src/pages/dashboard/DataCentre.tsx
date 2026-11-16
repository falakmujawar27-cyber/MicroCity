import { useMemo, useRef, useState } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Notice from '../../components/ui/Notice'
import { Badge } from '../../components/ui/Badge'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { EmptyPanel } from '../../components/ui/PageState'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { downloadCsv } from '../../lib/download'
import { formatDateTime, formatNumber, titleCase } from '../../lib/format'
import { ENTITY_BY_NAME, IMPORTABLE_ENTITIES } from '../../domain/entities'
import type { EntitySpec, FieldSpec } from '../../domain/entities'
import { mappedRows, parseWorkbook, suggestEntity, suggestMapping, normaliseKey } from '../../lib/spreadsheet'
import type { ParsedSheet } from '../../lib/spreadsheet'
import type { ImportOutcome } from '../../domain/types'

type Mode = 'append' | 'replace'

interface SheetDraft extends ParsedSheet {
  key: string
  entity: string
  mapping: Record<string, string>
}

const MAX_PREVIEW_ROWS = 200

function requiredFields(spec: EntitySpec): FieldSpec[] {
  return spec.fields.filter((field) => field.required)
}

function missingRequired(draft: SheetDraft): FieldSpec[] {
  const spec = ENTITY_BY_NAME.get(draft.entity)
  if (!spec) return []
  const targets = new Set(Object.values(draft.mapping).filter(Boolean))
  const headers = new Set(draft.headers.map(normaliseKey))
  const satisfiedByRule = (key: string): boolean => {
    if (draft.entity === 'timetableSlots' && (key === 'startsAt' || key === 'endsAt')) {
      return headers.has('date') && headers.has('start') && headers.has('end')
    }
    if (draft.entity === 'complaints' && key === 'roomChoice') {
      return targets.has('roomChoice') || targets.has('roomId')
    }
    if (draft.entity === 'nearbyAssets' && key === 'distanceBasis') return true
    if (draft.entity === 'assets' && key === 'category') return targets.has('name')
  if (draft.entity === 'rooms' && key === 'code') return targets.has('id')
    if (draft.entity === 'utilityReadings' && key === 'unit') return targets.has('meterId')
    return false
  }
  return requiredFields(spec).filter((field) => !targets.has(field.key) && !satisfiedByRule(field.key))
}

function sampleValue(sheet: ParsedSheet, header: string): string {
  for (const row of sheet.rows) {
    const value = row[header]
    if (value === null || value === undefined || String(value).trim() === '') continue
    return String(value)
  }
  return '—'
}

function duplicateTargets(mapping: Record<string, string>): string[] {
  const counts = new Map<string, number>()
  for (const target of Object.values(mapping)) {
    if (!target) continue
    counts.set(target, (counts.get(target) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}

export default function DataCentre() {
  const { workspace, refresh, can, role } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [drafts, setDrafts] = useState<SheetDraft[]>([])
  const [mode, setMode] = useState<Mode>('append')
  const [fileError, setFileError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'parse' | 'preview' | 'apply' | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [applied, setApplied] = useState<ImportOutcome | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const canImport = can('import-data')
  const isAdmin = role === 'admin'
  const importable = useMemo(() => [...IMPORTABLE_ENTITIES].sort((a, b) => a.order - b.order), [])
  const totalRows = useMemo(
    () =>
      drafts
        .filter((draft) => draft.entity)
        .reduce((sum, draft) => sum + Math.min(draft.rows.length, 4000), 0),
    [drafts],
  )
  const blockedSheets = useMemo(
    () => drafts.filter((draft) => draft.entity && missingRequired(draft).length > 0),
    [drafts],
  )
  const mappedEntities = useMemo(
    () => drafts.map((draft) => draft.entity).filter(Boolean),
    [drafts],
  )

  if (!workspace) return null

  const resetPreview = () => {
    setOutcome(null)
    setApplied(null)
  }

  const clearFile = () => {
    setFileName('')
    setDrafts([])
    setFileError(null)
    resetPreview()
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFile = async (file: File) => {
    setFileError(null)
    setFileName(file.name)
    setDrafts([])
    resetPreview()
    setBusy('parse')
    try {
      const sheets = await parseWorkbook(file)
      if (sheets.length === 0) {
        throw new Error('No readable sheets or headers were found in this file.')
      }
      const fileHint =
        sheets.length === 1 ? suggestEntity(file.name.replace(/\.[^.]+$/, '')) : ''
      const next: SheetDraft[] = sheets.map((sheet, index) => {
        const entity = suggestEntity(sheet.name) || fileHint
        return {
          ...sheet,
          key: `${index}-${normaliseKey(sheet.name)}`,
          entity,
          mapping: entity ? suggestMapping(sheet.headers, entity) : {},
        }
      })
      setDrafts(next)
    } catch (error) {
      setFileError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'The file could not be read. Use CSV, TSV or an Excel workbook.',
      )
    } finally {
      setBusy(null)
    }
  }

  const updateDraft = (key: string, patch: Partial<SheetDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
    resetPreview()
  }

  const changeEntity = (key: string, entity: string) => {
    const draft = drafts.find((item) => item.key === key)
    if (!draft) return
    updateDraft(key, {
      entity,
      mapping: entity ? suggestMapping(draft.headers, entity) : {},
    })
  }

  const setMapping = (key: string, header: string, target: string) => {
    const draft = drafts.find((item) => item.key === key)
    if (!draft) return
    updateDraft(key, { mapping: { ...draft.mapping, [header]: target } })
  }

  const buildRequest = () => {
    const sheets = drafts
      .filter((draft) => draft.entity)
      .map((draft) => ({
        entity: draft.entity,
        rows: mappedRows(draft, draft.entity, draft.mapping, 4000),
      }))
    return { fileName, mode, sheets, confirmReplace: mode === 'replace' }
  }

  const validate = async () => {
    setFileError(null)
    setApplied(null)
    if (!fileName) return
    if (mappedEntities.length === 0) {
      setFileError('Choose a data category for at least one sheet before validating.')
      return
    }
    if (totalRows === 0) {
      setFileError('The mapped sheets contain no data rows.')
      return
    }
    setBusy('preview')
    try {
      const result = await api.importPreview(buildRequest())
      setOutcome(result)
    } catch (error) {
      setOutcome(null)
      setFileError(error instanceof ApiError ? error.message : 'Validation did not complete.')
    } finally {
      setBusy(null)
    }
  }

  const applyImport = async () => {
    setBusy('apply')
    try {
      const result = await api.importApply(buildRequest())
      setApplied(result)
      setOutcome(null)
      setDrafts([])
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const downloadTemplate = (spec: EntitySpec) => {
    const headers = spec.fields.map((field) => field.key)
    downloadCsv(`microcity-template-${spec.entity}.csv`, headers, [])
  }

  const recentImports = workspace.imports.slice(0, 12)
  const importAudit = workspace.audit.filter((entry) => entry.action === 'import').slice(0, 12)

  return (
    <>
      <PageHeading
        kicker="Data Centre"
        title="Import and audit"
        description="Import campus or public records from CSV or Excel. You choose how columns map, the server checks each row, and a preview appears before anything is saved. Every import records who did it, which file was used and when."
      />

      <div className="mb-8">
        <Panel kicker="Where the data came from" title={workspace.activeCollege.name}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">College</dt>
              <dd className="mt-1 text-ivory/80">{workspace.activeCollege.name}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Base data</dt>
              <dd className="mt-1 text-ivory/80">
                {workspace.activeCollege.mode === 'pilot'
                  ? 'Illustrative pilot data'
                  : workspace.provenance.synthetic
                    ? 'Fictional demonstration data'
                    : 'Recorded source'}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">How it was made</dt>
              <dd className="mt-1 text-ivory/80">{workspace.provenance.generator}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Created</dt>
              <dd className="mt-1 text-ivory/80">{formatDateTime(workspace.provenance.generatedAt)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Licence and source</dt>
              <dd className="mt-1 text-ivory/80">
                {workspace.provenance.license}
                {workspace.provenance.source ? ` · ${workspace.provenance.source}` : ' · no external source'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-violet/25 pt-4 text-xs leading-relaxed text-ivory/60">
            {workspace.provenance.notes}
          </p>
        </Panel>
      </div>

      {/* Templates */}
      <Panel
        kicker="Templates"
        title="Download a column template"
        className="mb-8"
        actions={<Badge tone="outline">{importable.length} categories</Badge>}
      >
        <p className="max-w-3xl text-sm leading-relaxed text-ivory/70">
          Templates contain headers only — no invented rows. Column names use the same field keys the server
          validates. Reference values (for example a building or meter) may be given as a record ID or as the
          referenced record's name/code when the match is unambiguous.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {importable.map((spec) => (
            <button
              key={spec.entity}
              type="button"
              onClick={() => downloadTemplate(spec)}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-violet/35 px-4 py-3 text-left text-sm text-ivory/85 hover:bg-violet/15 focus-ring"
            >
              <span>
                {spec.label}
                {spec.scope === 'public' && <span className="ml-2 text-[0.625rem] uppercase tracking-wider text-gold">public</span>}
              </span>
              <span className="font-mono text-[0.625rem] text-violet-bright/70">{spec.entity}.csv ↓</span>
            </button>
          ))}
        </div>
        <details className="mt-5 border-t border-violet/25 pt-4">
          <summary className="cursor-pointer font-mono text-[0.6875rem] uppercase tracking-widest text-violet-bright">
            Field reference ({importable.length} categories)
          </summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {importable.map((spec) => (
              <div key={spec.entity} className="border border-violet/25 px-4 py-3">
                <p className="text-sm font-semibold text-ivory">
                  {spec.label}{' '}
                  <span className="font-mono text-[0.625rem] font-normal uppercase tracking-wider text-ivory/45">
                    {spec.entity}
                  </span>
                </p>
                <p className="mt-1 text-xs text-ivory/55">Matched on: {spec.naturalKey}</p>
                <ul className="mt-2 space-y-1 text-xs text-ivory/70">
                  {spec.fields.map((field) => (
                    <li key={field.key} className="flex flex-wrap gap-x-2">
                      <span className="font-mono text-ivory/85">{field.key}</span>
                      <span className={field.required ? 'text-gold' : 'text-ivory/45'}>
                        {field.required ? 'required' : 'optional'}
                      </span>
                      <span className="text-ivory/50">{field.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </Panel>

      {/* Import flow */}
      {!canImport ? (
        <Notice tone="info" title="Read-only for your role" className="mb-8">
          Importing is limited to administrators. You can review where the data came from, the import history and
          the audit trail, but the file workflow is disabled.
        </Notice>
      ) : (
        <Panel
          kicker="Import workflow"
          title="1 · Choose a file"
          className="mb-8"
          actions={
            fileName ? (
              <button
                type="button"
                onClick={clearFile}
                className="rounded-md border border-violet/40 px-3 py-1.5 text-xs text-ivory/80 hover:bg-violet/15 focus-ring"
              >
                Clear file
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-4">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
              }}
              className="text-sm text-ivory/80 file:mr-3 file:rounded-md file:border-0 file:bg-violet file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ivory hover:file:bg-violet/85"
            />
            <div className="flex flex-wrap gap-4 text-sm text-ivory/70">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'append'}
                  onChange={() => {
                    setMode('append')
                    resetPreview()
                  }}
                />
                Append
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'replace'}
                  onChange={() => {
                    setMode('replace')
                    resetPreview()
                  }}
                />
                Replace campus categories in this file
              </label>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ivory/55">
            Append adds records and skips existing natural keys. Replace removes every campus record in the
            categories you supply, but is blocked if the college has populated categories missing from the file.
            Public records can only be appended by an administrator.
          </p>
          {busy === 'parse' && <p className="mt-4 font-mono text-xs tracking-widest text-gold">READING FILE…</p>}
          {fileError && <Notice tone="danger" className="mt-4">{fileError}</Notice>}
          {applied && (
            <Notice tone="success" title="Import applied" className="mt-4">
              <p>
                Imported {formatNumber(applied.totals.imported)} record(s), skipped{' '}
                {formatNumber(applied.totals.skipped)}, rejected {formatNumber(applied.totals.rejected)} from{' '}
                <span className="font-mono">{applied.fileName}</span> in {applied.mode} mode. The import history
                and audit trail below have been refreshed.
              </p>
            </Notice>
          )}
        </Panel>
      )}

      {canImport && drafts.length > 0 && (
        <>
          <Panel
            kicker="Import workflow"
            title="2 · Map sheets and columns"
            className="mb-8"
            actions={
              <Badge tone={blockedSheets.length > 0 ? 'warn' : 'ok'}>
                {totalRows} mapped row{totalRows === 1 ? '' : 's'}
              </Badge>
            }
          >
            <p className="text-sm text-ivory/70">
              Sheet names were matched to categories automatically; confirm or change each one. Unmapped
              columns are ignored. A required field left unmapped will make its rows fail server validation.
            </p>
            {drafts.some((draft) => draft.truncated) && (
              <Notice tone="warning" className="mt-3">
                At least one sheet exceeded the 4,000-row import limit; only the first 4,000 rows are mapped.
              </Notice>
            )}
            {mode === 'replace' && (
              <Notice tone="warning" title="Replace mode" className="mt-3">
                Supplied categories will be cleared before importing. The server blocks replace mode if the
                college has populated campus categories that are missing from this file.
              </Notice>
            )}

            <div className="mt-5 space-y-5">
              {drafts.map((draft) => {
                const spec = ENTITY_BY_NAME.get(draft.entity)
                const missing = missingRequired(draft)
                const duplicates = duplicateTargets(draft.mapping)
                return (
                  <section key={draft.key} className="border border-violet/30 bg-ink/40 px-4 py-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                          Sheet {draft.name} · {draft.rows.length} row(s)
                        </p>
                        <label className="mt-2 block text-xs text-ivory/60" htmlFor={`entity-${draft.key}`}>
                          Import as
                        </label>
                        <select
                          id={`entity-${draft.key}`}
                          value={draft.entity}
                          onChange={(event) => changeEntity(draft.key, event.target.value)}
                          className="mt-1 w-full min-w-64 rounded-md border border-violet/40 bg-obsidian px-3 py-2 text-sm text-ivory focus-ring"
                        >
                          <option value="">Do not import this sheet</option>
                          {importable.map((option) => (
                            <option
                              key={option.entity}
                              value={option.entity}
                              disabled={option.scope === 'public' && !isAdmin}
                            >
                              {option.label}
                              {option.scope === 'public' ? ' (public — admin only)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="outline">{draft.headers.length} columns</Badge>
                        {draft.mapping && <Badge tone="violet">{Object.values(draft.mapping).filter(Boolean).length} mapped</Badge>}
                        {draft.rawRowCount > draft.rows.length && <Badge tone="warn">truncated</Badge>}
                      </div>
                    </div>

                    {!draft.entity && (
                      <p className="mt-3 text-sm text-ivory/55">This sheet will be ignored.</p>
                    )}

                    {spec && (
                      <>
                        {missing.length > 0 && (
                          <Notice tone="warning" className="mt-3">
                            Required fields not mapped: {missing.map((field) => field.label).join(', ')}. Rows
                            will be rejected by the server until these are mapped.
                          </Notice>
                        )}
                        {duplicates.length > 0 && (
                          <Notice tone="warning" className="mt-3">
                            More than one column maps to: {duplicates.join(', ')}. Only the last column will be
                            used for each duplicated field.
                          </Notice>
                        )}
                        <div className="mt-3 max-h-80 overflow-auto border border-violet/25">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-obsidian-lift/90 font-mono uppercase tracking-widest text-violet-bright">
                              <tr>
                                <th scope="col" className="px-3 py-2 font-medium">File column</th>
                                <th scope="col" className="px-3 py-2 font-medium">Example value</th>
                                <th scope="col" className="px-3 py-2 font-medium">Maps to field</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-violet/20">
                              {draft.headers.map((header) => (
                                <tr key={header}>
                                  <td className="px-3 py-2 font-mono text-ivory/85">{header}</td>
                                  <td className="max-w-64 truncate px-3 py-2 text-ivory/55" title={sampleValue(draft, header)}>
                                    {sampleValue(draft, header)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      aria-label={`Map ${header} to a field`}
                                      value={draft.mapping[header] ?? ''}
                                      onChange={(event) => setMapping(draft.key, header, event.target.value)}
                                      className="w-full min-w-52 rounded border border-violet/35 bg-obsidian px-2 py-1.5 text-xs text-ivory focus-ring"
                                    >
                                      <option value="">— ignore —</option>
                                      {spec.fields.map((field) => (
                                        <option key={field.key} value={field.key}>
                                          {field.key} · {field.label}
                                          {field.required ? ' *' : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </section>
                )
              })}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-violet/25 pt-4">
              <button
                type="button"
                onClick={() => void validate()}
                disabled={busy !== null || totalRows === 0}
                className="rounded-md bg-violet px-5 py-2.5 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-40"
              >
                {busy === 'preview' ? 'Validating…' : 'Validate & preview'}
              </button>
              <span className="text-xs text-ivory/55">
                Nothing is written during validation. The preview reports row-level errors and warnings.
              </span>
            </div>
          </Panel>

          {outcome && (
            <Panel
              kicker="Server validation"
              title="3 · Review before applying"
              className="mb-8"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="ok">{formatNumber(outcome.totals.imported)} ready</Badge>
                  <Badge tone="warn">{formatNumber(outcome.totals.skipped)} skipped</Badge>
                  <Badge tone={outcome.totals.rejected > 0 ? 'error' : 'outline'}>
                    {formatNumber(outcome.totals.rejected)} rejected
                  </Badge>
                </div>
              }
            >
              {outcome.blocked.length > 0 && (
                <Notice tone="danger" title="Import blocked" className="mb-4">
                  <ul className="list-disc space-y-1 pl-4">
                    {outcome.blocked.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              {!outcome.blocked.length && (
                <Notice tone={outcome.canApply ? 'info' : 'warning'} title="Validation result" className="mb-4">
                  {outcome.canApply
                    ? 'The server accepted this batch for apply. Rows marked skipped or rejected will not be written; in replace mode any rejection blocks the whole apply.'
                    : 'The server will not apply this batch. Fix the rejected rows or choose Append, then validate again.'}
                  {outcome.notices.map((message) => (
                    <p key={message} className="mt-2 text-xs text-ivory/60">
                      {message}
                    </p>
                  ))}
                </Notice>
              )}

              <div className="space-y-4">
                {outcome.entities.map((entity) => (
                  <details
                    key={entity.entity}
                    open={entity.rejected > 0 || entity.skipped > 0}
                    className="border border-violet/25 px-4 py-3"
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-ivory">
                      {entity.label}{' '}
                      <span className="ml-2 font-mono text-[0.625rem] font-normal uppercase tracking-wider text-ivory/50">
                        {entity.imported} ready · {entity.skipped} skipped · {entity.rejected} rejected
                      </span>
                    </summary>
                    <div className="mt-3 max-h-80 overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="font-mono uppercase tracking-widest text-violet-bright">
                          <tr>
                            <th scope="col" className="px-2 py-1.5 font-medium">Row</th>
                            <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                            <th scope="col" className="px-2 py-1.5 font-medium">Message</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-violet/20">
                          {entity.rows.slice(0, MAX_PREVIEW_ROWS).map((row) => (
                            <tr key={`${entity.entity}-${row.rowNumber}`} className="align-top">
                              <td className="px-2 py-1.5 font-mono text-ivory/55">{row.rowNumber}</td>
                              <td className="px-2 py-1.5">
                                <Badge tone={row.status === 'imported' ? 'ok' : row.status === 'skipped' ? 'warn' : 'error'}>
                                  {row.status}
                                </Badge>
                              </td>
                              <td className="px-2 py-1.5">
                                {row.id && (
                                  <p className="font-mono text-[0.625rem] text-ivory/45">
                                    {row.status === 'imported' ? 'new ID' : 'ID'}: {row.id}
                                  </p>
                                )}
                                {row.message && <p className="text-ivory/75">{row.message}</p>}
                                {Object.entries(row.errors).map(([field, message]) => (
                                  <p key={field} className="text-status-error-dark">
                                    {field}: {message}
                                  </p>
                                ))}
                                {row.warnings.map((warning) => (
                                  <p key={warning} className="text-gold/90">
                                    Warning: {warning}
                                  </p>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {entity.rows.length > MAX_PREVIEW_ROWS && (
                        <p className="mt-2 text-xs text-ivory/50">
                          Showing the first {MAX_PREVIEW_ROWS} of {entity.rows.length} row outcomes.
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-violet/25 pt-4">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!outcome.canApply || busy !== null}
                  className="rounded-md border border-status-ok-dark/70 bg-status-ok-dark/15 px-5 py-2.5 text-sm font-semibold text-status-ok-dark hover:bg-status-ok-dark/25 focus-ring disabled:opacity-40"
                >
                  {busy === 'apply' ? 'Applying…' : 'Apply validated import'}
                </button>
                <button
                  type="button"
                  onClick={() => setOutcome(null)}
                  className="rounded-md border border-violet/40 px-4 py-2.5 text-sm text-ivory/80 hover:bg-violet/15 focus-ring"
                >
                  Back to mapping
                </button>
                <span className="text-xs text-ivory/55">
                  Apply writes only the rows marked ready. A replace import can still be blocked by the server.
                </span>
              </div>
            </Panel>
          )}
        </>
      )}

      {/* Import history */}
      <Panel
        kicker="Source trail"
        title="Import history"
        className="mb-8"
        actions={<Badge tone="outline">{workspace.imports.length} entries</Badge>}
      >
        {recentImports.length === 0 ? (
          <EmptyPanel title="No imports recorded">
            The base workspace was created from demonstration data. Your imports will appear here with who did it,
            which file was used and when.
          </EmptyPanel>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-violet/30 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">When (IST)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source file</th>
                  <th scope="col" className="px-3 py-2 font-medium">Kind / mode</th>
                  <th scope="col" className="px-3 py-2 font-medium">Imported</th>
                  <th scope="col" className="px-3 py-2 font-medium">Categories</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet/20">
                {recentImports.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="px-3 py-2 font-mono text-xs text-ivory/60">{formatDateTime(entry.at)}</td>
                    <td className="px-3 py-2 text-ivory/85">{entry.actorName}</td>
                    <td className="max-w-64 break-all px-3 py-2 font-mono text-xs text-ivory/75">{entry.fileName}</td>
                    <td className="px-3 py-2">
                      <Badge tone={entry.kind === 'seed' ? 'outline' : 'violet'}>{entry.kind}</Badge>{' '}
                      <Badge tone={entry.mode === 'replace' ? 'warn' : 'neutral'}>{entry.mode}</Badge>
                    </td>
                    <td className="px-3 py-2 text-ivory/85">{formatNumber(entry.totalImported)}</td>
                    <td className="px-3 py-2">
                      {entry.summary.length === 0 ? (
                        <span className="text-xs text-ivory/45">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {entry.summary.map((item) => (
                            <Badge key={item.entity} tone="outline">
                              {ENTITY_BY_NAME.get(item.entity)?.label ?? item.entity} {item.imported}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Audit */}
      <Panel
        kicker="Accountability"
        title="Import audit trail"
        actions={<Badge tone="outline">{role ? titleCase(role) : '—'}</Badge>}
      >
        {importAudit.length === 0 ? (
          <EmptyPanel title="No import audit entries">
            Every applied import writes an audit entry with actor, source file and time.
          </EmptyPanel>
        ) : (
          <ul className="space-y-2">
            {importAudit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-3 border-t border-violet/20 pt-2 text-sm">
                <span className="font-mono text-[0.6875rem] text-violet-bright/80">{formatDateTime(entry.at)}</span>
                <span className="text-ivory/85">{entry.actorName}</span>
                <span className="text-ivory/60">{entry.detail}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 border-t border-violet/25 pt-4 text-xs leading-relaxed text-ivory/50">
          Base records are fictional demonstration data. Imported records are user-supplied; MicroCity records
          the source file, actor and time but cannot verify the source itself. Public infrastructure records are
          shared across colleges; campus records stay isolated to {workspace.activeCollege.name}.
        </p>
      </Panel>

      <ConfirmDialog
        open={confirmOpen}
        title={mode === 'replace' ? 'Replace and import records?' : 'Apply this import?'}
        message={
          mode === 'replace'
            ? `Apply ${outcome?.totals.imported ?? 0} record(s) in replace mode. Existing campus records in the supplied categories will be removed first. This cannot be undone.`
            : `Add ${outcome?.totals.imported ?? 0} validated record(s) to ${workspace.activeCollege.name}? Skipped and rejected rows will not be written.`
        }
        confirmLabel={mode === 'replace' ? 'Replace and import' : 'Apply import'}
        onConfirm={applyImport}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  )
}
