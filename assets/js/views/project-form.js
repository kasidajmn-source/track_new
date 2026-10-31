// ฟอร์มข้อมูลโครงการ (ใช้ทั้งตอนสร้างใหม่และในแท็บตั้งค่า)
import { store, conf, saveConf } from '../store.js';
import { newProject, PROJECT_STATUS } from '../defaults.js';
import { METHODS, addDays, diffDays, num } from '../calc.js';
import { esc, openModal, toast, setBusy, icon } from '../ui.js';

export function projectFieldsHTML(p, { full = true } = {}) {
  const S = store.settings;
  const types = [...new Set([...(S.projectTypes || []), ...store.data.projects.map((x) => x.type).filter(Boolean)])];
  const dur = p.startDate && p.endDate ? diffDays(p.startDate, p.endDate) : '';
  return `
  <div class="form-grid">
    <label class="field span-2"><span>ชื่อโครงการ <em>*</em></span>
      <input name="name" value="${esc(p.name)}" required placeholder="เช่น ก่อสร้างอาคารโรงพัสดุ คสล. 1 ชั้น" autocomplete="off"></label>
    <label class="field"><span>รหัสโครงการ</span><input name="code" value="${esc(p.code)}" placeholder="เช่น CN-69-001"></label>
    <label class="field"><span>ประเภทโครงการ</span>
      <input name="type" list="dl-types" value="${esc(p.type)}" placeholder="เลือกหรือพิมพ์ประเภทใหม่">
      <datalist id="dl-types">${types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
    <label class="field"><span>ผู้รับจ้าง</span><input name="contractor" value="${esc(p.contractor)}"></label>
    <label class="field"><span>เลขที่สัญญา</span><input name="contractNo" value="${esc(p.contractNo)}"></label>
    <label class="field"><span>วันเริ่มสัญญา</span><input type="date" name="startDate" value="${esc(p.startDate)}"></label>
    <div class="field field-pair">
      <label><span>ระยะเวลา (วัน)</span><input type="number" min="1" name="duration" value="${dur}" inputmode="numeric"></label>
      <label><span>วันสิ้นสุดสัญญา</span><input type="date" name="endDate" value="${esc(p.endDate)}"></label>
    </div>
    <label class="field"><span>มูลค่าสัญญา (บาท)</span>
      <input name="contractValue" value="${p.contractValue === '' || p.contractValue == null ? '' : esc(p.contractValue)}" inputmode="decimal" placeholder="ไม่ระบุ = ใช้ยอดรวม BOQ"></label>
    <label class="field"><span>ผู้ควบคุมงาน</span><input name="manager" value="${esc(p.manager)}"></label>
    ${full ? `
    <label class="field"><span>สถานะโครงการ</span>
      <select name="status">${Object.entries(PROJECT_STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="field"><span>หน่วยงานเจ้าของโครงการ</span><input name="owner" value="${esc(p.owner)}"></label>
    <label class="field"><span>สถานที่</span><input name="location" value="${esc(p.location)}"></label>
    <label class="field"><span>ป้ายกำกับ</span><input name="tags" value="${esc((p.tags || []).join(', '))}" placeholder="คั่นด้วยจุลภาค เช่น งบลงทุน, ด่วน"></label>
    <label class="field span-2"><span>รายละเอียดโครงการ</span><textarea name="description" rows="3">${esc(p.description)}</textarea></label>
    ` : `
    <label class="field span-2"><span>คิดความคืบหน้าจาก</span>
      <select name="progressMethod">${Object.entries(METHODS).map(([k, m]) => `<option value="${k}" ${p.progressMethod === k ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      <small class="hint">เปลี่ยนได้ภายหลังที่แท็บตั้งค่าของโครงการ</small></label>
    `}
  </div>`;
}

/** ผูกการคำนวณวันสิ้นสุด ⇄ ระยะเวลา */
export function bindDateSync(form) {
  const s = form.elements.startDate, d = form.elements.duration, e = form.elements.endDate;
  if (!s || !d || !e) return;
  d.addEventListener('input', () => { if (s.value && +d.value > 0) e.value = addDays(s.value, +d.value); });
  e.addEventListener('input', () => { if (s.value && e.value) d.value = diffDays(s.value, e.value); });
  s.addEventListener('input', () => {
    if (s.value && +d.value > 0) e.value = addDays(s.value, +d.value);
    else if (s.value && e.value) d.value = diffDays(s.value, e.value);
  });
}

export function readProjectFields(form, base) {
  const f = form.elements;
  const v = (n) => (f[n] ? f[n].value.trim() : base[n]);
  const out = { ...base };
  for (const k of ['name', 'code', 'type', 'contractor', 'contractNo', 'startDate', 'endDate', 'manager', 'status', 'owner', 'location', 'description', 'progressMethod']) {
    if (f[k]) out[k] = v(k);
  }
  if (f.contractValue) out.contractValue = f.contractValue.value.trim() === '' ? '' : num(f.contractValue.value);
  if (f.tags) out.tags = f.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
  return out;
}

export function validateProject(p) {
  if (!p.name) return 'กรุณาระบุชื่อโครงการ';
  if (p.startDate && p.endDate && p.endDate < p.startDate) return 'วันสิ้นสุดสัญญาต้องอยู่หลังวันเริ่มสัญญา';
  return '';
}

/** เพิ่มประเภทโครงการใหม่เข้ารายการกลางอัตโนมัติ */
export async function rememberType(type) {
  const S = store.settings;
  if (type && !(S.projectTypes || []).includes(type)) {
    await store.saveSettings({ projectTypes: [...(S.projectTypes || []), type] }).catch(() => {});
  }
}

export function openProjectForm() {
  const me = store.me;
  if (!store.legacy && !me.canCreate) { toast('บัญชีนี้ยังไม่ได้รับสิทธิ์สร้างโครงการ — ติดต่อผู้ดูแลระบบ', 'bad', 6000); return; }
  const p = newProject(store.settings);
  const m = openModal({
    title: 'สร้างโครงการใหม่',
    size: 'lg',
    body: `${!me.email && store.mode === 'local' ? `<label class="field owner-email"><span>อีเมลของคุณ <small class="muted">(ใช้เป็นเจ้าของโครงการ และระบุสิทธิ์ในโครงการ)</small></span><input id="pf-email" type="email" placeholder="name@egat.co.th"></label>` : ''}${store.legacy ? '' : `<p class="notice owner-note">${icon('shield')}<span>${me.email ? `<b>${esc(me.name || me.email)}</b> (${esc(me.email)})` : 'คุณ'} จะเป็น<b>เจ้าของโครงการ</b> ซึ่งเป็นผู้เดียวที่แต่งตั้งผู้ควบคุมงาน ผู้รับจ้าง และคณะกรรมการได้ — ทำได้ที่แท็บ "สมาชิกและสิทธิ์" หลังสร้างโครงการ</span></p>`}
      <form class="form" id="pf" novalidate>${projectFieldsHTML(p, { full: false })}</form>`,
    footer: '<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-save>สร้างโครงการ</button>',
  });
  const form = m.el.querySelector('#pf');
  bindDateSync(form);
  const save = async (e) => {
    e?.preventDefault();
    const data = readProjectFields(form, p);
    const err = validateProject(data);
    if (err) { toast(err, 'bad'); form.elements.name.focus(); return; }
    const em = m.el.querySelector('#pf-email');
    if (em && em.value.trim()) {
      const v = em.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast('อีเมลไม่ถูกต้อง', 'bad'); em.focus(); return; }
      conf.email = v; saveConf();
      window.dispatchEvent(new Event('pt:conn'));
    }
    const btn = m.el.querySelector('[data-save]');
    setBusy(btn, true, store.cloud ? `กำลังสร้างโฟลเดอร์ใน ${store.fileHost}…` : 'กำลังบันทึก…');
    try {
      const saved = await store.saveProject(data);
      await rememberType(saved.type);
      m.close();
      toast('สร้างโครงการแล้ว — เพิ่มรายการ BOQ เพื่อเริ่มติดตามความคืบหน้า');
      const needsBoq = !['manual', 'time'].includes(saved.progressMethod);
      location.hash = `#/p/${encodeURIComponent(saved.id)}/${needsBoq ? 'boq' : 'overview'}`;
    } catch (ex) {
      toast(ex.message, 'bad', 6000);
      setBusy(btn, false);
    }
  };
  form.addEventListener('submit', save);
  m.el.querySelector('[data-save]').addEventListener('click', save);
}
