import type {
  AttendanceReason,
  AttendanceRecord,
  ImportOutcome,
  ImportSheetInput,
  Inspection,
  InspectionResult,
  RegisterInput,
  SessionInfo,
  UserRole,
  UserSummary,
  WorkspacePayload,
} from '../domain/types'
import type { JobBoard, JobCard } from '../domain/jobs'

export class ApiError extends Error {
  status: number
  fieldErrors: Record<string, string>
  code: string | null
  retryAfterSeconds: number | null

  constructor(
    message: string,
    status: number,
    options: { fieldErrors?: Record<string, string>; code?: string | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = options.fieldErrors ?? {}
    this.code = options.code ?? null
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}

export type AiTask = 'explain-finding' | 'report-summary' | 'option-comparison' | 'categorise-issue' | 'ask-data'

export interface AiAssistResponse {
  ok: boolean
  configured: boolean
  text: string | null
  model: string | null
  error?: string
  label?: string
  checkedAt?: string
}

export interface ImportRequest {
  fileName: string
  mode: 'append' | 'replace'
  sheets: ImportSheetInput[]
  confirmReplace: boolean
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  collegeId?: string | null
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.collegeId) headers['X-College-Id'] = options.collegeId

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(
      'Could not reach the MicroCity server. Start the app with “npm run dev” and try again.',
      0,
    )
  }

  const raw = await response.text()
  let payload: Record<string, unknown> = {}
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>
      }
    } catch {
      throw new ApiError('The server returned an unreadable response.', response.status)
    }
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new Event('microcity:unauthorized'))
    }
    throw new ApiError(
      typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`,
      response.status,
      {
        fieldErrors:
          payload.fieldErrors && typeof payload.fieldErrors === 'object'
            ? (payload.fieldErrors as Record<string, string>)
            : {},
        code: typeof payload.code === 'string' ? payload.code : null,
        retryAfterSeconds:
          typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : null,
      },
    )
  }

  return payload as T
}

export const api = {
  login(username: string, password: string, collegeId?: string, role?: UserRole) {
    return request<{ session: SessionInfo }>('/auth/login', {
      method: 'POST',
      body: { username, password, collegeId, role },
    })
  },

  demoAccounts() {
    return request<{
      enabled: boolean
      accounts: {
        role: UserRole
        username: string
        password: string
        collegeId: string
        collegeName: string
      }[]
    }>('/auth/demo')
  },

  register(input: RegisterInput) {
    return request<{ session: SessionInfo }>('/auth/register', {
      method: 'POST',
      body: input,
    })
  },

  logout() {
    return request<{ ok: true }>('/auth/logout', { method: 'POST' })
  },

  me() {
    return request<{ session: SessionInfo | null }>('/auth/me')
  },

  colleges() {
    return request<{ colleges: { id: string; name: string }[] }>('/colleges')
  },

  workspace(collegeId: string) {
    return request<WorkspacePayload>('/workspace', { collegeId })
  },

  aiStatus() {
    return request<{ configured: boolean; model: string | null; label: string }>('/ai/status')
  },

  aiAssist(input: { task: AiTask; facts: unknown; question?: string }) {
    return request<AiAssistResponse>('/ai/assist', { method: 'POST', body: input })
  },

  createRecord<T>(entity: string, data: Record<string, unknown>) {
    return request<{ record: T }>(`/records/${entity}`, { method: 'POST', body: { data } })
  },

  updateRecord<T>(entity: string, id: string, data: Record<string, unknown>) {
    return request<{ record: T; meta?: Record<string, unknown> }>(
      `/records/${entity}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { data } },
    )
  },

  deleteRecord(entity: string, id: string) {
    return request<{ ok: true }>(`/records/${entity}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  createDecision(data: {
    optionId: string
    title: string
    ownerUserId?: string | null
    followUp?: string
    notes?: string
  }) {
    return request<{ record: unknown }>('/decisions', { method: 'POST', body: { data } })
  },

  updateDecision(
    id: string,
    data: Partial<{ title: string; status: string; ownerUserId: string | null; followUp: string; notes: string }>,
  ) {
    return request<{ record: unknown }>(`/decisions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { data },
    })
  },

  createMember(input: { username: string; displayName: string; password: string; role: UserRole }) {
    return request<{ members: UserSummary[] }>('/members', { method: 'POST', body: input })
  },

  updateMemberRole(userId: string, role: UserRole) {
    return request<{ members: UserSummary[] }>(`/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: { role },
    })
  },

  importPreview(payload: ImportRequest) {
    return request<ImportOutcome>('/import/preview', { method: 'POST', body: payload })
  },

  importApply(payload: ImportRequest) {
    return request<ImportOutcome>('/import', { method: 'POST', body: payload })
  },

  saveAttendance(input: {
    slotId: string
    sessionDate: string
    present: number
    reasons: AttendanceReason[]
  }) {
    return request<{ record: AttendanceRecord; created: boolean }>('/attendance', {
      method: 'POST',
      body: input,
    })
  },

  jobBoard(collegeId?: string | null) {
    return request<JobBoard>('/jobs', { collegeId })
  },

  startJob(id: string, collegeId?: string | null) {
    return request<{ job: JobCard }>(`/jobs/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      body: {},
      collegeId,
    })
  },

  completeJob(
    id: string,
    input: { note: string; photoName?: string | null; photoDataUrl?: string | null },
    collegeId?: string | null,
  ) {
    return request<{ job: JobCard }>(`/jobs/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: input,
      collegeId,
    })
  },

  recordInspection(
    input: { inspectionId: string; result: InspectionResult; note: string },
    collegeId?: string | null,
  ) {
    return request<{ inspection: Inspection }>('/inspections/record', {
      method: 'POST',
      body: input,
      collegeId,
    })
  },
}
