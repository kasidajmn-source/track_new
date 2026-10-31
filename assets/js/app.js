// จุดเริ่มต้นของแอป: โครงหน้าจอ, เส้นทาง (hash router), การเชื่อมต่อ
import { store, conf, saveConf, testConnection, backendFor } from './store.js';
import { icon, esc, toast, runCleanups, guard, openModal, setBusy } from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderProjects } from './views/projects.js';
import { renderProject } from './views/project.js';
import { renderSummary } from './views/summary.js';
import { renderSettings, applyTheme } from './views/settings.js';
import { renderInbox, inboxCount } from './views/inbox.js';
import { renderHelp } from './views/help.js';
import { openLogin } from './views/login.js';
import { loadDemoData } from './views/common.js';
import { msAuth } from './backends/ms-auth.js';
import { spScopes } from './backends/sharepoint.js';
import { odScopes } from './backends/onedrive.js';

const view = document.getElementById('view');

const NAV = [
  ['home', '#/', 'home', 'หน้าหลัก'],
  ['inbox', '#/inbox', 'inbox', 'งานของฉัน'],
  ['projects', '#/projects', 'grid', 'โครงการ'],
  ['summary', '#/summary', 'chart', 'สรุปผู้บริหาร'],
  ['settings', '#/settings', 'sliders', 'ตั้งค่า'],
  ['help', '#/help', 'book', 'คู่มือ', 'side'],
];

const BRAND = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
  <rect x="10" y="2" width="12" height="28" rx="1.5" class="bm-staff"/>
  <path class="bm-e" d="M10 5h6v1.6h-6zM10 8.2h4v1.6h-4zM10 11.4h6v1.6h-6zM16 14.6h6v1.6h-6zM18 17.8h4v1.6h-4zM16 21h6v1.6h-6zM10 24.2h6v1.6h-6z"/>
</svg>`;

function renderShell() {
  document.getElementById('side').innerHTML = `
    <a class="brand" href="#/">${BRAND}<span class="brand-text"><b>ติดตามโครงการ</b><small id="brand-org"></small></span></a>
    <nav class="nav" aria-label="เมนูหลัก">${NAV.map(([k, h, ic, l]) => `<a href="${h}" data-nav="${k}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav>
    <div class="side-foot"><a href="#/settings" id="conn" class="conn"></a></div>`;
  document.getElementById('tabbar').innerHTML = NAV.filter((n) => n[4] !== 'side').map(([k, h, ic, l]) => `<a href="${h}" data-nav="${k}">${icon(ic)}<span>${l}</span></a>`).join('');
  updateConn();
}

function updateConn() {
  const c = document.getElementById('conn');
  if (!c) return;
  const cloud = store.cloud;
  const me = store.me;
  const who = me.email ? `${me.name && me.name !== me.email ? `${me.name} · ` : ''}${me.email}` : (conf.user || 'ยังไม่ได้ระบุอีเมล');
  c.className = `conn ${cloud ? (store.online ? 'is-on' : 'is-off') : 'is-local'}`;
  c.title = `${who}${me.isAdmin ? ' (ผู้ดูแลระบบ)' : ''}`;
  const state = store.needLogin ? `${store.backendLabel} · ยังไม่ได้เข้าสู่ระบบ` : store.online ? store.backendLabel : `${store.backendLabel} (ออฟไลน์)`;
  c.innerHTML = `${icon(cloud ? 'cloud' : 'device')}<span><b>${cloud ? state : 'โหมดทดลอง'}</b><small>${esc(store.needLogin ? 'กดเพื่อตั้งค่าการเชื่อมต่อ' : who)}</small></span>`;
  const org = document.getElementById('brand-org');
  if (org) org.textContent = store.settings.orgName || 'เอกสารและความคืบหน้างานก่อสร้าง';
  updateBadges();
  // แถบแจ้งเมื่อทดลองใช้งานในนามผู้อื่น (โหมดทดลอง)
  let pill = document.getElementById('actas');
  if (!cloud && conf.actAs) {
    if (!pill) { pill = document.createElement('div'); pill.id = 'actas'; pill.className = 'actas'; document.body.appendChild(pill); }
    pill.innerHTML = `${icon('user')}<span>ทดลองในนาม <b>${esc(me.name || me.email)}</b></span><button class="btn btn-sm" data-act="me">กลับเป็นตัวเอง</button>`;
    pill.querySelector('[data-act="me"]').onclick = () => { conf.actAs = ''; saveConf(); updateConn(); route(); };
  } else pill?.remove();
}
window.addEventListener('pt:conn', updateConn);
window.addEventListener('pt:data', () => updateBadges());

function updateBadges() {
  let n = 0;
  try { n = inboxCount(); } catch { n = 0; }
  document.querySelectorAll('[data-nav="inbox"]').forEach((a) => {
    let b = a.querySelector('.nav-badge');
    if (!n) { b?.remove(); return; }
    if (!b) { b = document.createElement('em'); b.className = 'nav-badge'; a.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n);
  });
}

// ---------- เส้นทาง ----------
const routes = [
  [/^#\/?$/, () => renderDashboard(view), 'home'],
  [/^#\/inbox\/?$/, () => renderInbox(view), 'inbox'],
  [/^#\/projects\/?$/, () => renderProjects(view), 'projects'],
  [/^#\/p\/([^/?]+)(?:\/([^/?]+))?(?:\/([^?]+))?/, (m) => renderProject(view, m[1], m[2], m[3]), 'projects'],
  [/^#\/summary\/?$/, () => renderSummary(view), 'summary'],
  [/^#\/settings\/?$/, () => renderSettings(view), 'settings'],
  [/^#\/help\/?$/, () => renderHelp(view), 'help'],
];

const baseOf = (h) => (h || '#/').split('/').slice(0, 3).join('/');
let current = location.hash || '#/';

function route() {
  runCleanups();
  const h = location.hash || '#/';
  if (store.needLogin && store.mode === 'gas' && !h.startsWith('#/settings') && !h.startsWith('#/help')) {
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.remove('is-on'));
    window.dispatchEvent(new Event('pt:login-cancel'));
    return;
  }
  for (const [re, fn, nav] of routes) {
    const m = h.match(re);
    if (!m) continue;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-on', a.dataset.nav === nav));
    try { fn(m); } catch (e) {
      console.error(e);
      view.innerHTML = `<section class="panel"><div class="empty"><div class="empty-ic">${icon('alert')}</div><h3>แสดงหน้านี้ไม่ได้</h3><p>${esc(e.message)}</p><a class="btn" href="#/">กลับหน้าหลัก</a></div></section>`;
    }
    updateBadges();
    return;
  }
  view.innerHTML = `<section class="panel"><div class="empty"><div class="empty-ic">${icon('search')}</div><h3>ไม่พบหน้าที่ต้องการ</h3><a class="btn" href="#/">กลับหน้าหลัก</a></div></section>`;
}

window.addEventListener('hashchange', () => {
  const next = location.hash || '#/';
  if (next.startsWith('#/connect')) { handleConnect(); return; }
  if (guard.dirty && next !== current) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
      history.replaceState(null, '', current);
      return;
    }
    guard.dirty = false;
    window.dispatchEvent(new Event('pt:discard'));
  }
  const jump = baseOf(next) !== baseOf(current);
  current = next;
  route();
  if (jump) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
});
window.addEventListener('beforeunload', (e) => { if (guard.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- ลิงก์เชิญ ----------
// Google:     #/connect?u=<URL เว็บแอป>&k=<รหัส>
// SharePoint: #/connect?sp=1&t=<tenant>&c=<client id>&s=<site url>&f=<โฟลเดอร์>&m=<all|selected>
// OneDrive:   #/connect?od=1&t=<tenant>&c=<client id>&d=<drive id>&i=<item id>&n=<ชื่อโฟลเดอร์>&f=<ลิงก์โฟลเดอร์>
async function handleConnect() {
  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const isOd = q.get('od') === '1';
  const isSp = q.get('sp') === '1' || isOd;
  const url = q.get('u'), key = q.get('k') || '';
  history.replaceState(null, '', `${location.pathname}#/`);
  current = '#/';
  if (!isSp && !url) { route(); return; }
  const where = isOd ? `OneDrive (โฟลเดอร์ ${q.get('n') || 'ที่แชร์ให้คุณ'})` : isSp ? 'SharePoint (Microsoft 365)' : 'Google Drive';
  const m = openModal({
    title: 'เชื่อมต่อฐานข้อมูลของทีม',
    dismissable: false,
    body: `<p>ลิงก์นี้จะเชื่อมต่อแอปบนเครื่องนี้กับข้อมูลโครงการของทีมใน ${where}</p>
      ${isOd ? '<p class="hint">กด "เชื่อมต่อ" แล้วลงชื่อเข้าใช้ด้วยบัญชี Microsoft ที่ได้รับแชร์โฟลเดอร์ — ใช้อีเมลเดียวกับที่เจ้าของโครงการแต่งตั้งไว้</p>'
        : isSp ? '<p class="hint">กด "เชื่อมต่อ" แล้วลงชื่อเข้าใช้ด้วยบัญชีองค์กรในหน้าต่างของ Microsoft — คุณต้องเป็นสมาชิกของไซต์ SharePoint นั้น</p>' : ''}
      <label class="field"><span>ชื่อของคุณ (แสดงในบันทึกที่คุณสร้าง)</span><input id="cn-name" value="${esc(conf.user)}" placeholder="เช่น นายช่างสมชาย" autofocus></label>`,
    footer: '<button class="btn" data-close>ไม่เชื่อมต่อ</button><button class="btn btn-primary" data-go>เชื่อมต่อ</button>',
  });
  const go = m.el.querySelector('[data-go]');
  go.addEventListener('click', async () => {
    const name = m.el.querySelector('#cn-name').value.trim() || conf.user;
    setBusy(go, true, 'กำลังเชื่อมต่อ…');
    try {
      if (isOd) {
        const prev = { mode: conf.mode, od: { ...conf.od } };
        Object.assign(conf.od, {
          tenant: q.get('t') || 'organizations', clientId: q.get('c') || '', driveId: q.get('d') || '', itemId: q.get('i') || '',
          folder: q.get('f') || 'ProjectTracker',
        });
        const odb = backendFor('onedrive');
        try {
          odb.account();
          const login = msAuth.signedIn() && msAuth.hasScopes(odScopes()) ? null : msAuth.loginPopup(odScopes(), { prompt: 'select_account' });
          if (login) await login;
          const info = await odb.probe();
          if (!info.ready) throw new Error('โฟลเดอร์นี้ยังไม่ได้ตั้งค่า — ให้ผู้ดูแลเชื่อมต่อและกด "สร้างโฟลเดอร์ข้อมูล" ก่อน');
        } catch (e) { Object.assign(conf, prev); throw e; }
        Object.assign(conf, { mode: 'onedrive', user: name, onboarded: true });
      } else if (isSp) {
        const prev = { mode: conf.mode, sp: { ...conf.sp } };
        Object.assign(conf.sp, {
          tenant: q.get('t') || '', clientId: q.get('c') || '', site: q.get('s') || '',
          folder: q.get('f') || 'ProjectTracker', scopeMode: q.get('m') === 'selected' ? 'selected' : 'all',
        });
        const sp = backendFor('sharepoint');
        try {
          sp.account(); // ตั้งค่าตัวลงชื่อเข้าใช้ตาม tenant/client id ใหม่
          // เปิด pop-up ทันทีในจังหวะคลิก (ถ้ามี await ก่อนหน้า เบราว์เซอร์จะบล็อก)
          const login = msAuth.signedIn() ? null : msAuth.loginPopup(spScopes(), { prompt: 'select_account' });
          if (login) await login;
          const info = await sp.probe();
          if (info.missing.length) throw new Error('ไซต์นี้ยังไม่ได้ตั้งค่ารายการข้อมูล — ให้ผู้ดูแลเปิดหน้าตั้งค่าแล้วกด "สร้างรายการข้อมูลในไซต์" ก่อน');
        } catch (e) { Object.assign(conf, prev); throw e; }
        Object.assign(conf, { mode: 'sharepoint', user: name, onboarded: true });
      } else {
        await testConnection(url, key);
        if (conf.url !== url) conf.token = '';
        Object.assign(conf, { mode: 'gas', url, key, user: name, onboarded: true });
      }
      saveConf();
      m.close();
      await initWithLogin();
      updateConn();
      toast('เชื่อมต่อข้อมูลของทีมแล้ว');
      route();
    } catch (e) {
      toast(e.message, 'bad', 8000);
      setBusy(go, false);
    }
  });
  m.el.querySelector('[data-close]')?.addEventListener('click', () => route());
}

/** โหลดข้อมูล — ถ้าเซิร์ฟเวอร์ต้องการให้เข้าสู่ระบบ (Google 1.0.1) จะเปิดหน้าต่างเข้าสู่ระบบก่อน */
async function initWithLogin() {
  try {
    await store.init();
  } catch (e) {
    if (e.code !== 'login') throw e;
    store.forget();
    store.needLogin = true;
    updateConn();
    view.innerHTML = `<div class="loading">${icon('lock')}กรุณาเข้าสู่ระบบ</div>`;
    await openLogin();
    view.innerHTML = `<div class="loading"><span class="spin"></span>กำลังโหลดข้อมูล…</div>`;
    await store.init();
  }
  store.needLogin = false;
}
window.addEventListener('pt:login-cancel', () => {
  view.innerHTML = `<section class="panel"><div class="empty"><div class="empty-ic">${icon('lock')}</div><h3>ยังไม่ได้เข้าสู่ระบบ</h3>
    <p>ข้อมูลโครงการของทีมเก็บใน Google Drive ต้องยืนยันอีเมลก่อนจึงจะเห็นโครงการที่คุณเป็นสมาชิก</p>
    <div class="empty-actions"><button class="btn btn-primary" data-act="login">${icon('mail')}เข้าสู่ระบบด้วยอีเมล</button><a class="btn" href="#/settings">ตั้งค่าการเชื่อมต่อ</a></div></div></section>`;
  view.querySelector('[data-act="login"]').addEventListener('click', () => window.dispatchEvent(new Event('pt:relogin')));
});
window.addEventListener('pt:relogin', async () => {
  try { await initWithLogin(); updateConn(); route(); } catch (e) { toast(e.message, 'bad', 8000); }
});

// ---------- ต้อนรับผู้ใช้ใหม่ ----------
function welcome() {
  const m = openModal({
    title: 'ยินดีต้อนรับ',
    size: 'md',
    body: `<div class="welcome">
      <p>ระบบนี้ใช้รวบรวมเอกสารของแต่ละโครงการ ติดตามความคืบหน้าจาก BOQ รายสัปดาห์ และสรุปภาพรวมให้หัวหน้านำไปนำเสนอ</p>
      <div class="form-grid">
        <label class="field"><span>ชื่อของคุณ</span><input id="wc-name" value="${esc(conf.user)}" placeholder="เช่น นายช่างสมชาย" autofocus></label>
        <label class="field"><span>อีเมล <small class="muted">(ใช้ระบุสิทธิ์ในโครงการ)</small></span><input id="wc-email" type="email" value="${esc(conf.email)}" placeholder="name@egat.co.th"></label>
      </div>
      <div class="opt-cards">
        <button class="opt opt-btn" data-pick="demo"><span><b>ลองด้วยข้อมูลตัวอย่าง</b><small>เปิดดูระบบพร้อมโครงการตัวอย่าง 4 โครงการ มีสมาชิก เรื่องขออนุมัติ และแผนงาน ลองสลับบทบาทได้ที่หน้าตั้งค่า</small></span></button>
        <button class="opt opt-btn" data-pick="empty"><span><b>เริ่มแบบว่าง</b><small>สร้างโครงการของคุณเองในโหมดทดลอง (เก็บในเบราว์เซอร์)</small></span></button>
        <button class="opt opt-btn" data-pick="cloud"><span><b>เชื่อมต่อ Google Drive, SharePoint หรือ OneDrive</b><small>ใช้งานจริงร่วมกับทีม ต้องตั้งค่าที่เก็บข้อมูลก่อนตามคู่มือ</small></span></button>
      </div>
    </div>`,
  });
  m.el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    conf.user = m.el.querySelector('#wc-name').value.trim() || conf.user;
    const em = m.el.querySelector('#wc-email').value.trim().toLowerCase();
    if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) conf.email = em;
    conf.onboarded = true;
    saveConf();
    updateConn();
    const pick = b.dataset.pick;
    m.close();
    if (pick === 'demo') { loadDemoData(); location.hash = '#/'; route(); }
    else if (pick === 'cloud') location.hash = '#/settings';
  }));
}

// ---------- ซิงก์อัตโนมัติเมื่อกลับมาที่แท็บ ----------
let syncing = false;
async function autoSync() {
  if (!store.cloud || syncing || guard.dirty || document.querySelector('.modal-wrap, .present')) return;
  if (store.lastSync && Date.now() - store.lastSync < 120000) return;
  syncing = true;
  try { await store.refresh(); updateConn(); if (!guard.dirty) route(); } catch (e) {
    if (e.code === 'login') { syncing = false; window.dispatchEvent(new Event('pt:relogin')); return; }
    store.online = false; updateConn();
  }
  syncing = false;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSync(); });

// ---------- เริ่มต้น ----------
async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  renderShell();
  if ((location.hash || '').startsWith('#/connect')) {
    try { await store.init(); } catch { /* ignore */ }
    updateConn();
    handleConnect();
    return;
  }
  if (store.cloud) view.innerHTML = `<div class="loading"><span class="spin"></span>กำลังโหลดข้อมูลจาก ${esc(store.backendLabel)}…</div>`;
  try {
    await initWithLogin();
  } catch (e) {
    if (e.code === 'setup_required') {
      toast(e.message, 'bad', 9000);
      if (!location.hash.startsWith('#/settings')) location.hash = '#/settings';
    } else if (e.code === 'login_required') {
      toast('ยังไม่ได้ลงชื่อเข้าใช้ Microsoft — แสดงข้อมูลที่บันทึกไว้ล่าสุด กด "ดึงข้อมูลล่าสุด" ที่หน้าตั้งค่าเพื่อลงชื่อเข้าใช้', 'info', 9000);
    } else {
      toast(`${e.message} — แสดงข้อมูลที่บันทึกไว้ล่าสุดแทน`, 'bad', 8000);
    }
  }
  updateConn();
  current = location.hash || '#/';
  route();
  if (!conf.onboarded && !store.cloud && !store.data.projects.length) welcome();
}

boot();
