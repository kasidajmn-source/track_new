// ที่เก็บข้อมูลแบบ Google: Google Sheet + Google Drive ผ่าน Google Apps Script Web App
// ตั้งแต่ 1.0.1 ผู้ใช้เข้าสู่ระบบด้วยอีเมล + รหัสยืนยัน 6 หลัก (OTP) ที่ส่งทางอีเมล
// เซิร์ฟเวอร์ตรวจสิทธิ์ทุกคำสั่งและส่งอีเมลแจ้งเตือนเอง
import { conf, saveConf } from '../config.js';
import { readAsBase64 } from '../ui.js';

async function api(action, payload = {}, { url = conf.url, key = conf.key, timeout = 90000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    // ใช้ text/plain เพื่อให้เป็น "simple request" — Apps Script ไม่รองรับ CORS preflight
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key, token: conf.token || '', user: conf.user, appUrl: location.href.split('#')[0], ...payload }),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch {
      throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ใช่ข้อมูลของระบบ — ตรวจสอบว่า Deploy เป็น Web app และตั้ง "Who has access" เป็น Anyone');
    }
    if (!j.ok) {
      const e = new Error(j.error || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
      e.code = j.code;
      if (j.code === 'login' && conf.token) { conf.token = ''; saveConf(); }
      throw e;
    }
    return j.data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('หมดเวลาเชื่อมต่อ ลองใหม่อีกครั้ง');
    if (e instanceof TypeError) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบ URL ของ Web app และอินเทอร์เน็ต');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export const gasBackend = {
  id: 'gas',
  label: 'Google Drive',
  fileHost: 'Google Drive',
  maxUploadMB: 25,

  configured() { return !!conf.url; },
  test({ url, key }) { return api('ping', {}, { url, key, timeout: 30000 }); },

  // ---------- เข้าสู่ระบบ ----------
  signedIn() { return !!conf.token; },
  requestOtp: (email, opts) => api('requestOtp', { email }, opts),
  async verifyOtp(email, code, name, opts) {
    const r = await api('verifyOtp', { email, code, name }, opts);
    conf.token = r.token;
    conf.email = r.me?.email || email;
    if (r.me?.name) conf.user = r.me.name;
    saveConf();
    return r;
  },
  updateMe: (name) => api('updateMe', { name }),
  async logout() {
    try { if (conf.token) await api('logout', {}, { timeout: 15000 }); } catch { /* ignore */ }
    conf.token = '';
    saveConf();
  },

  async getAll() {
    const d = await api('getAll');
    if (d.meta?.maxUploadMB) this.maxUploadMB = +d.meta.maxUploadMB;
    return d;
  },

  saveProject: (p, { invite = true } = {}) => api('saveProject', { project: p, invite }),
  transferOwner: (projectId, email) => api('transferOwner', { projectId, email }),
  deleteProject: (id) => api('deleteProject', { id }),
  saveBoq: (pid, items) => api('saveBoq', { projectId: pid, items }),
  saveUpdate: (u, opts = {}) => api('saveUpdate', { update: u, ...opts }),
  deleteUpdate: (id) => api('deleteUpdate', { id }),

  async uploadFile({ projectId, category, file, note = '', updateId = '', subId = '', id = '' }) {
    const base64 = await readAsBase64(file);
    return api('uploadFile', {
      projectId, category, note, updateId, subId, fileId: id,
      name: file.name, mime: file.type || 'application/octet-stream', base64,
    }, { timeout: 300000 });
  },
  addLink: ({ projectId, category, name, url, note }) => api('addLink', { projectId, category, name, url, note }),
  updateFile: (id, changes) => api('updateFile', { id, changes }),
  deleteFile: (id) => api('deleteFile', { id }),
  scanDrive: (pid) => api('scanDrive', { projectId: pid }, { timeout: 180000 }),
  saveSettings: (s) => api('saveSettings', { settings: s }),
  importAll: (data) => api('importAll', { data }, { timeout: 300000 }),

  // ---------- เรื่องขออนุมัติ ----------
  createSubmission: (payload) => api('createSubmission', payload, { timeout: 120000 }),
  // ชื่อ action ใช้เป็นชื่อคำสั่งของ API อยู่แล้ว จึงส่งการดำเนินการในชื่อ op
  actSubmission: ({ action: op, ...rest }) => api('actSubmission', { op, ...rest }, { timeout: 120000 }),
  saveRequired: (pid, items) => api('saveRequired', { projectId: pid, items }),

  async fileUrls(rec) {
    if (!rec.driveId) return { open: rec.url, preview: rec.url, download: rec.url };
    return {
      preview: `https://drive.google.com/file/d/${rec.driveId}/preview`,
      download: `https://drive.google.com/uc?export=download&id=${rec.driveId}`,
      open: rec.url || `https://drive.google.com/file/d/${rec.driveId}/view`,
    };
  },
  async thumbUrl(rec) {
    return rec.driveId ? `https://drive.google.com/thumbnail?id=${rec.driveId}&sz=w480` : '';
  },
};
