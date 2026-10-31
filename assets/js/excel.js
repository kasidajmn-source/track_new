// อ่าน/เขียนไฟล์ Excel และ CSV (โหลด SheetJS เมื่อจำเป็นเท่านั้น)
import { download } from './ui.js';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let loading = null;

export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { loading = null; reject(new Error('โหลดตัวอ่าน Excel ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ต หรือบันทึกไฟล์เป็น CSV แล้วลองใหม่')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** แยกข้อความ CSV หรือ TSV (วางจาก Excel) เป็นตาราง */
export function parseDelimited(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length && firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** อ่านไฟล์เป็น { sheets: [{name, rows}] } */
export async function readTableFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    const text = await file.text();
    return { sheets: [{ name: file.name, rows: parseDelimited(text) }] };
  }
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return {
    sheets: wb.SheetNames.map((n) => ({
      name: n,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: false }),
    })),
  };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * ส่งออก Excel หลายชีต: sheets = [{ name, rows: [[...]], cols: [ความกว้าง] }]
 * ถ้าโหลด SheetJS ไม่ได้ จะส่งออกชีตแรกเป็น CSV แทน
 */
export async function exportWorkbook(filename, sheets) {
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      if (s.cols) ws['!cols'] = s.cols.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(`${filename}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    return 'xlsx';
  } catch {
    const csv = sheets[0].rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    download(`${filename}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
    return 'csv';
  }
}
