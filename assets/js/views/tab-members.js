// แท็บสมาชิกและสิทธิ์: เจ้าของโครงการแต่งตั้งสมาชิก กำหนดสิทธิ์ของแต่ละบทบาท และขั้นตอนพิจารณาเรื่องขออนุมัติ
import { store } from '../store.js';
import { esc, icon, toast, confirmBox, promptBox, setBusy, guard, emptyState } from '../ui.js';
import { roleChip, mailNote } from './common.js';

const R = globalThis.PTRules;
const STEP_ROLES = ['supervisor', 'committee', 'head', 'owner'];
const st = { pid: null, d: null };
window.addEventListener('pt:discard', () => { st.d = null; });

const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const defaultPerms = () => clone(R.DEFAULT_ROLE_PERMS);
const samePerms = (a) => R.MEMBER_ROLES.every((r) => [...(a[r] || [])].sort().join() === [...R.DEFAULT_ROLE_PERMS[r]].sort().join());
const wfKey = (wf) => JSON.stringify(wf.map((c) => ({ name: c.name, steps: c.steps.map((s) => ({ role: s.role, days: +s.days, mode: R.stepMode(s) })) })));
const sameWf = (wf) => wfKey(wf) === wfKey(R.DEFAULT_WORKFLOWS);
const SEAT_OPTS = () => ['', ...Array.from({ length: R.MAX_SEAT }, (_, i) => i + 1), 0];
const seatOptLabel = (v) => (v === '' ? 'อัตโนมัติ (ลำดับว่างถัดไป)' : R.seatLabel(v));

function draftOf(p) {
  const rp = defaultPerms();
  for (const r of R.MEMBER_ROLES) if (Array.isArray(p.rolePerms?.[r])) rp[r] = [...p.rolePerms[r]];
  return {
    members: clone(p.members || []),
    rolePerms: rp,
    workflow: clone(R.workflows(p)).map((c) => ({ name: c.name, steps: c.steps.map((s) => ({ role: s.role, days: +s.days || 7, label: s.label || '', mode: R.stepMode(s) })) })),
    ownerRole: R.ownerActsAs(p),
    ownerSeat: p.ownerSeat ?? '',
    slaWarnDays: p.slaWarnDays ?? '',
    slaLateDays: p.slaLateDays ?? '',
  };
}

export function renderMembers(el, ctx) {
  const { p } = ctx;
  if (store.legacy) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'users', title: 'ต้องอัปเดตระบบหลังบ้านก่อน', text: 'การกำหนดสมาชิกและสิทธิ์ต้องใช้ Code.gs เวอร์ชัน 1.0.1 — ให้ผู้ดูแลระบบวางโค้ดใหม่ใน Apps Script แล้ว Deploy เวอร์ชันใหม่ (ดูคู่มือใน README)' })}</section>`;
    return;
  }
  if (st.pid !== p.id || !st.d) { st.pid = p.id; st.d = draftOf(p); }
  const d = st.d;
  const canEdit = store.can(p, 'manageMembers');
  const canTransfer = store.can(p, 'transferOwner');
  const me = store.me;
  const myRole = store.roleOf(p);
  const dis = canEdit ? '' : 'disabled';
  const ownerless = !p.ownerEmail;

  // สิทธิ์ของฉัน
  const myPerms = R.PERM_KEYS.map((k) => ({ k, ok: store.can(p, k) }));

  el.innerHTML = `
  <div class="mem-grid">
    <section class="panel mem-me">
      <header class="panel-head"><h2>สิทธิ์ของคุณในโครงการนี้</h2>${myRole ? roleChip(myRole, myRole === 'owner' ? `ทำหน้าที่${R.OWNER_ACTS[d.ownerRole] && d.ownerRole !== 'none' ? R.OWNER_ACTS[d.ownerRole] : ''}` : '') : (me.isAdmin ? '<span class="role role-admin">ผู้ดูแลระบบ</span>' : me.isExec ? '<span class="role role-head">ผู้บริหาร</span>' : '')}</header>
      <ul class="perm-list">
        <li class="is-ok">${icon('check')}ดูข้อมูลโครงการ BOQ ความคืบหน้า เอกสาร และเรื่องขออนุมัติ</li>
        ${myPerms.map((x) => `<li class="${x.ok ? 'is-ok' : 'is-no'}">${icon(x.ok ? 'check' : 'x')}${esc(R.PERMS[x.k])}</li>`).join('')}
        <li class="${canEdit ? 'is-ok' : 'is-no'}">${icon(canEdit ? 'check' : 'x')}แต่งตั้ง/ถอดถอนสมาชิก และกำหนดสิทธิ์ (เฉพาะเจ้าของโครงการ)</li>
      </ul>
      <p class="hint">${me.email ? `เข้าใช้ในชื่อ ${esc(me.name || me.email)} &lt;${esc(me.email)}&gt;` : 'ยังไม่ได้ระบุอีเมลของคุณ — ตั้งได้ที่หน้า ตั้งค่า'}</p>
    </section>

    <section class="panel mem-owner">
      <header class="panel-head"><h2>เจ้าของโครงการ</h2>${canTransfer && !ownerless ? `<button class="btn btn-sm" data-act="transfer">${icon('share')}โอนความเป็นเจ้าของ</button>` : ''}</header>
      ${ownerless ? `
        <div class="notice notice-warn">${icon('alert')}<div><b>โครงการนี้ยังไม่มีเจ้าของ</b><span>สร้างก่อนเวอร์ชัน 1.0.1 — ผู้ดูแลระบบทำหน้าที่แทนจนกว่าจะกำหนดเจ้าของ</span></div>
          ${canTransfer && me.email ? `<button class="btn btn-sm" data-act="claim">รับเป็นเจ้าของ</button>` : ''}</div>
        ${canTransfer ? `<div class="row-actions"><button class="btn btn-sm" data-act="transfer">${icon('user')}กำหนดเจ้าของโครงการ</button></div>` : ''}`
      : `<div class="owner-card"><span class="avatar">${esc((p.ownerName || p.ownerEmail).trim().charAt(0).toUpperCase())}</span>
          <div><b>${esc(p.ownerName || p.ownerEmail)}</b><small>${esc(p.ownerEmail)}</small></div></div>
        <label class="field field-inline owner-acts"><span>ทำหน้าที่ในงาน</span>
          <select data-owner-role ${dis}>${Object.entries(R.OWNER_ACTS).map(([k, v]) => `<option value="${k}" ${d.ownerRole === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field field-inline owner-acts" data-owner-seat-box ${d.ownerRole === 'committee' ? '' : 'hidden'}><span>ลำดับในคณะกรรมการ</span>
          <select data-owner-seat ${dis}>${SEAT_OPTS().map((v) => `<option value="${v}" ${String(d.ownerSeat) === String(v) ? 'selected' : ''}>${esc(seatOptLabel(v))}</option>`).join('')}</select></label>
        <p class="hint">เจ้าของโครงการ (ผู้สร้าง) ทำได้ทุกอย่างในโครงการ และเป็นผู้เดียวที่แต่งตั้งสมาชิกได้ — ถ้าเลือกทำหน้าที่ผู้ควบคุมงาน จะได้รับเรื่องของผู้รับจ้างให้พิจารณาด้วย</p>`}
    </section>
  </div>

  ${canEdit ? '' : `<div class="notice">${icon('lock')}<div><b>ดูได้อย่างเดียว</b><span>เฉพาะเจ้าของโครงการ${p.ownerName ? ` (${esc(p.ownerName)})` : ''} เท่านั้นที่แต่งตั้งสมาชิก เปลี่ยนสิทธิ์ และขั้นตอนพิจารณาได้</span></div></div>`}

  <section class="panel panel-flush mem-panel">
    <header class="panel-head pad-x"><h2>สมาชิกโครงการ</h2><span class="count">${d.members.length}</span></header>
    <div class="table-wrap">
      <table class="mtable">
        <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>บทบาท</th><th>รับอีเมลแจ้งเตือน</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody id="m-body"></tbody>
      </table>
    </div>
    ${canEdit ? `
    <div class="mem-add">
      <label class="field"><span>อีเมล <small class="muted">(ใส่หลายอีเมลได้ คั่นด้วย , )</small></span><input id="ma-email" type="email" multiple placeholder="เช่น engineer@egat.co.th" autocomplete="off"></label>
      <label class="field"><span>ชื่อ–ตำแหน่ง</span><input id="ma-name" placeholder="เช่น นายสมชาย ใจดี (บริษัท ก จำกัด)"></label>
      <label class="field"><span>บทบาท</span><select id="ma-role">${R.MEMBER_ROLES.map((r) => `<option value="${r}" ${r === 'contractor' ? 'selected' : ''}>${esc(R.ROLES[r].label)}</option>`).join('')}</select></label>
      <button class="btn btn-primary" data-act="add">${icon('plus')}เพิ่มสมาชิก</button>
    </div>
    <p class="hint pad-x" id="ma-desc"></p>` : ''}
  </section>

  <section class="panel">
    <header class="panel-head"><h2>สิทธิ์ของแต่ละบทบาท</h2>${canEdit ? '<button class="btn btn-sm btn-ghost" data-act="reset-perms">คืนค่าเริ่มต้น</button>' : ''}</header>
    <div class="table-wrap">
      <table class="perm-matrix">
        <thead><tr><th>บทบาท</th>${R.PERM_KEYS.map((k) => `<th><span>${esc(R.PERMS[k])}</span></th>`).join('')}</tr></thead>
        <tbody>
          <tr class="is-owner"><td>${roleChip('owner')}</td>${R.PERM_KEYS.map(() => `<td>${icon('check')}</td>`).join('')}</tr>
          ${R.MEMBER_ROLES.map((r) => `<tr><td>${roleChip(r)}<small>${esc(R.ROLES[r].desc)}</small></td>${R.PERM_KEYS.map((k) => `
            <td><input type="checkbox" data-perm="${r}|${k}" ${d.rolePerms[r].includes(k) ? 'checked' : ''} ${dis} aria-label="${esc(R.ROLES[r].label)}: ${esc(R.PERMS[k])}"></td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="hint">ทุกบทบาทดูข้อมูลของโครงการได้ทั้งหมด ผู้บริหารที่ผู้ดูแลระบบกำหนดดูได้ทุกโครงการ (อ่านอย่างเดียว)</p>
  </section>

  <section class="panel">
    <header class="panel-head"><h2>หมวดเรื่องและขั้นตอนพิจารณา</h2>${canEdit ? '<button class="btn btn-sm btn-ghost" data-act="reset-wf">คืนค่าเริ่มต้น</button>' : ''}</header>
    <p class="hint">${icon('clock')}เรื่องที่ส่งเข้ามาจะผ่านผู้พิจารณาตามลำดับขั้น — ขั้นผู้ควบคุมงาน: <b>คนใดคนหนึ่ง</b>พิจารณาได้ · ขั้นคณะกรรมการ: <b>ทุกคนเรียงตามลำดับ</b> กรรมการลำดับ 1 → 2 → 3 … แล้วจึง<b>ประธานกรรมการ</b> (กำหนดลำดับในตารางสมาชิก) ถ้าบทบาทนั้นยังไม่มีสมาชิก ระบบจะส่งให้เจ้าของโครงการพิจารณาแทน</p>
    <div class="wf-list" id="wf"></div>
    ${canEdit ? `<div class="row-actions"><button class="btn btn-sm" data-act="add-wf">${icon('plus')}เพิ่มหมวดเรื่อง</button></div>` : ''}
    <div class="sla-row">
      <span>${icon('alert')}สีของเรื่องที่ค้างพิจารณา</span>
      <label class="field field-inline"><span><i class="dot dot-warn"></i>สีเหลืองเมื่อค้างเกิน</span><input type="number" min="1" data-sla="slaWarnDays" value="${esc(d.slaWarnDays)}" placeholder="${esc(store.settings.slaWarnDays)}" ${dis}><span>วัน</span></label>
      <label class="field field-inline"><span><i class="dot dot-late"></i>สีแดงเมื่อค้างเกิน</span><input type="number" min="1" data-sla="slaLateDays" value="${esc(d.slaLateDays)}" placeholder="${esc(store.settings.slaLateDays)}" ${dis}><span>วัน</span></label>
      <small class="muted">เว้นว่าง = ใช้ค่ากลางของระบบ (${esc(store.settings.slaWarnDays)} / ${esc(store.settings.slaLateDays)} วัน)</small>
    </div>
  </section>

  ${canEdit ? `<div class="save-bar"><label class="check"><input type="checkbox" id="m-invite" checked>ส่งอีเมลแจ้งผู้ที่ได้รับแต่งตั้งใหม่</label>
    <span class="muted" id="m-dirty"></span><button class="btn btn-primary" data-act="save">${icon('check')}บันทึกสมาชิกและสิทธิ์</button></div>` : ''}`;

  const dirty = () => { if (!canEdit) return; guard.dirty = true; const n = el.querySelector('#m-dirty'); if (n) n.textContent = 'มีการแก้ไขที่ยังไม่บันทึก'; };

  // ---------- ตารางสมาชิก ----------
  const drawMembers = () => {
    const body = el.querySelector('#m-body');
    if (!d.members.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted pad">ยังไม่มีสมาชิก ${canEdit ? '— เพิ่มอีเมลผู้ควบคุมงาน ผู้รับจ้าง และคณะกรรมการด้านล่าง' : ''}</td></tr>`;
      return;
    }
    const order = (m) => R.MEMBER_ROLES.indexOf(m.role);
    const eff = effSeats();
    const seatSort = (m) => (m.role === 'committee' && eff.has(R.norm(m.email)) ? (eff.get(R.norm(m.email)) || 1000) : 0);
    const rows = d.members.map((m, i) => ({ m, i })).sort((a, b) => order(a.m) - order(b.m) || seatSort(a.m) - seatSort(b.m));
    const seatCell = (m, i) => {
      if (m.role !== 'committee') return '';
      const e = eff.get(R.norm(m.email));
      if (!canEdit) return `<small class="seat-tag">${esc(R.seatLabel(e))}</small>`;
      const cur = m.seat === 0 || m.seat ? String(m.seat) : '';
      return `<select class="seat-sel" data-mi="${i}" data-mf="seat" aria-label="ลำดับกรรมการ">${SEAT_OPTS().map((v) => `<option value="${v}" ${cur === String(v) ? 'selected' : ''}>${esc(v === '' ? `อัตโนมัติ (${R.seatLabel(e)})` : seatOptLabel(v))}</option>`).join('')}</select>`;
    };
    body.innerHTML = rows.map(({ m, i }) => `<tr>
      <td>${canEdit ? `<input data-mi="${i}" data-mf="name" value="${esc(m.name)}" placeholder="ชื่อ" aria-label="ชื่อ">` : `<b>${esc(m.name || '–')}</b>`}</td>
      <td class="m-email">${esc(m.email)}</td>
      <td>${canEdit ? `<select data-mi="${i}" data-mf="role" aria-label="บทบาท">${R.MEMBER_ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${esc(R.ROLES[r].label)}</option>`).join('')}</select>` : roleChip(m.role)}${seatCell(m, i)}</td>
      <td>${canEdit ? `<select data-mi="${i}" data-mf="notify" aria-label="การแจ้งเตือน">${Object.entries(R.NOTIFY).map(([k, v]) => `<option value="${k}" ${(m.notify || R.DEFAULT_NOTIFY[m.role]) === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` : `<small>${esc(R.NOTIFY[m.notify || R.DEFAULT_NOTIFY[m.role]])}</small>`}</td>
      ${canEdit ? `<td class="row-tools"><button class="icon-btn danger" data-mrm="${i}" title="ถอดถอน" aria-label="ถอดถอน ${esc(m.email)}">${icon('trash')}</button></td>` : ''}
    </tr>`).join('');
  };
  drawMembers();

  if (canEdit) {
    const body = el.querySelector('#m-body');
    body.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.mi == null) return;
      const m = d.members[+t.dataset.mi];
      if (t.dataset.mf === 'seat') {
        const v = t.value === '' ? '' : +t.value;
        const taken = v !== '' && (d.members.some((x) => x !== m && x.role === 'committee' && x.seat !== '' && x.seat != null && +x.seat === v)
          || (d.ownerRole === 'committee' && d.ownerSeat !== '' && +d.ownerSeat === v));
        if (taken) { toast(`${R.seatLabel(v)} มีผู้อื่นอยู่แล้ว — เปลี่ยนลำดับของคนเดิมก่อน`, 'bad'); t.value = m.seat === 0 || m.seat ? String(m.seat) : ''; return; }
        if (v === '') delete m.seat; else m.seat = v;
        drawMembers(); drawWf(); dirty();
        return;
      }
      m[t.dataset.mf] = t.value;
      if (t.dataset.mf === 'role') { m.notify = R.DEFAULT_NOTIFY[t.value]; if (t.value !== 'committee') delete m.seat; drawMembers(); drawWf(); }
      dirty();
    });
    body.addEventListener('input', (e) => { if (e.target.dataset.mf === 'name') { d.members[+e.target.dataset.mi].name = e.target.value; dirty(); } });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mrm]');
      if (!b) return;
      const m = d.members[+b.dataset.mrm];
      if (!(await confirmBox({ title: 'ถอดถอนสมาชิก', message: `ถอดถอน ${esc(m.name || m.email)} (${esc(R.ROLES[m.role].label)}) ออกจากโครงการ? เมื่อบันทึกแล้วจะเข้าดูโครงการนี้ไม่ได้อีก`, ok: 'ถอดถอน', danger: true }))) return;
      d.members.splice(+b.dataset.mrm, 1);
      dirty(); drawMembers(); drawWf();
    });
    const desc = () => { const r = el.querySelector('#ma-role').value; el.querySelector('#ma-desc').innerHTML = `${roleChip(r)} ${esc(R.ROLES[r].desc)}`; };
    el.querySelector('#ma-role').addEventListener('change', desc);
    desc();
    const add = () => {
      const raw = el.querySelector('#ma-email').value;
      const emails = R.parseList(raw);
      if (!emails.length) { toast('กรุณาใส่อีเมล', 'bad'); el.querySelector('#ma-email').focus(); return; }
      const badE = emails.find((x) => !R.validEmail(x));
      if (badE) { toast(`อีเมล "${badE}" ไม่ถูกต้อง`, 'bad'); return; }
      const role = el.querySelector('#ma-role').value;
      const name = el.querySelector('#ma-name').value.trim();
      let added = 0;
      for (const e of emails) {
        if (e === R.norm(p.ownerEmail)) { toast(`${e} เป็นเจ้าของโครงการอยู่แล้ว`, 'info'); continue; }
        const ex = d.members.find((m) => R.norm(m.email) === e);
        if (ex) { ex.role = role; ex.notify = R.DEFAULT_NOTIFY[role]; if (name) ex.name = name; toast(`${e} มีอยู่แล้ว — เปลี่ยนบทบาทเป็น${R.ROLES[role].label}`, 'info'); continue; }
        d.members.push({ email: e, name: emails.length === 1 ? name : (name || ''), role, notify: R.DEFAULT_NOTIFY[role] });
        added++;
      }
      el.querySelector('#ma-email').value = '';
      el.querySelector('#ma-name').value = '';
      dirty(); drawMembers(); drawWf();
      if (added) toast(`เพิ่ม ${added} คน — กด "บันทึกสมาชิกและสิทธิ์" เพื่อยืนยัน`, 'info');
    };
    el.querySelector('[data-act="add"]').addEventListener('click', add);
    el.querySelector('#ma-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    el.querySelector('[data-owner-role]')?.addEventListener('change', (e) => {
      d.ownerRole = e.target.value;
      el.querySelector('[data-owner-seat-box]').hidden = d.ownerRole !== 'committee';
      dirty(); drawMembers(); drawWf();
    });
    el.querySelector('[data-owner-seat]')?.addEventListener('change', (e) => {
      const v = e.target.value === '' ? '' : +e.target.value;
      if (v !== '' && d.members.some((x) => x.role === 'committee' && x.seat !== '' && x.seat != null && +x.seat === v)) {
        toast(`${R.seatLabel(v)} มีผู้อื่นอยู่แล้ว`, 'bad'); e.target.value = String(d.ownerSeat); return;
      }
      d.ownerSeat = v; dirty(); drawMembers(); drawWf();
    });
    el.querySelectorAll('[data-perm]').forEach((c) => c.addEventListener('change', () => {
      const [r, k] = c.dataset.perm.split('|');
      d.rolePerms[r] = c.checked ? [...new Set([...d.rolePerms[r], k])] : d.rolePerms[r].filter((x) => x !== k);
      dirty(); drawWf();
    }));
    el.querySelector('[data-act="reset-perms"]').addEventListener('click', () => { d.rolePerms = defaultPerms(); dirty(); renderMembers(el, ctx); });
    el.querySelector('[data-act="reset-wf"]').addEventListener('click', () => {
      d.workflow = clone(R.DEFAULT_WORKFLOWS).map((c) => ({ name: c.name, steps: c.steps.map((s) => ({ ...s, label: '' })) }));
      dirty(); drawWf();
    });
    el.querySelector('[data-act="add-wf"]').addEventListener('click', async () => {
      const name = await promptBox({ title: 'เพิ่มหมวดเรื่อง', label: 'ชื่อหมวด', placeholder: 'เช่น ขออนุมัติเข้าทำงานนอกเวลา' });
      if (!name) return;
      if (d.workflow.some((c) => c.name === name.trim())) { toast('มีหมวดนี้อยู่แล้ว', 'bad'); return; }
      d.workflow.splice(Math.max(0, d.workflow.length - 1), 0, { name: name.trim(), steps: [{ role: 'supervisor', days: 7, label: '' }] });
      dirty(); drawWf();
    });
    el.querySelectorAll('[data-sla]').forEach((inp) => inp.addEventListener('input', () => { d[inp.dataset.sla] = inp.value === '' ? '' : Math.max(1, Math.round(+inp.value || 0)); dirty(); }));
  }

  // ---------- ขั้นตอนพิจารณา ----------
  /** โครงการตามร่างที่กำลังแก้ (ใช้คำนวณลำดับกรรมการ/ผู้พิจารณา) */
  function draftProject() { return { ...p, ownerRole: d.ownerRole, ownerSeat: d.ownerSeat, members: d.members, rolePerms: d.rolePerms }; }
  function effSeats() { return new Map(R.members(draftProject()).filter((m) => m.seat != null).map((m) => [m.email, m.seat])); }
  function committeeOrderNote() {
    const seats = R.committeeSeats(draftProject());
    if (!seats.length) return '<small class="warn-ink">ยังไม่มีคณะกรรมการ — เจ้าของโครงการพิจารณาแทน</small>';
    const own = R.norm(p.ownerEmail);
    return `<small class="seat-flow">${seats.map((m) => `<span><b>${esc(R.seatLabel(m.seat))}</b> ${esc(m.email === own ? `${p.ownerName || m.email} (เจ้าของ)` : (d.members.find((x) => R.norm(x.email) === m.email)?.name || m.email))}</span>`).join('<i>→</i>')}</small>`;
  }
  function approverNote(role, step) {
    if (role === 'committee' && R.stepMode(step || { role }) === 'seq') return committeeOrderNote();
    const tmp = { ...p, ownerRole: d.ownerRole, members: d.members, rolePerms: d.rolePerms };
    const list = R.approversFor(tmp, { role }, '');
    const own = R.norm(p.ownerEmail);
    const names = list.map((e) => (e === own ? `${p.ownerName || e} (เจ้าของ)` : (d.members.find((m) => m.email === e)?.name || e)));
    const direct = role === 'owner' || d.members.some((m) => m.role === role && (d.rolePerms[m.role] || []).includes('approve')) || (d.ownerRole === role);
    if (!list.length) return '<small class="is-bad">ยังไม่มีผู้พิจารณา</small>';
    return `<small class="${direct ? 'muted' : 'warn-ink'}">${direct ? '' : 'ยังไม่มีสมาชิกบทบาทนี้ — '}ผู้พิจารณา: ${esc(names.join(', '))}</small>`;
  }
  function drawWf() {
    const box = el.querySelector('#wf');
    box.innerHTML = d.workflow.map((c, ci) => `<div class="wf-cat">
      <div class="wf-name">${canEdit ? `<input data-wn="${ci}" value="${esc(c.name)}" aria-label="ชื่อหมวด">` : `<b>${esc(c.name)}</b>`}
        ${canEdit && d.workflow.length > 1 ? `<button class="icon-btn danger" data-wrm="${ci}" title="ลบหมวด" aria-label="ลบหมวด">${icon('trash')}</button>` : ''}</div>
      <ol class="wf-steps">${c.steps.map((s, si) => `<li>
        <span class="wf-no">${si + 1}</span>
        <div class="wf-step">
          ${canEdit ? `<select data-ws="${ci}|${si}|role" aria-label="ผู้พิจารณาขั้นที่ ${si + 1}">${STEP_ROLES.map((r) => `<option value="${r}" ${s.role === r ? 'selected' : ''}>${esc(R.ROLES[r].label)}</option>`).join('')}</select>
            ${s.role === 'committee' ? `<select data-ws="${ci}|${si}|mode" aria-label="วิธีพิจารณาของคณะกรรมการ"><option value="seq" ${R.stepMode(s) === 'seq' ? 'selected' : ''}>ทุกคนเรียงตามลำดับ</option><option value="any" ${R.stepMode(s) === 'any' ? 'selected' : ''}>คนใดคนหนึ่ง</option></select>` : ''}
            <label class="wf-days"><input type="number" min="1" data-ws="${ci}|${si}|days" value="${esc(s.days)}" aria-label="จำนวนวัน">${s.role === 'committee' && R.stepMode(s) === 'seq' ? 'วัน/คน' : 'วัน'}</label>
            ${c.steps.length > 1 ? `<button class="icon-btn" data-wsrm="${ci}|${si}" title="ลบขั้นนี้" aria-label="ลบขั้นนี้">${icon('x')}</button>` : ''}`
            : `<b>${esc(R.stepLabel(s))}</b> <span class="muted">${s.role === 'committee' && R.stepMode(s) === 'seq' ? `เรียงตามลำดับ คนละ ${esc(s.days)} วัน` : s.role === 'committee' ? `คนใดคนหนึ่ง ภายใน ${esc(s.days)} วัน` : `ภายใน ${esc(s.days)} วัน`}</span>`}
          ${approverNote(s.role, s)}
        </div></li>`).join('')}
        ${canEdit && c.steps.length < 4 ? `<li class="wf-add"><button class="btn btn-sm btn-ghost" data-wsadd="${ci}">${icon('plus')}เพิ่มขั้นพิจารณา</button></li>` : ''}
      </ol></div>`).join('');
    if (!canEdit) return;
    box.querySelectorAll('[data-wn]').forEach((inp) => inp.addEventListener('input', () => { d.workflow[+inp.dataset.wn].name = inp.value.trim(); dirty(); }));
    box.querySelectorAll('[data-ws]').forEach((inp) => inp.addEventListener('change', () => {
      const [ci, si, f] = inp.dataset.ws.split('|');
      d.workflow[+ci].steps[+si][f] = f === 'days' ? Math.max(1, Math.round(+inp.value || 1)) : inp.value;
      dirty(); if (f === 'role' || f === 'mode') drawWf();
    }));
    box.querySelectorAll('[data-wsrm]').forEach((b) => b.addEventListener('click', () => { const [ci, si] = b.dataset.wsrm.split('|'); d.workflow[+ci].steps.splice(+si, 1); dirty(); drawWf(); }));
    box.querySelectorAll('[data-wsadd]').forEach((b) => b.addEventListener('click', () => { d.workflow[+b.dataset.wsadd].steps.push({ role: 'committee', days: 3, label: '', mode: 'seq' }); dirty(); drawWf(); }));
    box.querySelectorAll('[data-wrm]').forEach((b) => b.addEventListener('click', async () => {
      const c = d.workflow[+b.dataset.wrm];
      const used = store.subsOf(p.id).filter((s) => s.category === c.name).length;
      if (!(await confirmBox({ title: 'ลบหมวดเรื่อง', message: `ลบหมวด "${esc(c.name)}"?${used ? ` มีเรื่องเดิม ${used} เรื่องในหมวดนี้ เรื่องเดิมยังอยู่และใช้ขั้นตอนเดิม` : ''}`, ok: 'ลบหมวด', danger: true }))) return;
      d.workflow.splice(+b.dataset.wrm, 1); dirty(); drawWf();
    }));
  }
  drawWf();

  // ---------- โอนเจ้าของ ----------
  const transfer = async (email) => {
    try {
      const saved = await store.transferOwner(p.id, email);
      guard.dirty = false; st.d = null;
      toast(`${saved.ownerName || saved.ownerEmail} เป็นเจ้าของโครงการแล้ว`);
      ctx.rerender();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };
  el.querySelector('[data-act="claim"]')?.addEventListener('click', () => transfer(me.email));
  el.querySelectorAll('[data-act="transfer"]').forEach((btn) => btn.addEventListener('click', async () => {
    if (guard.dirty) { toast('บันทึกการแก้ไขสมาชิกก่อน แล้วจึงโอนความเป็นเจ้าของ', 'bad'); return; }
    const hint = (p.members || []).filter((m) => m.role === 'supervisor').map((m) => m.email).join(', ');
    const email = await promptBox({ title: 'โอนความเป็นเจ้าของโครงการ', label: `อีเมลของเจ้าของคนใหม่${hint ? ` (เช่น ${hint})` : ''}`, placeholder: 'name@egat.co.th', ok: 'ถัดไป' });
    if (!email) return;
    if (!R.validEmail(email)) { toast('อีเมลไม่ถูกต้อง', 'bad'); return; }
    if (!(await confirmBox({ title: 'ยืนยันการโอน', message: `${esc(email)} จะเป็นเจ้าของโครงการ และเป็นผู้เดียวที่แต่งตั้งสมาชิกได้${p.ownerEmail ? ` — ${esc(p.ownerName || p.ownerEmail)} จะยังอยู่ในโครงการในบทบาทผู้ควบคุมงาน` : ''}`, ok: 'โอนความเป็นเจ้าของ', danger: true }))) return;
    transfer(email);
  }));

  // ---------- บันทึก ----------
  el.querySelector('[data-act="save"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const wf = d.workflow.filter((c) => c.name && c.steps.length);
    if (wf.length !== d.workflow.length) { toast('ทุกหมวดเรื่องต้องมีชื่อและมีขั้นพิจารณาอย่างน้อย 1 ขั้น', 'bad'); return; }
    if (new Set(wf.map((c) => c.name)).size !== wf.length) { toast('ชื่อหมวดเรื่องซ้ำกัน', 'bad'); return; }
    if (d.slaWarnDays && d.slaLateDays && +d.slaLateDays < +d.slaWarnDays) { toast('จำนวนวันของสีแดงต้องไม่น้อยกว่าสีเหลือง', 'bad'); return; }
    const noApprover = wf.flatMap((c) => c.steps.map((s) => ({ c, s }))).find(({ s }) => !R.approversFor({ ...p, ownerRole: d.ownerRole, members: d.members, rolePerms: d.rolePerms }, s, '').length);
    if (noApprover && !(await confirmBox({ title: 'ยังไม่มีผู้พิจารณา', message: `หมวด "${esc(noApprover.c.name)}" ขั้น${esc(R.ROLES[noApprover.s.role].label)} ยังไม่มีผู้พิจารณา และโครงการยังไม่มีเจ้าของ — เรื่องในหมวดนี้จะไม่มีผู้รับแจ้ง ต้องการบันทึกต่อหรือไม่`, ok: 'บันทึกต่อ' }))) return;
    const before = new Set(R.members(p).map((m) => m.email));
    const newcomers = d.members.filter((m) => !before.has(R.norm(m.email))).length;
    setBusy(btn, true, 'กำลังบันทึก…');
    try {
      const saved = await store.saveMembers(p.id, {
        members: d.members,
        rolePerms: samePerms(d.rolePerms) ? null : d.rolePerms,
        workflow: sameWf(wf) ? [] : wf.map((c) => ({ name: c.name, steps: c.steps.map((s) => ({ role: s.role, days: +s.days, label: s.label || '', mode: R.stepMode(s) })) })),
        ownerRole: d.ownerRole,
        ownerSeat: d.ownerRole === 'committee' ? d.ownerSeat : '',
        slaWarnDays: d.slaWarnDays, slaLateDays: d.slaLateDays,
      }, { invite: el.querySelector('#m-invite').checked });
      guard.dirty = false; st.d = null;
      toast(`บันทึกสมาชิกและสิทธิ์แล้ว${newcomers ? mailNote(saved._mail, store.mode) : ''}`, saved._mail?.error ? 'bad' : 'ok', 6000);
      ctx.rerender();
    } catch (ex) { toast(ex.message, 'bad', 6000); setBusy(btn, false); }
  });
}
