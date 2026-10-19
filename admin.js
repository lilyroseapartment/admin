// Management admin: Google sign-in, case management and the residents register (MO edits, MC views).
const CFG = window.ADMIN_CONFIG;
const DEMO = !CFG.API_URL;
const DAY = 864e5;

const $ = (sel, root = document) => root.querySelector(sel);
const isClosed = s => CFG.CLOSED_STATUSES.includes(s);
const badgeClass = s => 'badge badge-' + s.toLowerCase().replace(/\s+/g, '-');

const state = { session: '', user: null, cases: [], registrationRequired: false, residents: null };
const filters = { q: '', status: 'open', category: '', block: '', flag: '' };
const resFilters = { q: '', block: '', type: '', active: 'yes' };

/* ───────────── Helpers ───────────── */

// Builds DOM safely: text is always set with textContent, never as HTML.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

// Kept across tabs; the server ends the session after the hours set in the Settings tab.
function store(key, val) {
  try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch (e) { /* storage blocked */ }
}
function load(key) {
  try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
}

// Malaysian numbers: 012-345 6789 → 60123456789 for WhatsApp links.
function waNumber(phone) {
  const d = String(phone).replace(/\D/g, '');
  return d.startsWith('0') ? '6' + d : d;
}

// Unit numbers usually include the block already (A-12-03); add the block only when they don't.
function unitLabel(c) {
  const unit = String(c.unit || '');
  return unit.toUpperCase().startsWith(String(c.block).toUpperCase()) ? unit : `${c.block}-${unit}`;
}

/* ───────────── API ───────────── */

class AuthError extends Error {}

async function api(action, payload = {}) {
  if (DEMO) return demoApi(action, payload);
  let res, data;
  try {
    res = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify({ action, session: state.session, ...payload }) });
  } catch (e) {
    throw new Error('Could not reach the server. Please check your internet connection.');
  }
  try { data = await res.json(); } catch (e) { throw new Error('The server returned an unexpected response.'); }
  if (data.auth) throw new AuthError(data.error || 'Please sign in again.');
  if (!data.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { data });
  return data;
}

// Any request can find the session expired: send the user back to sign-in.
async function call(action, payload) {
  try {
    return await api(action, payload);
  } catch (e) {
    if (e instanceof AuthError) { signOut(e.message); throw e; }
    throw e;
  }
}

/* ───────────── Sign-in ───────────── */

function showSignin(message) {
  $('#app').hidden = true;
  $('#signin').hidden = false;
  $('#signin-error').hidden = !message;
  $('#signin-error').textContent = message || '';
  if (DEMO) { $('#demo-signin').hidden = false; return; }
  if (!CFG.GOOGLE_CLIENT_ID) {
    $('#signin-error').textContent = 'Sign-in is not set up yet: GOOGLE_CLIENT_ID is missing in config.js.';
    $('#signin-error').hidden = false;
    return;
  }
  loadGoogle().then(() => {
    google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onGoogleCredential, auto_select: true });
    google.accounts.id.renderButton($('#gsi-button'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
  }).catch(() => {
    $('#signin-error').textContent = 'Could not load Google sign-in. Please check your connection and reload.';
    $('#signin-error').hidden = false;
  });
}

function loadGoogle() {
  if (window.google && google.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}

async function onGoogleCredential(resp) {
  $('#signin-error').hidden = true;
  try {
    const data = await api('adminLogin', { credential: resp.credential });
    startSession(data.session, data.user);
  } catch (e) {
    showSignin(e.message);
  }
}

function startSession(session, user) {
  state.session = session;
  state.user = user;
  store('admin-session', session);
  store('admin-user', JSON.stringify(user));
  $('#signin').hidden = true;
  $('#app').hidden = false;
  $('#me-name').textContent = user.name;
  $('#me-role').textContent = user.role;
  refreshCases().then(route).catch(e => {
    if (!(e instanceof AuthError)) $('#view').replaceChildren(h('div', { class: 'alert alert-error' }, e.message));
  });
}

function signOut(message) {
  if (state.session && !DEMO) api('adminLogout').catch(() => {});
  state.session = '';
  state.user = null;
  state.cases = [];
  state.residents = null;
  store('admin-session', null);
  store('admin-user', null);
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  showSignin(message);
}

async function refreshCases() {
  const data = await call('adminCases');
  state.cases = data.cases;
  state.registrationRequired = data.registrationRequired;
}

/* ───────────── Router ───────────── */

function route() {
  if (!state.user) return;
  const [tab, arg] = decodeURIComponent(location.hash.slice(1)).split('/');
  const view = $('#view');
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === (tab === 'case' ? 'cases' : tab || 'overview')));
  view.replaceChildren();
  window.scrollTo(0, 0);
  if (tab === 'cases') view.append(viewCases());
  else if (tab === 'case' && arg) viewCase(view, arg);
  else if (tab === 'residents') viewResidents(view);
  else view.append(viewOverview());
}
window.addEventListener('hashchange', route);

function goCases(preset) {
  Object.assign(filters, { q: '', status: 'open', category: '', block: '', flag: '' }, preset);
  if (location.hash === '#cases') route(); else location.hash = '#cases';
}

/* ───────────── Overview ───────────── */

function viewOverview() {
  const cases = state.cases;
  const open = cases.filter(c => !isClosed(c.status));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const overdue = open.filter(c => Date.now() - c.submittedTs > CFG.OVERDUE_DAYS * DAY);
  const awaiting = cases.filter(c => c.awaitingReply);
  const closedMonth = cases.filter(c => isClosed(c.status) && c.closedTs >= monthStart.getTime());

  const stat = (n, label, preset, alert) =>
    h('button', { class: 'stat' + (alert && n ? ' alert-stat' : ''), type: 'button', onclick: () => goCases(preset) }, h('strong', {}, n), h('span', {}, label));

  const attention = [...awaiting, ...open.filter(c => c.status === 'New' && !c.awaitingReply)]
    .sort((a, b) => a.submittedTs - b.submittedTs).slice(0, 8);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Overview'), h('p', {}, `Welcome, ${state.user.name}.`)),
      regPill()),
    h('div', { class: 'stats' },
      stat(open.filter(c => c.status === 'New').length, 'New', { status: 'New' }),
      stat(open.filter(c => c.status === 'In Progress').length, 'In progress', { status: 'In Progress' }),
      stat(overdue.length, `Open over ${CFG.OVERDUE_DAYS} days`, { flag: 'overdue' }, true),
      stat(awaiting.length, 'Resident replied', { status: 'all', flag: 'awaiting' }, true),
      stat(closedMonth.length, 'Closed this month', { status: 'closed' })),
    h('section', { class: 'card' },
      h('h2', {}, 'Needs attention'),
      attention.length ? h('div', { class: 'list' }, attention.map(caseRow)) : h('p', { class: 'empty' }, 'Nothing waiting. 🎉')));
}

function regPill() {
  return h('span', { class: 'pill' + (state.registrationRequired ? ' pill-on' : ''), title: 'Change this in the Settings tab of the complaints spreadsheet.' },
    `Registration check: ${state.registrationRequired ? 'On' : 'Off'}`);
}

/* ───────────── Cases ───────────── */

function caseRow(c) {
  return h('a', { class: 'row', href: '#case/' + encodeURIComponent(c.caseId) },
    h('span', { class: 'row-id' }, c.caseId, h('small', {}, c.submittedAt)),
    h('span', { class: 'row-main' },
      h('strong', {}, c.category),
      h('span', {}, `${unitLabel(c)} · ${c.name}${c.assignedTo ? ' · Assigned: ' + c.assignedTo : ''}`)),
    h('span', { class: 'row-side' },
      h('span', { class: badgeClass(c.status) }, c.status),
      c.awaitingReply ? h('span', { class: 'flag' }, '💬 Resident replied') : null));
}

function matchCase(c) {
  const f = filters;
  if (f.status === 'open' && isClosed(c.status)) return false;
  if (f.status === 'closed' && !isClosed(c.status)) return false;
  if (!['open', 'closed', 'all'].includes(f.status) && c.status !== f.status) return false;
  if (f.category && c.category !== f.category) return false;
  if (f.block && c.block !== f.block) return false;
  if (f.flag === 'awaiting' && !c.awaitingReply) return false;
  if (f.flag === 'overdue' && (isClosed(c.status) || Date.now() - c.submittedTs <= CFG.OVERDUE_DAYS * DAY)) return false;
  if (f.q) {
    const q = f.q.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, '');
    const hay = [c.caseId, c.name, unitLabel(c), c.unit, c.block + c.unit].join(' ').toLowerCase();
    const phone = String(c.phone).replace(/\D/g, '');
    if (!hay.includes(q) && !(qDigits.length >= 4 && phone.includes(qDigits))) return false;
  }
  return true;
}

function viewCases() {
  const list = h('div', { class: 'list' });
  const count = h('p', { class: 'count' });
  const draw = () => {
    const rows = state.cases.filter(matchCase).sort((a, b) => b.submittedTs - a.submittedTs);
    count.textContent = `${rows.length} case${rows.length === 1 ? '' : 's'}` + (filters.flag ? ` · ${filters.flag === 'awaiting' ? 'resident replied' : 'overdue'} only` : '');
    list.replaceChildren(...(rows.length ? rows.map(caseRow) : [h('p', { class: 'empty' }, 'No cases match.')]));
  };
  const opt = (v, label, cur) => h('option', { value: v, selected: v === cur }, label);
  const search = h('input', { type: 'search', placeholder: 'Search case ID, phone, unit or name', value: filters.q, 'aria-label': 'Search cases',
    oninput: e => { filters.q = e.target.value; draw(); } });
  const status = h('select', { 'aria-label': 'Status', onchange: e => { filters.status = e.target.value; filters.flag = ''; draw(); } },
    opt('open', 'Open cases', filters.status), opt('closed', 'Closed cases', filters.status), opt('all', 'All statuses', filters.status),
    CFG.STATUSES.map(s => opt(s, s, filters.status)));
  const category = h('select', { 'aria-label': 'Category', onchange: e => { filters.category = e.target.value; draw(); } },
    opt('', 'All categories', filters.category), CFG.CATEGORIES.map(s => opt(s, s, filters.category)));
  const block = h('select', { 'aria-label': 'Block', onchange: e => { filters.block = e.target.value; draw(); } },
    opt('', 'All blocks', filters.block), CFG.BLOCKS.map(s => opt(s, 'Block ' + s, filters.block)));

  const refresh = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async e => {
    e.target.disabled = true;
    try { await refreshCases(); draw(); toast('Updated'); } catch (err) { if (!(err instanceof AuthError)) toast(err.message); }
    e.target.disabled = false;
  } }, 'Refresh');

  const el = h('div', {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Cases')), refresh),
    h('div', { class: 'filters' }, h('div', { class: 'search' }, search), status, category, block),
    count, list);
  draw();
  return el;
}

/* ───────────── Case detail ───────────── */

async function viewCase(view, caseId) {
  view.append(h('p', { class: 'loading' }, 'Loading case…'));
  let c;
  try {
    c = (await call('adminCase', { caseId })).case;
  } catch (e) {
    if (e instanceof AuthError) return;
    view.replaceChildren(h('a', { class: 'back', href: '#cases' }, '‹ All cases'), h('div', { class: 'alert alert-error' }, e.message));
    return;
  }
  renderCase(view, c);
}

function renderCase(view, c) {
  const isMO = state.user.role === 'MO';
  const portalTrack = CFG.PORTAL_URL.replace(/\/?$/, '/') + 'track.html?id=' + encodeURIComponent(c.caseId);
  const waText = `Hi ${c.name}, this is the ${CFG.BUILDING_NAME} management office. There is an update on your case ${c.caseId}. You can view it and reply here: ${portalTrack}`;

  // Resident + issue
  const info = h('section', { class: 'card' },
    h('h2', {}, 'Resident'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Name'), h('dd', {}, `${c.name} (${c.applicantType})`),
      h('dt', {}, 'Unit'), h('dd', {}, `Block ${c.block}, ${c.unit}`),
      h('dt', {}, 'Phone'), h('dd', {}, c.phone)),
    isMO && h('div', { class: 'actions' },
      h('a', { class: 'btn btn-wa btn-sm', href: 'https://wa.me/' + waNumber(c.phone) + '?text=' + encodeURIComponent(waText), target: '_blank', rel: 'noopener' }, 'WhatsApp resident'),
      h('a', { class: 'btn btn-ghost btn-sm', href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') }, 'Call')),
    h('h2', { style: 'margin-top:20px' }, 'Issue'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Category'), h('dd', {}, c.category),
      h('dt', {}, 'Location'), h('dd', {}, c.location),
      h('dt', {}, 'Submitted'), h('dd', {}, c.submittedAt),
      c.inProgressAt ? [h('dt', {}, 'In progress'), h('dd', {}, c.inProgressAt)] : null,
      c.resolvedAt ? [h('dt', {}, 'Closed'), h('dd', {}, `${c.resolvedAt}${c.duration ? ' (' + c.duration + ')' : ''}`)] : null),
    h('p', { class: 'desc' }, c.description),
    c.attachments.length ? h('ul', { class: 'files' }, c.attachments.map(f =>
      h('li', {}, /^https:\/\//.test(f.url) ? h('a', { href: f.url, target: '_blank', rel: 'noopener' }, '📎 ' + f.name) : '📎 ' + f.name))) : null);

  // Manage (MO edits, MC views)
  const status = h('select', { id: 'f-status', disabled: !isMO }, CFG.STATUSES.map(s => h('option', { value: s, selected: s === c.status }, s)));
  const assigned = h('input', { id: 'f-assigned', maxlength: 60, value: c.assignedTo || '', disabled: !isMO, placeholder: 'e.g. Aisyah / contractor name' });
  const remarks = h('textarea', { id: 'f-remarks', maxlength: 1000, rows: 3, disabled: !isMO, placeholder: 'Short internal summary (not shown to the resident)' }, c.remarks || '');
  const tip = h('p', { class: 'alert alert-info tip', hidden: true }, 'Tip: add a short reply to the resident below explaining why, so the status does not feel abrupt.');
  status.addEventListener('change', () => { tip.hidden = !['Noted', 'Not Applicable'].includes(status.value); });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
  const manage = h('form', { class: 'card form-grid', onsubmit: async e => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      const data = await call('adminSaveCase', { caseId: c.caseId, status: status.value, assignedTo: assigned.value.trim(), remarks: remarks.value.trim() });
      applySummary(data.summary);
      toast('Saved');
      renderCase(view, data.case);
    } catch (err) {
      if (!(err instanceof AuthError)) toast(err.message);
      saveBtn.disabled = false;
    }
  } },
    h('h2', {}, 'Manage case'),
    h('div', {}, h('label', { for: 'f-status' }, 'Status'), status),
    tip,
    h('div', {}, h('label', { for: 'f-assigned' }, 'Assigned to'), assigned),
    h('div', {}, h('label', { for: 'f-remarks' }, 'Remarks'), remarks),
    isMO ? h('div', {}, saveBtn) : h('p', { class: 'muted small' }, 'Committee members can view the case and add internal notes. Status changes are made by the management office.'));

  // Conversation
  const thread = h('ol', { class: 'thread' }, c.updates.map(msgItem));
  const box = h('textarea', { id: 'f-msg', maxlength: 1000, rows: 3, placeholder: isMO ? 'Write an update for the resident…' : 'Write an internal note for the team…' });
  let visibility = isMO ? 'Public' : 'Internal';
  const seg = isMO ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Message type' },
    ['Public', 'Internal'].map(v => h('label', {},
      h('input', { type: 'radio', name: 'vis', value: v, checked: v === visibility, onchange: () => {
        visibility = v;
        box.placeholder = v === 'Public' ? 'Write an update for the resident…' : 'Write an internal note for the team…';
        sendBtn.textContent = v === 'Public' ? 'Send to resident' : 'Add internal note';
        hint.textContent = v === 'Public' ? 'Residents see staff replies as "Management Office".' : 'Internal notes are never shown to residents.';
      } }),
      h('span', {}, v === 'Public' ? 'Reply to resident' : 'Internal note')))) : null;
  const sendBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, isMO ? 'Send to resident' : 'Add internal note');
  const hint = h('span', { class: 'muted small' }, isMO ? 'Residents see staff replies as "Management Office".' : 'Internal notes are never shown to residents.');
  const composer = h('form', { onsubmit: async e => {
    e.preventDefault();
    const message = box.value.trim();
    if (message.length < 2) { box.focus(); return; }
    sendBtn.disabled = true;
    try {
      const data = await call('adminPost', { caseId: c.caseId, message, visibility });
      applySummary(data.summary);
      toast(visibility === 'Public' ? 'Sent. The resident sees it on Track My Case.' : 'Note added');
      renderCase(view, data.case);
    } catch (err) {
      if (!(err instanceof AuthError)) toast(err.message);
      sendBtn.disabled = false;
    }
  } },
    seg, box,
    h('div', { class: 'composer-foot' },
      hint, sendBtn));

  const conv = h('section', { class: 'card' }, h('h2', {}, 'Updates'),
    c.updates.length ? thread : h('p', { class: 'muted' }, 'No updates yet.'),
    c.locked ? h('p', { class: 'muted small' }, 'Closed more than 14 days ago: the resident can no longer reply.') : null,
    composer);

  view.replaceChildren(
    h('a', { class: 'back', href: '#cases' }, '‹ All cases'),
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, c.caseId), h('p', {}, `${c.category} · ${unitLabel(c)}`)),
      h('span', { class: badgeClass(c.status) }, c.status)),
    h('div', { class: 'detail' }, h('div', { class: 'stack' }, info, manage), conv));
}

function msgItem(u) {
  if (u.from === 'system') return h('li', { class: 'msg msg-system' }, `${u.message}${u.author ? ' by ' + u.author : ''} · ${u.at}`);
  const staff = u.from === 'MO' || u.from === 'MC';
  const who = staff ? `${u.author || 'Staff'} (${u.from})` : 'Resident';
  return h('li', { class: 'msg ' + (u.internal ? 'msg-internal' : staff ? 'msg-staff' : 'msg-resident') },
    h('div', { class: 'msg-head' }, h('strong', {}, who), u.internal ? h('span', { class: 'tag' }, 'Internal') : null, h('span', {}, u.at)),
    h('p', {}, u.message));
}

function applySummary(s) {
  const i = state.cases.findIndex(c => c.caseId === s.caseId);
  if (i >= 0) state.cases[i] = s; else state.cases.push(s);
}

/* ───────────── Residents (MO edits, MC views) ───────────── */

async function viewResidents(view) {
  if (!state.residents) {
    view.append(h('p', { class: 'loading' }, 'Loading residents…'));
    try {
      state.residents = (await call('adminResidents')).residents;
    } catch (e) {
      if (e instanceof AuthError) return;
      view.replaceChildren(h('div', { class: 'alert alert-error' }, e.message));
      return;
    }
  }
  const isMO = state.user.role === 'MO';
  const tbody = h('tbody');
  const count = h('p', { class: 'count' });
  const editor = h('div');
  const cols = ['Block', 'Unit', 'Name', 'Phone', 'Type', 'Active', 'Remarks'].concat(isMO ? [''] : []);

  const save = async (payload, done) => {
    const data = await call('adminSaveResident', payload);
    const i = state.residents.findIndex(r => r.key === data.resident.key);
    if (i >= 0) state.residents[i] = data.resident; else state.residents.push(data.resident);
    done(data.resident);
  };

  const draw = () => {
    const f = resFilters;
    const q = f.q.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, '');
    const rows = state.residents.filter(r => {
      if (f.block && r.block !== f.block) return false;
      if (f.type && r.type !== f.type) return false;
      if (f.active === 'yes' && !r.active) return false;
      if (f.active === 'no' && r.active) return false;
      if (!q) return true;
      const hay = [r.name, r.unit, `${r.block}-${r.unit}`, r.block + r.unit].join(' ').toLowerCase();
      return hay.includes(q) || (qDigits.length >= 4 && String(r.phone).replace(/\D/g, '').includes(qDigits));
    }).sort((a, b) => a.block.localeCompare(b.block) || a.unit.localeCompare(b.unit, undefined, { numeric: true }) || a.name.localeCompare(b.name));
    count.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
    tbody.replaceChildren(...(rows.length ? rows.map(r => h('tr', { class: r.active ? '' : 'inactive' },
      h('td', {}, r.block), h('td', {}, r.unit), h('td', {}, r.name), h('td', {}, r.phone),
      h('td', {}, r.type), h('td', {}, r.active ? 'Yes' : 'No'), h('td', {}, r.remarks || ''),
      isMO && h('td', { class: 'cell-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openEditor(r) }, 'Edit'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: e => toggleActive(r, e.target) }, r.active ? 'Deactivate' : 'Reactivate')))) :
      [h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, 'No matching residents. They may not be registered yet.'))]));
  };

  const toggleActive = async (r, btn) => {
    if (r.active && !confirm(`Deactivate ${r.name} (${r.unit}, ${r.phone})?` +
      (state.registrationRequired ? ' They will no longer be able to submit reports.' : ''))) return;
    btn.disabled = true;
    try {
      await save({ key: r.key, name: r.name, type: r.type, remarks: r.remarks, active: !r.active }, saved => {
        toast(saved.active ? 'Reactivated' : 'Deactivated');
        draw();
      });
    } catch (e) {
      if (!(e instanceof AuthError)) toast(e.message);
      btn.disabled = false;
    }
  };

  // One form for both: new record (block, unit, phone editable) or existing record (those three fixed).
  function openEditor(r) {
    const isNew = !r;
    const err = h('div', { class: 'alert alert-error', hidden: true });
    const field = (id, label, input) => h('div', {}, h('label', { for: id }, label), input);
    const opt = (v, label, cur) => h('option', { value: v, selected: v === cur }, label);
    const block = h('select', { id: 'r-block' }, opt('', 'Choose block', ''), CFG.BLOCKS.map(b => opt(b, 'Block ' + b, '')));
    const unit = h('input', { id: 'r-unit', maxlength: 20, placeholder: 'e.g. A-2-05' });
    const phone = h('input', { id: 'r-phone', maxlength: 20, type: 'tel', placeholder: 'e.g. 012-345 6789' });
    const name = h('input', { id: 'r-name', maxlength: 100, value: r ? r.name : '' });
    const type = h('select', { id: 'r-type' }, opt('', 'Choose type', r ? r.type : ''), ['Owner', 'Tenant', 'Agent'].map(t => opt(t, t, r ? r.type : '')));
    const remarks = h('input', { id: 'r-remarks', maxlength: 200, value: r ? r.remarks || '' : '', placeholder: 'Optional, e.g. Moved in Oct 2026' });
    const active = h('input', { id: 'r-active', type: 'checkbox', checked: r ? r.active : true });
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, isNew ? 'Add resident' : 'Save changes');
    const close = () => editor.replaceChildren();

    const showError = (message, existingKey) => {
      const existing = existingKey && state.residents.find(x => x.key === existingKey);
      err.replaceChildren(message, existing ? h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async e => {
          e.target.disabled = true;
          try {
            await save({ key: existing.key, name: name.value.trim() || existing.name, type: type.value || existing.type, remarks: remarks.value.trim() || existing.remarks, active: true }, () => {
              toast('Reactivated');
              close();
              draw();
            });
          } catch (ex) {
            if (!(ex instanceof AuthError)) showError(ex.message);
          }
        } }, 'Reactivate that record')) : null);
      err.hidden = false;
    };

    const form = h('form', { class: 'card form-grid res-editor', onsubmit: async e => {
      e.preventDefault();
      err.hidden = true;
      const payload = { name: name.value.trim(), type: type.value, remarks: remarks.value.trim(), active: active.checked };
      if (isNew) Object.assign(payload, { block: block.value, unit: unit.value.trim(), phone: phone.value.trim() });
      else payload.key = r.key;
      const missing = isNew && !payload.block ? 'Please choose the block.' : isNew && !payload.unit ? 'Please enter the unit number.' :
        isNew && payload.phone.replace(/\D/g, '').length < 8 ? 'Please enter a valid phone number.' :
        !payload.name ? 'Please enter the name.' : !payload.type ? 'Please choose Owner, Tenant or Agent.' : '';
      if (missing) { showError(missing); return; }
      saveBtn.disabled = true;
      try {
        await save(payload, saved => {
          toast(isNew ? 'Resident added' : 'Saved');
          close();
          // Make sure the new or changed record is visible in the list.
          if (resFilters.active === 'yes' && !saved.active) resFilters.active = '';
          draw();
        });
      } catch (ex) {
        if (!(ex instanceof AuthError)) showError(ex.message, ex.data && ex.data.existingKey);
        saveBtn.disabled = false;
      }
    } },
      h('h2', {}, isNew ? 'Add resident' : `Edit ${r.name}`),
      isNew
        ? h('div', { class: 'grid3' }, field('r-block', 'Block', block), field('r-unit', 'Unit', unit), field('r-phone', 'Phone', phone))
        : h('div', {},
          h('dl', { class: 'kv' }, h('dt', {}, 'Unit'), h('dd', {}, `Block ${r.block}, ${r.unit}`), h('dt', {}, 'Phone'), h('dd', {}, r.phone)),
          h('p', { class: 'muted small' }, 'Unit and phone cannot be changed. For a new number, add a new record and deactivate this one.')),
      h('div', { class: 'grid3' }, field('r-name', 'Name', name), field('r-type', 'Type', type), field('r-remarks', 'Remarks', remarks)),
      h('label', { class: 'check' }, active, h('span', {}, 'Active (can submit reports when the registration check is on)')),
      err,
      h('div', { class: 'actions' }, saveBtn, h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, 'Cancel')));
    editor.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (isNew ? block : name).focus();
  }

  const opt = (v, label, cur) => h('option', { value: v, selected: v === cur }, label);
  view.replaceChildren(h('div', {},
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Residents register'), h('p', {}, isMO
        ? 'Add, update or deactivate residents. A new phone number is always added as a new record.'
        : 'View only. The management office maintains this register.')),
      h('div', { class: 'actions', style: 'margin:0;align-items:center' },
        regPill(),
        isMO && h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openEditor(null) }, '+ Add resident'))),
    editor,
    h('div', { class: 'filters' },
      h('div', { class: 'search' }, h('input', { type: 'search', placeholder: 'Search unit, phone or name', value: resFilters.q, 'aria-label': 'Search residents', oninput: e => { resFilters.q = e.target.value; draw(); } })),
      h('select', { 'aria-label': 'Block', onchange: e => { resFilters.block = e.target.value; draw(); } }, opt('', 'All blocks', resFilters.block), CFG.BLOCKS.map(b => opt(b, 'Block ' + b, resFilters.block))),
      h('select', { 'aria-label': 'Type', onchange: e => { resFilters.type = e.target.value; draw(); } }, opt('', 'All types', resFilters.type), ['Owner', 'Tenant', 'Agent'].map(t => opt(t, t, resFilters.type))),
      h('select', { 'aria-label': 'Active', onchange: e => { resFilters.active = e.target.value; draw(); } }, opt('yes', 'Active only', resFilters.active), opt('no', 'Inactive only', resFilters.active), opt('', 'Active + inactive', resFilters.active))),
    count,
    h('div', { class: 'card table-wrap', style: 'padding:0' },
      h('table', {}, h('thead', {}, h('tr', {}, cols.map(t => h('th', {}, t)))), tbody))));
  draw();
}

/* ───────────── Demo data (preview only) ───────────── */

const fmt = ts => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(ts);
let demoDb;

function demoInit() {
  const now = Date.now();
  const mk = (n, daysAgo, o) => ({
    caseId: `APT-2026-${String(n).padStart(4, '0')}`, submittedTs: now - daysAgo * DAY, applicantType: 'Owner', assignedTo: '', remarks: '',
    inProgressTs: 0, closedTs: 0, attachments: [], updates: [], ...o,
  });
  const cases = [
    mk(12, 9, { name: 'Tan Mei Ling', block: 'A', unit: 'A-2-05', phone: '012-345 6789', category: 'Water Leakage & Plumbing', location: 'Ceiling of master bathroom',
      description: 'Water dripping from the ceiling whenever the unit above uses the shower. Getting worse this week.', status: 'In Progress', inProgressTs: now - 8.8 * DAY, assignedTo: 'Aisyah',
      remarks: 'Form 28 issued to A-3-05 owner', attachments: [{ name: 'ceiling.jpg', url: 'https://drive.google.com/' }, { name: 'drip.mp4', url: 'https://drive.google.com/' }],
      updates: [
        { ts: now - 8.8 * DAY, from: 'system', author: 'Aisyah (MO)', message: 'Status changed to In Progress' },
        { ts: now - 8.7 * DAY, from: 'MO', author: 'Aisyah', message: 'We inspected the ceiling. The leak is from the unit above (A-3-05). Form 28 has been issued to the owner. Waiting for the owner to respond.' },
        { ts: now - 6 * DAY, from: 'MC', author: 'Mr Lim', internal: true, message: 'Owner of A-3-05 is overseas. Try the agent, number is in the register.' },
        { ts: now - 0.3 * DAY, from: 'resident', message: 'Hi, any update? The ceiling is still dripping when it rains.' },
      ] }),
    mk(15, 2, { name: 'Muhammad Faiz', block: 'C', unit: 'C-1-02', phone: '019-876 5432', applicantType: 'Tenant', category: 'Parking & Visitors', location: 'Visitor parking near guardhouse',
      description: 'A car without a sticker has been parked at visitor bay V3 for 5 days.', status: 'New' }),
    mk(16, 1, { name: 'Lee Wei Jie', block: 'B', unit: 'B1-3-01', phone: '+6016 222 3344', category: 'Security & Safety', location: 'Back gate',
      description: 'The back gate lock is broken and the gate stays open at night.', status: 'New' }),
    mk(14, 4, { name: 'Siti Nur', block: 'D', unit: 'D-G-08', phone: '013-555 1212', applicantType: 'Tenant', category: 'Suggestions & Feedback', location: 'Playground',
      description: 'Suggest adding a shade over the playground as it is very hot in the afternoon.', status: 'Noted', closedTs: now - 3 * DAY,
      updates: [{ ts: now - 3 * DAY, from: 'system', author: 'Aisyah (MO)', message: 'Status changed to Noted' },
        { ts: now - 3 * DAY, from: 'MO', author: 'Aisyah', message: 'Thank you for the suggestion. We will raise it at the next committee meeting.' }] }),
    mk(10, 20, { name: 'Kumar Raj', block: 'E', unit: 'E-4-03', phone: '017-888 9999', category: 'Cleanliness & Waste', location: 'Block E bin centre',
      description: 'Rubbish not collected for 3 days, strong smell.', status: 'Resolved', inProgressTs: now - 19.5 * DAY, closedTs: now - 18 * DAY,
      updates: [{ ts: now - 19.5 * DAY, from: 'system', author: 'Aisyah (MO)', message: 'Status changed to In Progress' },
        { ts: now - 18 * DAY, from: 'system', author: 'Aisyah (MO)', message: 'Status changed to Resolved' },
        { ts: now - 18 * DAY, from: 'MO', author: 'Aisyah', message: 'The cleaning contractor has cleared the bin centre. Collection is back to normal.' }] }),
    mk(11, 12, { name: 'Wong Ah Kow', block: 'F', unit: 'F1-1-07', phone: '012-111 2222', category: 'Nuisance & Neighbour Issues', location: 'F1-1-08',
      description: 'Neighbour renovating after 6pm on weekdays.', status: 'In Progress', inProgressTs: now - 11 * DAY, assignedTo: 'Aisyah' }),
    mk(13, 6, { name: 'Nurul Huda', block: 'G', unit: 'G-2-04', phone: '014-321 0000', category: 'Others', location: 'Inside unit',
      description: 'My kitchen sink is blocked.', status: 'Not Applicable', closedTs: now - 5 * DAY,
      updates: [{ ts: now - 5 * DAY, from: 'system', author: 'Aisyah (MO)', message: 'Status changed to Not Applicable' },
        { ts: now - 5 * DAY, from: 'MO', author: 'Aisyah', message: 'This is inside your unit, so please contact your own plumber. Let us know if the blockage is in the common pipe.' }] }),
  ];
  const r = (block, unit, name, phone, type, active = true, remarks = '') => ({ key: `${block}|${unit}|${phone}`, block, unit, name, phone, type, active, remarks });
  demoDb = {
    cases,
    residents: [
      r('A', 'A-2-05', 'Tan Mei Ling', '012-345 6789', 'Owner'),
      r('A', 'A-2-05', 'Tan Kok Wai', '012-345 0000', 'Owner'),
      r('A', 'A-3-05', 'Ng Siew Lan', '011-2233 4455', 'Owner', true, 'Overseas'),
      r('A', 'A-3-05', 'Prime Realty (agent)', '03-7788 9900', 'Agent'),
      r('A', 'A-3-06', 'Prime Realty (agent)', '03-7788 9900', 'Agent'),
      r('B', 'B1-3-01', 'Lee Wei Jie', '+6016 222 3344', 'Owner'),
      r('C', 'C-1-02', 'Muhammad Faiz', '019-876 5432', 'Tenant'),
      r('C', 'C-1-02', 'Ahmad Zaki', '019-000 1111', 'Tenant', false, 'Moved out Aug 2026'),
      r('D', 'D-G-08', 'Siti Nur', '013-555 1212', 'Tenant'),
      r('E', 'E-4-03', 'Kumar Raj', '017-888 9999', 'Owner'),
    ],
  };
}

function demoFull(c) {
  const updates = [...c.updates].sort((a, b) => a.ts - b.ts).map(u => ({ ...u, at: fmt(u.ts) }));
  const last = [...c.updates].filter(u => u.from !== 'system' && !u.internal).sort((a, b) => b.ts - a.ts)[0];
  const span = c.closedTs ? c.closedTs - c.submittedTs : 0;
  return {
    ...c, phone: demoPhone(c.phone), updates, submittedAt: fmt(c.submittedTs), inProgressAt: c.inProgressTs ? fmt(c.inProgressTs) : '', resolvedAt: c.closedTs ? fmt(c.closedTs) : '',
    duration: span ? `${Math.floor(span / DAY)}d ${Math.floor(span % DAY / 36e5)}h` : '',
    awaitingReply: !!last && last.from === 'resident', locked: !!c.closedTs && Date.now() - c.closedTs > 14 * DAY,
  };
}
// Committee members see masked numbers unless the Settings tab allows the full number.
const demoPhone = p => state.user.role === 'MO' ? p : '*******' + String(p).replace(/\D/g, '').slice(-4);

function demoSummary(c) {
  const { description, location, attachments, updates, remarks, ...rest } = demoFull(c);
  return rest;
}

async function demoApi(action, p) {
  await new Promise(r => setTimeout(r, 350));
  if (!demoDb) demoInit();
  const find = id => {
    const c = demoDb.cases.find(x => x.caseId === id);
    if (!c) throw new Error('Case not found.');
    return c;
  };
  const me = state.user;
  switch (action) {
    case 'adminCases': return { ok: true, cases: demoDb.cases.map(demoSummary), registrationRequired: false };
    case 'adminCase': return { ok: true, case: demoFull(find(p.caseId)) };
    case 'adminResidents': return { ok: true, residents: demoDb.residents.map(x => ({ ...x, phone: demoPhone(x.phone) })) };
    case 'adminSaveResident': {
      if (me.role !== 'MO') throw new Error('Only the management office can update the residents register.');
      let x = p.key && demoDb.residents.find(y => y.key === p.key);
      if (p.key && !x) throw new Error('This record was not found. Please reload the page.');
      if (!x) {
        const digits = v => String(v).replace(/\D/g, '').replace(/^60/, '0');
        const dup = demoDb.residents.find(y => y.block === p.block && y.unit.toUpperCase() === p.unit.toUpperCase() && digits(y.phone) === digits(p.phone));
        if (dup && dup.active) throw new Error('This phone number is already registered for this unit.');
        if (dup) throw Object.assign(new Error('This phone number is already registered for this unit, but the record is inactive. Reactivate it instead.'), { data: { existingKey: dup.key } });
        x = { key: `${p.block}|${p.unit}|${p.phone}`, block: p.block, unit: p.unit, phone: p.phone };
        demoDb.residents.push(x);
      }
      Object.assign(x, { name: p.name, type: p.type, remarks: p.remarks, active: p.active });
      return { ok: true, resident: { ...x } };
    }
    case 'adminSaveCase': {
      if (me.role !== 'MO') throw new Error('Only the management office can change cases.');
      const c = find(p.caseId);
      if (p.status !== c.status) {
        c.updates.push({ ts: Date.now(), from: 'system', author: `${me.name} (MO)`, message: `Status changed to ${p.status}` });
        if (p.status === 'In Progress' && !c.inProgressTs) c.inProgressTs = Date.now();
        if (isClosed(p.status) && !c.closedTs) c.closedTs = Date.now();
        if (!isClosed(p.status)) c.closedTs = 0;
        if (p.status === 'New') c.inProgressTs = 0;
        c.status = p.status;
      }
      c.assignedTo = p.assignedTo;
      c.remarks = p.remarks;
      return { ok: true, case: demoFull(c), summary: demoSummary(c) };
    }
    case 'adminPost': {
      const c = find(p.caseId);
      const internal = me.role !== 'MO' || p.visibility === 'Internal';
      c.updates.push({ ts: Date.now(), from: me.role, author: me.name, internal, message: p.message });
      return { ok: true, case: demoFull(c), summary: demoSummary(c) };
    }
  }
  throw new Error('Unknown action.');
}

/* ───────────── Start ───────────── */

document.querySelectorAll('[data-building]').forEach(el => { el.textContent = CFG.BUILDING_NAME; });
$('#signout').addEventListener('click', () => signOut());
if (DEMO) {
  $('#demo-banner').hidden = false;
  document.querySelectorAll('[data-demo-role]').forEach(b => b.addEventListener('click', () => {
    const role = b.dataset.demoRole;
    startSession('demo', { name: role === 'MO' ? 'Aisyah' : 'Mr Lim', role });
  }));
}

(function init() {
  const session = load('admin-session');
  let user = null;
  try { user = JSON.parse(load('admin-user') || 'null'); } catch (e) { /* ignore */ }
  if (session && user) startSession(session, user);
  else showSignin();
})();
