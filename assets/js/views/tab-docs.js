// แท็บเอกสาร: คลังไฟล์แยกตามหมวด เก็บใน Google Drive หรือ SharePoint (หรือในเบราว์เซอร์เมื่อใช้โหมดทดลอง)
import { store } from '../store.js';
import {
  esc, fmt, icon, emptyState, toast, confirmBox, promptBox, openModal, setBusy, fileKind, fileBadge, debounce, onCleanup,
} from '../ui.js';

const st = { pid: null, q: '', view: 'list' };

export function renderDocs(el, ctx, sub) {
  const { p } = ctx;
  if (st.pid !== p.id) { st.pid = p.id; st.q = ''; }
  const pid = encodeURIComponent(p.id);
  const cat = sub ? decodeURIComponent(sub) : '';
  const files = store.filesOf(p.id);
  const cats = [...new Set([...(p.docCategories || []), ...files.map((f) => f.category || 'อื่นๆ')])];
  const count = (c) => files.filter((f) => (f.category || 'อื่นๆ') === c).length;
  const maxMB = Math.round(store.maxUploadBytes() / 1048576);
  const host = store.fileHost;
  const canUpload = store.can(p, 'uploadDocs');
  const canCats = store.can(p, 'editProject');

  el.innerHTML = `
  <div class="docs" id="docs">
    <aside class="doc-cats" aria-label="หมวดเอกสาร">
      <a href="#/p/${pid}/docs" class="${!cat ? 'is-on' : ''}">${icon('grid')}<span>ทั้งหมด</span><em>${files.length}</em></a>
      ${cats.map((c) => `<a href="#/p/${pid}/docs/${encodeURIComponent(c)}" class="${cat === c ? 'is-on' : ''}">${icon('folder')}<span>${esc(c)}</span><em>${count(c)}</em></a>`).join('')}
      ${canCats ? `<button class="btn btn-ghost btn-sm" data-act="addcat">${icon('plus')}เพิ่มหมวด</button>` : ''}
    </aside>
    <section class="doc-main">
      <div class="toolbar">
        <label class="search">${icon('search')}<input type="search" placeholder="ค้นหาชื่อไฟล์หรือหมายเหตุ" value="${esc(st.q)}" id="d-q" aria-label="ค้นหาไฟล์"></label>
        <div class="seg seg-sm seg-icons" role="group" aria-label="มุมมอง">
          <button data-view="list" class="${st.view === 'list' ? 'is-on' : ''}" title="แบบรายการ" aria-label="แบบรายการ">${icon('list')}</button>
          <button data-view="grid" class="${st.view === 'grid' ? 'is-on' : ''}" title="แบบภาพ" aria-label="แบบภาพ">${icon('image')}</button>
        </div>
        <div class="tb-actions">
          ${store.cloud && p.folderUrl ? `<a class="btn" href="${esc(p.folderUrl)}" target="_blank" rel="noopener">${icon('external')}เปิดใน ${host}</a>` : ''}
          ${store.cloud && p.folderUrl && canUpload ? `<button class="btn" data-act="scan" title="เพิ่มไฟล์ที่วางไว้ในโฟลเดอร์ ${host} โดยตรงเข้าระบบ">${icon('refresh')}ดึงไฟล์จาก ${host}</button>` : ''}
          ${canUpload ? `<button class="btn" data-act="link">${icon('link')}เพิ่มลิงก์</button>
          <button class="btn btn-primary" data-act="upload">${icon('upload')}อัปโหลดไฟล์</button>
          <input type="file" multiple hidden id="d-file">` : `<span class="muted small-note">${icon('eye')}ดูได้อย่างเดียว</span>`}
        </div>
      </div>
      <div id="d-list"></div>
      <p class="hint">${store.cloud
        ? `ไฟล์เก็บใน ${host} แยกโฟลเดอร์ตามหมวด <span class="sep"></span> ขนาดไม่เกิน ${maxMB >= 1024 ? `${Math.round(maxMB / 1024)} GB` : `${maxMB} MB`} ต่อไฟล์ ไฟล์ที่วางในโฟลเดอร์ ${host} โดยตรง กด "ดึงไฟล์จาก ${host}" เพื่อเพิ่มเข้าระบบ`
        : 'โหมดทดลอง: ไฟล์เก็บในเบราว์เซอร์เครื่องนี้เท่านั้น เชื่อมต่อ Google Drive หรือ SharePoint ที่หน้าตั้งค่าเพื่อแชร์กับทีม'}</p>
    </section>
    <div class="drop-overlay" hidden>${icon('upload')}<b>วางไฟล์เพื่ออัปโหลด${cat ? `เข้าหมวด "${esc(cat)}"` : ''}</b></div>
  </div>`;

  const list = el.querySelector('#d-list');
  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const shown = files.filter((f) => (!cat || (f.category || 'อื่นๆ') === cat) && (!q || `${f.name} ${f.note || ''}`.toLowerCase().includes(q)));
    if (!shown.length) {
      list.innerHTML = files.length && (q || cat)
        ? `<div class="panel">${emptyState({ ic: 'search', title: q ? 'ไม่พบไฟล์ที่ค้นหา' : `ยังไม่มีไฟล์ในหมวด "${cat}"`, text: q ? '' : 'ลากไฟล์มาวาง หรือกดอัปโหลดไฟล์' })}</div>`
        : `<div class="panel">${emptyState({ ic: 'folder', title: 'ยังไม่มีเอกสาร', text: canUpload ? 'ลากไฟล์มาวางที่นี่ หรือกด "อัปโหลดไฟล์" รองรับ PDF รูปภาพ Word Excel แบบ CAD และไฟล์อื่นๆ' : 'เมื่อมีการอัปโหลดเอกสาร จะแสดงที่นี่' })}</div>`;
      return;
    }
    if (st.view === 'grid') {
      list.innerHTML = `<div class="fgrid">${shown.map((f) => `
        <figure class="fcard" data-id="${esc(f.id)}">
          <button class="fthumb" data-open="${esc(f.id)}" aria-label="ดู ${esc(f.name)}">${fileKind(f).kind === 'image' ? `<img alt="" data-thumb="${esc(f.id)}" loading="lazy">` : fileBadge(f)}</button>
          <figcaption><b title="${esc(f.name)}">${esc(f.name)}</b><small>${fmt.date((f.uploadedAt || '').slice(0, 10))}${!cat ? ` <span class="sep"></span>${esc(f.category || '')}` : ''}</small></figcaption>
        </figure>`).join('')}</div>`;
      loadThumbs(list, shown);
    } else {
      list.innerHTML = `<div class="panel panel-flush"><ul class="flist">${shown.map((f) => `
        <li data-id="${esc(f.id)}">
          ${fileBadge(f)}
          <button class="f-name" data-open="${esc(f.id)}"><b>${esc(f.name)}</b>${f.note ? `<small>${esc(f.note)}</small>` : ''}</button>
          ${!cat ? `<span class="f-cat">${esc(f.category || 'อื่นๆ')}</span>` : ''}
          <span class="f-meta">${fmt.size(f.size)}<small>${fmt.dateTime(f.uploadedAt)}${f.uploadedBy ? ` <span class="sep"></span>${esc(f.uploadedBy)}` : ''}</small></span>
          <span class="row-tools">
            <button class="icon-btn" data-dl="${esc(f.id)}" title="${f.mime === 'link' ? 'เปิดลิงก์' : 'ดาวน์โหลด'}" aria-label="ดาวน์โหลด">${icon(f.mime === 'link' ? 'external' : 'download')}</button>
            ${f.subId && store.sub(f.subId) ? `<a class="icon-btn" href="#/p/${pid}/subs/${encodeURIComponent(f.subId)}" title="เปิดเรื่อง ${esc(globalThis.PTRules.subNo(store.sub(f.subId)))}" aria-label="เปิดเรื่องที่แนบ">${icon('send')}</a>` : ''}
            ${store.canEditFile(f) ? `<button class="icon-btn" data-edit="${esc(f.id)}" title="แก้ไขชื่อ/หมวด" aria-label="แก้ไข">${icon('edit')}</button>
            <button class="icon-btn danger" data-del="${esc(f.id)}" title="ลบ" aria-label="ลบ">${icon('trash')}</button>` : ''}
          </span>
        </li>`).join('')}</ul></div>`;
    }
  };
  draw();

  // ---------- เหตุการณ์ ----------
  el.querySelector('#d-q').addEventListener('input', debounce((e) => { st.q = e.target.value; draw(); }, 150));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    st.view = b.dataset.view;
    el.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('is-on', x === b));
    draw();
  }));
  const fileInput = el.querySelector('#d-file');
  el.querySelector('[data-act="upload"]')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', () => { if (fileInput.files.length) uploadDialog(ctx, [...fileInput.files], cat || cats[0]); fileInput.value = ''; });
  el.querySelector('[data-act="link"]')?.addEventListener('click', () => linkDialog(ctx, cat || cats[0], cats));
  el.querySelector('[data-act="addcat"]')?.addEventListener('click', async () => {
    const name = await promptBox({ title: 'เพิ่มหมวดเอกสาร', label: 'ชื่อหมวด', placeholder: 'เช่น ใบสั่งเปลี่ยนแปลงงาน' });
    if (!name) return;
    if ((p.docCategories || []).includes(name)) { toast('มีหมวดนี้อยู่แล้ว', 'bad'); return; }
    try {
      await store.saveProject({ ...p, docCategories: [...(p.docCategories || []), name] });
      location.hash = `#/p/${pid}/docs/${encodeURIComponent(name)}`;
    } catch (e) { toast(e.message, 'bad'); }
  });
  el.querySelector('[data-act="scan"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'กำลังตรวจโฟลเดอร์…');
    try {
      const added = await store.scanDrive(p.id);
      toast(added.length ? `เพิ่มไฟล์จาก ${host} ${added.length} ไฟล์` : `ไม่มีไฟล์ใหม่ในโฟลเดอร์ ${host}`);
      ctx.rerender();
    } catch (ex) { toast(ex.message, 'bad', 6000); setBusy(btn, false); }
  });

  list.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-open],[data-dl],[data-edit],[data-del]');
    if (!t) return;
    const id = t.dataset.open || t.dataset.dl || t.dataset.edit || t.dataset.del;
    const f = files.find((x) => x.id === id);
    if (!f) return;
    if (t.dataset.open) preview(f);
    else if (t.dataset.dl) downloadFile(f);
    else if (t.dataset.edit) editDialog(ctx, f, cats);
    else if (t.dataset.del) {
      if (!(await confirmBox({ title: 'ลบไฟล์', message: `ลบ "${esc(f.name)}"?${store.cloud && f.driveId ? ` ไฟล์ใน ${host} จะถูกย้ายไปถังขยะ/ถังรีไซเคิล (กู้คืนได้ภายหลัง)` : ''}`, ok: 'ลบไฟล์', danger: true }))) return;
      try { await store.deleteFile(f.id); toast('ลบไฟล์แล้ว'); ctx.rerender(); } catch (ex) { toast(ex.message, 'bad'); }
    }
  });

  // ลากไฟล์มาวาง
  const root = el.querySelector('#docs');
  const overlay = root.querySelector('.drop-overlay');
  if (!canUpload) return;
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  root.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; overlay.hidden = false; });
  root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
  root.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; overlay.hidden = true;
    const fl = [...e.dataTransfer.files];
    if (fl.length) uploadDialog(ctx, fl, cat || cats[0]);
  });
}

async function loadThumbs(root, files) {
  const urls = [];
  for (const f of files) {
    const img = root.querySelector(`[data-thumb="${CSS.escape(f.id)}"]`);
    if (!img) continue;
    const u = await store.thumbUrl(f);
    if (!u) continue;
    if (u.startsWith('blob:')) urls.push(u);
    img.onerror = () => { img.replaceWith(document.createRange().createContextualFragment(fileBadge(f))); };
    img.src = u;
  }
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)));
}

function catOptions(cats, sel) {
  return cats.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function uploadDialog(ctx, files, defaultCat) {
  const { p } = ctx;
  const cats = [...new Set([...(p.docCategories || []), ...store.filesOf(p.id).map((f) => f.category)].filter(Boolean))];
  const max = store.maxUploadBytes();
  const m = openModal({
    title: `อัปโหลด ${files.length} ไฟล์`,
    body: `<form class="form" id="uf">
      <div class="form-grid">
        <label class="field"><span>หมวดเอกสาร</span><select name="cat">${catOptions(cats, defaultCat)}</select></label>
        <label class="field"><span>หมายเหตุ (ใส่ให้ทุกไฟล์)</span><input name="note" placeholder="ไม่บังคับ"></label>
      </div>
      <ul class="uplist">${files.map((f, i) => `<li data-i="${i}" class="${f.size > max ? 'is-bad' : ''}">${fileBadge({ name: f.name, mime: f.type })}<span>${esc(f.name)}<small>${fmt.size(f.size)}${f.size > max ? ` — ใหญ่เกิน ${Math.round(max / 1048576)} MB จะถูกข้าม` : ''}</small></span><em></em></li>`).join('')}</ul>
    </form>`,
    footer: '<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-go>อัปโหลด</button>',
  });
  const go = m.el.querySelector('[data-go]');
  go.addEventListener('click', async () => {
    const form = m.el.querySelector('#uf');
    const cat = form.elements.cat.value, note = form.elements.note.value.trim();
    setBusy(go, true, 'กำลังอัปโหลด…');
    m.el.querySelector('[data-close]').disabled = true;
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      const li = m.el.querySelector(`[data-i="${i}"]`);
      const em = li.querySelector('em');
      if (files[i].size > max) { em.textContent = 'ข้าม'; continue; }
      em.innerHTML = '<span class="spin"></span>';
      const onProgress = (f) => { if (f < 1) em.innerHTML = `<span class="spin"></span>${Math.round(f * 100)}%`; };
      try { await store.uploadFile(p.id, cat, files[i], { note, onProgress }); em.innerHTML = icon('check'); li.classList.add('is-ok'); ok++; }
      catch (e) { em.textContent = 'ไม่สำเร็จ'; li.classList.add('is-bad'); li.title = e.message; toast(e.message, 'bad', 6000); }
    }
    toast(`อัปโหลดสำเร็จ ${ok}/${files.length} ไฟล์`, ok ? 'ok' : 'bad');
    m.close();
    const h = `#/p/${encodeURIComponent(p.id)}/docs/${encodeURIComponent(cat)}`;
    if (location.hash === h) ctx.rerender(); else location.hash = h;
  });
}

function linkDialog(ctx, defaultCat, cats) {
  const { p } = ctx;
  const m = openModal({
    title: 'เพิ่มลิงก์เอกสาร',
    body: `<form class="form" id="lf"><div class="form-grid">
      <label class="field span-2"><span>ลิงก์ (URL)</span><input name="url" type="url" placeholder="https://drive.google.com/…" required></label>
      <label class="field"><span>ชื่อเอกสาร</span><input name="name" required></label>
      <label class="field"><span>หมวดเอกสาร</span><select name="cat">${catOptions(cats, defaultCat)}</select></label>
      <label class="field span-2"><span>หมายเหตุ</span><input name="note"></label>
    </div><p class="hint">ใช้กับไฟล์ที่อยู่ใน Google Drive / SharePoint / OneDrive แล้ว หรือเอกสารบนเว็บไซต์อื่น</p></form>`,
    footer: '<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-go>เพิ่มลิงก์</button>',
  });
  const form = m.el.querySelector('#lf');
  form.elements.url.addEventListener('change', () => {
    if (!form.elements.name.value) {
      try { form.elements.name.value = decodeURIComponent(new URL(form.elements.url.value).pathname.split('/').filter(Boolean).pop() || ''); } catch { /* ignore */ }
    }
  });
  const go = m.el.querySelector('[data-go]');
  const submit = async (e) => {
    e?.preventDefault();
    const url = form.elements.url.value.trim(), name = form.elements.name.value.trim();
    if (!/^https?:\/\//i.test(url)) { toast('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://', 'bad'); return; }
    if (!name) { toast('กรุณาตั้งชื่อเอกสาร', 'bad'); return; }
    setBusy(go, true, 'กำลังบันทึก…');
    try { await store.addLink(p.id, form.elements.cat.value, name, url, form.elements.note.value.trim()); m.close(); toast('เพิ่มลิงก์แล้ว'); ctx.rerender(); }
    catch (ex) { toast(ex.message, 'bad'); setBusy(go, false); }
  };
  form.addEventListener('submit', submit);
  go.addEventListener('click', submit);
}

function editDialog(ctx, f, cats) {
  const m = openModal({
    title: 'แก้ไขข้อมูลไฟล์',
    body: `<form class="form" id="ef"><div class="form-grid">
      <label class="field span-2"><span>ชื่อไฟล์</span><input name="name" value="${esc(f.name)}" required></label>
      <label class="field"><span>หมวดเอกสาร</span><select name="cat">${catOptions(cats, f.category)}</select></label>
      <label class="field"><span>หมายเหตุ</span><input name="note" value="${esc(f.note || '')}"></label>
    </div>${store.cloud && f.driveId ? `<p class="hint">เปลี่ยนหมวดแล้ว ไฟล์ใน ${store.fileHost} จะถูกย้ายไปโฟลเดอร์ของหมวดใหม่ด้วย</p>` : ''}</form>`,
    footer: '<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-go>บันทึก</button>',
  });
  const go = m.el.querySelector('[data-go]');
  go.addEventListener('click', async () => {
    const form = m.el.querySelector('#ef');
    const name = form.elements.name.value.trim();
    if (!name) { toast('ชื่อไฟล์ต้องไม่ว่าง', 'bad'); return; }
    setBusy(go, true, 'กำลังบันทึก…');
    try {
      await store.updateFile(f.id, { name, category: form.elements.cat.value, note: form.elements.note.value.trim() });
      m.close(); toast('บันทึกแล้ว'); ctx.rerender();
    } catch (ex) { toast(ex.message, 'bad'); setBusy(go, false); }
  });
}

async function downloadFile(f) {
  const u = await store.fileUrls(f);
  if (!u) { toast('ไม่พบไฟล์ในเครื่องนี้', 'bad'); return; }
  if (f.mime === 'link') { window.open(u.open, '_blank', 'noopener'); return; }
  const a = document.createElement('a');
  a.href = u.download;
  if (u.local) a.download = f.name; else { a.target = '_blank'; a.rel = 'noopener'; }
  document.body.appendChild(a); a.click(); a.remove();
  if (u.local) setTimeout(() => URL.revokeObjectURL(u.download), 4000);
}

export async function preview(f) {
  const u = await store.fileUrls(f);
  if (!u) { toast('ไม่พบไฟล์ในเครื่องนี้', 'bad'); return; }
  if (f.mime === 'link') { window.open(u.open, '_blank', 'noopener'); return; }
  const { kind } = fileKind(f);
  let body;
  if (u.local) {
    if (kind === 'image') body = `<img class="pv-img" src="${u.preview}" alt="${esc(f.name)}">`;
    else if (kind === 'pdf') body = `<iframe class="pv-frame" src="${u.preview}" title="${esc(f.name)}"></iframe>`;
    else if (kind === 'video') body = `<video class="pv-img" src="${u.preview}" controls></video>`;
    else body = emptyState({ ic: 'file', title: 'ดูตัวอย่างไฟล์ประเภทนี้ในเบราว์เซอร์ไม่ได้', text: 'ดาวน์โหลดเพื่อเปิดด้วยโปรแกรมในเครื่อง หรือเชื่อมต่อ Google Drive / SharePoint เพื่อดูตัวอย่าง Word/Excel ได้ทันที' });
  } else {
    body = `<iframe class="pv-frame" src="${esc(u.preview)}" title="${esc(f.name)}" allow="autoplay"></iframe>`;
  }
  const m = openModal({
    title: f.name, size: 'xl',
    body: `<div class="pv">${body}</div>${f.note ? `<p class="hint">${esc(f.note)}</p>` : ''}`,
    footer: `${u.open ? `<a class="btn" href="${esc(u.open)}" target="_blank" rel="noopener">${icon('external')}เปิดใน ${store.fileHost}</a>` : ''}
      <button class="btn btn-primary" data-dl>${icon('download')}ดาวน์โหลด</button>`,
    onClose: () => { if (u.local) setTimeout(() => URL.revokeObjectURL(u.preview), 500); },
  });
  m.el.querySelector('[data-dl]').addEventListener('click', () => downloadFile(f));
}
