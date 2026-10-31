// รายการโครงการทั้งหมด พร้อมค้นหาและกรองตามประเภท/สถานะ
import { store } from '../store.js';
import { STATUS, STATUS_ORDER } from '../calc.js';
import { esc, icon, emptyState, debounce } from '../ui.js';
import { projectRow, pageHead } from './common.js';
import { openProjectForm } from './project-form.js';

const state = { q: '', type: '', status: '', sort: 'status', group: true };

export function renderProjects(el) {
  const rows = store.rows();
  const types = [...new Set(rows.map((r) => r.p.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));

  el.innerHTML = `
  ${pageHead('โครงการทั้งหมด', `${rows.length} โครงการ`, store.me.canCreate ? `<button class="btn btn-primary" data-act="new">${icon('plus')}สร้างโครงการ</button>` : '')}
  <div class="toolbar">
    <label class="search">${icon('search')}<input type="search" placeholder="ค้นหาชื่อ รหัส ผู้รับจ้าง เลขที่สัญญา" value="${esc(state.q)}" data-f="q" aria-label="ค้นหาโครงการ"></label>
    <select data-f="type" aria-label="กรองตามประเภท"><option value="">ทุกประเภท</option>${types.map((t) => `<option ${state.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <select data-f="status" aria-label="กรองตามสถานะ"><option value="">ทุกสถานะ</option>${STATUS_ORDER.map((s) => `<option value="${s}" ${state.status === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}</select>
    <select data-f="sort" aria-label="เรียงลำดับ">
      <option value="status" ${state.sort === 'status' ? 'selected' : ''}>เรียงตามสถานะ</option>
      <option value="name" ${state.sort === 'name' ? 'selected' : ''}>เรียงตามชื่อ</option>
      <option value="progress" ${state.sort === 'progress' ? 'selected' : ''}>เรียงตามความคืบหน้า</option>
      <option value="end" ${state.sort === 'end' ? 'selected' : ''}>เรียงตามวันสิ้นสุด</option>
      <option value="value" ${state.sort === 'value' ? 'selected' : ''}>เรียงตามมูลค่า</option>
    </select>
    <label class="check"><input type="checkbox" data-f="group" ${state.group ? 'checked' : ''}>แยกตามประเภท</label>
  </div>
  <div id="plist"></div>`;

  const list = el.querySelector('#plist');
  const draw = () => {
    const q = state.q.toLowerCase();
    let r = rows.filter(({ p, a }) =>
      (!state.type || p.type === state.type) &&
      (!state.status || a.status === state.status) &&
      (!q || [p.name, p.code, p.contractor, p.contractNo, p.location, p.manager, ...(p.tags || [])].join(' ').toLowerCase().includes(q)));
    const cmp = {
      status: (x, y) => STATUS_ORDER.indexOf(x.a.status) - STATUS_ORDER.indexOf(y.a.status),
      name: (x, y) => x.p.name.localeCompare(y.p.name, 'th'),
      progress: (x, y) => y.a.actual - x.a.actual,
      end: (x, y) => String(x.p.endDate || '9').localeCompare(String(y.p.endDate || '9')),
      value: (x, y) => y.a.value - x.a.value,
    }[state.sort];
    r = r.sort((x, y) => cmp(x, y) || x.p.name.localeCompare(y.p.name, 'th'));
    if (!rows.length) {
      const can = store.me.canCreate;
      list.innerHTML = `<section class="panel">${emptyState({ ic: 'grid', title: can ? 'ยังไม่มีโครงการ' : 'ยังไม่มีโครงการที่คุณเป็นสมาชิก', text: can ? 'เริ่มจากสร้างโครงการแรก' : `ให้เจ้าของโครงการเพิ่มอีเมล ${esc(store.me.email)} เป็นสมาชิก`, actions: can ? `<button class="btn btn-primary" data-act="new2">${icon('plus')}สร้างโครงการ</button>` : '' })}</section>`;
      list.querySelector('[data-act="new2"]')?.addEventListener('click', openProjectForm);
      return;
    }
    if (!r.length) { list.innerHTML = `<section class="panel">${emptyState({ ic: 'search', title: 'ไม่พบโครงการที่ตรงกับเงื่อนไข', text: 'ลองเปลี่ยนคำค้นหรือตัวกรอง' })}</section>`; return; }
    if (state.group) {
      const groups = new Map();
      for (const x of r) { const k = x.p.type || 'ไม่ระบุประเภท'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
      list.innerHTML = [...groups].map(([k, xs]) => `
        <section class="panel panel-flush pgroup">
          <header class="panel-head"><h2>${esc(k)}</h2><span class="count">${xs.length}</span></header>
          <div class="prow-list">${xs.map((x) => projectRow(x.p, x.a)).join('')}</div>
        </section>`).join('');
    } else {
      list.innerHTML = `<section class="panel panel-flush"><div class="prow-list">${r.map((x) => projectRow(x.p, x.a, { showType: true })).join('')}</div></section>`;
    }
  };
  draw();

  el.querySelector('[data-act="new"]')?.addEventListener('click', openProjectForm);
  const q = el.querySelector('[data-f="q"]');
  q.addEventListener('input', debounce(() => { state.q = q.value; draw(); }, 150));
  for (const k of ['type', 'status', 'sort']) {
    el.querySelector(`[data-f="${k}"]`).addEventListener('change', (e) => { state[k] = e.target.value; draw(); });
  }
  el.querySelector('[data-f="group"]').addEventListener('change', (e) => { state.group = e.target.checked; draw(); });
}
