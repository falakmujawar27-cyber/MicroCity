import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { NEARBY_TYPE_LABELS } from '../../domain/types'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Tabs from '../../components/ui/Tabs'
import Stat from '../../components/ui/Stat'
import { Badge, SeverityBadge, StatusBadge } from '../../components/ui/Badge'
import BasisTag from '../../components/ui/BasisTag'
import Notice from '../../components/ui/Notice'
import RecordDialog from '../../components/ui/RecordDialog'
import type { FormField } from '../../components/ui/RecordDialog'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Modal from '../../components/ui/Modal'
import FindingExplainer from '../../components/dashboard/FindingExplainer'
import { EmptyPanel } from '../../components/ui/PageState'
import { api } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { formatDate, formatDateTime, titleCase } from '../../lib/format'
import { COMPLAINT_CATEGORIES, ROLE_LABELS, URBAN_CATEGORY_LABELS } from '../../domain/types'
import { COMPLAINT_DESCRIPTION_MIN } from '../../domain/complaint-rules'
import type { Complaint, UrbanIssue } from '../../domain/types'
import type { Finding as AnalysisFinding } from '../../domain/analysis'

type TabId = 'issues' | 'priority' | 'inspections' | 'activity'
type IssueSourceFilter = 'all' | 'campus' | 'public'
type IssueStatusFilter = 'all' | 'open' | 'in_progress' | 'resolved' | 'closed'
type IssuePriorityFilter = 'all' | 'P1' | 'P2' | 'P3' | 'P4' | 'unranked'

type IssueItem =
  | { source: 'campus'; at: string; complaint: Complaint }
  | { source: 'public'; at: string; issue: UrbanIssue }

interface Editor {
  entity: string
  initial: Record<string, unknown> | null
  title: string
  size?: 'md' | 'lg' | 'xl'
}

interface PendingDelete {
  entity: string
  id: string
  label: string
}

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const COMPLAINT_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

const URBAN_STATUS_OPTIONS = [
  { value: 'reported', label: 'Reported' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

const rowActionClass = 'rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring'

function Photo({ complaint, kind }: { complaint: Complaint; kind: 'report' | 'completion' }) {
  const has = kind === 'completion' ? complaint.hasCompletionPhoto : complaint.hasPhoto
  if (!has) return null
  const name = kind === 'completion' ? complaint.completionPhotoName : complaint.photoName
  const label = kind === 'completion' ? 'After photo' : 'Attached photo'
  return (
    <figure className="mt-3 max-w-xs">
      <img
        src={api.complaintPhotoUrl(complaint.id, kind, complaint.collegeId)}
        alt={`${label}${name ? `: ${name}` : ''}`}
        className="border border-violet/30 object-cover"
      />
      <figcaption className="mt-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ivory/40">
        {label} — {name ?? 'unnamed'}
      </figcaption>
    </figure>
  )
}

function PublicPhoto({ name, dataUrl }: { name: string | null; dataUrl: string | null }) {
  if (!dataUrl) return null
  return (
    <figure className="mt-3 max-w-xs">
      <img src={dataUrl} alt={`Attached photo: ${name ?? 'issue photo'}`} className="border border-violet/30 object-cover" />
      <figcaption className="mt-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ivory/40">
        Attached photo — {name ?? 'unnamed'}
      </figcaption>
    </figure>
  )
}

export default function IssuesMaintenance() {
  const { workspace, analysis, refresh, can, role, session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<TabId>('issues')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [explained, setExplained] = useState<AnalysisFinding | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<IssueSourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<IssuePriorityFilter>('all')
  const [weightsDraft, setWeightsDraft] = useState({ severity: '40', condition: '4', usersAffected: '1', daysOpen: '1' })
  const [weightsBusy, setWeightsBusy] = useState(false)
  const [weightsError, setWeightsError] = useState<string | null>(null)
  const [weightsSaved, setWeightsSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!workspace) return
    setWeightsDraft({
      severity: String(workspace.priorityWeights.severity),
      condition: String(workspace.priorityWeights.condition),
      usersAffected: String(workspace.priorityWeights.usersAffected),
      daysOpen: String(workspace.priorityWeights.daysOpen),
    })
  }, [workspace?.priorityWeights.updatedAt])

  useEffect(() => {
    const assetId = searchParams.get('nearbyAsset')
    if (!assetId || !workspace) return
    const asset = workspace.dataset.nearbyAssets.find((item) => item.id === assetId)
    if (asset) {
      setEditor({ entity: 'urbanIssues', title: 'Report a public infrastructure issue', size: 'lg', initial: {
        category: NEARBY_TYPE_LABELS[asset.type], severity: asset.condition === 'poor' ? 'high' : 'medium',
        locationLabel: asset.locationDescription, authority: asset.responsibleAuthority,
        description: `${NEARBY_TYPE_LABELS[asset.type]}: condition ${asset.condition ?? 'Not recorded'}. Distance from college gate: ${asset.distanceMetres} m (${asset.distanceBasis}). Basis: ${asset.basis}. Please review and describe the issue before saving.`,
      } })
    }
    setSearchParams({}, { replace: true })
  }, [searchParams, workspace, setSearchParams])

  if (!workspace || !analysis || !role || !session) return null
  const data = workspace.dataset
  const staff = role === 'admin' || role === 'estates'
  const maintainer = role === 'maintenance'
  const personal = role === 'faculty' || role === 'student'
  const myId = session.user.id

  const buildingsById = new Map(data.buildings.map((building) => [building.id, building]))
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]))
  const assetsById = new Map(data.assets.map((asset) => [asset.id, asset]))
  const urbanAssetsById = new Map(data.urbanAssets.map((asset) => [asset.id, asset]))
  const membersById = new Map(workspace.members.map((member) => [member.id, member]))

  const priorityById = new Map(analysis.maintenance.ranked.map((ranked) => [ranked.complaintId, ranked]))
  const findingById = new Map(analysis.findings.map((finding) => [finding.id, finding]))
  const updatesByComplaint = new Map<string, typeof data.complaintUpdates>()
  for (const update of data.complaintUpdates) {
    const list = updatesByComplaint.get(update.complaintId) ?? []
    list.push(update)
    updatesByComplaint.set(update.complaintId, list)
  }

  const complaints = (mineOnly ? data.complaints.filter((complaint) => complaint.reporterId === myId) : data.complaints)
    .slice()
    .sort((a, b) => {
      if (staff || maintainer) {
        const aScore = priorityById.get(a.id)?.score ?? -1
        const bScore = priorityById.get(b.id)?.score ?? -1
        if (aScore !== bScore) return bScore - aScore
      }
      return b.raisedAt.localeCompare(a.raisedAt)
    })

  const publicIssues = [...data.urbanIssues].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
  const inspections = [...data.inspections].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))

  const issueItems: IssueItem[] = [
    ...complaints.map((complaint): IssueItem => ({ source: 'campus', at: complaint.raisedAt, complaint })),
    ...publicIssues.map((issue): IssueItem => ({ source: 'public', at: issue.reportedAt, issue })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const itemStatus = (item: IssueItem) =>
    item.source === 'campus' ? item.complaint.status : item.issue.status === 'reported' ? 'open' : item.issue.status
  const itemBand = (item: IssueItem) =>
    item.source === 'campus' ? priorityById.get(item.complaint.id)?.band ?? null : null
  const filteredItems = issueItems.filter((item) => {
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
    if (statusFilter !== 'all' && itemStatus(item) !== statusFilter) return false
    if (priorityFilter !== 'all') {
      const band = itemBand(item)
      if (priorityFilter === 'unranked' ? band !== null : band !== priorityFilter) return false
    }
    return true
  })

  const tabs = [
    { id: 'issues', label: personal ? 'My reports' : 'All issues', count: data.complaints.length + data.urbanIssues.length },
    ...(staff || maintainer ? [{ id: 'priority', label: 'Maintenance priority', count: analysis.maintenance.ranked.length }] : []),
    ...(staff || maintainer ? [{ id: 'inspections', label: 'Inspections', count: data.inspections.length }] : []),
    { id: 'activity', label: 'Activity & audit', count: data.complaintUpdates.length + workspace.audit.length },
  ]

  const buildingOptions = [...data.buildings]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((building) => ({ value: building.id, label: building.name }))
  const assetOptions = data.assets.map((asset) => ({ value: asset.id, label: asset.name }))
  const assetsForBuilding = (buildingId: string) =>
    data.assets
      .filter((asset) => !buildingId || !asset.buildingId || asset.buildingId === buildingId)
      .map((asset) => ({ value: asset.id, label: asset.name }))
  const roomsForBuilding = (buildingId: string) =>
    buildingId
      ? [...data.rooms]
          .filter((room) => room.buildingId === buildingId)
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((room) => ({ value: room.id, label: `${room.code} — ${room.name ?? 'room'}` }))
      : []
  const urbanAssetOptions = data.urbanAssets.map((asset) => ({
    value: asset.id,
    label: `${URBAN_CATEGORY_LABELS[asset.category]} — ${asset.name ?? asset.locationLabel ?? 'unnamed'}`,
  }))
  const assigneeOptions = workspace.members
    .filter((member) => member.role === 'maintenance' || member.role === 'estates')
    .map((member) => ({ value: member.id, label: `${member.displayName} — ${ROLE_LABELS[member.role]}` }))
  const inspectorOptions = workspace.members
    .filter((member) => member.role === 'maintenance' || member.role === 'estates' || member.role === 'admin')
    .map((member) => ({ value: member.id, label: `${member.displayName} — ${ROLE_LABELS[member.role]}` }))

  const targetLabel = (complaint: Complaint) => {
    const building = complaint.buildingId ? buildingsById.get(complaint.buildingId) : null
    const place = building?.name ?? complaint.buildingId ?? null
    if (complaint.roomId) {
      const room = roomsById.get(complaint.roomId)
      return [place, room ? `Room ${room.code}` : 'Room (not in view)'].filter(Boolean).join(' · ')
    }
    if (complaint.assetId) {
      const asset = assetsById.get(complaint.assetId)
      return [place, asset?.name ?? 'Asset (not in view)'].filter(Boolean).join(' · ')
    }
    return place ? `${place} · Room not sure` : 'No specific target'
  }

  const complaintCreateFields = (): FormField[] => [
    { key: 'category', label: 'Category', type: 'select', required: true, options: COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: c })) },
    { key: 'severity', label: 'Severity', type: 'select', required: true, options: SEVERITY_OPTIONS },
    { key: 'buildingId', label: 'Building', type: 'select', required: true, options: buildingOptions, help: 'Choose the building where the problem is.' },
    {
      key: 'roomChoice',
      label: 'Do you know the room?',
      type: 'select',
      required: true,
      options: [
        { value: 'room', label: 'Yes — I know the room' },
        { value: 'not_sure', label: 'Not sure — building only' },
      ],
    },
    {
      key: 'roomId',
      label: 'Room',
      type: 'select',
      required: true,
      showWhen: (values) => values.roomChoice === 'room',
      options: (values) => roomsForBuilding(values.buildingId ?? ''),
      help: 'Rooms in the selected building. Choose a room or an asset, not both.',
    },
    {
      key: 'assetId',
      label: 'Asset (optional)',
      type: 'select',
      options: (values) => assetsForBuilding(values.buildingId ?? ''),
      help: 'Link a recorded asset in this building, or leave empty.',
    },
    {
      key: 'description',
      label: 'What is wrong?',
      type: 'textarea',
      required: true,
      minLength: COMPLAINT_DESCRIPTION_MIN,
      placeholder: 'Say what is wrong, where, and when you noticed it. Avoid naming individuals.',
      help: `At least ${COMPLAINT_DESCRIPTION_MIN} characters. Vague entries such as “broken” are rejected.`,
    },
    { key: 'peopleAffected', label: 'People affected', type: 'integer', help: 'Optional. Leave empty if unknown; it is not treated as zero.' },
    { key: 'photo', label: 'Photo (optional)', type: 'photo', help: 'PNG, JPEG or WebP, up to about 1.1 MB.' },
  ]

  const complaintEditFields = (): FormField[] => {
    if (maintainer) {
      return [
        { key: 'status', label: 'Status', type: 'select', required: true, options: COMPLAINT_STATUS_OPTIONS },
        { key: 'note', label: 'Work note', type: 'textarea', help: 'Recorded in the complaint timeline.' },
      ]
    }
    return [
      { key: 'status', label: 'Status', type: 'select', required: true, options: COMPLAINT_STATUS_OPTIONS },
      { key: 'assignedToUserId', label: 'Assigned to', type: 'select', options: assigneeOptions, help: 'Only maintenance or estates members can be assigned.' },
      { key: 'category', label: 'Category', type: 'select', required: true, options: COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: c })) },
      { key: 'severity', label: 'Severity', type: 'select', required: true, options: SEVERITY_OPTIONS },
      { key: 'description', label: 'Description', type: 'textarea', required: true, minLength: COMPLAINT_DESCRIPTION_MIN, help: `At least ${COMPLAINT_DESCRIPTION_MIN} characters; say what is wrong, where and when.` },
      { key: 'peopleAffected', label: 'People affected', type: 'integer' },
      { key: 'note', label: 'Update note', type: 'textarea', help: 'Recorded in the complaint timeline. Required (at least 10 characters) when marking Fixed or closing without a repair.' },
    ]
  }

  const publicIssueCreateFields = (): FormField[] => [
    { key: 'category', label: 'Issue category', type: 'text', required: true, placeholder: 'e.g. Broken street light' },
    { key: 'severity', label: 'Severity', type: 'select', required: true, options: SEVERITY_OPTIONS },
    { key: 'locationLabel', label: 'Location', type: 'text', required: true, placeholder: 'Street, junction or landmark' },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'urbanAssetId', label: 'Linked public asset', type: 'select', options: urbanAssetOptions, help: 'Optional. Link to a recorded street-lighting, footway or other asset.' },
    { key: 'authority', label: 'Responsible authority', type: 'text', help: 'Optional. The council or body that owns the asset.' },
    { key: 'photo', label: 'Photo (optional)', type: 'photo' },
  ]

  const inspectionFields = (): FormField[] => {
    if (maintainer) {
      return [
        { key: 'status', label: 'Status', type: 'select', required: true, options: [
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ] },
        { key: 'completedAt', label: 'Completed at', type: 'datetime', help: 'Required when marking the inspection completed.' },
        { key: 'findings', label: 'Findings', type: 'textarea' },
      ]
    }
    return [
      { key: 'assetId', label: 'Asset', type: 'select', required: true, options: assetOptions },
      { key: 'status', label: 'Status', type: 'select', required: true, options: [
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ] },
      { key: 'scheduledFor', label: 'Scheduled for', type: 'datetime', required: true },
      { key: 'completedAt', label: 'Completed at', type: 'datetime' },
      { key: 'inspectorUserId', label: 'Inspector', type: 'select', options: inspectorOptions },
      { key: 'findings', label: 'Findings', type: 'textarea' },
    ]
  }

  const remove = async () => {
    if (!pendingDelete) return
    await api.deleteRecord(pendingDelete.entity, pendingDelete.id)
    await refresh()
  }

  const saveWeights = async () => {
    setWeightsBusy(true)
    setWeightsError(null)
    setWeightsSaved(null)
    try {
      await api.savePriorityWeights({
        severity: Number(weightsDraft.severity),
        condition: Number(weightsDraft.condition),
        usersAffected: Number(weightsDraft.usersAffected),
        daysOpen: Number(weightsDraft.daysOpen),
      })
      await refresh()
      setWeightsSaved('Maintenance priority weights saved. The ranking below has been recalculated with them; the change is in the audit trail.')
    } catch (err) {
      setWeightsError(err instanceof Error ? err.message : 'The weights could not be saved.')
    } finally {
      setWeightsBusy(false)
    }
  }

  const canEditComplaint = (complaint: Complaint) => {
    if (staff) return true
    if (maintainer) return complaint.assignedToUserId === myId
    return false
  }
  const canEditInspection = (inspectionId: string) => {
    if (staff) return true
    if (!maintainer) return false
    const inspection = data.inspections.find((item) => item.id === inspectionId)
    return inspection?.inspectorUserId === myId
  }

  const statusCounts = data.complaints.reduce(
    (counts, complaint) => {
      counts[complaint.status] += 1
      return counts
    },
    { open: 0, in_progress: 0, resolved: 0, closed: 0 },
  )

  return (
    <div>
      <PageHeading
        kicker="Module 04 — Issues & Maintenance"
        title="Reports, work and resolution"
        description={
          personal
            ? 'Report campus problems and public infrastructure issues. Your campus reports are private to you and the staff who resolve them; public issues are shared.'
            : 'Campus complaints, public issues, inspections and repeat problems. The priority order suggests what to look at first; it is not a safety assessment.'
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open" value={statusCounts.open} detail={`${statusCounts.in_progress} in progress`} tone={statusCounts.open > 0 ? 'high' : 'default'} />
        <Stat label="Resolved or closed" value={statusCounts.resolved + statusCounts.closed} detail="Retained with their full history" tone="good" />
        <Stat
          label={staff || maintainer ? 'Active maintenance work' : 'My open reports'}
          value={
            staff || maintainer
              ? analysis.maintenance.activeCount
              : data.complaints.filter((c) => c.reporterId === myId && (c.status === 'open' || c.status === 'in_progress')).length
          }
          detail={staff || maintainer ? `${analysis.maintenance.repeats.length} repeat group(s)` : 'Visible only to you and staff'}
        />
        <Stat label="Open public issues" value={publicIssues.filter((issue) => issue.status === 'reported' || issue.status === 'in_progress').length} detail={`${data.urbanIssues.length} shared report(s) in total`} />
      </div>

      {personal && (
        <Notice tone="info" className="mb-6">
          Campus reports are private to you and to the staff who resolve them. Public infrastructure reports are
          shared with every signed-in user. Your role cannot change report status; staff resolve work.
        </Notice>
      )}

      <Panel
        actions={
          tab === 'issues' ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditor({ entity: 'complaints', initial: null, title: 'Report a campus problem', size: 'lg' })}
                className="rounded-md bg-violet px-3.5 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
              >
                Report a problem
              </button>
              <button
                type="button"
                onClick={() => setEditor({ entity: 'urbanIssues', initial: null, title: 'Report a public infrastructure issue', size: 'lg' })}
                className="rounded-md border border-violet/50 px-3.5 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/15 focus-ring"
              >
                Report public issue
              </button>
            </div>
          ) : null
        }
      >
        <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} label="Issues and maintenance views" />

        <div className="mt-6">
          {tab === 'issues' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs text-ivory/60">
                  Source
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value as IssueSourceFilter)}
                    className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-sm text-ivory focus-ring"
                  >
                    <option value="all">Campus and public</option>
                    <option value="campus">Campus only</option>
                    <option value="public">Public only</option>
                  </select>
                </label>
                <label className="block text-xs text-ivory/60">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as IssueStatusFilter)}
                    className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-sm text-ivory focus-ring"
                  >
                    <option value="all">All statuses</option>
                    <option value="open">Open / reported</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className="block text-xs text-ivory/60">
                  Maintenance priority
                  <select
                    value={priorityFilter}
                    onChange={(event) => setPriorityFilter(event.target.value as IssuePriorityFilter)}
                    className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-sm text-ivory focus-ring"
                  >
                    <option value="all">All priorities</option>
                    <option value="P1">P1</option>
                    <option value="P2">P2</option>
                    <option value="P3">P3</option>
                    <option value="P4">P4</option>
                    <option value="unranked">Not ranked (public or closed)</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ivory/50">
                <span>
                  Showing {filteredItems.length} of {issueItems.length} issue{issueItems.length === 1 ? '' : 's'}.
                  Campus and public records are in one list; the source tag on each card says which it is.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSourceFilter('all')
                    setStatusFilter('all')
                    setPriorityFilter('all')
                  }}
                  className="font-semibold text-violet-bright underline underline-offset-4 hover:text-ivory focus-ring"
                >
                  Clear filters
                </button>
              </div>
              {staff && (
                <label className="flex items-center gap-2 text-xs text-ivory/60">
                  <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} className="accent-[#5245f8]" />
                  Show only reports I raised
                </label>
              )}
              {filteredItems.length === 0 ? (
                <EmptyPanel title={personal ? 'No reports match these filters' : 'No issues match these filters'}>
                  {personal ? 'Use “Report a problem” to describe what you observed, or clear the filters.' : 'Change the filters to see campus and public records.'}
                </EmptyPanel>
              ) : (
                <ul className="space-y-3">
                  {filteredItems.map((item) => {
                    if (item.source === 'public') {
                      const issue = item.issue
                      return (
                        <li key={issue.id} className="border border-violet/25 bg-ink/40 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone="outline">Public</Badge>
                                <SeverityBadge severity={issue.severity} />
                                <StatusBadge status={issue.status} />
                                <Badge tone="neutral">Shared · not college-owned</Badge>
                                {issue.reporterId === myId && <Badge tone="violet">Reported by you</Badge>}
                              </div>
                              <p className="mt-2 text-sm text-ivory">{issue.description}</p>
                              <p className="mt-1 text-xs text-ivory/50">
                                {issue.category} · {issue.locationLabel} · reported {formatDateTime(issue.reportedAt)}
                                {issue.reporterName ? ` by ${issue.reporterName}` : ''}
                              </p>
                              <p className="mt-0.5 text-xs text-ivory/45">
                                Authority: {issue.authority ?? 'Not recorded'}
                                {issue.urbanAssetId ? ` · asset: ${urbanAssetsById.get(issue.urbanAssetId)?.name ?? issue.urbanAssetId}` : ''}
                                {issue.resolvedAt ? ` · resolved ${formatDateTime(issue.resolvedAt)}` : ''}
                              </p>
                              {issue.note && <p className="mt-2 border-l border-violet/30 pl-2 text-xs text-ivory/60">{issue.note}</p>}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {staff || maintainer ? (
                                <button
                                  type="button"
                                  className={rowActionClass}
                                  onClick={() => setEditor({ entity: 'urbanIssues', initial: issue as unknown as Record<string, unknown>, title: 'Update public issue', size: 'md' })}
                                >
                                  Update status
                                </button>
                              ) : null}
                              {role === 'admin' && (
                                <button
                                  type="button"
                                  className={rowActionClass}
                                  onClick={() => setPendingDelete({ entity: 'urbanIssues', id: issue.id, label: `public issue “${issue.description.slice(0, 60)}”` })}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                          <PublicPhoto name={issue.photoName} dataUrl={issue.photoDataUrl} />
                        </li>
                      )
                    }
                    const complaint = item.complaint
                    const ranked = priorityById.get(complaint.id)
                    const finding = findingById.get(`maintenance-${complaint.id}`)
                    const updates = [...(updatesByComplaint.get(complaint.id) ?? [])].sort((a, b) => a.at.localeCompare(b.at))
                    return (
                      <li key={complaint.id} className="border border-violet/25 bg-ink/40 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="violet">Campus</Badge>
                              <BasisTag basis={complaint.basis} />
                              <SeverityBadge severity={complaint.severity} />
                              <StatusBadge status={complaint.status} />
                              {ranked && (
                                <Badge tone={ranked.band === 'P1' ? 'error' : ranked.band === 'P2' ? 'warn' : 'violet'}>
                                  {ranked.bandLabel} · {ranked.score} priority points
                                </Badge>
                              )}
                              {complaint.reporterId === myId && <Badge tone="outline">Raised by you</Badge>}
                            </div>
                            <p className="mt-2 text-sm text-ivory">{complaint.description}</p>
                            <p className="mt-1 text-xs text-ivory/50">
                              {complaint.category} · {targetLabel(complaint)} · raised {formatDateTime(complaint.raisedAt)}
                              {complaint.reporterName ? ` by ${complaint.reporterName}` : ''}
                            </p>
                            <p className="mt-0.5 text-xs text-ivory/45">
                              Assigned to: {complaint.assignedToUserId ? (complaint.assignedToName ?? membersById.get(complaint.assignedToUserId)?.displayName ?? complaint.assignedToUserId) : 'Not yet assigned'}
                              {complaint.resolvedAt ? ` · resolved ${formatDateTime(complaint.resolvedAt)}` : ''}
                            </p>
                            {complaint.status === 'closed' && !complaint.resolvedAt && (
                              <p className="mt-1 border-l-2 border-status-error-dark pl-2 text-xs text-ivory/70">
                                <span className="font-semibold text-status-error-dark">Closed without repair.</span>{' '}
                                {complaint.closedReason ? `Reason given: ${complaint.closedReason}` : 'No reason was recorded.'}
                              </p>
                            )}
                            {(complaint.status === 'resolved' || (complaint.status === 'closed' && complaint.resolvedAt)) &&
                              complaint.completionNote && (
                                <p className="mt-1 border-l-2 border-status-ok-dark pl-2 text-xs text-ivory/70">
                                  <span className="font-semibold text-status-ok-dark">What was done:</span>{' '}
                                  {complaint.completionNote}
                                </p>
                              )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {canEditComplaint(complaint) && (
                              <button
                                type="button"
                                className={rowActionClass}
                                onClick={() => setEditor({ entity: 'complaints', initial: complaint as unknown as Record<string, unknown>, title: 'Update complaint', size: 'lg' })}
                              >
                                {maintainer ? 'Update work' : 'Update'}
                              </button>
                            )}
                            {role === 'admin' && (
                              <button
                                type="button"
                                className={rowActionClass}
                                onClick={() => setPendingDelete({ entity: 'complaints', id: complaint.id, label: complaint.description.slice(0, 80) })}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>

                        <Photo complaint={complaint} kind="report" />
                        <Photo complaint={complaint} kind="completion" />

                        <details className="mt-3 border-t border-violet/20 pt-2">
                          <summary className="cursor-pointer font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright focus-ring">
                            Priority details &amp; timeline ({updates.length})
                          </summary>
                          {ranked && (
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div>
                                <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">What the priority points use</p>
                                <ul className="mt-1 space-y-1 text-xs">
                                  {ranked.components.map((component) => (
                                    <li key={component.key} className="flex justify-between gap-3">
                                      <span className="text-ivory/60">{component.label}: {component.detail}</span>
                                      <span className="shrink-0 font-mono text-ivory">{component.available ? `+${component.points}` : 'n/a'}</span>
                                    </li>
                                  ))}
                                </ul>
                                <p className="mt-2 text-[0.6875rem] leading-relaxed text-ivory/45">
                                  People affected is the number the reporter entered, not an estimate. It adds{' '}
                                  {workspace.priorityWeights.usersAffected} point(s) per 10 people, capped at 15; days
                                  open adds {workspace.priorityWeights.daysOpen} point(s) per 3 days, capped at 15.
                                </p>
                              </div>
                              <div>
                                <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">History</p>
                                <ol className="mt-1 space-y-2 text-xs">
                                  {updates.length === 0 && <li className="text-ivory/45">No events recorded.</li>}
                                  {updates.map((update) => (
                                    <li key={update.id} className="border-l border-violet/30 pl-2">
                                      <p className="text-ivory/70">{update.note}</p>
                                      <p className="text-[0.625rem] text-ivory/40">
                                        {update.actorName} · {formatDateTime(update.at)}
                                        {update.toStatus ? ` · ${update.fromStatus ?? '—'} → ${update.toStatus}` : ''}
                                      </p>
                                    </li>
                                  ))}
                                </ol>
                              </div>
                            </div>
                          )}
                          {!ranked && updates.length > 0 && (
                            <ol className="mt-3 space-y-2 text-xs">
                              {updates.map((update) => (
                                <li key={update.id} className="border-l border-violet/30 pl-2">
                                  <p className="text-ivory/70">{update.note}</p>
                                  <p className="text-[0.625rem] text-ivory/40">{update.actorName} · {formatDateTime(update.at)}</p>
                                </li>
                              ))}
                            </ol>
                          )}
                          {finding && (
                            <button
                              type="button"
                              onClick={() => setExplained(finding)}
                              className="mt-3 rounded border border-gold/50 px-2 py-1 font-mono text-[0.5625rem] uppercase tracking-widest text-gold hover:bg-gold/10 focus-ring"
                            >
                              How is this calculated?
                            </button>
                          )}
                        </details>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === 'priority' && (staff || maintainer) && (
            <div className="space-y-6">
              <div className="min-w-0 border border-violet/25 bg-ink/40 p-4">
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Maintenance priority weights</p>
                <p className="mt-1 text-xs leading-relaxed text-ivory/55">
                  These four weights feed the maintenance priority score. Severity is the maximum for a critical
                  complaint; condition applies to a linked asset in poor condition; users affected adds points per 10
                  people; days open adds points per 3 days. Status, repeat and asset-criticality points stay fixed.
                  Missing data is never scored as zero.
                </p>
                {role === 'admin' ? (
                  <div className="mt-3">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <label className="block text-xs text-ivory/60">
                        Severity (critical = max)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={weightsDraft.severity}
                          onChange={(event) => setWeightsDraft((current) => ({ ...current, severity: event.target.value }))}
                          className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                        />
                      </label>
                      <label className="block text-xs text-ivory/60">
                        Condition (poor asset)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={weightsDraft.condition}
                          onChange={(event) => setWeightsDraft((current) => ({ ...current, condition: event.target.value }))}
                          className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                        />
                      </label>
                      <label className="block text-xs text-ivory/60">
                        Users affected (per 10)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={weightsDraft.usersAffected}
                          onChange={(event) => setWeightsDraft((current) => ({ ...current, usersAffected: event.target.value }))}
                          className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                        />
                      </label>
                      <label className="block text-xs text-ivory/60">
                        Days open (per 3 days)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={weightsDraft.daysOpen}
                          onChange={(event) => setWeightsDraft((current) => ({ ...current, daysOpen: event.target.value }))}
                          className="mt-1 min-h-10 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={weightsBusy}
                        onClick={() => void saveWeights()}
                        className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {weightsBusy ? 'Saving…' : 'Save weights'}
                      </button>
                      <span className="text-xs text-ivory/45">
                        Administrators only. Every change is audited with the old and new weights.
                      </span>
                    </div>
                    {weightsError && <Notice tone="danger" className="mt-3">{weightsError}</Notice>}
                    {weightsSaved && <Notice tone="success" className="mt-3">{weightsSaved}</Notice>}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ivory/50">
                    Read-only for your role. Current weights: severity {workspace.priorityWeights.severity}, condition{' '}
                    {workspace.priorityWeights.condition}, users affected {workspace.priorityWeights.usersAffected} per
                    10 people, days open {workspace.priorityWeights.daysOpen} per 3 days
                    {workspace.priorityWeights.updatedByName
                      ? `; last changed by ${workspace.priorityWeights.updatedByName} on ${formatDateTime(workspace.priorityWeights.updatedAt as string)}`
                      : '; recorded defaults, no administrator change yet'}
                    .
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Maintenance priority order</p>
                <p className="mt-1 text-xs leading-relaxed text-ivory/50">
                  Severity, condition, people affected, days open, status, repeat history and linked-asset risk. Missing
                  people counts are marked unavailable, not scored as zero. This orders the work; it is not a safety
                  assessment.
                </p>
                {analysis.maintenance.ranked.length === 0 ? (
                  <p className="mt-3 text-sm text-ivory/55">No active complaints are visible to your role.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {analysis.maintenance.ranked.map((ranked) => {
                      const finding = findingById.get(`maintenance-${ranked.complaintId}`)
                      return (
                        <li key={ranked.complaintId} className="border border-violet/25 bg-ink/40 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={ranked.band === 'P1' ? 'error' : ranked.band === 'P2' ? 'warn' : 'violet'}>
                                {ranked.bandLabel}
                              </Badge>
                              <span className="font-mono text-sm text-ivory">{ranked.score} points</span>
                              <span className="text-sm text-ivory">{ranked.category}</span>
                              <span className="text-[0.625rem] text-ivory/40">
                                {titleCase(ranked.severity)} · {titleCase(ranked.status)}
                              </span>
                            </div>
                            {finding && (
                              <button type="button" className={rowActionClass} onClick={() => setExplained(finding)}>
                                How?
                              </button>
                            )}
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-ivory/75">{ranked.description}</p>
                          <p className="mt-1 text-xs text-ivory/45">
                            {ranked.targetLabel} · {ranked.ageDays} day(s) open ·{' '}
                            {ranked.assignedToUserId
                              ? membersById.get(ranked.assignedToUserId)?.displayName ?? 'Assigned'
                              : 'Unassigned'}
                          </p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Repeat patterns (180 days)</p>
                  {analysis.maintenance.repeats.length === 0 ? (
                    <p className="mt-2 text-sm text-ivory/55">No campus repeat groups were found.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {analysis.maintenance.repeats.map((repeat) => (
                        <li key={repeat.id} className="border border-violet/25 p-3 text-sm">
                          <p className="text-ivory">{repeat.targetLabel} — {repeat.category}</p>
                          <p className="mt-1 text-xs text-ivory/50">
                            {repeat.count} report(s), {repeat.openCount} still open · last {formatDate(repeat.lastAt)} · {repeat.windowDays}-day window
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Inspection alerts</p>
                  {analysis.maintenance.inspectionAlerts.length === 0 ? (
                    <p className="mt-2 text-sm text-ivory/55">No inspection alerts.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {analysis.maintenance.inspectionAlerts.map((alert) => (
                        <li key={alert.id} className="border border-violet/25 p-3 text-sm">
                          <div className="flex items-center gap-2">
                            <SeverityBadge severity={alert.severity} />
                            <span className="text-ivory">{alert.assetName}</span>
                          </div>
                          <p className="mt-1 text-xs text-ivory/55">{alert.detail}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <details className="border-t border-violet/20 pt-3">
                <summary className="cursor-pointer font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">How is this calculated?</summary>
                <ul className="mt-2 space-y-2 text-xs leading-relaxed text-ivory/50">
                  {analysis.maintenance.methods.map((method, index) => <li key={index}>• {method}</li>)}
                </ul>
              </details>
            </div>
          )}

          {tab === 'inspections' && (staff || maintainer) && (
            <div className="space-y-4">
              {analysis.maintenance.inspectionAlerts.length > 0 && (
                <Notice tone="warning" title={`${analysis.maintenance.inspectionAlerts.length} inspection alert(s)`}>
                  Overdue, due-soon and missing-completion alerts are listed under Maintenance priority. Completion
                  times are never invented — a completed inspection without a recorded time stays flagged.
                </Notice>
              )}
              {inspections.length === 0 ? (
                <EmptyPanel title="No inspections in view">
                  {maintainer ? 'No inspections are assigned to you.' : 'Schedule inspections from the Inventory module.'}
                </EmptyPanel>
              ) : (
                <ul className="space-y-2">
                  {inspections.map((inspection) => (
                    <li key={inspection.id} className="border border-violet/25 bg-ink/40 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-ivory">{assetsById.get(inspection.assetId)?.name ?? 'Asset not in view'}</p>
                          <p className="mt-0.5 text-xs text-ivory/45">
                            Scheduled {formatDateTime(inspection.scheduledFor)} ·{' '}
                            {inspection.inspectorUserId
                              ? membersById.get(inspection.inspectorUserId)?.displayName ?? 'Staff member'
                              : 'Unassigned'}
                          </p>
                        </div>
                        {canEditInspection(inspection.id) && (
                          <button
                            type="button"
                            className={rowActionClass}
                            onClick={() => setEditor({ entity: 'inspections', initial: inspection as unknown as Record<string, unknown>, title: 'Update inspection', size: 'md' })}
                          >
                            {maintainer ? 'Record outcome' : 'Edit'}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={inspection.status} />
                        <span className="text-xs text-ivory/50">
                          Completed: {inspection.completedAt ? formatDateTime(inspection.completedAt) : 'not recorded'}
                        </span>
                      </div>
                      {inspection.findings && (
                        <p className="mt-1 text-xs leading-relaxed text-ivory/60">{inspection.findings}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="space-y-6">
              <div>
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Complaint timeline</p>
                {data.complaintUpdates.length === 0 ? (
                  <p className="mt-2 text-sm text-ivory/55">No complaint events are visible.</p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {[...data.complaintUpdates]
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .slice(0, 40)
                      .map((update) => {
                        const complaint = data.complaints.find((item) => item.id === update.complaintId)
                        return (
                          <li key={update.id} className="border-l-2 border-violet/30 pl-3 text-sm">
                            <p className="text-ivory/75">{update.note}</p>
                            <p className="mt-0.5 text-xs text-ivory/45">
                              {update.actorName} · {formatDateTime(update.at)} · {titleCase(update.kind)}
                              {complaint ? ` · ${complaint.category}` : ''}
                              {update.toStatus ? ` · ${update.fromStatus ?? '—'} → ${update.toStatus}` : ''}
                            </p>
                          </li>
                        )
                      })}
                  </ol>
                )}
              </div>

              {can('view-audit') && (
                <div className="border-t border-violet/20 pt-4">
                  <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Workspace audit log</p>
                  <p className="mt-1 text-xs text-ivory/45">
                    Server-recorded actions for this college. The full log is in the Data Centre.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {workspace.audit.slice(0, 20).map((entry) => (
                      <li key={entry.id} className="text-xs text-ivory/60">
                        <span className="font-mono text-ivory/40">{formatDateTime(entry.at)}</span> · {entry.actorName} — {entry.detail}
                      </li>
                    ))}
                    {workspace.audit.length === 0 && <li className="text-xs text-ivory/45">No audit entries in view.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      {editor && (
        <RecordDialog
          open
          onClose={() => setEditor(null)}
          entity={editor.entity}
          title={editor.title}
          description={
            editor.entity === 'urbanIssues' && !editor.initial?.id
              ? 'Review before saving. This creates a public issue visible inside this college only, including its description and photo. Do not include personal information. Nothing is sent to the authority.'
              : editor.entity === 'complaints' && editor.initial
              ? maintainer
                ? 'Maintenance staff can update the status and add a work note on assigned complaints.'
                : 'Status changes and assignments are recorded in the complaint timeline.'
              : undefined
          }
          size={editor.size ?? 'lg'}
          fields={
            editor.entity === 'complaints'
              ? editor.initial
                ? complaintEditFields()
                : complaintCreateFields()
              : editor.entity === 'urbanIssues'
                ? editor.initial?.id
                  ? [
                      { key: 'status', label: 'Status', type: 'select', required: true, options: URBAN_STATUS_OPTIONS },
                      { key: 'note', label: 'Resolution / update note', type: 'textarea', help: 'Visible on the shared public issue.' },
                    ]
                  : publicIssueCreateFields()
                : inspectionFields()
          }
          initial={editor.initial}
          onSaved={refresh}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this record?"
        message={pendingDelete ? `“${pendingDelete.label}” will be permanently removed. This cannot be undone.` : ''}
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />

      <Modal open={Boolean(explained)} onClose={() => setExplained(null)} title="How this is calculated" description="What the score uses, what it cannot tell you, and an optional written summary." size="lg">
        {explained && <FindingExplainer finding={explained} methods={analysis.maintenance.methods} />}
      </Modal>
    </div>
  )
}
