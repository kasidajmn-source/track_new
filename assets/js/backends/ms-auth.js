// ลงชื่อเข้าใช้ Microsoft 365 (Microsoft Entra ID) แบบ OAuth 2.0 Authorization Code + PKCE ผ่านหน้าต่าง pop-up
// - ไม่มีความลับฝังในหน้าเว็บ (เป็น Single-page application ตามแนวทางของ Microsoft)
// - refresh token ของ SPA ใช้ได้ 24 ชั่วโมง หลังจากนั้นต้องกดลงชื่อเข้าใช้ใหม่ (มักผ่านอัตโนมัติถ้ายังล็อกอิน Microsoft อยู่)
import { openModal, esc, icon, setBusy } from '../ui.js';

const K_TOK = 'pt.msauth.v1';
const AUTH_HOST = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/';
const OIDC = ['openid', 'profile', 'offline_access'];

export class LoginRequiredError extends Error {
  constructor(msg = 'ยังไม่ได้ลงชื่อเข้าใช้ Microsoft') { super(msg); this.code = 'login_required'; }
}

/** หน้า auth.html ที่อยู่โฟลเดอร์เดียวกับ index.html — ต้องลงทะเบียนเป็น Redirect URI แบบ SPA */
export function redirectUri() {
  return new URL('auth.html', location.href.split('#')[0]).href;
}

const fullScope = (s) => (s.startsWith('http') || OIDC.includes(s) ? s : GRAPH + s);
const shortScope = (s) => s.replace(GRAPH, '').toLowerCase();

// เก็บโทเค็นแยกตามแอป (tenant|client id) — SharePoint และ OneDrive ใช้แอปคนละตัวได้ โดยไม่ลบโทเค็นของกันและกัน
let curKey = '';
function loadAll() {
  try {
    const v = JSON.parse(localStorage.getItem(K_TOK) || 'null');
    if (v && v.at !== undefined && v.key) return { [v.key]: v }; // รูปแบบเดิม (1.0.1)
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}
function load() { return curKey ? loadAll()[curKey] || null : null; }
function save(t) {
  if (!curKey) return;
  try {
    const all = loadAll();
    if (t) all[curKey] = t; else delete all[curKey];
    if (Object.keys(all).length) localStorage.setItem(K_TOK, JSON.stringify(all)); else localStorage.removeItem(K_TOK);
  } catch { /* ignore */ }
}

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => chars[x % chars.length]).join('');
}
function parseJwt(t) {
  try {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(p + '==='.slice((p.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { return {}; }
}

/** แปลงข้อผิดพลาดของ Microsoft Entra เป็นข้อความที่บอกวิธีแก้ */
export function describeAuthError(code, desc = '') {
  const d = String(desc || '');
  if (/AADSTS50011/.test(d)) return `Redirect URI ไม่ตรงกับที่ลงทะเบียนไว้ — ให้เพิ่ม ${redirectUri()} ในหัวข้อ Single-page application ของ App registration`;
  if (/AADSTS9002326|AADSTS9002327/.test(d)) return 'Redirect URI ต้องลงทะเบียนในหัวข้อ "Single-page application" ไม่ใช่ "Web"';
  if (/AADSTS700016/.test(d)) return 'ไม่พบแอปในองค์กรนี้ — ตรวจสอบ Application (client) ID และ Tenant';
  if (/AADSTS90002|AADSTS90013/.test(d)) return 'ไม่พบ Tenant — ตรวจสอบช่อง Tenant (โดเมนองค์กร หรือ Tenant ID)';
  if (/AADSTS65001|AADSTS90094|AADSTS90008|consent/i.test(d) || code === 'consent_required') {
    return 'แอปนี้ยังไม่ได้รับอนุมัติสิทธิ์ (admin consent) — ให้ผู้ดูแลระบบกด "Grant admin consent" ใน App registration ตามคู่มือ';
  }
  if (/AADSTS50020|AADSTS50034/.test(d)) return 'บัญชีนี้ไม่ได้อยู่ในองค์กรที่ตั้งค่าไว้ — ลงชื่อเข้าใช้ด้วยบัญชีองค์กร';
  if (/AADSTS53003|AADSTS50105/.test(d)) return 'นโยบายขององค์กรไม่อนุญาตให้บัญชีนี้ใช้แอป — ติดต่อผู้ดูแลระบบ';
  if (code === 'access_denied') return 'ยกเลิกการลงชื่อเข้าใช้';
  if (code === 'invalid_grant' || code === 'interaction_required' || code === 'login_required') return 'เซสชัน Microsoft หมดอายุ — ลงชื่อเข้าใช้อีกครั้ง';
  const short = d.split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, '');
  return `ลงชื่อเข้าใช้ไม่สำเร็จ (${code || 'error'})${short ? `: ${short}` : ''}`;
}

function authError(code, desc) {
  const e = new Error(describeAuthError(code, desc));
  e.code = code;
  e.detail = desc;
  return e;
}

/** รอผลจากหน้า auth.html (รองรับทั้ง BroadcastChannel, postMessage และ localStorage) */
function waitForRedirect(state, popup, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearInterval(poll); clearTimeout(timer);
      try { bc?.close(); } catch { /* ignore */ }
      window.removeEventListener('message', onMsg);
      window.removeEventListener('storage', onStorage);
      try { popup?.close(); } catch { /* ignore */ }
      fn(v);
    };
    const check = (url) => {
      try { if (url && new URL(url).searchParams.get('state') === state) finish(resolve, url); } catch { /* ignore */ }
    };
    const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'pt-auth') check(e.data.url); };
    const onStorage = (e) => {
      if (e.key === 'pt.auth.result' && e.newValue) { try { check(JSON.parse(e.newValue).url); } catch { /* ignore */ } }
    };
    let bc = null;
    try { bc = new BroadcastChannel('pt-auth'); bc.onmessage = (e) => { if (e.data?.type === 'pt-auth') check(e.data.url); }; } catch { /* ignore */ }
    window.addEventListener('message', onMsg);
    window.addEventListener('storage', onStorage);
    const poll = setInterval(() => {
      try { if (popup && popup.location.origin === location.origin && popup.location.search) check(popup.location.href); } catch { /* ข้ามโดเมนระหว่างล็อกอิน */ }
      try {
        const r = JSON.parse(localStorage.getItem('pt.auth.result') || 'null');
        if (r && Date.now() - r.t < 600000) check(r.url);
      } catch { /* ignore */ }
    }, 400);
    const timer = setTimeout(() => finish(reject, new Error('หมดเวลารอการลงชื่อเข้าใช้')), 10 * 60 * 1000);
    signal?.addEventListener('abort', () => finish(reject, new LoginRequiredError('ยกเลิกการลงชื่อเข้าใช้')));
  });
}

let tok = null;
let pending = null;

export const msAuth = {
  cfg: { tenant: 'organizations', clientId: '' },

  configure({ tenant, clientId }) {
    this.cfg = { tenant: (tenant || 'organizations').trim(), clientId: (clientId || '').trim() };
    const key = `${this.cfg.tenant}|${this.cfg.clientId}`;
    if (curKey !== key) { curKey = key; tok = load(); }
  },

  account() { return tok?.account || null; },
  signedIn() { return !!(tok?.rt && tok.rtExp > Date.now()); },
  grantedScopes() { return (tok?.scope || '').split(/\s+/).filter(Boolean).map(shortScope); },
  hasScopes(scopes) {
    const g = this.grantedScopes();
    return scopes.every((s) => OIDC.includes(s) || g.includes(shortScope(fullScope(s))));
  },
  signOut() { tok = null; save(null); },
  invalidateAccess() { if (tok) { tok.exp = 0; save(tok); } },

  _endpoint(path) { return `${AUTH_HOST}/${encodeURIComponent(this.cfg.tenant)}/oauth2/v2.0/${path}`; },

  async _tokenRequest(params) {
    let res;
    try {
      res = await fetch(this._endpoint('token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.cfg.clientId, ...params }),
      });
    } catch {
      throw new Error('เชื่อมต่อ login.microsoftonline.com ไม่ได้ — ตรวจสอบอินเทอร์เน็ต');
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw authError(j.error || `http_${res.status}`, j.error_description);
    const now = Date.now();
    const claims = j.id_token ? parseJwt(j.id_token) : {};
    tok = {
      key: `${this.cfg.tenant}|${this.cfg.clientId}`,
      at: j.access_token,
      exp: now + (+j.expires_in || 3600) * 1000,
      rt: j.refresh_token || tok?.rt,
      // refresh token ของ SPA หมดอายุ 24 ชม. นับจากการลงชื่อเข้าใช้ครั้งแรก (การ refresh ไม่ต่ออายุ)
      rtExp: params.grant_type === 'authorization_code' ? now + 23.5 * 3600 * 1000 : (tok?.rtExp || now + 23.5 * 3600 * 1000),
      scope: j.scope || tok?.scope || '',
      account: claims.preferred_username || claims.name
        ? { name: claims.name || '', username: claims.preferred_username || claims.upn || '', tid: claims.tid || '' }
        : tok?.account || null,
    };
    save(tok);
    return tok;
  },

  /** ขอ access token สำหรับ Microsoft Graph — ถ้าจำเป็นจะแสดงหน้าต่างให้กดลงชื่อเข้าใช้ */
  async token(scopes, { interactive = true, reason = '' } = {}) {
    if (!this.cfg.clientId) throw new Error('ยังไม่ได้ตั้งค่า Application (client) ID ของ Microsoft');
    if (tok?.at && tok.exp - 90000 > Date.now() && this.hasScopes(scopes)) return tok.at;
    if (tok?.rt && tok.rtExp > Date.now()) {
      try {
        await this._tokenRequest({
          grant_type: 'refresh_token', refresh_token: tok.rt,
          scope: [...OIDC, ...scopes].map(fullScope).join(' '),
        });
        if (this.hasScopes(scopes)) return tok.at;
      } catch (e) {
        if (!/invalid_grant|interaction_required|consent_required|login_required|invalid_scope/.test(e.code || '')) throw e;
      }
    }
    if (!interactive) throw new LoginRequiredError();
    await this.interactive(scopes, { reason });
    return tok.at;
  },

  /** เปิดหน้าต่างลงชื่อเข้าใช้ — ต้องเรียกจากการคลิกของผู้ใช้โดยตรง (มิฉะนั้นเบราว์เซอร์จะบล็อก pop-up) */
  loginPopup(scopes, { prompt = 'select_account', signal } = {}) {
    if (!this.cfg.clientId) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า Application (client) ID'));
    const w = 520, h = 680;
    const left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - h) / 2);
    const popup = window.open('', 'pt_ms_login', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return Promise.reject(new Error('เบราว์เซอร์บล็อกหน้าต่างลงชื่อเข้าใช้ — อนุญาต pop-up สำหรับเว็บไซต์นี้แล้วลองใหม่'));
    try { popup.document.title = 'Microsoft'; popup.document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">กำลังเปิดหน้าลงชื่อเข้าใช้ Microsoft…</p>'; } catch { /* ignore */ }
    return (async () => {
      const verifier = randomString(64);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const state = randomString(32);
      const q = new URLSearchParams({
        client_id: this.cfg.clientId,
        response_type: 'code',
        redirect_uri: redirectUri(),
        response_mode: 'query',
        scope: [...OIDC, ...scopes].map(fullScope).join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      if (prompt) q.set('prompt', prompt);
      if (tok?.account?.username && prompt !== 'select_account') q.set('login_hint', tok.account.username);
      popup.location.href = `${this._endpoint('authorize')}?${q}`;
      const url = await waitForRedirect(state, popup, signal);
      try { localStorage.removeItem('pt.auth.result'); } catch { /* ignore */ }
      const p = new URL(url).searchParams;
      if (p.get('error')) throw authError(p.get('error'), p.get('error_description'));
      await this._tokenRequest({
        grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(),
        code_verifier: verifier, scope: [...OIDC, ...scopes].map(fullScope).join(' '),
      });
      return this.account();
    })();
  },

  /** แสดงกล่องให้ผู้ใช้กดลงชื่อเข้าใช้ (ใช้เมื่อ token หมดอายุระหว่างใช้งาน) */
  interactive(scopes, { reason = '' } = {}) {
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      let ok = false;
      let ctrl = null;
      const acc = this.account();
      const m = openModal({
        title: 'ลงชื่อเข้าใช้ Microsoft 365',
        size: 'sm',
        dismissable: false,
        body: `<p>${esc(reason || 'ต้องลงชื่อเข้าใช้ด้วยบัญชีองค์กรเพื่อเข้าถึงข้อมูลโครงการใน SharePoint')}</p>
          ${acc ? `<p class="muted">บัญชีล่าสุด: ${esc(acc.username || acc.name)}</p>` : ''}
          <p class="hint">${icon('alert')}ระบบจะเปิดหน้าต่างของ Microsoft ถ้าไม่เห็นหน้าต่าง ให้อนุญาต pop-up สำหรับเว็บไซต์นี้</p>
          <div data-status></div>`,
        footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-login>${icon('user')}ลงชื่อเข้าใช้</button>`,
        onClose: () => { ctrl?.abort(); pending = null; if (!ok) reject(new LoginRequiredError()); },
      });
      const btn = m.el.querySelector('[data-login]');
      btn.addEventListener('click', async () => {
        ctrl = new AbortController();
        setBusy(btn, true, 'รอการลงชื่อเข้าใช้…');
        try {
          await this.loginPopup(scopes, { prompt: acc ? '' : 'select_account', signal: ctrl.signal });
          ok = true;
          pending = null;
          m.close();
          resolve();
        } catch (e) {
          setBusy(btn, false);
          if (e.code !== 'login_required') m.el.querySelector('[data-status]').innerHTML = `<p class="notice notice-bad">${icon('alert')}${esc(e.message)}</p>`;
        }
      });
    });
    return pending;
  },
};
