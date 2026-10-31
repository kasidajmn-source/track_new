// แผนงานรายรายการ BOQ (Gantt): กำหนดวันเริ่ม–วันจบของแต่ละรายการ แล้วเทียบแผนกับผลงานจริง
import { store } from '../store.js';
import {
  contractDays, dayOf, dayToIso, hasPlan, hasSchedule, itemPlanFrac, groupBreakdown, ratio, num, todayISO,
} from '../calc.js';
import { esc, fmt, icon, emptyState, toast, confirmBox, setBusy, guard } from '../ui.js';

const st = { pid: null, editing: false, draft: [], mode: 'day' };
window.addEventListener('pt:discard', () => { st.editing = false; st.draft = []; });

export function renderPlan(el, ctx) {
  const { p } = ctx;
  if (st.pid !== p.id) { st.pid = p.id; st.editing = false; st.draft = []; }
  const pid = encodeURIComponent(p.id);
  const items = store.boqOf(p.id);
  if (!p.startDate || !p.endDate) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'calendar', title: 'ยังไม่ได้ระบุระยะเวลาสัญญา', text: 'ระบุวันเริ่มและวันสิ้นสุดสัญญาที่แท็บตั้งค่าโครงการก่อน แล้วจึงวางแผนงานรายรายการ', actions: store.can(p.id, 'editProject') ? `<a class="btn btn-primary" href="#/p/${pid}/settings">ไปที่ตั้งค่าโครงการ</a>` : '' })}</section>`;
    return;
  }
  if (!items.length) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'list', title: 'ยังไม่มีรายการ BOQ', text: 'เพิ่มรายการ BOQ ก่อน แล้วจึงกำหนดวันทำงานของแต่ละรายการ', actions: `<a class="btn btn-primary" href="#/p/${pid}/boq">ไปที่รายการ BOQ</a>` })}</section>`;
    return;
  }
  if (st.editing) renderEdit(el, ctx); else renderGantt(el, ctx);
}

function startEdit(el, ctx) {
  st.editing = true;
  st.draft = store.boqOf(ctx.p.id).map((x) => ({ ...x }));
  renderEdit(el, ctx);
}

// ---------- มุมมองแผนภูมิ ----------
function renderGantt(el, ctx) {
  const { p, a } = ctx;
  const items = store.boqOf(p.id);
  const N = contractDays(p);
  const today = todayISO();
  const tDay = dayOf(p, today);
  const canEdit = store.can(p.id, 'editBoq');
  const scheduled = hasSchedule(items);
  const groups = groupBreakdown(p, items, a.cum, today);
  const pos = (d) => `${(Math.max(0, Math.min(N, d)) / N * 100).toFixed(3)}%`;

  // ป้ายเดือนบนแกนเวลา
  const months = [];
  const start = new Date(`${p.startDate}T00:00:00`);
  const cur = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (true) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`;
    const d = dayOf(p, iso);
    if (d > N) break;
    months.push({ d, label: (cur.getMonth() === 0 || !months.length) ? fmt.monthYear(cur) : fmt.month(cur) });
    cur.setMonth(cur.getMonth() + 1);
  }
  // ป้ายเดือนแรก (เดือนที่เริ่มสัญญา) ถ้าไม่ชิดป้ายถัดไปเกินไป
  if (!months.length || (months[0].d - 1) / N > 0.07) months.unshift({ d: 1, label: fmt.monthYear(start) });
  const step = Math.max(1, Math.ceil(months.length / 12));
  const axis = `<div class="gt-axis">${months.map((m, i) => `<span class="gt-m" style="left:${pos(m.d - 1)}">${i % step === 0 ? esc(m.label) : ''}</span>`).join('')}${tDay >= 1 && tDay <= N ? `<span class="gt-tm" style="left:${pos(tDay - 0.5)}">วันนี้</span>` : ''}</div>`;
  const grid = `<div class="gt-lines" aria-hidden="true">${months.map((m) => `<i style="left:${pos(m.d - 1)}"></i>`).join('')}${tDay >= 1 && tDay <= N ? `<b class="gt-today" style="left:${pos(tDay - 0.5)}"><em>วันนี้</em></b>` : ''}</div>`;

  const bar = (ps, pe, actualR, planR, cls = '') => {
    if (!(ps > 0 && pe > 0)) return '<span class="gt-none">ยังไม่กำหนด</span>';
    const e = Math.max(ps, pe);
    const behind = planR != null && planR - actualR > 0.05;
    const done = actualR >= 0.999;
    return `<div class="gt-bar ${cls} ${done ? 'is-done' : behind ? 'is-behind' : ''}" style="left:${pos(ps - 1)};width:${pos(e - ps + 1)}"
      title="วันที่ ${ps}–${e} (${fmt.date(dayToIso(p, ps))} – ${fmt.date(dayToIso(p, e))})">
      <span class="gt-fill" style="width:${Math.min(100, actualR * 100).toFixed(1)}%"></span></div>`;
  };
  const nums = (planR, actualR) => `<div class="gt-nums"><span>แผน ${planR == null ? '–' : fmt.pct(planR, 0)}</span><b class="${planR != null && planR - actualR > 0.05 ? 'is-bad' : ''}">จริง ${fmt.pct(actualR, 0)}</b></div>`;

  let rows = '';
  for (const g of groups) {
    rows += `<div class="gt-row gt-group">
      <div class="gt-label"><b>${esc(g.name)}</b><small>${g.ps ? `วันที่ ${g.ps}–${g.pe}` : 'ยังไม่วางแผน'}</small></div>
      <div class="gt-track">${bar(g.ps, g.pe, g.pct, g.planPct, 'gt-bar-group')}</div>
      ${nums(g.planPct, g.pct)}
    </div>`;
    for (const it of items.filter((i) => (i.group || 'ไม่ระบุหมวด') === g.name)) {
      const r = ratio(a.cum[it.id] || 0, it.qty, p.allowOver);
      const pr = itemPlanFrac(p, it, today);
      rows += `<div class="gt-row">
        <div class="gt-label"><span>${it.no ? `<i>${esc(it.no)}</i> ` : ''}${esc(it.desc)}</span>${hasPlan(it) ? `<small>วันที่ ${num(it.ps)}–${Math.max(num(it.pe), num(it.ps))} (${Math.max(num(it.pe), num(it.ps)) - num(it.ps) + 1} วัน)</small>` : ''}</div>
        <div class="gt-track">${bar(num(it.ps), num(it.pe), r, pr)}</div>
        ${nums(pr, r)}
      </div>`;
    }
  }

  el.innerHTML = `
  <div class="toolbar">
    <div class="tb-info">วันที่ 1 = ${fmt.date(p.startDate)} (เริ่มสัญญา) <span class="sep"></span> วันที่ ${N} = ${fmt.date(p.endDate)} (สิ้นสุดสัญญา)${tDay >= 1 && tDay <= N ? ` <span class="sep"></span> วันนี้คือวันที่ <b>${tDay}</b>` : ''}</div>
    <div class="tb-actions">${canEdit ? `<button class="btn btn-primary" data-act="edit">${icon('edit')}${scheduled ? 'แก้ไขแผนงาน' : 'กำหนดแผนงาน'}</button>` : ''}</div>
  </div>
  ${scheduled && p.planMode !== 'boq' && store.can(p.id, 'editProject') ? `<div class="notice">${icon('chart')}<div><b>ใช้แผนงานนี้เป็นเส้นแผนใน S-Curve</b><span>ตอนนี้เส้นแผนคำนวณแบบ "${p.planMode === 'linear' ? 'เส้นตรง' : p.planMode === 'custom' ? 'กำหนดจุดเอง' : 'S-Curve อัตโนมัติ'}" กดเพื่อเปลี่ยนให้เทียบกับแผนงานรายรายการ</span></div><button class="btn" data-act="use">ใช้แผนนี้</button></div>` : ''}
  ${!scheduled ? `<section class="panel">${emptyState({ ic: 'calendar', title: 'ยังไม่ได้กำหนดแผนงาน', text: `กำหนดว่าแต่ละรายการทำวันที่เท่าไรถึงเท่าไรของสัญญา เช่น ระยะเวลา ${N} วัน เทคอนกรีตวันที่ 3–5 ระบบจะเทียบแผนกับผลงานจริงให้`, actions: canEdit ? `<button class="btn btn-primary" data-act="edit2">${icon('edit')}กำหนดแผนงาน</button>` : '' })}</section>` : `
  <section class="panel panel-flush gantt-panel">
    <div class="gt-legend"><span><i class="lg-plan"></i>ช่วงเวลาตามแผน</span><span><i class="lg-a"></i>ผลงานจริง</span><span><i class="lg-behind"></i>ตามหลังแผนเกิน 5%</span><span><i class="lg-today"></i>วันนี้</span></div>
    <div class="gantt-scroll">
      <div class="gantt">
        <div class="gt-row gt-head"><div class="gt-label"><b>รายการ</b></div><div class="gt-track">${axis}</div><div class="gt-nums"><span>ณ วันนี้</span></div></div>
        <div class="gt-body">${grid}${rows}</div>
      </div>
    </div>
  </section>`}`;

  el.querySelector('[data-act="edit"]')?.addEventListener('click', () => startEdit(el, ctx));
  el.querySelector('[data-act="edit2"]')?.addEventListener('click', () => startEdit(el, ctx));
  el.querySelector('[data-act="use"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'กำลังบันทึก…');
    try { await store.saveProject({ ...p, planMode: 'boq' }); toast('เส้นแผนใน S-Curve ใช้แผนงานรายรายการแล้ว'); ctx.rerender(); }
    catch (ex) { toast(ex.message, 'bad'); setBusy(btn, false); }
  });
}

// ---------- แก้ไขแผนงาน ----------
function renderEdit(el, ctx) {
  const { p } = ctx;
  const N = contractDays(p);
  const groups = [];
  for (const it of st.draft) { const g = it.group || 'ไม่ระบุหมวด'; if (!groups.includes(g)) groups.push(g); }
  const dateMode = st.mode === 'date';
  const inp = (i, f) => {
    const v = num(st.draft[i][f]);
    return dateMode
      ? `<input type="date" data-i="${i}" data-f="${f}" value="${v > 0 ? dayToIso(p, v) : ''}">`
      : `<input class="in-day" data-i="${i}" data-f="${f}" value="${v > 0 ? v : ''}" inputmode="numeric" placeholder="–">`;
  };
  el.innerHTML = `
  <div class="toolbar sticky-bar">
    <div class="tb-info">กำหนดแผนงาน <span class="sep"></span> วันที่ 1 = ${fmt.date(p.startDate)} ถึงวันที่ ${N} = ${fmt.date(p.endDate)}</div>
    <div class="tb-actions">
      <div class="seg seg-sm" role="group" aria-label="รูปแบบการกรอก">
        <button class="${!dateMode ? 'is-on' : ''}" data-mode="day">กรอกเป็นวันที่ของสัญญา</button>
        <button class="${dateMode ? 'is-on' : ''}" data-mode="date">กรอกเป็นวันที่ปฏิทิน</button>
      </div>
      <button class="btn" data-act="cancel">ยกเลิก</button>
      <button class="btn btn-primary" data-act="save">${icon('check')}บันทึกแผนงาน</button>
    </div>
  </div>
  <p class="hint">${icon('calendar')}ตัวอย่าง: สัญญา ${N} วัน งานเทคอนกรีตทำวันที่ 3 ถึง 5 ให้กรอก "3" และ "5" — กรอกช่วงของหมวดแล้วกด "ใช้กับทุกรายการ" เพื่อกรอกทีเดียวทั้งหมวด</p>
  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="boq plan-edit">
        <thead><tr><th class="c-no">ลำดับ</th><th>รายการ</th><th>${dateMode ? 'วันเริ่ม' : 'เริ่มวันที่'}</th><th>${dateMode ? 'วันเสร็จ' : 'ถึงวันที่'}</th><th class="r">ระยะเวลา</th><th>ช่วงวันที่</th></tr></thead>
        ${groups.map((g, gi) => `<tbody>
          <tr class="grp"><td colspan="2"><b>${esc(g)}</b></td>
            <td><input class="${dateMode ? '' : 'in-day'}" ${dateMode ? 'type="date"' : 'inputmode="numeric" placeholder="เริ่ม"'} data-gs="${gi}"></td>
            <td><input class="${dateMode ? '' : 'in-day'}" ${dateMode ? 'type="date"' : 'inputmode="numeric" placeholder="ถึง"'} data-ge="${gi}"></td>
            <td colspan="2"><button class="btn btn-sm" data-apply="${gi}">ใช้กับทุกรายการในหมวด</button></td></tr>
          ${st.draft.map((it, i) => ((it.group || 'ไม่ระบุหมวด') === g ? `<tr>
            <td class="c-no">${esc(it.no)}</td>
            <td class="c-desc">${esc(it.desc)}</td>
            <td>${inp(i, 'ps')}</td>
            <td>${inp(i, 'pe')}</td>
            <td class="r num" data-dur="${i}"></td>
            <td class="muted nowrap" data-span="${i}"></td>
          </tr>` : '')).join('')}
        </tbody>`).join('')}
      </table>
    </div>
  </section>`;

  const refresh = (i) => {
    const it = st.draft[i];
    const s = num(it.ps), e = num(it.pe);
    const dur = el.querySelector(`[data-dur="${i}"]`), span = el.querySelector(`[data-span="${i}"]`);
    const bad = s > 0 && e > 0 && e < s;
    dur.textContent = s > 0 && e > 0 && !bad ? `${e - s + 1} วัน` : '';
    span.textContent = s > 0 && e > 0 ? (bad ? 'วันจบอยู่ก่อนวันเริ่ม' : `${fmt.date(dayToIso(p, s))} – ${fmt.date(dayToIso(p, e))}`) : '';
    span.classList.toggle('is-bad', bad || (e > N) || (s > 0 && s < 1));
    if (!bad && e > N) span.textContent += ' (เกินสัญญา)';
  };
  st.draft.forEach((_, i) => refresh(i));
  const toDay = (v) => {
    if (!v) return '';
    if (dateMode) return dayOf(p, v);
    const n = Math.round(num(v));
    return n > 0 ? n : '';
  };

  el.querySelector('tbody')?.closest('table').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.i == null) return;
    guard.dirty = true;
    st.draft[+t.dataset.i][t.dataset.f] = toDay(t.value);
    refresh(+t.dataset.i);
  });
  el.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => {
    const gi = b.dataset.apply;
    const s = toDay(el.querySelector(`[data-gs="${gi}"]`).value);
    const e = toDay(el.querySelector(`[data-ge="${gi}"]`).value);
    if (!s || !e) { toast('กรอกวันเริ่มและวันจบของหมวดก่อน', 'bad'); return; }
    st.draft.forEach((it) => { if ((it.group || 'ไม่ระบุหมวด') === groups[+gi]) { it.ps = s; it.pe = e; } });
    guard.dirty = true;
    renderEdit(el, ctx);
  }));
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; renderEdit(el, ctx); }));
  el.querySelector('[data-act="cancel"]').addEventListener('click', async () => {
    if (guard.dirty && !(await confirmBox({ title: 'ยกเลิกการแก้ไข', message: 'การแก้ไขแผนงานที่ยังไม่บันทึกจะหายไป', ok: 'ยกเลิกการแก้ไข', danger: true }))) return;
    guard.dirty = false; st.editing = false; renderGantt(el, ctx);
  });
  el.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const bad = st.draft.find((it) => num(it.ps) > 0 && num(it.pe) > 0 && num(it.pe) < num(it.ps));
    if (bad) { toast(`"${bad.desc}" วันจบอยู่ก่อนวันเริ่ม`, 'bad'); return; }
    const half = st.draft.find((it) => (num(it.ps) > 0) !== (num(it.pe) > 0));
    if (half) { toast(`"${half.desc}" ต้องกรอกทั้งวันเริ่มและวันจบ หรือเว้นว่างทั้งคู่`, 'bad'); return; }
    const outside = st.draft.filter((it) => num(it.pe) > N || (num(it.ps) !== 0 && num(it.ps) < 1));
    if (outside.length && !(await confirmBox({ title: 'แผนงานเกินระยะเวลาสัญญา', message: `มี ${outside.length} รายการที่วางแผนนอกช่วงสัญญา (วันที่ 1–${N}) ต้องการบันทึกต่อหรือไม่`, ok: 'บันทึกต่อ' }))) return;
    setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await store.saveBoq(p.id, st.draft, (n, t) => { btn.innerHTML = `<span class="spin"></span>กำลังบันทึก ${n}/${t}…`; });
      guard.dirty = false;
      st.editing = false;
      toast('บันทึกแผนงานแล้ว');
      ctx.rerender();
    } catch (ex) { toast(ex.message, 'bad', 6000); setBusy(btn, false); }
  });
}
