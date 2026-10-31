// ที่เก็บข้อมูลแบบ OneDrive (Microsoft 365 / บัญชี Microsoft ส่วนตัว) ผ่าน Microsoft Graph
//
// โครงสร้างในโฟลเดอร์หลัก (เช่น OneDrive ของผู้ดูแล/ProjectTracker):
//   _data/settings.json             ค่ากลางของระบบ
//   _data/project-<รหัส>.json        ข้อมูลโครงการละ 1 ไฟล์ { project, boq, updates, files, subs, reqs }
//   <รหัส ชื่อโครงการ>/<หมวดเอกสาร>/   ไฟล์เอกสารของโครงการ
//
// - การบันทึกทุกครั้งอ่านไฟล์ล่าสุด แก้ แล้วเขียนกลับพร้อม eTag (If-Match) ถ้ามีคนบันทึกโครงการเดียวกันพร้อมกัน
//   Graph จะตอบ 412 แล้วระบบอ่านใหม่และบันทึกซ้ำอัตโนมัติ — ข้อมูลของอีกคนไม่หาย
// - ผู้ดูแลระบบ = เจ้าของ OneDrive ที่เก็บโฟลเดอร์หลัก (และรายชื่อผู้ดูแลในหน้าตั้งค่า)
// - สมาชิกเข้าถึงได้เมื่อเจ้าของแชร์โฟลเดอร์หลักให้ (ปุ่ม "ให้สิทธิ์เข้าถึงโฟลเดอร์" ในหน้าตั้งค่า)
import { conf } from '../config.js';
import { msAuth } from './ms-auth.js';
import { uid } from '../ui.js';
import { safeName } from './sharepoint.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const DATA_DIR = '_data';
const SETTINGS = 'settings.json';
const docName = (pid) => `project-${safeName(pid)}.json`;
const SIMPLE_MAX = 60 * 1048576;
const CHUNK = 320 * 1024 * 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
const emptyDoc = (project = null) => ({ v: 1, project, boq: [], updates: [], files: [], subs: [], reqs: [] });
const TABLES = ['boq', 'updates', 'files', 'subs', 'reqs'];

/** โฟลเดอร์ของผู้อื่น (ลิงก์หรือระบุ drive) ต้องใช้สิทธิ์ .All */
const isShared = () => /^https?:\/\//i.test(String(conf.od.folder || '').trim()) || !!conf.od.driveId;
export function odScopes() {
  return [isShared() ? 'Files.ReadWrite.All' : 'Files.ReadWrite', ...(conf.od.mail ? ['Mail.Send'] : [])];
}

const shareId = (url) => {
  const bytes = new TextEncoder().encode(url.trim());
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return `u!${btoa(s).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
};

// ---------- เรียก Microsoft Graph ----------
function errorFrom(status, j, fallback = '') {
  const code = j?.error?.code || `http_${status}`;
  const msg = j?.error?.message || fallback;
  let text;
  if (status === 403 || code === 'accessDenied') {
    text = 'ไม่มีสิทธิ์ในโฟลเดอร์ OneDrive นี้ — ให้เจ้าของโฟลเดอร์แชร์ให้บัญชีของคุณ (สิทธิ์แก้ไขสำหรับผู้ที่ต้องบันทึกข้อมูล)';
  } else if (status === 404) {
    text = `ไม่พบข้อมูลใน OneDrive${msg ? ` (${msg})` : ''}`;
  } else if (status === 507 || code === 'quotaLimitReached') {
    text = 'พื้นที่ OneDrive ของเจ้าของโฟลเดอร์เต็ม';
  } else {
    text = `OneDrive ตอบกลับข้อผิดพลาด (${code})${msg ? `: ${msg}` : ''}`;
  }
  const e = new Error(text);
  e.status = status;
  e.code = code;
  return e;
}

async function gfetch(path, { method = 'GET', body, headers = {}, tries = 4, raw = false } = {}) {
  reset(); // ให้ตัวลงชื่อเข้าใช้ตรงกับแอปของตัวเชื่อมนี้เสมอ
  const url = /^https?:/.test(path) ? path : GRAPH + path;
  for (let attempt = 0; ; attempt++) {
    const token = await msAuth.token(odScopes());
    const h = { Authorization: `Bearer ${token}`, ...headers };
    let b = body;
    if (b && typeof b === 'object' && !(b instanceof Blob) && !(b instanceof ArrayBuffer)) {
      b = JSON.stringify(b);
      h['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: b });
    } catch {
      if (attempt < tries - 1) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error('เชื่อมต่อ Microsoft Graph ไม่ได้ — ตรวจสอบอินเทอร์เน็ต');
    }
    if (res.status === 401 && attempt === 0) { msAuth.invalidateAccess(); continue; }
    if ([429, 503, 504].includes(res.status) && attempt < tries - 1) {
      const ra = +res.headers.get('Retry-After') || 2 ** attempt;
      await sleep(Math.min(ra, 30) * 1000);
      continue;
    }
    if (!res.ok) throw errorFrom(res.status, await res.json().catch(() => null), res.statusText);
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    if (raw) return text;
    if (!text) return null;
    return (res.headers.get('content-type') || '').includes('json') ? JSON.parse(text) : text;
  }
}

function xhr(method, url, body, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers || {})) x.setRequestHeader(k, v);
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => resolve({ status: x.status, text: x.responseText, retryAfter: [429, 503].includes(x.status) ? x.getResponseHeader('Retry-After') : null });
    x.onerror = () => reject(new Error('อัปโหลดไม่สำเร็จ — การเชื่อมต่อขาดหรือถูกปิดกั้น'));
    x.send(body);
  });
}

// ---------- สถานะการเชื่อมต่อ ----------
// root = โฟลเดอร์หลัก, data = โฟลเดอร์ _data, docs = ไฟล์ข้อมูลโครงการที่อ่านล่าสุด (ตาม eTag), owner = เราเป็นเจ้าของ OneDrive นี้
const S = { key: '', root: null, data: null, docs: new Map(), settingsTag: null, folders: new Map(), where: new Map() };

function reset() {
  const key = JSON.stringify([conf.od.tenant, conf.od.clientId, conf.od.folder, conf.od.driveId, conf.od.itemId]);
  if (S.key !== key) Object.assign(S, { key, root: null, data: null, docs: new Map(), settingsTag: null, folders: new Map(), where: new Map() });
  msAuth.configure({ tenant: conf.od.tenant || 'organizations', clientId: conf.od.clientId });
}

async function ensureChild(driveId, parentId, name) {
  const n = safeName(name);
  try {
    return await gfetch(`/drives/${driveId}/items/${parentId}:/${encodeURIComponent(n)}`);
  } catch (e) { if (e.status !== 404) throw e; }
  try {
    return await gfetch(`/drives/${driveId}/items/${parentId}/children`, {
      method: 'POST', body: { name: n, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
    });
  } catch (e) {
    if (e.status === 409) return gfetch(`/drives/${driveId}/items/${parentId}:/${encodeURIComponent(n)}`);
    throw e;
  }
}

async function myDriveId() {
  try { return (await gfetch('/me/drive?$select=id'))?.id || ''; } catch { return ''; }
}

async function resolveRoot() {
  const f = String(conf.od.folder || 'ProjectTracker').trim();
  let it;
  if (conf.od.driveId && conf.od.itemId) {
    it = await gfetch(`/drives/${encodeURIComponent(conf.od.driveId)}/items/${encodeURIComponent(conf.od.itemId)}`);
  } else if (/^https?:\/\//i.test(f)) {
    it = await gfetch(`/shares/${shareId(f)}/driveItem`);
  } else {
    const drive = await gfetch('/me/drive?$select=id,webUrl');
    let cur = await gfetch(`/drives/${drive.id}/root`);
    for (const seg of f.split('/').map((s) => s.trim()).filter(Boolean)) cur = await ensureChild(drive.id, cur.id, seg);
    return { driveId: drive.id, id: cur.id, webUrl: cur.webUrl, name: cur.name, owner: true };
  }
  if (!it?.folder) throw new Error('ลิงก์ที่ระบุไม่ใช่โฟลเดอร์ OneDrive');
  const driveId = it.parentReference?.driveId || conf.od.driveId;
  const mine = await myDriveId();
  return { driveId, id: it.id, webUrl: it.webUrl, name: it.name, owner: !!mine && mine === driveId };
}

async function ready() {
  reset();
  if (!conf.od.clientId) throw new Error('ยังตั้งค่า OneDrive ไม่ครบ — ไปที่หน้าตั้งค่า');
  if (!S.root) S.root = await resolveRoot();
  if (!S.data) S.data = await ensureChild(S.root.driveId, S.root.id, DATA_DIR);
}

// ---------- ไฟล์ข้อมูล JSON ----------
const dataPath = (name) => `/drives/${S.root.driveId}/items/${S.data.id}:/${encodeURIComponent(name)}`;

async function download(item) {
  const url = item['@microsoft.graph.downloadUrl'];
  if (url) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return r.text();
  }
  return gfetch(`/drives/${S.root.driveId}/items/${item.id}/content`, { raw: true });
}

/** อ่านไฟล์ข้อมูล: { doc, eTag } — ไม่มีไฟล์คืน { doc: null, eTag: null } */
async function readJson(name) {
  let meta;
  try { meta = await gfetch(dataPath(name)); } catch (e) { if (e.status === 404) return { doc: null, eTag: null }; throw e; }
  const cached = S.docs.get(name);
  if (cached && cached.eTag === meta.eTag) return { doc: structuredClone(cached.doc), eTag: meta.eTag };
  const doc = parse(await download(meta));
  if (!doc) throw new Error(`ไฟล์ข้อมูล ${name} ใน OneDrive เสียหาย — กู้คืนจากประวัติเวอร์ชันของไฟล์ใน OneDrive`);
  S.docs.set(name, { eTag: meta.eTag, doc: structuredClone(doc) });
  return { doc, eTag: meta.eTag };
}

/** เขียนไฟล์ข้อมูล: eTag = เวอร์ชันที่อ่านมา (ถ้ามีคนแก้ก่อน Graph ตอบ 412) — ไม่มี eTag = สร้างใหม่ (มีอยู่แล้วตอบ 409) */
async function writeJson(name, doc, eTag) {
  const q = eTag ? '' : '?@microsoft.graph.conflictBehavior=fail';
  const it = await gfetch(`${dataPath(name)}:/content${q}`, {
    method: 'PUT', body: JSON.stringify(doc), headers: { 'Content-Type': 'application/json', ...(eTag ? { 'If-Match': eTag } : {}) },
  });
  S.docs.set(name, { eTag: it?.eTag || '', doc: structuredClone(doc) });
  return it;
}

/** อ่าน-แก้-เขียน พร้อมลองใหม่เมื่อชนกับผู้อื่น */
async function mutateFile(name, fn, { create = null } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await readJson(name);
    const doc = cur.doc || (create ? create() : null);
    if (!doc) throw Object.assign(new Error('ไม่พบข้อมูลโครงการนี้ใน OneDrive (อาจถูกลบไปแล้ว) — กด "ดึงข้อมูลล่าสุด"'), { status: 404 });
    const result = await fn(doc);
    try {
      await writeJson(name, doc, cur.eTag);
      return result;
    } catch (e) {
      if (e.status !== 412 && e.status !== 409) throw e;
      S.docs.delete(name);
      await sleep(250 * (attempt + 1) + Math.random() * 400);
    }
  }
  throw new Error('มีผู้อื่นบันทึกข้อมูลโครงการนี้พร้อมกัน — ลองใหม่อีกครั้ง');
}
const mutate = (pid, fn, opts) => mutateFile(docName(pid), fn, opts);

function upsertIn(arr, rec) {
  const i = arr.findIndex((x) => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}
function remember(pid, doc) {
  for (const t of TABLES) for (const r of doc[t] || []) S.where.set(`${t}:${r.id}`, pid);
}
/** หาโครงการของระเบียน (ใช้กับคำสั่งที่ส่งมาแค่รหัส) */
async function projectOf(table, id, hint) {
  if (hint) return hint;
  let pid = S.where.get(`${table}:${id}`);
  if (!pid) { await odBackend.getAll(); pid = S.where.get(`${table}:${id}`); }
  if (!pid) throw new Error('ไม่พบข้อมูลนี้ใน OneDrive (อาจถูกลบไปแล้ว)');
  return pid;
}

// ---------- โฟลเดอร์เอกสาร ----------
async function projectFolder(p) {
  const ref = String(p.folderId || '');
  if (ref.includes('|')) {
    const [driveId, id] = ref.split('|');
    return { driveId, id, webUrl: p.folderUrl || '' };
  }
  if (/^https?:\/\//i.test(ref)) {
    const it = await gfetch(`/shares/${shareId(ref)}/driveItem`);
    if (!it?.folder) throw new Error('ลิงก์ที่ระบุไม่ใช่โฟลเดอร์ OneDrive');
    return { driveId: it.parentReference?.driveId, id: it.id, webUrl: it.webUrl };
  }
  const f = await ensureChild(S.root.driveId, S.root.id, `${p.code ? `${p.code} ` : ''}${p.name || 'โครงการ'}`);
  return { driveId: S.root.driveId, id: f.id, webUrl: f.webUrl };
}
async function categoryFolder(p, category) {
  const pf = await projectFolder(p);
  const key = `${pf.driveId}|${pf.id}|${category}`;
  if (!S.folders.has(key)) {
    let f;
    try {
      f = await ensureChild(pf.driveId, pf.id, category || 'อื่นๆ');
    } catch (e) {
      if (e.status !== 404 || !String(p.folderId).includes('|')) throw e;
      const nf = await projectFolder({ ...p, folderId: '' });
      p.folderId = `${nf.driveId}|${nf.id}`;
      p.folderUrl = nf.webUrl;
      await mutate(p.id, (doc) => { doc.project = { ...doc.project, folderId: p.folderId, folderUrl: p.folderUrl }; });
      return categoryFolder(p, category);
    }
    S.folders.set(key, { driveId: pf.driveId, id: f.id, webUrl: f.webUrl });
  }
  return S.folders.get(key);
}

async function putSimple(folder, name, file, onProgress) {
  const url = `${GRAPH}/drives/${folder.driveId}/items/${folder.id}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await msAuth.token(odScopes());
    const r = await xhr('PUT', url, file, { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/octet-stream' }, onProgress);
    if (r.status === 401 && attempt === 0) { msAuth.invalidateAccess(); continue; }
    if ([429, 503, 504].includes(r.status) && attempt < 3) { await sleep((+r.retryAfter || 2 ** attempt) * 1000); continue; }
    if (r.status >= 200 && r.status < 300) return parse(r.text);
    throw errorFrom(r.status, parse(r.text));
  }
  throw new Error('อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
}
async function putSession(folder, name, file, onProgress) {
  const sess = await gfetch(`/drives/${folder.driveId}/items/${folder.id}:/${encodeURIComponent(name)}:/createUploadSession`, {
    method: 'POST', body: { item: { '@microsoft.graph.conflictBehavior': 'rename' } },
  });
  let item = null;
  for (let start = 0; start < file.size; start += CHUNK) {
    const end = Math.min(start + CHUNK, file.size);
    let r = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        r = await xhr('PUT', sess.uploadUrl, file.slice(start, end), { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
          (f) => onProgress?.((start + f * (end - start)) / file.size));
        if (r.status < 500 && r.status !== 429) break;
      } catch (e) {
        if (attempt === 3) throw new Error('อัปโหลดไฟล์ใหญ่ไม่สำเร็จ — ลองใหม่ หรือวางไฟล์ในโฟลเดอร์ OneDrive ของโครงการแล้วกด "ดึงไฟล์จาก OneDrive"');
      }
      await sleep(1500 * (attempt + 1));
    }
    if (!r || r.status >= 400) throw errorFrom(r?.status || 0, parse(r?.text));
    if (r.status === 200 || r.status === 201) item = parse(r.text);
  }
  return item;
}
function fileRec(it, { projectId, category, note = '', updateId = '', subId = '', by = conf.user, byEmail = '', at, id = '' }) {
  return {
    id: id || uid('F'), projectId, category, name: it.name, mime: it.file?.mimeType || 'application/octet-stream',
    size: it.size || 0, driveId: it.id, spDrive: it.parentReference?.driveId || '', url: it.webUrl || '',
    note, updateId, subId, uploadedBy: by, uploadedByEmail: byEmail, uploadedAt: at || new Date().toISOString(),
  };
}

// ---------- ตัวเชื่อม ----------
export const odBackend = {
  id: 'onedrive',
  label: 'OneDrive',
  fileHost: 'OneDrive',
  maxUploadMB: 2048,
  direct: true,

  configured() { return !!(conf.od.clientId && (conf.od.folder || conf.od.itemId)); },
  account() { reset(); return msAuth.account(); },
  signOut() { msAuth.signOut(); },
  /** เป็นเจ้าของ OneDrive ที่เก็บโฟลเดอร์หลัก (= ผู้ดูแลระบบโดยอัตโนมัติ) */
  isDriveOwner() { return !!S.root?.owner; },
  rootRef() { return S.root ? { driveId: S.root.driveId, itemId: S.root.id, webUrl: S.root.webUrl, name: S.root.name } : null; },

  /** ตรวจการเชื่อมต่อ: ลงชื่อเข้าใช้ → หาโฟลเดอร์หลัก → มีไฟล์ข้อมูลหรือยัง */
  async probe() {
    reset();
    S.root = null; S.data = null;
    S.root = await resolveRoot();
    let data = null;
    try { data = await gfetch(`/drives/${S.root.driveId}/items/${S.root.id}:/${DATA_DIR}`); } catch (e) { if (e.status !== 404) throw e; }
    return { root: S.root, ready: !!data, owner: S.root.owner, account: msAuth.account() };
  },

  /** สร้างโฟลเดอร์หลัก โฟลเดอร์ _data และไฟล์ค่ากลาง (ทำครั้งแรกโดยผู้ดูแล) */
  async setup(onProgress = () => {}) {
    onProgress('กำลังเตรียมโฟลเดอร์ใน OneDrive…');
    await ready();
    const cur = await readJson(SETTINGS);
    if (!cur.doc) {
      const me = msAuth.account();
      await writeJson(SETTINGS, { admins: me?.username ? [String(me.username).toLowerCase()] : [] }, null).catch((e) => { if (e.status !== 409) throw e; });
    }
    return { root: S.root };
  },

  async getAll() {
    await ready();
    const items = [];
    let url = `/drives/${S.root.driveId}/items/${S.data.id}/children?$top=999`;
    while (url) {
      const r = await gfetch(url);
      items.push(...(r.value || []).filter((x) => x.file && /\.json$/i.test(x.name)));
      url = r['@odata.nextLink'];
    }
    const load = async (it) => {
      const c = S.docs.get(it.name);
      if (c && c.eTag === it.eTag) return { name: it.name, doc: c.doc };
      const doc = parse(await download(it));
      if (doc) S.docs.set(it.name, { eTag: it.eTag, doc: structuredClone(doc) });
      return { name: it.name, doc };
    };
    const docs = [];
    for (let i = 0; i < items.length; i += 6) docs.push(...await Promise.all(items.slice(i, i + 6).map(load)));
    const out = { projects: [], boq: [], updates: [], files: [], subs: [], reqs: [], settings: {} };
    S.where.clear();
    for (const { name, doc } of docs) {
      if (!doc) continue;
      if (name === SETTINGS) { out.settings = doc; S.settingsTag = items.find((x) => x.name === SETTINGS)?.eTag || null; continue; }
      if (!doc.project?.id) continue;
      out.projects.push(doc.project);
      for (const t of TABLES) out[t].push(...(doc[t] || []).map((r) => ({ ...r, projectId: doc.project.id })));
      remember(doc.project.id, doc);
    }
    out.meta = {
      rootFolderUrl: S.root.webUrl, maxUploadMB: this.maxUploadMB, driveOwner: S.root.owner, folderName: S.root.name,
    };
    return out;
  },

  async saveProject(p, { by = conf.user } = {}) {
    await ready();
    const now = new Date().toISOString();
    const rec = { ...p, id: p.id || uid('P'), createdAt: p.createdAt || now, createdBy: p.createdBy || by, updatedAt: now };
    const f = await projectFolder(rec);
    rec.folderId = `${f.driveId}|${f.id}`;
    rec.folderUrl = f.webUrl || rec.folderUrl || '';
    await mutate(rec.id, (doc) => { doc.project = rec; }, { create: () => emptyDoc(rec) });
    return rec;
  },

  async deleteProject(id) {
    await ready();
    try {
      const meta = await gfetch(dataPath(docName(id)));
      await gfetch(`/drives/${S.root.driveId}/items/${meta.id}`, { method: 'DELETE' });
    } catch (e) { if (e.status !== 404) throw e; }
    S.docs.delete(docName(id));
    return { id };
  },

  async saveBoq(pid, items) {
    await ready();
    await mutate(pid, (doc) => { doc.boq = items; });
    return items;
  },

  async saveUpdate(u) {
    await ready();
    const now = new Date().toISOString();
    const rec = { ...u, id: u.id || uid('U'), createdAt: u.createdAt || now, createdBy: u.createdBy || conf.user, updatedAt: now };
    await mutate(rec.projectId, (doc) => { upsertIn(doc.updates, rec); remember(rec.projectId, doc); });
    return rec;
  },

  async deleteUpdate(id, pidHint) {
    await ready();
    const pid = await projectOf('updates', id, pidHint);
    await mutate(pid, (doc) => { doc.updates = doc.updates.filter((x) => x.id !== id); });
    return { id };
  },

  async uploadFile({ project, projectId, category, file, note = '', updateId = '', subId = '', by, byEmail = '', id = '' }, onProgress) {
    await ready();
    const folder = await categoryFolder(project, category);
    const name = safeName(file.name);
    const it = file.size <= SIMPLE_MAX ? await putSimple(folder, name, file, onProgress) : await putSession(folder, name, file, onProgress);
    if (!it?.id) throw new Error('อัปโหลดไม่สำเร็จ — OneDrive ไม่ส่งข้อมูลไฟล์กลับมา');
    if (!it.parentReference?.driveId) it.parentReference = { ...(it.parentReference || {}), driveId: folder.driveId };
    const rec = fileRec(it, { projectId, category, note, updateId, subId, by: by || conf.user, byEmail, id });
    rec.mime = it.file?.mimeType || file.type || rec.mime;
    await mutate(projectId, (doc) => { upsertIn(doc.files, rec); remember(projectId, doc); });
    return rec;
  },

  async addLink({ projectId, category, name, url, note = '', by, byEmail = '' }) {
    await ready();
    const rec = {
      id: uid('F'), projectId, category, name, url, mime: 'link', size: 0, driveId: '', note,
      uploadedBy: by || conf.user, uploadedByEmail: byEmail, uploadedAt: new Date().toISOString(),
    };
    await mutate(projectId, (doc) => { doc.files.push(rec); remember(projectId, doc); });
    return rec;
  },

  async updateFile(id, changes, { old, project } = {}) {
    await ready();
    const rec = { ...old, ...changes };
    if (old?.driveId && old.spDrive) {
      const patch = {};
      if (changes.name && changes.name !== old.name) patch.name = safeName(changes.name);
      if (changes.category && changes.category !== old.category && project) {
        const f = await categoryFolder(project, changes.category);
        patch.parentReference = { id: f.id };
      }
      if (Object.keys(patch).length) {
        const it = await gfetch(`/drives/${old.spDrive}/items/${old.driveId}`, { method: 'PATCH', body: { ...patch, '@microsoft.graph.conflictBehavior': 'rename' } });
        rec.name = it?.name || rec.name;
        rec.url = it?.webUrl || rec.url;
      }
    }
    const pid = rec.projectId || await projectOf('files', id);
    await mutate(pid, (doc) => { upsertIn(doc.files, rec); });
    return rec;
  },

  async deleteFile(id, rec) {
    await ready();
    if (rec?.driveId && rec.spDrive) {
      try { await gfetch(`/drives/${rec.spDrive}/items/${rec.driveId}`, { method: 'DELETE' }); } catch (e) { if (e.status !== 404) throw e; }
    }
    const pid = rec?.projectId || await projectOf('files', id);
    await mutate(pid, (doc) => { doc.files = doc.files.filter((x) => x.id !== id); });
    return { id };
  },

  /** เพิ่มไฟล์ที่วางไว้ในโฟลเดอร์ OneDrive ของโครงการโดยตรงเข้าระบบ */
  async scanDrive(pid, project, { by = conf.user } = {}) {
    await ready();
    const root = await projectFolder(project);
    const known = new Set(((await readJson(docName(pid))).doc?.files || []).map((f) => f.driveId).filter(Boolean));
    const catByFolder = new Map((project.docCategories || []).map((c) => [safeName(c), c]));
    const added = [];
    const walk = async (folderId, category, depth) => {
      let url = `/drives/${root.driveId}/items/${folderId}/children?$top=200`;
      while (url) {
        const r = await gfetch(url);
        for (const it of r.value || []) {
          if (it.folder) {
            if (depth < 3) await walk(it.id, depth === 0 ? (catByFolder.get(it.name) || it.name) : category, depth + 1);
          } else if (it.file && !known.has(it.id)) {
            known.add(it.id);
            if (!it.parentReference?.driveId) it.parentReference = { ...(it.parentReference || {}), driveId: root.driveId };
            added.push(fileRec(it, { projectId: pid, category, by: `${it.createdBy?.user?.displayName || by} (ดึงจาก OneDrive)`, at: it.createdDateTime }));
          }
        }
        url = r['@odata.nextLink'];
      }
    };
    await walk(root.id, 'อื่นๆ', 0);
    if (added.length) await mutate(pid, (doc) => { doc.files.push(...added); remember(pid, doc); });
    return added;
  },

  async saveSettings(s) {
    await ready();
    await mutateFile(SETTINGS, (doc) => { for (const k of Object.keys(doc)) delete doc[k]; Object.assign(doc, s); }, { create: () => ({}) });
    return s;
  },

  /** นำเข้าข้อมูลทั้งชุด (ย้ายจากโหมดทดลอง / กู้คืนไฟล์สำรอง) */
  async importAll(d, onProgress = () => {}) {
    await ready();
    const projectIds = {};
    let i = 0;
    for (const p of d.projects || []) {
      onProgress(`กำลังบันทึกโครงการ ${++i}/${d.projects.length}: ${p.name}`);
      const rec = await this.saveProject({ ...p, folderId: '', folderUrl: '' });
      projectIds[p.id] = rec.id;
      const of = (t) => (d[t] || []).filter((x) => x.projectId === p.id).map((x) => ({ ...x, projectId: rec.id }));
      await mutate(rec.id, (doc) => {
        doc.boq = of('boq');
        doc.updates = of('updates');
        doc.files = of('files').filter((f) => f.mime === 'link');
        doc.subs = of('subs');
        doc.reqs = of('reqs');
        remember(rec.id, doc);
      });
    }
    if (d.settings && Object.keys(d.settings).length) await this.saveSettings({ ...(await this.currentSettings()), ...d.settings });
    return { projectIds };
  },
  async currentSettings() { await ready(); return (await readJson(SETTINGS)).doc || {}; },

  // ---------- เรื่องขออนุมัติ ----------
  async subsOfProject(pid) {
    await ready();
    return ((await readJson(docName(pid))).doc?.subs || []);
  },
  async getSub(id, pidHint) {
    await ready();
    const pid = await projectOf('subs', id, pidHint).catch(() => '');
    if (!pid) return null;
    return ((await readJson(docName(pid))).doc?.subs || []).find((s) => s.id === id) || null;
  },
  /** บันทึกเรื่อง — prev = updatedAt ของฉบับที่ใช้ตรวจสิทธิ์ (ถ้ามีคนทำรายการก่อน ให้ผู้ใช้โหลดใหม่ ไม่เขียนทับ) */
  async saveSub(sub, { isNew = false, prev = undefined } = {}) {
    await ready();
    const R = globalThis.PTRules;
    await mutate(sub.projectId, (doc) => {
      const cur = doc.subs.find((x) => x.id === sub.id);
      if (isNew) {
        if (cur) throw new Error('เรื่องนี้ถูกบันทึกไปแล้ว');
        if (doc.subs.some((x) => +x.no === +sub.no)) sub.no = R ? R.nextNo(doc.subs, sub.projectId) : doc.subs.length + 1;
      } else if (prev !== undefined && cur && cur.updatedAt !== prev) {
        throw Object.assign(new Error('เรื่องนี้มีการเปลี่ยนแปลงโดยผู้อื่นระหว่างที่คุณดูอยู่ — กด "ดึงข้อมูลล่าสุด" แล้วทำรายการอีกครั้ง'), { code: 'conflict' });
      }
      upsertIn(doc.subs, sub);
      remember(sub.projectId, doc);
    });
    return sub;
  },
  async saveRequired(pid, items) {
    await ready();
    await mutate(pid, (doc) => { doc.reqs = items; });
    return items;
  },

  // ---------- แชร์โฟลเดอร์ให้สมาชิก ----------
  /** list = [{ email, write }] — ส่งคำเชิญของ OneDrive (ต้องเป็นเจ้าของหรือมีสิทธิ์แชร์โฟลเดอร์หลัก) */
  async shareRoot(list, { notify = false, message = '' } = {}) {
    await ready();
    const res = { write: [], read: [] };
    for (const write of [true, false]) {
      const emails = list.filter((x) => !!x.write === write).map((x) => x.email);
      if (!emails.length) continue;
      for (let i = 0; i < emails.length; i += 20) {
        const chunk = emails.slice(i, i + 20);
        await gfetch(`/drives/${S.root.driveId}/items/${S.root.id}/invite`, {
          method: 'POST',
          body: {
            recipients: chunk.map((email) => ({ email })), roles: [write ? 'write' : 'read'],
            requireSignIn: true, sendInvitation: !!notify, ...(notify && message ? { message: message.slice(0, 2000) } : {}),
          },
        });
        res[write ? 'write' : 'read'].push(...chunk);
      }
    }
    return res;
  },

  async sendMail({ to, subject, html, kind }) {
    const rcpt = (list) => list.map((address) => ({ emailAddress: { address } }));
    const message = { subject, body: { contentType: 'HTML', content: html } };
    if (kind === 'info' && to.length > 1) message.bccRecipients = rcpt(to);
    else message.toRecipients = rcpt(to);
    await gfetch('/me/sendMail', { method: 'POST', body: { message, saveToSentItems: false } });
  },

  async fileUrls(rec) {
    if (!rec.driveId || !rec.spDrive) return { open: rec.url, preview: rec.url, download: rec.url };
    const base = `/drives/${rec.spDrive}/items/${rec.driveId}`;
    const [pv, it] = await Promise.all([
      gfetch(`${base}/preview`, { method: 'POST', body: {} }).catch(() => null),
      gfetch(`${base}?$select=id,webUrl,@microsoft.graph.downloadUrl`).catch(() => null),
    ]);
    const get = pv?.getUrl ? `${pv.getUrl}${pv.getUrl.includes('?') ? '&' : '?'}nb=true` : '';
    return { preview: get || it?.webUrl || rec.url, download: it?.['@microsoft.graph.downloadUrl'] || rec.url, open: it?.webUrl || rec.url };
  },

  async thumbUrl(rec) {
    if (!rec.driveId || !rec.spDrive) return '';
    try {
      const r = await gfetch(`/drives/${rec.spDrive}/items/${rec.driveId}/thumbnails`);
      return r.value?.[0]?.medium?.url || r.value?.[0]?.small?.url || '';
    } catch { return ''; }
  },
};
