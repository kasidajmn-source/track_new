// แท็บบันทึกความคืบหน้า: ประวัติรายสัปดาห์ + ฟอร์มบันทึก
import { store } from '../store.js';
import {
  sortUpdates, cumulative, progressFromCum, planAt, weekNo, ratio, num, todayISO, METHODS, timeFraction,
} from '../calc.js';
import { esc, fmt, icon, emptyState, toast, confirmBox, setBusy, guard } from '../ui.js';
import { deltaHTML, mailNote, personName } from './common.js';
import { PHOTO_CATEGORY_HINT } from '../defaults.js';

const ed = { pid: null, id: null, entries: {}, inputMode: 'qty', hideDone: true, q: '', photos: [] };
window.addEventListener('pt:discard', () => { ed.id = null; });

export function renderUpdates(el, ctx, sub) {
  if (sub && !store.can(ctx.p, 'recordProgress')) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'lock', title: 'คุณไม่มีสิทธิ์บันทึกความคืบหน้าของโครงการนี้', text: 'ผู้ควบคุมงานหรือเจ้าของโครงการเป็นผู้บันทึกความคืบหน้า', actions: `<a class="btn" href="#/p/${encodeURIComponent(ctx.p.id)}/updates">ดูประวัติการบันทึก</a>` })}</section>`;
    return;
  }
  if (sub) renderEditor(el, ctx, sub === 'new' ? null : decodeURIComponent(sub));
  else renderHistory(el, ctx);
}

/** ความคืบหน้าหลังแต่ละการบันทึก */
function progressTrail(p, items, ups) {
  const out = new Map();
  const cum = {};
  let manual = null;
  for (const u of sortUpdates(ups)) {
    for (const k in u.entries || {}) cum[k] = (cum[k] || 0) + num(u.entries[k]);
    if (u.manualPct !== '' && u.manualPct != null && Number.isFinite(+u.manualPct)) manual = +u.manualPct;
    out.set(u.id, p.progressMethod === 'time' ? timeFraction(p, u.date) : progressFromCum(p, items, cum, manual));
  }
  return out;
}

function renderHistory(el, ctx) {
  const { p } = ctx;
  const items = store.boqOf(p.id);
  const ups = store.updatesOf(p.id);
  const pid = encodeURIComponent(p.id);
  const trail = progressTrail(p, items, ups);
  const needsBoq = !['manual', 'time'].includes(p.progressMethod) && !items.length;
  const photos = store.filesOf(p.id).filter((f) => f.updateId);
  const photoCount = {};
  for (const f of photos) photoCount[f.updateId] = (photoCount[f.updateId] || 0) + 1;
  const canRec = store.can(p, 'recordProgress');

  if (!ups.length) {
    el.innerHTML = `<section class="panel">${emptyState({
      ic: 'clipboard',
      title: 'ยังไม่มีบันทึกความคืบหน้า',
      text: !canRec ? 'ผู้ควบคุมงานจะบันทึกความคืบหน้าทุกสัปดาห์ และแสดงที่นี่' : needsBoq
        ? 'ต้องมีรายการ BOQ ก่อนจึงจะบันทึกปริมาณงานได้ หรือเปลี่ยนวิธีคำนวณเป็น "กรอกเปอร์เซ็นต์เอง" ที่แท็บตั้งค่า'
        : 'บันทึกปริมาณงานที่ทำได้ทุกสัปดาห์ ระบบจะสะสมและคำนวณเปอร์เซ็นต์ให้อัตโนมัติ',
      actions: !canRec ? '' : needsBoq
        ? `<a class="btn btn-primary" href="#/p/${pid}/boq">${icon('list')}ไปเพิ่ม BOQ</a>`
        : `<a class="btn btn-primary" href="#/p/${pid}/updates/new">${icon('plus')}บันทึกความคืบหน้าครั้งแรก</a>`,
    })}</section>`;
    return;
  }

  const rev = [...ups].reverse();
  el.innerHTML = `
  <div class="toolbar">
    <div class="tb-info"><b>${ups.length}</b> ครั้ง <span class="sep"></span> ${esc(METHODS[p.progressMethod || 'boq_value'].label)}</div>
    <div class="tb-actions">${canRec ? `<a class="btn btn-primary" href="#/p/${pid}/updates/new">${icon('plus')}บันทึกความคืบหน้า</a>` : ''}</div>
  </div>
  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="hist">
        <thead><tr><th>สัปดาห์</th><th>วันที่</th><th class="r">ผลงานสะสม</th><th class="r">เพิ่มขึ้น</th><th class="r">แผน</th><th>ผลการดำเนินงาน / ปัญหา</th><th>ผู้บันทึก</th><th></th></tr></thead>
        <tbody>${rev.map((u, i) => {
          const v = trail.get(u.id) ?? 0;
          const prev = i + 1 < rev.length ? (trail.get(rev[i + 1].id) ?? 0) : 0;
          const pl = planAt(p, u.date, items);
          return `<tr>
            <td><b class="num">${u.week || weekNo(p, u.date) || '–'}</b></td>
            <td class="nowrap">${fmt.date(u.date)}</td>
            <td class="r"><b class="num">${fmt.pct(v)}</b></td>
            <td class="r num">${deltaHTML((v - prev) * 100)}</td>
            <td class="r num muted">${fmt.pct(pl)}</td>
            <td class="c-note">${esc(u.note || '')}${u.issues ? `<span class="t-issue">${icon('alert')}${esc(u.issues)}</span>` : ''}${photoCount[u.id] ? `<a class="link small" href="#/p/${pid}/docs">${icon('image')}รูป ${photoCount[u.id]} รูป</a>` : ''}</td>
            <td class="nowrap muted">${esc(u.createdBy || '')}</td>
            <td class="row-tools">${canRec ? `
              <a class="icon-btn" href="#/p/${pid}/updates/${encodeURIComponent(u.id)}" title="แก้ไข" aria-label="แก้ไข">${icon('edit')}</a>
              <button class="icon-btn danger" data-del="${esc(u.id)}" title="ลบ" aria-label="ลบ">${icon('trash')}</button>` : ''}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </section>`;

  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const u = ups.find((x) => x.id === b.dataset.del);
    if (!(await confirmBox({ title: 'ลบบันทึกความคืบหน้า', message: `ลบบันทึกวันที่ ${fmt.dateLong(u.date)}? ปริมาณงานที่บันทึกในครั้งนี้จะถูกหักออกจากยอดสะสม`, ok: 'ลบบันทึก', danger: true }))) return;
    try { await store.deleteUpdate(u.id); toast('ลบบันทึกแล้ว'); ctx.rerender(); }
    catch (e) { toast(e.message, 'bad'); }
  }));
}

// ---------- ฟอร์มบันทึก ----------
function renderEditor(el, ctx, id) {
  const { p } = ctx;
  const pid = encodeURIComponent(p.id);
  const items = store.boqOf(p.id);
  const all = store.updatesOf(p.id);
  const existing = id ? all.find((u) => u.id === id) : null;
  if (id && !existing) { location.hash = `#/p/${pid}/updates`; return; }
  const method = p.progressMethod || 'boq_value';
  const useBoq = !['manual', 'time'].includes(method);

  if (useBoq && !items.length) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'list', title: 'ยังไม่มีรายการ BOQ', text: 'เพิ่ม BOQ ก่อน หรือเปลี่ยนวิธีคำนวณเป็น "กรอกเปอร์เซ็นต์เอง" ที่แท็บตั้งค่าโครงการ', actions: `<a class="btn btn-primary" href="#/p/${pid}/boq">ไปเพิ่ม BOQ</a>` })}</section>`;
    return;
  }

  if (ed.pid !== p.id || ed.id !== (id || 'new')) {
    ed.pid = p.id; ed.id = id || 'new';
    ed.entries = existing ? { ...(existing.entries || {}) } : {};
    ed.photos = [];
  }
  const draft = {
    date: existing?.date || todayISO(),
    manualPct: existing?.manualPct ?? '',
    note: existing?.note || '',
    issues: existing?.issues || '',
  };
  const others = all.filter((u) => u.id !== existing?.id);
  const photoCat = (p.docCategories || []).find((c) => c.includes(PHOTO_CATEGORY_HINT)) || (p.docCategories || [])[0] || 'รูปถ่ายความคืบหน้า';
  const lastManual = [...others].reverse().find((u) => u.manualPct !== '' && u.manualPct != null);
  const notifyTo = store.legacy ? [] : globalThis.PTRules.recipients(p, 'progress', null, store.me.email).info;

  el.innerHTML = `
  <form class="panel upd" id="upd" novalidate>
    <header class="upd-head">
      <div>
        <h2>${existing ? 'แก้ไขบันทึกความคืบหน้า' : 'บันทึกความคืบหน้า'} <span id="u-week" class="muted"></span></h2>
        <p class="muted">${esc(METHODS[method].label)}</p>
      </div>
      <label class="field field-inline"><span>วันที่</span><input type="date" name="date" value="${esc(draft.date)}" required></label>
    </header>

    <div class="upd-live" id="u-live" aria-live="polite"></div>

    ${useBoq ? `
    <div class="upd-tools">
      <div class="seg seg-sm" role="radiogroup" aria-label="วิธีกรอก">
        <label><input type="radio" name="inputMode" value="qty" ${ed.inputMode === 'qty' ? 'checked' : ''}>กรอกปริมาณที่ทำได้ช่วงนี้</label>
        <label><input type="radio" name="inputMode" value="pct" ${ed.inputMode === 'pct' ? 'checked' : ''}>กรอก % สะสมของแต่ละรายการ</label>
      </div>
      <label class="search">${icon('search')}<input type="search" placeholder="ค้นหารายการ" value="${esc(ed.q)}" id="u-q" aria-label="ค้นหารายการ BOQ"></label>
      <label class="check"><input type="checkbox" id="u-hide" ${ed.hideDone ? 'checked' : ''}>ซ่อนรายการที่เสร็จแล้ว</label>
    </div>
    <div class="table-wrap">
      <table class="boq upd-table">
        <thead><tr><th>รายการ</th><th>หน่วย</th><th class="r">ปริมาณ BOQ</th><th class="r">สะสมก่อนหน้า</th><th class="r c-in" id="u-colh"></th><th class="r">สะสมรวม</th><th class="w-bar">%</th></tr></thead>
        <tbody id="u-body"></tbody>
      </table>
    </div>` : method === 'manual' ? `
    <div class="upd-manual">
      <label class="field"><span>ความคืบหน้ารวม ณ วันที่บันทึก (%)</span>
        <input type="number" name="manualPct" min="0" max="100" step="0.01" value="${esc(draft.manualPct)}" inputmode="decimal" placeholder="${lastManual ? `ครั้งก่อน ${lastManual.manualPct}%` : 'เช่น 35.5'}" required></label>
    </div>` : `<p class="hint pad">โครงการนี้คิดความคืบหน้าตามระยะเวลาสัญญาโดยอัตโนมัติ บันทึกนี้ใช้เก็บรายละเอียดการดำเนินงานและรูปถ่าย</p>`}

    <div class="form-grid upd-notes">
      <label class="field"><span>ผลการดำเนินงาน</span><textarea name="note" rows="3" placeholder="เช่น เทคอนกรีตฐานราก F1–F8 แล้วเสร็จ">${esc(draft.note)}</textarea></label>
      <label class="field"><span>ปัญหาและอุปสรรค</span><textarea name="issues" rows="3" placeholder="ถ้าไม่มีให้เว้นว่าง">${esc(draft.issues)}</textarea></label>
      <div class="field span-2">
        <span>แนบรูปถ่ายความคืบหน้า <small class="muted">บันทึกเข้าหมวด "${esc(photoCat)}"</small></span>
        <label class="drop drop-sm" id="u-drop">${icon('image')}<b>เลือกรูปหรือลากมาวาง</b><input type="file" accept="image/*" multiple hidden id="u-photos"></label>
        <div class="thumbs" id="u-thumbs"></div>
      </div>
    </div>

    <footer class="upd-foot">
      ${notifyTo.length ? `<label class="check upd-notify" title="${esc(notifyTo.map((e) => personName(p, e)).join(', '))}"><input type="checkbox" id="u-notify" ${existing ? '' : 'checked'}>${icon('mail')}แจ้งอีเมลผู้ติดตาม/หัวหน้า ${notifyTo.length} คน</label>` : ''}
      <a class="btn" href="#/p/${pid}/updates" data-act="cancel">ยกเลิก</a>
      <button class="btn btn-primary" type="submit" data-act="save">${icon('check')}บันทึก</button>
    </footer>
  </form>`;

  const form = el.querySelector('#upd');
  const body = el.querySelector('#u-body');
  form.addEventListener('input', (e) => {
    if (!['u-q', 'u-hide'].includes(e.target.id) && e.target.name !== 'inputMode') guard.dirty = true;
  });

  const prevCum = () => {
    const d = form.elements.date.value || todayISO();
    return cumulative(others.filter((u) => u.date < d || (u.date === d && String(u.createdAt) < String(existing?.createdAt || '~'))));
  };

  const live = () => {
    const d = form.elements.date.value || todayISO();
    const wk = weekNo(p, d);
    el.querySelector('#u-week').textContent = wk && wk > 0 ? `สัปดาห์ที่ ${wk}` : '';
    const upTo = others.filter((u) => u.date <= d);
    const cumBefore = cumulative(upTo);
    const cumAfter = { ...cumBefore };
    for (const k in ed.entries) cumAfter[k] = (cumAfter[k] || 0) + num(ed.entries[k]);
    const lastM = [...sortUpdates(upTo)].reverse().find((u) => u.manualPct !== '' && u.manualPct != null);
    const mBefore = lastM ? +lastM.manualPct : null;
    const mNow = form.elements.manualPct ? (form.elements.manualPct.value === '' ? mBefore : +form.elements.manualPct.value) : mBefore;
    const before = method === 'time' ? timeFraction(p, d) : progressFromCum(p, items, cumBefore, mBefore);
    const after = method === 'time' ? timeFraction(p, d) : progressFromCum(p, items, cumAfter, mNow);
    const plan = planAt(p, d, items);
    el.querySelector('#u-live').innerHTML = `
      <div><span>ผลงานสะสมหลังบันทึก</span><b class="num">${fmt.pct(after)}</b>${deltaHTML((after - before) * 100)}</div>
      <div><span>แผน ณ วันที่บันทึก</span><b class="num">${fmt.pct(plan)}</b></div>
      <div><span>เทียบกับแผน</span><b class="num ${after - plan < -0.0001 ? 'is-bad' : 'is-good'}">${fmt.signed((after - plan) * 100)}%</b></div>`;
  };

  const drawRows = () => {
    if (!body) return;
    const pc = prevCum();
    const q = ed.q.trim().toLowerCase();
    el.querySelector('#u-colh').textContent = ed.inputMode === 'qty' ? 'ทำได้ช่วงนี้' : '% สะสม';
    let lastGroup = null;
    let html = '';
    let shown = 0;
    for (const it of items) {
      const before = pc[it.id] || 0;
      const add = num(ed.entries[it.id]);
      const qty = num(it.qty);
      const doneBefore = qty > 0 && before >= qty - 1e-9;
      if (ed.hideDone && doneBefore && !add) continue;
      if (q && !`${it.no} ${it.desc} ${it.group}`.toLowerCase().includes(q)) continue;
      if (it.group !== lastGroup) { html += `<tr class="grp"><td colspan="7"><b>${esc(it.group || 'ไม่ระบุหมวด')}</b></td></tr>`; lastGroup = it.group; }
      const after = before + add;
      const r = ratio(after, qty, p.allowOver);
      const val = ed.inputMode === 'qty'
        ? (ed.entries[it.id] === undefined || ed.entries[it.id] === '' ? '' : +num(ed.entries[it.id]).toFixed(4))
        : (ed.entries[it.id] === undefined || ed.entries[it.id] === '' ? '' : +((qty ? after / qty : 0) * 100).toFixed(2));
      html += `<tr class="${after > qty + 1e-9 ? 'is-over' : ''}">
        <td class="c-desc"><span class="muted">${esc(it.no)}</span> ${esc(it.desc)}</td>
        <td>${esc(it.unit)}</td>
        <td class="r num">${fmt.num(qty)}</td>
        <td class="r num">${fmt.num(before)}</td>
        <td class="r c-in"><input data-id="${esc(it.id)}" value="${val}" inputmode="decimal" placeholder="${ed.inputMode === 'qty' ? '0' : fmt.num(qty ? (before / qty) * 100 : 0)}" aria-label="${esc(it.desc)}"></td>
        <td class="r num" data-after="${esc(it.id)}">${fmt.num(after)}</td>
        <td><div class="mini ${r >= 0.999 ? 'is-done' : ''}"><span style="width:${Math.min(100, r * 100).toFixed(1)}%"></span></div><span class="num" data-r="${esc(it.id)}">${fmt.pct(r)}</span></td>
      </tr>`;
      shown++;
    }
    body.innerHTML = html || `<tr><td colspan="7" class="muted pad">${ed.hideDone ? 'ทุกรายการเสร็จแล้ว หรือไม่ตรงกับคำค้น — เอาเครื่องหมาย "ซ่อนรายการที่เสร็จแล้ว" ออกเพื่อดูทั้งหมด' : 'ไม่พบรายการ'}</td></tr>`;
    void shown;
  };

  const onInput = (inp) => {
    const id = inp.dataset.id;
    const it = items.find((x) => x.id === id);
    const pc = prevCum();
    const before = pc[id] || 0;
    const raw = inp.value.trim();
    if (raw === '') delete ed.entries[id];
    else if (ed.inputMode === 'qty') ed.entries[id] = num(raw);
    else ed.entries[id] = +((num(raw) / 100) * num(it.qty) - before).toFixed(6);
    const after = before + num(ed.entries[id]);
    const r = ratio(after, it.qty, p.allowOver);
    const row = inp.closest('tr');
    row.classList.toggle('is-over', after > num(it.qty) + 1e-9);
    row.querySelector(`[data-after]`).textContent = fmt.num(after);
    row.querySelector(`[data-r]`).textContent = fmt.pct(r);
    const bar = row.querySelector('.mini');
    bar.classList.toggle('is-done', r >= 0.999);
    bar.firstElementChild.style.width = `${Math.min(100, r * 100).toFixed(1)}%`;
    live();
  };

  if (body) {
    drawRows();
    body.addEventListener('input', (e) => { if (e.target.dataset.id) onInput(e.target); });
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.dataset.id) return;
      e.preventDefault();
      const ins = [...body.querySelectorAll('input[data-id]')];
      ins[ins.indexOf(e.target) + 1]?.focus();
    });
    form.querySelectorAll('[name="inputMode"]').forEach((r) => r.addEventListener('change', () => { ed.inputMode = r.value; drawRows(); }));
    el.querySelector('#u-hide').addEventListener('change', (e) => { ed.hideDone = e.target.checked; drawRows(); });
    el.querySelector('#u-q').addEventListener('input', (e) => { ed.q = e.target.value; drawRows(); });
  }
  form.elements.date.addEventListener('change', () => { drawRows(); live(); });
  form.elements.manualPct?.addEventListener('input', live);
  live();

  // รูปถ่าย
  const drawThumbs = () => {
    const box = el.querySelector('#u-thumbs');
    box.innerHTML = ed.photos.map((f, i) => `<figure><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="icon-btn" data-rm="${i}" aria-label="เอาออก">${icon('x')}</button><figcaption>${esc(f.name)}</figcaption></figure>`).join('');
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { ed.photos.splice(+b.dataset.rm, 1); drawThumbs(); }));
  };
  const addPhotos = (list) => { guard.dirty = true; ed.photos.push(...[...list].filter((f) => f.type.startsWith('image/'))); drawThumbs(); };
  const drop = el.querySelector('#u-drop');
  el.querySelector('#u-photos').addEventListener('change', (e) => addPhotos(e.target.files));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); addPhotos(e.dataTransfer.files); });
  drawThumbs();

  el.querySelector('[data-act="cancel"]').addEventListener('click', () => { guard.dirty = false; ed.id = null; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('[data-act="save"]');
    const date = form.elements.date.value;
    if (!date) { toast('กรุณาระบุวันที่', 'bad'); return; }
    const entries = {};
    for (const k in ed.entries) { const v = num(ed.entries[k]); if (Math.abs(v) > 1e-9) entries[k] = +v.toFixed(6); }
    let manualPct = '';
    if (method === 'manual') {
      if (form.elements.manualPct.value === '') { toast('กรุณากรอก % ความคืบหน้ารวม', 'bad'); form.elements.manualPct.focus(); return; }
      manualPct = Math.min(100, Math.max(0, num(form.elements.manualPct.value)));
    }
    if (useBoq && !Object.keys(entries).length && !form.elements.note.value.trim() && !ed.photos.length
      && !(await confirmBox({ title: 'ยังไม่ได้กรอกปริมาณงาน', message: 'บันทึกนี้ไม่มีปริมาณงานเพิ่มขึ้น ต้องการบันทึกต่อหรือไม่', ok: 'บันทึก' }))) return;
    const pc = prevCum();
    const over = items.filter((it) => (pc[it.id] || 0) + num(entries[it.id]) > num(it.qty) + 1e-9 && entries[it.id]);
    if (over.length && !p.allowOver && !(await confirmBox({
      title: 'ปริมาณเกิน BOQ',
      message: `${over.length} รายการมีปริมาณสะสมเกินปริมาณใน BOQ (${over.slice(0, 3).map((x) => esc(x.desc)).join(', ')}) ระบบจะนับความคืบหน้าสูงสุด 100% ต่อรายการ`,
      ok: 'บันทึกต่อ',
    }))) return;

    setBusy(btn, true, 'กำลังบันทึก…');
    try {
      const saved = await store.saveUpdate({
        ...(existing || {}),
        projectId: p.id, date, week: weekNo(p, date) || '', entries, manualPct,
        note: form.elements.note.value.trim(), issues: form.elements.issues.value.trim(),
      }, { notify: !!el.querySelector('#u-notify')?.checked });
      let failed = 0;
      for (let i = 0; i < ed.photos.length; i++) {
        btn.innerHTML = `<span class="spin"></span>อัปโหลดรูป ${i + 1}/${ed.photos.length}…`;
        try { await store.uploadFile(p.id, photoCat, ed.photos[i], { note: `สัปดาห์ที่ ${saved.week || ''} (${fmt.date(date)})`, updateId: saved.id }); }
        catch (ex) { failed++; toast(ex.message, 'bad', 6000); }
      }
      guard.dirty = false;
      ed.id = null; ed.entries = {}; ed.photos = [];
      toast(failed ? `บันทึกแล้ว แต่อัปโหลดรูปไม่สำเร็จ ${failed} รูป` : `บันทึกความคืบหน้าแล้ว${mailNote(saved._mail, store.mode)}`, failed || saved._mail?.error ? 'bad' : 'ok', 5000);
      location.hash = `#/p/${pid}/overview`;
    } catch (ex) {
      toast(ex.message, 'bad', 6000);
      setBusy(btn, false);
    }
  });
}
