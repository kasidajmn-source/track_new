// หน้าตั้งค่าระบบ: ที่เก็บข้อมูล (โหมดทดลอง / Google Drive / SharePoint), ผู้ใช้, หน่วยงาน, ประเภทโครงการ,
// หมวดเอกสาร, เกณฑ์สถานะ, สำรองข้อมูล
import { store, conf, saveConf, testConnection, backendFor } from '../store.js';
import { msAuth, redirectUri } from '../backends/ms-auth.js';
import { spScopes, SP_LISTS } from '../backends/sharepoint.js';
import { odScopes } from '../backends/onedrive.js';
import { esc, icon, toast, confirmBox, setBusy, fmt, download, openModal } from '../ui.js';
import { pageHead, loadDemoData } from './common.js';
import { APP_VERSION } from '../defaults.js';
import { openLogin } from './login.js';

const R = globalThis.PTRules;

/** รายชื่ออีเมล (คั่นด้วยจุลภาค/บรรทัดใหม่) → ข้อความสำหรับช่องกรอก */
const listText = (v) => R.parseList(v).join(', ');

export function applyTheme() {
  const t = conf.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : conf.theme;
  document.documentElement.dataset.theme = t;
}

function listEditor(id, items) {
  return `<div class="tags-edit" id="${id}">
    ${items.map((t, i) => `<span class="tag tag-edit">${esc(t)}<button type="button" data-rm="${i}" aria-label="ลบ ${esc(t)}">${icon('x')}</button></span>`).join('')}
    <input placeholder="พิมพ์แล้วกด Enter เพื่อเพิ่ม" aria-label="เพิ่มรายการ">
  </div>`;
}
function bindListEditor(root, arr, onChange) {
  const draw = () => {
    root.outerHTML = listEditor(root.id, arr);
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    arr.splice(+b.dataset.rm, 1);
    const id = root.id; draw(); bindListEditor(document.getElementById(id), arr, onChange); onChange();
  });
  root.querySelector('input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v || arr.includes(v)) { e.target.value = ''; return; }
    arr.push(v);
    const id = root.id; draw();
    const nr = document.getElementById(id); bindListEditor(nr, arr, onChange); nr.querySelector('input').focus(); onChange();
  });
}

export function renderSettings(el) {
  const S = store.settings;
  const types = [...S.projectTypes];
  const cats = [...S.docCategories];
  const hasLocal = store.cloud ? store.localCount() : 0;
  const mode = store.cloud ? conf.mode : 'local';
  const sp = conf.sp;
  // ถามบัญชีของตัวเชื่อมที่ใช้อยู่เป็นลำดับสุดท้าย (ตัวลงชื่อเข้าใช้ Microsoft จะตั้งค่าตามแอปนั้น)
  const od = conf.od;
  const spAcc = mode !== 'onedrive' ? backendFor('sharepoint').account() : null;
  const odAcc = mode === 'onedrive' ? backendFor('onedrive').account() : null;
  const me = store.me;
  const pill = store.cloud
    ? `<span class="conn-pill ${store.online ? 'is-on' : 'is-off'}">${icon('cloud')}${store.online ? `เชื่อมต่อ ${esc(store.backendLabel)}` : `${esc(store.backendLabel)} — เชื่อมต่อไม่ได้`}</span>`
    : `<span class="conn-pill">${icon('device')}โหมดทดลอง (เก็บในเบราว์เซอร์)</span>`;

  el.innerHTML = `
  ${pageHead('ตั้งค่า', `เวอร์ชัน ${APP_VERSION} · <a class="link" href="#/help">${icon('book')}คู่มือการเข้าใช้งานและสิทธิ์</a>`)}
  <div class="settings">

    <section class="panel">
      <header class="panel-head"><h2>ที่เก็บข้อมูล</h2>${pill}</header>
      <div class="opt-cards opt-4">
        <label class="opt"><input type="radio" name="mode" value="local" ${mode === 'local' ? 'checked' : ''}>
          <span><b>โหมดทดลอง</b><small>เก็บในเบราว์เซอร์เครื่องนี้ เหมาะสำหรับทดลองใช้ ข้อมูลไม่แชร์กับคนอื่น</small></span></label>
        <label class="opt"><input type="radio" name="mode" value="gas" ${mode === 'gas' ? 'checked' : ''}>
          <span><b>Google Drive</b><small>ข้อมูลใน Google Sheet ไฟล์ใน Google Drive ผู้ใช้เข้าระบบด้วยอีเมล + รหัสยืนยันทางอีเมล (ผู้รับจ้างภายนอกใช้ได้)</small></span></label>
        <label class="opt"><input type="radio" name="mode" value="sharepoint" ${mode === 'sharepoint' ? 'checked' : ''}>
          <span><b>SharePoint (Microsoft 365)</b><small>ข้อมูลใน SharePoint List ไฟล์ในคลังเอกสารของไซต์ ทุกคนลงชื่อเข้าใช้ด้วยบัญชีองค์กร</small></span></label>
        <label class="opt"><input type="radio" name="mode" value="onedrive" ${mode === 'onedrive' ? 'checked' : ''}>
          <span><b>OneDrive</b><small>ข้อมูลและไฟล์อยู่ในโฟลเดอร์ OneDrive ของผู้ดูแล แชร์ให้ทีม ลงชื่อเข้าใช้ด้วยบัญชี Microsoft</small></span></label>
      </div>

      <div id="cfg-gas" ${mode === 'gas' ? '' : 'hidden'}>
        <div class="form-grid">
          <label class="field span-2"><span>URL ของ Web app (Google Apps Script)</span>
            <input id="c-url" value="${esc(conf.url)}" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false"></label>
          <label class="field"><span>รหัสเข้าใช้งาน (Access key)</span>
            <input id="c-key" value="${esc(conf.key)}" placeholder="ได้จากการรัน setup ใน Apps Script" spellcheck="false" autocomplete="off"></label>
          <div class="field field-actions"><span>&nbsp;</span>
            <div><button type="button" class="btn" data-act="test">ทดสอบการเชื่อมต่อ</button>
            <button type="button" class="btn btn-primary" data-act="connect">${icon('cloud')}บันทึกและเชื่อมต่อ</button></div></div>
        </div>
        <div id="c-result"></div>
        <details class="help">
          <summary>วิธีติดตั้งฝั่ง Google Drive (ทำครั้งเดียวโดยผู้ดูแล)</summary>
          <ol>
            <li>สร้าง Google Sheet ใหม่ใน Drive ของบัญชีที่จะเก็บข้อมูล แล้วเปิดเมนู <b>ส่วนขยาย → Apps Script</b></li>
            <li>คัดลอกโค้ดจากไฟล์ <code>backend/Code.gs</code> ไปวางแทนโค้ดเดิม ใส่ ID โฟลเดอร์ Drive ที่ต้องการในบรรทัด <code>ROOT_FOLDER_ID</code> (เว้นว่างได้ ระบบสร้างให้)</li>
            <li>เลือกฟังก์ชัน <code>setup</code> แล้วกด <b>เรียกใช้</b> อนุญาตสิทธิ์ แล้วดูรหัสเข้าใช้งานในบันทึกการดำเนินการ</li>
            <li>กด <b>ทำให้ใช้งานได้ → การทำให้ใช้งานได้รายการใหม่ → เว็บแอป</b> ตั้ง "ดำเนินการในฐานะ" เป็น <b>ฉัน</b> และ "ผู้ที่มีสิทธิ์เข้าถึง" เป็น <b>ทุกคน</b></li>
            <li>คัดลอก URL ที่ลงท้ายด้วย <code>/exec</code> มาวางด้านบนพร้อมรหัสเข้าใช้งาน</li>
          </ol>
          <p>รายละเอียดเต็มอยู่ในไฟล์ <code>README.md</code> ของโปรเจกต์</p>
        </details>
      </div>

      <div id="cfg-sp" ${mode === 'sharepoint' ? '' : 'hidden'}>
        <div class="form-grid">
          <label class="field"><span>Tenant (โดเมนองค์กร หรือ Tenant ID)</span>
            <input id="sp-tenant" value="${esc(sp.tenant)}" placeholder="เช่น องค์กร.onmicrosoft.com หรือ องค์กร.co.th" spellcheck="false"></label>
          <label class="field"><span>Application (client) ID</span>
            <input id="sp-client" value="${esc(sp.clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellcheck="false" autocomplete="off"></label>
          <label class="field span-2"><span>URL ของไซต์ SharePoint</span>
            <input id="sp-site" value="${esc(sp.site)}" placeholder="https://องค์กร.sharepoint.com/sites/ชื่อไซต์" spellcheck="false"></label>
          <label class="field"><span>โฟลเดอร์เก็บไฟล์ในคลังเอกสารของไซต์</span>
            <input id="sp-folder" value="${esc(sp.folder)}" placeholder="ProjectTracker" spellcheck="false">
            <small class="hint">พิมพ์ชื่อโฟลเดอร์ (สร้างให้อัตโนมัติ) หรือวางลิงก์โฟลเดอร์ที่มีอยู่แล้ว</small></label>
          <label class="field"><span>ระดับสิทธิ์ที่ขอ</span>
            <select id="sp-scope">
              <option value="all" ${sp.scopeMode !== 'selected' ? 'selected' : ''}>Sites.ReadWrite.All (ทั่วไป)</option>
              <option value="selected" ${sp.scopeMode === 'selected' ? 'selected' : ''}>Sites.Selected (เฉพาะไซต์ที่ผู้ดูแลอนุญาต)</option>
            </select>
            <small class="hint">เลือกตามที่ผู้ดูแลระบบอนุมัติไว้</small></label>
          <div class="field span-2"><span>Redirect URI สำหรับลงทะเบียนแอป (แบบ Single-page application)</span>
            <div class="copy-row"><input readonly value="${esc(redirectUri())}" id="sp-redirect"><button type="button" class="btn" data-copy="#sp-redirect">${icon('copy')}คัดลอก</button></div></div>
        </div>
        ${spAcc ? `<p class="acc-line">${icon('user')}<span>ลงชื่อเข้าใช้แล้ว: <b>${esc(spAcc.name || spAcc.username)}</b> ${spAcc.username ? `<small>${esc(spAcc.username)}</small>` : ''}</span><button type="button" class="btn btn-ghost btn-sm" data-act="sp-signout">ออกจากระบบ Microsoft</button></p>` : ''}
        <div class="row-actions">
          <button type="button" class="btn" data-act="sp-check">${icon('user')}ลงชื่อเข้าใช้และตรวจสอบ</button>
          <button type="button" class="btn" data-act="sp-setup" hidden>${icon('database')}สร้างรายการข้อมูลในไซต์</button>
          <button type="button" class="btn btn-primary" data-act="sp-connect">${icon('cloud')}บันทึกและเชื่อมต่อ</button>
        </div>
        <div id="sp-result"></div>
        <details class="help">
          <summary>สิ่งที่ต้องขอจากฝ่าย IT / ผู้ดูแล Microsoft 365 (ทำครั้งเดียว)</summary>
          <ol>
            <li>ลงทะเบียนแอปที่ <b>Microsoft Entra admin center → App registrations → New registration</b> เลือก "Accounts in this organizational directory only"</li>
            <li>ที่ <b>Authentication → Add a platform → Single-page application</b> ใส่ Redirect URI ตามช่องด้านบน</li>
            <li>ที่ <b>API permissions → Microsoft Graph → Delegated</b> เพิ่ม <code>Sites.ReadWrite.All</code> และ <code>Sites.Manage.All</code> (ใช้ตอนสร้างรายการข้อมูลครั้งแรก) แล้วกด <b>Grant admin consent</b>
              — หรือใช้ <code>Sites.Selected</code> แล้วให้สิทธิ์แอปเฉพาะไซต์นี้ระดับ <code>manage</code></li>
            <li>ส่ง <b>Application (client) ID</b> และ <b>Tenant</b> ให้ผู้ใช้ และเพิ่มทีมเป็นสมาชิกของไซต์ SharePoint (สิทธิ์แก้ไข)</li>
            <li>ผู้ตั้งค่าคนแรกกด <b>ลงชื่อเข้าใช้และตรวจสอบ</b> แล้ว <b>สร้างรายการข้อมูลในไซต์</b> ระบบจะสร้างรายการ ${Object.values(SP_LISTS).map((n) => `<code>${n}</code>`).join(' ')}</li>
          </ol>
          <p>รายละเอียดเต็มอยู่ในไฟล์ <code>README.md</code> หัวข้อ SharePoint</p>
        </details>
      </div>

      <div id="cfg-od" ${mode === 'onedrive' ? '' : 'hidden'}>
        <div class="form-grid">
          <label class="field"><span>Tenant</span>
            <input id="od-tenant" value="${esc(od.tenant)}" placeholder="organizations" spellcheck="false" list="od-tenants">
            <datalist id="od-tenants"><option value="organizations">บัญชีองค์กร (Microsoft 365)</option><option value="consumers">บัญชีส่วนตัว (outlook.com / hotmail)</option><option value="common">ได้ทั้งสองแบบ</option></datalist>
            <small class="hint">บัญชีองค์กร: ใส่โดเมนองค์กร เช่น egat.co.th หรือ organizations</small></label>
          <label class="field"><span>Application (client) ID</span>
            <input id="od-client" value="${esc(od.clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellcheck="false" autocomplete="off"></label>
          <label class="field span-2"><span>โฟลเดอร์หลักใน OneDrive</span>
            <input id="od-folder" value="${esc(od.folder)}" placeholder="ProjectTracker" spellcheck="false">
            <small class="hint"><b>ผู้ดูแล</b>: พิมพ์ชื่อโฟลเดอร์ใน OneDrive ของตนเอง (สร้างให้อัตโนมัติ) · <b>สมาชิก</b>: ใช้ "ลิงก์เชิญทีม" จากผู้ดูแล หรือวางลิงก์ของโฟลเดอร์ที่ถูกแชร์มา</small></label>
          <div class="field span-2"><span>Redirect URI สำหรับลงทะเบียนแอป (แบบ Single-page application)</span>
            <div class="copy-row"><input readonly value="${esc(redirectUri())}" id="od-redirect"><button type="button" class="btn" data-copy="#od-redirect">${icon('copy')}คัดลอก</button></div></div>
        </div>
        ${odAcc ? `<p class="acc-line">${icon('user')}<span>ลงชื่อเข้าใช้แล้ว: <b>${esc(odAcc.name || odAcc.username)}</b> ${odAcc.username ? `<small>${esc(odAcc.username)}</small>` : ''}</span><button type="button" class="btn btn-ghost btn-sm" data-act="od-signout">ออกจากระบบ Microsoft</button></p>` : ''}
        <div class="row-actions">
          <button type="button" class="btn" data-act="od-check">${icon('user')}ลงชื่อเข้าใช้และตรวจสอบ</button>
          <button type="button" class="btn" data-act="od-setup" hidden>${icon('folder')}สร้างโฟลเดอร์ข้อมูล</button>
          <button type="button" class="btn btn-primary" data-act="od-connect">${icon('cloud')}บันทึกและเชื่อมต่อ</button>
        </div>
        <div id="od-result"></div>
        <details class="help">
          <summary>วิธีตั้งค่า OneDrive (ทำครั้งเดียวโดยผู้ดูแล)</summary>
          <ol>
            <li>ลงทะเบียนแอปที่ <b>Microsoft Entra admin center → App registrations → New registration</b> (บัญชีส่วนตัว: เลือกประเภทบัญชีที่รวม personal Microsoft accounts)</li>
            <li>ที่ <b>Authentication → Add a platform → Single-page application</b> ใส่ Redirect URI ตามช่องด้านบน</li>
            <li>ที่ <b>API permissions → Microsoft Graph → Delegated</b> เพิ่ม <code>Files.ReadWrite</code> (ผู้ดูแล) และ <code>Files.ReadWrite.All</code> (สมาชิกที่เปิดโฟลเดอร์ที่ถูกแชร์มา) ถ้าจะส่งอีเมลเพิ่ม <code>Mail.Send</code>
              — องค์กรส่วนใหญ่ต้องให้ผู้ดูแล Microsoft 365 กด <b>Grant admin consent</b> สำหรับ <code>Files.ReadWrite.All</code></li>
            <li>ผู้ดูแลใส่ Client ID และชื่อโฟลเดอร์ กด <b>ลงชื่อเข้าใช้และตรวจสอบ</b> → <b>สร้างโฟลเดอร์ข้อมูล</b> → <b>บันทึกและเชื่อมต่อ</b></li>
            <li>เพิ่มสมาชิกในโครงการ แล้วกด <b>ให้สิทธิ์เข้าถึงโฟลเดอร์</b> (ระบบแชร์โฟลเดอร์ให้: แก้ไขได้สำหรับผู้ที่ต้องบันทึก / ดูได้อย่างเดียวสำหรับหัวหน้าและผู้ติดตาม) จากนั้นส่ง <b>ลิงก์เชิญทีม</b></li>
          </ol>
        </details>
      </div>

      ${store.cloud ? `
        <div class="cloud-info">
          ${store.meta.siteUrl ? `<a class="btn" href="${esc(store.meta.siteUrl)}" target="_blank" rel="noopener">${icon('external')}เปิดไซต์ SharePoint</a>` : ''}
          ${store.meta.rootFolderUrl ? `<a class="btn" href="${esc(store.meta.rootFolderUrl)}" target="_blank" rel="noopener">${icon('folder')}เปิดโฟลเดอร์หลักใน ${esc(store.fileHost)}</a>` : ''}
          <button type="button" class="btn" data-act="refresh">${icon('refresh')}ดึงข้อมูลล่าสุด</button>
          <button type="button" class="btn" data-act="invite">${icon('share')}ลิงก์เชิญทีม</button>
          ${store.mode === 'onedrive' && me.isAdmin ? `<button type="button" class="btn" data-act="od-share">${icon('users')}ให้สิทธิ์เข้าถึงโฟลเดอร์</button>` : ''}
          <span class="muted">${store.lastSync ? `ซิงก์ล่าสุด ${store.lastSync.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.` : ''}${store.meta.version ? ` · ระบบหลังบ้านเวอร์ชัน ${esc(store.meta.version)}` : ''}</span>
        </div>
        ${store.legacy ? `<div class="notice notice-warn">${icon('alert')}<div><b>Code.gs ยังเป็นเวอร์ชัน 1.0.0</b><span>วางโค้ด Code.gs เวอร์ชัน 1.0.1 แทนของเดิม รัน setup แล้ว Deploy เวอร์ชันใหม่ เพื่อใช้สมาชิก สิทธิ์ เรื่องขออนุมัติ และอีเมลแจ้งเตือน</span></div></div>` : ''}
        ${store.mode === 'sharepoint' && (store.meta.upgrade || []).length ? `<div class="notice notice-warn">${icon('database')}<div><b>ต้องอัปเดตโครงสร้างข้อมูลในไซต์</b><span>สร้างรายการ ${(store.meta.upgrade || []).map((t) => esc(SP_LISTS[t])).join(', ')} สำหรับเรื่องขออนุมัติ (ต้องมีสิทธิ์จัดการไซต์)</span></div><button type="button" class="btn" data-act="sp-upgrade">อัปเดตโครงสร้างข้อมูลในไซต์</button></div>` : ''}
        ${hasLocal && me.isAdmin ? `<div class="notice">${icon('database')}<div><b>มีข้อมูลในโหมดทดลอง ${hasLocal} โครงการ</b><span>ย้ายขึ้น ${esc(store.backendLabel)} เพื่อแชร์กับทีม (รวมไฟล์ที่อัปโหลดไว้)</span></div><button type="button" class="btn" data-act="migrate">ย้ายข้อมูล</button></div>` : ''}` : ''}
    </section>

    ${accountSection(me)}

    ${systemSection(me, S)}

    ${!store.cloud ? outboxSection() : ''}

    <section class="panel">
      <header class="panel-head"><h2>ค่ากลางของหน่วยงาน</h2><span class="muted">${store.cloud ? 'ใช้ร่วมกันทั้งทีม' : 'เก็บในเครื่องนี้'}${me.isAdmin ? '' : ' · แก้ไขได้เฉพาะผู้ดูแลระบบ'}</span></header>
      <div class="form-grid">
        <label class="field span-2"><span>ชื่อหน่วยงาน/แผนก (แสดงบนหน้าสรุปและสไลด์)</span><input id="org" value="${esc(S.orgName)}" placeholder="เช่น แผนกโยธา กองบำรุงรักษา"></label>
      </div>
      <div class="field"><span>ประเภทโครงการ</span>${listEditor('types', types)}</div>
      <div class="field"><span>หมวดเอกสารเริ่มต้นของโครงการใหม่</span>${listEditor('cats', cats)}</div>
      <div class="form-grid form-grid-3">
        <label class="field"><span>เฝ้าระวังเมื่อตามหลังแผนเกิน (%)</span><input id="th-watch" type="number" step="0.5" min="0" value="${S.watchThreshold}"></label>
        <label class="field"><span>ล่าช้าเมื่อตามหลังแผนเกิน (%)</span><input id="th-behind" type="number" step="0.5" min="0" value="${S.behindThreshold}"></label>
        <label class="field"><span>เตือนเมื่อไม่ได้บันทึกเกิน (วัน)</span><input id="th-stale" type="number" min="1" value="${S.staleDays}"></label>
      </div>
      ${me.isAdmin ? `<div class="save-row"><button type="button" class="btn btn-primary" data-act="save-org">${icon('check')}บันทึกค่ากลาง</button></div>` : ''}
    </section>

    <section class="panel">
      <header class="panel-head"><h2>สำรองและกู้คืนข้อมูล</h2></header>
      <p class="muted">ไฟล์สำรอง (.json) เก็บข้อมูลโครงการ BOQ บันทึกความคืบหน้า และรายชื่อไฟล์ ${store.cloud ? `ตัวไฟล์เอกสารยังอยู่ใน ${esc(store.fileHost)}` : 'ไม่รวมตัวไฟล์ที่อัปโหลดในโหมดทดลอง'}</p>
      <div class="row-actions">
        <button type="button" class="btn" data-act="backup">${icon('download')}ดาวน์โหลดไฟล์สำรอง</button>
        ${me.isAdmin ? `<label class="btn">${icon('upload')}นำเข้าไฟล์สำรอง<input type="file" accept=".json,application/json" hidden id="restore"></label>` : ''}
        ${!store.cloud ? `<button type="button" class="btn" data-act="demo">เพิ่มข้อมูลตัวอย่าง</button>
        <button type="button" class="btn btn-danger" data-act="clear">${icon('trash')}ล้างข้อมูลในเครื่องนี้</button>` : ''}
      </div>
    </section>
  </div>`;

  const notice = (box, tone, html) => { box.innerHTML = `<p class="notice notice-${tone}">${icon(tone === 'ok' ? 'check' : 'alert')}<span>${html}</span></p>`; };
  const afterConnect = async (label) => {
    try {
      try { await store.init(); } catch (ex) {
        if (ex.code !== 'login') throw ex;
        store.forget();
        await openLogin();
        await store.init();
      }
      toast(`เชื่อมต่อ ${label} แล้ว`);
    } catch (ex) { toast(ex.message, 'bad', 7000); }
    window.dispatchEvent(new Event('pt:conn'));
    renderSettings(el);
  };
  el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const inp = el.querySelector(b.dataset.copy);
    try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
    toast('คัดลอกแล้ว');
  }));

  // ---------- เลือกที่เก็บข้อมูล ----------
  const boxes = { gas: el.querySelector('#cfg-gas'), sharepoint: el.querySelector('#cfg-sp'), onedrive: el.querySelector('#cfg-od') };
  el.querySelectorAll('[name="mode"]').forEach((r) => r.addEventListener('change', async () => {
    for (const [k, b] of Object.entries(boxes)) b.hidden = r.value !== k;
    if (r.value !== 'local') return;
    if (store.cloud && await confirmBox({ title: 'กลับไปใช้โหมดทดลอง', message: `หยุดเชื่อมต่อ ${esc(store.backendLabel)} บนเครื่องนี้ และกลับไปใช้ข้อมูลในเบราว์เซอร์? ข้อมูลออนไลน์ไม่ถูกลบ`, ok: 'เปลี่ยนเป็นโหมดทดลอง' })) {
      conf.mode = 'local'; saveConf();
      await store.init();
      window.dispatchEvent(new Event('pt:conn'));
      renderSettings(el);
    } else if (store.cloud) {
      el.querySelector(`[name="mode"][value="${conf.mode}"]`).checked = true;
      boxes[conf.mode].hidden = false;
    }
  }));

  // ---------- Google ----------
  const result = el.querySelector('#c-result');
  const readCfg = () => ({ url: el.querySelector('#c-url').value.trim(), key: el.querySelector('#c-key').value.trim() });
  const check = async (btn) => {
    const { url, key } = readCfg();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      notice(result, 'bad', 'URL ต้องเป็นลิงก์ Web app ของ Google Apps Script (ขึ้นต้นด้วย https://script.google.com/macros/s/ และลงท้ายด้วย /exec)');
      return null;
    }
    setBusy(btn, true, 'กำลังทดสอบ…');
    try {
      const info = await testConnection(url, key);
      notice(result, 'ok', `เชื่อมต่อสำเร็จ — เซิร์ฟเวอร์เวอร์ชัน ${esc(info.version || '')}`);
      return info;
    } catch (e) {
      notice(result, 'bad', esc(e.message));
      return null;
    } finally { setBusy(btn, false); }
  };
  el.querySelector('[data-act="test"]').addEventListener('click', (e) => check(e.currentTarget));
  el.querySelector('[data-act="connect"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await check(btn))) return;
    const cfg = readCfg();
    if (cfg.url !== conf.url) conf.token = '';
    Object.assign(conf, { mode: 'gas', ...cfg });
    saveConf();
    setBusy(btn, true, 'กำลังโหลดข้อมูล…');
    await afterConnect('Google Drive');
  });

  // ---------- SharePoint ----------
  const spResult = el.querySelector('#sp-result');
  const setupBtn = el.querySelector('[data-act="sp-setup"]');
  let spReady = false;
  const readSp = () => ({
    tenant: el.querySelector('#sp-tenant').value.trim(),
    clientId: el.querySelector('#sp-client').value.trim(),
    site: el.querySelector('#sp-site').value.trim(),
    folder: el.querySelector('#sp-folder').value.trim() || 'ProjectTracker',
    scopeMode: el.querySelector('#sp-scope').value,
  });
  const validSp = (c) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.clientId)) return 'Application (client) ID ต้องเป็นรหัสรูปแบบ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx จากหน้า App registration';
    if (!/^https:\/\/[^/]+\.sharepoint\.[a-z.]+(\/|$)/i.test(c.site)) return 'URL ของไซต์ต้องขึ้นต้นด้วย https://ชื่อองค์กร.sharepoint.com/';
    if (!c.tenant) return 'กรุณาระบุ Tenant (โดเมนองค์กร เช่น องค์กร.onmicrosoft.com หรือ Tenant ID)';
    return '';
  };
  const applySp = (c) => {
    Object.assign(conf.sp, c);
    saveConf();
    backendFor('sharepoint').account(); // ตั้งค่าตัวลงชื่อเข้าใช้ตามค่าใหม่
  };
  const showProbe = (info) => {
    const acc = info.account;
    const who = acc ? `${esc(acc.name || acc.username)}${acc.username ? ` (${esc(acc.username)})` : ''}` : '';
    if (info.missing.length) {
      spReady = false;
      setupBtn.hidden = false;
      notice(spResult, 'warn', `พบไซต์ <b>${esc(info.site.name)}</b>${who ? ` — ลงชื่อเข้าใช้เป็น ${who}` : ''}<br>ยังไม่มีรายการข้อมูล ${info.missing.length} รายการ กด <b>สร้างรายการข้อมูลในไซต์</b> (ทำครั้งแรกครั้งเดียว ต้องมีสิทธิ์จัดการไซต์)`);
    } else {
      spReady = true;
      setupBtn.hidden = true;
      notice(spResult, 'ok', `พร้อมใช้งาน — ไซต์ <b>${esc(info.site.name)}</b>${who ? ` ลงชื่อเข้าใช้เป็น ${who}` : ''}`);
    }
  };
  el.querySelector('[data-act="sp-check"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const c = readSp();
    const err = validSp(c);
    if (err) { notice(spResult, 'bad', esc(err)); return; }
    applySp(c);
    // เปิดหน้าต่างลงชื่อเข้าใช้ทันทีในจังหวะคลิก (ถ้ามี await ก่อนหน้า เบราว์เซอร์จะบล็อก pop-up)
    const login = msAuth.signedIn() && msAuth.hasScopes(spScopes()) ? null : msAuth.loginPopup(spScopes(), { prompt: 'select_account' });
    setBusy(btn, true, login ? 'รอการลงชื่อเข้าใช้…' : 'กำลังตรวจสอบ…');
    try {
      if (login) await login;
      btn.innerHTML = '<span class="spin"></span>กำลังตรวจสอบไซต์…';
      showProbe(await backendFor('sharepoint').probe());
    } catch (ex) {
      spReady = false;
      notice(spResult, 'bad', esc(ex.message));
    } finally { setBusy(btn, false); }
  });
  setupBtn.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'กำลังสร้าง…');
    try {
      const r = await backendFor('sharepoint').setup((msg) => { btn.innerHTML = `<span class="spin"></span>${esc(msg)}`; });
      // ผู้ที่ตั้งค่าไซต์ครั้งแรกเป็นผู้ดูแลระบบ (ไม่ปล่อยให้ทุกคนเป็นผู้ดูแล)
      const acc = msAuth.account();
      if (r.created.includes('settings') && acc?.username) await backendFor('sharepoint').saveSettings({ admins: String(acc.username).toLowerCase() });
      showProbe({ site: r.site, missing: [], account: acc });
      toast(`สร้างรายการข้อมูล ${r.created.length} รายการในไซต์แล้ว`);
    } catch (ex) {
      notice(spResult, 'bad', esc(ex.message));
    } finally { setBusy(btn, false); }
  });
  el.querySelector('[data-act="sp-connect"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const c = readSp();
    const err = validSp(c);
    if (err) { notice(spResult, 'bad', esc(err)); return; }
    applySp(c);
    const login = msAuth.signedIn() && msAuth.hasScopes(spScopes()) ? null : msAuth.loginPopup(spScopes(), { prompt: 'select_account' });
    setBusy(btn, true, login ? 'รอการลงชื่อเข้าใช้…' : 'กำลังตรวจสอบ…');
    try {
      if (login) await login;
      if (!spReady) {
        const info = await backendFor('sharepoint').probe();
        showProbe(info);
        if (info.missing.length) { setBusy(btn, false); return; }
      }
      conf.mode = 'sharepoint';
      saveConf();
      btn.innerHTML = '<span class="spin"></span>กำลังโหลดข้อมูล…';
      await afterConnect('SharePoint');
    } catch (ex) {
      notice(spResult, 'bad', esc(ex.message));
      setBusy(btn, false);
    }
  });
  el.querySelector('[data-act="sp-signout"]')?.addEventListener('click', () => {
    backendFor('sharepoint').signOut();
    toast('ออกจากระบบ Microsoft บนเครื่องนี้แล้ว');
    renderSettings(el);
  });

  // ---------- OneDrive ----------
  const odResult = el.querySelector('#od-result');
  const odSetupBtn = el.querySelector('[data-act="od-setup"]');
  let odReady = false;
  const readOd = () => {
    const folder = el.querySelector('#od-folder').value.trim();
    const keepRef = !!od.itemId && (!folder || folder === od.folder); // เชื่อมจากลิงก์เชิญ (ระบุโฟลเดอร์ด้วยรหัส)
    return {
      tenant: el.querySelector('#od-tenant').value.trim() || 'organizations',
      clientId: el.querySelector('#od-client').value.trim(),
      folder: keepRef ? od.folder : (folder || 'ProjectTracker'),
      driveId: keepRef ? od.driveId : '', itemId: keepRef ? od.itemId : '',
    };
  };
  const validOd = (c) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.clientId)) return 'Application (client) ID ต้องเป็นรหัสรูปแบบ xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx จากหน้า App registration';
    if (/^https?:\/\//i.test(c.folder) && !/sharepoint\.com|onedrive\.live\.com|1drv\.ms/i.test(c.folder)) return 'ลิงก์โฟลเดอร์ต้องเป็นลิงก์ OneDrive (…sharepoint.com/… หรือ onedrive.live.com / 1drv.ms)';
    if (!/^https?:/i.test(c.folder) && /[\\:*?"<>|]/.test(c.folder)) return 'ชื่อโฟลเดอร์มีอักขระที่ OneDrive ไม่รองรับ';
    return '';
  };
  const applyOd = (c) => { Object.assign(conf.od, c); saveConf(); backendFor('onedrive').account(); };
  const showOdProbe = (info) => {
    const acc = info.account;
    const who = acc ? ` — ลงชื่อเข้าใช้เป็น ${esc(acc.name || acc.username)}${acc.username ? ` (${esc(acc.username)})` : ''}` : '';
    if (!info.ready) {
      odReady = false;
      odSetupBtn.hidden = !info.owner;
      notice(odResult, info.owner ? 'warn' : 'bad', info.owner
        ? `พบโฟลเดอร์ <b>${esc(info.root.name)}</b>${who}<br>ยังไม่มีโฟลเดอร์ข้อมูล กด <b>สร้างโฟลเดอร์ข้อมูล</b> (ครั้งแรกครั้งเดียว — คุณจะเป็นผู้ดูแลระบบ)`
        : `โฟลเดอร์ <b>${esc(info.root.name)}</b> ยังไม่ได้ตั้งค่าโดยผู้ดูแล — ให้เจ้าของโฟลเดอร์เชื่อมต่อและสร้างโฟลเดอร์ข้อมูลก่อน`);
    } else {
      odReady = true;
      odSetupBtn.hidden = true;
      notice(odResult, 'ok', `พร้อมใช้งาน — โฟลเดอร์ <b>${esc(info.root.name)}</b>${info.owner ? ' (OneDrive ของคุณ — คุณเป็นผู้ดูแลระบบ)' : ''}${who}`);
    }
  };
  const odLogin = () => (msAuth.signedIn() && msAuth.hasScopes(odScopes()) ? null : msAuth.loginPopup(odScopes(), { prompt: 'select_account' }));
  el.querySelector('[data-act="od-check"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const c = readOd();
    const err = validOd(c);
    if (err) { notice(odResult, 'bad', esc(err)); return; }
    applyOd(c);
    const login = odLogin();
    setBusy(btn, true, login ? 'รอการลงชื่อเข้าใช้…' : 'กำลังตรวจสอบ…');
    try {
      if (login) await login;
      btn.innerHTML = '<span class="spin"></span>กำลังตรวจสอบโฟลเดอร์…';
      showOdProbe(await backendFor('onedrive').probe());
    } catch (ex) {
      odReady = false;
      notice(odResult, 'bad', esc(ex.message));
    } finally { setBusy(btn, false); }
  });
  odSetupBtn.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'กำลังสร้าง…');
    try {
      await backendFor('onedrive').setup((msg) => { btn.innerHTML = `<span class="spin"></span>${esc(msg)}`; });
      showOdProbe(await backendFor('onedrive').probe());
      toast('สร้างโฟลเดอร์ข้อมูลใน OneDrive แล้ว');
    } catch (ex) { notice(odResult, 'bad', esc(ex.message)); } finally { setBusy(btn, false); }
  });
  el.querySelector('[data-act="od-connect"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const c = readOd();
    const err = validOd(c);
    if (err) { notice(odResult, 'bad', esc(err)); return; }
    applyOd(c);
    const login = odLogin();
    setBusy(btn, true, login ? 'รอการลงชื่อเข้าใช้…' : 'กำลังตรวจสอบ…');
    try {
      if (login) await login;
      if (!odReady) {
        const info = await backendFor('onedrive').probe();
        showOdProbe(info);
        if (!info.ready) { setBusy(btn, false); return; }
      }
      conf.mode = 'onedrive';
      saveConf();
      btn.innerHTML = '<span class="spin"></span>กำลังโหลดข้อมูล…';
      await afterConnect('OneDrive');
    } catch (ex) {
      notice(odResult, 'bad', esc(ex.message));
      setBusy(btn, false);
    }
  });
  el.querySelector('[data-act="od-signout"]')?.addEventListener('click', () => {
    backendFor('onedrive').signOut();
    toast('ออกจากระบบ Microsoft บนเครื่องนี้แล้ว');
    renderSettings(el);
  });
  el.querySelector('[data-act="od-share"]')?.addEventListener('click', () => openOdShare());

  // ---------- ขณะเชื่อมต่อ ----------
  el.querySelector('[data-act="refresh"]')?.addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true, 'กำลังดึงข้อมูล…');
    try { await store.refresh(); toast('อัปเดตข้อมูลล่าสุดแล้ว'); } catch (ex) { toast(ex.message, 'bad'); }
    window.dispatchEvent(new Event('pt:conn'));
    renderSettings(el);
  });
  el.querySelector('[data-act="invite"]')?.addEventListener('click', () => {
    const base = `${location.origin}${location.pathname}#/connect?`;
    const isSp = conf.mode === 'sharepoint' || conf.mode === 'onedrive';
    const ref = conf.mode === 'onedrive' ? store.backend.rootRef() : null;
    const link = conf.mode === 'onedrive'
      ? base + new URLSearchParams({ od: '1', t: od.tenant, c: od.clientId, d: ref?.driveId || od.driveId, i: ref?.itemId || od.itemId, n: ref?.name || '', f: ref?.webUrl || od.folder })
      : isSp
        ? base + new URLSearchParams({ sp: '1', t: sp.tenant, c: sp.clientId, s: sp.site, f: sp.folder, m: sp.scopeMode })
        : `${base}u=${encodeURIComponent(conf.url)}&k=${encodeURIComponent(conf.key)}`;
    const m = openModal({
      title: 'ลิงก์เชิญทีม',
      body: `<p>ส่งลิงก์นี้ให้เพื่อนร่วมทีม เปิดแล้วเชื่อมต่อฐานข้อมูลเดียวกันทันทีโดยไม่ต้องกรอกค่าเอง</p>
        <div class="copy-row"><input readonly value="${esc(link)}" id="inv"><button class="btn btn-primary" data-copy>${icon('copy')}คัดลอก</button></div>
        <p class="hint">${icon('alert')}${isSp
          ? (conf.mode === 'onedrive'
            ? 'ลิงก์นี้ไม่มีรหัสลับ ผู้ที่เปิดต้องลงชื่อเข้าใช้ด้วยบัญชี Microsoft ที่ได้รับแชร์โฟลเดอร์แล้ว (กด "ให้สิทธิ์เข้าถึงโฟลเดอร์" ก่อนส่งลิงก์)'
            : 'ลิงก์นี้ไม่มีรหัสลับ ผู้ที่เปิดต้องลงชื่อเข้าใช้ด้วยบัญชีองค์กรและเป็นสมาชิกของไซต์ SharePoint จึงจะเห็นข้อมูล')
          : 'ลิงก์นี้มีรหัสเข้าใช้งานอยู่ด้วย ส่งเฉพาะคนในทีม หากรหัสหลุด ให้รันฟังก์ชัน resetAccessKey ใน Apps Script แล้วส่งลิงก์ใหม่'}</p>`,
    });
    m.el.querySelector('[data-copy]').addEventListener('click', async () => {
      const inp = m.el.querySelector('#inv');
      try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
      toast('คัดลอกลิงก์แล้ว');
    });
  });
  el.querySelector('[data-act="migrate"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmBox({ title: `ย้ายข้อมูลขึ้น ${store.backendLabel}`, message: `ส่งข้อมูล ${hasLocal} โครงการจากโหมดทดลองขึ้น ${esc(store.backendLabel)}? ระบบจะสร้างโฟลเดอร์ให้แต่ละโครงการ`, ok: 'ย้ายข้อมูล' }))) return;
    setBusy(btn, true, 'กำลังย้าย…');
    try {
      await store.migrateLocalToCloud((msg) => { btn.innerHTML = `<span class="spin"></span>${esc(msg)}`; });
      localStorage.removeItem('pt.data.v1');
      toast(`ย้ายข้อมูลขึ้น ${store.backendLabel} แล้ว`);
      renderSettings(el);
    } catch (ex) { toast(ex.message, 'bad', 8000); setBusy(btn, false); }
  });

  // ---------- ผู้ใช้ ----------
  bindAccount(el);
  bindSystem(el);
  bindOutbox(el);
  el.querySelector('[data-act="sp-upgrade"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'กำลังสร้าง…');
    try {
      await backendFor('sharepoint').setup((msg) => { btn.innerHTML = `<span class="spin"></span>${esc(msg)}`; });
      await store.refresh();
      toast('อัปเดตโครงสร้างข้อมูลในไซต์แล้ว');
      renderSettings(el);
    } catch (ex) { toast(ex.message, 'bad', 8000); setBusy(btn, false); }
  });

  // ---------- ค่ากลาง ----------
  bindListEditor(el.querySelector('#types'), types, () => {});
  bindListEditor(el.querySelector('#cats'), cats, () => {});
  el.querySelector('[data-act="save-org"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const watch = +el.querySelector('#th-watch').value, behind = +el.querySelector('#th-behind').value;
    if (behind < watch) { toast('เกณฑ์ "ล่าช้า" ต้องมากกว่าหรือเท่ากับเกณฑ์ "เฝ้าระวัง"', 'bad'); return; }
    setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await store.saveSettings({
        orgName: el.querySelector('#org').value.trim(), projectTypes: types, docCategories: cats,
        watchThreshold: watch, behindThreshold: behind, staleDays: +el.querySelector('#th-stale').value || 14,
      });
      toast('บันทึกค่ากลางแล้ว');
      window.dispatchEvent(new Event('pt:conn'));
    } catch (ex) { toast(ex.message, 'bad'); }
    setBusy(btn, false);
  });

  // ---------- สำรองข้อมูล ----------
  el.querySelector('[data-act="backup"]').addEventListener('click', () => {
    download(`project-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportBackup(), null, 1), 'application/json');
  });
  el.querySelector('#restore')?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const n = (json.data || json).projects?.length || 0;
      if (!(await confirmBox({ title: 'นำเข้าไฟล์สำรอง', message: `นำเข้า ${n} โครงการ${store.cloud ? `ขึ้น ${esc(store.backendLabel)}` : ''}? โครงการที่มีรหัสภายในซ้ำจะถูกเขียนทับ`, ok: 'นำเข้า' }))) return;
      await store.importBackup(json);
      toast(`นำเข้า ${n} โครงการแล้ว`);
    } catch (ex) { toast(ex.message || 'อ่านไฟล์ไม่ได้', 'bad'); }
  });
  el.querySelector('[data-act="demo"]')?.addEventListener('click', () => {
    loadDemoData();
    toast('เพิ่มข้อมูลตัวอย่าง 4 โครงการแล้ว');
    location.hash = '#/';
  });
  el.querySelector('[data-act="clear"]')?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'ล้างข้อมูลในเครื่องนี้', message: 'ลบโครงการทั้งหมดที่เก็บในเบราว์เซอร์นี้? ย้อนกลับไม่ได้ ควรดาวน์โหลดไฟล์สำรองก่อน', ok: 'ล้างข้อมูล', danger: true }))) return;
    store.clearLocal();
    toast('ล้างข้อมูลแล้ว');
    location.hash = '#/';
  });
  void fmt;
}

// =============================================================
// บัญชีผู้ใช้ (1.0.1)
// =============================================================
function accountSection(me) {
  const mode = store.mode;
  const flags = [me.isAdmin ? 'ผู้ดูแลระบบ' : '', me.isExec ? 'ผู้บริหาร (ดูทุกโครงการ)' : '', me.canCreate ? 'สร้างโครงการได้' : 'สร้างโครงการไม่ได้'].filter(Boolean);
  const known = [];
  if (mode === 'local') {
    for (const p of store.data.projects) {
      for (const m of R.members(p)) if (!known.some((k) => k.email === m.email)) known.push({ email: m.email, name: m.name, role: m.role, p: p.code || p.name });
    }
  }
  const emailField = mode === 'gas'
    ? `<div class="field"><span>อีเมลที่เข้าสู่ระบบ</span><div class="acc-line">${icon('mail')}<span><b>${esc(me.email || '–')}</b>${store.legacy ? '<small>(ระบบหลังบ้านเวอร์ชันเก่า ยังไม่ต้องเข้าสู่ระบบ)</small>' : ''}</span>${conf.token ? `<button type="button" class="btn btn-ghost btn-sm" data-act="logout">${icon('logout')}ออกจากระบบ</button>` : ''}</div></div>`
    : mode === 'sharepoint' || mode === 'onedrive'
      ? `<div class="field"><span>บัญชี Microsoft</span><div class="acc-line">${icon('user')}<span><b>${esc(me.email || 'ยังไม่ได้ลงชื่อเข้าใช้')}</b></span></div></div>`
      : `<label class="field"><span>อีเมลของคุณ <small class="muted">(ใช้ระบุบทบาทในโครงการ)</small></span><input id="me-email" type="email" value="${esc(conf.email)}" placeholder="name@egat.co.th"></label>`;
  return `<section class="panel">
    <header class="panel-head"><h2>บัญชีของฉัน</h2><span class="muted">${flags.map(esc).join(' · ')}</span></header>
    <div class="form-grid">
      <label class="field"><span>ชื่อที่แสดง (ในบันทึก เรื่องขออนุมัติ และอีเมล)</span><input id="me-name" value="${esc(mode === 'gas' && !store.legacy ? me.name : conf.user)}" placeholder="เช่น นายช่างสมชาย"></label>
      ${emailField}
      <label class="field"><span>ธีม</span>
        <select id="me-theme">
          <option value="auto" ${conf.theme === 'auto' ? 'selected' : ''}>ตามระบบ</option>
          <option value="light" ${conf.theme === 'light' ? 'selected' : ''}>สว่าง</option>
          <option value="dark" ${conf.theme === 'dark' ? 'selected' : ''}>มืด</option>
        </select></label>
    </div>
    ${mode === 'local' ? `
    <div class="actas-box">
      <h3 class="sub-h">${icon('users')}ทดลองใช้งานในนามผู้อื่น <small>เฉพาะโหมดทดลอง — ดูว่าผู้รับจ้าง กรรมการ หรือหัวหน้า เห็นและทำอะไรได้</small></h3>
      <div class="row-actions">
        <select id="me-actas" aria-label="ทดลองในนาม">
          <option value="">ตัวฉันเอง${conf.email ? ` (${esc(conf.email)})` : ''}</option>
          ${known.filter((k) => k.email !== R.norm(conf.email)).map((k) => `<option value="${esc(k.email)}" ${R.norm(conf.actAs) === k.email ? 'selected' : ''}>${esc(k.name || k.email)} — ${esc(R.ROLES[k.role]?.label || k.role)} (${esc(k.p)})</option>`).join('')}
        </select>
        <button type="button" class="btn" data-act="actas">${icon('user')}สลับผู้ใช้</button>
      </div>
      ${!known.length ? '<p class="hint">เพิ่มสมาชิกในโครงการก่อน (แท็บสมาชิกและสิทธิ์) หรือโหลดข้อมูลตัวอย่าง แล้วจึงสลับผู้ใช้ได้</p>' : ''}
    </div>` : ''}
  </section>`;
}

function bindAccount(el) {
  const mode = store.mode;
  el.querySelector('#me-name').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    conf.user = v; saveConf();
    if (store.serverRules) {
      try { store.meta.me = await store.backend.updateMe(v); } catch (ex) { toast(ex.message, 'bad'); return; }
    }
    window.dispatchEvent(new Event('pt:conn'));
    toast('บันทึกชื่อแล้ว');
  });
  el.querySelector('#me-email')?.addEventListener('change', (e) => {
    const v = e.target.value.trim().toLowerCase();
    if (v && !R.validEmail(v)) { toast('อีเมลไม่ถูกต้อง', 'bad'); return; }
    conf.email = v; saveConf();
    window.dispatchEvent(new Event('pt:conn'));
    toast('บันทึกอีเมลแล้ว');
  });
  el.querySelector('#me-theme').addEventListener('change', (e) => { conf.theme = e.target.value; saveConf(); applyTheme(); });
  el.querySelector('[data-act="actas"]')?.addEventListener('click', () => {
    conf.actAs = el.querySelector('#me-actas').value;
    saveConf();
    window.dispatchEvent(new Event('pt:conn'));
    toast(conf.actAs ? `ทดลองในนาม ${store.me.name || conf.actAs}` : 'กลับเป็นตัวเองแล้ว', 'info');
    location.hash = '#/';
  });
  el.querySelector('[data-act="logout"]')?.addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'ออกจากระบบ', message: 'ออกจากระบบบนเครื่องนี้? ต้องยืนยันอีเมลอีกครั้งเมื่อกลับมาใช้งาน', ok: 'ออกจากระบบ' }))) return;
    await store.backend.logout();
    store.forget();
    window.dispatchEvent(new Event('pt:relogin'));
  });
  void mode;
}

// =============================================================
// ผู้ใช้และสิทธิ์ของระบบ (ผู้ดูแลระบบ)
// =============================================================
function systemSection(me, S) {
  if (store.legacy) return '';
  const dis = me.isAdmin ? '' : 'disabled';
  const mode = store.mode;
  const noAdmins = mode === 'sharepoint' && !R.parseList(S.admins).length;
  return `<section class="panel">
    <header class="panel-head"><h2>ผู้ใช้และสิทธิ์ของระบบ</h2><span class="muted">${me.isAdmin ? 'ผู้ดูแลระบบแก้ไขได้' : 'ดูได้อย่างเดียว — แก้ไขได้เฉพาะผู้ดูแลระบบ'}</span></header>
    ${noAdmins ? `<div class="notice notice-warn">${icon('alert')}<div><b>ยังไม่ได้กำหนดผู้ดูแลระบบ</b><span>ตอนนี้ทุกคนที่เข้าไซต์ได้มีสิทธิ์ผู้ดูแลระบบ ใส่อีเมลของคุณในช่องผู้ดูแลระบบเพื่อจำกัดสิทธิ์</span></div></div>` : ''}
    <div class="form-grid">
      <label class="field"><span>ผู้ดูแลระบบ <small class="muted">ดูและแก้ได้ทุกโครงการ เปลี่ยนค่ากลางได้</small></span>
        <textarea id="sy-admins" rows="2" ${dis} placeholder="อีเมล คั่นด้วยจุลภาค">${esc(listText(S.admins))}</textarea>
        ${mode === 'gas' ? '<small class="hint">บัญชีที่ติดตั้ง Apps Script เป็นผู้ดูแลระบบเสมอ</small>' : ''}
        ${mode === 'onedrive' ? '<small class="hint">เจ้าของ OneDrive ที่เก็บโฟลเดอร์หลักเป็นผู้ดูแลระบบเสมอ</small>' : ''}</label>
      <label class="field"><span>ผู้บริหาร <small class="muted">ดูได้ทุกโครงการ (อ่านอย่างเดียว)</small></span>
        <textarea id="sy-execs" rows="2" ${dis} placeholder="อีเมล คั่นด้วยจุลภาค">${esc(listText(S.executives))}</textarea></label>
      <label class="field span-2"><span>ผู้ที่สร้างโครงการได้ <small class="muted">อีเมล หรือโดเมนขึ้นต้นด้วย @ เช่น @egat.co.th — เว้นว่าง = ทุกคนที่เข้าระบบได้</small></span>
        <input id="sy-creators" ${dis} value="${esc(listText(S.projectCreators))}" placeholder="@egat.co.th">
        ${mode === 'gas' ? '<small class="hint">ถ้ากำหนดไว้ ผู้ที่เข้าสู่ระบบได้คือ ผู้ที่สร้างโครงการได้ ผู้บริหาร และสมาชิกของโครงการใดโครงการหนึ่งเท่านั้น</small>' : ''}</label>
    </div>
    <h3 class="sub-h">ระยะเวลาพิจารณาเรื่องขออนุมัติ (ค่าเริ่มต้นของทุกโครงการ)</h3>
    <div class="form-grid form-grid-3">
      <label class="field"><span><i class="dot dot-warn"></i>สีเหลืองเมื่อค้างเกิน (วัน)</span><input id="sy-warn" type="number" min="1" value="${esc(S.slaWarnDays)}" ${dis}></label>
      <label class="field"><span><i class="dot dot-late"></i>สีแดงเมื่อค้างเกิน (วัน)</span><input id="sy-late" type="number" min="1" value="${esc(S.slaLateDays)}" ${dis}></label>
      <label class="field"><span>ลิงก์ของเว็บที่ใส่ในอีเมล</span><input id="sy-url" value="${esc(S.appUrl)}" placeholder="${esc(location.href.split('#')[0])}" ${dis}></label>
    </div>
    ${mode === 'sharepoint' || mode === 'onedrive' ? `
    <label class="check check-block"><input type="checkbox" id="sy-spmail" ${S.spMail ? 'checked' : ''} ${dis}>
      <span>ส่งอีเมลแจ้งเตือนผ่าน Microsoft 365<small>ส่งจากบัญชีของผู้ที่ทำรายการ (ต้องเพิ่มสิทธิ์ Mail.Send แบบ Delegated ในแอปที่ลงทะเบียน) — ถ้าปิดไว้ ระบบแจ้งเตือนในหน้า "งานของฉัน" อย่างเดียว</small></span></label>` : ''}
    ${mode === 'gas' && store.meta.mailQuota != null ? `<p class="hint">${icon('mail')}โควตาส่งอีเมลของ Google คงเหลือวันนี้ ${esc(store.meta.mailQuota)} ผู้รับ ${store.meta.sendEmail === false ? '· ปิดการส่งอีเมลไว้ใน Code.gs (SEND_EMAIL)' : ''}</p>` : ''}
    ${mode === 'local' ? `<p class="hint">${icon('mail')}โหมดทดลองไม่ได้ส่งอีเมลจริง — ดูอีเมลที่ระบบสร้างได้ที่ "กล่องอีเมลจำลอง" ด้านล่าง</p>` : ''}
    ${me.isAdmin ? `<div class="save-row"><button type="button" class="btn btn-primary" data-act="save-sys">${icon('check')}บันทึกผู้ใช้และสิทธิ์</button></div>` : ''}
  </section>`;
}

function bindSystem(el) {
  el.querySelector('[data-act="save-sys"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const lists = {};
    for (const [id, key] of [['sy-admins', 'admins'], ['sy-execs', 'executives'], ['sy-creators', 'projectCreators']]) {
      const items = R.parseList(el.querySelector(`#${id}`).value);
      const bad = items.find((x) => !(x.startsWith('@') ? /^@[^\s@]+\.[^\s@]+$/.test(x) : R.validEmail(x)));
      if (bad) { toast(`"${bad}" ไม่ใช่อีเมลหรือโดเมนที่ถูกต้อง`, 'bad'); return; }
      lists[key] = items.join(', ');
    }
    const me = store.me;
    if (store.mode !== 'gas' && !(store.mode === 'onedrive' && store.backend.isDriveOwner()) && lists.admins && !R.listHas(lists.admins, me.email)) {
      if (!(await confirmBox({ title: 'ไม่มีอีเมลของคุณในผู้ดูแลระบบ', message: `เมื่อบันทึกแล้ว ${esc(me.email || 'คุณ')} จะไม่ใช่ผู้ดูแลระบบอีกต่อไป ต้องการบันทึกต่อหรือไม่`, ok: 'บันทึกต่อ', danger: true }))) return;
    }
    const warn = Math.max(1, Math.round(+el.querySelector('#sy-warn').value || 7));
    const late = Math.max(1, Math.round(+el.querySelector('#sy-late').value || 14));
    if (late < warn) { toast('จำนวนวันของสีแดงต้องไม่น้อยกว่าสีเหลือง', 'bad'); return; }
    const url = el.querySelector('#sy-url').value.trim();
    if (url && !/^https?:\/\//.test(url)) { toast('ลิงก์ของเว็บต้องขึ้นต้นด้วย https://', 'bad'); return; }
    setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await store.saveSettings({
        ...lists, slaWarnDays: warn, slaLateDays: late, appUrl: url,
        ...(el.querySelector('#sy-spmail') ? { spMail: el.querySelector('#sy-spmail').checked } : {}),
      });
      if (store.serverRules) await store.refresh();
      toast('บันทึกผู้ใช้และสิทธิ์แล้ว');
      window.dispatchEvent(new Event('pt:conn'));
    } catch (ex) { toast(ex.message, 'bad', 6000); }
    setBusy(btn, false);
  });
}

// =============================================================
// กล่องอีเมลจำลอง (โหมดทดลอง)
// =============================================================
function outboxSection() {
  const list = store.outbox;
  return `<section class="panel">
    <header class="panel-head"><h2>กล่องอีเมลจำลอง</h2><span class="count">${list.length}</span></header>
    <p class="hint">${icon('mail')}อีเมลที่ระบบจะส่งเมื่อใช้งานจริงกับ Google Drive หรือ SharePoint (โหมดทดลองไม่ได้ส่งจริง) ใช้ตรวจว่าใครได้รับแจ้งเรื่องอะไร</p>
    ${list.length ? `<ul class="outbox">${list.slice(0, 30).map((m) => `<li>
      <button type="button" data-mail="${esc(m.id)}"><span class="ob-kind ob-${esc(m.kind)}">${m.kind === 'action' ? 'ต้องดำเนินการ' : m.kind === 'invite' ? 'แต่งตั้ง' : 'เพื่อทราบ'}</span>
        <span class="ob-main"><b>${esc(m.subject)}</b><small>ถึง ${esc(m.to.join(', '))}</small></span>
        <span class="ob-at">${esc(R.thaiDateTime(m.at))}</span></button></li>`).join('')}</ul>
      <div class="row-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="clear-outbox">${icon('trash')}ล้างกล่องอีเมล</button></div>`
    : '<p class="muted">ยังไม่มีอีเมล — ลองส่งเรื่องขออนุมัติหรือเพิ่มสมาชิกในโครงการ</p>'}
  </section>`;
}

function bindOutbox(el) {
  el.querySelectorAll('[data-mail]').forEach((b) => b.addEventListener('click', () => {
    const m = store.outbox.find((x) => x.id === b.dataset.mail);
    if (!m) return;
    const md = openModal({
      title: m.subject,
      size: 'lg',
      body: `<dl class="mail-head"><div><dt>จาก</dt><dd>${esc(m.fromName || '')} &lt;${esc(m.from || '')}&gt;</dd></div><div><dt>ถึง</dt><dd>${esc(m.to.join(', '))}</dd></div><div><dt>เวลา</dt><dd>${esc(R.thaiDateTime(m.at))}</dd></div></dl>
        <iframe class="mail-frame" sandbox title="เนื้อหาอีเมล"></iframe>`,
    });
    md.el.querySelector('iframe').srcdoc = m.html;
  }));
  el.querySelector('[data-act="clear-outbox"]')?.addEventListener('click', () => { store.clearOutbox(); renderSettings(el); });
}

// =============================================================
// OneDrive: แชร์โฟลเดอร์หลักให้สมาชิก (ผู้ดูแลระบบ)
// =============================================================
function openOdShare() {
  const list = store.oneDriveAccessList();
  const row = (x) => `<tr><td>${esc(x.email)}</td><td>${esc(x.why.join(', '))}</td><td>${x.write ? '<b>แก้ไขได้</b>' : 'ดูได้อย่างเดียว'}</td></tr>`;
  const m = openModal({
    title: 'ให้สิทธิ์เข้าถึงโฟลเดอร์ OneDrive',
    size: 'lg',
    body: `<p>ระบบจะแชร์โฟลเดอร์หลัก <b>${esc(store.meta.folderName || '')}</b> ให้รายชื่อด้านล่าง (คำนวณจากสมาชิกทุกโครงการ ผู้ดูแลระบบ และผู้บริหาร)</p>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>อีเมล</th><th>บทบาท</th><th>สิทธิ์ในโฟลเดอร์</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : '<p class="muted">ยังไม่มีสมาชิกในโครงการใด</p>'}
      <label class="check check-block"><input type="checkbox" id="os-notify"><span>ส่งอีเมลแจ้งการแชร์ของ Microsoft ด้วย<small>ปกติไม่จำเป็น — ส่ง "ลิงก์เชิญทีม" ของระบบแทน</small></span></label>
      <p class="hint">${icon('shield')}ผู้ที่ "แก้ไขได้" สามารถแก้ไฟล์ในโฟลเดอร์ผ่าน OneDrive ได้โดยตรงด้วย จึงให้เฉพาะผู้ที่ต้องบันทึกข้อมูล — การถอนสิทธิ์ทำใน OneDrive (จัดการการเข้าถึง) เมื่อถอดสมาชิกออกจากโครงการ</p>`,
    footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-go ${list.length ? '' : 'disabled'}>${icon('users')}แชร์โฟลเดอร์</button>`,
  });
  m.el.querySelector('[data-go]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'กำลังแชร์…');
    try {
      const r = await store.shareOneDrive(list, { notify: m.el.querySelector('#os-notify').checked });
      toast(`แชร์แล้ว: แก้ไขได้ ${r.write.length} คน ดูได้อย่างเดียว ${r.read.length} คน`);
      m.close();
    } catch (ex) { toast(ex.message, 'bad', 8000); setBusy(btn, false); }
  });
}
