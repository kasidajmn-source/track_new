// นำเข้า BOQ จาก Excel / CSV / วางจาก Excel พร้อมจับคู่คอลัมน์อัตโนมัติ (รองรับรูปแบบ ปร.4)
import { openModal, esc, icon, toast, fmt, uid } from '../ui.js';
import { readTableFile, parseDelimited } from '../excel.js';
import { num } from '../calc.js';

const FIELDS = [
  ['group', 'หมวดงาน', (l) => /หมวด|group|section/i.test(l)],
  ['no', 'ลำดับ', (l) => /^(ลำดับ|ลำดับที่|ที่|no\.?|item)(\s|$)/i.test(l)],
  ['desc', 'รายการ', (l) => /รายการ|รายละเอียด|description/i.test(l)],
  ['unit', 'หน่วย', (l) => /^(หน่วย|unit)(\s|$)/i.test(l)],
  ['qty', 'ปริมาณ', (l) => /จำนวน|ปริมาณ|qty|quantity/i.test(l) && !/เงิน|amount|ราคา/i.test(l)],
  ['mat', 'ค่าวัสดุ/หน่วย', (l) => /วัสดุ|material/i.test(l) && !/จำนวนเงิน|amount|^รวม/i.test(l)],
  ['labor', 'ค่าแรง/หน่วย', (l) => /แรง|labou?r/i.test(l) && !/จำนวนเงิน|amount|^รวม/i.test(l)],
  ['price', 'ราคารวม/หน่วย', (l) => /ราคาต่อหน่วย|หน่วยละ|unit\s*price|ราคา\/หน่วย/i.test(l) && !/วัสดุ|แรง/i.test(l)],
];
const KEYWORDS = /ลำดับ|รายการ|หน่วย|จำนวน|ปริมาณ|วัสดุ|แรง|ราคา|description|qty|unit|item/i;
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function detectHeader(rows) {
  let best = 0, bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const score = rows[r].filter((c) => typeof c === 'string' && KEYWORDS.test(c)).length;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  const next = rows[best + 1] || [];
  const twoRow = next.some((c) => typeof c === 'string' && /ต่อหน่วย|หน่วยละ|จำนวนเงิน|ราคา/.test(c))
    && next.filter((c) => typeof c === 'number').length < 2;
  return { headerRow: best, twoRow };
}

function labels(rows, h, twoRow) {
  const top = rows[h] || [], sec = twoRow ? (rows[h + 1] || []) : [];
  const width = Math.max(...rows.slice(h, h + 30).map((r) => r.length), 1);
  const out = [];
  let last = '';
  for (let c = 0; c < width; c++) {
    let t = String(top[c] ?? '').replace(/\s+/g, ' ').trim();
    if (!t && twoRow && String(sec[c] ?? '').trim()) t = last; else if (t) last = t;
    const s = String(sec[c] ?? '').replace(/\s+/g, ' ').trim();
    out.push([t, s].filter(Boolean).join(' '));
  }
  return out;
}

function guessMap(labs) {
  const map = {}, used = new Set();
  for (const [f, , test] of FIELDS) {
    const i = labs.findIndex((l, k) => !used.has(k) && l && test(l));
    if (i >= 0) { map[f] = i; used.add(i); }
  }
  return map;
}

function convert(rows, cfg) {
  const { map, headerRow, twoRow, groupRows, skipTotals } = cfg;
  const start = headerRow + (twoRow ? 2 : 1);
  const get = (r, f) => (map[f] == null || map[f] === -1 ? '' : r[map[f]]);
  const items = [];
  let group = '';
  for (const r of rows.slice(start)) {
    const desc = String(get(r, 'desc') ?? '').replace(/\s+/g, ' ').trim();
    const qtyRaw = get(r, 'qty');
    const qty = num(qtyRaw);
    const mat = num(get(r, 'mat')), labor = num(get(r, 'labor')), price = num(get(r, 'price'));
    if (!desc && !qty) continue;
    if (skipTotals && /^(รวม|ยอดรวม|total|sum)/i.test(desc)) continue;
    if (groupRows && desc && !qty && !mat && !labor && !price) { group = desc; continue; }
    const g = String(get(r, 'group') ?? '').trim();
    items.push({
      id: uid('B'),
      group: g || group,
      no: String(get(r, 'no') ?? '').trim(),
      desc, unit: String(get(r, 'unit') ?? '').trim(),
      qty, mat: map.mat != null && map.mat !== -1 ? mat : price, labor: map.labor != null && map.labor !== -1 ? labor : 0,
      weight: '',
    });
  }
  return items;
}

export function openBoqImport({ mode = 'file', onDone }) {
  let sheets = null, sheetIdx = 0, cfg = null;
  const m = openModal({ title: 'นำเข้ารายการ BOQ', size: 'xl', body: '<div id="bi"></div>' });
  const root = m.el.querySelector('#bi');

  const stepSource = () => {
    root.innerHTML = `
      <div class="seg" role="tablist">
        <button class="${mode === 'file' ? 'is-on' : ''}" data-mode="file">${icon('upload')}ไฟล์ Excel / CSV</button>
        <button class="${mode === 'paste' ? 'is-on' : ''}" data-mode="paste">${icon('paste')}วางจาก Excel</button>
      </div>
      ${mode === 'file' ? `
        <label class="drop" id="bi-drop">
          ${icon('upload')}
          <b>ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</b>
          <span>รองรับ .xlsx .xls .csv — แบบฟอร์ม ปร.4 ที่มีหัวตาราง 2 แถวก็ได้</span>
          <input type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" hidden>
        </label>
        <p class="hint">ยังไม่มีไฟล์? ดาวน์โหลด <a class="link" href="templates/BOQ_template.csv" download>แม่แบบ BOQ (CSV)</a> ไปกรอกแล้วนำเข้า</p>`
      : `
        <label class="field"><span>คัดลอกตาราง BOQ จาก Excel (รวมแถวหัวตาราง) แล้ววางที่นี่</span>
          <textarea rows="10" id="bi-paste" placeholder="ลำดับ&#9;รายการ&#9;จำนวน&#9;หน่วย&#9;ค่าวัสดุ&#9;ค่าแรง"></textarea></label>
        <div class="modal-inline-actions"><button class="btn btn-primary" data-act="parse">อ่านข้อมูล</button></div>`}`;
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; stepSource(); }));
    if (mode === 'file') {
      const drop = root.querySelector('#bi-drop'), input = drop.querySelector('input');
      const take = async (file) => {
        if (!file) return;
        drop.classList.add('is-busy');
        try { sheets = (await readTableFile(file)).sheets; sheetIdx = Math.max(0, sheets.findIndex((s) => s.rows.length > 3)); prepare(); stepMap(); }
        catch (e) { toast(e.message, 'bad', 6000); drop.classList.remove('is-busy'); }
      };
      input.addEventListener('change', () => take(input.files[0]));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); take(e.dataTransfer.files[0]); });
    } else {
      root.querySelector('[data-act="parse"]').addEventListener('click', () => {
        const rows = parseDelimited(root.querySelector('#bi-paste').value);
        if (rows.length < 2) { toast('ยังไม่มีข้อมูลที่วาง หรือมีน้อยกว่า 2 แถว', 'bad'); return; }
        sheets = [{ name: 'ข้อมูลที่วาง', rows }]; sheetIdx = 0; prepare(); stepMap();
      });
    }
  };

  const prepare = () => {
    const rows = sheets[sheetIdx].rows;
    const { headerRow, twoRow } = detectHeader(rows);
    cfg = { headerRow, twoRow, groupRows: true, skipTotals: true, how: 'replace', map: guessMap(labels(rows, headerRow, twoRow)) };
  };

  const stepMap = () => {
    const rows = sheets[sheetIdx].rows;
    const labs = labels(rows, cfg.headerRow, cfg.twoRow);
    const items = convert(rows, cfg);
    const total = items.reduce((s, i) => s + i.qty * (i.mat + i.labor), 0);
    const opt = (f) => `<option value="-1">— ไม่ใช้ —</option>${labs.map((l, i) => `<option value="${i}" ${cfg.map[f] === i ? 'selected' : ''}>${colName(i)}${l ? `: ${esc(l.slice(0, 40))}` : ''}</option>`).join('')}`;
    root.innerHTML = `
      <div class="bi-cfg">
        ${sheets.length > 1 ? `<label class="field"><span>ชีต</span><select data-c="sheet">${sheets.map((s, i) => `<option value="${i}" ${i === sheetIdx ? 'selected' : ''}>${esc(s.name)} (${s.rows.length} แถว)</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>แถวหัวตาราง</span><input type="number" min="1" data-c="headerRow" value="${cfg.headerRow + 1}"></label>
        <label class="check"><input type="checkbox" data-c="twoRow" ${cfg.twoRow ? 'checked' : ''}>หัวตาราง 2 แถว (เช่น ปร.4)</label>
        <label class="check"><input type="checkbox" data-c="groupRows" ${cfg.groupRows ? 'checked' : ''}>แถวที่ไม่มีปริมาณและราคา = ชื่อหมวดงาน</label>
        <label class="check"><input type="checkbox" data-c="skipTotals" ${cfg.skipTotals ? 'checked' : ''}>ข้ามแถว "รวม"</label>
      </div>
      <h3 class="sub-h">จับคู่คอลัมน์</h3>
      <div class="bi-map">${FIELDS.map(([f, label]) => `<label class="field"><span>${label}</span><select data-map="${f}">${opt(f)}</select></label>`).join('')}</div>
      ${cfg.map.price != null && cfg.map.price !== -1 && (cfg.map.mat == null || cfg.map.mat === -1) ? '<p class="hint">ไม่มีคอลัมน์ค่าวัสดุ — ราคารวมต่อหน่วยจะถูกใส่ในช่องค่าวัสดุ และค่าแรงเป็น 0</p>' : ''}
      <h3 class="sub-h">ตัวอย่างผลการนำเข้า <small>${items.length} รายการ <span class="sep"></span> ยอดรวม ${fmt.money(total)} บาท</small></h3>
      <div class="table-wrap bi-prev">
        <table class="boq"><thead><tr><th>หมวดงาน</th><th>ลำดับ</th><th>รายการ</th><th>หน่วย</th><th class="r">ปริมาณ</th><th class="r">ค่าวัสดุ</th><th class="r">ค่าแรง</th></tr></thead>
        <tbody>${items.slice(0, 14).map((i) => `<tr><td>${esc(i.group)}</td><td>${esc(i.no)}</td><td class="c-desc">${esc(i.desc)}</td><td>${esc(i.unit)}</td><td class="r num">${fmt.num(i.qty)}</td><td class="r num">${fmt.money(i.mat)}</td><td class="r num">${fmt.money(i.labor)}</td></tr>`).join('')}
        ${items.length > 14 ? `<tr><td colspan="7" class="muted">… และอีก ${items.length - 14} รายการ</td></tr>` : ''}
        ${!items.length ? '<tr><td colspan="7" class="muted">ไม่พบรายการ — ตรวจสอบแถวหัวตารางและการจับคู่คอลัมน์ "รายการ" กับ "ปริมาณ"</td></tr>' : ''}</tbody></table>
      </div>
      <div class="bi-foot">
        <div class="seg seg-sm">
          <label><input type="radio" name="how" value="replace" ${cfg.how === 'replace' ? 'checked' : ''}>แทนที่ BOQ เดิม</label>
          <label><input type="radio" name="how" value="append" ${cfg.how === 'append' ? 'checked' : ''}>ต่อท้าย BOQ เดิม</label>
        </div>
        <div class="bi-btns"><button class="btn" data-act="back">${icon('chevL')}เลือกไฟล์ใหม่</button>
        <button class="btn btn-primary" data-act="ok" ${items.length ? '' : 'disabled'}>นำเข้า ${items.length} รายการ</button></div>
      </div>`;

    root.querySelector('[data-c="sheet"]')?.addEventListener('change', (e) => { sheetIdx = +e.target.value; prepare(); stepMap(); });
    root.querySelector('[data-c="headerRow"]').addEventListener('change', (e) => {
      cfg.headerRow = Math.max(0, (+e.target.value || 1) - 1);
      cfg.map = guessMap(labels(rows, cfg.headerRow, cfg.twoRow));
      stepMap();
    });
    for (const k of ['twoRow', 'groupRows', 'skipTotals']) {
      root.querySelector(`[data-c="${k}"]`).addEventListener('change', (e) => {
        cfg[k] = e.target.checked;
        if (k === 'twoRow') cfg.map = guessMap(labels(rows, cfg.headerRow, cfg.twoRow));
        stepMap();
      });
    }
    root.querySelectorAll('[data-map]').forEach((s) => s.addEventListener('change', () => { cfg.map[s.dataset.map] = +s.value; stepMap(); }));
    root.querySelectorAll('[name="how"]').forEach((r) => r.addEventListener('change', () => { cfg.how = r.value; }));
    root.querySelector('[data-act="back"]').addEventListener('click', stepSource);
    root.querySelector('[data-act="ok"]').addEventListener('click', () => { m.close(); onDone(items, cfg.how); });
  };

  stepSource();
}
