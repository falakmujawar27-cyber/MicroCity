/**
 * Production entry point: serves the built SPA and the MicroCity API from one
 * origin. Development uses `npm run dev` (Vite mounts the same API plugin).
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { createMicrocityApp } from './app.ts'
import { createDatabase } from './db.ts'

const port = Number(process.env.PORT ?? 8787)
const distDir = resolve(process.env.MICROCITY_DIST ?? 'dist')
const dbPath = process.env.MICROCITY_DB ?? resolve('server/data/microcity.sqlite')
const db = createDatabase(dbPath)
const app = createMicrocityApp({ db })

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '),
}

function serveFile(
  path: string,
  method: string,
  res: import('node:http').ServerResponse,
  cacheControl: string,
): void {
  const stats = statSync(path)
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': cacheControl,
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path).pipe(res)
}

async function handleRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (await app.handle(req, res)) return

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Method not allowed')
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Bad request')
    return
  }

  const indexPath = resolve(distDir, 'index.html')
  if (!existsSync(indexPath)) {
    res.writeHead(503, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('MicroCity is not built yet. Run "npm run build" first, or use "npm run dev".')
    return
  }

  const requested = pathname === '/' ? '/index.html' : pathname
  const candidate = resolve(distDir, `.${requested}`)
  const insideDist = candidate === distDir || candidate.startsWith(distDir + sep)
  if (!insideDist) {
    res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    const cacheControl = requested.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : requested.startsWith('/images/')
        ? 'public, max-age=86400'
        : 'no-cache'
    serveFile(candidate, req.method, res, cacheControl)
    return
  }

  if (extname(requested) && !requested.endsWith('.html')) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  serveFile(indexPath, req.method, res, 'no-cache')
}

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error('[microcity]', error)
    if (!res.headersSent) {
      res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    }
    res.end('Internal server error')
  })
})

server.listen(port, () => {
  console.log(`MicroCity running at http://localhost:${port}`)
  console.log(`SQLite database: ${dbPath}`)
  console.log(`AI explanation proxy: ${app.aiConfigured ? 'configured' : 'not configured (rule-based fallback only)'}`)
})

function shutdown(): void {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
