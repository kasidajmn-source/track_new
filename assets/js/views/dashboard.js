// หน้าหลัก: ภาพรวมความคืบหน้าทุกโครงการ
import { store } from '../store.js';
import { portfolio, STATUS_ORDER, todayISO } from '../calc.js';
import { esc, fmt, icon, gauge, emptyState, moneyHTML } from '../ui.js';
import { projectRow, deltaHTML, pageHead, loadDemoData } from './common.js';
import { openProjectForm } from './project-form.js';


export function renderDashboard(el) {
  const S = store.settings;
  const rows = store.rows();
  const today = todayISO();
  const sub = `ข้อมูล ณ วันที่ ${fmt.dateLong(today)}${S.orgName ? ` <span class="sep"></span>${esc(S.orgName)}` : ''}`;
  const me = store.me;
  const newBtn = me.canCreate ? `<button class="btn btn-primary" data-act="new">${icon('plus')}สร้างโครงการ</button>` : '';

  if (!rows.length) {
    const hidden = store.data.projects.length && !store.cloud;
    el.innerHTML = `${pageHead('ภาพรวมโครงการ', sub)}
      <section class="panel">${emptyState({
        ic: 'grid',
        title: me.canCreate || !store.cloud ? 'ยังไม่มีโครงการ' : 'ยังไม่มีโครงการที่คุณเป็นสมาชิก',
        text: hidden
          ? `มีโครงการในเครื่องนี้ ${store.data.projects.length} โครงการ แต่ ${esc(me.email)} ไม่ได้เป็นสมาชิก — กลับเป็นตัวเองได้ที่หน้าตั้งค่า`
          : me.canCreate
            ? 'สร้างโครงการแรก ใส่รายการ BOQ แล้วบันทึกความคืบหน้าทุกสัปดาห์ ระบบจะคำนวณเปอร์เซ็นต์และวาด S-Curve ให้'
            : `ให้เจ้าของโครงการเพิ่มอีเมล ${esc(me.email)} เป็นสมาชิก แล้วโครงการจะแสดงที่นี่`,
        actions: `${newBtn}${store.cloud || hidden ? '' : '<button class="btn" data-act="demo">ลองดูด้วยข้อมูลตัวอย่าง</button>'}`,
      })}</section>`;
    bind(el);
    return;
  }

  const pf = portfolio(rows);
  const sorted = [...rows].sort((x, y) =>
    STATUS_ORDER.indexOf(x.a.status) - STATUS_ORDER.indexOf(y.a.status) || x.p.name.localeCompare(y.p.name, 'th'));
  const current = sorted.filter((r) => !['done', 'cancelled'].includes(r.p.status));
  const closed = sorted.filter((r) => ['done', 'cancelled'].includes(r.p.status));

  // รายการที่ต้องติดตาม
  const watch = [];
  for (const { p, a } of current) {
    if (a.status === 'behind') watch.push({ p, tone: 'bad', text: a.overdue ? `เกินกำหนดสัญญา ${fmt.num(-a.daysLeft, 0)} วัน ผลงาน ${fmt.pct(a.actual)}` : `ตามหลังแผน ${fmt.signed(a.diff)}%` });
    else if (a.status === 'watch') watch.push({ p, tone: 'warn', text: `ตามหลังแผน ${fmt.signed(a.diff)}% เริ่มต้องเฝ้าระวัง` });
    if (p.status === 'active' && a.started && a.staleDays != null && a.staleDays > S.staleDays) watch.push({ p, tone: 'muted', text: `ไม่ได้บันทึกความคืบหน้ามา ${fmt.num(a.staleDays, 0)} วัน` });
    if (a.daysLeft != null && a.daysLeft >= 0 && a.daysLeft <= 30 && a.actual < 0.999 && a.started) watch.push({ p, tone: 'warn', text: `ใกล้ครบสัญญา (อีก ${a.daysLeft} วัน) ผลงาน ${fmt.pct(a.actual)}` });
  }

  // บันทึกล่าสุดทุกโครงการ
  const feed = [...store.data.updates]
    .filter((u) => u.date <= today)
    .sort((x, y) => String(y.date).localeCompare(String(x.date)) || String(y.createdAt).localeCompare(String(x.createdAt)))
    .slice(0, 6)
    .map((u) => ({ u, p: store.project(u.projectId) }))
    .filter((x) => x.p && store.canView(x.p));

  el.innerHTML = `
  ${pageHead('ภาพรวมโครงการ', sub, newBtn)}
  <section class="portfolio panel">
    <div class="pf-figure">
      <span class="pf-label">ผลงานรวมทุกโครงการ</span>
      <div class="big-num num">${fmt.pctNum(pf.actual)}<i>%</i></div>
      <div class="pf-plan">แผน ${fmt.pct(pf.plan)} ${deltaHTML(pf.diff)}</div>
    </div>
    <div class="pf-gauge">
      ${gauge(pf.actual, pf.plan, { size: 'lg', scale: true })}
      <p class="pf-note">ถ่วงน้ำหนักด้วยมูลค่าสัญญา <span class="legend"><i class="lg-a"></i>ผลงานจริง</span><span class="legend"><i class="lg-p"></i>แผนงาน</span><span class="legend"><i class="lg-g"></i>ส่วนที่ตามหลังแผน</span></p>
    </div>
    <dl class="pf-stats">
      <div><dt>มูลค่าสัญญารวม</dt><dd class="num">${moneyHTML(pf.value)}</dd></div>
      <div><dt>ผลงานคิดเป็นเงิน</dt><dd class="num">${moneyHTML(pf.earned)}</dd></div>
      <div><dt>กำลังดำเนินการ</dt><dd class="num">${pf.active} <small>จาก ${pf.total} โครงการ</small></dd></div>
      <div><dt>ล่าช้ากว่าแผน</dt><dd class="num ${pf.behind ? 'is-bad' : ''}">${pf.behind} <small>${pf.watch ? `เฝ้าระวังอีก ${pf.watch}` : 'โครงการ'}</small></dd></div>
    </dl>
  </section>

  <div class="dash-grid">
    <section class="panel panel-flush">
      <header class="panel-head"><h2>โครงการที่ดำเนินอยู่</h2><a class="link" href="#/projects">ดูทั้งหมด</a></header>
      <div class="prow-list">${current.length ? current.map((r) => projectRow(r.p, r.a, { showType: true })).join('') : '<p class="muted pad">ไม่มีโครงการที่ดำเนินอยู่</p>'}</div>
      ${closed.length ? `<details class="closed"><summary>แล้วเสร็จ/ยกเลิก (${closed.length})</summary><div class="prow-list">${closed.map((r) => projectRow(r.p, r.a, { showType: true })).join('')}</div></details>` : ''}
    </section>
    <div class="dash-side">
      ${myWork()}
      ${pendingPanel(current)}
      <section class="panel">
        <header class="panel-head"><h2>ต้องติดตาม</h2><span class="count">${watch.length}</span></header>
        ${watch.length ? `<ul class="watch">${watch.map((w) => `
          <li class="w-${w.tone}"><a href="#/p/${encodeURIComponent(w.p.id)}"><b>${esc(w.p.name)}</b><span>${esc(w.text)}</span></a></li>`).join('')}</ul>`
          : `<p class="ok-note">${icon('check')}ทุกโครงการเป็นไปตามแผน</p>`}
      </section>
      <section class="panel">
        <header class="panel-head"><h2>บันทึกล่าสุด</h2></header>
        ${feed.length ? `<ul class="feed">${feed.map(({ u, p }) => `
          <li><a href="#/p/${encodeURIComponent(p.id)}/updates">
            <span class="f-date">${fmt.date(u.date)}</span>
            <span class="f-body"><b>${esc(p.name)}</b><span>${esc(u.note || 'บันทึกความคืบหน้า')}</span>${u.issues ? `<span class="f-issue">${icon('alert')}${esc(u.issues)}</span>` : ''}</span>
          </a></li>`).join('')}</ul>` : '<p class="muted">ยังไม่มีการบันทึกความคืบหน้า</p>'}
      </section>
    </div>
  </div>`;
  bind(el);
}

function bind(el) {
  el.querySelector('[data-act="new"]')?.addEventListener('click', openProjectForm);
  el.querySelector('[data-act="demo"]')?.addEventListener('click', () => {
    loadDemoData();
    renderDashboard(el);
  });
}

/** งานของฉัน (สรุป) */
function myWork() {
  if (store.legacy || !store.me.email) return '';
  const q = store.myQueue();
  const items = [
    [q.decide.length, 'เรื่องรอคุณพิจารณา', 'shield', q.decide.some((x) => x.sla.tone === 'late') ? 'bad' : q.decide.some((x) => x.sla.tone === 'warn') ? 'warn' : ''],
    [q.resubmit.length, 'เรื่องที่ต้องแก้ไขส่งใหม่', 'refresh', 'bad'],
    [q.reqs.length, 'เอกสารที่ต้องส่งเร็วๆ นี้', 'clipboard', q.reqs.some((x) => x.st.overdueDays) ? 'bad' : 'warn'],
    [q.mine.length, 'เรื่องที่คุณส่ง รอผล', 'send', ''],
  ].filter((x) => x[0]);
  if (!items.length) return '';
  return `<section class="panel mywork">
    <header class="panel-head"><h2>งานของฉัน</h2><a class="link" href="#/inbox">เปิดทั้งหมด</a></header>
    <ul class="mw-list">${items.map(([n, label, ic, tone]) => `<li class="${tone ? `mw-${tone}` : ''}"><a href="#/inbox">${icon(ic)}<span>${label}</span><b class="num">${n}</b></a></li>`).join('')}</ul>
  </section>`;
}

/** เรื่องขออนุมัติที่ค้างในแต่ละโครงการ */
function pendingPanel(rows) {
  if (store.legacy) return '';
  const list = rows.map(({ p }) => ({ p, s: store.pendingSummary(p.id) })).filter((x) => x.s.pending || x.s.overdueReqs);
  if (!list.length) return '';
  return `<section class="panel">
    <header class="panel-head"><h2>เรื่องค้างพิจารณา</h2><span class="count">${list.reduce((n, x) => n + x.s.pending, 0)}</span></header>
    <ul class="watch">${list.map(({ p, s }) => `<li class="w-${s.late ? 'bad' : s.warn || s.overdueReqs ? 'warn' : 'muted'}"><a href="#/p/${encodeURIComponent(p.id)}/subs">
      <b>${esc(p.name)}</b><span>${s.pending ? `รอพิจารณา ${s.pending} เรื่อง` : ''}${s.late ? ` · ค้างเกินกำหนด (แดง) ${s.late}` : ''}${s.warn ? ` · ใกล้เกิน (เหลือง) ${s.warn}` : ''}${s.overdueReqs ? `${s.pending ? ' · ' : ''}เอกสารเลยกำหนดส่ง ${s.overdueReqs}` : ''}</span></a></li>`).join('')}</ul>
  </section>`;
}
