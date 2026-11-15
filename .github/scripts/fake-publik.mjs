// A fake publik on this computer, for the iOS sign-in sheet test (CI only; no packages).
//
// The test-hooks build of Lunara points at it with PUBLIK_API_BASE_URL=http://localhost:8787/api/v1.
// It answers the calls the gate makes: POST /api/v1/installs, GET /api/v1/wallet, the claim page,
// POST /api/v1/telemetry. An install is "anonymous" until CLAIM_AFTER_MS after its claim page opened
// in the sheet (or after POST /test/claim-later, which the test calls when the app prints that the
// sheet opened). Then it says "claimed", as publik does after the person signs in. It prints one
// line per event with the time in milliseconds; it never prints a key.
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const ORIGIN = `http://localhost:${PORT}`
const CLAIM_AFTER_MS = Number(process.env.CLAIM_AFTER_MS ?? 20_000)

/** key -> { code, installId, state, claimTimer } */
const installs = new Map()
/** claim code -> key */
const codes = new Map()

function log(line) {
  console.log(`fake-publik: ${line} at=${Date.now()}`)
}

function newInstall(key, installId) {
  const code = randomBytes(4).toString('hex').toUpperCase()
  const entry = { code, installId: installId || randomUUID(), state: 'anonymous', claimTimer: null }
  installs.set(key, entry)
  codes.set(code, key)
  return entry
}

function claimLater(entry, why) {
  if (entry.state === 'claimed' || entry.claimTimer) return
  log(`claim in ${CLAIM_AFTER_MS} ms (${why}) code=${entry.code}`)
  entry.claimTimer = setTimeout(() => {
    entry.state = 'claimed'
    log(`claimed code=${entry.code}`)
  }, CLAIM_AFTER_MS)
}

function wallet(entry) {
  const claimed = entry.state === 'claimed'
  return {
    claim_state: entry.state,
    claim_url: claimed ? null : `${ORIGIN}/claim/${entry.code}`,
    account: claimed ? { handle: 'sheet-test' } : null,
    plan: { kind: 'none', label: null },
    balance_micros: 0,
    top_up_url: `${ORIGIN}/wallet`,
    linked_at: claimed ? new Date().toISOString() : null,
    install_id: entry.installId,
  }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const bearer = /^Bearer (pk_\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null

  if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true })

  if (req.method === 'POST' && path === '/api/v1/installs') {
    const body = await readBody(req)
    const key = `pk_test_${randomBytes(12).toString('hex')}`
    const entry = newInstall(key, typeof body.install_id === 'string' ? body.install_id : '')
    log(`install created code=${entry.code}`)
    return send(res, 201, {
      key,
      install_id: entry.installId,
      claim_url: `${ORIGIN}/claim/${entry.code}`,
      claim_state: 'anonymous',
      base_url: `${ORIGIN}/api/v1`,
      balance_micros: 0,
    })
  }

  if (req.method === 'GET' && path === '/api/v1/wallet') {
    if (!bearer) return send(res, 401, { error: { type: 'invalid_key', message: 'This key is not valid.' } })
    // A key from an earlier run (the Keychain outlives the app): treat it as a new anonymous install.
    const entry = installs.get(bearer) ?? newInstall(bearer, '')
    log(`wallet ${entry.state} code=${entry.code}`)
    return send(res, 200, wallet(entry))
  }

  const claim = /^\/(?:in-app\/)?claim\/([A-Z0-9]+)$/.exec(path)
  if (req.method === 'GET' && claim) {
    const key = codes.get(claim[1])
    const entry = key ? installs.get(key) : null
    log(`claim page opened code=${claim[1]} known=${Boolean(entry)} in_app=${url.searchParams.get('in_app') ?? ''}`)
    if (entry) claimLater(entry, 'claim page opened')
    return send(
      res,
      200,
      '<!doctype html><meta name="viewport" content="width=device-width"><title>Sign in</title><p>Signing in to the fake publik. This page stays open; the app closes it.</p>',
      'text/html; charset=utf-8',
    )
  }

  if (req.method === 'POST' && path === '/test/claim-later') {
    for (const entry of installs.values()) claimLater(entry, 'the app opened the sheet')
    return send(res, 200, { ok: true })
  }

  if (req.method === 'POST' && (path === '/api/v1/telemetry' || path === '/api/v1/installs/revoke')) {
    res.writeHead(204)
    return res.end()
  }

  log(`not found ${req.method} ${path}`)
  return send(res, 404, { error: { type: 'not_found', message: 'Not found.' } })
})

server.listen(PORT, () => log(`listening on ${ORIGIN}`))
