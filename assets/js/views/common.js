import { esc, fmt, gauge, chip, daysText, icon } from '../ui.js';
import { store, conf, saveConf } from '../store.js';
import { buildDemo } from '../demo.js';

export function projectRow(p, a, { showType = false } = {}) {
  const sub = [p.code, p.contractor].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join('');
  const ps = store.legacy ? null : store.pendingSummary(p.id);
  const role = store.legacy ? null : store.roleOf(p);
  return `<a class="prow" href="#/p/${encodeURIComponent(p.id)}">
    <div class="prow-id">
      <span class="prow-name">${esc(p.name)}</span>
      <span class="prow-sub">${showType && p.type ? `<span class="tag">${esc(p.type)}</span>` : ''}${sub}${role ? roleChip(role) : ''}${ps?.pending ? `<span class="age age-${ps.late ? 'late' : ps.warn ? 'warn' : 'ok'}" title="เรื่องขออนุมัติรอพิจารณา">${icon('send')}รอพิจารณา ${ps.pending}</span>` : ''}</span>
    </div>
    <div class="prow-prog">
      <div class="prow-nums"><b class="num">${fmt.pctNum(a.actual)}<i>%</i></b><span>แผน ${fmt.pct(a.plan)}</span></div>
      ${gauge(a.actual, a.plan)}
    </div>
    <div class="prow-state">${chip(a.status)}<span class="prow-days ${a.overdue ? 'is-bad' : ''}">${esc(daysText(p, a))}</span></div>
  </a>`;
}

export function deltaHTML(diff) {
  const tone = diff <= -0.05 ? 'bad' : diff >= 0.05 ? 'good' : 'flat';
  return `<span class="delta delta-${tone}">${fmt.signed(diff)}%</span>`;
}

export function pageHead(title, sub = '', actions = '') {
  return `<header class="page-head">
    <div class="ph-text"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ''}
  </header>`;
}

// ---------- ผู้ใช้ สิทธิ์ และเรื่องขออนุมัติ (1.0.1) ----------
const R = globalThis.PTRules;

/** ป้ายบทบาท */
export function roleChip(role, extra = '') {
  if (!role) return '';
  const label = R.ROLES[role]?.label || role;
  return `<span class="role role-${esc(role)}">${esc(label)}${extra ? ` <small>${esc(extra)}</small>` : ''}</span>`;
}

/** ชื่อของอีเมลในโครงการ (ถ้าไม่รู้จัก แสดงอีเมล) */
export function personName(p, email) {
  return R.memberName(p, email) || email || '';
}

/** ชื่อพร้อมบทบาท เช่น "สมชาย (ผู้ควบคุมงาน)" */
export function personLabel(p, email) {
  const r = R.roleOf(p, email);
  const n = personName(p, email);
  return r ? `${n} (${R.ROLES[r].label})` : n;
}

/** สถานะเรื่อง */
export function subChip(status) {
  const s = R.SUB_STATUS[status] || { label: status, tone: 'muted' };
  return `<span class="chip chip-${s.tone}">${esc(s.label)}</span>`;
}

/** ป้ายจำนวนวันที่ค้างพิจารณา: เขียว < เหลือง (≥ warn วัน) < แดง (≥ late วัน) */
export function ageBadge(sla) {
  if (!sla || sla.tone === 'done') return '';
  const d = Math.floor(sla.age);
  const text = d < 1 ? 'ได้รับวันนี้' : `ค้าง ${d} วัน`;
  return `<span class="age age-${sla.tone}" title="นับจากวันที่ได้รับเรื่องในขั้นตอนปัจจุบัน">${icon('clock')}${text}</span>`;
}

/** ข้อความกำหนดพิจารณา เช่น "ภายใน 4 พ.ย. 69 (เหลือ 3 วัน)" */
export function dueText(sla) {
  if (!sla || !sla.dueAt) return '';
  const when = R.thaiDateTime(sla.dueAt);
  if (sla.overdue > 0) return `<span class="is-bad">${sla.overdue >= 1 ? `เกินกำหนด ${Math.floor(sla.overdue)} วัน` : 'เกินกำหนดแล้ว'}</span> <small>(ครบ ${esc(when)})</small>`;
  const left = Math.floor(sla.left);
  return `ภายใน ${esc(when)} <small>(${left < 1 ? 'ครบกำหนดวันนี้' : `เหลือ ${left} วัน`})</small>`;
}

/** ข้อความผลการส่งอีเมล สำหรับ toast */
export function mailNote(mail, mode) {
  if (!mail) return '';
  if (mail.error) return ` — แต่ส่งอีเมลไม่สำเร็จ: ${mail.error}`;
  if (mail.disabled || mail.skipped) return '';
  if (!mail.sent) return '';
  return mail.simulated || mode === 'local'
    ? ` — สร้างอีเมลแจ้ง ${mail.sent} คน (โหมดทดลอง ดูได้ที่ ตั้งค่า › กล่องอีเมลจำลอง)`
    : ` — แจ้งทางอีเมลแล้ว ${mail.sent} คน${mail.failed ? ` (ส่งไม่สำเร็จ ${mail.failed})` : ''}`;
}

/** โหลดข้อมูลตัวอย่าง: ให้ผู้ใช้ปัจจุบันเป็นเจ้าของโครงการตัวอย่าง (ถ้ายังไม่มีอีเมลจะใช้อีเมลตัวอย่าง) */
export function loadDemoData() {
  if (!conf.email) { conf.email = 'somchai@egat.co.th'; conf.user = conf.user || 'นายช่างสมชาย'; }
  conf.actAs = '';
  conf.onboarded = true;
  saveConf();
  store.loadDemo(buildDemo(store.settings, { email: conf.email, name: conf.user || conf.email }));
  window.dispatchEvent(new Event('pt:conn'));
}
