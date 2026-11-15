import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import {
  formatMissingNearbyUserCount,
  formatNearbyUsersMethod,
  NEARBY_RULE,
  NEARBY_RULE_LABEL,
} from '../../domain/analysis'
import type { NearbyRow } from '../../domain/analysis'
import { NEARBY_TYPE_LABELS } from '../../domain/types'
import type { NearbyAsset, NearbyAssetType } from '../../domain/types'
import { api } from '../../lib/api'
import { titleCase } from '../../lib/format'
import Panel from '../ui/Panel'
import { Badge } from '../ui/Badge'
import { EmptyPanel } from '../ui/PageState'
import RecordDialog from '../ui/RecordDialog'
import type { FormField } from '../ui/RecordDialog'
import ConfirmDialog from '../ui/ConfirmDialog'
import FindingExplainer from './FindingExplainer'

const fields: FormField[] = [
  { key: 'type', label: 'Type', type: 'select', required: true, options: Object.entries(NEARBY_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
  { key: 'locationDescription', label: 'Location description', type: 'text', required: true },
  { key: 'distanceMetres', label: 'Distance from college gate (m)', type: 'number', required: true },
  { key: 'distanceBasis', label: 'Distance basis', type: 'select', required: true, options: [{ value: 'estimated', label: 'Estimated' }, { value: 'measured', label: 'Measured' }], help: 'Keep Estimated unless the distance was measured.' },
  { key: 'condition', label: 'Condition', type: 'select', options: ['good', 'fair', 'poor'].map((value) => ({ value, label: titleCase(value) })) },
  { key: 'dailyUsers', label: 'Estimated daily users', type: 'integer', help: 'Leave empty if not entered. Counts do not decide condition status.' },
  { key: 'usersMethod', label: 'How daily users were obtained', type: 'textarea', required: true, showWhen: (values) => (values.dailyUsers ?? '').trim() !== '', help: 'Describe the observation, estimate or illustrative source. Required even for zero.' },
  { key: 'responsibleAuthority', label: 'Responsible authority', type: 'text', required: true },
  { key: 'basis', label: 'Basis tag', type: 'select', required: true, options: ['measured', 'estimated', 'illustrative'].map((value) => ({ value, label: titleCase(value) })) },
]

function Status({ row }: { row: NearbyRow }) {
  const tone = row.status === 'critical' ? 'error' : row.status === 'stressed' ? 'warn' : row.status === 'adequate' ? 'ok' : 'neutral'
  const icon = row.status === 'critical' ? '▲' : row.status === 'stressed' ? '◆' : row.status === 'adequate' ? '●' : '?'
  return <Badge tone={tone}><span aria-hidden="true">{icon}</span>{row.statusLabel}</Badge>
}

export default function NearbyNeeds({ initialType }: { initialType: string | null }) {
  const { workspace, analysis, role, refresh } = useAuth()
  const [selectedType, setSelectedType] = useState<NearbyAssetType>(initialType && Object.hasOwn(NEARBY_TYPE_LABELS, initialType) ? initialType as NearbyAssetType : 'streetlight')
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [deleting, setDeleting] = useState<NearbyAsset | null>(null)
  if (!workspace || !analysis) return null
  const selected = analysis.nearby.find((row) => row.type === selectedType)!
  const selectedFinding = analysis.findings.find((finding) => finding.id === `nearby-${selected.type}`)
  const admin = role === 'admin'
  const remove = async () => {
    if (!deleting) return
    await api.deleteRecord('nearbyAssets', deleting.id)
    await refresh()
  }

  return (
    <div className="space-y-6 break-words">
      <Panel kicker="Five types · Nearby area" title="Nearby public infrastructure" actions={admin ? (
        <button type="button" className="rounded bg-violet px-3 py-2 text-sm font-semibold text-ivory focus-ring" onClick={() => setDraft({ type: selectedType, distanceBasis: 'estimated', basis: 'estimated' })}>Add nearby asset</button>
      ) : undefined}>
        <p className="mb-3 text-sm text-ivory/70">{NEARBY_RULE_LABEL}. These records belong to {workspace.activeCollege.name}; they are not the shared public asset register.</p>
        {!admin && <p className="mb-3 text-sm text-ivory/60">Read-only records. Only this college’s administrator can add, edit or delete.</p>}
        {workspace.dataset.nearbyAssets.length === 0 && (
          <EmptyPanel title="No nearby asset data yet"><p>No condition has been recorded. All five types remain Not enough data.</p></EmptyPanel>
        )}
        <div className="overflow-x-auto">
          <table className="block w-full border-collapse text-left sm:table">
            <caption className="sr-only">Nearby types with recorded condition, estimated daily users and status</caption>
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-violet/30">
                <th className="py-2 pr-3 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Type</th>
                <th className="py-2 pr-3 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Demand / condition</th>
                <th className="py-2 text-right font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Status</th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {analysis.nearby.map((row) => (
                <tr key={row.type} className={`flex flex-wrap items-center gap-x-3 border-b border-violet/15 py-3 align-top last:border-0 sm:table-row sm:py-0 ${row.type === selectedType ? 'bg-violet/10' : ''}`}>
                  <td className="order-1 py-0 sm:py-3 sm:pr-3">
                    <button type="button" onClick={() => setSelectedType(row.type)} aria-pressed={row.type === selectedType} className="text-left text-sm font-semibold text-ivory hover:text-violet-bright focus-ring">{row.label}</button>
                  </td>
                  <td className="order-3 w-full pt-1 text-sm text-ivory/70 sm:w-auto sm:py-3 sm:pr-3">{row.demand}</td>
                  <td className="order-2 ml-auto sm:py-3 sm:text-right"><Status row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel kicker="Why?" title={`${selected.label} — ${selected.statusLabel}`}>
        <p className="mb-3 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
          Rule-based explanation — not AI
        </p>
        <div className="space-y-3 text-sm leading-relaxed text-ivory/75">
          <p>
            {selected.total} {selected.total === 1 ? 'record' : 'records'}: {selected.good} Good, {selected.fair} Fair,{' '}
            {selected.poor} Poor, {selected.unknown} Not recorded.
          </p>
          <p>{selected.recorded === 0 ? 'There are no recorded conditions to assess.' : `${selected.poor} of ${selected.recorded} recorded conditions are Poor. Unknown conditions are not counted in this denominator.`}</p>
          <p className="font-semibold text-ivory">{NEARBY_RULE_LABEL}</p>
          <details className="border-y border-violet/20 py-3">
            <summary className="cursor-pointer font-semibold text-violet-bright focus-ring">How is this calculated?</summary>
            <p className="mt-3">{NEARBY_RULE}</p>
          </details>
          <p>
            Estimated daily users: {selected.dailyUsers === null ? 'Not entered' : `${selected.dailyUsers}${selected.usersMissing ? ' (partial total)' : ''}`}.{' '}
            {formatMissingNearbyUserCount(selected.usersMissing)} This is not a count of unique people.
          </p>
        </div>
        {selectedFinding && <div className="mt-4"><FindingExplainer finding={selectedFinding} compact /></div>}
        <ul className="mt-4 divide-y divide-violet/20">
          {selected.records.map((asset) => (
            <li key={asset.id} className="space-y-2 py-4 text-sm leading-relaxed text-ivory/75 first:pt-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-ivory break-words">{asset.locationDescription}</h3><Badge tone="neutral">{titleCase(asset.basis)}</Badge></div>
              <p>Distance: {asset.distanceMetres} m · {titleCase(asset.distanceBasis)}. Condition: {asset.condition ? titleCase(asset.condition) : 'Not recorded'}.</p>
              <p>Estimated daily users: {asset.dailyUsers ?? 'Not entered'}. How obtained: {formatNearbyUsersMethod(asset.usersMethod)}</p>
              <p>Responsible authority: {asset.responsibleAuthority}</p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/dashboard/issues-maintenance?nearbyAsset=${encodeURIComponent(asset.id)}`} className="rounded border border-violet/40 px-3 py-2 text-sm text-violet-bright focus-ring">Report to {asset.responsibleAuthority}</Link>
                {admin && <>
                  <button type="button" onClick={() => setDraft({ ...asset })} className="rounded border border-violet/40 px-3 py-2 text-sm text-violet-bright focus-ring">Edit asset</button>
                  <button type="button" onClick={() => setDeleting(asset)} className="rounded border border-violet/40 px-3 py-2 text-sm text-status-error-dark focus-ring">Delete asset</button>
                </>}
              </div>
            </li>
          ))}
        </ul>
        {selected.records.length === 0 && <p className="mt-4 text-sm text-ivory/60">No records of this type. {admin ? 'Use Add nearby asset to record one.' : 'Ask this college’s administrator to record one.'}</p>}
        <p className="mt-3 text-xs text-ivory/55">Reporting opens a draft for review. Saving creates a public issue visible inside this college only, including its description and photo; no message is sent to the authority.</p>
      </Panel>
      {draft && <RecordDialog open onClose={() => setDraft(null)} entity="nearbyAssets" title={draft.id ? 'Edit nearby asset' : 'Add nearby asset'} description="Use recorded information only. Illustrative data must stay labelled Illustrative." fields={fields} initial={draft} onSaved={refresh} />}
      <ConfirmDialog open={Boolean(deleting)} title="Delete nearby asset?" message={deleting ? `Delete “${deleting.locationDescription}”? This removes the college record, not any shared public issue.` : ''} onConfirm={remove} onClose={() => setDeleting(null)} />
    </div>
  )
}
