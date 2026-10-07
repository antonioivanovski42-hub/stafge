// The Agent Forge — frontend. All data is fetched from and persisted by the backend API; no local mock database.
let me = null, data = null, view = 'owner', selectedStage = 0, selectedAgent = null, editingTask = null, showAccountModal = false, accountModalContext = null, showRecruitModal = false, editingRecruit = null, tempPasswordNotice = null, rewardNotice = '', formError = '', needsAdminSetup = false, setupEmail = '', accountSettingsError = '', accountSettingsNotice = '';
const app = document.querySelector('#app');
const authRoot = document.querySelector('#auth-root');
const daysSince = iso => Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const avatar = agent => `<span class="avatar avatar-${agent.color || 'blue'}">${agent.initials}</span>`;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}
async function boot() {
  try { const bootstrap = await api('/api/bootstrap'); me = bootstrap.user; data = bootstrap; needsAdminSetup = false; render(); return; }
  catch { me = null; data = null; }
  try { const status = await api('/api/admin-setup-status'); needsAdminSetup = status.needsSetup; setupEmail = status.needsSetup ? setupEmail : ''; }
  catch { needsAdminSetup = false; }
  render();
}
async function refreshData() { try { data = await api('/api/bootstrap'); } catch { me = null; data = null; } render(); }
let taskToggleBusy = false;
async function toggleTask(taskId) {
  if (taskToggleBusy || !me || me.role !== 'agent' || !data || !data.agent || !data.stage) return;
  taskToggleBusy = true;
  const snapshot = { agent: data.agent, stage: data.stage, next: data.nextStageLabel };
  // Update the checkbox and percentage immediately; the server response then replaces this with the authoritative values.
  const agent = { ...data.agent }, stage = data.stage;
  agent.done = agent.done.includes(taskId) ? agent.done.filter(id => id !== taskId) : [...agent.done, taskId];
  const required = stage.tasks.filter(task => task.required);
  const total = required.length;
  agent.progress = total ? Math.min(100, Math.round(((required.filter(task => agent.done.includes(task.id)).length) / total) * 100)) : 0;
  data.agent = agent;
  formError = '';
  render();
  try {
    const result = await api(`/api/me/tasks/${taskId}/toggle`, { method: 'POST' });
    data.agent = result.agent; data.stage = result.stage; data.nextStageLabel = result.nextStageLabel;
  } catch (error) {
    data.agent = snapshot.agent; data.stage = snapshot.stage; data.nextStageLabel = snapshot.next; formError = error.message;
  }
  taskToggleBusy = false;
  render();
}
async function mutate(promiseFactory) {
  formError = '';
  try { await promiseFactory(); await refreshData(); }
  catch (error) { formError = error.message; render(); }
}

function login() { return `<div class="auth-screen"><div class="auth-card"><div class="brand-mark">E</div><div class="eyebrow">Empire Financial</div><h1>Sign in to your workspace</h1><p>Owner access manages the agency. Agent access is limited to one personal success path.</p><form id="login-form"><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button class="primary-button">Sign in <span>→</span></button></form><div id="login-error" class="form-error">${escapeHtml(formError)}</div></div></div>`; }
function adminSetup() { return `<div class="auth-screen"><div class="auth-card"><div class="brand-mark">E</div><div class="eyebrow">Empire Financial · First-time setup</div><h1>Set up your admin account</h1><p>This account manages the entire agency. Choose a strong password — it is never stored in plain text.</p><form id="admin-setup-form"><label>Admin email<input name="email" type="email" value="antonioivanovski42@gmail.com" readonly></label><label>Create password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary-button">Create admin password <span>→</span></button></form><div id="login-error" class="form-error">${escapeHtml(formError)}</div></div></div>`; }

function pathSection() {
  const owner = me.role === 'owner';
  const list = owner ? data.stages : data.timeline;
  const currentIndex = owner ? -1 : data.agent.stageIndex;
  const overallPercent = owner ? list.length : Math.round(((currentIndex + (data.agent.progress / 100)) / list.length) * 100);
  return `<section class="card path-card"><div class="path-head"><div><div class="eyebrow">${owner ? 'Agency progression' : 'Your progression'}</div><h2>Path to success</h2></div><span class="path-meta">${owner ? 'Click any stage to manage' : 'Overall path progress'} <strong>${owner ? overallPercent : overallPercent + '%'}</strong></span></div><div class="path">${list.map((stage, index) => { const state = owner ? '' : index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'locked'; return `<button class="stage-node ${state}" data-stage="${index}"><span class="stage-dot">${owner ? index + 1 : index < currentIndex ? '✓' : index === currentIndex ? '●' : '—'}</span><span class="stage-label">${stage.short}</span><span class="stage-status">${owner ? 'Open' : index < currentIndex ? 'Complete' : index === currentIndex ? 'Current' : 'Locked'}</span></button>`; }).join('')}</div></section>`;
}

function stageStats(stageId) { const list = data.agents.filter(agent => agent.stageId === stageId); const average = list.length ? Math.round(list.reduce((sum, agent) => sum + agent.progress, 0) / list.length) : 0; return { list, average, attention: list.filter(agent => agent.flag !== 'on-track').length }; }
function ownerAlerts() { const notifications = data.notifications || []; return notifications.length ? `<section class="attention-panel"><div class="eyebrow">Owner attention</div>${notifications.map(notification => `<div class="attention-row"><span class="status-dot warn"></span><span><b>${escapeHtml(notification.agent_name)}</b> has been in ${escapeHtml(data.agents.find(agent => agent.id === notification.agent_id)?.stageLabel || 'the current stage')} for 90+ days.</span></div>`).join('')}</section>` : ''; }

function owner() {
  return `<div class="page-heading"><div><div class="eyebrow">Agency owner view</div><h1>Agency progression</h1><p>One operating picture for every agent, stage and next milestone.</p></div><button class="primary-button" data-action="add-agent">＋ Add agent</button></div>${ownerAlerts()}${pathSection()}<section class="section-heading"><div><div class="eyebrow">Stage health</div><h2>Five stages. One clear view.</h2></div><span class="path-meta">${data.agents.length} agents in motion</span></section><div class="stage-grid">${data.stages.map((stage, index) => { const stats = stageStats(stage.id); return `<button class="card stage-card ${index === selectedStage ? 'selected' : ''}" data-stage="${index}"><div class="stage-card-top"><span class="stage-index">0${index + 1}</span><span class="status-dot ${stats.attention ? 'warn' : ''}"></span></div><h3>${stage.label}</h3><strong>${stats.list.length} <small>agents</small></strong><div class="progress-row"><span>Average progress</span><b>${stats.average}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${stats.average}%"></div></div><div class="stage-card-foot"><span>${stats.attention ? stats.attention + ' need attention' : 'All on track'}</span><span>Manage →</span></div></button>`; }).join('')}</div>${ownerStage()}${ownerAccounts()}${showAccountModal ? accountModal() : ''}`;
}
function ownerAccounts() { return `<section class="card account-panel"><div class="subhead"><div><div class="eyebrow">Access management</div><h3>Agent accounts</h3></div><span class="path-meta">${data.agents.length} accounts</span></div>${data.agents.length ? data.agents.map(agent => `<div class="account-row">${avatar(agent)}<span><b>${escapeHtml(agent.name)}</b><small>${escapeHtml(agent.email)} · ${escapeHtml(agent.stageLabel)} · ${agent.daysInStage} days</small></span><button class="row-action" data-view-agent="${agent.id}">View</button><button class="row-action" data-reset-agent="${agent.id}">Reset access</button><button class="row-action danger" data-delete-agent="${agent.id}">Delete agent</button></div>`).join('') : '<div class="empty">No agent accounts yet. Create one to begin assigning real agents.</div>'}</section>`; }
function ownerStage() {
  const stage = data.stages[selectedStage], stats = stageStats(stage.id);
  return `<section class="owner-detail card"><div class="detail-header"><div><div class="eyebrow">Stage ${String(selectedStage + 1).padStart(2, '0')} · Owner controls</div><h2>${stage.label}</h2><p>${stage.description}</p></div><label class="timeframe">Expected timeframe <input id="timeframe" type="number" value="${stage.timeframe}" min="1"> days</label></div><div class="owner-fields"><label>Stage reward <span class="optional">Optional</span><input id="stage-reward" value="${escapeHtml(stage.reward)}" placeholder="e.g. Private coaching session"></label><label>Stage resource Loom URL <span class="optional">Optional</span><input id="stage-resource" type="url" value="${escapeHtml(stage.resources[0] || '')}" placeholder="https://www.loom.com/share/..."></label><button class="ghost-button" data-action="save-stage-settings">Save stage settings</button></div><div class="owner-detail-grid"><div><div class="subhead"><h3>Requirements & resources</h3><button class="ghost-button" data-action="add-task">＋ Add task</button></div><div class="task-editor">${stage.tasks.map((task, index) => `<div class="task-row"><span class="drag">⋮⋮</span><div class="task-copy"><b>${escapeHtml(task.title)}</b><span>${escapeHtml(task.instructions)}</span>${task.loom ? '<small>LOOM VIDEO ATTACHED</small>' : ''}</div><span class="required-badge">${task.required ? 'REQUIRED' : 'OPTIONAL'}</span><button class="row-action" data-move="${task.id}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button><button class="row-action" data-move="${task.id}" data-direction="down" ${index === stage.tasks.length - 1 ? 'disabled' : ''}>↓</button><button class="row-action" data-edit="${task.id}">Edit</button><button class="row-action danger" data-delete="${task.id}">×</button></div>`).join('')}</div></div><div><div class="subhead"><h3>Agents in stage</h3><span class="path-meta">${stats.list.length} total</span></div><div class="agent-list">${stats.list.length ? stats.list.map(agent => `<button class="agent-row" data-view-agent="${agent.id}">${avatar(agent)}<span><b>${escapeHtml(agent.name)}</b><small>${agent.progress}% complete · ${daysSince(agent.started)} days</small></span><span class="flag ${agent.readyForAdvancement ? 'ready' : agent.flag}">${agent.readyForAdvancement ? 'Ready to advance' : agent.flag === 'on-track' ? 'On track' : agent.flag === 'stuck' ? 'Stuck' : 'Needs attention'}</span></button>`).join('') : '<div class="empty">No agents are currently in this stage.</div>'}</div></div></div>${editingTask !== null ? taskModal(stage, editingTask) : ''}</section>`;
}
function taskModal(stage, taskId) {
  const task = taskId === -1 ? { title: '', instructions: '', loom: '', required: true } : stage.tasks.find(t => t.id === taskId);
  return `<div class="modal-backdrop"><form class="modal" id="task-form"><button type="button" class="modal-close" data-action="close-modal">×</button><div class="eyebrow">Stage requirement</div><h2>${taskId === -1 ? 'Create task' : 'Edit task'}</h2><label>Task title<input name="title" value="${escapeHtml(task.title)}" required></label><label>Instructions<textarea name="instructions" rows="3">${escapeHtml(task.instructions)}</textarea></label><label>Loom video URL <span class="optional">Optional</span><input name="loom" type="url" value="${escapeHtml(task.loom)}" placeholder="https://www.loom.com/share/..."></label><label class="check-label"><input type="checkbox" name="required" ${task.required !== false ? 'checked' : ''}> Required to unlock next stage</label><div class="modal-actions"><button type="button" class="ghost-button" data-action="close-modal">Cancel</button><button class="primary-button">Save task</button></div></form></div>`;
}
function accountModal() {
  const isConvert = accountModalContext && accountModalContext.mode === 'convert';
  const recruit = isConvert ? data.recruits.find(r => r.id === accountModalContext.recruitId) : null;
  return `<div class="modal-backdrop"><form class="modal" id="account-form"><button type="button" class="modal-close" data-action="close-account">×</button><div class="eyebrow">Owner control</div><h2>${isConvert ? 'Create agent account for ' + escapeHtml(recruit.name) : 'Create agent account'}</h2><label>Agent name<input name="name" value="${isConvert ? escapeHtml(recruit.name) : ''}" ${isConvert ? 'readonly' : ''} required></label><label>Agent email<input name="email" type="email" value="${isConvert ? escapeHtml(recruit.email) : ''}" required></label><label>Assign starting stage<select name="stage">${data.stages.map((stage, index) => `<option value="${stage.id}">${stage.label}</option>`).join('')}</select></label><p class="optional">A secure temporary password will be generated automatically and shown once you save.</p><div class="modal-actions"><button type="button" class="ghost-button" data-action="close-account">Cancel</button><button class="primary-button">Create account</button></div></form></div>`;
}
function tempPasswordModal() { return `<div class="modal-backdrop"><div class="modal"><button type="button" class="modal-close" data-action="close-temp-password">×</button><div class="eyebrow">Account created</div><h2>${escapeHtml(tempPasswordNotice.name)}</h2><p>Share this temporary password securely. It will not be shown again.</p><div class="task-row"><b class="temp-password">${escapeHtml(tempPasswordNotice.tempPassword)}</b></div><div class="modal-actions"><button type="button" class="primary-button" data-action="close-temp-password">Done</button></div></div></div>`; }
function accountSettings() { return `<div class="page-heading"><div><div class="eyebrow">Owner account</div><h1>Account settings</h1><p>Manage your account details and password.</p></div><button class="ghost-button" data-action="back-to-overview">← Back to overview</button></div><section class="card account-settings-card"><div class="subhead"><div><div class="eyebrow">Account details</div><h2>${escapeHtml(me.name)}</h2></div></div><div class="account-detail"><span>Name</span><b>${escapeHtml(me.name)}</b></div><div class="account-detail"><span>Email</span><b>${escapeHtml(me.email)}</b></div></section><section class="card account-settings-card"><div class="subhead"><div><div class="eyebrow">Security</div><h2>Change password</h2></div></div><form id="change-password-form" class="settings-form"><label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>New password<input name="newPassword" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label><button class="primary-button">Change password</button></form><div class="form-error">${escapeHtml(accountSettingsError)}</div>${accountSettingsNotice ? `<div class="settings-notice">${escapeHtml(accountSettingsNotice)}</div>` : ''}</section>`; }

function agentView(agentData, ownerViewing = false) {
  const { agent, stage, nextStageLabel } = agentData;
  const next = stage.tasks.find(task => !agent.done.includes(task.id));
  const history = agent.stageHistory || [];
  return `<div class="page-heading"><div><div class="eyebrow">${ownerViewing ? 'Owner view · ' : 'Agent view · '}${escapeHtml(agent.name)}</div><h1>${ownerViewing ? escapeHtml(agent.name) + "'s success path" : 'Your success path'}</h1><p>${ownerViewing ? 'Read-only view of this agent' + String.fromCharCode(8217) + 's progress.' : 'Only your progress, tasks and assigned resources are visible in this view.'}</p></div>${ownerViewing ? '<button class="ghost-button" data-action="back-to-overview">← Back to overview</button>' : ''}</div><section class="card path-card"><div class="path-head"><div><div class="eyebrow">Progression</div><h2>Path to success</h2></div></div><div class="path">${agentData.timeline.map((s, index) => { const state = index < agent.stageIndex ? 'complete' : index === agent.stageIndex ? 'current' : 'locked'; return `<button class="stage-node ${state}" disabled><span class="stage-dot">${index < agent.stageIndex ? '✓' : index === agent.stageIndex ? '●' : '—'}</span><span class="stage-label">${s.short}</span><span class="stage-status">${index < agent.stageIndex ? 'Complete' : index === agent.stageIndex ? 'Current' : 'Locked'}</span></button>`; }).join('')}</div></section><div class="agent-layout"><div><section class="card current-card"><div class="current-kicker"><div class="eyebrow">Where am I? · Stage ${agent.stageIndex + 1} of ${agentData.timeline.length}</div><span class="status-pill ${agent.readyForAdvancement || agent.flag !== 'on-track' ? 'attention' : ''}">${agent.readyForAdvancement ? 'Ready for Advancement' : agent.flag === 'on-track' ? 'On track' : agent.flag === 'stuck' ? 'Stuck' : 'Needs attention'}</span></div><h2>${stage.label}</h2><p class="subline">${stage.description}</p><div class="progress-row"><span>Stage progress</span><b>${agent.progress}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${agent.progress}%"></div></div>${agent.readyForAdvancement ? `<div class="stage-ready" role="status"><b>Ready for Advancement</b>${ownerViewing ? `<span>All requirements are complete. Approve to move ${escapeHtml(agent.name)} to ${escapeHtml(nextStageLabel || 'the next stage')}.</span><button class="primary-button" data-advance-agent="${agent.id}">Approve advancement <span>→</span></button>` : '<span>Stage Complete — Contact your upline to advance.</span>'}</div>` : ''}<div class="metrics"><div class="metric"><b>${agent.daysInStage} days</b><span>Time in stage</span></div><div class="metric"><b>${stage.threshold ? '$' + agent.production.toLocaleString() : agent.progress + '%'}</b><span>${stage.threshold ? 'Issue-paid production' : 'Requirements complete'}</span></div><div class="metric"><b>${stage.tasks.filter(task => !agent.done.includes(task.id)).length}</b><span>Steps remaining</span></div></div></section><section class="card requirements-card"><div class="subhead"><h3>What do I need to complete?</h3><span class="path-meta">${agent.done.filter(id => stage.tasks.some(task => task.id === id)).length} of ${stage.tasks.length}</span></div><div class="req-list">${stage.tasks.map(task => { const done = agent.done.includes(task.id); return `<div class="req-item ${done ? 'done' : ''}"><button class="check" ${ownerViewing ? 'disabled' : ''} data-complete="${task.id}">${done ? '✓' : ''}</button><div><b>${escapeHtml(task.title)}</b><span>${escapeHtml(task.instructions)}</span>${task.loom ? `<a class="loom-link" href="${escapeHtml(task.loom)}" target="_blank">▶ Watch Loom video</a>` : ''}</div></div>`; }).join('')}</div></section>${history.length > 1 ? `<section class="card history-card"><div class="subhead"><h3>Stage history</h3><span class="path-meta">${history.length} entries</span></div>${history.slice(0, -1).reverse().map(entry => `<div class="history-row"><span>${escapeHtml(entry.stageLabel)}</span><b>${entry.days} days</b></div>`).join('')}</section>` : ''}</div><aside class="side-stack">${stage.resources[0] ? `<section class="card resources-card"><h3>Stage resource</h3><a class="loom-link" href="${escapeHtml(stage.resources[0])}" target="_blank">▶ Watch assigned Loom resource</a></section>` : ''}<section class="milestone-card"><div class="eyebrow">What unlocks next?</div><h3>${nextStageLabel || 'Leadership impact'}</h3><p>Complete all required tasks, then your upline approves your advancement.</p><span class="milestone-action">${next ? 'Next: ' + escapeHtml(next.title) : stage.reward || 'Finish the checklist'} →</span></section>${stage.reward ? `<section class="reward-card"><div class="eyebrow">Stage reward</div><h3>${escapeHtml(stage.reward)}</h3><p>Earned when this stage is completed.</p></section>` : ''}</aside></div>${!ownerViewing && rewardNotice ? `<div class="reward-toast">Stage advanced · ${escapeHtml(rewardNotice)}</div>` : ''}`;
}

function recruitStatusLabel(status) { return status === 'interested' ? 'Interested' : status === 'licensing' ? 'Licensing' : 'Licensed'; }
function recruitCard(recruit) {
  const order = ['interested', 'licensing', 'licensed'];
  const index = order.indexOf(recruit.status);
  return `<div class="card recruit-card"><div class="recruit-card-top"><b>${escapeHtml(recruit.name)}</b><span class="required-badge">${recruitStatusLabel(recruit.status)}</span></div>${recruit.email ? `<small>${escapeHtml(recruit.email)}</small>` : ''}${recruit.phone ? `<small>${escapeHtml(recruit.phone)}</small>` : ''}${recruit.notes ? `<p class="recruit-notes">${escapeHtml(recruit.notes)}</p>` : ''}<div class="recruit-actions">${index > 0 ? `<button class="row-action" data-recruit-move="${recruit.id}" data-direction="back">← ${recruitStatusLabel(order[index - 1])}</button>` : ''}${index < order.length - 1 ? `<button class="row-action" data-recruit-move="${recruit.id}" data-direction="forward">${recruitStatusLabel(order[index + 1])} →</button>` : ''}<button class="row-action" data-recruit-edit="${recruit.id}">Edit</button><button class="row-action danger" data-recruit-delete="${recruit.id}">×</button>${recruit.status === 'licensed' ? `<button class="primary-button" data-recruit-convert="${recruit.id}">Create agent</button>` : ''}</div></div>`;
}
function recruits() {
  const columns = ['interested', 'licensing', 'licensed'];
  return `<div class="page-heading"><div><div class="eyebrow">Owner only · Pipeline management</div><h1>Recruiting pipeline</h1><p>Track prospects from first conversation to licensed — separate from active agent development.</p></div><button class="primary-button" data-action="add-recruit">＋ Add prospect</button></div><div class="pipeline-board">${columns.map(status => { const list = data.recruits.filter(r => r.status === status); return `<div class="pipeline-column"><div class="pipeline-column-head"><h3>${recruitStatusLabel(status)}</h3><span class="path-meta">${list.length}</span></div><div class="pipeline-column-body">${list.length ? list.map(recruitCard).join('') : '<div class="empty">No prospects here yet.</div>'}</div></div>`; }).join('')}</div>${showRecruitModal ? recruitModal() : ''}${showAccountModal ? accountModal() : ''}`;
}
function recruitModal() {
  const recruit = editingRecruit ? data.recruits.find(r => r.id === editingRecruit) : { name: '', email: '', phone: '', notes: '' };
  return `<div class="modal-backdrop"><form class="modal" id="recruit-form"><button type="button" class="modal-close" data-action="close-recruit-modal">×</button><div class="eyebrow">Recruiting pipeline</div><h2>${editingRecruit ? 'Edit prospect' : 'Add prospect'}</h2><label>Name<input name="name" value="${escapeHtml(recruit.name)}" required></label><label>Email <span class="optional">Optional</span><input name="email" type="email" value="${escapeHtml(recruit.email)}"></label><label>Phone <span class="optional">Optional</span><input name="phone" value="${escapeHtml(recruit.phone)}"></label><label>Notes <span class="optional">Optional</span><textarea name="notes" rows="3">${escapeHtml(recruit.notes)}</textarea></label><div class="modal-actions"><button type="button" class="ghost-button" data-action="close-recruit-modal">Cancel</button><button class="primary-button">Save prospect</button></div></form></div>`;
}

function bootCampProgress(bootcamp) { return bootcamp.totalLessons ? Math.round((bootcamp.completedLessons / bootcamp.totalLessons) * 100) : 0; }
function videoEmbedInfo(videoUrl, lessonId) {
  try {
    const url = new URL(videoUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
      const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
      if (!id || !/^[\w-]{11}$/.test(id)) return null;
      return { provider: 'youtube', id, src: `https://www.youtube.com/embed/${encodeURIComponent(id)}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}` };
    }
    if (host === 'youtu.be') {
      const id = url.pathname.match(/^\/([^/]+)/)?.[1];
      return id && /^[\w-]{11}$/.test(id) ? { provider: 'youtube', id, src: `https://www.youtube.com/embed/${encodeURIComponent(id)}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}` } : null;
    }
    if (host === 'loom.com') {
      const id = url.pathname.match(/^\/(?:share|embed)\/([^/]+)/)?.[1];
      return id && /^[\w-]+$/.test(id) ? { provider: 'loom', id, src: `https://www.loom.com/embed/${encodeURIComponent(id)}` } : null;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const id = url.pathname.match(/^\/(?:video\/)?(\d+)/)?.[1];
      if (!id) return null;
      const privacyHash = url.searchParams.get('h') || url.pathname.match(/^\/\d+\/([\w-]+)/)?.[1];
      const query = new URLSearchParams({ api: '1', player_id: `video-${lessonId}` });
      if (privacyHash) query.set('h', privacyHash);
      return { provider: 'vimeo', id, src: `https://player.vimeo.com/video/${id}?${query}` };
    }
    if (host === 'drive.google.com') {
      const id = url.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1] || url.searchParams.get('id');
      return id && /^[\w-]+$/.test(id) ? { provider: 'google-drive', id, src: `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview` } : null;
    }
  } catch {}
  return null;
}
let youtubeApiPromise;
let vimeoApiPromise;
let bootCampVideoCleanup = [];
let activeBootCampLesson = null;
let lastRenderedBootCampHtml = '';
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApiPromise) youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('YouTube player API could not be loaded.'));
    document.head.append(script);
  });
  return youtubeApiPromise;
}
function loadVimeoApi() {
  if (window.Vimeo?.Player) return Promise.resolve(window.Vimeo);
  if (!vimeoApiPromise) vimeoApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://player.vimeo.com/api/player.js';
    script.onload = () => window.Vimeo?.Player ? resolve(window.Vimeo) : reject(new Error('Vimeo player API is unavailable.'));
    script.onerror = () => reject(new Error('Vimeo player API could not be loaded.'));
    document.head.append(script);
  });
  return vimeoApiPromise;
}
function bootCampVideoStatus(frame, text) {
  const status = document.querySelector(`[data-video-status="${CSS.escape(frame.dataset.lessonId)}"]`);
  if (status) status.textContent = text;
}
function bootCampVideoFallback(frame, message) {
  bootCampVideoStatus(frame, message);
  const link = document.createElement('a');
  link.className = 'loom-link';
  link.href = frame.dataset.originalUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Open Video';
  frame.insertAdjacentElement('afterend', link);
}
function initBootCampVideoPlayer(frame) {
  const lessonId = frame.dataset.lessonId;
  const cleanups = [];
  let watched = frame.dataset.videoWatched === 'true';
  let duration = 0;
  let playing = false;
  let currentPosition = Number(frame.dataset.videoPosition) || 0;
  let furthestPosition = Number(frame.dataset.videoFurthest) || currentPosition;
  let lastSampleAt = performance.now();
  let lastCheckpointAt = 0;
  let checkpointQueue = Promise.resolve();
  let player;
  let pollTimer;
  let seekTo = () => {};
  const statusText = progress => progress.watched
    ? '✓ Training Completed'
    : `Video Training — ${progress.watchedPercent}% watched`;
  const applyProgress = progress => {
    if (!progress) return;
    watched = progress.watched;
    currentPosition = Number(progress.position) || 0;
    furthestPosition = Math.max(currentPosition, Number(progress.furthest) || 0);
    bootCampVideoStatus(frame, statusText(progress));
    const check = document.querySelector(`[data-video-check="${CSS.escape(lessonId)}"]`);
    if (check) check.disabled = !watched || check.dataset.moduleUnlocked !== 'true' || check.dataset.requirementsReady !== 'true' || check.dataset.alreadyDone === 'true';
  };
  const save = (position, videoDuration, isPlaying, force = false) => {
    if (watched || !Number.isFinite(position) || !Number.isFinite(videoDuration) || videoDuration <= 0) return;
    const now = performance.now();
    if (!force && now - lastCheckpointAt < 3000) return;
    lastCheckpointAt = now;
    checkpointQueue = checkpointQueue.then(async () => {
      const response = await api(`/api/me/bootcamp/lessons/${encodeURIComponent(lessonId)}/video-progress`, {
        method: 'POST',
        body: JSON.stringify({ currentTime: position, duration: videoDuration, playing: isPlaying }),
        keepalive: force === 'pagehide'
      });
      if (!frame.isConnected) return;
      applyProgress(response.progress);
      if (!response.watched && position > response.progress.position + 1.5) seekTo(response.progress.position);
    }).catch(error => {
      if (frame.isConnected) bootCampVideoStatus(frame, `Video progress could not be saved: ${error.message}`);
    });
  };
  const sample = (position, videoDuration) => {
    if (!Number.isFinite(position) || !Number.isFinite(videoDuration) || videoDuration <= 0) return;
    duration = videoDuration;
    const now = performance.now();
    const elapsed = Math.min(2, Math.max(0.1, (now - lastSampleAt) / 1000));
    if (!watched && position > furthestPosition + elapsed * 1.7 + 1.5) {
      seekTo(furthestPosition);
      position = furthestPosition;
    }
    currentPosition = Math.max(0, Math.min(position, videoDuration));
    furthestPosition = Math.max(furthestPosition, currentPosition);
    lastSampleAt = now;
    save(currentPosition, videoDuration, playing);
  };
  const pauseAndSave = (position, videoDuration) => {
    playing = false;
    sample(position, videoDuration);
    save(currentPosition, videoDuration, false, true);
  };
  const onPageHide = () => save(currentPosition, duration, false, 'pagehide');
  window.addEventListener('pagehide', onPageHide);
  cleanups.push(() => window.removeEventListener('pagehide', onPageHide));
  cleanups.push(() => save(currentPosition, duration, false, true));
  frame.__unload = () => cleanups.splice(0).forEach(cleanup => cleanup());
  bootCampVideoCleanup.push(() => frame.__unload?.());
  const startAtSavedPosition = async (videoDuration) => {
    duration = videoDuration;
    if (currentPosition > 0) await seekTo(currentPosition);
    lastSampleAt = performance.now();
    save(currentPosition, duration, false, true);
  };

  if (frame.dataset.provider === 'youtube') {
    loadYouTubeApi().then(YT => {
      if (!frame.isConnected) return;
      player = new YT.Player(frame, {
        events: {
          onReady: async event => {
            player = event.target;
            duration = player.getDuration();
            seekTo = position => player.seekTo(Math.max(0, position), true);
            await startAtSavedPosition(duration);
            player.setPlaybackRate(1);
            pollTimer = setInterval(() => {
              if (!frame.isConnected) { clearInterval(pollTimer); return; }
              if (!player?.getCurrentTime) return;
              const videoDuration = player.getDuration();
              if (videoDuration > 0) sample(player.getCurrentTime(), videoDuration);
            }, 500);
            cleanups.push(() => { clearInterval(pollTimer); player?.destroy(); });
          },
          onStateChange: event => {
            if (event.data === YT.PlayerState.PLAYING) { playing = true; save(player.getCurrentTime(), player.getDuration(), true, true); }
            else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) pauseAndSave(player.getCurrentTime(), player.getDuration());
          },
          onPlaybackRateChange: event => { if (!watched && event.data !== 1) player.setPlaybackRate(1); }
        }
      });
    }).catch(error => bootCampVideoFallback(frame, `${error.message} `));
    return;
  }
  if (frame.dataset.provider === 'vimeo') {
    loadVimeoApi().then(async Vimeo => {
      if (!frame.isConnected) return;
      player = new Vimeo.Player(frame);
      duration = await player.getDuration();
      seekTo = position => player.setCurrentTime(Math.max(0, position)).catch(error => bootCampVideoStatus(frame, `Could not restore video position: ${error.message}`));
      await startAtSavedPosition(duration);
      player.on('play', () => { playing = true; player.getCurrentTime().then(time => save(time, duration, true, true)); });
      player.on('pause', event => pauseAndSave(event.seconds, event.duration));
      player.on('ended', event => pauseAndSave(event.seconds, event.duration));
      player.on('timeupdate', event => sample(event.seconds, event.duration));
      player.on('seeking', event => { if (!watched && event.seconds > furthestPosition + 1.5) seekTo(furthestPosition); });
      player.on('playbackratechange', event => { if (!watched && event.playbackRate !== 1) player.setPlaybackRate(1); });
      cleanups.push(() => { player.destroy().catch(error => console.error('Could not dispose Vimeo player:', error)); });
    }).catch(error => bootCampVideoFallback(frame, `${error.message} `));
    return;
  }

  if (frame.dataset.provider === 'loom') {
    let ready = false;
    let fallbackTimer = setTimeout(() => {
      if (!ready && frame.isConnected) bootCampVideoFallback(frame, 'Loom playback tracking is unavailable. ');
    }, 10000);
    const sendLoom = (method, value) => frame.contentWindow.postMessage({ method, value, context: 'player.js' }, 'https://www.loom.com');
    seekTo = position => sendLoom('setCurrentTime', Math.max(0, position));
    const onMessage = event => {
      if (event.origin !== 'https://www.loom.com' || event.source !== frame.contentWindow) return;
      let message = event.data;
      if (typeof message === 'string') {
        try { message = JSON.parse(message); } catch { return; }
      }
      if (!message || message.context !== 'player.js') return;
      if (message.event === 'ready') {
        ready = true;
        clearTimeout(fallbackTimer);
        ['play', 'pause', 'ended', 'timeupdate'].forEach(name => sendLoom('addEventListener', name));
        if (currentPosition > 0) sendLoom('setCurrentTime', currentPosition);
        return;
      }
      if (message.event === 'play') { playing = true; save(Number(message.value?.currentTime), Number(message.value?.duration), true, true); }
      const value = message.value || {};
      const time = Number(value.currentTime ?? value.seconds);
      const length = Number(value.duration);
      if (message.event === 'timeupdate') { playing = true; sample(time, length); }
      if (message.event === 'pause' || message.event === 'ended') pauseAndSave(time, length);
    };
    window.addEventListener('message', onMessage);
    cleanups.push(() => { clearTimeout(fallbackTimer); window.removeEventListener('message', onMessage); });
    frame.addEventListener('load', () => {
      ['ready', 'play', 'pause', 'ended', 'timeupdate'].forEach(name => sendLoom('addEventListener', name));
    }, { once: true });
    return;
  }
}
function initBootCampVideoPlayers() {
  bootCampVideoCleanup.forEach(cleanup => cleanup());
  bootCampVideoCleanup = [];
  if (view !== 'bootcamp') activeBootCampLesson = null;
  if (me?.role !== 'agent' || view !== 'bootcamp') return;
  document.querySelectorAll('[data-bootcamp-player]').forEach(initBootCampVideoPlayer);
}
function bootCampVideoSlot(lesson, embed, playerAttrs, locked) {
  const iframe = `<iframe ${playerAttrs} src="${embed.src}" title="${escapeHtml(lesson.title)} video" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  const active = !locked && activeBootCampLesson === lesson.id;
  const thumbnail = embed.provider === 'youtube' ? `<img src="https://i.ytimg.com/vi/${encodeURIComponent(embed.id)}/hqdefault.jpg" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '';
  return `<div class="bootcamp-video-slot ${active ? 'open' : ''}" data-lesson-slot="${escapeHtml(lesson.id)}"><div class="bootcamp-video-placeholder" ${active ? 'hidden' : ''}>${thumbnail}<button type="button" class="row-action" data-bootcamp-load-video="${escapeHtml(lesson.id)}" ${locked ? 'disabled' : ''}>${locked ? '🔒 Locked' : '▶ Play video'}</button></div><template>${iframe}</template>${active ? iframe : ''}</div>`;
}
function openBootCampVideo(lessonId) {
  const slot = document.querySelector(`[data-lesson-slot="${CSS.escape(lessonId)}"]`);
  const template = slot?.querySelector('template');
  if (!template || slot.classList.contains('open')) return;
  document.querySelectorAll('.bootcamp-video-slot.open').forEach(unloadBootCampVideo);
  const frame = template.content.firstElementChild.cloneNode(true);
  template.after(frame);
  slot.querySelector('.bootcamp-video-placeholder').hidden = true;
  slot.classList.add('open');
  activeBootCampLesson = lessonId;
  if (me?.role === 'agent' && frame.hasAttribute('data-bootcamp-player')) initBootCampVideoPlayer(frame);
}
function unloadBootCampVideo(slot) {
  const frame = slot.querySelector('iframe');
  frame?.__unload?.();
  frame?.remove();
  slot.querySelector('.bootcamp-video-placeholder').hidden = false;
  slot.classList.remove('open');
  if (activeBootCampLesson === slot.dataset.lessonSlot) activeBootCampLesson = null;
}
function bootCampModule(module, ownerViewing = false) {
  const state = module.complete ? 'complete' : module.unlocked ? 'current' : 'locked';
  const moduleControls = ownerViewing ? `<form class="bootcamp-module-form" data-bootcamp-module-form="${module.id}"><input name="title" value="${escapeHtml(module.title)}" required><input name="description" value="${escapeHtml(module.description)}" placeholder="Module description"><button class="row-action">Save module</button><button class="row-action danger" type="button" data-bootcamp-delete-module="${module.id}">Delete</button><button class="row-action" type="button" data-bootcamp-move-module="${module.id}" data-direction="up">↑</button><button class="row-action" type="button" data-bootcamp-move-module="${module.id}" data-direction="down">↓</button></form>` : '';
  const lessons = module.lessons.map((lesson, index) => {
    const embed = videoEmbedInfo(lesson.videoUrl, lesson.id);
    const hasVideo = !!lesson.videoUrl;
    const resourceBlocked = lesson.resourceRequired && !!lesson.resourceUrl && !lesson.resourceCompleted;
    const contractBlocked = lesson.contractRequired && !!lesson.contractUrl && !lesson.contractCompleted;
    const progress = lesson.videoProgress || { watched: lesson.watched, watchedPercent: lesson.watched ? 100 : 0, position: 0, furthest: 0 };
    const safeVideoUrl = (() => { try { const url = new URL(lesson.videoUrl); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } })();
    const driveVideo = embed?.provider === 'google-drive';
    const lessonLocked = !ownerViewing && !!lesson.locked;
    const canComplete = !ownerViewing && !lessonLocked && module.unlocked && !resourceBlocked && !contractBlocked && (!hasVideo || driveVideo || progress.watched);
    const video = hasVideo && !lessonLocked ? `<div class="bootcamp-video">${embed ? `${bootCampVideoSlot(lesson, embed, `${ownerViewing || driveVideo ? '' : `id="video-${escapeHtml(lesson.id)}" data-bootcamp-player data-provider="${embed.provider}" data-lesson-id="${escapeHtml(lesson.id)}" data-video-position="${progress.position || 0}" data-video-furthest="${progress.furthest || 0}" data-video-watched="${progress.watched ? 'true' : 'false'}" data-original-url="${escapeHtml(safeVideoUrl)}"`}`, !ownerViewing && !module.unlocked)}${driveVideo && safeVideoUrl ? `<a class="loom-link" href="${escapeHtml(safeVideoUrl)}" target="_blank" rel="noopener noreferrer">Open Video in Google Drive</a>` : ''}`
        : safeVideoUrl ? `<a class="loom-link" href="${escapeHtml(safeVideoUrl)}" target="_blank" rel="noopener noreferrer">Open Video</a>` : '<span class="video-training-status">Video link unavailable.</span>'}${!ownerViewing ? `<span class="video-training-status" data-video-status="${escapeHtml(lesson.id)}">${driveVideo ? 'Google Drive playback cannot be tracked; lesson completion does not verify watch time.' : progress.watched ? '✓ Training Completed' : `Video Training — ${progress.watchedPercent}% watched${embed ? '' : ' · this video host cannot be tracked'}`}</span>` : ''}</div>` : '';
    const uploadForm = ownerViewing ? `<form class="bootcamp-video-form" data-bootcamp-lesson-form="${lesson.id}"><input name="title" value="${escapeHtml(lesson.title)}" required><input name="description" value="${escapeHtml(lesson.instructions)}" placeholder="Description"><input name="videoUrl" type="url" value="${escapeHtml(lesson.videoUrl || '')}" placeholder="Optional video URL"><input name="resourceUrl" type="url" value="${escapeHtml(lesson.resourceUrl || '')}" placeholder="Optional document/resource URL"><input name="contractUrl" type="url" value="${escapeHtml(lesson.contractUrl || '')}" placeholder="Optional contract/signature URL"><label class="check-label"><input name="required" type="checkbox" ${lesson.required ? 'checked' : ''}> Required lesson</label><label class="check-label"><input name="resourceRequired" type="checkbox" ${lesson.resourceRequired ? 'checked' : ''}> Required resource</label><label class="check-label"><input name="contractRequired" type="checkbox" ${lesson.contractRequired ? 'checked' : ''}> Required contract</label><button class="row-action">Save lesson</button><button class="row-action danger" type="button" data-bootcamp-delete-lesson="${lesson.id}">Delete</button><button class="row-action" type="button" data-bootcamp-move-lesson="${lesson.id}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button><button class="row-action" type="button" data-bootcamp-move-lesson="${lesson.id}" data-direction="down" ${index === module.lessons.length - 1 ? 'disabled' : ''}>↓</button></form>` : '';
    return `<div class="bootcamp-lesson ${lesson.done ? 'done' : ''} ${lessonLocked ? 'lesson-locked' : ''}"><button class="check" ${canComplete ? '' : 'disabled'} data-bootcamp-complete="${lesson.id}" data-video-check="${hasVideo ? escapeHtml(lesson.id) : ''}" data-module-unlocked="${module.unlocked}" data-requirements-ready="${!resourceBlocked && !contractBlocked}">${lesson.done ? '✓' : ''}</button><div class="bootcamp-lesson-content"><b>${escapeHtml(lesson.title)}</b><span>${escapeHtml(lesson.instructions)}</span>${lessonLocked ? '<span class="lesson-lock-note">🔒 Locked — complete the previous lesson first</span>' : ''}${video}${lesson.resourceUrl && !lessonLocked ? `<div class="bootcamp-resource"><a class="loom-link" href="${escapeHtml(lesson.resourceUrl)}" target="_blank" rel="noopener">Open resource</a>${!ownerViewing && module.unlocked ? lesson.resourceCompleted ? '<span class="resource-complete">Resource completed</span>' : '<button class="row-action" data-bootcamp-resource="' + lesson.id + '">Mark resource complete</button>' : ''}</div>` : ''}${lesson.contractUrl && !lessonLocked ? `<div class="bootcamp-resource"><a class="loom-link" href="${escapeHtml(lesson.contractUrl)}" target="_blank" rel="noopener">Open contract/signature</a>${!ownerViewing && module.unlocked ? lesson.contractCompleted ? '<span class="resource-complete">Contract completed</span>' : '<button class="row-action" data-bootcamp-contract="' + lesson.id + '">Mark contract complete</button>' : ''}</div>` : ''}${uploadForm}</div></div>`;
  }).join('');
  return `<section class="card bootcamp-module ${state}"><div class="bootcamp-module-head"><div><span class="stage-index">0${module.idx + 1}</span><h2>${escapeHtml(module.title)}</h2><p>${escapeHtml(module.description)}</p></div><span class="status-pill ${state === 'complete' ? '' : state === 'locked' ? 'locked' : 'attention'}">${module.complete ? 'Completed' : module.unlocked ? 'Current' : 'Locked'}</span></div>${moduleControls}<div class="bootcamp-lessons">${lessons}</div>${ownerViewing ? `<form class="bootcamp-add-form" data-bootcamp-add-lesson="${module.id}"><input name="title" placeholder="Add custom lesson" required><button class="primary-button">Add lesson</button></form>` : ''}</section>`;
}
function bootCamp() {
  const owner = me.role === 'owner';
  const bootcamp = data.bootcamp;
  const progress = owner ? null : bootCampProgress(bootcamp);
  const agents = owner ? bootcamp.agents : [];
  return `<div class="page-heading"><div><div class="eyebrow">Structured onboarding</div><h1>Boot Camp</h1><p>${owner ? 'See every agent\'s course progress and module status.' : 'Complete each requirement in order. The next module unlocks when the current one is complete.'}</p></div>${!owner ? `<span class="bootcamp-total">${progress}% complete</span>` : ''}</div>${owner ? `<section class="card bootcamp-owner-list"><div class="subhead"><h2>Agent progress</h2><span class="path-meta">${agents.length} agents</span></div>${agents.length ? agents.map(agent => `<div class="bootcamp-agent-row"><div><b>${escapeHtml(agent.name)}</b><small>${agent.bootcamp.completedLessons} of ${agent.bootcamp.totalLessons} requirements complete</small></div><strong>${bootCampProgress(agent.bootcamp)}%</strong><div class="progress-track"><div class="progress-fill" style="width:${bootCampProgress(agent.bootcamp)}%"></div></div></div>`).join('') : '<div class="empty">No agent accounts yet.</div>'}</section><div class="section-heading"><div><div class="eyebrow">Course builder</div><h2>Manage modules and lessons</h2></div></div><form class="card bootcamp-add-module" data-bootcamp-add-module><input name="title" placeholder="New module title" required><input name="description" placeholder="Module description"><button class="primary-button">Add module</button></form>${bootcamp.modules.map(module => bootCampModule(module, true)).join('')}` : `<section class="card bootcamp-progress-card"><div class="progress-row"><span>Overall Boot Camp progress</span><b>${progress}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><span class="path-meta">${bootcamp.completedLessons} of ${bootcamp.totalLessons} requirements complete</span></section>${bootcamp.modules.map(module => bootCampModule(module)).join('')}`}`;
}

function createForgeCore(progressValue, label) {
  const progress = Math.max(0, Math.min(100, Number(progressValue) || 0));
  const core = document.createElement('div');
  core.className = 'forge-core';
  core.setAttribute('role', 'img');
  core.setAttribute('aria-label', `Forge Core: ${progress}% progress. ${label}`);
  core.style.setProperty('--core-progress', `${progress}%`);
  for (const orbitName of ['forge-orbit-a', 'forge-orbit-b', 'forge-orbit-c']) {
    const orbit = document.createElement('span');
    orbit.className = `forge-core-orbit ${orbitName}`;
    core.append(orbit);
  }
  const scan = document.createElement('span');
  scan.className = 'forge-core-scan';
  core.append(scan);
  const readout = document.createElement('span');
  readout.className = 'forge-core-readout';
  readout.textContent = String(progress);
  const unit = document.createElement('small');
  unit.textContent = '%';
  readout.append(unit);
  core.append(readout);
  const coreBadge = document.createElement('span');
  coreBadge.className = 'forge-core-label';
  coreBadge.textContent = 'FORGE CORE';
  core.append(coreBadge);
  return core;
}

function addForgeCore(agent) {
  const card = document.querySelector('.current-card');
  if (!card || !agent) return;
  const core = createForgeCore(agent.progress, `${agent.stageLabel || 'Current stage'} progression`);
  card.prepend(core);
}

function addMissionContinue(agent) {
  addForgeCore(agent);
  const requirement = document.querySelector('.req-item:not(.done)');
  const milestone = document.querySelector('.milestone-card');
  requirement?.classList.add('current-objective');
  if (!requirement || !milestone) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary-button mission-continue';
  button.textContent = 'Continue mission';
  button.setAttribute('aria-label', `Continue with ${requirement.querySelector('b')?.textContent || 'the next task'}`);
  button.addEventListener('click', () => {
    requirement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requirement.querySelector('.check')?.focus({ preventScroll: true });
  });
  milestone.append(button);
}

function composeAgentCommand() {
  const heading = app.querySelector(':scope > .page-heading');
  const path = app.querySelector(':scope > .path-card');
  const layout = app.querySelector(':scope > .agent-layout');
  if (!heading || !path || !layout) return;
  const leftColumn = layout.querySelector(':scope > div');
  const sideStack = layout.querySelector(':scope > .side-stack');
  const current = layout.querySelector('.current-card');
  const requirements = layout.querySelector('.requirements-card');
  const history = layout.querySelector('.history-card');
  const milestone = layout.querySelector('.milestone-card');
  const resources = layout.querySelector('.resources-card');
  const reward = layout.querySelector('.reward-card');
  const core = layout.querySelector('.forge-core');
  if (!current || !requirements || !sideStack || !milestone) return;

  const screen = document.createElement('div');
  screen.className = 'agent-command-screen';
  const mapLabel = document.createElement('div');
  mapLabel.className = 'command-section-label';
  mapLabel.textContent = 'CAREER VECTOR / LIVE';
  path.classList.remove('card');
  path.classList.add('command-map');
  path.prepend(mapLabel);

  const commandLayout = document.createElement('div');
  commandLayout.className = 'agent-command-layout';
  const missionRail = document.createElement('section');
  missionRail.className = 'command-mission-rail';
  const coreWell = document.createElement('section');
  coreWell.className = 'forge-core-well';
  coreWell.setAttribute('aria-label', 'Career progression core');
  const nextRail = document.createElement('aside');
  nextRail.className = 'command-next-rail';
  if (leftColumn) {
    leftColumn.removeChild(current);
    leftColumn.removeChild(requirements);
    if (history) leftColumn.removeChild(history);
  }
  current.classList.remove('card');
  requirements.classList.remove('card');
  milestone.classList.remove('card');
  resources?.classList.remove('card');
  history?.classList.remove('card');
  reward?.classList.remove('card');
  current.classList.add('mission-readout');
  requirements.classList.add('mission-list');
  missionRail.append(current, requirements);
  if (history) missionRail.append(history);
  if (core) coreWell.append(core);
  const coreReadout = document.createElement('div');
  coreReadout.className = 'core-caption';
  coreReadout.innerHTML = '<span>FORGE CORE</span><small>CAREER SIGNAL / ACTIVE</small>';
  coreWell.append(coreReadout);
  nextRail.append(milestone);
  if (resources) nextRail.append(resources);
  if (reward) nextRail.append(reward);
  layout.replaceWith(commandLayout);
  commandLayout.append(missionRail, coreWell, nextRail);
  screen.append(heading, path, commandLayout);
  app.prepend(screen);
}

function composeOwnerCommand() {
  const heading = app.querySelector(':scope > .page-heading');
  const path = app.querySelector(':scope > .path-card');
  const alerts = app.querySelector(':scope > .attention-panel');
  const sectionHeading = app.querySelector(':scope > .section-heading');
  const stageGrid = app.querySelector(':scope > .stage-grid');
  const detail = app.querySelector(':scope > .owner-detail');
  const accounts = app.querySelector(':scope > .account-panel');
  if (!heading || !path || !stageGrid || !detail || !accounts) return;
  const screen = document.createElement('div');
  screen.className = 'owner-command-screen';
  path.classList.remove('card');
  path.classList.add('command-map');
  detail.classList.remove('card');
  accounts.classList.remove('card');
  stageGrid.querySelectorAll('.stage-card').forEach(stage => stage.classList.remove('card'));
  const operations = document.createElement('div');
  operations.className = 'owner-command-grid';
  const stageRail = document.createElement('section');
  stageRail.className = 'owner-stage-rail';
  const detailRail = document.createElement('section');
  detailRail.className = 'owner-detail-rail';
  const coreField = document.createElement('section');
  coreField.className = 'owner-core-field';
  const selected = data.stages[selectedStage] || data.stages[0];
  const stats = stageStats(selected.id);
  const core = createForgeCore(stats.average, `${selected.label} average progress`);
  coreField.setAttribute('aria-label', `Agency Forge Core. ${stats.list.length} agents in ${selected.label}`);
  const coreHeading = document.createElement('div');
  coreHeading.className = 'owner-core-heading';
  const coreLabel = document.createElement('span');
  coreLabel.textContent = 'AGENCY CORE / STAGE SYNC';
  const coreStage = document.createElement('strong');
  coreStage.textContent = selected.label;
  coreHeading.append(coreLabel, coreStage);
  const coreSignals = document.createElement('div');
  coreSignals.className = 'owner-core-signals';
  for (const [signalName, signalValue] of [['AGENTS', stats.list.length], ['STAGE AVG', `${stats.average}%`], ['ATTENTION', stats.attention]]) {
    const signal = document.createElement('div');
    signal.className = 'owner-core-signal';
    const value = document.createElement('b');
    value.textContent = String(signalValue);
    const label = document.createElement('span');
    label.textContent = signalName;
    signal.append(value, label);
    coreSignals.append(signal);
  }
  coreField.append(coreHeading, core, coreSignals);
  const accountRail = document.createElement('section');
  accountRail.className = 'owner-account-rail';
  if (sectionHeading) stageRail.append(sectionHeading);
  stageRail.append(stageGrid);
  detailRail.append(detail);
  accountRail.append(accounts);
  operations.append(stageRail, coreField, detailRail);
  screen.append(heading);
  if (alerts) screen.append(alerts);
  screen.append(path, operations, accountRail);
  app.prepend(screen);
}

function composeBootCampCommand() {
  const heading = app.querySelector(':scope > .page-heading');
  if (!heading) return;
  const screen = document.createElement('div');
  screen.className = 'training-command-screen';
  const progress = app.querySelector(':scope > .bootcamp-progress-card');
  const ownerProgress = app.querySelector(':scope > .bootcamp-owner-list');
  const builderHeading = app.querySelector(':scope > .section-heading');
  const moduleForm = app.querySelector(':scope > .bootcamp-add-module');
  const modules = [...app.querySelectorAll(':scope > .bootcamp-module')];
  const moduleList = document.createElement('div');
  moduleList.className = 'training-pathway';
  modules.forEach((module, index) => {
    module.classList.remove('card');
    module.style.setProperty('--module-index', index + 1);
    moduleList.append(module);
  });
  progress?.classList.remove('card');
  ownerProgress?.classList.remove('card');
  moduleForm?.classList.remove('card');
  screen.append(heading);
  if (progress) screen.append(progress);
  if (ownerProgress) screen.append(ownerProgress);
  if (builderHeading) screen.append(builderHeading);
  if (moduleForm) screen.append(moduleForm);
  screen.append(moduleList);
  app.prepend(screen);
}

function composeUtilityScreen() {
  if (view === 'recruits') {
    app.querySelectorAll('.recruit-card').forEach(card => card.classList.remove('card'));
  }
  if (view === 'settings') {
    app.querySelectorAll('.account-settings-card').forEach(panel => panel.classList.remove('card'));
  }
}

function render() {
  if (!me) { document.body.classList.add('logged-out'); document.querySelector('.app-shell').style.display = 'none'; authRoot.style.display = 'block'; authRoot.innerHTML = needsAdminSetup ? adminSetup() : login(); bind(); return; }
  if (me.role === 'agent' && view === 'owner') view = 'agent';
  document.body.classList.remove('logged-out'); authRoot.style.display = 'none'; authRoot.innerHTML = ''; document.querySelector('.app-shell').style.display = 'flex';
  document.querySelectorAll('.nav-item[data-view]').forEach(item => { item.style.display = me.role === 'owner' || item.dataset.view === 'agent' || item.dataset.view === 'bootcamp' ? '' : 'none'; item.classList.toggle('active', item.dataset.view === view || (me.role === 'agent' && view === 'agent' && item.dataset.view === 'agent')); });
  document.querySelector('.user-card').innerHTML = `${avatar({ initials: me.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(), color: 'blue' })}<div><b>${escapeHtml(me.name)}</b><small>${me.role === 'owner' ? 'Agency owner' : 'Agent account'}</small></div><span class="more">•••</span>`;
  let pageTitle = 'Agency overview', content = '';
  if (view === 'bootcamp') { pageTitle = 'Boot Camp'; content = bootCamp(); }
  else if (me.role === 'agent') { pageTitle = 'Agent view'; content = data.agent ? agentView(data) : '<div class="empty-state"><h1>No agent record found.</h1><p>Contact your agency owner.</p></div>'; }
  else if (view === 'agent-detail' && selectedAgent) { pageTitle = 'Agent detail'; const agentRow = data.agents.find(a => a.id === selectedAgent); const stage = agentRow ? data.stages.find(s => s.id === agentRow.stageId) : null; const idx = agentRow ? data.stages.findIndex(s => s.id === agentRow.stageId) : -1; const next = idx >= 0 ? data.stages[idx + 1] : null; content = agentRow ? agentView({ agent: agentRow, stage, timeline: data.stages, nextStageLabel: next ? next.label : null }, true) : ''; }
  else if (view === 'settings') { pageTitle = 'Account settings'; content = accountSettings(); }
  else if (view === 'recruits') { pageTitle = 'Recruiting pipeline'; content = recruits(); }
  else { pageTitle = 'Agency overview'; content = owner(); }
  const html = content + (tempPasswordNotice ? tempPasswordModal() : '');
  // Re-rendering identical Boot Camp markup would rebuild every lesson and reload active players for no visible change.
  if (view === 'bootcamp' && html === lastRenderedBootCampHtml && app.dataset.renderedView === 'bootcamp') { document.querySelector('#page-title').textContent = pageTitle; return; }
  lastRenderedBootCampHtml = view === 'bootcamp' ? html : '';
  app.dataset.renderedView = view;
  app.innerHTML = html;
  if (view === 'agent' && me.role === 'agent') { addMissionContinue(data.agent); composeAgentCommand(); }
  else if (view === 'agent-detail' && me.role === 'owner' && selectedAgent) { const viewedAgent = data.agents.find(agent => agent.id === selectedAgent); if (viewedAgent) addForgeCore(viewedAgent); composeAgentCommand(); }
  else if (view === 'owner' && me.role === 'owner') composeOwnerCommand();
  else if (view === 'bootcamp') { if (me.role === 'agent') document.querySelector('.bootcamp-module.current .bootcamp-lesson:not(.done)')?.classList.add('current-objective'); composeBootCampCommand(); }
  else composeUtilityScreen();
  document.querySelector('#page-title').textContent = pageTitle;
  bind();
}

function bind() {
  const loginForm = document.querySelector('#login-form');
  if (loginForm) loginForm.onsubmit = async event => { event.preventDefault(); const data2 = new FormData(loginForm); try { await api('/api/login', { method: 'POST', body: JSON.stringify({ email: data2.get('email'), password: data2.get('password') }) }); formError = ''; await boot(); } catch (error) { formError = error.message; render(); } };
  const adminSetupForm = document.querySelector('#admin-setup-form');
  if (adminSetupForm) adminSetupForm.onsubmit = async event => { event.preventDefault(); const data2 = new FormData(adminSetupForm); try { await api('/api/admin-setup', { method: 'POST', body: JSON.stringify({ email: data2.get('email'), password: data2.get('password'), confirmPassword: data2.get('confirmPassword') }) }); formError = ''; await boot(); } catch (error) { formError = error.message; render(); } };
  document.querySelectorAll('[data-action="logout"]').forEach(button => button.onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); me = null; data = null; view = 'owner'; selectedAgent = null; render(); });
  const userCard = document.querySelector('.user-card');
  if (userCard && me && me.role === 'owner') userCard.onclick = () => { view = 'settings'; accountSettingsError = ''; accountSettingsNotice = ''; render(); };
  document.querySelectorAll('.nav-item[data-view]').forEach(button => button.onclick = () => { if (me.role !== 'owner' && !['agent', 'bootcamp'].includes(button.dataset.view)) return; view = button.dataset.view; selectedAgent = null; render(); });
  document.querySelectorAll('[data-stage]').forEach(button => button.onclick = () => { if (me.role === 'owner') { selectedStage = Number(button.dataset.stage); render(); } });
  document.querySelectorAll('[data-view-agent]').forEach(button => button.onclick = () => { selectedAgent = button.dataset.viewAgent; view = 'agent-detail'; render(); });
  document.querySelectorAll('[data-reset-agent]').forEach(button => button.onclick = () => mutate(async () => { const result = await api(`/api/agents/${button.dataset.resetAgent}/reset-password`, { method: 'POST' }); const agentRow = data.agents.find(a => a.id === button.dataset.resetAgent); tempPasswordNotice = { name: agentRow.name, tempPassword: result.tempPassword }; }));
  document.querySelectorAll('[data-delete-agent]').forEach(button => button.onclick = () => { const agent = data.agents.find(item => item.id === button.dataset.deleteAgent); if (agent && window.confirm(`Delete ${agent.name}'s account and all progression data? This cannot be undone.`)) mutate(() => api(`/api/agents/${agent.id}`, { method: 'DELETE' })); });
  document.querySelectorAll('[data-complete]').forEach(button => button.onclick = () => toggleTask(button.dataset.complete));
  document.querySelectorAll('[data-advance-agent]').forEach(button => button.onclick = () => { const agent = data.agents.find(item => item.id === button.dataset.advanceAgent); if (agent && window.confirm(`Approve ${agent.name}'s advancement to the next stage?`)) mutate(() => api(`/api/agents/${agent.id}/advance`, { method: 'POST' })); });
  document.querySelectorAll('[data-bootcamp-complete]').forEach(button => button.onclick = () => mutate(async () => { const result = await api(`/api/me/bootcamp/lessons/${button.dataset.bootcampComplete}/toggle`, { method: 'POST' }); data.bootcamp = result.bootcamp; }));
  document.querySelectorAll('[data-bootcamp-resource]').forEach(button => button.onclick = () => mutate(async () => { const result = await api(`/api/me/bootcamp/lessons/${button.dataset.bootcampResource}/resource-complete`, { method: 'POST' }); data.bootcamp = result.bootcamp; }));
  document.querySelectorAll('[data-bootcamp-contract]').forEach(button => button.onclick = () => mutate(async () => { const result = await api(`/api/me/bootcamp/lessons/${button.dataset.bootcampContract}/contract-complete`, { method: 'POST' }); data.bootcamp = result.bootcamp; }));
  document.querySelectorAll('[data-bootcamp-add-module]').forEach(form => form.onsubmit = event => { event.preventDefault(); const formData = new FormData(form); mutate(() => api('/api/bootcamp/modules', { method: 'POST', body: JSON.stringify({ title: formData.get('title'), description: formData.get('description') }) })); });
  document.querySelectorAll('[data-bootcamp-module-form]').forEach(form => form.onsubmit = event => { event.preventDefault(); const formData = new FormData(form); mutate(() => api(`/api/bootcamp/modules/${form.dataset.bootcampModuleForm}`, { method: 'PATCH', body: JSON.stringify({ title: formData.get('title'), description: formData.get('description') }) })); });
  document.querySelectorAll('[data-bootcamp-delete-module]').forEach(button => button.onclick = () => { if (window.confirm('Delete this module and its lessons?')) mutate(() => api(`/api/bootcamp/modules/${button.dataset.bootcampDeleteModule}`, { method: 'DELETE' })); });
  document.querySelectorAll('[data-bootcamp-move-module]').forEach(button => button.onclick = () => mutate(() => api(`/api/bootcamp/modules/${button.dataset.bootcampMoveModule}/move`, { method: 'POST', body: JSON.stringify({ direction: button.dataset.direction }) })));
  document.querySelectorAll('[data-bootcamp-add-lesson]').forEach(form => form.onsubmit = event => { event.preventDefault(); const formData = new FormData(form); mutate(() => api(`/api/bootcamp/modules/${form.dataset.bootcampAddLesson}/lessons`, { method: 'POST', body: JSON.stringify({ title: formData.get('title') }) })); });
  document.querySelectorAll('[data-bootcamp-lesson-form]').forEach(form => form.onsubmit = event => { event.preventDefault(); const formData = new FormData(form); mutate(() => api(`/api/bootcamp/lessons/${form.dataset.bootcampLessonForm}`, { method: 'PATCH', body: JSON.stringify({ title: formData.get('title'), description: formData.get('description'), videoUrl: formData.get('videoUrl'), resourceUrl: formData.get('resourceUrl'), resourceRequired: formData.get('resourceRequired') === 'on', contractUrl: formData.get('contractUrl'), contractRequired: formData.get('contractRequired') === 'on', required: formData.get('required') === 'on' }) })); });
  document.querySelectorAll('[data-bootcamp-delete-lesson]').forEach(button => button.onclick = () => { if (window.confirm('Delete this lesson?')) mutate(() => api(`/api/bootcamp/lessons/${button.dataset.bootcampDeleteLesson}`, { method: 'DELETE' })); });
  document.querySelectorAll('[data-bootcamp-move-lesson]').forEach(button => button.onclick = () => mutate(() => api(`/api/bootcamp/lessons/${button.dataset.bootcampMoveLesson}/move`, { method: 'POST', body: JSON.stringify({ direction: button.dataset.direction }) })));
  document.querySelectorAll('[data-action="add-agent"]').forEach(button => button.onclick = () => { accountModalContext = { mode: 'create' }; showAccountModal = true; render(); });
  document.querySelectorAll('[data-action="add-task"]').forEach(button => button.onclick = () => { editingTask = -1; render(); });
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => { editingTask = button.dataset.edit; render(); });
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => mutate(() => api(`/api/stages/${data.stages[selectedStage].id}/tasks/${button.dataset.delete}`, { method: 'DELETE' })));
  document.querySelectorAll('[data-move]').forEach(button => button.onclick = () => mutate(() => api(`/api/stages/${data.stages[selectedStage].id}/tasks/${button.dataset.move}/move`, { method: 'POST', body: JSON.stringify({ direction: button.dataset.direction }) })));
  document.querySelectorAll('[data-action="close-modal"]').forEach(button => button.onclick = () => { editingTask = null; render(); });
  document.querySelectorAll('[data-action="close-account"]').forEach(button => button.onclick = () => { showAccountModal = false; accountModalContext = null; render(); });
  document.querySelectorAll('[data-action="close-temp-password"]').forEach(button => button.onclick = () => { tempPasswordNotice = null; render(); });
  document.querySelectorAll('[data-action="back-to-overview"]').forEach(button => button.onclick = () => { view = 'owner'; selectedAgent = null; render(); });
  const changePasswordForm = document.querySelector('#change-password-form');
  if (changePasswordForm) changePasswordForm.onsubmit = async event => { event.preventDefault(); const formData = new FormData(changePasswordForm); accountSettingsError = ''; accountSettingsNotice = ''; try { await api('/api/account/password', { method: 'POST', body: JSON.stringify({ currentPassword: formData.get('currentPassword'), newPassword: formData.get('newPassword'), confirmPassword: formData.get('confirmPassword') }) }); accountSettingsNotice = 'Password changed successfully.'; changePasswordForm.reset(); } catch (error) { accountSettingsError = error.message; } render(); };
  document.querySelectorAll('[data-action="save-stage-settings"]').forEach(button => button.onclick = () => mutate(() => api(`/api/stages/${data.stages[selectedStage].id}`, { method: 'PATCH', body: JSON.stringify({ timeframe: Number(document.querySelector('#timeframe').value) || 1, reward: document.querySelector('#stage-reward').value, resourceUrl: document.querySelector('#stage-resource').value }) })));

  const taskForm = document.querySelector('#task-form');
  if (taskForm) taskForm.onsubmit = event => { event.preventDefault(); const formData = new FormData(taskForm); const payload = { title: formData.get('title'), instructions: formData.get('instructions'), loom: formData.get('loom'), required: formData.get('required') === 'on' }; const stageId = data.stages[selectedStage].id; mutate(() => editingTask === -1 ? api(`/api/stages/${stageId}/tasks`, { method: 'POST', body: JSON.stringify(payload) }) : api(`/api/stages/${stageId}/tasks/${editingTask}`, { method: 'PATCH', body: JSON.stringify(payload) })); editingTask = null; };
  const accountForm = document.querySelector('#account-form');
  if (accountForm) accountForm.onsubmit = event => { event.preventDefault(); const formData = new FormData(accountForm); const payload = { name: formData.get('name'), email: formData.get('email'), stageId: formData.get('stage') }; const isConvert = accountModalContext && accountModalContext.mode === 'convert'; mutate(async () => { const result = isConvert ? await api(`/api/recruits/${accountModalContext.recruitId}/convert`, { method: 'POST', body: JSON.stringify(payload) }) : await api('/api/agents', { method: 'POST', body: JSON.stringify(payload) }); tempPasswordNotice = { name: payload.name, tempPassword: result.tempPassword }; }); showAccountModal = false; accountModalContext = null; };

  document.querySelectorAll('[data-action="add-recruit"]').forEach(button => button.onclick = () => { editingRecruit = null; showRecruitModal = true; render(); });
  document.querySelectorAll('[data-recruit-edit]').forEach(button => button.onclick = () => { editingRecruit = button.dataset.recruitEdit; showRecruitModal = true; render(); });
  document.querySelectorAll('[data-action="close-recruit-modal"]').forEach(button => button.onclick = () => { showRecruitModal = false; editingRecruit = null; render(); });
  document.querySelectorAll('[data-recruit-delete]').forEach(button => button.onclick = () => mutate(() => api(`/api/recruits/${button.dataset.recruitDelete}`, { method: 'DELETE' })));
  document.querySelectorAll('[data-recruit-move]').forEach(button => button.onclick = () => { const order = ['interested', 'licensing', 'licensed']; const recruit = data.recruits.find(r => r.id === button.dataset.recruitMove); const currentIndex = order.indexOf(recruit.status); const nextIndex = button.dataset.direction === 'forward' ? currentIndex + 1 : currentIndex - 1; mutate(() => api(`/api/recruits/${recruit.id}`, { method: 'PATCH', body: JSON.stringify({ status: order[nextIndex] }) })); });
  document.querySelectorAll('[data-recruit-convert]').forEach(button => button.onclick = () => { accountModalContext = { mode: 'convert', recruitId: button.dataset.recruitConvert }; showAccountModal = true; render(); });
  const recruitForm = document.querySelector('#recruit-form');
  if (recruitForm) recruitForm.onsubmit = event => { event.preventDefault(); const formData = new FormData(recruitForm); const payload = { name: formData.get('name'), email: formData.get('email'), phone: formData.get('phone'), notes: formData.get('notes') }; mutate(() => editingRecruit ? api(`/api/recruits/${editingRecruit}`, { method: 'PATCH', body: JSON.stringify(payload) }) : api('/api/recruits', { method: 'POST', body: JSON.stringify(payload) })); showRecruitModal = false; editingRecruit = null; };
  document.querySelectorAll('[data-bootcamp-load-video]').forEach(button => button.onclick = () => openBootCampVideo(button.dataset.bootcampLoadVideo));
  initBootCampVideoPlayers();
}

boot();
