import { useState } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Tabs from '../../components/ui/Tabs'
import RecordDialog from '../../components/ui/RecordDialog'
import type { FormField } from '../../components/ui/RecordDialog'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { EmptyPanel } from '../../components/ui/PageState'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import { api } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { formatDate, formatDateTime, formatNumber, titleCase } from '../../lib/format'
import { ASSET_CATEGORIES, ROLE_LABELS, URBAN_CATEGORY_LABELS } from '../../domain/types'
import type { UrbanAssetCategory } from '../../domain/types'

type TabId = 'buildings' | 'rooms' | 'assets' | 'inspections' | 'timetable' | 'public'

interface Editor {
  entity: string
  initial: Record<string, unknown> | null
  title: string
}

interface PendingDelete {
  entity: string
  id: string
  label: string
}

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
]

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const thClass = 'whitespace-nowrap px-3 py-2 text-left font-mono text-[0.625rem] uppercase tracking-widest text-gold/80'
const tdClass = 'px-3 py-2.5 align-top text-sm text-ivory/75'
const rowActionClass = 'rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring'

function value(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

export default function Inventory() {
  const { workspace, refresh, can, role } = useAuth()
  const [tab, setTab] = useState<TabId>('buildings')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const canManage = can('manage-inventory')
  const canPublic = role === 'admin'

  if (!workspace) return null
  const data = workspace.dataset

  const buildingsById = new Map(data.buildings.map((building) => [building.id, building]))
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]))
  const assetsById = new Map(data.assets.map((asset) => [asset.id, asset]))

  const buildingOptions = data.buildings.map((building) => ({ value: building.id, label: building.name }))
  const roomOptions = data.rooms.map((room) => ({
    value: room.id,
    label: `${room.code} — ${buildingsById.get(room.buildingId)?.name ?? 'Unknown building'}`,
  }))
  const assetOptions = data.assets.map((asset) => ({ value: asset.id, label: asset.name }))
  const staffOptions = workspace.members
    .filter((member) => member.role === 'admin' || member.role === 'estates' || member.role === 'maintenance')
    .map((member) => ({ value: member.id, label: `${member.displayName} — ${ROLE_LABELS[member.role]}` }))

  const tabs = [
    { id: 'buildings', label: 'Buildings', count: data.buildings.length },
    { id: 'rooms', label: 'Rooms', count: data.rooms.length },
    { id: 'assets', label: 'Assets', count: data.assets.length },
    { id: 'inspections', label: 'Inspections', count: data.inspections.length },
    { id: 'timetable', label: 'Timetable', count: data.timetableSlots.length },
    { id: 'public', label: 'Public assets', count: data.urbanAssets.length },
  ]

  const openCreate = (entity: string, title: string) => {
    setEditor({ entity, initial: null, title })
  }
  const openEdit = (entity: string, title: string, initial: Record<string, unknown>) => {
    setEditor({ entity, initial, title })
  }

  const save = async () => {
    await refresh()
  }

  const remove = async () => {
    if (!pendingDelete) return
    await api.deleteRecord(pendingDelete.entity, pendingDelete.id)
    await refresh()
  }

  const fieldsFor = (entity: string): FormField[] => {
    switch (entity) {
      case 'buildings':
        return [
          { key: 'name', label: 'Building name', type: 'text', required: true, placeholder: 'e.g. Roeterseiland Building' },
          { key: 'address', label: 'Address', type: 'text', placeholder: 'Optional' },
          { key: 'notes', label: 'Notes', type: 'textarea', help: 'Anything a future reader should know about this building.' },
        ]
      case 'rooms':
        return [
          { key: 'buildingId', label: 'Building', type: 'select', required: true, options: buildingOptions },
          { key: 'code', label: 'Room code', type: 'text', required: true, placeholder: 'e.g. 1.01' },
          { key: 'name', label: 'Room name', type: 'text' },
          { key: 'floor', label: 'Floor', type: 'text' },
          { key: 'areaM2', label: 'Area (m²)', type: 'number' },
          { key: 'capacity', label: 'Seat capacity', type: 'integer', help: 'Leave empty when unknown. Empty stays null, never zero.' },
          { key: 'condition', label: 'Condition', type: 'select', options: CONDITION_OPTIONS },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]
      case 'assets':
        return [
          { key: 'name', label: 'Asset name', type: 'text', required: true },
          { key: 'category', label: 'Category', type: 'select', required: true, options: ASSET_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) })) },
          { key: 'buildingId', label: 'Building', type: 'select', options: buildingOptions, help: 'Leave empty for a campus-wide asset.' },
          { key: 'criticality', label: 'Criticality', type: 'select', options: SEVERITY_OPTIONS },
          { key: 'condition', label: 'Condition', type: 'select', options: CONDITION_OPTIONS },
          { key: 'installedAt', label: 'Installed', type: 'date' },
          { key: 'lastInspectedAt', label: 'Last inspected', type: 'date' },
          { key: 'inspectionIntervalDays', label: 'Inspection interval (days)', type: 'integer' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]
      case 'inspections':
        return [
          { key: 'assetId', label: 'Asset', type: 'select', required: true, options: assetOptions },
          { key: 'status', label: 'Status', type: 'select', required: true, options: [
            { value: 'scheduled', label: 'Scheduled' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
          ] },
          { key: 'scheduledFor', label: 'Scheduled for', type: 'datetime', required: true },
          { key: 'completedAt', label: 'Completed at', type: 'datetime', help: 'Required when the status is completed.' },
          { key: 'inspectorUserId', label: 'Inspector', type: 'select', options: staffOptions },
          { key: 'findings', label: 'Findings', type: 'textarea' },
        ]
      case 'timetableSlots':
        return [
          { key: 'roomId', label: 'Room', type: 'select', required: true, options: roomOptions },
          { key: 'activity', label: 'Activity', type: 'text', required: true },
          { key: 'moduleCode', label: 'Module code', type: 'text' },
          { key: 'startsAt', label: 'Starts at', type: 'datetime', required: true },
          { key: 'endsAt', label: 'Ends at', type: 'datetime', required: true },
          { key: 'expectedAttendance', label: 'Expected attendance', type: 'integer', help: 'Planning demand. Leave empty when not recorded.' },
          { key: 'attendance', label: 'Actual attendance', type: 'integer', help: 'Leave empty when attendance was not recorded.' },
        ]
      case 'urbanAssets':
        return [
          { key: 'category', label: 'Category', type: 'select', required: true, options: (Object.keys(URBAN_CATEGORY_LABELS) as UrbanAssetCategory[]).map((key) => ({ value: key, label: URBAN_CATEGORY_LABELS[key] })) },
          { key: 'name', label: 'Asset name', type: 'text' },
          { key: 'locationLabel', label: 'Location', type: 'text' },
          { key: 'ownerAuthority', label: 'Responsible authority', type: 'text' },
        ]
      default:
        return []
    }
  }

  const entityLabel = (entity: string) =>
    ({
      buildings: 'Building',
      rooms: 'Room',
      assets: 'Asset',
      inspections: 'Inspection',
      timetableSlots: 'Timetable booking',
      urbanAssets: 'Public asset',
    })[entity] ?? 'Record'

  const addLabel = () => {
    switch (tab) {
      case 'buildings': return 'Add building'
      case 'rooms': return 'Add room'
      case 'assets': return 'Add asset'
      case 'inspections': return 'Schedule inspection'
      case 'timetable': return 'Add booking'
      default: return 'Add public asset'
    }
  }

  const currentEntity = () => {
    switch (tab) {
      case 'buildings': return 'buildings'
      case 'rooms': return 'rooms'
      case 'assets': return 'assets'
      case 'inspections': return 'inspections'
      case 'timetable': return 'timetableSlots'
      default: return 'urbanAssets'
    }
  }

  const writable = tab === 'public' ? canPublic : canManage
  const showWritable = canManage || canPublic

  return (
    <div>
      <PageHeading
        kicker="Module 01 — Inventory"
        title="Buildings, rooms and assets"
        description="The register everything else is built on. Records are scoped to this college; public infrastructure assets are shared and editable only by an administrator."
      />

      {!canManage && (
        <p className="mb-6 border border-gold/40 bg-gold/5 px-4 py-3 text-sm text-ivory/70">
          Your role can read this register but not change it. Ask an estates officer or administrator to correct a record.
        </p>
      )}

      <Panel
        actions={
          writable ? (
            <button
              type="button"
              onClick={() => openCreate(currentEntity(), addLabel())}
              className="rounded-md bg-violet px-3.5 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
            >
              {addLabel()}
            </button>
          ) : showWritable ? (
            <Badge tone="outline">Administrator editing only</Badge>
          ) : null
        }
      >
        <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} label="Inventory categories" />

        <div className="mt-6">
          {tab === 'buildings' && (
            data.buildings.length === 0 ? (
              <EmptyPanel title="No buildings recorded">Add the first building to begin the register.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Name</th><th className={thClass}>Address</th><th className={thClass}>Rooms</th><th className={thClass}>Notes</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {data.buildings.map((building) => (
                      <tr key={building.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}><span className="text-ivory">{building.name}</span><span className="mt-0.5 block font-mono text-[0.625rem] text-ivory/35">{building.id}</span></td>
                        <td className={tdClass}>{value(building.address)}</td>
                        <td className={tdClass}>{data.rooms.filter((room) => room.buildingId === building.id).length}</td>
                        <td className={`${tdClass} max-w-xs`}>{value(building.notes)}</td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => openEdit('buildings', 'Edit building', building as unknown as Record<string, unknown>)}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'buildings', id: building.id, label: building.name })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'rooms' && (
            data.rooms.length === 0 ? (
              <EmptyPanel title="No rooms recorded">Add rooms under a building first.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Room</th><th className={thClass}>Building</th><th className={thClass}>Floor</th><th className={thClass}>Area</th><th className={thClass}>Capacity</th><th className={thClass}>Condition</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {data.rooms.map((room) => (
                      <tr key={room.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}><span className="text-ivory">{room.code}</span>{room.name && <span className="block text-xs text-ivory/50">{room.name}</span>}</td>
                        <td className={tdClass}>{value(buildingsById.get(room.buildingId)?.name)}</td>
                        <td className={tdClass}>{value(room.floor)}</td>
                        <td className={tdClass}>{room.areaM2 === null ? 'Not recorded' : `${formatNumber(room.areaM2)} m²`}</td>
                        <td className={tdClass}>{room.capacity === null ? <span className="italic text-ivory/45">Not recorded</span> : room.capacity}</td>
                        <td className={tdClass}>{room.condition ? <Badge tone={room.condition === 'poor' ? 'error' : room.condition === 'fair' ? 'gold' : 'ok'}>{titleCase(room.condition)}</Badge> : <span className="text-ivory/40">Not recorded</span>}</td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => openEdit('rooms', 'Edit room', room as unknown as Record<string, unknown>)}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'rooms', id: room.id, label: `${room.code} — ${room.name ?? 'room'}` })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'assets' && (
            data.assets.length === 0 ? (
              <EmptyPanel title="No assets recorded">Add plant, equipment and other assets here.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Asset</th><th className={thClass}>Category</th><th className={thClass}>Building</th><th className={thClass}>Condition</th><th className={thClass}>Criticality</th><th className={thClass}>Last inspected</th><th className={thClass}>Interval</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {data.assets.map((asset) => (
                      <tr key={asset.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}><span className="text-ivory">{asset.name}</span><span className="mt-0.5 block font-mono text-[0.625rem] text-ivory/35">{asset.id}</span></td>
                        <td className={tdClass}>{titleCase(asset.category)}</td>
                        <td className={tdClass}>{value(asset.buildingId ? buildingsById.get(asset.buildingId)?.name : 'Campus-wide')}</td>
                        <td className={tdClass}>{asset.condition ? <Badge tone={asset.condition === 'poor' ? 'error' : asset.condition === 'fair' ? 'gold' : 'ok'}>{titleCase(asset.condition)}</Badge> : <span className="text-ivory/40">Not recorded</span>}</td>
                        <td className={tdClass}>{asset.criticality ? <Badge tone={asset.criticality === 'critical' ? 'error' : asset.criticality === 'high' ? 'warn' : 'neutral'}>{titleCase(asset.criticality)}</Badge> : <span className="text-ivory/40">Not recorded</span>}</td>
                        <td className={tdClass}>{asset.lastInspectedAt ? formatDate(asset.lastInspectedAt) : <span className="italic text-ivory/45">Not recorded</span>}</td>
                        <td className={tdClass}>{asset.inspectionIntervalDays === null ? '—' : `${asset.inspectionIntervalDays} days`}</td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => openEdit('assets', 'Edit asset', asset as unknown as Record<string, unknown>)}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'assets', id: asset.id, label: asset.name })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'inspections' && (
            data.inspections.length === 0 ? (
              <EmptyPanel title="No inspections scheduled">Schedule inspections against recorded assets so overdue checks can be flagged.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Asset</th><th className={thClass}>Scheduled</th><th className={thClass}>Status</th><th className={thClass}>Completed</th><th className={thClass}>Inspector</th><th className={thClass}>Findings</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {[...data.inspections].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)).map((inspection) => (
                      <tr key={inspection.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}>{value(assetsById.get(inspection.assetId)?.name)}</td>
                        <td className={tdClass}>{formatDateTime(inspection.scheduledFor)}</td>
                        <td className={tdClass}><StatusBadge status={inspection.status} /></td>
                        <td className={tdClass}>{inspection.completedAt ? formatDateTime(inspection.completedAt) : <span className="italic text-ivory/45">Not recorded</span>}</td>
                        <td className={tdClass}>{value(workspace.members.find((member) => member.id === inspection.inspectorUserId)?.displayName)}</td>
                        <td className={`${tdClass} max-w-sm`}>{value(inspection.findings)}</td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => openEdit('inspections', 'Edit inspection', inspection as unknown as Record<string, unknown>)}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'inspections', id: inspection.id, label: `inspection on ${formatDate(inspection.scheduledFor)}` })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'timetable' && (
            data.timetableSlots.length === 0 ? (
              <EmptyPanel title="No timetable bookings recorded">Capacity checks need recorded demand per booking.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Room</th><th className={thClass}>Activity</th><th className={thClass}>Starts</th><th className={thClass}>Ends</th><th className={thClass}>Expected</th><th className={thClass}>Actual</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {[...data.timetableSlots].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((slot) => (
                      <tr key={slot.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}>{value(roomsById.get(slot.roomId)?.code)}</td>
                        <td className={tdClass}><span className="text-ivory">{slot.activity}</span>{slot.moduleCode && <span className="block font-mono text-[0.625rem] text-ivory/40">{slot.moduleCode}</span>}</td>
                        <td className={tdClass}>{formatDateTime(slot.startsAt)}</td>
                        <td className={tdClass}>{formatDateTime(slot.endsAt)}</td>
                        <td className={tdClass}>{slot.expectedAttendance === null ? <span className="italic text-ivory/45">Not recorded</span> : slot.expectedAttendance}</td>
                        <td className={tdClass}>{slot.attendance === null ? <span className="italic text-ivory/45">Not captured</span> : slot.attendance}</td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => openEdit('timetableSlots', 'Edit timetable booking', slot as unknown as Record<string, unknown>)}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'timetableSlots', id: slot.id, label: `${slot.activity} booking` })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'public' && (
            data.urbanAssets.length === 0 ? (
              <EmptyPanel title="No public assets recorded">Street lighting, footways and other shared assets appear here.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Category</th><th className={thClass}>Name</th><th className={thClass}>Location</th><th className={thClass}>Authority</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {data.urbanAssets.map((asset) => (
                      <tr key={asset.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}>{URBAN_CATEGORY_LABELS[asset.category]}</td>
                        <td className={tdClass}>{value(asset.name)}</td>
                        <td className={tdClass}>{value(asset.locationLabel)}</td>
                        <td className={tdClass}>{value(asset.ownerAuthority)}</td>
                        <td className={tdClass}>
                          {canPublic ? (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => openEdit('urbanAssets', 'Edit public asset', asset as unknown as Record<string, unknown>)}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'urbanAssets', id: asset.id, label: asset.name ?? asset.category })}>Delete</button>
                            </div>
                          ) : (
                            <span className="text-xs text-ivory/40">Shared record</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </Panel>

      {editor && (
        <RecordDialog
          open
          onClose={() => setEditor(null)}
          entity={editor.entity}
          title={editor.title}
          description="Fields left empty stay missing — they are never stored as zero."
          fields={fieldsFor(editor.entity)}
          initial={editor.initial}
          onSaved={save}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete ? entityLabel(pendingDelete.entity).toLowerCase() : 'record'}?`}
        message={
          pendingDelete
            ? `“${pendingDelete.label}” will be removed from this college. Deletion is blocked when other records still reference it. This cannot be undone.`
            : ''
        }
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />

      <p className="mt-6 text-xs leading-relaxed text-ivory/40">
        Unit options for meters are managed in Resources. Deleting is guarded by the server: buildings with rooms,
        rooms with bookings or complaints, and assets with inspections cannot be removed until references are cleared.
      </p>
    </div>
  )
}
