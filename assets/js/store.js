// ชั้นข้อมูล: ทำงานได้ 3 แบบ
//  - local      : เก็บในเบราว์เซอร์นี้ (localStorage + IndexedDB) สำหรับทดลองใช้
//  - gas        : Google Sheet + Google Drive ผ่าน Google Apps Script   (backends/gas.js)
//  - sharepoint : SharePoint List + Document Library ผ่าน Microsoft Graph (backends/sharepoint.js)
//
// สิทธิ์และขั้นตอนอนุมัติใช้กฎกลางใน rules.js (globalThis.PTRules) ร่วมกับ Apps Script
//  - Google  : เซิร์ฟเวอร์ตรวจสิทธิ์ ส่งอีเมล และกรองให้เห็นเฉพาะโครงการที่มีสิทธิ์
//  - SharePoint / โหมดทดลอง : ตรวจสิทธิ์และสร้างอีเมลที่หน้าเว็บ (สิทธิ์จริงของไฟล์คุมด้วยสิทธิ์ของไซต์)
import { DEFAULT_SETTINGS, SUB_FILE_CATEGORY } from './defaults.js';
import { analyze, sortUpdates } from './calc.js';
import { uid } from './ui.js';
import { conf, saveConf, readJSON, writeJSON } from './config.js';
import { gasBackend } from './backends/gas.js';
import { spBackend } from './backends/sharepoint.js';
import { odBackend } from './backends/onedrive.js';

export { conf, saveConf };

const R = globalThis.PTRules;
const K_DATA = 'pt.data.v1';
const K_MAIL = 'pt.mail.v1';
const cacheKey = () => `pt.cache.${conf.mode}.v1`;
const nowIso = () => new Date().toISOString();

const BACKENDS = { gas: gasBackend, sharepoint: spBackend, onedrive: odBackend };
/** ฟิลด์ที่เจ้าของโครงการเท่านั้นเปลี่ยนได้ */
const OWNER_ONLY_FIELDS = ['ownerEmail', 'ownerName', 'ownerRole', 'ownerSeat', 'members', 'rolePerms', 'workflow', 'slaWarnDays', 'slaLateDays'];
/** ลำดับกรรมการ 0 (ประธาน) – 9 ; ค่าอื่น = '' */
function seatValue(v) {
  if (v === '' || v == null || !Number.isFinite(+v)) return '';
  const n = Math.round(+v);
  return n >= 0 && n <= R.MAX_SEAT ? n : '';
}
/** ตัวเลือกโหวตที่อ้างไฟล์ตามลำดับที่แนบ (fileIdx) → รหัสไฟล์ที่อัปโหลดแล้ว */
function voteWithFiles(vote, fileIds) {
  return {
    question: vote.question || '',
    options: (vote.options || []).map((o) => ({
      label: o.label, detail: o.detail || '',
      fileId: o.fileId || (o.fileIdx != null && fileIds[o.fileIdx] ? fileIds[o.fileIdx] : ''),
    })),
  };
}
export function backendFor(mode = conf.mode) { return BACKENDS[mode] || null; }

export async function testConnection(url, key) { return gasBackend.test({ url, key }); }

const TABLES = ['projects', 'boq', 'updates', 'files', 'subs', 'reqs'];
const emptyData = () => ({ projects: [], boq: [], updates: [], files: [], subs: [], reqs: [], settings: {} });

/** แยกผลการส่งอีเมล (_mail) ออกจากระเบียน ให้อ่านได้แต่ไม่ถูกบันทึก */
function detachMail(rec, mail) {
  const m = mail !== undefined ? mail : rec?._mail;
  if (rec && '_mail' in rec) delete rec._mail;
  if (rec && m) Object.defineProperty(rec, '_mail', { value: m, enumerable: false, configurable: true });
  return rec;
}

function permError(msg = 'คุณไม่มีสิทธิ์ทำรายการนี้ในโครงการนี้') {
  const e = new Error(msg);
  e.code = 'forbidden';
  return e;
}

// ---------- IndexedDB สำหรับไฟล์ในโหมดทดลอง ----------
const idb = {
  _db: null,
  open() {
    if (!this._db) {
      this._db = new Promise((res, rej) => {
        const r = indexedDB.open('pt-files', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('blobs');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return this._db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('blobs', mode);
      const req = fn(tx.objectStore('blobs'));
      tx.oncomplete = () => res(req?.result);
      tx.onerror = () => rej(tx.error);
    });
  },
  put(k, v) { return this.run('readwrite', (s) => s.put(v, k)); },
  get(k) { return this.run('readonly', (s) => s.get(k)); },
  del(k) { return this.run('readwrite', (s) => s.delete(k)); },
  clear() { return this.run('readwrite', (s) => s.clear()); },
};

// ---------- store ----------
let version = 0;
const analysisCache = new Map();

export const store = {
  data: emptyData(),
  meta: { rootFolderUrl: '', maxUploadMB: 25 },
  online: true,
  lastSync: null,
  /** อีเมลที่ระบบสร้างในโหมดทดลอง (กล่องจดหมายจำลอง) */
  outbox: readJSON(K_MAIL, []),

  /** ตัวเชื่อมที่ใช้อยู่ (null = โหมดทดลอง) */
  get backend() { const b = backendFor(); return b && b.configured() ? b : null; },
  get cloud() { return !!this.backend; },
  get backendLabel() { return this.backend?.label || 'โหมดทดลอง'; },
  /** ชื่อที่เก็บไฟล์ สำหรับข้อความบนหน้าจอ */
  get fileHost() { return this.backend?.fileHost || 'เบราว์เซอร์'; },
  get settings() { return { ...DEFAULT_SETTINGS, ...(this.data.settings || {}) }; },
  get mode() { return this.cloud ? this.backend.id : 'local'; },
  /** ตัวเชื่อมที่แอปเขียนข้อมูลเองโดยตรง (Microsoft Graph) — ตรวจสิทธิ์ตามกฎในแอปก่อนบันทึก */
  get direct() { return this.mode === 'sharepoint' || this.mode === 'onedrive'; },
  /** การตั้งค่าอีเมลของตัวเชื่อม Microsoft ที่ใช้อยู่ */
  get msConf() { return this.mode === 'onedrive' ? conf.od : conf.sp; },

  /** Apps Script รุ่นเก่า (1.0.0) ที่ยังไม่รองรับผู้ใช้ สิทธิ์ และเรื่องขออนุมัติ */
  get legacy() { return this.mode === 'gas' && !this.meta.me && !this.needLogin; },
  /** Google 1.0.1: ยังไม่ได้เข้าสู่ระบบ */
  needLogin: false,
  /** เซิร์ฟเวอร์ตรวจสิทธิ์และส่งอีเมลเอง (Google Apps Script 1.0.1 ขึ้นไป) */
  get serverRules() { return this.mode === 'gas' && !!this.meta.me; },

  /** ผู้ใช้ปัจจุบัน: { email, name, isAdmin, isExec, canCreate } */
  get me() {
    const s = this.settings;
    const admins = R.parseList(s.admins);
    if (this.mode === 'gas') {
      if (this.meta.me) return this.meta.me;
      if (this.needLogin) return { email: '', name: '', isAdmin: false, isExec: false, canCreate: false };
      return { email: R.norm(conf.email), name: conf.user, isAdmin: true, isExec: false, canCreate: true, legacy: true };
    }
    let email; let name; let isAdmin;
    if (this.mode === 'sharepoint') {
      const acc = this.backend.account?.() || null;
      email = R.norm(acc?.username || conf.email);
      name = conf.user || acc?.name || email;
      // ยังไม่กำหนดผู้ดูแลระบบ = ทุกคนเป็นผู้ดูแล (เหมือนเวอร์ชัน 1.0.0) — ผู้ที่สร้างรายการข้อมูลในไซต์จะถูกบันทึกเป็นผู้ดูแลอัตโนมัติ
      isAdmin = !admins.length || R.listHas(admins, email);
    } else if (this.mode === 'onedrive') {
      const acc = this.backend.account?.() || null;
      email = R.norm(acc?.username || conf.email);
      name = conf.user || acc?.name || email;
      // เจ้าของ OneDrive ที่เก็บโฟลเดอร์หลัก เป็นผู้ดูแลระบบเสมอ
      isAdmin = this.backend.isDriveOwner() || R.listHas(admins, email);
    } else if (conf.actAs) {
      email = R.norm(conf.actAs);
      name = this.nameOf(email) || email;
      isAdmin = R.listHas(admins, email);
    } else {
      email = R.norm(conf.email);
      name = conf.user || email;
      isAdmin = true; // เจ้าของเครื่องในโหมดทดลอง
    }
    const me = { email, name, isAdmin, isExec: R.listHas(s.executives, email) };
    me.canCreate = R.canCreateProject(s, me) || (!email && isAdmin);
    return me;
  },

  /** ชื่อของอีเมลนี้จากรายชื่อสมาชิกทุกโครงการ */
  nameOf(email) {
    const e = R.norm(email);
    if (!e) return '';
    for (const p of this.data.projects) {
      if (R.norm(p.ownerEmail) === e && p.ownerName) return p.ownerName;
      const m = (p.members || []).find((x) => R.norm(x.email) === e && x.name);
      if (m) return m.name;
    }
    return '';
  },

  async init() {
    if (this.cloud) {
      const cached = readJSON(cacheKey());
      this.data = { ...emptyData(), ...(cached?.data || {}) };
      if (cached?.meta) this.meta = { ...this.meta, ...cached.meta };
      this.touch();
      try {
        await this.refresh();
      } catch (e) {
        this.online = false;
        throw e;
      }
    } else {
      this.data = { ...emptyData(), ...(readJSON(K_DATA) || {}) };
    }
    this.touch();
  },

  async refresh() {
    if (!this.cloud) return;
    const d = await this.backend.getAll();
    this.data = emptyData();
    for (const t of TABLES) this.data[t] = d[t] || [];
    this.data.settings = d.settings || {};
    this.meta = { rootFolderUrl: '', maxUploadMB: this.meta.maxUploadMB, ...(d.meta || {}) };
    if (this.direct) {
      const want = !!this.data.settings.spMail;
      if (this.msConf.mail !== want) { this.msConf.mail = want; saveConf(); }
    }
    this.online = true;
    this.lastSync = new Date();
    this.persist();
    this.touch();
  },

  persist() {
    const ok = this.cloud
      ? writeJSON(cacheKey(), { data: this.data, meta: { ...this.meta } })
      : writeJSON(K_DATA, this.data);
    if (!ok && !this.cloud) throw new Error('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม — ย้ายไปใช้ Google Drive หรือ SharePoint เพื่อเก็บข้อมูลได้มากขึ้น');
  },

  /** ล้างข้อมูลที่จำไว้ (เมื่อออกจากระบบ) */
  forget() {
    this.data = emptyData();
    this.meta = { rootFolderUrl: '', maxUploadMB: this.meta.maxUploadMB };
    try { localStorage.removeItem(cacheKey()); } catch { /* ignore */ }
    this.touch();
  },

  touch() { version++; analysisCache.clear(); },

  // ---------- สิทธิ์ ----------
  canView(p) {
    if (!p) return false;
    if (this.legacy) return true;
    return R.canView(p, this.me);
  },
  /** perm: editProject | editBoq | recordProgress | uploadDocs | submit | approve | manageRequired | manageMembers | transferOwner | deleteProject */
  can(pid, perm) {
    const p = typeof pid === 'object' ? pid : this.project(pid);
    if (!p) return false;
    if (this.legacy) return !['submit', 'approve', 'manageRequired', 'manageMembers', 'transferOwner'].includes(perm);
    return R.can(p, this.me, perm);
  },
  roleOf(p) {
    if (!p) return null;
    const r = R.roleOf(p, this.me.email);
    if (r) return r;
    return R.isOwner(p, this.me) && p.ownerEmail ? 'owner' : null;
  },
  /** ป้ายบทบาทของผู้ใช้ปัจจุบันในโครงการ */
  roleLabel(p) {
    const r = this.roleOf(p);
    if (r) return R.ROLES[r].label;
    if (this.me.isAdmin) return 'ผู้ดูแลระบบ';
    if (this.me.isExec) return 'ผู้บริหาร';
    return '';
  },

  // ---------- อ่านข้อมูล ----------
  project(id) { return this.data.projects.find((p) => p.id === id); },
  visibleProjects() { return this.data.projects.filter((p) => this.canView(p)); },
  boqOf(pid) {
    return this.data.boq.filter((b) => b.projectId === pid)
      .sort((a, b) => (+a.order || 0) - (+b.order || 0));
  },
  updatesOf(pid) { return sortUpdates(this.data.updates.filter((u) => u.projectId === pid)); },
  filesOf(pid) {
    return this.data.files.filter((f) => f.projectId === pid)
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  },
  subsOf(pid) {
    return this.data.subs.filter((s) => s.projectId === pid)
      .sort((a, b) => (+b.no || 0) - (+a.no || 0));
  },
  sub(id) { return this.data.subs.find((s) => s.id === id); },
  reqsOf(pid) {
    return this.data.reqs.filter((r) => r.projectId === pid)
      .sort((a, b) => (+a.order || 0) - (+b.order || 0));
  },
  analysis(pid) {
    if (!analysisCache.has(pid)) {
      const p = this.project(pid);
      if (!p) return null;
      analysisCache.set(pid, analyze(p, this.boqOf(pid), this.updatesOf(pid), this.settings));
    }
    return analysisCache.get(pid);
  },
  rows() { return this.visibleProjects().map((p) => ({ p, a: this.analysis(p.id) })); },

  /** งานของผู้ใช้ปัจจุบัน: รอพิจารณา / เรื่องที่ส่งไป / เรื่องที่ต้องแก้ไข / เอกสารใกล้ครบกำหนด */
  myQueue() {
    const me = this.me;
    const now = nowIso();
    const today = now.slice(0, 10);
    const s = this.settings;
    const out = { decide: [], mine: [], resubmit: [], reqs: [], vote: [] };
    if (this.legacy || !me.email) return out;
    for (const p of this.visibleProjects()) {
      const subs = this.subsOf(p.id);
      for (const sub of subs) {
        const row = { p, sub, sla: R.subSla(sub, p, s, now) };
        if (R.currentApprovers(sub, p).includes(me.email)) out.decide.push(row);
        if (R.canVote(sub, p, me) && !R.ballotOf(sub, me.email)) out.vote.push(row);
        else if (sub.vote?.status === 'open' && sub.status === 'pending' && R.canCloseVote(sub, p, me) && R.tally(sub, p).leaders.length > 1 && !R.tally(sub, p).missing.length) out.vote.push(row);
        if (R.norm(sub.submittedBy) === me.email) {
          if (sub.status === 'pending') out.mine.push(row);
          else if (R.canResubmit(sub, p, me) && !subs.some((x) => x.requiredId && x.requiredId === sub.requiredId && x.no > sub.no)) out.resubmit.push(row);
        }
      }
      if (this.roleOf(p) === 'contractor') {
        for (const req of this.reqsOf(p.id)) {
          const st = R.reqStatus(req, p, subs, today);
          if (st.state === 'none' && st.due && st.leftDays != null && st.leftDays <= 14) out.reqs.push({ p, req, st });
        }
      }
    }
    const byAge = (a, b) => b.sla.age - a.sla.age;
    out.decide.sort(byAge); out.mine.sort(byAge);
    out.reqs.sort((a, b) => a.st.leftDays - b.st.leftDays);
    return out;
  },

  /** สรุปเรื่องค้างของโครงการ: { pending, warn, late, overdueReqs } */
  pendingSummary(pid) {
    const p = this.project(pid);
    const res = { pending: 0, warn: 0, late: 0, overdueReqs: 0 };
    if (!p) return res;
    const s = this.settings;
    const now = nowIso();
    const subs = this.subsOf(pid);
    for (const sub of subs) {
      if (sub.status !== 'pending') continue;
      res.pending++;
      const t = R.subSla(sub, p, s, now).tone;
      if (t === 'late') res.late++; else if (t === 'warn') res.warn++;
    }
    const today = now.slice(0, 10);
    for (const req of this.reqsOf(pid)) if (R.reqStatus(req, p, subs, today).overdueDays > 0) res.overdueReqs++;
    return res;
  },

  // ---------- ช่วยแก้ข้อมูลในหน่วยความจำ ----------
  _upsert(table, obj) {
    const arr = this.data[table];
    const i = arr.findIndex((x) => x.id === obj.id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  },
  _commit() {
    this.persist();
    this.touch();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('pt:data'));
  },
  _need(pid, perm, msg) { if (!this.can(pid, perm)) throw permError(msg); },

  // ---------- อีเมลแจ้งเตือน (โหมดทดลอง / SharePoint) ----------
  appUrl() { return this.settings.appUrl || location.href.split('#')[0]; },
  async _mail(messages) {
    const list = (messages || []).filter((m) => m && m.to && m.to.length);
    if (!list.length || this.serverRules) return { sent: 0 };
    if (this.direct) {
      if (!this.settings.spMail) return { sent: 0, skipped: true };
      let sent = 0;
      const errors = [];
      for (const m of list) {
        try { await this.backend.sendMail(m); sent += m.to.length; } catch (e) { errors.push(e.message); }
      }
      if (errors.length) {
        const e = new Error(`บันทึกแล้ว แต่ส่งอีเมลแจ้งเตือนไม่สำเร็จ: ${errors[0]}`);
        e.code = 'mail_failed';
        throw e;
      }
      return { sent };
    }
    // โหมดทดลอง: เก็บไว้ในกล่องจดหมายจำลอง
    const me = this.me;
    for (const m of list) this.outbox.unshift({ id: uid('M'), at: nowIso(), from: me.email, fromName: me.name, ...m });
    this.outbox = this.outbox.slice(0, 200);
    writeJSON(K_MAIL, this.outbox);
    return { sent: list.reduce((n, m) => n + m.to.length, 0), simulated: true };
  },
  clearOutbox() { this.outbox = []; writeJSON(K_MAIL, []); },

  subMails(p, event, sub) {
    return R.mailPlan(p, event, sub, this.me, this.appUrl(), this.settings);
  },

  // ---------- โครงการ ----------
  async saveProject(p, { invite = true } = {}) {
    const me = this.me;
    const old = p.id ? this.project(p.id) : null;
    if (old) {
      if (!this.can(old, 'editProject') && !this.can(old, 'manageMembers')) throw permError('คุณไม่มีสิทธิ์แก้ไขข้อมูลโครงการนี้');
    } else if (!this.legacy && !me.canCreate) throw permError('บัญชีนี้ยังไม่ได้รับสิทธิ์สร้างโครงการ — ติดต่อผู้ดูแลระบบ');
    const rec = { ...p };
    if (!old && !this.legacy && !this.serverRules) {
      rec.ownerEmail = rec.ownerEmail || me.email;
      rec.ownerName = rec.ownerName || me.name;
      rec.members = rec.members || [];
    }
    if (this.mode === 'gas' && !me.isAdmin) { // เปลี่ยนโฟลเดอร์ Drive ได้เฉพาะผู้ดูแลระบบ (เซิร์ฟเวอร์ตรวจซ้ำ)
      if (old) { rec.folderId = old.folderId; rec.folderUrl = old.folderUrl; } else { rec.folderId = ''; rec.folderUrl = ''; }
    }
    // เฉพาะเจ้าของโครงการเปลี่ยนสมาชิก สิทธิ์ และขั้นตอนพิจารณาได้
    if (old && !this.legacy && !R.isOwner(old, me)) {
      for (const k of OWNER_ONLY_FIELDS) {
        if (old[k] === undefined) delete rec[k]; else rec[k] = old[k];
      }
    }
    let saved;
    if (this.cloud) {
      saved = detachMail(await this.backend.saveProject(rec, { invite, by: me.name }));
    } else {
      const now = nowIso();
      saved = {
        ...rec,
        id: rec.id || uid('P'),
        createdAt: old?.createdAt || now,
        createdBy: old?.createdBy || me.name,
        updatedAt: now,
      };
    }
    this._upsert('projects', saved);
    this._commit();
    // แจ้งสมาชิกที่ได้รับแต่งตั้งใหม่
    if (invite && !this.serverRules && !this.legacy) {
      const before = new Set(R.members(old || {}).map((m) => m.email));
      const added = R.members(saved).filter((m) => m.role !== 'owner' && !before.has(m.email));
      if (added.length) {
        const mail = await this._mail(added.map((m) => ({ to: [m.email], kind: 'invite', event: 'invite', ...R.inviteEmail(saved, m, me, this.appUrl(), this.mode) })))
          .catch((e) => ({ error: e.message }));
        detachMail(saved, mail);
      }
    }
    return saved;
  },

  /** บันทึกสมาชิก สิทธิ์ และขั้นตอนพิจารณา (เฉพาะเจ้าของโครงการ) */
  async saveMembers(pid, patch, opts = {}) {
    const p = this.project(pid);
    if (!this.can(p, 'manageMembers')) throw permError('เฉพาะเจ้าของโครงการเท่านั้นที่แต่งตั้งหรือถอดถอนสมาชิกได้');
    const members = (patch.members || p.members || []).map((m) => {
      const role = R.ROLES[m.role] && m.role !== 'owner' ? m.role : 'viewer';
      const rec = {
        email: R.norm(m.email), name: String(m.name || '').trim(), role,
        notify: R.NOTIFY[m.notify] ? m.notify : (R.DEFAULT_NOTIFY[role] || 'mine'),
      };
      const seat = seatValue(m.seat);
      if (role === 'committee' && seat !== '') rec.seat = seat;
      return rec;
    });
    const seen = new Set();
    const seats = new Map();
    const ownerRole = patch.ownerRole || p.ownerRole;
    const ownerSeat = ownerRole === 'committee' ? seatValue(patch.ownerSeat ?? p.ownerSeat) : '';
    if (ownerSeat !== '') seats.set(ownerSeat, R.norm(p.ownerEmail));
    for (const m of members) {
      if (!R.validEmail(m.email)) throw new Error(`อีเมล "${m.email || '(ว่าง)'}" ไม่ถูกต้อง`);
      if (seen.has(m.email)) throw new Error(`อีเมล ${m.email} ซ้ำกัน`);
      if (m.email === R.norm(p.ownerEmail)) throw new Error(`${m.email} เป็นเจ้าของโครงการอยู่แล้ว`);
      seen.add(m.email);
      if (m.seat !== undefined) {
        if (seats.has(m.seat)) throw new Error(`ลำดับ "${R.seatLabel(m.seat)}" ถูกกำหนดให้มากกว่า 1 คน`);
        seats.set(m.seat, m.email);
      }
    }
    return this.saveProject({ ...p, ...patch, ownerSeat, members }, opts);
  },

  async transferOwner(pid, email) {
    const p = this.project(pid);
    if (!this.can(p, 'transferOwner')) throw permError('เฉพาะเจ้าของโครงการหรือผู้ดูแลระบบเท่านั้นที่โอนความเป็นเจ้าของได้');
    const e = R.norm(email);
    if (!R.validEmail(e)) throw new Error('อีเมลไม่ถูกต้อง');
    let saved;
    if (this.serverRules) {
      saved = await this.backend.transferOwner(pid, e);
    } else {
      const target = (p.members || []).find((m) => R.norm(m.email) === e);
      const members = (p.members || []).filter((m) => R.norm(m.email) !== e);
      if (p.ownerEmail && R.norm(p.ownerEmail) !== e) {
        members.push({ email: R.norm(p.ownerEmail), name: p.ownerName || '', role: 'supervisor', notify: 'all' });
      }
      const next = { ...p, ownerEmail: e, ownerName: target?.name || this.nameOf(e) || '', members };
      saved = this.cloud ? await this.backend.saveProject(next, { invite: false }) : { ...next, updatedAt: nowIso() };
    }
    this._upsert('projects', saved);
    this._commit();
    return saved;
  },

  async deleteProject(id) {
    this._need(id, 'deleteProject', 'เฉพาะเจ้าของโครงการหรือผู้ดูแลระบบเท่านั้นที่ลบโครงการได้');
    if (this.cloud) await this.backend.deleteProject(id);
    else for (const f of this.data.files.filter((x) => x.projectId === id)) idb.del(f.id).catch(() => {});
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    for (const t of ['boq', 'updates', 'files', 'subs', 'reqs']) this.data[t] = this.data[t].filter((x) => x.projectId !== id);
    this._commit();
  },

  // ---------- BOQ ----------
  async saveBoq(pid, items, onProgress) {
    this._need(pid, 'editBoq', 'คุณไม่มีสิทธิ์แก้ไข BOQ และแผนงานของโครงการนี้');
    const clean = items.map((it, i) => ({
      id: it.id || uid('B'), projectId: pid,
      group: it.group || '', no: it.no || '', desc: it.desc || '', unit: it.unit || '',
      qty: +it.qty || 0, mat: +it.mat || 0, labor: +it.labor || 0, weight: it.weight === '' || it.weight == null ? '' : +it.weight,
      ps: +it.ps > 0 ? Math.round(+it.ps) : '', pe: +it.pe > 0 ? Math.round(+it.pe) : '',
      order: i + 1,
    }));
    const saved = this.cloud ? await this.backend.saveBoq(pid, clean, onProgress) : clean;
    this.data.boq = this.data.boq.filter((b) => b.projectId !== pid).concat(saved);
    this._commit();
    return saved;
  },

  // ---------- บันทึกความคืบหน้า ----------
  /** opts.notify = แจ้งอีเมลหัวหน้า/ผู้ติดตามหลังบันทึก */
  async saveUpdate(u, { notify = false } = {}) {
    this._need(u.projectId, 'recordProgress', 'คุณไม่มีสิทธิ์บันทึกความคืบหน้าของโครงการนี้');
    const me = this.me;
    let saved;
    if (this.cloud) {
      saved = detachMail(await this.backend.saveUpdate(
        { ...u, createdBy: u.createdBy || me.name, createdByEmail: u.createdByEmail || me.email },
        notify && this.serverRules ? { notify: true, summary: this._progressAfter(u) } : {},
      ));
    } else {
      const now = nowIso();
      const old = u.id ? this.data.updates.find((x) => x.id === u.id) : null;
      saved = {
        ...u, id: u.id || uid('U'), createdAt: old?.createdAt || now, createdBy: old?.createdBy || me.name,
        createdByEmail: old?.createdByEmail || me.email, updatedAt: now,
      };
    }
    this._upsert('updates', saved);
    this._commit();
    let mail = null;
    if (notify && !this.serverRules && !this.legacy) {
      const p = this.project(saved.projectId);
      const rc = R.recipients(p, 'progress', null, me.email);
      if (rc.info.length) {
        const a = this.analysis(p.id);
        mail = await this._mail([{ to: rc.info, kind: 'info', event: 'progress', ...R.progressEmail(p, saved, me, this.appUrl(), { actual: a.actual, plan: a.plan }) }])
          .catch((e) => ({ error: e.message }));
      }
    }
    return mail ? detachMail(saved, mail) : saved;
  },
  /** ผลงาน/แผนหลังบันทึก (ส่งให้เซิร์ฟเวอร์ใช้ในอีเมล) */
  _progressAfter(u) {
    const p = this.project(u.projectId);
    const ups = this.updatesOf(p.id).filter((x) => x.id !== u.id).concat([{ ...u, id: u.id || '__new' }]);
    const a = analyze(p, this.boqOf(p.id), sortUpdates(ups), this.settings);
    return { actual: a.actual, plan: a.plan };
  },

  async deleteUpdate(id) {
    const u = this.data.updates.find((x) => x.id === id);
    if (u) this._need(u.projectId, 'recordProgress', 'คุณไม่มีสิทธิ์ลบบันทึกความคืบหน้าของโครงการนี้');
    if (this.cloud) await this.backend.deleteUpdate(id, this.data.updates.find((x) => x.id === id)?.projectId);
    this.data.updates = this.data.updates.filter((x) => x.id !== id);
    this._commit();
  },

  // ---------- ไฟล์ ----------
  maxUploadBytes() {
    const mb = this.cloud ? (+this.meta.maxUploadMB || this.backend.maxUploadMB || 25) : 50;
    return mb * 1048576;
  },
  /** แก้ไข/ลบไฟล์นี้ได้ไหม (ไฟล์แนบของเรื่องขออนุมัติเก็บเป็นหลักฐาน แก้ได้เฉพาะเจ้าของโครงการ) */
  canEditFile(f) {
    if (!f) return false;
    const p = this.project(f.projectId);
    if (this.legacy) return true;
    if (f.subId) return R.isOwner(p, this.me);
    return this.can(p, 'uploadDocs');
  },

  async uploadFile(pid, category, file, { note = '', updateId = '', subId = '', onProgress } = {}) {
    // ไฟล์แนบของเรื่องขออนุมัติ และรูปของบันทึกความคืบหน้า ใช้สิทธิ์ของงานนั้นแทนสิทธิ์คลังเอกสาร
    if (!subId && !(updateId && this.can(pid, 'recordProgress'))) this._need(pid, 'uploadDocs', 'คุณไม่มีสิทธิ์อัปโหลดเอกสารในคลังของโครงการนี้');
    if (file.size > this.maxUploadBytes()) {
      throw new Error(this.cloud
        ? `ไฟล์ "${file.name}" ใหญ่เกิน ${Math.round(this.maxUploadBytes() / 1048576)} MB — วางไฟล์ไว้ในโฟลเดอร์ ${this.fileHost} ของโครงการแล้วกด "ดึงไฟล์จาก ${this.fileHost}" แทน`
        : `ไฟล์ "${file.name}" ใหญ่เกิน 50 MB สำหรับโหมดทดลอง`);
    }
    const me = this.me;
    let rec;
    if (this.cloud) {
      rec = await this.backend.uploadFile({
        project: this.project(pid), projectId: pid, category, file, note, updateId, subId, by: me.name, byEmail: me.email,
      }, onProgress);
    } else {
      rec = {
        id: uid('F'), projectId: pid, category, name: file.name,
        mime: file.type || 'application/octet-stream', size: file.size,
        driveId: '', url: '', note, updateId, subId, localBlob: true,
        uploadedBy: me.name, uploadedByEmail: me.email, uploadedAt: nowIso(),
      };
      await idb.put(rec.id, file);
      onProgress?.(1);
    }
    this._upsert('files', rec);
    this._commit();
    return rec;
  },

  async addLink(pid, category, name, url, note = '') {
    this._need(pid, 'uploadDocs', 'คุณไม่มีสิทธิ์เพิ่มเอกสารในคลังของโครงการนี้');
    if (!/^https?:\/\/[^\s]+$/i.test(String(url || '').trim())) throw new Error('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
    const me = this.me;
    const rec = this.cloud
      ? await this.backend.addLink({ projectId: pid, category, name, url, note, by: me.name, byEmail: me.email })
      : {
        id: uid('F'), projectId: pid, category, name, url, mime: 'link', size: 0, driveId: '', note,
        uploadedBy: me.name, uploadedByEmail: me.email, uploadedAt: nowIso(),
      };
    this._upsert('files', rec);
    this._commit();
    return rec;
  },

  async updateFile(id, changes) {
    const old = this.data.files.find((f) => f.id === id);
    if (!this.canEditFile(old)) throw permError('คุณไม่มีสิทธิ์แก้ไขไฟล์นี้');
    const rec = this.cloud
      ? await this.backend.updateFile(id, changes, { old, project: old && this.project(old.projectId) })
      : { ...old, ...changes };
    this._upsert('files', rec);
    this._commit();
    return rec;
  },

  async deleteFile(id) {
    const rec = this.data.files.find((f) => f.id === id);
    if (!this.canEditFile(rec)) throw permError('คุณไม่มีสิทธิ์ลบไฟล์นี้');
    if (this.cloud) await this.backend.deleteFile(id, rec);
    else await idb.del(id).catch(() => {});
    this.data.files = this.data.files.filter((f) => f.id !== id);
    this._commit();
  },

  async scanDrive(pid) {
    this._need(pid, 'uploadDocs', 'คุณไม่มีสิทธิ์จัดการคลังเอกสารของโครงการนี้');
    const added = await this.backend.scanDrive(pid, this.project(pid), { by: this.me.name });
    for (const r of added) this._upsert('files', r);
    this._commit();
    return added;
  },

  /** คืน URL สำหรับดูตัวอย่างและดาวน์โหลด */
  async fileUrls(rec) {
    if (rec.localBlob) {
      const blob = await idb.get(rec.id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      return { preview: url, download: url, blob, local: true };
    }
    if (this.cloud && (rec.driveId || rec.mime !== 'link')) return this.backend.fileUrls(rec);
    // ลิงก์ที่ไม่ใช่ http(s) (เช่น javascript:) ไม่เปิดให้
    const u = /^https?:\/\//i.test(String(rec.url || '')) ? rec.url : '';
    return { open: u, preview: u, download: u };
  },

  async thumbUrl(rec) {
    if (rec.localBlob) {
      const blob = await idb.get(rec.id).catch(() => null);
      return blob ? URL.createObjectURL(blob) : '';
    }
    return this.cloud ? this.backend.thumbUrl(rec) : '';
  },

  // ---------- เรื่องขออนุมัติ / แจ้งปัญหา ----------
  _assertSubs() {
    if (this.legacy) throw new Error('ระบบหลังบ้าน (Code.gs) ยังเป็นเวอร์ชัน 1.0.0 — ให้ผู้ดูแลอัปเดต Code.gs เป็นเวอร์ชัน 1.0.1 ก่อนใช้งานเรื่องขออนุมัติ');
  },

  async _uploadAttachments(pid, subId, files, label, onProgress) {
    const ids = [];
    let i = 0;
    for (const file of files || []) {
      i++;
      const n = i;
      const rec = await this.uploadFile(pid, SUB_FILE_CATEGORY, file, {
        subId, note: label,
        onProgress: (f) => onProgress?.(`กำลังอัปโหลดไฟล์แนบ ${n}/${files.length}`, (n - 1 + f) / files.length),
      });
      ids.push(rec.id);
    }
    return ids;
  },

  /** ส่งเรื่องใหม่ — input: { category, title, detail, requiredId } */
  async createSubmission(pid, input, files = [], onProgress) {
    this._assertSubs();
    const p = this.project(pid);
    const me = this.me;
    if (!this.can(p, 'submit')) throw permError('คุณไม่มีสิทธิ์ส่งเรื่องในโครงการนี้');
    // ตรวจข้อมูลก่อนอัปโหลดไฟล์ (ไม่ให้มีไฟล์ค้างเมื่อข้อมูลไม่ครบ)
    R.createSubmission(p, { ...input, id: 'check' }, me, nowIso(), this.data.subs);
    const id = uid('S');
    const fileIds = await this._uploadAttachments(pid, id, files, `แนบกับเรื่อง: ${String(input.title || '').trim()}`, onProgress);
    if (input.vote) input = { ...input, vote: voteWithFiles(input.vote, fileIds) };
    onProgress?.('กำลังส่งเรื่อง…', 1);
    let res;
    if (this.serverRules) {
      res = await this.backend.createSubmission({ projectId: pid, id, input: { ...input, files: fileIds } });
    } else {
      const existing = this.direct ? await this.backend.subsOfProject(pid) : this.data.subs;
      const out = R.createSubmission(p, { ...input, id, files: fileIds }, me, nowIso(), existing);
      if (this.direct) await this.backend.saveSub(out.sub, { isNew: true });
      res = { sub: out.sub, event: out.event };
    }
    this._upsert('subs', res.sub);
    this._commit();
    if (!this.serverRules) res.mail = await this._mail(this.subMails(p, res.event, res.sub)).catch((e) => ({ error: e.message }));
    return res;
  },

  /** ทำรายการกับเรื่อง: approve | reject | resubmit | cancel | comment | openVote | vote | closeVote */
  async actSubmission(subId, action, { comment = '', changes = null, option = '', vote = null } = {}, files = [], onProgress) {
    this._assertSubs();
    const cur = this.sub(subId);
    if (!cur) throw new Error('ไม่พบเรื่องนี้ (อาจถูกลบไปแล้ว)');
    const p = this.project(cur.projectId);
    const me = this.me;
    const ch = changes || { comment };
    // ตรวจสิทธิ์และเหตุผลก่อนอัปโหลดไฟล์แนบ
    // ตรวจสิทธิ์ก่อน (ไฟล์ของตัวเลือกโหวตยังไม่มี id จึงตรวจแบบไม่ผูกไฟล์)
    const preVote = vote ? voteWithFiles(vote, []) : null;
    R.act(cur, p, me, action, { comment: comment || (files.length && action === 'comment' ? 'แนบไฟล์' : ''), changes: ch, option, vote: preVote }, nowIso());
    const fileIds = await this._uploadAttachments(p.id, subId, files, `แนบกับเรื่อง ${R.subNo(cur)} (${R.ACTIONS[action] || action})`, onProgress);
    if (vote) vote = voteWithFiles(vote, fileIds);
    onProgress?.('กำลังบันทึก…', 1);
    let res;
    if (this.serverRules) {
      res = await this.backend.actSubmission({ id: subId, action, comment, changes: ch, files: fileIds, option, vote });
    } else {
      const fresh = this.direct ? (await this.backend.getSub(subId, cur.projectId)) || cur : cur;
      const out = R.act(fresh, p, me, action, { comment, changes: ch, files: fileIds, option, vote }, nowIso());
      if (this.direct) await this.backend.saveSub(out.sub, { prev: fresh.updatedAt });
      res = { sub: out.sub, event: out.event };
    }
    this._upsert('subs', res.sub);
    this._commit();
    if (!this.serverRules) res.mail = await this._mail(this.subMails(p, res.event, res.sub)).catch((e) => ({ error: e.message }));
    return res;
  },

  // ---------- รายการเอกสารที่ต้องส่ง ----------
  async saveRequired(pid, list) {
    this._assertSubs();
    this._need(pid, 'manageRequired', 'คุณไม่มีสิทธิ์กำหนดรายการเอกสารที่ต้องส่ง');
    const clean = list.map((r, i) => ({
      id: r.id || uid('Q'), projectId: pid, title: String(r.title || '').trim(), category: r.category || '',
      dueType: R.DUE_TYPES[r.dueType] ? r.dueType : 'afterStart', dueDays: Math.max(0, Math.round(+r.dueDays || 0)),
      dueDate: r.dueType === 'date' ? (r.dueDate || '') : '', note: String(r.note || '').trim(), order: i + 1,
    })).filter((r) => r.title);
    const saved = this.cloud ? await this.backend.saveRequired(pid, clean) : clean;
    this.data.reqs = this.data.reqs.filter((r) => r.projectId !== pid).concat(saved);
    this._commit();
    return saved;
  },

  // ---------- OneDrive: สิทธิ์เข้าถึงโฟลเดอร์ ----------
  /** รายชื่อที่ต้องแชร์โฟลเดอร์หลักให้: write = ต้องบันทึกข้อมูลได้ (มีสิทธิ์ใดๆ ในโครงการ) / read = ดูอย่างเดียว */
  oneDriveAccessList() {
    const map = new Map();
    const add = (email, why, write) => {
      const e = R.norm(email);
      if (!R.validEmail(e)) return;
      const x = map.get(e) || { email: e, why: [], write: false };
      if (!x.why.includes(why)) x.why.push(why);
      x.write = x.write || write;
      map.set(e, x);
    };
    const s = this.settings;
    for (const e of R.parseList(s.admins)) if (!e.startsWith('@')) add(e, 'ผู้ดูแลระบบ', true);
    for (const e of R.parseList(s.executives)) if (!e.startsWith('@')) add(e, 'ผู้บริหาร', false);
    for (const p of this.data.projects) {
      for (const m of R.members(p)) {
        const write = m.role === 'owner' || R.permsOf(p, m.role).length > 0;
        add(m.email, R.ROLES[m.role]?.label || m.role, write);
      }
    }
    const me = R.norm(this.me.email);
    return [...map.values()].filter((x) => x.email !== me).sort((a, b) => (b.write - a.write) || a.email.localeCompare(b.email));
  },
  async shareOneDrive(list, opts = {}) {
    if (this.mode !== 'onedrive') throw new Error('ใช้ได้เฉพาะเมื่อเก็บข้อมูลใน OneDrive');
    if (!this.me.isAdmin) throw permError('เฉพาะผู้ดูแลระบบเท่านั้นที่แชร์โฟลเดอร์ได้');
    return this.backend.shareRoot(list, { ...opts, message: `เชิญเข้าใช้ระบบติดตามโครงการ ${this.settings.orgName || ''}`.trim() });
  },

  // ---------- ตั้งค่า ----------
  async saveSettings(s) {
    if (!this.legacy && !this.me.isAdmin) throw permError('เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนการตั้งค่ากลางได้');
    const merged = { ...this.data.settings, ...s };
    if (this.cloud) await this.backend.saveSettings(merged);
    this.data.settings = merged;
    if (this.direct) { this.msConf.mail = !!merged.spMail; saveConf(); }
    this._commit();
  },

  // ---------- สำรอง/ย้ายข้อมูล ----------
  exportBackup() {
    return {
      app: 'project-tracker', version: 2, exportedAt: nowIso(),
      data: { ...this.data, files: this.data.files.map((f) => ({ ...f })) },
    };
  },

  async importBackup(json, { replace = false, onProgress } = {}) {
    const d = json?.data || json;
    if (!d || !Array.isArray(d.projects)) throw new Error('ไฟล์สำรองไม่ถูกต้อง');
    if (!this.legacy && !this.me.isAdmin) throw permError('เฉพาะผู้ดูแลระบบเท่านั้นที่นำเข้าข้อมูลได้');
    if (this.cloud) {
      // ไฟล์จากที่เก็บอื่นใช้ข้ามระบบไม่ได้ ส่งไปเฉพาะลิงก์
      await this.backend.importAll({ ...d, files: (d.files || []).filter((f) => f.mime === 'link') }, onProgress);
      await this.refresh();
      return;
    }
    if (replace) this.data = { ...emptyData(), ...d };
    else {
      for (const t of TABLES) for (const x of d[t] || []) this._upsert(t, x);
      this.data.settings = { ...this.data.settings, ...(d.settings || {}) };
    }
    this._commit();
  },

  localCount() { return (readJSON(K_DATA) || {}).projects?.length || 0; },

  /** ย้ายข้อมูลจากโหมดทดลองขึ้นที่เก็บออนไลน์ที่เชื่อมต่ออยู่ */
  async migrateLocalToCloud(onProgress = () => {}) {
    const local = { ...emptyData(), ...(readJSON(K_DATA) || {}) };
    if (!local.projects.length) throw new Error('ไม่มีข้อมูลในโหมดทดลองให้ย้าย');
    onProgress('กำลังส่งข้อมูลโครงการ BOQ บันทึกความคืบหน้า และเรื่องขออนุมัติ…');
    const res = await this.backend.importAll({
      projects: local.projects, boq: local.boq, updates: local.updates, settings: local.settings,
      subs: local.subs, reqs: local.reqs,
      files: local.files.filter((f) => f.mime === 'link'),
    }, onProgress);
    const idMap = res?.projectIds || {};
    await this.refresh();
    const blobs = local.files.filter((f) => f.localBlob);
    let i = 0;
    for (const f of blobs) {
      i++;
      onProgress(`กำลังอัปโหลดไฟล์ ${i}/${blobs.length}: ${f.name}`);
      const blob = await idb.get(f.id).catch(() => null);
      if (!blob) continue;
      const file = new File([blob], f.name, { type: f.mime });
      if (file.size > this.maxUploadBytes()) continue;
      const pid = idMap[f.projectId] || f.projectId;
      await this.backend.uploadFile({
        project: this.project(pid), projectId: pid, category: f.category, file, note: f.note || '',
        updateId: f.updateId || '', subId: f.subId || '', by: f.uploadedBy, byEmail: f.uploadedByEmail, id: f.id,
      });
    }
    await this.refresh();
  },

  /** โหลดข้อมูลตัวอย่าง (เฉพาะโหมดทดลอง) */
  loadDemo(demo) {
    for (const t of TABLES) if (demo[t]) this.data[t].push(...demo[t]);
    this._commit();
  },

  clearLocal() {
    this.data = emptyData();
    this._commit();
    idb.clear().catch(() => {});
    this.clearOutbox();
  },
};

export { version as dataVersion };
