// Security regression tests. Requires an ISOLATED local PostgreSQL:
//   docker run -d --rm --name pgtest -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16
//   TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres node --no-warnings scripts/test-security.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

const url = process.env.TEST_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
  console.error('Refusing to run: set TEST_DATABASE_URL to a LOCAL throwaway PostgreSQL.');
  process.exit(1);
}
process.env.DATABASE_URL = url;
process.env.SETUP_TOKEN = 'test-setup-token';

const logged = [];
for (const method of ['log', 'error', 'warn']) { const original = console[method]; console[method] = (...args) => { logged.push(args.join(' ')); original.apply(console, args); }; }

const handler = require('../server');
const { createPool } = require('../db/postgres');
const pool = createPool();
let base;
let server;
let ipCounter = 0;
const newIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

async function call(method, route, { body, cookie, headers = {}, raw, ip } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { ...(raw === undefined && body !== undefined || body ? { 'Content-Type': 'application/json' } : {}), 'x-forwarded-for': ip || newIp(), ...(cookie ? { cookie } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  const text = await response.text();
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  const setCookie = response.headers.get('set-cookie') || '';
  return { status: response.status, json, text, headers: response.headers, cookie: setCookie.split(';')[0], setCookie };
}

let ownerEmail;
let ownerCookie;
let stageId;
const OWNER_PASSWORD = 'OwnerPass-12345';

test('setup', async t => {
  await new Promise(resolve => { server = http.createServer(handler).listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  await call('GET', '/api/admin-setup-status');
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_login_attempts.sql'), 'utf8'));
  ownerEmail = (await pool.query("SELECT email FROM accounts WHERE role = 'owner'")).rows[0].email;
});

test('owner setup requires SETUP_TOKEN', async () => {
  const payload = { email: ownerEmail, password: OWNER_PASSWORD, confirmPassword: OWNER_PASSWORD };
  const ip = newIp();
  assert.equal((await call('POST', '/api/admin-setup', { body: payload, ip })).status, 403);
  assert.equal((await call('POST', '/api/admin-setup', { body: { ...payload, setupToken: 'wrong' }, ip })).status, 403);
  const saved = process.env.SETUP_TOKEN;
  delete process.env.SETUP_TOKEN;
  const disabled = await call('POST', '/api/admin-setup', { body: { ...payload, setupToken: saved } });
  assert.equal(disabled.status, 403);
  assert.match(disabled.json.error, /SETUP_TOKEN/);
  process.env.SETUP_TOKEN = saved;
  const ok = await call('POST', '/api/admin-setup', { body: { ...payload, setupToken: saved } });
  assert.equal(ok.status, 200);
  ownerCookie = ok.cookie;
  assert.equal((await call('POST', '/api/admin-setup', { body: { ...payload, setupToken: saved } })).status, 403, 'setup cannot repeat');
});

test('setup token attempts are rate limited', async () => {
  await pool.query("UPDATE accounts SET needs_setup = 1 WHERE role = 'owner'");
  const ip = newIp();
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/admin-setup', { body: { email: ownerEmail, setupToken: 'x' + i }, ip })).status, 403);
  assert.equal((await call('POST', '/api/admin-setup', { body: { email: ownerEmail, setupToken: 'test-setup-token' }, ip })).status, 429);
  await pool.query("UPDATE accounts SET needs_setup = 0 WHERE role = 'owner'");
});

test('security headers and no-store', async () => {
  const api = await call('GET', '/api/admin-setup-status');
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(api.headers.get('x-frame-options'), 'DENY');
  assert.match(api.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await call('GET', '/../server.js')).status, 404);
  assert.equal((await call('GET', '/server.js')).status, 404);
});

test('owner login, bootstrap, no sensitive fields', async () => {
  const login = await call('POST', '/api/login', { body: { email: ownerEmail, password: OWNER_PASSWORD } });
  assert.equal(login.status, 200);
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Lax/);
  ownerCookie = login.cookie;
  const boot = await call('GET', '/api/bootstrap', { cookie: ownerCookie });
  assert.equal(boot.status, 200);
  assert.doesNotMatch(boot.text, /password_hash|password_salt|"token"/);
  stageId = boot.json.stages[0].id;
});

test('CSRF: cross-site state-changing requests are blocked', async () => {
  const host = new URL(base).host;
  const body = { name: 'CSRF', email: 'csrf@example.com', stageId };
  assert.equal((await call('POST', '/api/agents', { body, cookie: ownerCookie, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/agents', { body, cookie: ownerCookie, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await call('POST', '/api/agents', { body, cookie: ownerCookie, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await call('POST', '/api/login', { body: { email: 'a@b.c', password: 'x' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  const same = await call('POST', '/api/agents', { body, cookie: ownerCookie, headers: { Origin: `http://${host}`, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(same.status, 201);
  assert.equal((await call('GET', '/api/bootstrap', { cookie: ownerCookie, headers: { Origin: 'https://evil.example' } })).status, 200, 'GETs unaffected');
  assert.equal((await call('DELETE', `/api/agents/${same.json.agent.id}`, { cookie: ownerCookie, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('DELETE', `/api/agents/${same.json.agent.id}`, { cookie: ownerCookie })).status, 200);
});

test('payload validation', async () => {
  assert.equal((await call('POST', '/api/recruits', { raw: 'name=x', cookie: ownerCookie, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('POST', '/api/recruits', { raw: '[1]', cookie: ownerCookie, headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await call('POST', '/api/recruits', { raw: 'null', cookie: ownerCookie, headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await call('POST', '/api/recruits', { raw: '{bad', cookie: ownerCookie, headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await call('POST', '/api/recruits', { body: { name: 'x'.repeat(300) }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('POST', '/api/recruits', { body: { name: 'a', notes: 'x'.repeat(300000) }, cookie: ownerCookie })).status, 413);
  assert.equal((await call('POST', '/api/agents', { body: { name: 'Bad', email: 'not-an-email', stageId }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('GET', '/api/agents/a%20b/x')).status, 400);
  assert.equal((await call('GET', '/api/bootcamp%2Fx')).status, 400);
  assert.equal((await call('POST', '/api/login', { body: { email: ownerEmail, password: 'p'.repeat(129) } })).status, 400);
  assert.equal((await call('POST', '/api/account/password', { body: { currentPassword: OWNER_PASSWORD, newPassword: 'n'.repeat(129), confirmPassword: 'n'.repeat(129) }, cookie: ownerCookie })).status, 400);
});

test('URL scheme validation on every create/patch route', async () => {
  const module = await call('POST', '/api/bootcamp/modules', { body: { title: 'M1' }, cookie: ownerCookie });
  assert.equal(module.status, 201);
  const moduleId = (await call('GET', '/api/bootstrap', { cookie: ownerCookie })).json.bootcamp.modules.at(-1).id;
  const bad = 'javascript:alert(1)';
  const lessonRoute = `/api/bootcamp/modules/${moduleId}/lessons`;
  assert.equal((await call('POST', lessonRoute, { body: { title: 'L', videoUrl: bad }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('POST', lessonRoute, { body: { title: 'L', resourceUrl: 'data:text/html,x' }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('POST', lessonRoute, { body: { title: 'L', contractUrl: bad }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('PATCH', `/api/stages/${stageId}`, { body: { resourceUrl: bad }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('POST', `/api/stages/${stageId}/tasks`, { body: { title: 'T', loom: bad }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('POST', '/api/bootcamp/extras', { body: { title: 'E', links: [{ title: 'x', url: bad }] }, cookie: ownerCookie })).status, 400);
  assert.equal((await call('POST', lessonRoute, { body: { title: 'L', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', resourceUrl: 'https://example.com/a.pdf' }, cookie: ownerCookie })).status, 201);
  assert.equal((await call('POST', `/api/stages/${stageId}/tasks`, { body: { title: 'T', loom: 'https://www.loom.com/share/abc' }, cookie: ownerCookie })).status, 201);
  assert.equal((await call('PATCH', `/api/stages/${stageId}`, { body: { resourceUrl: 'https://example.com' }, cookie: ownerCookie })).status, 200);
});

let agent1;
test('unique temp passwords, forced change, new login', async () => {
  const a = await call('POST', '/api/agents', { body: { name: 'Agent One', email: 'one@example.com', stageId }, cookie: ownerCookie });
  const b = await call('POST', '/api/agents', { body: { name: 'Agent Two', email: 'two@example.com', stageId }, cookie: ownerCookie });
  assert.equal(a.status, 201);
  assert.notEqual(a.json.tempPassword, b.json.tempPassword);
  assert.ok(a.json.tempPassword.length >= 12);
  agent1 = { email: 'one@example.com', temp: a.json.tempPassword, id: a.json.agent.id };
  assert.equal((await call('POST', '/api/login', { body: { email: agent1.email, password: 'Empire2026!' } })).status, 401);
  const login = await call('POST', '/api/login', { body: { email: agent1.email, password: agent1.temp } });
  assert.equal(login.status, 200);
  const boot = await call('GET', '/api/bootstrap', { cookie: login.cookie });
  assert.equal(boot.json.mustChangePassword, true);
  assert.equal((await call('GET', '/api/recruits', { cookie: login.cookie })).status, 403);
  assert.equal((await call('POST', '/api/account/password', { body: { newPassword: agent1.temp, confirmPassword: agent1.temp }, cookie: login.cookie })).status, 400, 'cannot reuse temp password');
  assert.equal((await call('POST', '/api/account/password', { body: { newPassword: 'AgentNew-98765', confirmPassword: 'AgentNew-98765' }, cookie: login.cookie })).status, 200);
  assert.equal((await call('POST', '/api/login', { body: { email: agent1.email, password: agent1.temp } })).status, 401);
  const fresh = await call('POST', '/api/login', { body: { email: agent1.email, password: 'AgentNew-98765' } });
  assert.equal(fresh.status, 200);
  agent1.cookie = fresh.cookie;
  const bootstrap = await call('GET', '/api/bootstrap', { cookie: agent1.cookie });
  assert.ok(!bootstrap.json.mustChangePassword);
  assert.doesNotMatch(bootstrap.text, /password_hash|password_salt|tempPassword/);
});

test('authorization: agents cannot use owner endpoints; unauthenticated blocked', async () => {
  const routes = [['POST', '/api/agents', { name: 'x', email: 'x@example.com', stageId }], ['GET', '/api/recruits'], ['POST', '/api/recruits', { name: 'x' }],
    ['POST', `/api/agents/${agent1.id}/reset-password`], ['PATCH', `/api/stages/${stageId}`, { reward: 'x' }], ['POST', '/api/bootcamp/modules', { title: 'x' }], ['POST', '/api/bootcamp/extras', { title: 'x' }]];
  for (const [method, route, body] of routes) {
    assert.equal((await call(method, route, { body, cookie: agent1.cookie })).status, 403, `agent ${method} ${route}`);
    assert.ok([401, 403].includes((await call(method, route, { body })).status), `anon ${method} ${route}`);
  }
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);
});

test('password reset forces change and revokes sessions', async () => {
  assert.equal((await call('GET', '/api/bootstrap', { cookie: agent1.cookie })).status, 200);
  const reset = await call('POST', `/api/agents/${agent1.id}/reset-password`, { cookie: ownerCookie });
  assert.equal(reset.status, 200);
  assert.equal((await call('GET', '/api/bootstrap', { cookie: agent1.cookie })).status, 401, 'old session revoked');
  assert.equal((await call('POST', '/api/login', { body: { email: agent1.email, password: 'AgentNew-98765' } })).status, 401, 'old password dead');
  const login = await call('POST', '/api/login', { body: { email: agent1.email, password: reset.json.tempPassword } });
  assert.equal(login.status, 200);
  assert.equal((await call('GET', '/api/bootstrap', { cookie: login.cookie })).json.mustChangePassword, true);
  agent1.temp = reset.json.tempPassword;
});

test('sessions: expiry, malformed cookie, logout, rotation', async () => {
  const login = await call('POST', '/api/login', { body: { email: ownerEmail, password: OWNER_PASSWORD } });
  const token = login.cookie.split('=')[1];
  assert.equal((await call('GET', '/api/bootstrap', { cookie: login.cookie })).status, 200);
  await pool.query('UPDATE sessions SET expires_at = 1 WHERE token = $1', [token]);
  const expired = await call('GET', '/api/bootstrap', { cookie: login.cookie });
  assert.equal(expired.status, 401);
  assert.match(expired.setCookie, /Max-Age=0/);
  assert.equal((await pool.query('SELECT 1 FROM sessions WHERE token = $1', [token])).rowCount, 0, 'expired row deleted');
  assert.equal((await call('GET', '/api/bootstrap', { cookie: 'sid=%E0%A4%A' })).status, 401);
  assert.equal((await call('GET', '/api/bootstrap', { cookie: "sid=' OR 1=1 --" })).status, 401);
  const second = await call('POST', '/api/login', { body: { email: ownerEmail, password: OWNER_PASSWORD } });
  const logout = await call('POST', '/api/logout', { cookie: second.cookie });
  assert.equal(logout.status, 200);
  assert.equal((await call('GET', '/api/bootstrap', { cookie: second.cookie })).status, 401, 'logout invalidates server side');
  const rotated = await call('POST', '/api/login', { body: { email: ownerEmail, password: OWNER_PASSWORD }, cookie: ownerCookie });
  assert.notEqual(rotated.cookie, ownerCookie);
  assert.equal((await call('GET', '/api/bootstrap', { cookie: ownerCookie })).status, 401, 'previous session dropped on re-login');
  ownerCookie = rotated.cookie;
});

test('__api_path restoration and hardening', async () => {
  assert.equal((await call('GET', '/api/index.js?__api_path=admin-setup-status')).status, 200);
  assert.equal((await call('GET', '/api/admin-setup-status')).status, 200);
  assert.equal((await call('POST', '/api/index.js?__api_path=me/bootcamp/lessons/abc/toggle', { cookie: agent1.cookie })).status, 401);
  const rewritten = await call('GET', '/api/index.js?__api_path=bootstrap', { cookie: ownerCookie });
  assert.equal(rewritten.status, 200);
  assert.equal((await call('GET', '/index?__api_path=admin-setup-status')).status, 200);
  for (const bad of ['../x', '%2e%2e/x', 'a/../../b', 'a%2F..%2Fb', 'a?b=c', 'a%23b', 'a%5Cb', '//evil', 'a%00b', 'x'.repeat(400)]) {
    assert.equal((await call('GET', `/api/index.js?__api_path=${bad}`)).status, 400, bad);
  }
  assert.equal((await call('GET', '/api/index.js?__api_path=a&__api_path=b')).status, 400);
  assert.equal((await call('GET', '/api/index.js?__api_path=nope')).status, 404);
});

test('login rate limiting (shared storage, no lockout DoS, uniform responses)', async () => {
  const ip = newIp();
  const attempt = (email, password, from = ip) => call('POST', '/api/login', { body: { email, password }, ip: from });
  for (let i = 0; i < 5; i++) assert.equal((await attempt(ownerEmail, 'wrong' + i)).status, 401);
  const locked = await attempt(ownerEmail, OWNER_PASSWORD);
  assert.equal(locked.status, 429, 'correct password rejected while locked');
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.equal((await attempt('agent-other@example.com', 'x')).status, 401, 'other email from same IP unaffected');
  assert.equal((await attempt(ownerEmail, OWNER_PASSWORD, newIp())).status, 200, 'real owner on another IP not locked out');
  const rows = await pool.query('SELECT key FROM login_attempts');
  assert.ok(rows.rows.every(row => !row.key.includes('@') && !row.key.includes(ip)), 'keys are hashed');
  // unknown emails behave identically to known ones
  const ghostIp = newIp();
  for (let i = 0; i < 5; i++) assert.equal((await attempt('ghost@example.com', 'x', ghostIp)).status, 401);
  assert.equal((await attempt('ghost@example.com', 'x', ghostIp)).status, 429);
  // lock expires
  await pool.query('UPDATE login_attempts SET locked_until = 1, window_start = 1');
  assert.equal((await attempt(ownerEmail, OWNER_PASSWORD)).status, 200);
  // per-IP ceiling
  const spray = newIp();
  for (let i = 0; i < 30; i++) await attempt(`u${i}@example.com`, 'x', spray);
  assert.equal((await attempt('another@example.com', 'x', spray)).status, 429, 'IP-wide limit');
  // successful login clears the per-account counters
  const ip2 = newIp();
  for (let i = 0; i < 3; i++) await attempt(ownerEmail, 'bad', ip2);
  assert.equal((await attempt(ownerEmail, OWNER_PASSWORD, ip2)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await attempt(ownerEmail, 'bad', ip2)).status, 401);
});

test('rate limiting fails open (with a warning) if migration is not applied', async () => {
  await pool.query('DROP TABLE login_attempts');
  const response = await call('POST', '/api/login', { body: { email: ownerEmail, password: OWNER_PASSWORD } });
  assert.equal(response.status, 200);
  assert.equal((await call('POST', '/api/login', { body: { email: ownerEmail, password: 'bad' } })).status, 401);
  assert.ok(logged.some(line => /Rate limiting DISABLED/.test(line)));
});

test('existing owner functionality still works', async () => {
  const login = await call('POST', '/api/login', { body: { email: ownerEmail, password: OWNER_PASSWORD } });
  const cookie = login.cookie;
  const recruit = await call('POST', '/api/recruits', { body: { name: 'Pat Recruit', email: 'pat@example.com', phone: '555', notes: 'n' }, cookie });
  assert.equal(recruit.status, 201);
  const recruitId = (await call('GET', '/api/recruits', { cookie })).json.recruits.find(r => r.name === 'Pat Recruit').id;
  assert.equal((await call('PATCH', `/api/recruits/${recruitId}`, { body: { status: 'licensed' }, cookie })).status, 200);
  const convert = await call('POST', `/api/recruits/${recruitId}/convert`, { body: { name: 'Pat Recruit', email: 'pat@example.com', stageId }, cookie });
  assert.equal(convert.status, 201);
  assert.ok(convert.json.tempPassword);
  const agentLogin = await call('POST', '/api/login', { body: { email: 'pat@example.com', password: convert.json.tempPassword } });
  assert.equal(agentLogin.status, 200);
  assert.equal((await call('DELETE', `/api/agents/${convert.json.agent.id}`, { cookie })).status, 200);
});

test('no credentials or tokens in logs', () => {
  assert.ok(!logged.some(line => /Empire2026|OwnerPass|AgentNew|test-setup-token/.test(line)));
});

test('teardown', async () => {
  server.close();
  await pool.end();
  setTimeout(() => process.exit(process.exitCode || 0), 1500).unref();
  process.once('beforeExit', () => process.exit(process.exitCode || 0));
});
