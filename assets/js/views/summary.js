// สรุปผู้บริหาร: ภาพรวมทุกโครงการสำหรับรายงานแผนก (ส่งออก Excel / พิมพ์ PDF / โหมดนำเสนอ)
import { store } from '../store.js';
import { portfolio, STATUS, STATUS_ORDER, todayISO, groupBreakdown, METHODS } from '../calc.js';
import { esc, fmt, icon, gauge, chip, emptyState, moneyHTML, daysText, toast } from '../ui.js';
import { deltaHTML, pageHead } from './common.js';
import { exportWorkbook } from '../excel.js';
import { startPresentation } from './present.js';
import { PROJECT_STATUS } from '../defaults.js';

const st = { type: '', scope: 'current' };

export function filteredRows() {
  return store.rows()
    .filter(({ p }) => (!st.type || p.type === st.type))
    .filter(({ p }) => (st.scope === 'all' ? true : st.scope === 'current' ? !['done', 'cancelled'].includes(p.status) : p.status === st.scope))
    .sort((x, y) => STATUS_ORDER.indexOf(x.a.status) - STATUS_ORDER.indexOf(y.a.status) || x.p.name.localeCompare(y.p.name, 'th'));
}

function latestIssue(pid) {
  const ups = store.updatesOf(pid).filter((u) => u.date <= todayISO());
  for (let i = ups.length - 1; i >= 0; i--) if (ups[i].issues) return ups[i];
  return null;
}

export function renderSummary(el) {
  const S = store.settings;
  const all = store.rows();
  if (!all.length) {
    el.innerHTML = `${pageHead('สรุปผู้บริหาร')}<section class="panel">${emptyState({ ic: 'chart', title: 'ยังไม่มีโครงการให้สรุป', text: 'สร้างโครงการและบันทึกความคืบหน้าก่อน หน้านี้จะสรุปให้อัตโนมัติ' })}</section>`;
    return;
  }
  const types = [...new Set(all.map((r) => r.p.type).filter(Boolean))];
  const rows = filteredRows();
  const pf = portfolio(rows);
  const today = todayISO();
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, rows.filter((r) => r.a.status === s).length]));
  const pend = new Map(rows.map(({ p }) => [p.id, store.pendingSummary(p.id)]));
  const pendTotal = [...pend.values()].reduce((t, x) => ({ n: t.n + x.pending, late: t.late + x.late, warn: t.warn + x.warn, req: t.req + x.overdueReqs }), { n: 0, late: 0, warn: 0, req: 0 });
  const showPend = !store.legacy;

  el.innerHTML = `
  ${pageHead('สรุปผู้บริหาร', `ภาพรวมโครงการสำหรับรายงานแผนก${S.orgName ? ` <span class="sep"></span>${esc(S.orgName)}` : ''}`, `
    <button class="btn" data-act="xlsx">${icon('table')}ส่งออก Excel</button>
    <button class="btn" data-act="print">${icon('print')}พิมพ์ / PDF</button>
    <button class="btn btn-primary" data-act="present">${icon('present')}โหมดนำเสนอ</button>`)}
  <div class="toolbar no-print">
    <select data-f="scope" aria-label="ขอบเขต">
      <option value="current" ${st.scope === 'current' ? 'selected' : ''}>โครงการที่ยังไม่ปิด</option>
      <option value="active" ${st.scope === 'active' ? 'selected' : ''}>เฉพาะกำลังดำเนินการ</option>
      <option value="all" ${st.scope === 'all' ? 'selected' : ''}>ทุกโครงการ</option>
      <option value="done" ${st.scope === 'done' ? 'selected' : ''}>เฉพาะแล้วเสร็จ</option>
    </select>
    <select data-f="type" aria-label="ประเภท"><option value="">ทุกประเภท</option>${types.map((t) => `<option ${st.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <span class="muted">${rows.length} โครงการ</span>
  </div>

  <article class="report">
    <header class="rep-title">
      <h2>สรุปความคืบหน้าโครงการ${S.orgName ? ` ${esc(S.orgName)}` : ''}</h2>
      <p>ข้อมูล ณ วันที่ ${fmt.dateLong(today)}</p>
    </header>

    <section class="panel rep-kpi">
      <div class="rk-main">
        <span class="lbl">ผลงานรวม (ถ่วงน้ำหนักตามมูลค่า)</span>
        <div class="big-num num">${fmt.pctNum(pf.actual)}<i>%</i></div>
        <div class="pf-plan">แผน ${fmt.pct(pf.plan)} ${deltaHTML(pf.diff)}</div>
        ${gauge(pf.actual, pf.plan, { size: 'md' })}
      </div>
      <dl class="rk-stats">
        <div><dt>จำนวนโครงการ</dt><dd class="num">${rows.length}</dd></div>
        <div><dt>มูลค่าสัญญารวม</dt><dd class="num">${moneyHTML(pf.value)}</dd></div>
        <div><dt>ผลงานคิดเป็นเงิน</dt><dd class="num">${moneyHTML(pf.earned)}</dd></div>
        ${showPend ? `<div><dt>เรื่องขออนุมัติรอพิจารณา</dt><dd class="num ${pendTotal.late ? 'is-bad' : ''}">${pendTotal.n} <small>${pendTotal.late ? `ค้างนาน ${pendTotal.late}` : pendTotal.warn ? `ใกล้เกินกำหนด ${pendTotal.warn}` : 'เรื่อง'}</small></dd></div>` : ''}
      </dl>
      <ul class="rk-status">${['behind', 'watch', 'ontrack', 'ahead', 'notstarted', 'done'].filter((s) => counts[s]).map((s) => `<li>${chip(s)}<b class="num">${counts[s]}</b></li>`).join('')}</ul>
    </section>

    <section class="panel">
      <header class="panel-head"><h2>แผนเทียบผลงานรายโครงการ</h2>
        <div class="chart-legend"><span><i class="lg-a"></i>ผลงานจริง</span><span><i class="lg-p"></i>แผน</span><span><i class="lg-g"></i>ตามหลังแผน</span></div></header>
      <div class="cmp">${rows.map(({ p, a }) => `
        <a class="cmp-row" href="#/p/${encodeURIComponent(p.id)}">
          <span class="cmp-name"><b>${esc(p.name)}</b><small>${esc(p.code || '')}</small></span>
          ${gauge(a.actual, a.plan, { size: 'md' })}
          <span class="cmp-num"><b class="num">${fmt.pct(a.actual)}</b><small>แผน ${fmt.pct(a.plan)}</small></span>
          ${deltaHTML(a.diff)}
        </a>`).join('')}</div>
    </section>

    <section class="panel panel-flush">
      <header class="panel-head pad-x"><h2>รายละเอียดโครงการ</h2></header>
      <div class="table-wrap">
        <table class="sumtable">
          <thead><tr><th>#</th><th>โครงการ</th><th>ผู้รับจ้าง</th><th class="r">มูลค่าสัญญา (บาท)</th><th>สิ้นสุดสัญญา</th><th class="r">แผน</th><th class="r">ผลงาน</th><th class="r">ต่าง</th><th>สถานะ</th>${showPend ? '<th>เรื่องค้างพิจารณา</th>' : ''}<th>บันทึกล่าสุด</th></tr></thead>
          <tbody>${rows.map(({ p, a }, i) => `<tr>
            <td class="num">${i + 1}</td>
            <td><a class="link" href="#/p/${encodeURIComponent(p.id)}"><b>${esc(p.name)}</b></a><small>${esc([p.code, p.type].filter(Boolean).join(' / '))}</small></td>
            <td>${esc(p.contractor || '–')}</td>
            <td class="r num">${a.value ? fmt.money(a.value) : '–'}</td>
            <td class="nowrap">${fmt.date(p.endDate)}<small class="${a.overdue ? 'is-bad' : ''}">${esc(daysText(p, a))}</small></td>
            <td class="r num">${fmt.pct(a.plan)}</td>
            <td class="r num"><b>${fmt.pct(a.actual)}</b></td>
            <td class="r">${deltaHTML(a.diff)}</td>
            <td>${chip(a.status)}</td>
            ${showPend ? `<td class="nowrap">${pendCell(pend.get(p.id))}</td>` : ''}
            <td class="nowrap">${a.last ? fmt.date(a.last.date) : '–'}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td></td><td colspan="2">รวม ${rows.length} โครงการ</td><td class="r num">${fmt.money(pf.value)}</td><td></td><td class="r num">${fmt.pct(pf.plan)}</td><td class="r num"><b>${fmt.pct(pf.actual)}</b></td><td class="r">${deltaHTML(pf.diff)}</td><td colspan="${showPend ? 3 : 2}"></td></tr></tfoot>
        </table>
      </div>
    </section>

    <section class="panel">
      <header class="panel-head"><h2>ปัญหาและอุปสรรคล่าสุด</h2></header>
      ${(() => {
        const list = rows.map(({ p }) => ({ p, u: latestIssue(p.id) })).filter((x) => x.u);
        return list.length
          ? `<ul class="issues">${list.map(({ p, u }) => `<li><span>${fmt.date(u.date)}</span><b>${esc(p.name)}</b> ${esc(u.issues)}</li>`).join('')}</ul>`
          : '<p class="muted">ไม่มีรายงานปัญหาและอุปสรรค</p>';
      })()}
    </section>
  </article>`;

  el.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { st[s.dataset.f] = s.value; renderSummary(el); }));
  el.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
  el.querySelector('[data-act="present"]').addEventListener('click', () => {
    if (!rows.length) { toast('ไม่มีโครงการตามตัวกรองนี้', 'bad'); return; }
    startPresentation(rows, pf);
  });
  el.querySelector('[data-act="xlsx"]').addEventListener('click', () => exportSummary(rows, pf));
}

async function exportSummary(rows, pf) {
  const S = store.settings;
  const today = todayISO();
  const head = ['ลำดับ', 'รหัส', 'โครงการ', 'ประเภท', 'สถานะโครงการ', 'ผู้รับจ้าง', 'เลขที่สัญญา', 'ผู้ควบคุมงาน', 'มูลค่าสัญญา (บาท)',
    'วันเริ่มสัญญา', 'วันสิ้นสุดสัญญา', 'คงเหลือ (วัน)', 'แผน %', 'ผลงาน %', 'ต่างจากแผน %', 'สถานะเทียบแผน', 'ผลงานคิดเป็นเงิน (บาท)',
    'บันทึกล่าสุด', 'ผลการดำเนินงานล่าสุด', 'ปัญหา/อุปสรรคล่าสุด', 'วิธีคำนวณ',
    'เรื่องรอพิจารณา', 'ค้างเกินเกณฑ์สีเหลือง', 'ค้างเกินเกณฑ์สีแดง', 'เอกสารเลยกำหนดส่ง'];
  const r2 = (x) => Math.round(x * 100) / 100;
  const body = rows.map(({ p, a }, i) => [
    i + 1, p.code, p.name, p.type, PROJECT_STATUS[p.status] || p.status, p.contractor, p.contractNo, p.manager, r2(a.value),
    p.startDate, p.endDate, a.daysLeft, r2(a.plan * 100), r2(a.actual * 100), r2(a.diff), STATUS[a.status].label, r2(a.earned),
    a.last?.date || '', a.last?.note || '', latestIssue(p.id)?.issues || '', METHODS[p.progressMethod || 'boq_value'].label,
    ...(() => { const x = store.pendingSummary(p.id); return [x.pending, x.warn, x.late, x.overdueReqs]; })(),
  ]);
  const groups = [['โครงการ', 'หมวดงาน', 'มูลค่า (บาท)', 'สัดส่วน %', 'ผลงาน %', 'รายการเสร็จ', 'รายการทั้งหมด']];
  for (const { p, a } of rows) {
    for (const g of groupBreakdown(p, store.boqOf(p.id), a.cum)) {
      groups.push([p.name, g.name, r2(g.amount), a.boqTotal ? r2((g.amount / a.boqTotal) * 100) : '', r2(g.pct * 100), g.done, g.count]);
    }
  }
  const how = await exportWorkbook(`Project-Summary_${today}`, [
    {
      name: 'สรุปโครงการ',
      rows: [[`สรุปความคืบหน้าโครงการ ${S.orgName || ''}`.trim()], [`ข้อมูล ณ วันที่ ${fmt.dateLong(today)}`],
        [`ผลงานรวม ${fmt.pct(pf.actual)} แผน ${fmt.pct(pf.plan)} มูลค่าสัญญารวม ${fmt.money(pf.value)} บาท`], [], head, ...body],
      cols: [6, 12, 44, 16, 14, 28, 14, 18, 16, 12, 12, 10, 8, 8, 10, 14, 16, 12, 40, 40, 20, 12, 12, 12, 12],
    },
    { name: 'แยกหมวดงาน', rows: groups, cols: [44, 32, 16, 10, 10, 10, 10] },
  ]);
  toast(how === 'xlsx' ? 'ส่งออกไฟล์ Excel แล้ว' : 'ส่งออกเป็น CSV แล้ว');
}

function pendCell(x) {
  if (!x || (!x.pending && !x.overdueReqs)) return '<span class="muted">–</span>';
  return `${x.pending ? `<b class="num">${x.pending}</b> เรื่อง` : ''}${x.late ? ` <span class="age age-late">แดง ${x.late}</span>` : ''}${x.warn ? ` <span class="age age-warn">เหลือง ${x.warn}</span>` : ''}${x.overdueReqs ? `<small class="is-bad">เอกสารเลยกำหนด ${x.overdueReqs}</small>` : ''}`;
}
