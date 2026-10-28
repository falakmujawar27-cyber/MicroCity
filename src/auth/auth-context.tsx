/**
 * Server-backed session context.
 *
 * The cookie session is the only source of identity. The active college is
 * resolved from the signed-in user's memberships and sent as X-College-Id on
 * every workspace request; the API re-checks membership and role server-side.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import type { Capability } from '../domain/permissions'
import { hasCapability } from '../domain/permissions'
import type {
  RegisterInput,
  SessionInfo,
  UserRole,
  WorkspacePayload,
} from '../domain/types'
import type { AnalysisBundle } from '../domain/analysis'
import { analyseWorkspace } from '../domain/analysis'

const COLLEGE_STORAGE_KEY = 'microcity.active-college'

interface AiState {
  configured: boolean
  model: string | null
}

interface AuthContextValue {
  session: SessionInfo | null
  workspace: WorkspacePayload | null
  analysis: AnalysisBundle | null
  activeCollegeId: string | null
  role: UserRole | null
  ready: boolean
  loadingWorkspace: boolean
  error: string | null
  ai: AiState | null
  can: (capability: Capability) => boolean
  signIn: (
    username: string,
    password: string,
    collegeId?: string,
    role?: UserRole,
  ) => Promise<{ ok: boolean; error?: string }>
  register: (input: RegisterInput) => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<void>
  switchCollege: (collegeId: string) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function pickCollege(session: SessionInfo, preferred: string | null): string | null {
  if (preferred && session.memberships.some((m) => m.collegeId === preferred)) return preferred
  return session.memberships[0]?.collegeId ?? null
}

function readStoredCollege(): string | null {
  try {
    return window.localStorage.getItem(COLLEGE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null)
  const [activeCollegeId, setActiveCollegeId] = useState<string | null>(null)
  const [ai, setAi] = useState<AiState | null>(null)
  const [ready, setReady] = useState(false)
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadWorkspace = useCallback(async (nextSession: SessionInfo, preferred: string | null) => {
    const collegeId = pickCollege(nextSession, preferred)
    if (!collegeId) {
      setSession(nextSession)
      setWorkspace(null)
      setActiveCollegeId(null)
      setError('This account has no college membership. Ask an administrator to add you to a college.')
      return
    }
    setLoadingWorkspace(true)
    setError(null)
    try {
      const [payload, aiState] = await Promise.all([
        api.workspace(collegeId),
        api.aiStatus().catch(() => null),
      ])
      if (!mounted.current) return
      setSession(nextSession)
      setWorkspace(payload)
      setActiveCollegeId(collegeId)
      setAi(aiState ? { configured: aiState.configured, model: aiState.model } : null)
      try {
        window.localStorage.setItem(COLLEGE_STORAGE_KEY, collegeId)
      } catch {
        /* storage may be unavailable; the in-memory selection still works */
      }
    } catch (err) {
      if (!mounted.current) return
      setSession(nextSession)
      setWorkspace(null)
      setActiveCollegeId(collegeId)
      setError(
        err instanceof ApiError
          ? err.message
          : 'The workspace could not be loaded. Check the server and try again.',
      )
    } finally {
      if (mounted.current) setLoadingWorkspace(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await api.me()
        if (cancelled) return
        if (result.session) {
          await loadWorkspace(result.session, readStoredCollege())
        }
      } catch {
        /* A missing or expired session simply means signed out. */
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadWorkspace])

  useEffect(() => {
    const onUnauthorized = () => {
      setSession(null)
      setWorkspace(null)
      setActiveCollegeId(null)
      setAi(null)
      setError(null)
    }
    window.addEventListener('microcity:unauthorized', onUnauthorized)
    return () => window.removeEventListener('microcity:unauthorized', onUnauthorized)
  }, [])

  const signIn = useCallback(
    async (username: string, password: string, collegeId?: string, role?: UserRole) => {
      try {
        const { session: nextSession } = await api.login(username, password, collegeId, role)
        await loadWorkspace(nextSession, readStoredCollege())
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof ApiError ? err.message : 'Sign-in failed. Try again.',
        }
      }
    },
    [loadWorkspace],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      try {
        const { session: nextSession } = await api.register(input)
        await loadWorkspace(nextSession, nextSession.memberships[0]?.collegeId ?? null)
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof ApiError ? err.message : 'Account creation failed. Try again.',
        }
      }
    },
    [loadWorkspace],
  )

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* Clearing local state still signs the browser out of this view. */
    }
    setSession(null)
    setWorkspace(null)
    setActiveCollegeId(null)
    setAi(null)
    setError(null)
    try {
      window.localStorage.removeItem(COLLEGE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const switchCollege = useCallback(
    async (collegeId: string) => {
      if (!session || collegeId === activeCollegeId) return
      await loadWorkspace(session, collegeId)
    },
    [session, activeCollegeId, loadWorkspace],
  )

  const refresh = useCallback(async () => {
    if (!session || !activeCollegeId) return
    await loadWorkspace(session, activeCollegeId)
  }, [session, activeCollegeId, loadWorkspace])

  const role = workspace?.activeCollege.role ?? session?.memberships[0]?.role ?? null

  const analysis = useMemo(() => {
    if (!workspace) return null
    return analyseWorkspace(workspace.dataset, workspace.serverTime)
  }, [workspace])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      workspace,
      analysis,
      activeCollegeId,
      role,
      ready,
      loadingWorkspace,
      error,
      ai,
      can: (capability) => (role ? hasCapability(role, capability) : false),
      signIn,
      register,
      signOut,
      switchCollege,
      refresh,
    }),
    [session, workspace, analysis, activeCollegeId, role, ready, loadingWorkspace, error, ai, signIn, register, signOut, switchCollege, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
