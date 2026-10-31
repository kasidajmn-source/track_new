import { store } from '../store.js';
import { planSeries, actualSeries, groupBreakdown, PRICE_BASIS, timeFraction, todayISO, hasSchedule } from '../calc.js';
import { esc, fmt, icon, moneyHTML } from '../ui.js';
import { subRow } from './tab-subs.js';

const R = globalThis.PTRules;
import { mountSCurve } from '../charts.js';

export function renderOverview(el, { p, a }) {
  const items = store.boqOf(p.id);
  const ups = store.updatesOf(p.id);
  const files = store.filesOf(p.id);
  const groups = groupBreakdown(p, items, a.cum);
  const sched = hasSchedule(items);
  const pid = encodeURIComponent(p.id);
  const timePct = timeFraction(p, todayISO());
  const recent = [...ups].reverse().slice(0, 4);
  const issues = [...ups].reverse().filter((u) => u.issues).slice(0, 3);
  const catCount = {};
  for (const f of files) catCount[f.category || 'อื่นๆ'] = (catCount[f.category || 'อื่นๆ'] || 0) + 1;

  el.innerHTML = `
  <div class="ov-grid">
    <section class="panel ov-chart">
      <header class="panel-head">
        <h2>S-Curve แผนงานเทียบผลงานจริง</h2>
        <div class="chart-legend"><span><i class="lg-a"></i>ผลงานจริง</span><span><i class="lg-p"></i>แผนงาน</span></div>
      </header>
      <div id="scurve"></div>
    </section>

    <section class="panel ov-kpi">
      <dl class="kpis">
        <div><dt>ผลงานคิดเป็นเงิน</dt><dd class="num">${moneyHTML(a.earned)}</dd></div>
        <div><dt>คงเหลือ</dt><dd class="num">${moneyHTML(Math.max(0, a.value - a.earned))}</dd></div>
        <div><dt>เวลาผ่านไป</dt><dd class="num">${fmt.pct(timePct)} <small>${a.elapsed != null && a.started ? `${fmt.num(Math.min(a.elapsed, a.totalDays ?? a.elapsed), 0)} วัน` : ''}</small></dd></div>
        <div><dt>ยอดรวม BOQ${(p.priceBasis || 'total') !== 'total' ? ` <small>(${esc(PRICE_BASIS[p.priceBasis])})</small>` : ''}</dt><dd class="num">${moneyHTML(a.boqTotal)}</dd></div>
        <div><dt>บันทึกล่าสุด</dt><dd>${a.last ? `${fmt.date(a.last.date)} <small>${a.staleDays ? `${a.staleDays} วันก่อน` : 'วันนี้'}</small>` : '<small>ยังไม่มี</small>'}</dd></div>
        <div><dt>เอกสาร</dt><dd class="num">${files.length} <small>ไฟล์</small></dd></div>
      </dl>
    </section>

    <section class="panel ov-groups">
      <header class="panel-head"><h2>ความคืบหน้าตามหมวดงาน</h2><a class="link" href="#/p/${pid}/boq${sched ? '/plan' : ''}">${sched ? 'ดูแผนงาน' : 'ดู BOQ'}</a></header>
      ${groups.length ? `<table class="gtable">
        <thead><tr><th>หมวดงาน</th><th class="r">มูลค่า</th><th class="r hide-sm">สัดส่วน</th>${sched ? '<th class="r hide-sm">แผน</th>' : ''}<th>ผลงาน</th></tr></thead>
        <tbody>${groups.map((g) => `<tr>
          <td><b>${esc(g.name)}</b><small>${g.done}/${g.count} รายการเสร็จ</small></td>
          <td class="r num">${fmt.money(g.amount)}</td>
          <td class="r num hide-sm">${a.boqTotal ? fmt.pct(g.amount / a.boqTotal) : '–'}</td>
          ${sched ? `<td class="r num hide-sm">${g.planPct == null ? '–' : fmt.pct(g.planPct)}</td>` : ''}
          <td class="nowrap"><div class="mini"><span style="width:${Math.min(100, g.pct * 100).toFixed(1)}%"></span></div><b class="num">${fmt.pct(g.pct)}</b></td>
        </tr>`).join('')}</tbody></table>`
        : `<p class="muted">${['manual', 'time'].includes(p.progressMethod) ? 'โครงการนี้คิดความคืบหน้าโดยไม่ใช้ BOQ' : `ยังไม่มีรายการ BOQ — <a class="link" href="#/p/${pid}/boq">เพิ่ม BOQ</a>`}</p>`}
    </section>

    <section class="panel ov-recent">
      <header class="panel-head"><h2>บันทึกล่าสุด</h2><a class="link" href="#/p/${pid}/updates">ทั้งหมด</a></header>
      ${recent.length ? `<ol class="timeline">${recent.map((u) => `
        <li><span class="t-when">${u.week ? `สัปดาห์ที่ ${u.week}` : ''}<small>${fmt.date(u.date)}</small></span>
        <div class="t-body"><p>${esc(u.note || 'บันทึกความคืบหน้า')}</p>${u.issues ? `<p class="t-issue">${icon('alert')}${esc(u.issues)}</p>` : ''}<small>${esc(u.createdBy || '')}</small></div></li>`).join('')}</ol>`
        : `<p class="muted">ยังไม่มีบันทึก — <a class="link" href="#/p/${pid}/updates/new">บันทึกความคืบหน้าครั้งแรก</a></p>`}
    </section>

    ${subsPanel(p)}

    ${issues.length ? `<section class="panel ov-issues">
      <header class="panel-head"><h2>ปัญหาและอุปสรรคที่รายงานล่าสุด</h2></header>
      <ul class="issues">${issues.map((u) => `<li><span>${fmt.date(u.date)}</span>${esc(u.issues)}</li>`).join('')}</ul>
    </section>` : ''}

    <section class="panel ov-docs">
      <header class="panel-head"><h2>เอกสารโครงการ</h2><a class="link" href="#/p/${pid}/docs">เปิดคลังเอกสาร</a></header>
      <ul class="catlist">${(p.docCategories || []).map((c) => `<li><a href="#/p/${pid}/docs/${encodeURIComponent(c)}">${icon('folder')}<span>${esc(c)}</span><em>${catCount[c] || 0}</em></a></li>`).join('')}</ul>
    </section>
  </div>`;

  mountSCurve(el.querySelector('#scurve'), {
    plan: planSeries(p, 60, items),
    actual: actualSeries(p, items, ups),
    start: p.startDate, end: p.endDate,
  });
}

/** เรื่องขออนุมัติที่รอพิจารณา และสถานะเอกสารที่ต้องส่ง */
function subsPanel(p) {
  if (store.legacy) return '';
  const pid = encodeURIComponent(p.id);
  const me = store.me;
  const now = new Date().toISOString();
  const subs = store.subsOf(p.id);
  const pending = subs.filter((s) => s.status === 'pending')
    .map((sub) => ({ sub, sla: R.subSla(sub, p, store.settings, now), mine: R.currentApprovers(sub, p).includes(me.email) }))
    .sort((a, b) => b.sla.age - a.sla.age);
  const reqs = store.reqsOf(p.id);
  const today = now.slice(0, 10);
  const rs = reqs.map((r) => R.reqStatus(r, p, subs, today));
  const done = rs.filter((x) => x.state === 'approved').length;
  const overdue = rs.filter((x) => x.overdueDays > 0).length;
  if (!subs.length && !reqs.length) return '';
  return `<section class="panel panel-flush ov-subs">
    <header class="panel-head pad-x"><h2>เรื่องขออนุมัติที่รอพิจารณา</h2><a class="link" href="#/p/${pid}/subs">ทั้งหมด ${subs.length} เรื่อง</a></header>
    ${pending.length ? `<ul class="sublist sublist-compact">${pending.slice(0, 4).map((x) => subRow(p, x)).join('')}</ul>${pending.length > 4 ? `<p class="pad-x hint">และอีก ${pending.length - 4} เรื่อง</p>` : ''}`
      : `<p class="ok-note pad">${icon('check')}ไม่มีเรื่องค้างพิจารณา</p>`}
    ${reqs.length ? `<a class="req-strip" href="#/p/${pid}/subs/required">${icon('clipboard')}<span>เอกสารที่ต้องส่งตามสัญญา: ผ่านแล้ว <b>${done}</b>/${reqs.length}</span>${overdue ? `<span class="chip chip-bad">เลยกำหนด ${overdue}</span>` : ''}${icon('chevR')}</a>` : ''}
  </section>`;
}
