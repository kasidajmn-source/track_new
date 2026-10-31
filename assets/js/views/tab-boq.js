// แท็บ BOQ: ดู / แก้ไข / นำเข้า / ส่งออก
import { store } from '../store.js';
import { amount, unitPrice, ratio, boqTotal, num, PRICE_BASIS, METHODS } from '../calc.js';
import { esc, fmt, icon, emptyState, toast, confirmBox, promptBox, setBusy, guard, uid } from '../ui.js';
import { openBoqImport } from './boq-import.js';
import { renderPlan } from './tab-plan.js';
import { exportWorkbook, parseDelimited } from '../excel.js';

const st = { pid: null, editing: false, draft: [] };

export function renderBoq(host, ctx, sub = '') {
  const { p } = ctx;
  const pid = encodeURIComponent(p.id);
  const plan = sub === 'plan';
  host.innerHTML = `<nav class="subtabs" aria-label="มุมมอง BOQ">
    <a href="#/p/${pid}/boq" class="${plan ? '' : 'is-on'}">${icon('list')}รายการ BOQ</a>
    <a href="#/p/${pid}/boq/plan" class="${plan ? 'is-on' : ''}">${icon('gantt')}แผนงานเทียบผลงาน</a>
  </nav><div class="subtab-body"></div>`;
  const el = host.querySelector('.subtab-body');
  if (plan) { renderPlan(el, ctx); return; }
  if (st.pid !== p.id) { st.pid = p.id; st.editing = false; st.draft = []; }
  if (st.editing && store.can(p, 'editBoq')) renderEdit(el, ctx); else renderView(el, ctx);
}

function startEdit(el, ctx, items) {
  st.editing = true;
  st.draft = (items || store.boqOf(ctx.p.id)).map((x) => ({ ...x }));
  if (!st.draft.length) st.draft.push(blankRow(''));
  guard.dirty = true;
  renderEdit(el, ctx);
}
function stopEdit() { st.editing = false; st.draft = []; guard.dirty = false; }
window.addEventListener('pt:discard', () => { st.editing = false; st.draft = []; });
const blankRow = (group) => ({ id: '', group, no: '', desc: '', unit: '', qty: '', mat: '', labor: '', weight: '' });

// ---------- โหมดดู ----------
function renderView(el, ctx) {
  const { p, a } = ctx;
  const items = store.boqOf(p.id);
  const basis = p.priceBasis || 'total';
  const showW = p.progressMethod === 'boq_weight';
  const noBoq = ['manual', 'time'].includes(p.progressMethod);
  const canEdit = store.can(p, 'editBoq');

  if (!items.length) {
    el.innerHTML = `<section class="panel">${emptyState({
      ic: 'list',
      title: 'ยังไม่มีรายการ BOQ',
      text: noBoq
        ? `โครงการนี้คิดความคืบหน้าแบบ "${esc(METHODS[p.progressMethod].label)}" จึงไม่จำเป็นต้องมี BOQ แต่ใส่ไว้เพื่ออ้างอิงได้`
        : 'ใส่รายการตามใบแจ้งปริมาณงาน (ปร.4) เพื่อให้ระบบคำนวณเปอร์เซ็นต์ความคืบหน้าจากมูลค่างาน',
      actions: canEdit ? `<button class="btn btn-primary" data-act="import">${icon('upload')}นำเข้าจาก Excel / CSV</button>
                <button class="btn" data-act="paste">${icon('paste')}วางจาก Excel</button>
                <button class="btn" data-act="edit">${icon('edit')}พิมพ์รายการเอง</button>` : '',
    })}</section>`;
    bindView(el, ctx);
    return;
  }

  const groups = [];
  for (const it of items) {
    const g = it.group || 'ไม่ระบุหมวด';
    let G = groups.find((x) => x.name === g);
    if (!G) { G = { name: g, items: [] }; groups.push(G); }
    G.items.push(it);
  }
  const total = boqTotal(items, basis);
  const cols = showW ? 11 : 10;

  el.innerHTML = `
  <div class="toolbar">
    <div class="tb-info"><b>${items.length}</b> รายการ <span class="sep"></span> ยอดรวม <b class="num">${fmt.money(total)}</b> บาท <small>(${esc(PRICE_BASIS[basis])})</small></div>
    <div class="tb-actions">
      <button class="btn" data-act="export">${icon('download')}ส่งออก Excel</button>
      ${canEdit ? `<button class="btn" data-act="import">${icon('upload')}นำเข้า</button>
      <button class="btn btn-primary" data-act="edit">${icon('edit')}แก้ไข BOQ</button>` : ''}
    </div>
  </div>
  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="boq">
        <thead><tr>
          <th class="c-no">ลำดับ</th><th>รายการ</th><th>หน่วย</th><th class="r">ปริมาณ</th>
          <th class="r">ค่าวัสดุ/หน่วย</th><th class="r">ค่าแรง/หน่วย</th><th class="r">จำนวนเงิน</th>
          ${showW ? '<th class="r">น้ำหนัก %</th>' : ''}
          <th class="r">ทำได้สะสม</th><th class="r">คงเหลือ</th><th class="w-bar">ความคืบหน้า</th>
        </tr></thead>
        ${groups.map((G) => {
          const gAmt = G.items.reduce((s, i) => s + amount(i, basis), 0);
          const gEarn = G.items.reduce((s, i) => s + amount(i, basis) * ratio(a.cum[i.id] || 0, i.qty, p.allowOver), 0);
          return `<tbody>
            <tr class="grp"><td colspan="${cols - 4}"><b>${esc(G.name)}</b></td><td class="r num">${fmt.money(gAmt)}</td>${showW ? '<td></td>' : ''}<td colspan="2"></td><td class="num"><b>${gAmt ? fmt.pct(gEarn / gAmt) : '–'}</b></td></tr>
            ${G.items.map((it) => {
              const done = a.cum[it.id] || 0;
              const r = ratio(done, it.qty, p.allowOver);
              const over = done > num(it.qty) + 1e-9;
              return `<tr>
                <td class="c-no">${esc(it.no)}</td>
                <td class="c-desc">${esc(it.desc)}</td>
                <td>${esc(it.unit)}</td>
                <td class="r num">${fmt.num(it.qty)}</td>
                <td class="r num">${fmt.money(it.mat)}</td>
                <td class="r num">${fmt.money(it.labor)}</td>
                <td class="r num">${fmt.money(amount(it, basis))}</td>
                ${showW ? `<td class="r num">${it.weight === '' ? '–' : fmt.num(it.weight, 3)}</td>` : ''}
                <td class="r num ${over ? 'is-bad' : ''}">${fmt.num(done)}</td>
                <td class="r num">${fmt.num(Math.max(0, num(it.qty) - done))}</td>
                <td><div class="mini ${r >= 0.999 ? 'is-done' : ''}"><span style="width:${Math.min(100, r * 100).toFixed(1)}%"></span></div><span class="num">${fmt.pct(r)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>`;
        }).join('')}
        <tfoot><tr><td colspan="${cols - 4}">รวมทั้งสิ้น</td><td class="r num">${fmt.money(total)}</td>${showW ? '<td></td>' : ''}<td colspan="2"></td><td class="num"><b>${fmt.pct(a.actual)}</b></td></tr></tfoot>
      </table>
    </div>
  </section>
  ${noBoq ? `<p class="hint">โครงการนี้คิดความคืบหน้าแบบ "${esc(METHODS[p.progressMethod].label)}" ตัวเลขในตารางเป็นข้อมูลอ้างอิง</p>` : ''}`;
  bindView(el, ctx);
}

function bindView(el, ctx) {
  el.querySelector('[data-act="edit"]')?.addEventListener('click', () => startEdit(el, ctx));
  el.querySelector('[data-act="import"]')?.addEventListener('click', () => openBoqImport({ mode: 'file', onDone: (items, how) => importDone(el, ctx, items, how) }));
  el.querySelector('[data-act="paste"]')?.addEventListener('click', () => openBoqImport({ mode: 'paste', onDone: (items, how) => importDone(el, ctx, items, how) }));
  el.querySelector('[data-act="export"]')?.addEventListener('click', () => exportBoq(ctx));
}

function importDone(el, ctx, items, how) {
  const base = how === 'append' ? store.boqOf(ctx.p.id) : [];
  startEdit(el, ctx, [...base, ...items]);
  toast(`นำเข้า ${items.length} รายการ — ตรวจทานแล้วกด "บันทึก BOQ"`, 'info', 5000);
}

async function exportBoq({ p, a }) {
  const items = store.boqOf(p.id);
  const basis = p.priceBasis || 'total';
  const rows = [
    [`BOQ และความคืบหน้า: ${p.name}`], [`ข้อมูล ณ ${fmt.dateLong(new Date().toISOString().slice(0, 10))}`], [],
    ['หมวดงาน', 'ลำดับ', 'รายการ', 'หน่วย', 'ปริมาณ', 'ค่าวัสดุ/หน่วย', 'ค่าแรง/หน่วย', 'รวมต่อหน่วย', 'จำนวนเงิน', 'น้ำหนัก %', 'ทำได้สะสม', 'ความคืบหน้า %', 'แผน: เริ่มวันที่', 'แผน: ถึงวันที่'],
    ...items.map((i) => [i.group, i.no, i.desc, i.unit, num(i.qty), num(i.mat), num(i.labor), unitPrice(i, basis), amount(i, basis),
      i.weight === '' ? '' : num(i.weight), a.cum[i.id] || 0, +(ratio(a.cum[i.id] || 0, i.qty, p.allowOver) * 100).toFixed(2),
      num(i.ps) > 0 ? num(i.ps) : '', num(i.pe) > 0 ? num(i.pe) : '']),
    [], ['', '', 'รวมทั้งสิ้น', '', '', '', '', '', boqTotal(items, basis), '', '', +(a.actual * 100).toFixed(2)],
  ];
  const safe = String(p.code || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
  const how = await exportWorkbook(`BOQ_${safe}_${new Date().toISOString().slice(0, 10)}`, [
    { name: 'BOQ', rows, cols: [24, 7, 48, 8, 10, 12, 12, 12, 14, 9, 12, 12, 11, 11] },
  ]);
  toast(how === 'xlsx' ? 'ส่งออกไฟล์ Excel แล้ว' : 'ส่งออกเป็น CSV แล้ว (โหลดตัวสร้าง Excel ไม่ได้)');
}

// ---------- โหมดแก้ไข ----------
function fieldsFor(p) {
  const f = ['group', 'no', 'desc', 'unit', 'qty', 'mat', 'labor'];
  if (p.progressMethod === 'boq_weight') f.push('weight');
  return f;
}

function renderEdit(el, ctx) {
  const { p } = ctx;
  const showW = p.progressMethod === 'boq_weight';
  const groups = [...new Set(st.draft.map((d) => d.group).filter(Boolean))];
  el.innerHTML = `
  <div class="toolbar sticky-bar">
    <div class="tb-info">กำลังแก้ไข <b>${st.draft.length}</b> รายการ <span class="sep"></span> ยอดรวม <b class="num" id="be-total"></b> บาท</div>
    <div class="tb-actions">
      <button class="btn" data-act="cancel">ยกเลิก</button>
      <button class="btn btn-primary" data-act="save">${icon('check')}บันทึก BOQ</button>
    </div>
  </div>
  <p class="hint">คัดลอกหลายแถวจาก Excel แล้ววางลงช่องใดก็ได้ ระบบจะเติมข้อมูลต่อจากช่องนั้นให้ <span class="sep"></span> กด Enter เพื่อไปแถวถัดไป</p>
  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="boq boq-edit">
        <thead><tr>
          <th>หมวดงาน</th><th class="c-no">ลำดับ</th><th>รายการ</th><th>หน่วย</th><th class="r">ปริมาณ</th>
          <th class="r">ค่าวัสดุ/หน่วย</th><th class="r">ค่าแรง/หน่วย</th><th class="r">จำนวนเงิน</th>
          ${showW ? '<th class="r">น้ำหนัก %</th>' : ''}<th></th>
        </tr></thead>
        <tbody id="be-body"></tbody>
      </table>
    </div>
    <datalist id="dl-groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
  </section>
  <div class="row-actions">
    <button class="btn" data-act="add">${icon('plus')}เพิ่มรายการ</button>
    <button class="btn" data-act="addgroup">${icon('plus')}เพิ่มหมวดงาน</button>
    ${showW ? `<button class="btn" data-act="autow">คำนวณน้ำหนักจากมูลค่า</button>` : ''}
    <button class="btn btn-ghost" data-act="import">${icon('upload')}นำเข้าเพิ่มจากไฟล์</button>
  </div>`;
  drawRows(el, ctx);

  el.querySelector('[data-act="cancel"]').addEventListener('click', async () => {
    if (await confirmBox({ title: 'ยกเลิกการแก้ไข', message: 'การแก้ไข BOQ ที่ยังไม่บันทึกจะหายไป', ok: 'ยกเลิกการแก้ไข', danger: true })) {
      stopEdit(); renderView(el, ctx);
    }
  });
  el.querySelector('[data-act="save"]').addEventListener('click', (e) => save(el, ctx, e.currentTarget));
  el.querySelector('[data-act="add"]').addEventListener('click', () => {
    st.draft.push(blankRow(st.draft[st.draft.length - 1]?.group || ''));
    drawRows(el, ctx);
    focusCell(el, st.draft.length - 1, 'desc');
  });
  el.querySelector('[data-act="addgroup"]').addEventListener('click', async () => {
    const name = await promptBox({ title: 'เพิ่มหมวดงาน', label: 'ชื่อหมวดงาน', placeholder: 'เช่น งานโครงสร้าง' });
    if (!name) return;
    st.draft.push(blankRow(name));
    renderEdit(el, ctx);
    focusCell(el, st.draft.length - 1, 'desc');
  });
  el.querySelector('[data-act="autow"]')?.addEventListener('click', () => {
    const basis = p.priceBasis || 'total';
    const tot = st.draft.reduce((s, i) => s + amount(i, basis), 0);
    if (!tot) { toast('ใส่ปริมาณและราคาก่อนจึงจะคำนวณน้ำหนักได้', 'bad'); return; }
    st.draft.forEach((i) => { i.weight = +((amount(i, basis) / tot) * 100).toFixed(4); });
    drawRows(el, ctx);
  });
  el.querySelector('[data-act="import"]').addEventListener('click', () => openBoqImport({
    mode: 'file',
    onDone: (items) => { st.draft.push(...items); renderEdit(el, ctx); toast(`เพิ่ม ${items.length} รายการ`, 'info'); },
  }));
}

function drawRows(el, ctx) {
  const { p } = ctx;
  const basis = p.priceBasis || 'total';
  const showW = p.progressMethod === 'boq_weight';
  const body = el.querySelector('#be-body');
  const cell = (i, f, cls = '', attrs = '') => `<td><input class="${cls}" data-i="${i}" data-f="${f}" value="${esc(st.draft[i][f] ?? '')}" ${attrs}></td>`;
  body.innerHTML = st.draft.map((it, i) => `<tr>
    ${cell(i, 'group', 'in-group', 'list="dl-groups" placeholder="หมวด"')}
    ${cell(i, 'no', 'in-no')}
    ${cell(i, 'desc', 'in-desc', 'placeholder="รายการงาน"')}
    ${cell(i, 'unit', 'in-unit')}
    ${cell(i, 'qty', 'in-num', 'inputmode="decimal"')}
    ${cell(i, 'mat', 'in-num', 'inputmode="decimal"')}
    ${cell(i, 'labor', 'in-num', 'inputmode="decimal"')}
    <td class="r num" data-amt="${i}">${fmt.money(amount(it, basis))}</td>
    ${showW ? cell(i, 'weight', 'in-num in-w', 'inputmode="decimal"') : ''}
    <td class="row-tools">
      <button class="icon-btn" data-mv="${i}" data-dir="-1" title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น">${icon('arrowUp')}</button>
      <button class="icon-btn" data-mv="${i}" data-dir="1" title="เลื่อนลง" aria-label="เลื่อนลง">${icon('arrowDown')}</button>
      <button class="icon-btn danger" data-del="${i}" title="ลบรายการ" aria-label="ลบรายการ">${icon('trash')}</button>
    </td>
  </tr>`).join('');
  updateTotal(el, p);

  body.oninput = (e) => {
    const t = e.target;
    if (!t.dataset.f) return;
    const i = +t.dataset.i;
    st.draft[i][t.dataset.f] = t.value;
    if (['qty', 'mat', 'labor'].includes(t.dataset.f)) {
      body.querySelector(`[data-amt="${i}"]`).textContent = fmt.money(amount(st.draft[i], basis));
      updateTotal(el, p);
    }
  };
  body.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    const mv = e.target.closest('[data-mv]');
    if (del) { st.draft.splice(+del.dataset.del, 1); if (!st.draft.length) st.draft.push(blankRow('')); drawRows(el, ctx); }
    if (mv) {
      const i = +mv.dataset.mv, j = i + +mv.dataset.dir;
      if (j < 0 || j >= st.draft.length) return;
      [st.draft[i], st.draft[j]] = [st.draft[j], st.draft[i]];
      drawRows(el, ctx);
      body.querySelector(`[data-mv="${j}"][data-dir="${mv.dataset.dir}"]`)?.focus();
    }
  };
  body.onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.dataset.f) return;
    e.preventDefault();
    const i = +e.target.dataset.i, f = e.target.dataset.f;
    if (i === st.draft.length - 1) { st.draft.push(blankRow(st.draft[i].group)); drawRows(el, ctx); }
    focusCell(el, i + 1, f);
  };
  body.onpaste = (e) => {
    const t = e.target;
    if (!t.dataset.f) return;
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = parseDelimited(text);
    const fields = fieldsFor(p);
    const startF = fields.indexOf(t.dataset.f);
    let i = +t.dataset.i;
    for (const r of rows) {
      if (!st.draft[i]) st.draft.push(blankRow(st.draft[i - 1]?.group || ''));
      r.forEach((v, k) => {
        const f = fields[startF + k];
        if (!f) return;
        st.draft[i][f] = ['qty', 'mat', 'labor', 'weight'].includes(f) ? (String(v).trim() === '' ? '' : num(v)) : String(v).trim();
      });
      i++;
    }
    drawRows(el, ctx);
    toast(`วางข้อมูล ${rows.length} แถว`, 'info');
  };
}

function focusCell(el, i, f) {
  const inp = el.querySelector(`#be-body [data-i="${i}"][data-f="${f}"]`);
  inp?.focus();
  inp?.select?.();
}

function updateTotal(el, p) {
  const t = el.querySelector('#be-total');
  if (t) t.textContent = fmt.money(st.draft.reduce((s, i) => s + amount(i, p.priceBasis || 'total'), 0));
}

async function save(el, ctx, btn) {
  const { p } = ctx;
  const items = st.draft
    .filter((d) => String(d.desc || '').trim() || num(d.qty) > 0)
    .map((d) => ({ ...d, id: d.id || uid('B'), desc: String(d.desc || '').trim() }));
  const bad = items.findIndex((d) => !d.desc);
  if (bad >= 0) { toast(`แถวที่ ${bad + 1} ยังไม่มีชื่อรายการ`, 'bad'); return; }
  const a = store.analysis(p.id);
  const keep = new Set(items.map((i) => i.id));
  const lost = store.boqOf(p.id).filter((i) => !keep.has(i.id) && (a.cum[i.id] || 0) > 0);
  if (lost.length && !(await confirmBox({
    title: 'ลบรายการที่มีผลงานแล้ว',
    message: `มี ${lost.length} รายการที่ถูกลบออกแต่มีผลงานบันทึกไว้แล้ว (${lost.slice(0, 3).map((x) => esc(x.desc)).join(', ')}${lost.length > 3 ? ' …' : ''}) ผลงานของรายการเหล่านี้จะไม่ถูกนับรวม`,
    ok: 'บันทึกต่อ', danger: true,
  }))) return;
  setBusy(btn, true, 'กำลังบันทึก…');
  try {
    await store.saveBoq(p.id, items, (n, t) => { btn.innerHTML = `<span class="spin"></span>กำลังบันทึก ${n}/${t}…`; });
    stopEdit();
    toast(`บันทึก BOQ ${items.length} รายการแล้ว`);
    ctx.rerender();
  } catch (e) {
    toast(e.message, 'bad', 6000);
    setBusy(btn, false);
  }
}
