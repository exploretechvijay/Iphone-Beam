#!/usr/bin/env node
'use strict';

/*
 * Beam — share files between devices on the same Wi-Fi.
 *
 * Every browser that opens this server joins one "room". Files are streamed
 * from the sender to this server and then to the receiver, so nothing ever
 * leaves your local network. Files sent to the computer running the server
 * are written straight into its Downloads/Beam folder.
 *
 * No dependencies: only Node.js built-ins.
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { spawn } = require('child_process');

const BASE_PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMP_DIR = path.join(os.tmpdir(), 'beam-uploads');
const SAVE_DIR = process.env.BEAM_DIR || path.join(os.homedir(), 'Downloads', 'Beam');
const BATCH_TTL = 6 * 60 * 60 * 1000; // received files wait this long to be downloaded
const LEAVE_GRACE = 8000; // phones drop the connection for a moment when backgrounded
const MAX_FILES_PER_BATCH = 5000;
const DEVICES = new Set(['iphone', 'ipad', 'android', 'windows', 'mac', 'linux', 'other']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Used when a browser does not report a file's type.
const EXT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
  pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip',
};
// Types a browser may display inline. Anything else is always sent as a download.
const INLINE_TYPES = /^(image\/(jpeg|png|gif|webp|heic|heif|avif|bmp)|video\/|audio\/|application\/pdf$|text\/plain)/;
// Types that could run script if a browser rendered them.
const ACTIVE_TYPES = /html|xml|svg|javascript|ecmascript/i;

const peers = new Map(); // id -> { id, name, device, isHost, res, queue, leaveTimer }
const batches = new Map(); // id -> { id, from, to, ..., files: [file] }
const files = new Map(); // id -> { id, batchId, name, size, type, status, received, crc, path, saved, downloads }

let port = BASE_PORT;

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const uid = () => crypto.randomBytes(12).toString('hex');

const crc32 = typeof zlib.crc32 === 'function' ? zlib.crc32 : crc32Fallback;
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32Fallback(buf, prev = 0) {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${units[i]}`;
}

function cleanLabel(value, fallback) {
  const v = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return v || fallback;
}

// Make a name that is safe to write on Windows, macOS and Linux.
function safeFileName(name) {
  let n = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (n.length > 180) {
    const ext = path.extname(n).slice(0, 20);
    n = n.slice(0, 180 - ext.length) + ext;
  }
  if (!n || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `file${n ? `_${n}` : ''}`;
  return n;
}

function typeOf(f) {
  return f.type || EXT_TYPES[path.extname(f.name).slice(1).toLowerCase()] || 'application/octet-stream';
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const candidate = path.join(dir, i ? `${base} (${i})${ext}` : name);
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
}

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address });
    }
  }
  // Put the Wi-Fi adapter first and virtual adapters (WSL, Hyper-V, VPNs…) last.
  const rank = (n) => (/wi-?fi|wlan|wireless/i.test(n) ? 0 : /virtual|vethernet|vmware|vbox|docker|wsl|hyper-v|bluetooth|tailscale|zerotier|vpn/i.test(n) ? 2 : 1);
  return out.sort((a, b) => rank(a.name) - rank(b.name));
}

function remoteIp(req) {
  const ip = req.socket.remoteAddress || '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

// True when the request comes from the computer this server runs on.
function isHostRequest(req) {
  const ip = remoteIp(req);
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return lanAddresses().some((a) => a.address === ip);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Message is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- room state

const publicPeer = (p) => ({ id: p.id, name: p.name, device: p.device, isHost: p.isHost });

const publicFile = (f) => ({
  id: f.id,
  name: f.name,
  size: f.size,
  type: f.type,
  status: f.status,
  received: f.received,
  saved: f.saved,
  downloaded: f.downloads > 0,
});

const publicBatch = (b) => ({
  id: b.id,
  from: b.from,
  to: b.to,
  fromName: b.fromName,
  fromDevice: b.fromDevice,
  toName: b.toName,
  toDevice: b.toDevice,
  saveToHost: b.saveToHost,
  createdAt: b.createdAt,
  files: b.files.map(publicFile),
});

function send(peerId, event) {
  const p = peers.get(peerId);
  if (!p) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  if (p.res) p.res.write(data);
  else if (event.type !== 'peers' && p.queue.length < 500) p.queue.push(data); // delivered on reconnect
}

function broadcastPeers() {
  const list = [...peers.values()].map(publicPeer);
  for (const p of peers.values()) send(p.id, { type: 'peers', peers: list });
}

function peerLeft(id) {
  peers.delete(id);
  // Files the sender never got to upload will not arrive now.
  for (const b of batches.values()) {
    if (b.from !== id) continue;
    for (const f of b.files) {
      if (f.status !== 'pending') continue;
      f.status = 'failed';
      send(b.to, { type: 'file', batchId: b.id, file: publicFile(f) });
    }
  }
  broadcastPeers();
}

function removeBatch(b, reason) {
  batches.delete(b.id);
  for (const f of b.files) {
    files.delete(f.id);
    if (f.req) f.req.destroy();
    if (f.path && !f.saved) fsp.rm(f.path, { force: true }).catch(() => {});
  }
  const event = { type: 'batch-removed', batchId: b.id, reason };
  send(b.from, event);
  send(b.to, event);
}

function markDownloaded(list) {
  const byBatch = new Map();
  for (const f of list) {
    f.downloads++;
    if (!byBatch.has(f.batchId)) byBatch.set(f.batchId, []);
    byBatch.get(f.batchId).push(f.id);
  }
  for (const [batchId, fileIds] of byBatch) {
    const b = batches.get(batchId);
    if (b) send(b.from, { type: 'downloaded', batchId, fileIds });
  }
}

// ---------------------------------------------------------------- handlers

function handleEvents(req, res, q) {
  const id = String(q.get('id') || '');
  if (!/^[\w-]{6,64}$/.test(id)) throw new HttpError(400, 'Invalid device id');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Padding makes some mobile browsers flush the stream immediately.
  res.write(`:${' '.repeat(2048)}\nretry: 2000\n\n`);
  req.socket.setNoDelay(true);

  let p = peers.get(id);
  if (p) {
    clearTimeout(p.leaveTimer);
    if (p.res && p.res !== res) {
      // Same id opened in a second tab: tell the older tab to pick a new id.
      p.res.write(`data: ${JSON.stringify({ type: 'replaced' })}\n\n`);
      p.res.end();
    }
  } else {
    p = { id, queue: [] };
    peers.set(id, p);
  }
  const device = q.get('device');
  Object.assign(p, {
    name: cleanLabel(q.get('name'), 'Device'),
    device: DEVICES.has(device) ? device : 'other',
    isHost: isHostRequest(req),
    res,
    leaveTimer: null,
  });

  const pending = [...batches.values()].filter((b) => b.to === id).map(publicBatch);
  send(id, { type: 'hello', self: publicPeer(p), saveDir: p.isHost ? SAVE_DIR : null, batches: pending });
  for (const data of p.queue.splice(0)) res.write(data);
  broadcastPeers();

  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    if (p.res !== res) return;
    p.res = null;
    p.leaveTimer = setTimeout(() => peerLeft(id), LEAVE_GRACE);
  });
}

async function createBatch(req, res) {
  const body = await readJson(req);
  const sender = peers.get(body.from);
  const target = peers.get(body.to);
  if (!sender) throw new HttpError(409, 'You are not connected — reload the page');
  if (!target) throw new HttpError(404, 'That device is no longer connected');
  const list = Array.isArray(body.files) ? body.files : [];
  if (!list.length) throw new HttpError(400, 'No files selected');
  if (list.length > MAX_FILES_PER_BATCH) throw new HttpError(400, `Send at most ${MAX_FILES_PER_BATCH} files at a time`);

  const batch = {
    id: uid(),
    from: sender.id,
    to: target.id,
    fromName: sender.name,
    fromDevice: sender.device,
    toName: target.name,
    toDevice: target.device,
    saveToHost: !!target.isHost,
    createdAt: Date.now(),
    lastProgress: 0,
    files: [],
  };
  for (const item of list) {
    const file = {
      id: uid(),
      batchId: batch.id,
      name: safeFileName(item && item.name),
      size: Math.max(0, Math.floor(Number(item && item.size) || 0)),
      type: String((item && item.type) || '').slice(0, 100),
      status: 'pending',
      received: 0,
      crc: 0,
      path: null,
      saved: false,
      downloads: 0,
      req: null,
    };
    files.set(file.id, file);
    batch.files.push(file);
  }
  batches.set(batch.id, batch);

  const data = publicBatch(batch);
  send(target.id, { type: 'batch', batch: data });
  const total = batch.files.reduce((sum, f) => sum + f.size, 0);
  console.log(`  -> ${sender.name} is sending ${batch.files.length} file(s), ${fmtBytes(total)}, to ${target.name}`);
  json(res, 200, data);
}

function emitProgress(batch, file) {
  const now = Date.now();
  if (now - batch.lastProgress < 250) return;
  batch.lastProgress = now;
  send(batch.to, { type: 'progress', batchId: batch.id, fileId: file.id, received: file.received });
}

async function handleUpload(req, res, fileId, q) {
  const file = files.get(fileId);
  const batch = file && batches.get(file.batchId);
  if (!file || !batch || batch.from !== q.get('from')) throw new HttpError(404, 'Transfer not found');
  if (file.status === 'uploading' || file.status === 'ready') throw new HttpError(409, 'File already sent');

  let tmpPath;
  if (batch.saveToHost) {
    await fsp.mkdir(SAVE_DIR, { recursive: true });
    tmpPath = path.join(SAVE_DIR, `.beam-${file.id}.part`);
  } else {
    tmpPath = path.join(TEMP_DIR, `${file.id}.part`);
  }

  file.status = 'uploading';
  file.received = 0;
  file.req = req;
  batch.lastProgress = 0; // let the receiver see the new file start right away
  let crc = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      file.received += chunk.length;
      if (file.received > file.size) return cb(new Error('Received more data than expected'));
      crc = crc32(chunk, crc);
      emitProgress(batch, file);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(req, meter, fs.createWriteStream(tmpPath));
    if (file.received !== file.size) throw new Error('Upload was interrupted');
    if (!batches.has(batch.id)) throw new Error('Transfer was cancelled');
    let finalPath;
    if (batch.saveToHost) {
      finalPath = await uniquePath(SAVE_DIR, file.name);
      file.saved = true;
    } else {
      finalPath = path.join(TEMP_DIR, file.id);
    }
    await fsp.rename(tmpPath, finalPath);
    Object.assign(file, { path: finalPath, crc: crc >>> 0, status: 'ready', req: null });
    const event = { type: 'file', batchId: batch.id, file: publicFile(file) };
    send(batch.to, event);
    send(batch.from, event);
    console.log(`  OK ${file.name} (${fmtBytes(file.size)}) ${file.saved ? `saved to ${finalPath}` : `ready for ${batch.toName}`}`);
    json(res, 200, { ok: true });
  } catch (err) {
    fsp.rm(tmpPath, { force: true }).catch(() => {});
    file.status = 'failed';
    file.req = null;
    if (batches.has(batch.id)) {
      const event = { type: 'file', batchId: batch.id, file: publicFile(file) };
      send(batch.to, event);
      send(batch.from, event);
    }
    if (!res.headersSent && !res.destroyed) json(res, 400, { error: err.message });
  }
}

async function handleFile(req, res, fileId, q) {
  const f = files.get(fileId);
  if (!f || f.status !== 'ready') throw new HttpError(404, 'File not found');
  let stat;
  try {
    stat = await fsp.stat(f.path);
  } catch {
    throw new HttpError(410, 'File is no longer available');
  }

  const type = typeOf(f);
  const inline = q.get('inline') === '1' && INLINE_TYPES.test(type);
  const headers = {
    'Content-Type': ACTIVE_TYPES.test(type) ? 'application/octet-stream' : type,
    'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', f.name),
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  };

  // Range requests let Safari play videos and resume interrupted downloads.
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && stat.size > 0) {
    if (range[1] === '') {
      start = Math.max(0, stat.size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== '') end = Math.min(end, Number(range[2]));
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = stat.size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  if (stat.size === 0) {
    res.end();
  } else {
    try {
      await pipeline(fs.createReadStream(f.path, { start, end }), res);
    } catch {
      return; // the browser cancelled the download
    }
  }
  if (status === 200 && !inline) markDownloaded([f]);
}

// ---- zip (store only, no compression: photos and videos are already compressed)

function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function zipLocalHeader(e, t) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0x0800, 6); // names are UTF-8
  h.writeUInt16LE(0, 8); // stored
  h.writeUInt16LE(t.time, 10);
  h.writeUInt16LE(t.date, 12);
  h.writeUInt32LE(e.f.crc, 14);
  h.writeUInt32LE(e.f.size, 18);
  h.writeUInt32LE(e.f.size, 22);
  h.writeUInt16LE(e.name.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, e.name]);
}

function zipCentralDirectory(entries, t, cdOffset, cdSize) {
  const parts = [];
  for (const e of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4); // version made by
    h.writeUInt16LE(20, 6); // version needed
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(t.time, 12);
    h.writeUInt16LE(t.date, 14);
    h.writeUInt32LE(e.f.crc, 16);
    h.writeUInt32LE(e.f.size, 20);
    h.writeUInt32LE(e.f.size, 24);
    h.writeUInt16LE(e.name.length, 28);
    h.writeUInt32LE(e.offset, 42);
    parts.push(h, e.name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdOffset, 16);
  parts.push(end);
  return Buffer.concat(parts);
}

async function handleZip(req, res, batchId) {
  const b = batches.get(batchId);
  if (!b) throw new HttpError(404, 'Transfer not found');

  const used = new Set();
  const entries = [];
  for (const f of b.files) {
    if (f.status !== 'ready') continue;
    const stat = await fsp.stat(f.path).catch(() => null);
    if (!stat || stat.size !== f.size) continue; // moved or edited since it arrived
    const ext = path.extname(f.name);
    const base = f.name.slice(0, f.name.length - ext.length);
    let name = f.name;
    for (let i = 1; used.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
    used.add(name.toLowerCase());
    entries.push({ f, name: Buffer.from(name, 'utf8'), offset: 0 });
  }
  if (!entries.length) throw new HttpError(404, 'Nothing to download yet');

  let offset = 0;
  for (const e of entries) {
    e.offset = offset;
    offset += 30 + e.name.length + e.f.size;
  }
  const cdOffset = offset;
  const cdSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = cdOffset + cdSize + 22;
  if (total > 0xffffffff || entries.length > 0xffff) {
    throw new HttpError(413, 'Too large for one zip — download the files one by one');
  }

  const t = dosDateTime(new Date());
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': total,
    'Content-Disposition': contentDisposition('attachment', safeFileName(`Beam from ${b.fromName} ${stamp}.zip`)),
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  try {
    await pipeline(async function* () {
      for (const e of entries) {
        yield zipLocalHeader(e, t);
        yield* fs.createReadStream(e.f.path);
      }
      yield zipCentralDirectory(entries, t, cdOffset, cdSize);
    }, res);
  } catch {
    return;
  }
  markDownloaded(entries.map((e) => e.f));
}

async function handleText(req, res) {
  const body = await readJson(req, 512 * 1024);
  const sender = peers.get(body.from);
  const target = peers.get(body.to);
  if (!sender) throw new HttpError(409, 'You are not connected — reload the page');
  if (!target) throw new HttpError(404, 'That device is no longer connected');
  const text = String(body.text ?? '').slice(0, 100000);
  if (!text.trim()) throw new HttpError(400, 'Message is empty');
  const msg = { type: 'text', id: uid(), from: sender.id, fromName: sender.name, fromDevice: sender.device, text, at: Date.now() };
  send(target.id, msg);
  json(res, 200, { id: msg.id, at: msg.at });
}

async function handleReveal(req, res) {
  if (!isHostRequest(req)) throw new HttpError(403, 'Only available on the computer running Beam');
  const { fileId } = await readJson(req);
  const f = fileId ? files.get(fileId) : null;
  const target = f && f.saved && f.path ? f.path : null;
  await fsp.mkdir(SAVE_DIR, { recursive: true });

  let cmd;
  let args;
  const opts = { detached: true, stdio: 'ignore' };
  if (process.platform === 'win32') {
    cmd = 'explorer.exe';
    args = [target ? `/select,"${target}"` : `"${SAVE_DIR}"`];
    opts.windowsVerbatimArguments = true;
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = target ? ['-R', target] : [SAVE_DIR];
  } else {
    cmd = 'xdg-open';
    args = [SAVE_DIR];
  }
  const child = spawn(cmd, args, opts);
  child.on('error', () => {});
  child.unref();
  json(res, 200, { ok: true });
}

function handleInfo(res) {
  json(res, 200, {
    port,
    saveDir: SAVE_DIR,
    urls: lanAddresses().map((a) => ({ name: a.name, url: `http://${a.address}:${port}` })),
  });
}

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || !stat.isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(fs.createReadStream(filePath), res);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const q = url.searchParams;
  const m = req.method;
  let match;

  if (p === '/api/events' && m === 'GET') return handleEvents(req, res, q);
  if (p === '/api/info' && m === 'GET') return handleInfo(res);
  if (p === '/api/batch' && m === 'POST') return createBatch(req, res);
  if (p === '/api/text' && m === 'POST') return handleText(req, res);
  if (p === '/api/reveal' && m === 'POST') return handleReveal(req, res);
  if ((match = /^\/api\/batch\/(\w+)$/.exec(p)) && m === 'DELETE') {
    const b = batches.get(match[1]);
    if (!b) return json(res, 200, { ok: true });
    const by = q.get('by');
    if (by !== b.from && by !== b.to) throw new HttpError(403, 'Not your transfer');
    removeBatch(b, by === b.from ? 'cancelled' : 'dismissed');
    return json(res, 200, { ok: true });
  }
  if ((match = /^\/api\/upload\/(\w+)$/.exec(p)) && (m === 'PUT' || m === 'POST')) return handleUpload(req, res, match[1], q);
  if ((match = /^\/api\/file\/(\w+)$/.exec(p)) && (m === 'GET' || m === 'HEAD')) return handleFile(req, res, match[1], q);
  if ((match = /^\/api\/zip\/(\w+)$/.exec(p)) && (m === 'GET' || m === 'HEAD')) return handleZip(req, res, match[1]);
  if (p.startsWith('/api/')) throw new HttpError(404, 'Not found');
  if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  return serveStatic(req, res, p);
}

// ---------------------------------------------------------------- startup

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { error: err.message || 'Server error' });
    else res.destroy();
  });
});
server.requestTimeout = 0; // big uploads over Wi-Fi can take a long time
server.headersTimeout = 60000;

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function printBanner() {
  const addrs = lanAddresses();
  const lines = ['', '  Beam is running - share files over your Wi-Fi', ''];
  lines.push(`  On this computer   http://localhost:${port}`);
  if (addrs.length) {
    addrs.forEach((a, i) => {
      lines.push(`  ${i ? '                 ' : 'On your iPhone   '}  http://${a.address}:${port}   (${a.name})`);
    });
  } else {
    lines.push('  No network found - connect this computer to Wi-Fi and restart.');
  }
  lines.push(`  Received files     ${SAVE_DIR}`);
  lines.push('');
  lines.push('  Keep this window open while sharing. Press Ctrl+C to stop.');
  lines.push('  iPhone cannot connect? Allow Node.js through Windows Firewall (see README).');
  lines.push('');
  console.log(lines.join('\n'));
}

function listen(attempts = 10) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) {
      console.log(`  Port ${port} is busy, trying ${port + 1}...`);
      port++;
      listen(attempts - 1);
    } else {
      console.error(`  Could not start: ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    server.removeAllListeners('error');
    server.on('error', (err) => console.error(err));
    printBanner();
    if (process.argv.includes('--open')) openBrowser(`http://localhost:${port}`);
  });
}

// Forget transfers nobody downloaded. Files already saved on this computer stay.
setInterval(() => {
  const cutoff = Date.now() - BATCH_TTL;
  for (const b of batches.values()) if (b.createdAt < cutoff) removeBatch(b, 'expired');
}, 10 * 60 * 1000).unref();

fs.rmSync(TEMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TEMP_DIR, { recursive: true });
listen();
