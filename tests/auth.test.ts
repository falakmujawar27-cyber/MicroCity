import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase } from '../server/db.ts'

interface RunningApp {
  url: string
  server: Server
  close: () => Promise<void>
}

async function startApp(env: NodeJS.ProcessEnv = {}): Promise<RunningApp> {
  const db = createDatabase(':memory:', true)
  const app = createMicrocityApp({ db, env })
  const server = createServer((req, res) => {
    void app
      .handle(req, res)
      .then((handled) => {
        if (!handled && !res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      })
      .catch((error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
        }
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }))
      })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The test server did not bind a port.')
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function sessionCookie(response: Response): string | null {
  const header = response.headers.get('set-cookie')
  if (!header) return null
  return header.split(';')[0] ?? null
}

async function login(
  app: RunningApp,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown>; cookie: string | null }> {
  const response = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as Record<string, unknown>
  return { status: response.status, payload, cookie: sessionCookie(response) }
}

describe('sign-in role check', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('rejects a chosen role that does not match the account and sets no session', async () => {
    const result = await login(app, {
      username: 'sample-maintenance',
      password: 'sample-maintenance-pass',
      collegeId: 'clg-bv',
      role: 'student',
    })
    assert.equal(result.status, 403)
    assert.equal(result.payload.error, 'This account is not a student account.')
    assert.equal(result.payload.code, 'role-mismatch')
    assert.equal(result.cookie, null)
  })

  it('signs in when the chosen role matches the account', async () => {
    const result = await login(app, {
      username: 'sample-maintenance',
      password: 'sample-maintenance-pass',
      collegeId: 'clg-bv',
      role: 'maintenance',
    })
    assert.equal(result.status, 200)
    assert.ok(result.cookie?.startsWith('mc_session='))
  })
})

describe('college membership re-check', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('answers 403 when a signed-in user sends another college id', async () => {
    const result = await login(app, {
      username: 'sample-student',
      password: 'sample-student-pass',
      collegeId: 'clg-bv',
      role: 'student',
    })
    assert.equal(result.status, 200)
    assert.ok(result.cookie)

    const workspace = await fetch(`${app.url}/api/workspace`, {
      headers: { Cookie: result.cookie, 'X-College-Id': 'clg-fd' },
    })
    const payload = (await workspace.json()) as Record<string, unknown>
    assert.equal(workspace.status, 403)
    assert.equal(payload.code, 'college-forbidden')
  })

  it('answers 403 when signing in to a college the account does not belong to', async () => {
    const result = await login(app, {
      username: 'sample-student',
      password: 'sample-student-pass',
      collegeId: 'clg-fd',
      role: 'student',
    })
    assert.equal(result.status, 403)
    assert.equal(result.payload.code, 'college-forbidden')
    assert.equal(result.cookie, null)
  })
})

describe('self-registration', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('requires a college code', async () => {
    const response = await fetch(`${app.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'new-student',
        displayName: 'New Student',
        password: 'long-enough-pass',
        role: 'student',
      }),
    })
    const payload = (await response.json()) as { fieldErrors?: Record<string, string> }
    assert.equal(response.status, 422)
    assert.equal(payload.fieldErrors?.collegeCode, 'Enter the college code.')
  })

  it('rejects an unknown college code', async () => {
    const response = await fetch(`${app.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'new-student',
        displayName: 'New Student',
        password: 'long-enough-pass',
        collegeCode: 'NOT-A-COLLEGE',
        role: 'student',
      }),
    })
    const payload = (await response.json()) as { fieldErrors?: Record<string, string> }
    assert.equal(response.status, 422)
    assert.equal(payload.fieldErrors?.collegeCode, 'That college code is not recognised.')
  })

  it('creates a student account with a valid college code', async () => {
    const response = await fetch(`${app.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'new-student',
        displayName: 'New Student',
        password: 'long-enough-pass',
        collegeCode: 'VIDYA-NAGAR',
        role: 'student',
      }),
    })
    const payload = (await response.json()) as {
      session?: { memberships: { collegeId: string; role: string }[] }
    }
    assert.equal(response.status, 201)
    assert.ok(sessionCookie(response))
    assert.equal(payload.session?.memberships[0]?.collegeId, 'clg-bv')
    assert.equal(payload.session?.memberships[0]?.role, 'student')
  })

  it('refuses to self-register a staff role', async () => {
    const response = await fetch(`${app.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'new-admin',
        displayName: 'New Admin',
        password: 'long-enough-pass',
        collegeCode: 'VIDYA-NAGAR',
        role: 'admin',
      }),
    })
    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 422)
    assert.equal(payload.error, 'Self-registration is available for student and faculty accounts only.')
  })
})

describe('admin-created staff accounts', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('refuses staff creation for a non-administrator', async () => {
    const session = await login(app, {
      username: 'sample-estates',
      password: 'sample-estates-pass',
      collegeId: 'clg-bv',
      role: 'estates',
    })
    const response = await fetch(`${app.url}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.cookie ?? '' },
      body: JSON.stringify({
        username: 'new-maintenance',
        displayName: 'New Technician',
        password: 'long-enough-pass',
        role: 'maintenance',
      }),
    })
    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 403)
    assert.equal(payload.error, 'Only an administrator can create staff accounts.')
  })

  it('lets an administrator create a maintenance account that can then sign in', async () => {
    const session = await login(app, {
      username: 'sample-admin',
      password: 'sample-admin-pass',
      collegeId: 'clg-bv',
      role: 'admin',
    })
    const created = await fetch(`${app.url}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.cookie ?? '' },
      body: JSON.stringify({
        username: 'new-maintenance',
        displayName: 'New Technician',
        password: 'long-enough-pass',
        role: 'maintenance',
      }),
    })
    const payload = (await created.json()) as { members: { id: string; role: string }[] }
    assert.equal(created.status, 201)
    assert.ok(payload.members.some((member) => member.role === 'maintenance'))

    const signIn = await login(app, {
      username: 'new-maintenance',
      password: 'long-enough-pass',
      collegeId: 'clg-bv',
      role: 'maintenance',
    })
    assert.equal(signIn.status, 200)
    assert.ok(signIn.cookie?.startsWith('mc_session='))
  })

  it('refuses to create a student or faculty account through the staff endpoint', async () => {
    const session = await login(app, {
      username: 'sample-admin',
      password: 'sample-admin-pass',
      collegeId: 'clg-bv',
      role: 'admin',
    })
    const response = await fetch(`${app.url}/api/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.cookie ?? '' },
      body: JSON.stringify({
        username: 'new-student-via-admin',
        displayName: 'New Student',
        password: 'long-enough-pass',
        role: 'student',
      }),
    })
    const payload = (await response.json()) as { error?: string }
    assert.equal(response.status, 422)
    assert.equal(payload.error, 'Staff accounts must be administrator, estates or maintenance.')
  })
})

describe('demo accounts endpoint', () => {
  it('returns no accounts unless DEMO_MODE is true', async () => {
    const app = await startApp()
    try {
      const response = await fetch(`${app.url}/api/auth/demo`)
      const payload = (await response.json()) as { enabled: boolean; accounts: unknown[] }
      assert.equal(payload.enabled, false)
      assert.deepEqual(payload.accounts, [])
    } finally {
      await app.close()
    }
  })

  it('lists one account per role when DEMO_MODE is true', async () => {
    const app = await startApp({ DEMO_MODE: 'true' })
    try {
      const response = await fetch(`${app.url}/api/auth/demo`)
      const payload = (await response.json()) as {
        enabled: boolean
        accounts: { role: string; username: string; password: string; collegeId: string }[]
      }
      assert.equal(payload.enabled, true)
      assert.deepEqual(
        payload.accounts.map((account) => account.role).sort(),
        ['admin', 'estates', 'faculty', 'maintenance', 'student'],
      )
      for (const account of payload.accounts) {
        assert.equal(account.collegeId, 'clg-bv')
        assert.equal(account.password, `${account.username}-pass`)
      }
    } finally {
      await app.close()
    }
  })
})
