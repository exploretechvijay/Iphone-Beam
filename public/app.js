'use strict';

/* ---------------------------------------------------------------- helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function storageGet(area, key) {
  try { return window[area].getItem(key); } catch { return null; }
}
function storageSet(area, key, value) {
  try { window[area].setItem(key, value); } catch { /* private browsing */ }
}

// crypto.randomUUID needs HTTPS, which a phone on the LAN does not have.
function newId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${units[i]}`;
}
function fmtDuration(sec) {
  sec = Math.max(1, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function hue(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

async function api(path, body, method = 'POST') {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------------------------------------------------------------- icons */

const ICONS = {
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  tablet: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  laptop: '<rect x="4.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M2.5 19.5h19"/>',
  desktop: '<rect x="3" y="3.5" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16v4.5"/>',
  file: '<path d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2.5V8h5.5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-5-5L5 21"/>',
  video: '<rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="m16.5 10 5-3v10l-5-3"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  archive: '<rect x="3" y="3.5" width="18" height="5" rx="1.5"/><path d="M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5M10 12.5h4"/>',
  doc: '<path d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/>',
  text: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  download: '<path d="M12 3.5v12M7 11l5 5 5-5M4.5 20.5h15"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  send: '<path d="M21.5 2.5 10.5 13.5M21.5 2.5l-7 19-4-8-8-4z"/>',
  retry: '<path d="M3.5 12a8.5 8.5 0 0 1 14.5-6l2.5 2.5M20.5 3.5v5h-5M20.5 12A8.5 8.5 0 0 1 6 18l-2.5-2.5M3.5 20.5v-5h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.5v.5"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10.5 10.5 0 0 1 14 0M8.5 15.5a5.5 5.5 0 0 1 7 0"/><path d="M12 19h.01"/>',
};
const icon = (name) => `<span class="i"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg></span>`;

/* ---------------------------------------------------------------- device identity */

const DEVICE_LABEL = { iphone: 'iPhone', ipad: 'iPad', android: 'Android', windows: 'Windows PC', mac: 'Mac', linux: 'Linux', other: 'Device' };
const DEVICE_ICON = { iphone: 'phone', android: 'phone', ipad: 'tablet', windows: 'laptop', mac: 'laptop', linux: 'desktop', other: 'desktop' };

function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac/.test(ua)) return 'mac';
  if (/Linux|CrOS/.test(ua)) return 'linux';
  return 'other';
}

function randomName() {
  const adj = ['Swift', 'Calm', 'Bright', 'Lucky', 'Brave', 'Clever', 'Gentle', 'Happy', 'Mighty', 'Quiet', 'Sunny', 'Witty', 'Bold', 'Cosmic', 'Jolly', 'Noble'];
  const animal = ['Falcon', 'Otter', 'Panda', 'Fox', 'Koala', 'Tiger', 'Dolphin', 'Owl', 'Lynx', 'Penguin', 'Raven', 'Hawk', 'Turtle', 'Wolf', 'Gecko', 'Bison'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(adj)} ${pick(animal)}`;
}

const DEVICE = detectDevice();
const IS_TOUCH = matchMedia('(hover: none)').matches;
const IS_MOBILE = DEVICE === 'iphone' || DEVICE === 'android' || DEVICE === 'ipad';

const state = {
  // Session storage keeps the id across reloads but gives each tab its own device.
  id: storageGet('sessionStorage', 'beam.id') || newId(),
  name: storageGet('localStorage', 'beam.name') || randomName(),
  isHost: false,
  saveDir: null,
  peers: [],
  peersLoaded: false,
  items: new Map(),
  target: null,
  unread: 0,
};
storageSet('sessionStorage', 'beam.id', state.id);
storageSet('localStorage', 'beam.name', state.name);

const els = {
  status: $('#status'),
  statusText: $('#statusText'),
  peers: $('#peers'),
  radarHint: $('#radarHint'),
  roomTip: $('#roomTip'),
  feed: $('#feed'),
  feedEmpty: $('#feedEmpty'),
  clearBtn: $('#clearBtn'),
  fileInput: $('#fileInput'),
  toasts: $('#toasts'),
  dropHint: $('#dropHint'),
};

const avatarHTML = (device, id, size = '') =>
  `<div class="avatar ${size}" style="--h:${hue(id)}">${icon(DEVICE_ICON[device] || 'desktop')}<span class="ring"></span></div>`;

/* ---------------------------------------------------------------- toasts */

function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : kind === 'error' ? 'alert' : 'info')}<span>${esc(message)}</span>`;
  els.toasts.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

function notify(message, kind) {
  toast(message, kind);
  if (document.hidden) {
    state.unread++;
    updateTitle();
  }
}
const updateTitle = () => { document.title = state.unread ? `(${state.unread}) Beam` : 'Beam'; };

/* ---------------------------------------------------------------- connection */

let source = null;
let reconnectTimer = null;

function connect() {
  clearTimeout(reconnectTimer);
  if (source) source.close();
  const q = new URLSearchParams({ id: state.id, name: state.name, device: DEVICE });
  source = new EventSource(`/api/events?${q}`);
  source.onopen = () => setConnected(true);
  source.onerror = () => {
    setConnected(false);
    if (source.readyState === EventSource.CLOSED) reconnectTimer = setTimeout(connect, 3000);
  };
  source.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (handlers[msg.type]) handlers[msg.type](msg);
  };
}

let connected = false;
function setConnected(on) {
  connected = on;
  els.status.classList.toggle('online', on);
  const n = state.peers.length;
  els.statusText.textContent = !on ? 'Reconnecting…' : n ? `${plural(n, 'device')} nearby` : 'Connected';
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  state.unread = 0;
  updateTitle();
  // Phones often kill the connection while the tab is in the background.
  if (!source || source.readyState === EventSource.CLOSED) connect();
});

const handlers = {
  hello(m) {
    state.isHost = m.self.isHost;
    state.saveDir = m.saveDir;
    renderMe();
    m.batches.sort((a, b) => a.createdAt - b.createdAt).forEach((b) => upsertIncoming(b, false));
    emptyMode = null;
    renderFeedEmpty();
  },

  peers(m) {
    const before = new Map(state.peers.map((p) => [p.id, p]));
    state.peers = m.peers.filter((p) => p.id !== state.id);
    if (state.peersLoaded) {
      for (const p of state.peers) if (!before.has(p.id)) toast(`${p.name} joined`);
      for (const p of before.values()) if (!state.peers.some((x) => x.id === p.id)) toast(`${p.name} left`);
    }
    state.peersLoaded = true;
    renderPeers();
    renderFeedEmpty();
  },

  batch(m) {
    upsertIncoming(m.batch, true);
  },

  progress(m) {
    const item = state.items.get(m.batchId);
    const f = item && item.files.find((x) => x.id === m.fileId);
    if (!f || f.status === 'ready') return;
    f.received = m.received;
    if (f.status !== 'uploading') {
      f.status = 'uploading';
      renderCard(item);
    } else {
      updateProgress(item);
    }
  },

  file(m) {
    const item = state.items.get(m.batchId);
    const f = item && item.files.find((x) => x.id === m.file.id);
    if (!f) return;
    const wasSettled = batchStats(item).settled;
    Object.assign(f, m.file);
    renderCard(item);
    if (item.dir !== 'in' || wasSettled) return;
    const s = batchStats(item);
    if (!s.settled) return;
    if (s.failed) notify(`${plural(s.failed, 'file')} from ${item.peerName} failed`, 'error');
    else if (item.files.some((x) => x.saved)) notify(`Saved ${plural(s.ready, 'file')} from ${item.peerName}`, 'ok');
    else notify(`${plural(s.ready, 'file')} from ${item.peerName} ready`, 'ok');
  },

  downloaded(m) {
    const item = state.items.get(m.batchId);
    if (!item) return;
    for (const f of item.files) if (m.fileIds.includes(f.id)) f.downloaded = true;
    renderCard(item);
  },

  'batch-removed'(m) {
    const item = state.items.get(m.batchId);
    if (!item) return;
    if (item.dir === 'in') {
      if (m.reason === 'cancelled') toast(`${item.peerName} cancelled the transfer`);
      removeItem(item);
      return;
    }
    if (item.removed) return;
    // The receiver cleared it after everything arrived: nothing to report.
    if (m.reason === 'dismissed' && batchStats(item).settled) return;
    item.removed = true;
    item.removedText = m.reason === 'expired' ? 'Expired before it was downloaded' : `${item.peerName} declined the transfer`;
    if (item.xhr) item.xhr.abort();
    renderCard(item);
  },

  text(m) {
    addItem({ kind: 'text', dir: 'in', id: m.id, peerId: m.from, peerName: m.fromName, peerDevice: m.fromDevice, text: m.text, createdAt: m.at });
    notify(`Message from ${m.fromName}`);
  },

  replaced() {
    // This tab was duplicated; become a separate device.
    source.close();
    state.id = newId();
    storageSet('sessionStorage', 'beam.id', state.id);
    connect();
  },
};

/* ---------------------------------------------------------------- the room */

function renderMe() {
  $('#meAvatar').innerHTML = avatarHTML(DEVICE, state.id);
  $('#meName').innerHTML = `<span>${esc(state.name)}</span>${icon('pencil')}`;
  $('#meSub').textContent = `${DEVICE_LABEL[DEVICE]} · ${state.isHost ? 'this computer' : 'you'}`;
}

function renderPeers() {
  const n = state.peers.length;
  const existing = new Map($$('.peer', els.peers).filter((el) => !el.classList.contains('leaving')).map((el) => [el.dataset.id, el]));

  state.peers.forEach((p, i) => {
    const angle = ((-90 + 30 + (360 / n) * i) * Math.PI) / 180;
    const r = n > 7 ? (i % 2 ? 28 : 40) : 37;
    let el = existing.get(p.id);
    existing.delete(p.id);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'peer';
      el.dataset.id = p.id;
      els.peers.appendChild(el);
    }
    el.style.setProperty('--x', `${50 + r * Math.cos(angle)}%`);
    el.style.setProperty('--y', `${50 + r * Math.sin(angle)}%`);
    el.setAttribute('aria-label', `Send to ${p.name}`);
    el.innerHTML = `${avatarHTML(p.device, p.id)}<span class="peer-name">${esc(p.name)}</span><span class="peer-sub">${esc(DEVICE_LABEL[p.device] || 'Device')}</span>`;
  });
  for (const el of existing.values()) {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  }

  els.radarHint.hidden = n > 0;
  els.roomTip.textContent = n
    ? IS_TOUCH ? 'Tap a device to send photos, files or text' : 'Click a device to send — or drop files onto it'
    : 'Open Beam on another device on this Wi-Fi';
  setConnected(connected);

  // Keep the send progress ring in sync after a re-render.
  for (const item of state.items.values()) if (item.dir === 'out' && item.kind === 'batch') updateProgress(item);
}

function setPeerProgress(peerId, pct) {
  const el = els.peers.querySelector(`.peer[data-id="${peerId}"]`);
  if (!el) return;
  el.classList.toggle('sending', pct != null);
  if (pct != null) el.style.setProperty('--p', pct.toFixed(1));
}

els.peers.addEventListener('click', (e) => {
  const el = e.target.closest('.peer');
  const peer = el && state.peers.find((p) => p.id === el.dataset.id);
  if (peer) openSheet(peer);
});

function openSheet(peer) {
  state.target = peer;
  $('#sheetPeer').innerHTML = `${avatarHTML(peer.device, peer.id)}<div><strong>${esc(peer.name)}</strong><span>${esc(DEVICE_LABEL[peer.device] || 'Device')}</span></div>`;
  openModal('sheet');
}

$('#sendFilesBtn').addEventListener('click', () => {
  closeModal('sheet');
  els.fileInput.click(); // must run inside the tap for iOS to open the picker
});

els.fileInput.addEventListener('change', () => {
  const list = Array.from(els.fileInput.files || []);
  els.fileInput.value = '';
  if (state.target && list.length) sendFiles(state.target, list);
});

$('#sendTextBtn').addEventListener('click', () => {
  closeModal('sheet');
  $('#textTarget').textContent = state.target.name;
  $('#textInput').value = '';
  openModal('textModal');
});

$('#textForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#textInput').value;
  if (!text.trim() || !state.target) return;
  closeModal('textModal');
  sendText(state.target, text);
});
$('#textInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#textForm').requestSubmit();
});

$('#meName').addEventListener('click', () => {
  $('#nameInput').value = state.name;
  openModal('renameModal');
});
$('#renameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#nameInput').value.trim().slice(0, 40);
  if (!name) return;
  state.name = name;
  storageSet('localStorage', 'beam.name', name);
  renderMe();
  closeModal('renameModal');
  connect(); // reconnect so the room sees the new name
});

/* ---------------------------------------------------------------- sending */

function livePeer(peer) {
  return state.peers.find((p) => p.id === peer.id);
}

async function sendFiles(peer, fileList) {
  const list = Array.from(fileList).filter((f) => f && typeof f.size === 'number');
  if (!list.length) return;
  const target = livePeer(peer);
  if (!target) return toast(`${peer.name} is no longer connected`, 'error');

  let batch;
  try {
    batch = await api('/api/batch', {
      from: state.id,
      to: target.id,
      files: list.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    });
  } catch (err) {
    return toast(err.message, 'error');
  }

  const item = {
    kind: 'batch',
    dir: 'out',
    id: batch.id,
    peerId: target.id,
    peerName: target.name,
    peerDevice: target.device,
    saveToHost: batch.saveToHost,
    createdAt: batch.createdAt,
    files: batch.files.map((f, i) => {
      const blob = list[i];
      const thumb = fileKind(f) === 'image' && blob.size < 30e6 ? URL.createObjectURL(blob) : null;
      return { ...f, blob, sent: 0, thumb };
    }),
  };
  addItem(item);
  runUploads(item, item.files);
}

async function runUploads(item, list) {
  item.sending = true;
  item.samples = [];
  for (const f of list) {
    if (item.removed) break;
    f.status = 'uploading';
    f.sent = 0;
    renderCard(item);
    try {
      await uploadFile(item, f);
      f.status = 'ready';
      f.sent = f.size;
    } catch (err) {
      if (item.removed) break;
      f.status = 'failed';
    }
  }
  item.sending = false;
  renderCard(item);
  if (item.removed) return;
  const s = batchStats(item);
  if (s.failed) toast(`${plural(s.failed, 'file')} could not be sent`, 'error');
  else toast(`Sent ${plural(s.n, 'file')} to ${item.peerName}`, 'ok');
}

function uploadFile(item, f) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    item.xhr = xhr;
    xhr.open('PUT', `/api/upload/${f.id}?from=${encodeURIComponent(state.id)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    let last = 0;
    xhr.upload.onprogress = (e) => {
      f.sent = e.loaded;
      const now = performance.now();
      if (now - last > 150) {
        last = now;
        updateProgress(item);
      }
    };
    xhr.onload = () => {
      item.xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = 'Upload failed';
      try { message = JSON.parse(xhr.responseText).error || message; } catch { /* not JSON */ }
      reject(new Error(message));
    };
    xhr.onerror = () => { item.xhr = null; reject(new Error('Network error')); };
    xhr.onabort = () => { item.xhr = null; reject(new Error('Cancelled')); };
    xhr.send(f.blob);
  });
}

async function sendText(peer, text) {
  const target = livePeer(peer);
  if (!target) return toast(`${peer.name} is no longer connected`, 'error');
  try {
    const r = await api('/api/text', { from: state.id, to: target.id, text });
    addItem({ kind: 'text', dir: 'out', id: r.id, peerId: target.id, peerName: target.name, peerDevice: target.device, text, createdAt: r.at });
    toast(`Sent to ${target.name}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------------------------------------------------------- drag & drop (desktop) */

let dragDepth = 0;
const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('dragging');
  const n = state.peers.length;
  els.dropHint.innerHTML = `${icon('send')}<span>${
    n === 1 ? `Drop to send to ${esc(state.peers[0].name)}` : n ? 'Drop the files on a device' : 'No devices connected yet'
  }</span>`;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) endDrag();
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const over = e.target.closest && e.target.closest('.peer');
  $$('.peer', els.peers).forEach((el) => el.classList.toggle('drop-hover', el === over));
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  endDrag();
  const el = e.target.closest && e.target.closest('.peer');
  const peer = el ? state.peers.find((p) => p.id === el.dataset.id) : state.peers.length === 1 ? state.peers[0] : null;
  if (peer) sendFiles(peer, e.dataTransfer.files);
  else if (state.peers.length) toast('Drop the files onto a device');
});
function endDrag() {
  dragDepth = 0;
  document.body.classList.remove('dragging');
  $$('.peer', els.peers).forEach((el) => el.classList.remove('drop-hover'));
}

/* ---------------------------------------------------------------- activity feed */

const VISIBLE_FILES = 5;

function fileKind(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const type = f.type || '';
  if (type.startsWith('image/') || /^(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/.test(ext)) return 'image';
  if (type.startsWith('video/') || /^(mp4|mov|m4v|webm|avi|mkv|3gp)$/.test(ext)) return 'video';
  if (type.startsWith('audio/') || /^(mp3|m4a|wav|aac|flac|ogg|opus)$/.test(ext)) return 'audio';
  if (/^(zip|rar|7z|tar|gz|tgz)$/.test(ext)) return 'archive';
  if (/^(pdf|docx?|xlsx?|pptx?|txt|rtf|csv|pages|numbers|key|md)$/.test(ext)) return 'doc';
  return 'file';
}
const canOpen = (f) => /^(image|video|audio)$/.test(fileKind(f)) || /\.(pdf|txt)$/i.test(f.name);

function batchStats(item) {
  let total = 0, done = 0, ready = 0, failed = 0, active = null;
  for (const f of item.files) {
    total += f.size;
    if (f.status === 'ready') {
      ready++;
      done += f.size;
    } else if (f.status === 'failed') {
      failed++;
    } else if (f.status === 'uploading') {
      done += (item.dir === 'out' ? f.sent : f.received) || 0;
      active = f;
    }
  }
  const n = item.files.length;
  return { n, total, done, ready, failed, active, settled: ready + failed === n };
}

function upsertIncoming(b, announce) {
  const existing = state.items.get(b.id);
  if (existing) {
    existing.files = b.files;
    renderCard(existing);
    return;
  }
  addItem({
    kind: 'batch',
    dir: 'in',
    id: b.id,
    peerId: b.from,
    peerName: b.fromName,
    peerDevice: b.fromDevice,
    createdAt: b.createdAt,
    files: b.files,
  });
  if (announce) notify(`${b.fromName} is sending you ${plural(b.files.length, 'file')}`);
}

function addItem(item) {
  state.items.set(item.id, item);
  renderCard(item);
}

function removeItem(item) {
  state.items.delete(item.id);
  if (item.files) item.files.forEach((f) => f.thumb && URL.revokeObjectURL(f.thumb));
  if (item.dir === 'out') setPeerProgress(item.peerId, null);
  const el = document.getElementById(`item-${item.id}`);
  if (el) {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  }
  renderFeedEmpty();
}

function renderCard(item) {
  let el = document.getElementById(`item-${item.id}`);
  if (!el) {
    el = document.createElement('article');
    el.className = 'card';
    el.id = `item-${item.id}`;
    el.dataset.id = item.id;
    els.feed.prepend(el);
  }
  el.innerHTML = item.kind === 'text' ? textCardHTML(item) : batchCardHTML(item);
  for (const img of el.querySelectorAll('img')) img.addEventListener('error', () => img.remove(), { once: true });
  if (item.kind === 'batch') updateProgress(item);
  renderFeedEmpty();
}

const note = (text, cls = '', ic = cls === 'err' ? 'alert' : cls === 'ok' ? 'check' : 'info') =>
  `<div class="note ${cls}">${icon(ic)}<span>${esc(text)}</span></div>`;

function batchCardHTML(item) {
  const s = batchStats(item);
  const incoming = item.dir === 'in';
  const busy = !s.settled && !item.removed;
  const closeAct = busy && !incoming ? 'cancel' : 'dismiss';
  const closeLabel = closeAct === 'cancel' ? 'Cancel transfer' : incoming && busy ? 'Decline' : 'Dismiss';
  const shown = item.expanded ? item.files : item.files.slice(0, VISIBLE_FILES);
  const hiddenCount = item.files.length - shown.length;

  let toggle = '';
  if (hiddenCount > 0) toggle = `<button class="link more" type="button" data-act="more">Show ${hiddenCount} more</button>`;
  else if (item.expanded && item.files.length > VISIBLE_FILES) toggle = '<button class="link more" type="button" data-act="more">Show less</button>';

  return `
    <header class="card-head">
      ${avatarHTML(item.peerDevice, item.peerId, 'sm')}
      <div class="card-title">
        <strong><span class="dir-tag ${incoming ? 'in' : 'out'}">${incoming ? 'From' : 'To'}</span> ${esc(item.peerName)}</strong>
        <span>${plural(s.n, 'file')} · ${fmtBytes(s.total)} · ${fmtTime(item.createdAt)}</span>
      </div>
      <button class="icon-btn" type="button" data-act="${closeAct}" title="${closeLabel}" aria-label="${closeLabel}">${icon('close')}</button>
    </header>
    <div class="progress" data-progress ${busy ? '' : 'hidden'}>
      <div class="bar"><i></i></div>
      <div class="progress-text"><span data-ptext></span><span data-ppct></span></div>
      ${!incoming && IS_MOBILE ? '<div class="progress-tip">Keep Beam open on screen until it finishes.</div>' : ''}
    </div>
    ${busy ? '' : batchNote(item, s)}
    <ul class="files">${shown.map((f) => fileRowHTML(item, f)).join('')}</ul>
    ${toggle}
    ${busy ? '' : batchActions(item, s)}`;
}

function batchNote(item, s) {
  if (item.removed) return note(item.removedText || 'Transfer closed');
  if (item.dir === 'in') {
    if (s.failed === s.n) return note('Transfer failed', 'err');
    const tail = s.failed ? ` · ${s.failed} failed` : '';
    if (item.files.some((f) => f.saved)) return note(`Saved to ${state.saveDir || 'Downloads'}${tail}`, 'ok', 'folder');
    return note(`Ready to download${tail}`, s.failed ? 'err' : 'ok');
  }
  if (s.failed) return note(`${plural(s.failed, 'file')} failed to send`, 'err');
  if (item.saveToHost) return note(`Saved on ${item.peerName}`, 'ok');
  const downloaded = item.files.filter((f) => f.downloaded).length;
  if (downloaded === s.n) return note(`Downloaded by ${item.peerName}`, 'ok');
  return note(downloaded ? `Delivered · ${downloaded} of ${s.n} downloaded` : 'Delivered · waiting for them to download', 'ok');
}

function batchActions(item, s) {
  const buttons = [];
  if (item.dir === 'in' && !item.removed) {
    if (state.isHost && item.files.some((f) => f.saved)) {
      buttons.push(`<button class="btn ghost sm" type="button" data-act="reveal">${icon('folder')}Show in folder</button>`);
    } else if (s.ready > 1) {
      buttons.push(`<a class="btn sm" href="/api/zip/${item.id}" download>${icon('download')}Download all (.zip)</a>`);
    } else if (s.ready === 1) {
      const f = item.files.find((x) => x.status === 'ready');
      buttons.push(`<a class="btn sm" href="/api/file/${f.id}" download="${esc(f.name)}">${icon('download')}Download</a>`);
    }
  }
  if (item.dir === 'out' && !item.removed && !item.sending && item.files.some((f) => f.status === 'failed' && f.blob)) {
    buttons.push(`<button class="btn ghost sm" type="button" data-act="retry">${icon('retry')}Retry failed</button>`);
  }
  return buttons.length ? `<div class="card-actions">${buttons.join('')}</div>` : '';
}

function fileStatus(item, f) {
  const size = fmtBytes(f.size);
  if (f.status === 'pending') return { text: `${size} · waiting`, cls: '' };
  if (f.status === 'uploading') {
    const got = (item.dir === 'out' ? f.sent : f.received) || 0;
    return { text: `${fmtBytes(got)} of ${size}`, cls: '' };
  }
  if (f.status === 'failed') return { text: `${size} · failed`, cls: 'err' };
  if (item.dir === 'in') return { text: f.saved ? `${size} · saved` : size, cls: '' };
  return { text: `${size} · ${f.downloaded ? 'downloaded' : item.saveToHost ? 'saved' : 'sent'}`, cls: 'ok' };
}

function fileRowHTML(item, f) {
  const kind = fileKind(f);
  const url = `/api/file/${f.id}`;
  const incoming = item.dir === 'in';
  const ready = f.status === 'ready' && !item.removed;

  let thumb = '';
  if (kind === 'image') {
    if (!incoming && f.thumb) thumb = `<img src="${f.thumb}" alt="">`;
    else if (incoming && ready && f.size < 40e6) thumb = `<img src="${url}?inline=1" alt="" loading="lazy">`;
  }

  let actions = '';
  if (incoming && ready) {
    if (canOpen(f)) actions += `<a class="icon-btn" href="${url}?inline=1" target="_blank" rel="noopener" title="Open" aria-label="Open ${esc(f.name)}">${icon('open')}</a>`;
    if (f.saved && state.isHost) actions += `<button class="icon-btn" type="button" data-act="reveal" data-file="${f.id}" title="Show in folder" aria-label="Show ${esc(f.name)} in folder">${icon('folder')}</button>`;
    else actions += `<a class="icon-btn" href="${url}" download="${esc(f.name)}" title="Download" aria-label="Download ${esc(f.name)}">${icon('download')}</a>`;
  }

  const { text, cls } = fileStatus(item, f);
  return `
    <li class="file" data-file="${f.id}">
      <div class="thumb">${icon(kind)}${thumb}</div>
      <div class="file-meta">
        <span class="file-name" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="file-sub ${cls}" data-sub>${esc(text)}</span>
      </div>
      ${actions ? `<div class="file-actions">${actions}</div>` : ''}
    </li>`;
}

function updateProgress(item) {
  const el = document.getElementById(`item-${item.id}`);
  if (!el) return;
  const s = batchStats(item);
  const pct = s.total ? Math.min(100, (s.done / s.total) * 100) : s.settled ? 100 : 0;
  const done = s.settled || item.removed;
  if (item.dir === 'out') setPeerProgress(item.peerId, done ? null : pct);
  if (done) return;

  // Speed over the last few seconds.
  const now = Date.now();
  item.samples = (item.samples || []).filter(([t]) => now - t < 5000);
  item.samples.push([now, s.done]);
  const [t0, b0] = item.samples[0];
  const speed = now - t0 > 500 ? (s.done - b0) / ((now - t0) / 1000) : 0;

  const index = Math.min(s.n, s.ready + s.failed + (s.active ? 1 : 0));
  let text;
  if (item.dir === 'out') text = s.n > 1 ? `Sending ${index} of ${s.n}` : 'Sending';
  else if (!s.done && !s.active) text = 'Waiting for sender…';
  else text = s.n > 1 ? `Receiving ${index} of ${s.n}` : 'Receiving';
  if (speed > 0) {
    text += ` · ${fmtBytes(speed)}/s`;
    const left = (s.total - s.done) / speed;
    if (left >= 1) text += ` · ${fmtDuration(left)} left`;
  }

  const bar = el.querySelector('[data-progress] .bar i');
  if (bar) bar.style.width = `${pct}%`;
  const ptext = el.querySelector('[data-ptext]');
  if (ptext) ptext.textContent = text;
  const ppct = el.querySelector('[data-ppct]');
  if (ppct) ppct.textContent = `${Math.floor(pct)}%`;
  if (s.active) {
    const sub = el.querySelector(`[data-file="${s.active.id}"] [data-sub]`);
    if (sub) sub.textContent = fileStatus(item, s.active).text;
  }
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function textCardHTML(item) {
  const incoming = item.dir === 'in';
  const trimmed = item.text.trim();
  const isLink = /^https?:\/\/\S+$/i.test(trimmed);
  return `
    <header class="card-head">
      ${avatarHTML(item.peerDevice, item.peerId, 'sm')}
      <div class="card-title">
        <strong><span class="dir-tag ${incoming ? 'in' : 'out'}">${incoming ? 'From' : 'To'}</span> ${esc(item.peerName)}</strong>
        <span>Text · ${fmtTime(item.createdAt)}</span>
      </div>
      <button class="icon-btn" type="button" data-act="dismiss" title="Dismiss" aria-label="Dismiss">${icon('close')}</button>
    </header>
    <div class="text-body">${linkify(item.text)}</div>
    <div class="card-actions">
      <button class="btn ghost sm" type="button" data-act="copy">${icon('copy')}Copy</button>
      ${isLink ? `<a class="btn ghost sm" href="${esc(trimmed)}" target="_blank" rel="noopener noreferrer">${icon('open')}Open link</a>` : ''}
    </div>`;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  // The Clipboard API is unavailable over plain http on a phone.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function dismissItem(item) {
  removeItem(item);
  if (item.kind === 'batch' && item.dir === 'in') {
    api(`/api/batch/${item.id}?by=${encodeURIComponent(state.id)}`, null, 'DELETE').catch(() => {});
  }
}

function cancelItem(item) {
  item.removed = true;
  item.removedText = 'Cancelled';
  if (item.xhr) item.xhr.abort();
  api(`/api/batch/${item.id}?by=${encodeURIComponent(state.id)}`, null, 'DELETE').catch(() => {});
  renderCard(item);
}

els.feed.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  const card = btn && btn.closest('.card');
  const item = card && state.items.get(card.dataset.id);
  if (!item) return;
  const act = btn.dataset.act;

  if (act === 'dismiss') dismissItem(item);
  else if (act === 'cancel') cancelItem(item);
  else if (act === 'more') {
    item.expanded = !item.expanded;
    renderCard(item);
  } else if (act === 'retry') {
    runUploads(item, item.files.filter((f) => f.status === 'failed' && f.blob));
  } else if (act === 'copy') {
    const ok = await copyText(item.text);
    toast(ok ? 'Copied' : 'Could not copy — select the text instead', ok ? 'ok' : 'error');
  } else if (act === 'reveal') {
    const fileId = btn.dataset.file || (item.files.find((f) => f.saved) || {}).id;
    api('/api/reveal', { fileId }).catch((err) => toast(err.message, 'error'));
  }
});

els.clearBtn.addEventListener('click', () => {
  for (const item of Array.from(state.items.values())) {
    const active = item.kind === 'batch' && !item.removed && (item.sending || !batchStats(item).settled);
    if (!active) dismissItem(item);
  }
});

/* ---------------------------------------------------------------- connect panel & QR */

let infoPromise = null;
const getInfo = () => (infoPromise ||= api('/api/info', null, 'GET').catch((err) => { infoPromise = null; throw err; }));

let qrLib = null;
function loadQR() {
  qrLib ||= new Promise((resolve, reject) => {
    if (window.qrcode) return resolve(window.qrcode);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR unavailable')));
    s.onerror = () => { qrLib = null; reject(new Error('QR unavailable')); };
    document.head.appendChild(s);
  });
  return qrLib;
}

async function renderQR(box, text) {
  try {
    const qrcode = await loadQR();
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    box.innerHTML = `<img src="${qr.createDataURL(8, 0)}" alt="QR code for ${esc(text)}">`;
  } catch {
    box.innerHTML = '<div class="qr-missing">QR code needs internet on this computer. Type the address below on your iPhone instead.</div>';
  }
}

function connectHTML() {
  const showQR = !IS_MOBILE;
  return `
    <div class="connect">
      ${showQR ? '<div class="qr" data-qr><span class="spinner"></span></div>' : `<div class="empty-ic">${icon('wifi')}</div>`}
      <h3>${showQR ? 'Connect your iPhone' : 'Open Beam on another device'}</h3>
      <p>${showQR
        ? 'Join the same Wi-Fi, then point the iPhone Camera at this code — or type the address in Safari.'
        : 'On a computer or phone using this Wi-Fi, open this address in the browser.'}</p>
      <div class="urls" data-urls><span class="spinner"></span></div>
      ${showQR ? '<ol class="steps"><li>Scan the code and tap the link</li><li>Your iPhone shows up here in the room</li><li>Tap a device to send photos, videos and files</li></ol>' : ''}
    </div>`;
}

async function fillConnect(root, withFirewallTip) {
  const qrBox = root.querySelector('[data-qr]');
  const urlBox = root.querySelector('[data-urls]');
  let info;
  try {
    info = await getInfo();
  } catch {
    urlBox.innerHTML = '<p>Could not read the network address.</p>';
    return;
  }
  if (!info.urls.length) {
    if (qrBox) qrBox.remove();
    urlBox.innerHTML = '<p>No Wi-Fi network found on the computer running Beam. Connect it to Wi-Fi and restart Beam.</p>';
    return;
  }
  urlBox.innerHTML = info.urls
    .map((u, i) => `<button class="url${i ? '' : ' active'}" type="button" data-url="${esc(u.url)}" title="${esc(u.name)}">${esc(u.url.replace('http://', ''))}</button>`)
    .join('');
  if (info.urls.length > 1 && qrBox) {
    urlBox.insertAdjacentHTML('afterend', '<p class="url-hint">Several networks found. If one does not open, tap another address.</p>');
  }
  if (withFirewallTip && state.isHost) {
    root.querySelector('.connect').insertAdjacentHTML(
      'beforeend',
      '<p class="fw-tip"><strong>iPhone can’t open it?</strong> Make sure Windows Firewall allows Node.js on your network. When Windows asks, click <em>Allow</em>. Also set the Wi-Fi network to <em>Private</em> in Windows Settings.</p>',
    );
  }
  const pick = (url) => {
    $$('.url', urlBox).forEach((b) => b.classList.toggle('active', b.dataset.url === url));
    if (qrBox) renderQR(qrBox, url);
  };
  urlBox.addEventListener('click', (e) => {
    const b = e.target.closest('.url');
    if (b) pick(b.dataset.url);
  });
  pick(info.urls[0].url);
}

let emptyMode = null;
function renderFeedEmpty() {
  els.clearBtn.hidden = state.items.size === 0;
  const mode = state.items.size ? 'none' : !state.peersLoaded ? 'loading' : state.peers.length ? 'idle' : 'connect';
  if (mode === emptyMode) return;
  emptyMode = mode;
  const box = els.feedEmpty;
  box.hidden = mode === 'none' || mode === 'loading';
  if (mode === 'idle') {
    box.innerHTML = `
      <div class="empty-ic">${icon('send')}</div>
      <h3>Ready to share</h3>
      <p>${IS_TOUCH ? 'Tap' : 'Click'} a device to send photos, videos, files or text. Everything stays on your Wi-Fi.</p>`;
  } else if (mode === 'connect') {
    box.innerHTML = connectHTML();
    fillConnect(box, false);
  }
}

$('#connectBtn').addEventListener('click', () => {
  const body = $('#connectBody');
  body.innerHTML = connectHTML();
  fillConnect(body, true);
  openModal('connectModal');
});

/* ---------------------------------------------------------------- modals */

function openModal(id) {
  const m = document.getElementById(id);
  clearTimeout(m._timer);
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add('open'));
  const focus = m.querySelector('[autofocus]');
  if (focus && !IS_TOUCH) setTimeout(() => focus.focus(), 60);
}

function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.remove('open');
  m._timer = setTimeout(() => { m.hidden = true; }, 220);
}

for (const overlay of $$('.overlay')) {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) closeModal(overlay.id);
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = $$('.overlay.open').pop();
  if (open) closeModal(open.id);
});

/* ---------------------------------------------------------------- start */

renderMe();
renderPeers();
renderFeedEmpty();
connect();
