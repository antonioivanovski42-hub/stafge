// The Agent Forge — backend: static file server + JSON API + PostgreSQL persistence.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createPool, applySchema } = require('./db/postgres');

const ROOT = __dirname;
const PORT = process.env.PORT || 8123;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_AGENT_TEMP_PASSWORD = 'Empire2026!';
const pool = createPool();
const db = {
  prepare(text) {
    let index = 0;
    const sql = text.replace(/\?/g, () => '$' + (++index));
    return {
      async all(...params) { return (await pool.query(sql, params)).rows; },
      async get(...params) { return (await pool.query(sql, params)).rows[0]; },
      async run(...params) { return pool.query(sql, params); }
    };
  },
  async exec(text) { return pool.query(text); }
};

async function main({ listen = false } = {}) {
  await applySchema(pool);
// ---------- Password hashing (scrypt, built-in) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === check.length && crypto.timingSafeEqual(stored, check);
}
function genTempPassword() {
  return crypto.randomBytes(9).toString('base64url');
}
function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}
const existingAgentsWithoutHistory = await db.prepare(`SELECT a.id, a.stage_id, a.started FROM agents a
  WHERE NOT EXISTS (SELECT 1 FROM agent_stage_history h WHERE h.agent_id = a.id)`).all();
const seedHistory = db.prepare('INSERT INTO agent_stage_history (id, agent_id, stage_id, entered_at) VALUES (?,?,?,?)');
for (const agent of existingAgentsWithoutHistory) await seedHistory.run(genId('stage-entry'), agent.id, agent.stage_id, agent.started);

// ---------- Seed default stages + admin account ----------
const stageCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM stages').get()).c);
if (stageCount === 0) {
  const seedStages = [
    { id:'bootcamp', label:'Boot Camp', short:'Boot camp', description:'Build the habits and skills that make production repeatable.', timeframe:30, threshold:null, tasks:[['Welcome to The Agent Forge','Watch the orientation and meet your support team.',''],['Values-based sales conversation','Learn the Forge conversation framework.',''],['Needs analysis workshop','Practice the needs analysis workshop.',''],['Submit first roleplay','Submit one recorded roleplay for feedback.',''],['Build your first 25-name list','Create a first-pass prospect list.','']] },
    { id:'first15', label:'$0 → $15K', short:'$0 → $15K', description:'Create consistent activity and reach your first $15,000 issue-paid.', timeframe:90, threshold:15000, tasks:[['Weekly activity rhythm','Establish a weekly activity rhythm.',''],['First field observation','Complete a live field observation with a leader.',''],['Reach $15,000 issue-paid','Production threshold for this stage.','']] },
    { id:'next30', label:'$15K → $30K', short:'$15K → $30K', description:'Turn momentum into a durable producer practice.', timeframe:120, threshold:30000, tasks:[['Repeatable referral rhythm','Build a consistent referral practice.',''],['Quarterly business plan','Submit a quarterly business plan.',''],['Reach $30,000 issue-paid','Production threshold for this stage.','']] },
    { id:'top', label:'$30K+', short:'$30K+', description:'Lead with consistency, craft and influence.', timeframe:180, threshold:30000, tasks:[['Advanced case design lab','Complete advanced case design training.',''],['Mentor a developing agent','Support one developing agent.',''],['Maintain $30,000+ issue-paid','Production threshold for this stage.','']] },
    { id:'leadership', label:'Leadership', short:'Leadership', description:'Develop people, culture and a high-performing team.', timeframe:365, threshold:null, tasks:[['Leadership development plan','Define an individual leadership plan.',''],['Team recruiting goals','Set configurable team recruiting goals.',''],['Leadership foundations','Complete the leadership foundations curriculum.','']] }
  ];
  const insertStage = db.prepare('INSERT INTO stages (id, idx, label, short, description, timeframe, threshold, reward, resource_url) VALUES (?,?,?,?,?,?,?,?,?)');
  const insertTask = db.prepare('INSERT INTO tasks (id, stage_id, idx, title, instructions, loom_url, required) VALUES (?,?,?,?,?,?,1)');
  for (const [stageIndex, stage] of seedStages.entries()) {
    await insertStage.run(stage.id, stageIndex, stage.label, stage.short, stage.description, stage.timeframe, stage.threshold, '', '');
    for (const [taskIndex, task] of stage.tasks.entries()) await insertTask.run(genId('task'), stage.id, taskIndex, task[0], task[1], task[2]);
  }
}

const bootCampModuleCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM bootcamp_modules').get()).c);
if (bootCampModuleCount === 0) {
  const bootCampModules = [
    ['welcome', 'WELCOME', 'Start here: the team, vision, expectations and the agreement that opens community access.'],
    ['mindset', 'MINDSET', 'Build the habits and perspective that make progress repeatable.'],
    ['sales', 'UNDERSTANDING SALES', 'Learn the products, conversations and live sales processes.'],
    ['tools', 'TOOLS', 'Get fluent with the systems used to manage and quote business.'],
    ['applications', 'APPLICATION PROCESS', 'Learn how to complete every page of every application correctly.'],
    ['compliance', 'COMPLIANCE & PERSISTENCY', 'Protect clients, carriers and the longevity of your book.']
  ];
  const insertModule = db.prepare('INSERT INTO bootcamp_modules (id, idx, title, description) VALUES (?,?,?,?)');
  const insertLesson = db.prepare('INSERT INTO bootcamp_lessons (id, module_id, idx, title, kind, instructions, resource_url, video_url, required) VALUES (?,?,?,?,?,?,?,?,?)');
  const lessons = [
    [['Team + vision', 'What to expect', 'How the business works', "Do's & Don'ts", 'Required contract/signature'], 'Complete the welcome requirements and submit the required contract/signature to unlock Discord access.'],
    [['Process-driven vs. results-driven', 'Stay level-headed', 'Become a sponge', 'Apply everything', 'Success loves speed'], 'Complete each mindset lesson.'],
    [["Watch Alex Hormozi's 4-hour training + take notes", 'Learn Term vs Whole Life vs IUL', 'Understand the life-insurance phone sales process', 'Veteran vs Mortgage Protection sales process', 'Live Veteran role-play + script + live objection handling', 'Live Mortgage Protection role-play + script + live objection handling'], 'Complete each sales training requirement.'],
    [['CRM access/training for managing the book of business', 'Insurance Toolkit access/training for running quotes'], 'Complete the tools access and training requirements.'],
    [['Video demonstration covering how to properly complete every page of applications across every carrier/company'], 'Complete the application process training.'],
    [['Why compliance matters', 'What to avoid', 'Persistency and long-term business longevity'], 'Complete each compliance and persistency requirement.']
  ];
  for (const [moduleIndex, [id, title, description]] of bootCampModules.entries()) {
    await insertModule.run(id, moduleIndex, title, description);
    for (const [lessonIndex, lessonTitle] of lessons[moduleIndex][0].entries()) await insertLesson.run(`${id}-${lessonIndex + 1}`, id, lessonIndex, lessonTitle, 'requirement', lessons[moduleIndex][1], '', '', 1);
  }
}

const accountCount = Number((await db.prepare('SELECT COUNT(*) AS c FROM accounts').get()).c);
if (accountCount === 0) {
  // No password is generated here — the owner sets their own via the first-time admin setup screen.
  await db.prepare('INSERT INTO accounts (id, role, name, email, password_hash, password_salt, needs_setup, created_at) VALUES (?,?,?,?,?,?,1,?)').run('owner-1', 'owner', 'Antonio Ivanovski', 'antonioivanovski42@gmail.com', '', '', new Date().toISOString());
}

// ---------- Domain helpers ----------
async function stageRow(id) { return await db.prepare('SELECT * FROM stages WHERE id = ?').get(id); }
async function allStages() { return await db.prepare('SELECT * FROM stages ORDER BY idx ASC').all(); }
async function tasksForStage(stageId) { return await db.prepare('SELECT * FROM tasks WHERE stage_id = ? ORDER BY idx ASC').all(stageId); }
async function doneTaskIds(agentId) { return (await db.prepare('SELECT task_id FROM agent_done_tasks WHERE agent_id = ?').all(agentId)).map(row => row.task_id); }
async function serializeStage(stage) {
  const tasks = await tasksForStage(stage.id);
  return { id: stage.id, label: stage.label, short: stage.short, description: stage.description, timeframe: stage.timeframe, threshold: stage.threshold, reward: stage.reward, resources: stage.resource_url ? [stage.resource_url] : [], tasks: tasks.map(t => ({ id: t.id, title: t.title, instructions: t.instructions, loom: t.loom_url, required: !!t.required })) };
}
async function bootCampLessons(moduleId) { return await db.prepare('SELECT * FROM bootcamp_lessons WHERE module_id = ? ORDER BY idx ASC').all(moduleId); }
function supportedBootCampVideo(videoUrl) {
  try {
    const url = new URL(videoUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
      const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
      return !!id && /^[\w-]{11}$/.test(id);
    }
    if (host === 'youtu.be') return !!url.pathname.match(/^\/([\w-]{11})\/?$/);
    if (host === 'loom.com') return !!url.pathname.match(/^\/(?:share|embed)\/[\w-]+\/?$/);
    if (host === 'vimeo.com' || host === 'player.vimeo.com') return !!url.pathname.match(/^\/(?:video\/)?\d+(?:\/[\w-]+)?\/?$/);
  } catch {}
  return false;
}
function isGoogleDriveVideo(videoUrl) {
  try {
    const url = new URL(videoUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !['drive.google.com', 'www.drive.google.com'].includes(url.hostname.toLowerCase())) return false;
    const id = url.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] || url.searchParams.get('id');
    return !!id && /^[\w-]+$/.test(id);
  } catch {}
  return false;
}
async function bootCampDoneIds(agentId) { return (await db.prepare('SELECT lesson_id FROM bootcamp_completions WHERE agent_id = ?').all(agentId)).map(row => row.lesson_id); }
async function bootCampWatchedIds(agentId) { return (await db.prepare('SELECT lesson_id FROM bootcamp_video_watches WHERE agent_id = ?').all(agentId)).map(row => row.lesson_id); }
async function bootCampVideoProgress(agentId, lessonId, watched) {
  if (watched) return { watched: true, watchedPercent: 100, position: 0, duration: null };
  const progress = await db.prepare('SELECT watched_ranges, duration_seconds, last_position FROM bootcamp_video_progress WHERE agent_id = ? AND lesson_id = ?').get(agentId, lessonId);
  if (!progress || !progress.duration_seconds) return { watched: false, watchedPercent: 0, position: 0, furthest: 0, duration: null };
  const ranges = JSON.parse(progress.watched_ranges);
  const watchedSeconds = ranges.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
  return {
    watched: false,
    watchedPercent: Math.min(99, Math.floor((watchedSeconds / progress.duration_seconds) * 100)),
    position: progress.last_position,
    furthest: ranges.reduce((furthest, [, end]) => Math.max(furthest, end), 0),
    duration: progress.duration_seconds
  };
}
async function bootCampResourceDoneIds(agentId) { return (await db.prepare('SELECT lesson_id FROM bootcamp_resource_completions WHERE agent_id = ?').all(agentId)).map(row => row.lesson_id); }
async function bootCampContractDoneIds(agentId) { return (await db.prepare('SELECT lesson_id FROM bootcamp_contract_completions WHERE agent_id = ?').all(agentId)).map(row => row.lesson_id); }
async function bootCampLessonLocked(agentId, lesson) {
  const done = await bootCampDoneIds(agentId);
  if (done.includes(lesson.id)) return false;
  const lessons = await bootCampLessons(lesson.module_id);
  const index = lessons.findIndex(item => item.id === lesson.id);
  return lessons.slice(0, Math.max(0, index)).some(item => !done.includes(item.id));
}
// Extra Resources are supplemental: they never affect lesson completion, module unlocking or progress totals.
async function serializeBootCampExtras() {
  const links = await db.prepare('SELECT * FROM bootcamp_extra_links ORDER BY idx ASC').all();
  return (await db.prepare('SELECT * FROM bootcamp_extra_topics ORDER BY idx ASC').all()).map(topic => ({
    id: topic.id, title: topic.title, description: topic.description,
    links: links.filter(link => link.topic_id === topic.id).map(link => ({ id: link.id, title: link.title, url: link.url }))
  }));
}
function parseExtraLinks(input) {
  if (!Array.isArray(input)) return { error: 'Links must be a list.' };
  const links = [];
  for (const item of input) {
    const url = String(item && item.url || '').trim();
    const title = String(item && item.title || '').trim();
    if (!url && !title) continue;
    if (!title) return { error: 'Each resource link needs a title.' };
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { return { error: 'Each resource link needs a valid HTTP or HTTPS URL.' }; }
    links.push({ title, url });
  }
  return { links };
}
async function saveExtraLinks(topicId, links) {
  await db.prepare('DELETE FROM bootcamp_extra_links WHERE topic_id = ?').run(topicId);
  const insert = db.prepare('INSERT INTO bootcamp_extra_links (id, topic_id, idx, title, url) VALUES (?,?,?,?,?)');
  for (const [index, link] of links.entries()) {
    await insert.run(genId('bootcamp-extra-link'), topicId, index, link.title, link.url);
  }
}
const LESSON_LOCKED_ERROR = 'Complete the previous lesson first.';
async function serializeBootCamp(agentId) {
  const done = await bootCampDoneIds(agentId);
  const watched = await bootCampWatchedIds(agentId);
  const resourcesDone = await bootCampResourceDoneIds(agentId);
  const contractsDone = await bootCampContractDoneIds(agentId);
  const moduleRows = await db.prepare('SELECT * FROM bootcamp_modules ORDER BY idx ASC').all();
  const modules = [];
  for (const module of moduleRows) {
    const lessonRows = await bootCampLessons(module.id);
    const lessons = [];
    for (const lesson of lessonRows) lessons.push({ id: lesson.id, title: lesson.title, kind: lesson.kind, instructions: lesson.instructions, resourceUrl: lesson.resource_url, resourceRequired: !!lesson.resource_required, resourceCompleted: resourcesDone.includes(lesson.id), contractUrl: lesson.contract_url, contractRequired: !!lesson.contract_required, contractCompleted: contractsDone.includes(lesson.id), videoUrl: lesson.video_url, videoProgress: await bootCampVideoProgress(agentId, lesson.id, watched.includes(lesson.id)), required: !!lesson.required, done: done.includes(lesson.id), watched: watched.includes(lesson.id) });
    lessons.forEach((lesson, lessonIndex) => { lesson.locked = !lesson.done && lessons.slice(0, lessonIndex).some(item => !item.done); });
    const complete = lessons.filter(lesson => lesson.required).every(lesson => lesson.done);
    modules.push({ id: module.id, idx: module.idx, title: module.title, description: module.description, lessons, complete });
  }
  return {
    modules: modules.map((module, index) => ({ ...module, unlocked: index === 0 || modules[index - 1].complete })),
    extras: await serializeBootCampExtras(),
    completedLessons: done.length,
    totalLessons: modules.reduce((total, module) => total + module.lessons.filter(lesson => lesson.required).length, 0)
  };
}
function daysSince(iso) { return Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)); }
function stageDays(iso) { return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)); }
function computeProgress(agent, stage, done) {
  const requiredTasks = stage.tasks.filter(t => t.required);
  const completed = requiredTasks.filter(t => done.includes(t.id)).length;
  const total = requiredTasks.length;
  if (!total) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}
function computeFlag(agent, stage) {
  const days = stageDays(agent.started);
  if (days >= 90) return 'stuck';
  return 'on-track';
}
async function stageHistoryFor(agentId) {
  return (await db.prepare(`SELECT h.*, s.label FROM agent_stage_history h JOIN stages s ON s.id = h.stage_id WHERE h.agent_id = ? ORDER BY h.entered_at ASC`).all(agentId)).map(entry => ({
    stageId: entry.stage_id, stageLabel: entry.label, enteredAt: entry.entered_at, exitedAt: entry.exited_at,
    days: entry.duration_ms === null ? stageDays(entry.entered_at) : Math.max(0, Math.floor(entry.duration_ms / 86400000))
  }));
}
async function ensureStageAttentionNotifications(agentRows) {
  const insert = db.prepare('INSERT INTO owner_notifications (id, type, agent_id, created_at) VALUES (?,?,?,?)');
  for (const agent of agentRows) {
    if (computeFlag(agent, await stageRow(agent.stage_id)) !== 'stuck') continue;
    const existing = await db.prepare("SELECT 1 FROM owner_notifications WHERE type = 'stage-90-days' AND agent_id = ? AND acknowledged = 0").get(agent.id);
    if (!existing) await insert.run(genId('notification'), 'stage-90-days', agent.id, new Date().toISOString());
  }
}
function readyToAdvance(agent, stage, done) {
  const requiredMet = stage.tasks.filter(t => t.required).every(t => done.includes(t.id));
  return requiredMet;
}
async function serializeAgent(agentRow) {
  const stages = await allStages();
  const stageIndex = stages.findIndex(s => s.id === agentRow.stage_id);
  const stage = await serializeStage(stages[stageIndex]);
  const done = await doneTaskIds(agentRow.id);
  return {
    id: agentRow.id, name: agentRow.name, email: agentRow.email, initials: agentRow.initials, color: agentRow.color,
    stageId: agentRow.stage_id, stageIndex, stageLabel: stage.label, started: agentRow.started, production: agentRow.production,
    done, progress: computeProgress(agentRow, stage, done), readyForAdvancement: stageIndex < stages.length - 1 && readyToAdvance(agentRow, stage, done), flag: computeFlag(agentRow, stage), daysInStage: stageDays(agentRow.started), stageHistory: await stageHistoryFor(agentRow.id)
  };
}
async function advanceAgentStage(agentRow, nextStage) {
  const exitedAt = new Date();
  const enteredAt = exitedAt.toISOString();
  const activeHistory = await db.prepare('SELECT id, entered_at FROM agent_stage_history WHERE agent_id = ? AND exited_at IS NULL ORDER BY entered_at DESC LIMIT 1').get(agentRow.id);
  if (activeHistory) await db.prepare('UPDATE agent_stage_history SET exited_at = ?, duration_ms = ? WHERE id = ?').run(enteredAt, Math.max(0, exitedAt.getTime() - new Date(activeHistory.entered_at).getTime()), activeHistory.id);
  await db.prepare('UPDATE agents SET stage_id = ?, started = ? WHERE id = ?').run(nextStage.id, enteredAt, agentRow.id);
  await db.prepare('INSERT INTO agent_stage_history (id, agent_id, stage_id, entered_at) VALUES (?,?,?,?)').run(genId('stage-entry'), agentRow.id, nextStage.id, enteredAt);
  await db.prepare("DELETE FROM owner_notifications WHERE type = 'stage-90-days' AND agent_id = ?").run(agentRow.id);
  await db.prepare('DELETE FROM agent_done_tasks WHERE agent_id = ?').run(agentRow.id);
}
function initialsFor(name) { return name.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'AG'; }

// ---------- Session helpers ----------
function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(part => { const i = part.indexOf('='); return [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())]; }));
}
async function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, account_id, expires_at) VALUES (?,?,?)').run(token, accountId, Date.now() + SESSION_TTL_MS);
  return token;
}
async function getSession(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const session = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session || session.expires_at < Date.now()) return null;
  const account = await db.prepare('SELECT * FROM accounts WHERE id = ?').get(session.account_id);
  return account ? { token, account } : null;
}

// ---------- HTTP plumbing ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function sessionCookie(token, req) {
  const secure = process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
function expiredSessionCookie(req) {
  const secure = process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
  return `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function serveStatic(req, res, pathname) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const fullPath = path.join(ROOT, file);
  if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    try { body = await readBody(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  const session = await getSession(req);
  const requireAuth = () => { if (!session) { sendJson(res, 401, { error: 'Not signed in.' }); return false; } return true; };
  const requireOwner = () => { if (!session || session.account.role !== 'owner') { sendJson(res, 403, { error: 'Owner access required.' }); return false; } return true; };

  try {
    // ---- Auth ----
    if (pathname === '/api/admin-setup-status' && req.method === 'GET') {
      const owner = await db.prepare("SELECT needs_setup FROM accounts WHERE role = 'owner' LIMIT 1").get();
      return sendJson(res, 200, { needsSetup: !!(owner && owner.needs_setup) });
    }
    if (pathname === '/api/admin-setup' && req.method === 'POST') {
      const owner = await db.prepare("SELECT * FROM accounts WHERE role = 'owner' LIMIT 1").get();
      if (!owner || !owner.needs_setup) return sendJson(res, 403, { error: 'Admin setup has already been completed.' });
      const email = String(body.email || '').trim().toLowerCase();
      if (email !== owner.email.toLowerCase()) return sendJson(res, 400, { error: 'Email does not match the agency owner account.' });
      const password = String(body.password || '');
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      if (password !== String(body.confirmPassword || '')) return sendJson(res, 400, { error: 'Passwords do not match.' });
      const { salt, hash } = hashPassword(password);
      await db.prepare('UPDATE accounts SET password_hash = ?, password_salt = ?, needs_setup = 0 WHERE id = ?').run(hash, salt, owner.id);
      await db.prepare('DELETE FROM sessions WHERE account_id = ?').run(owner.id);
      const token = await createSession(owner.id);
      res.setHeader('Set-Cookie', sessionCookie(token, req));
      return sendJson(res, 200, { id: owner.id, name: owner.name, role: owner.role, email: owner.email });
    }
    if (pathname === '/api/login' && req.method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const account = await db.prepare('SELECT * FROM accounts WHERE lower(email) = ?').get(email);
      if (account && account.needs_setup) return sendJson(res, 403, { error: 'Admin account setup is required before signing in.', needsSetup: true });
      if (!account || !verifyPassword(String(body.password || ''), account.password_salt, account.password_hash)) return sendJson(res, 401, { error: 'Access denied. Check your email and password.' });
      const token = await createSession(account.id);
      res.setHeader('Set-Cookie', sessionCookie(token, req));
      return sendJson(res, 200, { id: account.id, name: account.name, role: account.role, email: account.email });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = parseCookies(req).sid;
      if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      res.setHeader('Set-Cookie', expiredSessionCookie(req));
      return sendJson(res, 200, { ok: true });
    }

    if (session && session.account.must_change_password && pathname !== '/api/bootstrap' && pathname !== '/api/account/password') {
      return sendJson(res, 403, { error: 'Change your temporary password before continuing.', mustChangePassword: true });
    }

    // ---- Bootstrap ----
    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      if (!requireAuth()) return;
      const user = { id: session.account.id, name: session.account.name, role: session.account.role, email: session.account.email, mustChangePassword: !!session.account.must_change_password };
      if (session.account.must_change_password) return sendJson(res, 200, { user, mustChangePassword: true });
      if (session.account.role === 'owner') {
        const stages = [];
        for (const stage of await allStages()) stages.push(await serializeStage(stage));
        const agentRows = await db.prepare('SELECT * FROM agents').all();
        await ensureStageAttentionNotifications(agentRows);
        const agents = [];
        for (const agentRow of agentRows) agents.push(await serializeAgent(agentRow));
        const recruits = await db.prepare('SELECT * FROM recruits ORDER BY created_at DESC').all();
        const notifications = await db.prepare(`SELECT n.*, a.name AS agent_name FROM owner_notifications n JOIN agents a ON a.id = n.agent_id WHERE n.acknowledged = 0 ORDER BY n.created_at DESC`).all();
        const bootcampAgents = [];
        for (const agent of agentRows) bootcampAgents.push({ id: agent.id, name: agent.name, email: agent.email, bootcamp: await serializeBootCamp(agent.id) });
        const ownerBootcamp = await serializeBootCamp('');
        return sendJson(res, 200, { user, role: 'owner', stages, agents, recruits, notifications, bootcamp: { agents: bootcampAgents, modules: ownerBootcamp.modules, extras: await serializeBootCampExtras() } });
      }
      const agentRow = await db.prepare('SELECT * FROM agents WHERE account_id = ?').get(session.account.id);
      if (!agentRow) return sendJson(res, 200, { user, role: 'agent', agent: null, stages: [], stage: null });
      const stages = await allStages();
      const timeline = stages.map(s => ({ id: s.id, label: s.label, short: s.short }));
      const agent = await serializeAgent(agentRow);
      const stage = await serializeStage(stages[agent.stageIndex]);
      const nextStage = stages[agent.stageIndex + 1];
      return sendJson(res, 200, { user, role: 'agent', agent, stage, timeline, nextStageLabel: nextStage ? nextStage.label : null, bootcamp: await serializeBootCamp(agentRow.id) });
    }

    const bootCampModulesMatch = pathname.match(/^\/api\/bootcamp\/modules(?:\/([^/]+))?$/);
    if (bootCampModulesMatch && req.method === 'POST' && !bootCampModulesMatch[1]) {
      if (!requireOwner()) return;
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Module title is required.' });
      const maxIdx = Number((await db.prepare('SELECT COALESCE(MAX(idx), -1) AS max_idx FROM bootcamp_modules').get()).max_idx);
      const id = genId('bootcamp-module');
      await db.prepare('INSERT INTO bootcamp_modules (id, idx, title, description) VALUES (?,?,?,?)').run(id, maxIdx + 1, title, String(body.description || '').trim());
      return sendJson(res, 201, { ok: true });
    }
    if (bootCampModulesMatch && bootCampModulesMatch[1] && req.method === 'PATCH') {
      if (!requireOwner()) return;
      const module = await db.prepare('SELECT * FROM bootcamp_modules WHERE id = ?').get(bootCampModulesMatch[1]);
      if (!module) return sendJson(res, 404, { error: 'Boot Camp module not found.' });
      const title = String(body.title !== undefined ? body.title : module.title).trim();
      if (!title) return sendJson(res, 400, { error: 'Module title is required.' });
      await db.prepare('UPDATE bootcamp_modules SET title = ?, description = ? WHERE id = ?').run(title, String(body.description !== undefined ? body.description : module.description).trim(), module.id);
      return sendJson(res, 200, { ok: true });
    }
    if (bootCampModulesMatch && bootCampModulesMatch[1] && req.method === 'DELETE') {
      if (!requireOwner()) return;
      const module = await db.prepare('SELECT * FROM bootcamp_modules WHERE id = ?').get(bootCampModulesMatch[1]);
      if (!module) return sendJson(res, 404, { error: 'Boot Camp module not found.' });
      const lessons = await bootCampLessons(module.id);
      for (const lesson of lessons) {
        await db.prepare('DELETE FROM bootcamp_completions WHERE lesson_id = ?').run(lesson.id);
        await db.prepare('DELETE FROM bootcamp_video_watches WHERE lesson_id = ?').run(lesson.id);
        await db.prepare('DELETE FROM bootcamp_video_progress WHERE lesson_id = ?').run(lesson.id);
        await db.prepare('DELETE FROM bootcamp_resource_completions WHERE lesson_id = ?').run(lesson.id);
        await db.prepare('DELETE FROM bootcamp_contract_completions WHERE lesson_id = ?').run(lesson.id);
      }
      await db.prepare('DELETE FROM bootcamp_lessons WHERE module_id = ?').run(module.id);
      await db.prepare('DELETE FROM bootcamp_modules WHERE id = ?').run(module.id);
      await db.prepare('UPDATE bootcamp_modules SET idx = idx - 1 WHERE idx > ?').run(module.idx);
      return sendJson(res, 200, { ok: true });
    }
    const bootCampModuleMoveMatch = pathname.match(/^\/api\/bootcamp\/modules\/([^/]+)\/move$/);
    if (bootCampModuleMoveMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const module = await db.prepare('SELECT * FROM bootcamp_modules WHERE id = ?').get(bootCampModuleMoveMatch[1]);
      if (!module) return sendJson(res, 404, { error: 'Boot Camp module not found.' });
      const targetIdx = body.direction === 'up' ? module.idx - 1 : module.idx + 1;
      const target = await db.prepare('SELECT * FROM bootcamp_modules WHERE idx = ?').get(targetIdx);
      if (target) { await db.prepare('UPDATE bootcamp_modules SET idx = ? WHERE id = ?').run(-1, module.id); await db.prepare('UPDATE bootcamp_modules SET idx = ? WHERE id = ?').run(module.idx, target.id); await db.prepare('UPDATE bootcamp_modules SET idx = ? WHERE id = ?').run(targetIdx, module.id); }
      return sendJson(res, 200, { ok: true });
    }
    const bootCampExtraMatch = pathname.match(/^\/api\/bootcamp\/extras(?:\/([^/]+))?$/);
    if (bootCampExtraMatch && req.method === 'POST' && !bootCampExtraMatch[1]) {
      if (!requireOwner()) return;
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Topic title is required.' });
      const parsed = parseExtraLinks(body.links || []);
      if (parsed.error) return sendJson(res, 400, { error: parsed.error });
      const maxIdx = Number((await db.prepare('SELECT COALESCE(MAX(idx), -1) AS max_idx FROM bootcamp_extra_topics').get()).max_idx);
      const id = genId('bootcamp-extra');
      await db.prepare('INSERT INTO bootcamp_extra_topics (id, idx, title, description) VALUES (?,?,?,?)').run(id, maxIdx + 1, title, String(body.description || '').trim());
      await saveExtraLinks(id, parsed.links);
      return sendJson(res, 201, { ok: true });
    }
    if (bootCampExtraMatch && bootCampExtraMatch[1] && ['PATCH', 'DELETE'].includes(req.method)) {
      if (!requireOwner()) return;
      const topic = await db.prepare('SELECT * FROM bootcamp_extra_topics WHERE id = ?').get(bootCampExtraMatch[1]);
      if (!topic) return sendJson(res, 404, { error: 'Extra Resources topic not found.' });
      if (req.method === 'DELETE') {
        await db.prepare('DELETE FROM bootcamp_extra_links WHERE topic_id = ?').run(topic.id);
        await db.prepare('DELETE FROM bootcamp_extra_topics WHERE id = ?').run(topic.id);
        await db.prepare('UPDATE bootcamp_extra_topics SET idx = idx - 1 WHERE idx > ?').run(topic.idx);
        return sendJson(res, 200, { ok: true });
      }
      const title = String(body.title !== undefined ? body.title : topic.title).trim();
      if (!title) return sendJson(res, 400, { error: 'Topic title is required.' });
      const parsed = body.links !== undefined ? parseExtraLinks(body.links) : null;
      if (parsed && parsed.error) return sendJson(res, 400, { error: parsed.error });
      await db.prepare('UPDATE bootcamp_extra_topics SET title = ?, description = ? WHERE id = ?').run(title, String(body.description !== undefined ? body.description : topic.description).trim(), topic.id);
      if (parsed) await saveExtraLinks(topic.id, parsed.links);
      return sendJson(res, 200, { ok: true });
    }
    const bootCampLessonListMatch = pathname.match(/^\/api\/bootcamp\/modules\/([^/]+)\/lessons$/);
    if (bootCampLessonListMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const module = await db.prepare('SELECT * FROM bootcamp_modules WHERE id = ?').get(bootCampLessonListMatch[1]);
      if (!module) return sendJson(res, 404, { error: 'Boot Camp module not found.' });
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Lesson title is required.' });
      const maxIdx = Number((await db.prepare('SELECT COALESCE(MAX(idx), -1) AS max_idx FROM bootcamp_lessons WHERE module_id = ?').get(module.id)).max_idx);
      const id = genId('bootcamp-lesson');
      await db.prepare('INSERT INTO bootcamp_lessons (id, module_id, idx, title, instructions, video_url, resource_url, resource_required, contract_url, contract_required, required) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, module.id, maxIdx + 1, title, String(body.description || '').trim(), String(body.videoUrl || '').trim(), String(body.resourceUrl || '').trim(), body.resourceRequired ? 1 : 0, String(body.contractUrl || '').trim(), body.contractRequired ? 1 : 0, body.required === false ? 0 : 1);
      return sendJson(res, 201, { ok: true });
    }
    const bootCampLessonMatch = pathname.match(/^\/api\/bootcamp\/lessons\/([^/]+)$/);
    if (bootCampLessonMatch && req.method === 'PATCH') {
      if (!requireOwner()) return;
      const lesson = await db.prepare('SELECT * FROM bootcamp_lessons WHERE id = ?').get(bootCampLessonMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      const title = String(body.title !== undefined ? body.title : lesson.title).trim();
      if (!title) return sendJson(res, 400, { error: 'Lesson title is required.' });
      const description = String(body.description !== undefined ? body.description : lesson.instructions).trim();
      const videoUrl = String(body.videoUrl || '').trim();
      const resourceUrl = String(body.resourceUrl || '').trim();
      const resourceRequired = !!body.resourceRequired;
      const contractUrl = String(body.contractUrl || '').trim();
      const contractRequired = !!body.contractRequired;
      if (videoUrl) {
        try { const parsed = new URL(videoUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
        catch { return sendJson(res, 400, { error: 'Video URL must use HTTP or HTTPS.' }); }
      }
      if (resourceUrl) {
        try { const parsed = new URL(resourceUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
        catch { return sendJson(res, 400, { error: 'Resource URL must use HTTP or HTTPS.' }); }
      }
      if (contractUrl) {
        try { const parsed = new URL(contractUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
        catch { return sendJson(res, 400, { error: 'Contract URL must use HTTP or HTTPS.' }); }
      }
      await db.prepare('UPDATE bootcamp_lessons SET title = ?, instructions = ?, video_url = ?, resource_url = ?, resource_required = ?, contract_url = ?, contract_required = ?, required = ? WHERE id = ?').run(title, description, videoUrl, resourceUrl, resourceRequired ? 1 : 0, contractUrl, contractRequired ? 1 : 0, body.required === false ? 0 : 1, lesson.id);
      await db.prepare('DELETE FROM bootcamp_video_watches WHERE lesson_id = ?').run(lesson.id);
      await db.prepare('DELETE FROM bootcamp_video_progress WHERE lesson_id = ?').run(lesson.id);
      await db.prepare('DELETE FROM bootcamp_resource_completions WHERE lesson_id = ?').run(lesson.id);
      await db.prepare('DELETE FROM bootcamp_contract_completions WHERE lesson_id = ?').run(lesson.id);
      await db.prepare('DELETE FROM bootcamp_completions WHERE lesson_id = ?').run(lesson.id);
      return sendJson(res, 200, { ok: true });
    }
    const bootCampLessonDeleteMatch = pathname.match(/^\/api\/bootcamp\/lessons\/([^/]+)$/);
    if (bootCampLessonDeleteMatch && req.method === 'DELETE') {
      if (!requireOwner()) return;
      const lesson = await db.prepare('SELECT * FROM bootcamp_lessons WHERE id = ?').get(bootCampLessonDeleteMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      for (const table of ['bootcamp_completions', 'bootcamp_video_watches', 'bootcamp_video_progress', 'bootcamp_resource_completions', 'bootcamp_contract_completions']) await db.prepare(`DELETE FROM ${table} WHERE lesson_id = ?`).run(lesson.id);
      await db.prepare('DELETE FROM bootcamp_lessons WHERE id = ?').run(lesson.id);
      await db.prepare('UPDATE bootcamp_lessons SET idx = idx - 1 WHERE module_id = ? AND idx > ?').run(lesson.module_id, lesson.idx);
      return sendJson(res, 200, { ok: true });
    }
    const bootCampLessonMoveMatch = pathname.match(/^\/api\/bootcamp\/lessons\/([^/]+)\/move$/);
    if (bootCampLessonMoveMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const lesson = await db.prepare('SELECT * FROM bootcamp_lessons WHERE id = ?').get(bootCampLessonMoveMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      const targetIdx = body.direction === 'up' ? lesson.idx - 1 : lesson.idx + 1;
      const target = await db.prepare('SELECT * FROM bootcamp_lessons WHERE module_id = ? AND idx = ?').get(lesson.module_id, targetIdx);
      if (target) { await db.prepare('UPDATE bootcamp_lessons SET idx = ? WHERE id = ?').run(-1, lesson.id); await db.prepare('UPDATE bootcamp_lessons SET idx = ? WHERE id = ?').run(lesson.idx, target.id); await db.prepare('UPDATE bootcamp_lessons SET idx = ? WHERE id = ?').run(targetIdx, lesson.id); }
      return sendJson(res, 200, { ok: true });
    }

    // ---- Boot Camp self-service ----
    const bootCampVideoProgressMatch = pathname.match(/^\/api\/me\/bootcamp\/lessons\/([^/]+)\/video-progress$/);
    if (bootCampVideoProgressMatch && req.method === 'POST') {
      if (!requireAuth()) return;
      if (session.account.role !== 'agent') return sendJson(res, 403, { error: 'Agent access required.' });
      const agentRow = await db.prepare('SELECT * FROM agents WHERE account_id = ?').get(session.account.id);
      if (!agentRow) return sendJson(res, 404, { error: 'No agent record found.' });
      const lesson = await db.prepare('SELECT l.*, m.idx AS module_idx FROM bootcamp_lessons l JOIN bootcamp_modules m ON m.id = l.module_id WHERE l.id = ?').get(bootCampVideoProgressMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      const modules = await db.prepare('SELECT * FROM bootcamp_modules ORDER BY idx ASC').all();
      const previousModule = modules.find(module => module.idx === lesson.module_idx - 1);
      const previousModuleLessons = previousModule ? (await bootCampLessons(previousModule.id)).filter(item => item.required) : [];
      const doneInPreviousModule = await bootCampDoneIds(agentRow.id);
      if (previousModule && !previousModuleLessons.every(item => doneInPreviousModule.includes(item.id))) return sendJson(res, 409, { error: 'Complete the previous Boot Camp module first.' });
      if (await bootCampLessonLocked(agentRow.id, lesson)) return sendJson(res, 409, { error: LESSON_LOCKED_ERROR });
      if (!lesson.video_url) return sendJson(res, 400, { error: 'This lesson has no video.' });
      if (!supportedBootCampVideo(lesson.video_url)) return sendJson(res, 400, { error: 'This video host does not support tracked playback.' });
      const currentTime = Number(body.currentTime);
      const duration = Number(body.duration);
      if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || duration > 86400 || currentTime < 0 || currentTime > duration || typeof body.playing !== 'boolean') return sendJson(res, 400, { error: 'Invalid video playback checkpoint.' });
      if (await db.prepare('SELECT 1 FROM bootcamp_video_watches WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id)) {
        return sendJson(res, 200, { watched: true, progress: { watched: true, watchedPercent: 100, position: currentTime, duration } });
      }
      const previous = await db.prepare('SELECT * FROM bootcamp_video_progress WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id);
      const now = Date.now();
      if (previous && previous.duration_seconds && Math.abs(previous.duration_seconds - duration) > Math.max(2, previous.duration_seconds * 0.01)) return sendJson(res, 409, { error: 'The video duration changed. Reload the lesson to continue.' });
      if (!previous && currentTime > 1.5) return sendJson(res, 409, { error: 'Video playback must start at the beginning.' });
      const ranges = previous ? JSON.parse(previous.watched_ranges) : [];
      let lastPosition = previous ? previous.last_position : 0;
      const elapsed = previous ? (now - previous.checkpoint_at) / 1000 : 0;
      const movement = currentTime - lastPosition;
      if (previous && movement > 0 && previous.last_playing && elapsed >= 0 && elapsed <= 12 && movement <= elapsed * 1.25 + 0.75) {
        ranges.push([lastPosition, currentTime]);
        ranges.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const range of ranges) {
          const last = merged[merged.length - 1];
          if (last && range[0] <= last[1] + 0.25) last[1] = Math.max(last[1], range[1]);
          else merged.push([...range]);
        }
        ranges.splice(0, ranges.length, ...merged);
        lastPosition = currentTime;
      } else if (movement <= 0) {
        lastPosition = currentTime;
      } else if (previous && (elapsed < 0 || elapsed > 12 || movement > elapsed * 1.25 + 0.75)) {
        lastPosition = previous.last_position;
      }
      await db.prepare(`INSERT INTO bootcamp_video_progress (agent_id, lesson_id, watched_ranges, duration_seconds, last_position, checkpoint_at, last_playing)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(agent_id, lesson_id) DO UPDATE SET watched_ranges = excluded.watched_ranges,
        duration_seconds = excluded.duration_seconds, last_position = excluded.last_position, checkpoint_at = excluded.checkpoint_at,
        last_playing = excluded.last_playing`).run(agentRow.id, lesson.id, JSON.stringify(ranges), previous?.duration_seconds || duration, lastPosition, now, body.playing ? 1 : 0);
      const watchedSeconds = ranges.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
      if (watchedSeconds >= duration * 0.9) await db.prepare('INSERT INTO bootcamp_video_watches (agent_id, lesson_id, watched_at) VALUES (?,?,?) ON CONFLICT (agent_id, lesson_id) DO NOTHING').run(agentRow.id, lesson.id, new Date().toISOString());
      const watched = !!(await db.prepare('SELECT 1 FROM bootcamp_video_watches WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id));
      return sendJson(res, 200, { watched, progress: await bootCampVideoProgress(agentRow.id, lesson.id, watched) });
    }
    const bootCampResourceMatch = pathname.match(/^\/api\/me\/bootcamp\/lessons\/([^/]+)\/resource-complete$/);
    if (bootCampResourceMatch && req.method === 'POST') {
      if (!requireAuth()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE account_id = ?').get(session.account.id);
      if (!agentRow) return sendJson(res, 404, { error: 'No agent record found.' });
      const lesson = await db.prepare('SELECT l.*, m.idx AS module_idx FROM bootcamp_lessons l JOIN bootcamp_modules m ON m.id = l.module_id WHERE l.id = ?').get(bootCampResourceMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      const modules = await db.prepare('SELECT * FROM bootcamp_modules ORDER BY idx ASC').all();
      const previousModule = modules.find(module => module.idx === lesson.module_idx - 1);
      const previousModuleLessons = previousModule ? (await bootCampLessons(previousModule.id)).filter(item => item.required) : [];
      const doneInPreviousModule = await bootCampDoneIds(agentRow.id);
      if (previousModule && !previousModuleLessons.every(item => doneInPreviousModule.includes(item.id))) return sendJson(res, 409, { error: 'Complete the previous Boot Camp module first.' });
      if (await bootCampLessonLocked(agentRow.id, lesson)) return sendJson(res, 409, { error: LESSON_LOCKED_ERROR });
      if (!lesson.resource_url) return sendJson(res, 400, { error: 'This lesson has no resource.' });
      await db.prepare('INSERT INTO bootcamp_resource_completions (agent_id, lesson_id, completed_at) VALUES (?,?,?) ON CONFLICT (agent_id, lesson_id) DO UPDATE SET completed_at = EXCLUDED.completed_at').run(agentRow.id, lesson.id, new Date().toISOString());
      return sendJson(res, 200, { bootcamp: await serializeBootCamp(agentRow.id) });
    }
    const bootCampContractMatch = pathname.match(/^\/api\/me\/bootcamp\/lessons\/([^/]+)\/contract-complete$/);
    if (bootCampContractMatch && req.method === 'POST') {
      if (!requireAuth()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE account_id = ?').get(session.account.id);
      if (!agentRow) return sendJson(res, 404, { error: 'No agent record found.' });
      const lesson = await db.prepare('SELECT l.*, m.idx AS module_idx FROM bootcamp_lessons l JOIN bootcamp_modules m ON m.id = l.module_id WHERE l.id = ?').get(bootCampContractMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      if (await bootCampLessonLocked(agentRow.id, lesson)) return sendJson(res, 409, { error: LESSON_LOCKED_ERROR });
      if (!lesson.contract_url) return sendJson(res, 400, { error: 'This lesson has no contract link.' });
      await db.prepare('INSERT INTO bootcamp_contract_completions (agent_id, lesson_id, completed_at) VALUES (?,?,?) ON CONFLICT (agent_id, lesson_id) DO UPDATE SET completed_at = EXCLUDED.completed_at').run(agentRow.id, lesson.id, new Date().toISOString());
      return sendJson(res, 200, { bootcamp: await serializeBootCamp(agentRow.id) });
    }
    const bootCampToggleMatch = pathname.match(/^\/api\/me\/bootcamp\/lessons\/([^/]+)\/toggle$/);
    if (bootCampToggleMatch && req.method === 'POST') {
      if (!requireAuth()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE account_id = ?').get(session.account.id);
      if (!agentRow) return sendJson(res, 404, { error: 'No agent record found.' });
      const lesson = await db.prepare('SELECT l.*, m.idx AS module_idx FROM bootcamp_lessons l JOIN bootcamp_modules m ON m.id = l.module_id WHERE l.id = ?').get(bootCampToggleMatch[1]);
      if (!lesson) return sendJson(res, 404, { error: 'Boot Camp lesson not found.' });
      const modules = await db.prepare('SELECT * FROM bootcamp_modules ORDER BY idx ASC').all();
      const previousModule = modules.find(module => module.idx === lesson.module_idx - 1);
      if (previousModule) {
        const previousLessons = (await bootCampLessons(previousModule.id)).filter(item => item.required);
        const previousDone = await bootCampDoneIds(agentRow.id);
        if (!previousLessons.every(item => previousDone.includes(item.id))) return sendJson(res, 409, { error: 'Complete the previous Boot Camp module first.' });
      }
      if (await bootCampLessonLocked(agentRow.id, lesson)) return sendJson(res, 409, { error: LESSON_LOCKED_ERROR });
      if ((lesson.video_url && !isGoogleDriveVideo(lesson.video_url)) && !await db.prepare('SELECT 1 FROM bootcamp_video_watches WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id)) return sendJson(res, 409, { error: 'Watch the required video before completing this lesson.' });
      if (lesson.resource_required && lesson.resource_url && !await db.prepare('SELECT 1 FROM bootcamp_resource_completions WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id)) return sendJson(res, 409, { error: 'Complete the required resource before completing this lesson.' });
      if (lesson.contract_required && lesson.contract_url && !await db.prepare('SELECT 1 FROM bootcamp_contract_completions WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id)) return sendJson(res, 409, { error: 'Complete the required contract before completing this lesson.' });
      const existing = await db.prepare('SELECT 1 FROM bootcamp_completions WHERE agent_id = ? AND lesson_id = ?').get(agentRow.id, lesson.id);
      if (existing) await db.prepare('DELETE FROM bootcamp_completions WHERE agent_id = ? AND lesson_id = ?').run(agentRow.id, lesson.id);
      else await db.prepare('INSERT INTO bootcamp_completions (agent_id, lesson_id, completed_at) VALUES (?,?,?)').run(agentRow.id, lesson.id, new Date().toISOString());
      return sendJson(res, 200, { bootcamp: await serializeBootCamp(agentRow.id) });
    }

    // ---- Agent self-service ----
    const toggleMatch = pathname.match(/^\/api\/me\/tasks\/([^/]+)\/toggle$/);
    if (toggleMatch && req.method === 'POST') {
      if (!requireAuth()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE account_id = ?').get(session.account.id);
      if (!agentRow) return sendJson(res, 404, { error: 'No agent record found.' });
      const taskId = toggleMatch[1];
      const currentStage = await serializeStage(await stageRow(agentRow.stage_id));
      if (!currentStage.tasks.some(task => task.id === taskId)) return sendJson(res, 404, { error: 'That task is not part of your current stage.' });
      const already = await db.prepare('SELECT 1 FROM agent_done_tasks WHERE agent_id = ? AND task_id = ?').get(agentRow.id, taskId);
      if (already) await db.prepare('DELETE FROM agent_done_tasks WHERE agent_id = ? AND task_id = ?').run(agentRow.id, taskId);
      else await db.prepare('INSERT INTO agent_done_tasks (agent_id, task_id) VALUES (?,?)').run(agentRow.id, taskId);
      // Completing every requirement only marks the stage ready; the owner approves advancement.
      const rewardNotice = '';
      const refreshedRow = await db.prepare('SELECT * FROM agents WHERE id = ?').get(agentRow.id);
      const refreshedStages = await allStages();
      const agent = await serializeAgent(refreshedRow);
      const newStage = await serializeStage(refreshedStages[agent.stageIndex]);
      const nextStage2 = refreshedStages[agent.stageIndex + 1];
      return sendJson(res, 200, { agent, stage: newStage, nextStageLabel: nextStage2 ? nextStage2.label : null, rewardNotice });
    }

    const advanceMatch = pathname.match(/^\/api\/agents\/([^/]+)\/advance$/);
    if (advanceMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE id = ?').get(advanceMatch[1]);
      if (!agentRow) return sendJson(res, 404, { error: 'Agent not found.' });
      const stages = await allStages();
      const stageIndex = stages.findIndex(s => s.id === agentRow.stage_id);
      if (stageIndex < 0 || stageIndex >= stages.length - 1) return sendJson(res, 400, { error: 'This agent is already in the final stage.' });
      const stage = await serializeStage(stages[stageIndex]);
      if (!readyToAdvance(agentRow, stage, await doneTaskIds(agentRow.id))) return sendJson(res, 400, { error: 'This agent has not completed every requirement for the current stage.' });
      await advanceAgentStage(agentRow, stages[stageIndex + 1]);
      return sendJson(res, 200, { agent: await serializeAgent(await db.prepare('SELECT * FROM agents WHERE id = ?').get(agentRow.id)) });
    }

    // ---- Owner: agent account management ----
    if (pathname === '/api/agents' && req.method === 'POST') {
      if (!requireOwner()) return;
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const stageId = String(body.stageId || '');
      if (!name || !email || !await stageRow(stageId)) return sendJson(res, 400, { error: 'Name, valid email and stage are required.' });
      if (await db.prepare('SELECT 1 FROM accounts WHERE lower(email) = ?').get(email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
      const tempPassword = NEW_AGENT_TEMP_PASSWORD;
      const { salt, hash } = hashPassword(tempPassword);
      const accountId = genId('acct');
      await db.prepare('INSERT INTO accounts (id, role, name, email, password_hash, password_salt, must_change_password, created_at) VALUES (?,?,?,?,?,?,1,?)').run(accountId, 'agent', name, email, hash, salt, new Date().toISOString());
      const agentId = genId('agent');
      const enteredAt = new Date().toISOString();
      await db.prepare('INSERT INTO agents (id, account_id, name, email, initials, color, stage_id, started, production) VALUES (?,?,?,?,?,?,?,?,0)').run(agentId, accountId, name, email, initialsFor(name), 'blue', stageId, enteredAt);
      await db.prepare('INSERT INTO agent_stage_history (id, agent_id, stage_id, entered_at) VALUES (?,?,?,?)').run(genId('stage-entry'), agentId, stageId, enteredAt);
      return sendJson(res, 201, { agent: await serializeAgent(await db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId)), tempPassword });
    }
    const deleteAgentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (deleteAgentMatch && req.method === 'DELETE') {
      if (!requireOwner()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE id = ?').get(deleteAgentMatch[1]);
      if (!agentRow) return sendJson(res, 404, { error: 'Agent not found.' });
      await db.prepare('DELETE FROM agent_done_tasks WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM bootcamp_completions WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM bootcamp_video_watches WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM bootcamp_video_progress WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM bootcamp_resource_completions WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM bootcamp_contract_completions WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM agent_stage_history WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM owner_notifications WHERE agent_id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM agents WHERE id = ?').run(agentRow.id);
      await db.prepare('DELETE FROM sessions WHERE account_id = ?').run(agentRow.account_id);
      await db.prepare('DELETE FROM accounts WHERE id = ? AND role = \'agent\'').run(agentRow.account_id);
      return sendJson(res, 200, { ok: true });
    }
    const resetMatch = pathname.match(/^\/api\/agents\/([^/]+)\/reset-password$/);
    if (resetMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const agentRow = await db.prepare('SELECT * FROM agents WHERE id = ?').get(resetMatch[1]);
      if (!agentRow) return sendJson(res, 404, { error: 'Agent not found.' });
      const tempPassword = genTempPassword();
      const { salt, hash } = hashPassword(tempPassword);
      await db.prepare('UPDATE accounts SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, agentRow.account_id);
      return sendJson(res, 200, { tempPassword });
    }
    if (pathname === '/api/account/password' && req.method === 'POST') {
      if (!requireAuth()) return;
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!session.account.must_change_password && !verifyPassword(currentPassword, session.account.password_salt, session.account.password_hash)) return sendJson(res, 400, { error: 'Current password is incorrect.' });
      if (newPassword.length < 8) return sendJson(res, 400, { error: 'New password must be at least 8 characters.' });
      if (newPassword !== String(body.confirmPassword || '')) return sendJson(res, 400, { error: 'New passwords do not match.' });
      const { salt, hash } = hashPassword(newPassword);
      await db.prepare('UPDATE accounts SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?').run(hash, salt, session.account.id);
      await db.prepare('DELETE FROM sessions WHERE account_id = ? AND token != ?').run(session.account.id, session.token);
      return sendJson(res, 200, { ok: true });
    }

    // ---- Owner: stage & task management ----
    const stageMatch = pathname.match(/^\/api\/stages\/([^/]+)$/);
    if (stageMatch && req.method === 'PATCH') {
      if (!requireOwner()) return;
      const stage = await stageRow(stageMatch[1]);
      if (!stage) return sendJson(res, 404, { error: 'Stage not found.' });
      const timeframe = body.timeframe !== undefined ? Math.max(1, Number(body.timeframe) || 1) : stage.timeframe;
      const reward = body.reward !== undefined ? String(body.reward) : stage.reward;
      const resourceUrl = body.resourceUrl !== undefined ? String(body.resourceUrl) : stage.resource_url;
      await db.prepare('UPDATE stages SET timeframe = ?, reward = ?, resource_url = ? WHERE id = ?').run(timeframe, reward, resourceUrl, stage.id);
      return sendJson(res, 200, { stage: await serializeStage(await stageRow(stage.id)) });
    }
    const taskListMatch = pathname.match(/^\/api\/stages\/([^/]+)\/tasks$/);
    if (taskListMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const stage = await stageRow(taskListMatch[1]);
      if (!stage) return sendJson(res, 404, { error: 'Stage not found.' });
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Task title is required.' });
      const maxIdx = Number((await db.prepare('SELECT COALESCE(MAX(idx), -1) AS m FROM tasks WHERE stage_id = ?').get(stage.id)).m);
      const taskId = genId('task');
      await db.prepare('INSERT INTO tasks (id, stage_id, idx, title, instructions, loom_url, required) VALUES (?,?,?,?,?,?,?)').run(taskId, stage.id, maxIdx + 1, title, String(body.instructions || ''), String(body.loom || ''), body.required === false ? 0 : 1);
      return sendJson(res, 201, { stage: await serializeStage(await stageRow(stage.id)) });
    }
    const taskItemMatch = pathname.match(/^\/api\/stages\/([^/]+)\/tasks\/([^/]+)$/);
    if (taskItemMatch && req.method === 'PATCH') {
      if (!requireOwner()) return;
      const [, stageId, taskId] = taskItemMatch;
      const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND stage_id = ?').get(taskId, stageId);
      if (!task) return sendJson(res, 404, { error: 'Task not found.' });
      await db.prepare('UPDATE tasks SET title = ?, instructions = ?, loom_url = ?, required = ? WHERE id = ?').run(body.title !== undefined ? String(body.title) : task.title,
        body.instructions !== undefined ? String(body.instructions) : task.instructions,
        body.loom !== undefined ? String(body.loom) : task.loom_url,
        body.required === false ? 0 : 1,
        taskId);
      return sendJson(res, 200, { stage: await serializeStage(await stageRow(stageId)) });
    }
    if (taskItemMatch && req.method === 'DELETE') {
      if (!requireOwner()) return;
      const [, stageId, taskId] = taskItemMatch;
      await db.prepare('DELETE FROM tasks WHERE id = ? AND stage_id = ?').run(taskId, stageId);
      return sendJson(res, 200, { stage: await serializeStage(await stageRow(stageId)) });
    }
    const taskMoveMatch = pathname.match(/^\/api\/stages\/([^/]+)\/tasks\/([^/]+)\/move$/);
    if (taskMoveMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const [, stageId, taskId] = taskMoveMatch;
      const tasks = await tasksForStage(stageId);
      const index = tasks.findIndex(t => t.id === taskId);
      const targetIndex = body.direction === 'up' ? index - 1 : index + 1;
      if (index === -1 || targetIndex < 0 || targetIndex >= tasks.length) return sendJson(res, 200, { stage: await serializeStage(await stageRow(stageId)) });
      const a = tasks[index], b = tasks[targetIndex];
      await db.prepare('UPDATE tasks SET idx = ? WHERE id = ?').run(b.idx, a.id);
      await db.prepare('UPDATE tasks SET idx = ? WHERE id = ?').run(a.idx, b.id);
      return sendJson(res, 200, { stage: await serializeStage(await stageRow(stageId)) });
    }

    // ---- Owner: recruiting pipeline ----
    if (pathname === '/api/recruits' && req.method === 'GET') {
      if (!requireOwner()) return;
      return sendJson(res, 200, { recruits: await db.prepare('SELECT * FROM recruits ORDER BY created_at DESC').all() });
    }
    if (pathname === '/api/recruits' && req.method === 'POST') {
      if (!requireOwner()) return;
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'Name is required.' });
      const id = genId('recruit');
      await db.prepare('INSERT INTO recruits (id, name, email, phone, notes, status, created_at) VALUES (?,?,?,?,?,?,?)').run(id, name, String(body.email || ''), String(body.phone || ''), String(body.notes || ''), 'interested', new Date().toISOString());
      return sendJson(res, 201, { recruit: await db.prepare('SELECT * FROM recruits WHERE id = ?').get(id) });
    }
    const recruitMatch = pathname.match(/^\/api\/recruits\/([^/]+)$/);
    if (recruitMatch && req.method === 'PATCH') {
      if (!requireOwner()) return;
      const recruit = await db.prepare('SELECT * FROM recruits WHERE id = ?').get(recruitMatch[1]);
      if (!recruit) return sendJson(res, 404, { error: 'Prospect not found.' });
      const status = body.status !== undefined ? String(body.status) : recruit.status;
      if (!['interested', 'licensing', 'licensed'].includes(status)) return sendJson(res, 400, { error: 'Invalid status.' });
      await db.prepare('UPDATE recruits SET name = ?, email = ?, phone = ?, notes = ?, status = ? WHERE id = ?').run(body.name !== undefined ? String(body.name) : recruit.name,
        body.email !== undefined ? String(body.email) : recruit.email,
        body.phone !== undefined ? String(body.phone) : recruit.phone,
        body.notes !== undefined ? String(body.notes) : recruit.notes,
        status, recruit.id);
      return sendJson(res, 200, { recruit: await db.prepare('SELECT * FROM recruits WHERE id = ?').get(recruit.id) });
    }
    if (recruitMatch && req.method === 'DELETE') {
      if (!requireOwner()) return;
      await db.prepare('DELETE FROM recruits WHERE id = ?').run(recruitMatch[1]);
      return sendJson(res, 200, { ok: true });
    }
    const convertMatch = pathname.match(/^\/api\/recruits\/([^/]+)\/convert$/);
    if (convertMatch && req.method === 'POST') {
      if (!requireOwner()) return;
      const recruit = await db.prepare('SELECT * FROM recruits WHERE id = ?').get(convertMatch[1]);
      if (!recruit) return sendJson(res, 404, { error: 'Prospect not found.' });
      if (recruit.status !== 'licensed') return sendJson(res, 400, { error: 'Only licensed prospects can become agents.' });
      const email = String(body.email || recruit.email || '').trim().toLowerCase();
      const stageId = String(body.stageId || '');
      if (!email || !await stageRow(stageId)) return sendJson(res, 400, { error: 'A valid email and stage are required.' });
      if (await db.prepare('SELECT 1 FROM accounts WHERE lower(email) = ?').get(email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });
      const tempPassword = genTempPassword();
      const { salt, hash } = hashPassword(tempPassword);
      const accountId = genId('acct');
      await db.prepare('INSERT INTO accounts (id, role, name, email, password_hash, password_salt, must_change_password, created_at) VALUES (?,?,?,?,?,?,1,?)').run(accountId, 'agent', recruit.name, email, hash, salt, new Date().toISOString());
      const agentId = genId('agent');
      const enteredAt = new Date().toISOString();
      await db.prepare('INSERT INTO agents (id, account_id, name, email, initials, color, stage_id, started, production) VALUES (?,?,?,?,?,?,?,?,0)').run(agentId, accountId, recruit.name, email, initialsFor(recruit.name), 'blue', stageId, enteredAt);
      await db.prepare('INSERT INTO agent_stage_history (id, agent_id, stage_id, entered_at) VALUES (?,?,?,?)').run(genId('stage-entry'), agentId, stageId, enteredAt);
      await db.prepare('DELETE FROM recruits WHERE id = ?').run(recruit.id);
      return sendJson(res, 201, { agent: await serializeAgent(await db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId)), tempPassword });
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: 'Server error.' });
  }
});

if (listen) server.listen(PORT, () => console.log(`The Agent Forge running on http://localhost:${PORT}`));
return server;
}

if (require.main === module) {
  main({ listen: true }).catch(error => { console.error(error); process.exit(1); });
} else {
  const serverPromise = main();
  module.exports = async (req, res) => {
    try {
      const server = await serverPromise;
      server.emit('request', req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        const body = JSON.stringify({ error: 'Server startup failed.' });
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      }
    }
  };
}
