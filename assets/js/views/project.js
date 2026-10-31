// หน้าโครงการ: ส่วนหัว + แท็บ
import { store } from '../store.js';
import { METHODS } from '../calc.js';
import { esc, fmt, icon, gauge, chip, emptyState, moneyHTML, daysText } from '../ui.js';
import { deltaHTML, roleChip } from './common.js';
import { renderOverview } from './tab-overview.js';
import { renderBoq } from './tab-boq.js';
import { renderUpdates } from './tab-updates.js';
import { renderSubs } from './tab-subs.js';
import { renderDocs } from './tab-docs.js';
import { renderMembers } from './tab-members.js';
import { renderProjectSettings } from './tab-settings.js';

const R = globalThis.PTRules;

const TABS = [
  ['overview', 'ภาพรวม', 'chart'],
  ['boq', 'BOQ และแผนงาน', 'list'],
  ['updates', 'บันทึกความคืบหน้า', 'clipboard'],
  ['subs', 'เรื่องขออนุมัติ', 'send'],
  ['docs', 'เอกสาร', 'folder'],
  ['members', 'สมาชิกและสิทธิ์', 'users'],
  ['settings', 'ตั้งค่าโครงการ', 'sliders'],
];
const RENDER = {
  overview: renderOverview, boq: renderBoq, updates: renderUpdates, subs: renderSubs,
  docs: renderDocs, members: renderMembers, settings: renderProjectSettings,
};

export function renderProject(el, id, tab = 'overview', sub = '') {
  const p = store.project(decodeURIComponent(id));
  if (!p) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'alert', title: 'ไม่พบโครงการนี้', text: store.serverRules ? 'โครงการอาจถูกลบไปแล้ว หรือคุณยังไม่ได้เป็นสมาชิกของโครงการนี้' : 'โครงการอาจถูกลบไปแล้ว', actions: '<a class="btn" href="#/projects">กลับไปหน้ารายการโครงการ</a>' })}</section>`;
    return;
  }
  if (!store.canView(p)) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'lock', title: 'คุณไม่มีสิทธิ์เข้าถึงโครงการนี้', text: `ให้เจ้าของโครงการ${p.ownerName ? ` (${esc(p.ownerName)})` : ''} เพิ่มอีเมล ${esc(store.me.email || '(ยังไม่ได้ระบุอีเมล)')} เป็นสมาชิก`, actions: '<a class="btn" href="#/projects">กลับไปหน้ารายการโครงการ</a>' })}</section>`;
    return;
  }
  const tabs = TABS.filter(([k]) => k !== 'settings' || store.can(p, 'editProject') || store.can(p, 'deleteProject'));
  if (!tabs.some((t) => t[0] === tab)) tab = 'overview';
  const a = store.analysis(p.id);
  const ps = store.pendingSummary(p.id);
  const counts = {
    boq: store.boqOf(p.id).length,
    updates: store.updatesOf(p.id).length,
    docs: store.filesOf(p.id).length,
    subs: ps.pending,
    members: R.members(p).length,
  };
  const tone = { subs: ps.late ? 'is-bad' : ps.warn ? 'is-warn' : '' };
  const pid = encodeURIComponent(p.id);
  const period = p.startDate || p.endDate
    ? `${fmt.date(p.startDate)} – ${fmt.date(p.endDate)}${a.totalDays ? ` <small>(${fmt.num(a.totalDays, 0)} วัน)</small>` : ''}`
    : '–';
  const role = store.roleOf(p);
  const roleBadge = role
    ? roleChip(role, role === 'owner' && R.ownerActsAs(p) !== 'none' ? `ทำหน้าที่${R.OWNER_ACTS[R.ownerActsAs(p)]}` : '')
    : store.me.isAdmin ? '<span class="role role-admin">ผู้ดูแลระบบ</span>' : store.me.isExec ? '<span class="role role-head">ผู้บริหาร</span>' : '';
  const mainBtn = store.can(p, 'recordProgress')
    ? `<a class="btn btn-primary btn-block" href="#/p/${pid}/updates/new">${icon('plus')}บันทึกความคืบหน้า</a>`
    : store.can(p, 'submit') && !store.legacy
      ? `<a class="btn btn-primary btn-block" href="#/p/${pid}/subs/new">${icon('send')}ส่งเรื่องขออนุมัติ / แจ้งปัญหา</a>`
      : '';

  el.innerHTML = `
  <nav class="crumbs" aria-label="ตำแหน่ง"><a href="#/projects">โครงการทั้งหมด</a>${icon('chevR')}<span>${esc(p.code || p.name)}</span></nav>
  <header class="proj-head">
    <div class="ph-main">
      <div class="ph-tags">${p.type ? `<span class="tag">${esc(p.type)}</span>` : ''}${chip(a.status)}${(p.tags || []).map((t) => `<span class="tag tag-ghost">${esc(t)}</span>`).join('')}
        ${roleBadge ? `<a class="ph-role" href="#/p/${pid}/members" title="ดูสิทธิ์ของคุณ">คุณคือ ${roleBadge}</a>` : ''}</div>
      <h1>${esc(p.name)}</h1>
      <dl class="facts">
        <div><dt>ผู้รับจ้าง</dt><dd>${esc(p.contractor || '–')}</dd></div>
        <div><dt>เลขที่สัญญา</dt><dd>${esc(p.contractNo || '–')}</dd></div>
        <div><dt>ระยะเวลาสัญญา</dt><dd>${period}</dd></div>
        <div><dt>มูลค่าสัญญา</dt><dd class="num">${a.value ? moneyHTML(a.value) : '–'}</dd></div>
        <div><dt>ผู้ควบคุมงาน</dt><dd>${esc(p.manager || '–')}</dd></div>
        ${ps.pending ? `<div><dt>เรื่องรอพิจารณา</dt><dd><a class="link" href="#/p/${pid}/subs">${ps.pending} เรื่อง</a>${ps.late ? ` <span class="age age-late">ค้างนาน ${ps.late}</span>` : ps.warn ? ` <span class="age age-warn">ค้าง ${ps.warn}</span>` : ''}</dd></div>` : ''}
      </dl>
    </div>
    <div class="ph-prog">
      <div class="ph-nums">
        <div><span class="lbl">ผลงานสะสม</span><b class="big-num num">${fmt.pctNum(a.actual)}<i>%</i></b></div>
        <div class="ph-plan"><span class="lbl">แผน</span><b class="num">${fmt.pct(a.plan)}</b>${deltaHTML(a.diff)}</div>
      </div>
      ${gauge(a.actual, a.plan, { size: 'md' })}
      <div class="ph-foot">
        <span>${esc(daysText(p, a))}${a.week && a.started && p.status === 'active' ? ` <span class="sep"></span>สัปดาห์ที่ ${a.week}` : ''}</span>
        <span class="muted" title="วิธีคำนวณความคืบหน้า">${esc(METHODS[p.progressMethod || 'boq_value'].label)}</span>
      </div>
      ${mainBtn}
    </div>
  </header>
  <nav class="tabs" role="tablist">
    ${tabs.map(([k, label, ic]) => `<a role="tab" href="#/p/${pid}/${k}" class="${tab === k ? 'is-on' : ''}" aria-selected="${tab === k}">${icon(ic)}<span>${label}</span>${counts[k] ? `<em class="${tone[k] || ''}">${counts[k]}</em>` : ''}</a>`).join('')}
  </nav>
  <div id="tab" class="tab-body"></div>`;

  const body = el.querySelector('#tab');
  const ctx = { p, a, el, rerender: () => renderProject(el, id, tab, sub) };
  RENDER[tab](body, ctx, sub);
}
