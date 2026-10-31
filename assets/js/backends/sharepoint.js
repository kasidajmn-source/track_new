// ที่เก็บข้อมูลแบบ Microsoft 365: SharePoint List (ข้อมูล) + Document Library (ไฟล์) ผ่าน Microsoft Graph
//
// รายการ (List) ที่ระบบสร้างในไซต์: PT_Projects, PT_BOQ, PT_Updates, PT_Files, PT_Settings
// และตั้งแต่ 1.0.1: PT_Submissions (เรื่องขออนุมัติ), PT_Required (เอกสารที่ต้องส่ง)
// แต่ละแถวมีคอลัมน์ Title (ชื่อที่อ่านได้), RecId (รหัสในระบบ), ProjectId และ Data (ข้อมูล JSON ทั้งระเบียน)
// ไฟล์เก็บใน <คลังเอกสาร>/<โฟลเดอร์หลัก>/<รหัส ชื่อโครงการ>/<หมวดเอกสาร>/
import { conf } from '../config.js';
import { msAuth } from './ms-auth.js';
import { uid } from '../ui.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const SP_LISTS = {
  projects: 'PT_Projects', boq: 'PT_BOQ', updates: 'PT_Updates', files: 'PT_Files', settings: 'PT_Settings',
  subs: 'PT_Submissions', reqs: 'PT_Required',
};
const TABLES = Object.keys(SP_LISTS);
// รายการที่เพิ่มใน 1.0.1 — ไซต์ที่ตั้งค่าไว้ก่อนยังใช้งานส่วนเดิมได้ จนกว่าผู้ดูแลจะกด "อัปเดตโครงสร้าง"
const OPTIONAL = ['subs', 'reqs'];
const CORE = TABLES.filter((t) => !OPTIONAL.includes(t));
const SIMPLE_MAX = 60 * 1048576;     // อัปโหลดครั้งเดียวได้ถึง 250 MB แต่ใช้ upload session เมื่อเกิน 60 MB เพื่อความเสถียร
const CHUNK = 320 * 1024 * 20;       // ชิ้นละ 6.25 MiB (ต้องเป็นผลคูณของ 320 KiB)
const PREFER = { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function spScopes(manage = false) {
  const mail = conf.sp.mail ? ['Mail.Send'] : [];
  if (conf.sp.scopeMode === 'selected') return ['Sites.Selected', ...mail];
  return manage ? ['Sites.ReadWrite.All', 'Sites.Manage.All', ...mail] : ['Sites.ReadWrite.All', ...mail];
}

/** ชื่อไฟล์/โฟลเดอร์ที่ SharePoint รับได้ */
export function safeName(n) {
  return String(n || 'ไม่มีชื่อ')
    .replace(/["*:<>?/\\|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.~]+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 180) || 'ไม่มีชื่อ';
}

const odataStr = (s) => String(s).replace(/'/g, "''");
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
    text = 'ไม่มีสิทธิ์ใน SharePoint — ตรวจสอบว่าบัญชีของคุณมีสิทธิ์แก้ไขในไซต์ และผู้ดูแลระบบอนุมัติสิทธิ์ของแอปแล้ว';
  } else if (status === 404) {
    text = `ไม่พบข้อมูลใน SharePoint${msg ? ` (${msg})` : ''}`;
  } else if (status === 507 || code === 'quotaLimitReached') {
    text = 'พื้นที่เก็บข้อมูลของไซต์ SharePoint เต็ม';
  } else {
    text = `SharePoint ตอบกลับข้อผิดพลาด (${code})${msg ? `: ${msg}` : ''}`;
  }
  const e = new Error(text);
  e.status = status;
  e.code = code;
  return e;
}

async function gfetch(path, { method = 'GET', body, headers = {}, manage = false, tries = 4 } = {}) {
  reset(); // ให้ตัวลงชื่อเข้าใช้ตรงกับแอปของตัวเชื่อมนี้เสมอ
  const url = /^https?:/.test(path) ? path : GRAPH + path;
  for (let attempt = 0; ; attempt++) {
    const token = await msAuth.token(spScopes(manage), {
      reason: manage ? 'การสร้างรายการข้อมูลในไซต์ต้องใช้สิทธิ์จัดการไซต์ กรุณาลงชื่อเข้าใช้เพื่อยืนยัน' : '',
    });
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
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!text) return null;
    return ct.includes('json') ? JSON.parse(text) : text;
  }
}

/** ส่งหลายคำสั่งพร้อมกันผ่าน $batch (ครั้งละ 20) — คืนผลตามลำดับที่ส่ง */
async function batch(reqs, onProgress) {
  const out = new Array(reqs.length);
  for (let i = 0; i < reqs.length; i += 20) {
    let chunk = reqs.slice(i, i + 20).map((r, k) => ({
      id: String(i + k), method: r.method, url: r.url,
      ...(r.body ? { body: r.body, headers: { 'Content-Type': 'application/json' } } : {}),
    }));
    for (let attempt = 0; chunk.length; attempt++) {
      const res = await gfetch('/$batch', { method: 'POST', body: { requests: chunk } });
      const again = [];
      let wait = 1;
      for (const r of res.responses || []) {
        if ([429, 503, 504].includes(r.status) && attempt < 5) {
          again.push(chunk.find((c) => c.id === r.id));
          wait = Math.max(wait, +(r.headers?.['Retry-After'] || r.headers?.['retry-after']) || 2 ** attempt);
        } else if (r.status >= 400 && !(r.status === 404 && reqs[+r.id].method === 'DELETE')) {
          throw errorFrom(r.status, r.body);
        } else out[+r.id] = r.body;
      }
      chunk = again;
      if (chunk.length) await sleep(Math.min(wait, 30) * 1000);
    }
    onProgress?.(Math.min(i + 20, reqs.length), reqs.length);
  }
  return out;
}

function xhr(method, url, body, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers || {})) x.setRequestHeader(k, v);
    if (onProgress) x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    // อ่าน Retry-After เฉพาะตอนถูกจำกัดอัตรา (header นี้อาจไม่ถูกเปิดให้อ่านข้ามโดเมน)
    x.onload = () => resolve({ status: x.status, text: x.responseText, retryAfter: [429, 503].includes(x.status) ? x.getResponseHeader('Retry-After') : null });
    x.onerror = () => reject(new Error('อัปโหลดไม่สำเร็จ — การเชื่อมต่อขาดหรือถูกปิดกั้น'));
    x.send(body);
  });
}
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

// ---------- สถานะการเชื่อมต่อ ----------
const S = { key: '', site: null, lists: {}, checked: false, root: null, ids: {}, folders: new Map() };

function reset() {
  const key = JSON.stringify([conf.sp.tenant, conf.sp.clientId, conf.sp.site, conf.sp.folder, conf.sp.scopeMode]);
  if (S.key !== key) Object.assign(S, { key, site: null, lists: {}, checked: false, root: null, ids: {}, folders: new Map() });
  msAuth.configure({ tenant: conf.sp.tenant, clientId: conf.sp.clientId });
}

async function resolveSite(siteUrl) {
  let u;
  try { u = new URL(String(siteUrl).trim()); } catch { throw new Error('URL ของไซต์ SharePoint ไม่ถูกต้อง เช่น https://องค์กร.sharepoint.com/sites/ชื่อไซต์'); }
  if (!/sharepoint\.(com|us|de|cn)$|sharepoint-mil\.us$/i.test(u.hostname) && !/\.sharepoint\./i.test(u.hostname)) {
    throw new Error('URL ต้องเป็นไซต์ SharePoint Online เช่น https://องค์กร.sharepoint.com/sites/ชื่อไซต์');
  }
  const m = decodeURIComponent(u.pathname).match(/^\/(sites|teams)\/[^/]+/i);
  const path = m ? m[0].split('/').map(encodeURIComponent).join('/') : '';
  const site = await gfetch(path ? `/sites/${u.hostname}:${path}` : `/sites/${u.hostname}`);
  return { id: site.id, webUrl: site.webUrl, name: site.displayName || site.name || '' };
}

async function findLists() {
  let url = `/sites/${S.site.id}/lists?$select=id,displayName,webUrl&$top=500`;
  const byName = {};
  while (url) {
    const r = await gfetch(url);
    for (const l of r.value || []) byName[l.displayName] = l;
    url = r['@odata.nextLink'];
  }
  S.lists = {};
  for (const t of TABLES) if (byName[SP_LISTS[t]]) S.lists[t] = { id: byName[SP_LISTS[t]].id, webUrl: byName[SP_LISTS[t]].webUrl };
  S.checked = true;
  return TABLES.filter((t) => !S.lists[t]);
}
const missingCore = () => CORE.filter((t) => !S.lists[t]);
const missingOptional = () => OPTIONAL.filter((t) => !S.lists[t]);
function needList(t) {
  if (S.lists[t]) return;
  const e = new Error('ไซต์ SharePoint ยังไม่มีรายการข้อมูลของเวอร์ชัน 1.0.1 — ให้ผู้ดูแลเปิดหน้าตั้งค่าแล้วกด "อัปเดตโครงสร้างข้อมูลในไซต์"');
  e.code = 'upgrade_required';
  throw e;
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

async function resolveShare(url) {
  const it = await gfetch(`/shares/${shareId(url)}/driveItem`);
  if (!it.folder) throw new Error('ลิงก์ที่ระบุไม่ใช่โฟลเดอร์');
  return { driveId: it.parentReference?.driveId, id: it.id, webUrl: it.webUrl };
}

async function resolveRoot() {
  const f = String(conf.sp.folder || 'ProjectTracker').trim();
  if (/^https?:\/\//i.test(f)) return resolveShare(f);
  const drive = await gfetch(`/sites/${S.site.id}/drive`);
  let cur = await gfetch(`/drives/${drive.id}/root`);
  for (const seg of f.split('/').map((s) => s.trim()).filter(Boolean)) cur = await ensureChild(drive.id, cur.id, seg);
  return { driveId: drive.id, id: cur.id, webUrl: cur.webUrl };
}

async function ready() {
  reset();
  if (!conf.sp.clientId || !conf.sp.site) throw new Error('ยังตั้งค่า SharePoint ไม่ครบ — ไปที่หน้าตั้งค่า');
  if (!S.site) S.site = await resolveSite(conf.sp.site);
  if (!S.checked || missingCore().length) {
    await findLists();
    const missing = missingCore();
    if (missing.length) {
      const e = new Error('ยังไม่ได้สร้างรายการข้อมูลในไซต์ SharePoint — ไปที่หน้าตั้งค่าแล้วกด "สร้างรายการข้อมูลในไซต์"');
      e.code = 'setup_required';
      e.missing = missing;
      throw e;
    }
  }
  if (!S.root) S.root = await resolveRoot();
  for (const t of TABLES) S.ids[t] = S.ids[t] || new Map();
}

// ---------- ระเบียนใน List ----------
const recId = (t, o) => (t === 'settings' ? o.key : o.id);
function fieldsFor(t, o) {
  const title = {
    projects: o.name, boq: o.desc, updates: `${o.date || ''} ${o.note || ''}`, files: o.name, settings: o.key,
    subs: `#${String(o.no || 0).padStart(3, '0')} ${o.title || ''}`, reqs: o.title,
  }[t];
  const data = JSON.stringify(o);
  if (data.length > 60000) throw new Error('ข้อมูลรายการนี้ยาวเกินที่ SharePoint รับได้ (60,000 ตัวอักษร)');
  return {
    Title: String(title || '').trim().slice(0, 250) || recId(t, o),
    RecId: recId(t, o),
    ProjectId: t === 'projects' ? o.id : (o.projectId || ''),
    Data: data,
  };
}
const itemsUrl = (t) => `/sites/${S.site.id}/lists/${S.lists[t].id}/items`;

async function readTable(t) {
  let url = `${itemsUrl(t)}?$expand=fields($select=RecId,Data)&$top=500`;
  const out = [];
  const ids = new Map();
  while (url) {
    const r = await gfetch(url);
    for (const it of r.value || []) {
      const o = parse(it.fields?.Data);
      if (!o) continue;
      const rid = it.fields?.RecId || recId(t, o);
      if (ids.has(rid)) { const i = out.findIndex((x) => recId(t, x) === rid); if (i >= 0) out.splice(i, 1); }
      ids.set(rid, it.id);
      out.push(o);
    }
    url = r['@odata.nextLink'];
  }
  S.ids[t] = ids;
  return out;
}

async function itemsByProject(t, pid) {
  // ระเบียนที่ไม่ผูกกับโครงการ (เช่น ค่าตั้งค่า) อ่านทั้งรายการ เพราะกรองค่าว่างใน SharePoint ไม่ได้
  let url = pid
    ? `${itemsUrl(t)}?$expand=fields($select=RecId,Data)&$filter=fields/ProjectId eq '${odataStr(pid)}'&$top=500`
    : `${itemsUrl(t)}?$expand=fields($select=RecId,Data)&$top=500`;
  const out = [];
  while (url) {
    const r = await gfetch(url, { headers: pid ? PREFER : {} });
    for (const it of r.value || []) out.push({ itemId: it.id, rid: it.fields?.RecId, data: it.fields?.Data || '' });
    url = r['@odata.nextLink'];
  }
  return out;
}

async function findItemId(t, rid) {
  const r = await gfetch(`${itemsUrl(t)}?$expand=fields($select=RecId)&$filter=fields/RecId eq '${odataStr(rid)}'&$top=1`, { headers: PREFER });
  const id = r.value?.[0]?.id;
  if (id) S.ids[t].set(rid, id);
  return id;
}

async function upsert(t, o, { isNew = false } = {}) {
  const rid = recId(t, o);
  const itemId = S.ids[t].get(rid) || (isNew ? null : await findItemId(t, rid));
  const fields = fieldsFor(t, o);
  if (itemId) {
    await gfetch(`${itemsUrl(t)}/${itemId}/fields`, { method: 'PATCH', body: fields });
  } else {
    const r = await gfetch(itemsUrl(t), { method: 'POST', body: { fields } });
    S.ids[t].set(rid, r.id);
  }
  return o;
}

async function remove(t, rid) {
  const itemId = S.ids[t].get(rid) || await findItemId(t, rid);
  if (itemId) {
    try { await gfetch(`${itemsUrl(t)}/${itemId}`, { method: 'DELETE' }); } catch (e) { if (e.status !== 404) throw e; }
  }
  S.ids[t].delete(rid);
}

/** บันทึกหลายระเบียนของตารางเดียว (สร้างใหม่หรือแก้ไข) ผ่าน $batch */
async function bulkUpsert(t, records, onProgress) {
  const byProject = new Map();
  for (const r of records) {
    const pid = t === 'projects' ? r.id : r.projectId || '';
    if (!byProject.has(pid)) byProject.set(pid, []);
    byProject.get(pid).push(r);
  }
  const reqs = [];
  for (const [pid, recs] of byProject) {
    const existing = new Map((await itemsByProject(t, pid)).map((x) => [x.rid, x]));
    for (const r of recs) {
      const f = fieldsFor(t, r);
      const ex = existing.get(recId(t, r));
      if (ex) { if (ex.data !== f.Data) reqs.push({ method: 'PATCH', url: `${itemsUrl(t)}/${ex.itemId}/fields`, body: f }); S.ids[t].set(recId(t, r), ex.itemId); }
      else reqs.push({ method: 'POST', url: itemsUrl(t), body: { fields: f }, rid: recId(t, r) });
    }
  }
  const res = await batch(reqs, onProgress);
  reqs.forEach((r, i) => { if (r.method === 'POST' && res[i]?.id) S.ids[t].set(r.rid, res[i].id); });
}

// ---------- โฟลเดอร์ ----------
async function projectFolder(p) {
  const ref = String(p.folderId || '');
  if (ref.includes('|')) {
    const [driveId, id] = ref.split('|');
    return { driveId, id, webUrl: p.folderUrl || '' };
  }
  if (/^https?:\/\//i.test(ref)) return resolveShare(ref);
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
      // โฟลเดอร์โครงการถูกลบใน SharePoint — สร้างใหม่ตามชื่อโครงการ
      const np = { ...p, folderId: '', folderUrl: '' };
      const nf = await projectFolder(np);
      p.folderId = `${nf.driveId}|${nf.id}`;
      p.folderUrl = nf.webUrl;
      await upsert('projects', p);
      return categoryFolder(p, category);
    }
    S.folders.set(key, { driveId: pf.driveId, id: f.id, webUrl: f.webUrl });
  }
  return S.folders.get(key);
}

async function putSimple(folder, name, file, onProgress) {
  const url = `${GRAPH}/drives/${folder.driveId}/items/${folder.id}:/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await msAuth.token(spScopes());
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
        // URL ของ upload session มีสิทธิ์ในตัว ห้ามส่ง Authorization header
        r = await xhr('PUT', sess.uploadUrl, file.slice(start, end), { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
          (f) => onProgress?.((start + f * (end - start)) / file.size));
        if (r.status < 500 && r.status !== 429) break;
      } catch (e) {
        if (attempt === 3) throw new Error('อัปโหลดไฟล์ใหญ่ไม่สำเร็จ — ลองใหม่ หรือวางไฟล์ในโฟลเดอร์ SharePoint ของโครงการแล้วกด "ดึงไฟล์จาก SharePoint"');
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

/** แทนที่ระเบียนทั้งหมดของโครงการในตารางนี้ด้วยชุดใหม่ (ใช้กับ BOQ และเอกสารที่ต้องส่ง) */
async function replaceProjectRows(t, pid, items, onProgress) {
  const existing = new Map((await itemsByProject(t, pid)).map((x) => [x.rid, x]));
  const reqs = [];
  for (const it of items) {
    const f = fieldsFor(t, it);
    const ex = existing.get(it.id);
    if (ex) {
      existing.delete(it.id);
      if (ex.data !== f.Data) reqs.push({ method: 'PATCH', url: `${itemsUrl(t)}/${ex.itemId}/fields`, body: f });
      S.ids[t].set(it.id, ex.itemId);
    } else reqs.push({ method: 'POST', url: itemsUrl(t), body: { fields: f }, rid: it.id });
  }
  for (const ex of existing.values()) { reqs.push({ method: 'DELETE', url: `${itemsUrl(t)}/${ex.itemId}` }); S.ids[t].delete(ex.rid); }
  const res = await batch(reqs, onProgress);
  reqs.forEach((r, i) => { if (r.method === 'POST' && res[i]?.id) S.ids[t].set(r.rid, res[i].id); });
  return items;
}

// ---------- ตัวเชื่อม ----------
export const spBackend = {
  id: 'sharepoint',
  label: 'SharePoint',
  fileHost: 'SharePoint',
  maxUploadMB: 2048,

  configured() { return !!(conf.sp.clientId && conf.sp.site); },
  account() { reset(); return msAuth.account(); },
  signOut() { msAuth.signOut(); },

  /** ตรวจการเชื่อมต่อ: ลงชื่อเข้าใช้ (ถ้าจำเป็น) → หาไซต์ → ตรวจว่ามีรายการข้อมูลครบหรือยัง */
  async probe() {
    reset();
    S.site = null;
    S.site = await resolveSite(conf.sp.site);
    await findLists();
    return { site: S.site, missing: missingCore(), upgrade: missingOptional(), account: msAuth.account() };
  },

  /** สร้างรายการข้อมูลและโฟลเดอร์หลักในไซต์ (ทำครั้งแรกครั้งเดียว) */
  async setup(onProgress = () => {}) {
    reset();
    if (!S.site) S.site = await resolveSite(conf.sp.site);
    const missing = await findLists();
    const cols = (indexed) => [
      { name: 'RecId', text: {}, indexed },
      { name: 'ProjectId', text: {}, indexed },
      { name: 'Data', text: { allowMultipleLines: true, textType: 'plain', linesForEditing: 6, appendChangesToExistingText: false } },
    ];
    for (const t of missing) {
      onProgress(`กำลังสร้างรายการ ${SP_LISTS[t]}…`);
      const body = (indexed) => ({
        displayName: SP_LISTS[t],
        description: 'ข้อมูลของระบบติดตามโครงการ — ห้ามแก้ไขหรือลบคอลัมน์ RecId, ProjectId, Data',
        columns: cols(indexed),
        list: { template: 'genericList' },
      });
      let l;
      try { l = await gfetch(`/sites/${S.site.id}/lists`, { method: 'POST', body: body(true), manage: true }); } catch (e) {
        if (e.status !== 400) throw e;
        l = await gfetch(`/sites/${S.site.id}/lists`, { method: 'POST', body: body(false), manage: true });
      }
      S.lists[t] = { id: l.id, webUrl: l.webUrl };
    }
    onProgress('กำลังเตรียมโฟลเดอร์เก็บไฟล์…');
    S.root = await resolveRoot();
    for (const t of TABLES) S.ids[t] = S.ids[t] || new Map();
    return { site: S.site, created: missing, root: S.root };
  },

  async getAll() {
    await ready();
    const avail = TABLES.filter((t) => S.lists[t]);
    const rows = await Promise.all(avail.map(readTable));
    const d = {};
    avail.forEach((t, i) => { d[t] = rows[i]; });
    const settings = {};
    for (const r of d.settings || []) if (r.key) settings[r.key] = r.value;
    return {
      projects: d.projects || [], boq: d.boq || [], updates: d.updates || [], files: d.files || [],
      subs: d.subs || [], reqs: d.reqs || [], settings,
      meta: {
        rootFolderUrl: S.root.webUrl, siteUrl: S.site.webUrl, siteName: S.site.name, maxUploadMB: this.maxUploadMB,
        upgrade: missingOptional(),
      },
    };
  },

  async saveProject(p, { by = conf.user } = {}) {
    await ready();
    const now = new Date().toISOString();
    const isNew = !p.id;
    const rec = { ...p, id: p.id || uid('P'), createdAt: p.createdAt || now, createdBy: p.createdBy || by, updatedAt: now };
    const f = await projectFolder(rec);
    rec.folderId = `${f.driveId}|${f.id}`;
    rec.folderUrl = f.webUrl || rec.folderUrl || '';
    if (!rec.folderUrl) {
      const it = await gfetch(`/drives/${f.driveId}/items/${f.id}`).catch(() => null);
      rec.folderUrl = it?.webUrl || '';
    }
    await upsert('projects', rec, { isNew });
    return rec;
  },

  async deleteProject(id) {
    await ready();
    for (const t of ['boq', 'updates', 'files', 'subs', 'reqs']) {
      if (!S.lists[t]) continue;
      const items = await itemsByProject(t, id);
      await batch(items.map((x) => ({ method: 'DELETE', url: `${itemsUrl(t)}/${x.itemId}` })));
      for (const x of items) S.ids[t].delete(x.rid);
    }
    await remove('projects', id);
    return { id };
  },

  async saveBoq(pid, items, onProgress) {
    await ready();
    return replaceProjectRows('boq', pid, items, onProgress);
  },

  async saveUpdate(u) {
    await ready();
    const now = new Date().toISOString();
    const rec = { ...u, id: u.id || uid('U'), createdAt: u.createdAt || now, createdBy: u.createdBy || conf.user, updatedAt: now };
    await upsert('updates', rec, { isNew: !u.id });
    return rec;
  },

  async deleteUpdate(id) { await ready(); await remove('updates', id); return { id }; },

  async uploadFile({ project, projectId, category, file, note = '', updateId = '', subId = '', by, byEmail = '', id = '' }, onProgress) {
    await ready();
    const folder = await categoryFolder(project, category);
    const name = safeName(file.name);
    const it = file.size <= SIMPLE_MAX
      ? await putSimple(folder, name, file, onProgress)
      : await putSession(folder, name, file, onProgress);
    if (!it?.id) throw new Error('อัปโหลดไม่สำเร็จ — SharePoint ไม่ส่งข้อมูลไฟล์กลับมา');
    if (!it.parentReference?.driveId) it.parentReference = { ...(it.parentReference || {}), driveId: folder.driveId };
    const rec = fileRec(it, { projectId, category, note, updateId, subId, by: by || conf.user, byEmail, id });
    rec.mime = it.file?.mimeType || file.type || rec.mime;
    await upsert('files', rec, { isNew: true });
    return rec;
  },

  async addLink({ projectId, category, name, url, note = '', by, byEmail = '' }) {
    await ready();
    const rec = {
      id: uid('F'), projectId, category, name, url, mime: 'link', size: 0, driveId: '', note,
      uploadedBy: by || conf.user, uploadedByEmail: byEmail, uploadedAt: new Date().toISOString(),
    };
    await upsert('files', rec, { isNew: true });
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
    await upsert('files', rec);
    return rec;
  },

  async deleteFile(id, rec) {
    await ready();
    if (rec?.driveId && rec.spDrive) {
      try { await gfetch(`/drives/${rec.spDrive}/items/${rec.driveId}`, { method: 'DELETE' }); } catch (e) { if (e.status !== 404) throw e; }
    }
    await remove('files', id);
    return { id };
  },

  /** เพิ่มไฟล์ที่วางไว้ในโฟลเดอร์ SharePoint ของโครงการโดยตรงเข้าระบบ */
  async scanDrive(pid, project, { by = conf.user } = {}) {
    await ready();
    const root = await projectFolder(project);
    const known = new Set();
    for (const x of await itemsByProject('files', pid)) { const o = parse(x.data); if (o?.driveId) known.add(o.driveId); }
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
            added.push(fileRec(it, {
              projectId: pid, category,
              by: `${it.createdBy?.user?.displayName || by} (ดึงจาก SharePoint)`, at: it.createdDateTime,
            }));
          }
        }
        url = r['@odata.nextLink'];
      }
    };
    await walk(root.id, 'อื่นๆ', 0);
    if (added.length) await bulkUpsert('files', added);
    return added;
  },

  async saveSettings(s) {
    await ready();
    await bulkUpsert('settings', Object.entries(s).map(([key, value]) => ({ key, value })));
    return s;
  },

  /** นำเข้าข้อมูลทั้งชุด (ย้ายจากโหมดทดลอง / กู้คืนไฟล์สำรอง) */
  async importAll(d, onProgress = () => {}) {
    await ready();
    const projectIds = {};
    let i = 0;
    for (const p of d.projects || []) {
      onProgress(`กำลังสร้างโครงการ ${++i}/${d.projects.length}: ${p.name}`);
      const rec = await this.saveProject({ ...p, folderId: '', folderUrl: '' });
      projectIds[p.id] = rec.id;
    }
    if ((d.boq || []).length) await bulkUpsert('boq', d.boq, (n, t) => onProgress(`กำลังบันทึก BOQ ${n}/${t}`));
    if ((d.updates || []).length) await bulkUpsert('updates', d.updates, (n, t) => onProgress(`กำลังบันทึกความคืบหน้า ${n}/${t}`));
    const links = (d.files || []).filter((f) => f.mime === 'link');
    if (links.length) await bulkUpsert('files', links);
    if ((d.subs || []).length) { needList('subs'); await bulkUpsert('subs', d.subs, (n, t) => onProgress(`กำลังบันทึกเรื่องขออนุมัติ ${n}/${t}`)); }
    if ((d.reqs || []).length) { needList('reqs'); await bulkUpsert('reqs', d.reqs); }
    if (d.settings && Object.keys(d.settings).length) await this.saveSettings(d.settings);
    return { projectIds };
  },

  // ---------- เรื่องขออนุมัติ ----------
  async subsOfProject(pid) {
    await ready();
    needList('subs');
    return (await itemsByProject('subs', pid)).map((x) => parse(x.data)).filter(Boolean);
  },
  async getSub(id) {
    await ready();
    needList('subs');
    const r = await gfetch(`${itemsUrl('subs')}?$expand=fields($select=RecId,Data)&$filter=fields/RecId eq '${odataStr(id)}'&$top=1`, { headers: PREFER });
    const it = r.value?.[0];
    if (!it) return null;
    S.ids.subs.set(id, it.id);
    return parse(it.fields?.Data);
  },
  async saveSub(sub, { isNew = false } = {}) {
    await ready();
    needList('subs');
    await upsert('subs', sub, { isNew });
    return sub;
  },
  async saveRequired(pid, items) {
    await ready();
    needList('reqs');
    return replaceProjectRows('reqs', pid, items);
  },

  /** ส่งอีเมลจากบัญชีผู้ใช้ (ต้องเปิดสิทธิ์ Mail.Send) — ผู้รับเพื่อทราบใส่ในสำเนาลับ */
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
    return {
      preview: get || it?.webUrl || rec.url,
      download: it?.['@microsoft.graph.downloadUrl'] || rec.url,
      open: it?.webUrl || rec.url,
    };
  },

  async thumbUrl(rec) {
    if (!rec.driveId || !rec.spDrive) return '';
    try {
      const r = await gfetch(`/drives/${rec.spDrive}/items/${rec.driveId}/thumbnails`);
      return r.value?.[0]?.medium?.url || r.value?.[0]?.small?.url || '';
    } catch { return ''; }
  },
};
