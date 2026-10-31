// แท็บเรื่องขออนุมัติ / แจ้งปัญหา: รายการเรื่อง, รายละเอียดและการพิจารณา, ส่งเรื่องใหม่, รายการเอกสารที่ต้องส่ง
import { store } from '../store.js';
import { esc, fmt, icon, emptyState, toast, confirmBox, setBusy, guard, debounce, fileBadge } from '../ui.js';
import { roleChip, personName, personLabel, subChip, ageBadge, dueText, mailNote } from './common.js';
import { preview } from './tab-docs.js';
import { todayISO } from '../calc.js';
import { voteEditorHTML, bindVoteEditor, votePanelHTML, bindVotePanel } from './vote.js';

const R = globalThis.PTRules;
const st = { pid: null, q: '', cat: '', status: 'open', mine: false, reqEdit: null };
const nowIso = () => new Date().toISOString();
window.addEventListener('pt:discard', () => { st.reqEdit = null; });

const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

export function renderSubs(el, ctx, sub = '') {
  const { p } = ctx;
  if (st.pid !== p.id) { st.pid = p.id; st.q = ''; st.cat = ''; st.status = 'open'; st.mine = false; st.reqEdit = null; }
  if (store.legacy) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'send', title: 'ต้องอัปเดตระบบหลังบ้านก่อน', text: 'เรื่องขออนุมัติต้องใช้ Code.gs เวอร์ชัน 1.0.1 — ให้ผู้ดูแลระบบวางโค้ดใหม่ใน Apps Script แล้ว Deploy เวอร์ชันใหม่ (ดูคู่มือใน README)' })}</section>`;
    return;
  }
  if (store.mode === 'sharepoint' && (store.meta.upgrade || []).length) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'database', title: 'ไซต์ SharePoint ยังไม่มีรายการข้อมูลของเวอร์ชัน 1.0.1', text: 'ผู้ดูแลระบบต้องเปิดหน้า ตั้งค่า แล้วกด "อัปเดตโครงสร้างข้อมูลในไซต์" ก่อน (สร้างรายการ PT_Submissions และ PT_Required)', actions: '<a class="btn" href="#/settings">ไปที่ตั้งค่า</a>' })}</section>`;
    return;
  }
  const key = String(sub || '').split('?')[0];
  const nav = subNav(p, key === 'required' ? 'required' : 'list');
  if (key === 'new') { el.innerHTML = '<div id="sv"></div>'; renderNew(el.querySelector('#sv'), ctx); return; }
  el.innerHTML = `${nav}<div id="sv"></div>`;
  const body = el.querySelector('#sv');
  if (key === 'required') renderRequired(body, ctx);
  else if (key) renderDetail(body, ctx, decodeURIComponent(key));
  else renderList(body, ctx);
}

function subNav(p, on) {
  const pid = encodeURIComponent(p.id);
  const subs = store.subsOf(p.id);
  const pending = subs.filter((s) => s.status === 'pending').length;
  const reqs = store.reqsOf(p.id);
  const today = todayISO();
  const overdue = reqs.filter((r) => R.reqStatus(r, p, subs, today).overdueDays > 0).length;
  return `<nav class="subtabs" aria-label="มุมมองเรื่องขออนุมัติ">
    <a href="#/p/${pid}/subs" class="${on === 'list' ? 'is-on' : ''}">${icon('send')}เรื่องขออนุมัติ/แจ้งปัญหา${pending ? `<em>${pending}</em>` : ''}</a>
    <a href="#/p/${pid}/subs/required" class="${on === 'required' ? 'is-on' : ''}">${icon('clipboard')}เอกสารที่ต้องส่งตามสัญญา${reqs.length ? `<em class="${overdue ? 'is-bad' : ''}">${overdue ? `เลยกำหนด ${overdue}` : reqs.length}</em>` : ''}</a>
  </nav>`;
}

// =============================================================
// รายการเรื่อง
// =============================================================
function renderList(el, ctx) {
  const { p } = ctx;
  const pid = encodeURIComponent(p.id);
  const me = store.me;
  const s = store.settings;
  const now = nowIso();
  const sla = R.slaSettings(p, s);
  const all = store.subsOf(p.id).map((sub) => ({ sub, sla: R.subSla(sub, p, s, now), mine: R.currentApprovers(sub, p).includes(me.email) }));
  const canSubmit = store.can(p, 'submit');
  const cats = R.workflows(p).map((c) => c.name);
  for (const x of all) if (!cats.includes(x.sub.category)) cats.push(x.sub.category);
  const pending = all.filter((x) => x.sub.status === 'pending');
  const kpi = {
    pending: pending.length,
    warn: pending.filter((x) => x.sla.tone === 'warn').length,
    late: pending.filter((x) => x.sla.tone === 'late').length,
    approved: all.filter((x) => x.sub.status === 'approved').length,
    rejected: all.filter((x) => x.sub.status === 'rejected').length,
    mine: pending.filter((x) => x.mine).length,
  };
  const newBtn = canSubmit ? `<a class="btn btn-primary" href="#/p/${pid}/subs/new">${icon('plus')}ส่งเรื่องใหม่</a>` : '';

  if (!all.length) {
    el.innerHTML = `<section class="panel">${emptyState({
      ic: 'send', title: 'ยังไม่มีเรื่องขออนุมัติหรือแจ้งปัญหา',
      text: canSubmit
        ? 'ส่งเอกสารขออนุมัติ (วัสดุ แบบ แผนงาน) หรือแจ้งปัญหาให้ผู้ควบคุมงานพิจารณา ระบบจะแจ้งอีเมลผู้เกี่ยวข้องและติดตามระยะเวลาพิจารณาให้'
        : 'เมื่อผู้รับจ้างส่งเรื่องเข้ามา จะแสดงที่นี่พร้อมสถานะและระยะเวลาพิจารณา',
      actions: newBtn,
    })}</section>`;
    return;
  }

  el.innerHTML = `
  <div class="sub-kpis">
    <button class="sk ${st.status === 'open' && !st.mine ? 'is-on' : ''}" data-k="open"><span>รอพิจารณา</span><b class="num">${kpi.pending}</b></button>
    <button class="sk sk-warn ${st.status === 'warn' ? 'is-on' : ''}" data-k="warn"><span>สีเหลือง · ค้าง ${sla.warn} วันขึ้นไป</span><b class="num">${kpi.warn}</b></button>
    <button class="sk sk-late ${st.status === 'late' ? 'is-on' : ''}" data-k="late"><span>สีแดง · ค้าง ${sla.late} วันขึ้นไป</span><b class="num">${kpi.late}</b></button>
    <button class="sk sk-ok ${st.status === 'approved' ? 'is-on' : ''}" data-k="approved"><span>ผ่าน</span><b class="num">${kpi.approved}</b></button>
    <button class="sk sk-bad ${st.status === 'rejected' ? 'is-on' : ''}" data-k="rejected"><span>ไม่ผ่าน</span><b class="num">${kpi.rejected}</b></button>
    ${kpi.mine ? `<button class="sk sk-me ${st.mine ? 'is-on' : ''}" data-k="mine"><span>รอคุณพิจารณา</span><b class="num">${kpi.mine}</b></button>` : ''}
  </div>
  <div class="toolbar">
    <label class="search">${icon('search')}<input type="search" placeholder="ค้นหาเลขที่ ชื่อเรื่อง ผู้ส่ง" value="${esc(st.q)}" id="s-q" aria-label="ค้นหาเรื่อง"></label>
    <select id="s-cat" aria-label="หมวดเรื่อง"><option value="">ทุกหมวด</option>${cats.map((c) => `<option ${st.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select id="s-status" aria-label="สถานะ">
      ${[['open', 'รอพิจารณา'], ['all', 'ทุกสถานะ'], ['approved', 'ผ่าน'], ['rejected', 'ไม่ผ่าน'], ['cancelled', 'ยกเลิก'], ['warn', 'สีเหลือง (ค้าง/เกินกำหนด)'], ['late', `สีแดง (ค้าง ${sla.late} วันขึ้นไป)`]]
    .map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v}</option>`).join('')}
    </select>
    <div class="tb-actions">${newBtn}</div>
  </div>
  <section class="panel panel-flush"><ul class="sublist" id="s-list"></ul></section>
  <p class="hint legend-row"><span><i class="dot dot-ok"></i>ปกติ</span><span><i class="dot dot-warn"></i>ค้าง ${sla.warn} วันขึ้นไป หรือเกินกำหนดพิจารณาของขั้นนั้น</span><span><i class="dot dot-late"></i>ค้าง ${sla.late} วันขึ้นไป</span><span>นับจากวันที่ได้รับเรื่องในขั้นตอนปัจจุบัน</span></p>`;

  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const list = all.filter(({ sub, sla: t, mine }) => {
      if (st.mine && !mine) return false;
      if (st.cat && sub.category !== st.cat) return false;
      if (st.status === 'open' && sub.status !== 'pending') return false;
      if (['approved', 'rejected', 'cancelled'].includes(st.status) && sub.status !== st.status) return false;
      if (st.status === 'warn' && !(sub.status === 'pending' && t.tone === 'warn')) return false;
      if (st.status === 'late' && !(sub.status === 'pending' && t.tone === 'late')) return false;
      if (q && !`${R.subNo(sub)} ${sub.title} ${sub.submittedByName} ${sub.submittedBy} ${sub.category}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a.sub.status === 'pending') !== (b.sub.status === 'pending')
      ? (a.sub.status === 'pending' ? -1 : 1)
      : (a.sub.status === 'pending' ? b.sla.age - a.sla.age : String(b.sub.updatedAt).localeCompare(String(a.sub.updatedAt))));
    el.querySelector('#s-list').innerHTML = list.length
      ? list.map((x) => subRow(p, x)).join('')
      : `<li class="muted pad">ไม่พบเรื่องตามเงื่อนไขนี้${st.status === 'open' ? ' — ไม่มีเรื่องรอพิจารณา' : ''}</li>`;
  };
  draw();
  el.querySelector('#s-q').addEventListener('input', debounce((e) => { st.q = e.target.value; draw(); }, 120));
  el.querySelector('#s-cat').addEventListener('change', (e) => { st.cat = e.target.value; draw(); });
  el.querySelector('#s-status').addEventListener('change', (e) => { st.status = e.target.value; st.mine = false; renderList(el, ctx); });
  el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    if (k === 'mine') { st.mine = !st.mine; st.status = 'open'; } else { st.mine = false; st.status = st.status === k && k !== 'open' ? 'open' : k; }
    renderList(el, ctx);
  }));
}

/** แถวของเรื่องหนึ่งเรื่อง (ใช้ในหน้าโครงการและหน้างานของฉัน) */
export function subRow(p, { sub, sla, mine }, { showProject = false } = {}) {
  const step = sub.steps?.[sub.currentStep || 0];
  const pending = sub.status === 'pending';
  const tone = pending ? sla.tone : 'done';
  const approvers = pending ? R.currentApprovers(sub, p) : [];
  return `<li class="subrow tone-${tone}">
    <a href="#/p/${encodeURIComponent(p.id)}/subs/${encodeURIComponent(sub.id)}">
      <span class="sr-no num">${esc(R.subNo(sub))}${sub.rev > 1 ? `<small>ครั้งที่ ${sub.rev}</small>` : ''}</span>
      <span class="sr-main">
        <b>${esc(sub.title)}</b>
        <span class="sr-meta">${showProject ? `<span class="tag">${esc(p.code || p.name)}</span>` : ''}<span class="f-cat">${esc(sub.category)}</span>
          <span>${esc(sub.submittedByName || personName(p, sub.submittedBy))}</span>
          <span title="วันและเวลาที่ได้รับ">${icon('inbox')}${esc(R.thaiDateTime(sub.submittedAt))}</span>
          ${sub.vote ? `<span class="vote-tag ${sub.vote.status === 'closed' ? 'is-done' : ''}">${icon('users')}${sub.vote.status === 'closed' ? `โหวตแล้ว: ${esc(R.optionLabel(sub.vote, sub.vote.result))}` : `กำลังโหวต ${R.tally(sub, p).total}/${R.tally(sub, p).eligible}`}</span>` : ''}</span>
      </span>
      <span class="sr-step">${pending
        ? `<span>ขั้นที่ ${(sub.currentStep || 0) + 1}/${sub.steps.length} · ${esc(step?.label || '')}</span><small>${dueText(sla)}</small>${approvers.length ? `<small class="muted">ผู้พิจารณา: ${esc(approvers.map((e) => personName(p, e)).join(', '))}</small>` : ''}`
        : `<span>${sub.status === 'approved' ? 'อนุมัติแล้ว' : sub.status === 'rejected' ? 'ตีกลับ' : 'ยกเลิกแล้ว'}</span><small>เมื่อ ${esc(R.thaiDateTime(sub.closedAt || sub.updatedAt))}</small>`}</span>
      <span class="sr-state">${mine ? '<span class="chip chip-me">รอคุณพิจารณา</span>' : ''}${pending ? ageBadge(sla) : ''}${subChip(sub.status)}</span>
    </a>
  </li>`;
}

// =============================================================
// รายละเอียดเรื่อง + พิจารณา
// =============================================================
function fileList(p, ids, { compact = false } = {}) {
  const files = (ids || []).map((id) => store.data.files.find((f) => f.id === id)).filter(Boolean);
  if (!files.length) return compact ? '' : '<p class="muted">ไม่มีไฟล์แนบ</p>';
  return `<ul class="att-list">${files.map((f) => `<li>
    <button type="button" class="att" data-file="${esc(f.id)}">${fileBadge(f)}<span><b>${esc(f.name)}</b><small>${f.size ? fmt.size(f.size) : ''}${f.uploadedBy ? ` · ${esc(f.uploadedBy)}` : ''}</small></span></button></li>`).join('')}</ul>`;
}

const ACT_ICON = { submit: 'send', resubmit: 'refresh', approve: 'check', reject: 'xcircle', comment: 'message', cancel: 'x', openVote: 'users', vote: 'check', closeVote: 'lock' };

function renderDetail(el, ctx, id) {
  const { p } = ctx;
  const pid = encodeURIComponent(p.id);
  const sub = store.sub(id);
  if (!sub || sub.projectId !== p.id) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'search', title: 'ไม่พบเรื่องนี้', text: 'เรื่องอาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึง', actions: `<a class="btn" href="#/p/${pid}/subs">กลับไปรายการเรื่อง</a>` })}</section>`;
    return;
  }
  const me = store.me;
  const s = store.settings;
  const sla = R.subSla(sub, p, s, nowIso());
  const pending = sub.status === 'pending';
  const step = sub.steps[sub.currentStep || 0];
  const approvers = R.currentApprovers(sub, p);
  const canDecide = R.canDecide(sub, p, me);
  const canResubmit = R.canResubmit(sub, p, me);
  const canCancel = R.canCancel(sub, p, me);
  const canComment = R.canComment(sub, p, me);
  const canOpenVote = R.canOpenVote(sub, p, me);
  const isLast = (sub.currentStep || 0) + 1 >= sub.steps.length;
  // ขั้นของคณะกรรมการ/ขั้นสุดท้าย อนุมัติได้หลังผลโหวตได้ข้อยุติ
  const voteBlocks = pending && sub.vote?.status === 'open' && (step?.role === 'committee' || isLast);
  const next = sub.steps[(sub.currentStep || 0) + 1];
  const req = sub.requiredId ? store.reqsOf(p.id).find((r) => r.id === sub.requiredId) : null;
  const notifyPreview = (event, fake) => {
    const rc = R.recipients(p, event, fake, me.email);
    const fmtList = (l) => l.map((e) => esc(personName(p, e))).join(', ');
    return [rc.action.length ? `ต้องดำเนินการ: ${fmtList(rc.action)}` : '', rc.info.length ? `เพื่อทราบ: ${fmtList(rc.info)}` : ''].filter(Boolean).join(' · ');
  };
  // พรีวิวผู้รับอีเมลเมื่อกดผ่าน
  const afterApprove = (() => {
    if (!canDecide) return '';
    try { const r = R.act(sub, p, me, 'approve', {}, nowIso()); return notifyPreview(r.event, r.sub); } catch { return ''; }
  })();

  const stepState = (x, i) => {
    if (x.status === 'approved') return { cls: 'ok', ic: 'check', txt: `ผ่าน — ${esc(x.byName || personName(p, x.by))}`, at: x.at };
    if (x.status === 'rejected') return { cls: 'bad', ic: 'x', txt: `ไม่ผ่าน — ${esc(x.byName || personName(p, x.by))}`, at: x.at };
    if (x.status === 'current' && pending) return { cls: 'cur', ic: 'clock', txt: 'กำลังพิจารณา', at: x.startedAt };
    if (sub.status === 'cancelled' && i === (sub.currentStep || 0)) return { cls: 'muted', ic: 'x', txt: 'ยกเลิก', at: sub.closedAt };
    return { cls: 'wait', ic: 'clock', txt: 'รอขั้นก่อนหน้า', at: '' };
  };

  el.innerHTML = `
  <nav class="crumbs crumbs-in"><a href="#/p/${pid}/subs">${icon('chevL')}เรื่องทั้งหมด</a></nav>
  <div class="sub-detail">
    <div class="sd-main">
      <section class="panel sd-head tone-${pending ? sla.tone : 'done'}">
        <div class="sd-tags"><span class="sd-no num">${esc(R.subNo(sub))}</span>${subChip(sub.status)}${sub.rev > 1 ? `<span class="tag">ส่งครั้งที่ ${sub.rev}</span>` : ''}<span class="f-cat">${esc(sub.category)}</span>${pending ? ageBadge(sla) : ''}</div>
        <h2>${esc(sub.title)}</h2>
        <dl class="sd-facts">
          <div><dt>ผู้ส่ง</dt><dd>${esc(sub.submittedByName || personName(p, sub.submittedBy))}<small>${esc(personLabel(p, sub.submittedBy) !== (sub.submittedByName || '') ? (R.ROLES[R.roleOf(p, sub.submittedBy)]?.label || sub.submittedBy) : sub.submittedBy)}</small></dd></div>
          <div><dt>ได้รับเมื่อ</dt><dd>${esc(R.thaiDateTime(sub.submittedAt))}${sub.rev > 1 ? `<small>ส่งใหม่ล่าสุด ${esc(R.thaiDateTime(sub.history.filter((h) => h.action === 'resubmit').pop()?.at))}</small>` : ''}</dd></div>
          ${pending ? `
          <div><dt>ขั้นตอนปัจจุบัน</dt><dd>ขั้นที่ ${(sub.currentStep || 0) + 1}/${sub.steps.length} ${esc(step.label)}<small>ได้รับในขั้นนี้ ${esc(R.thaiDateTime(sub.stepStartedAt))}</small></dd></div>
          <div><dt>ต้องพิจารณาภายใน</dt><dd>${esc(step.days)} วัน<small>${dueText(sla)}</small></dd></div>
          <div><dt>ผู้พิจารณาขั้นนี้</dt><dd>${approvers.length ? esc(approvers.map((e) => personName(p, e)).join(', ')) : '<span class="is-bad">ยังไม่มี — ให้เจ้าของโครงการแต่งตั้ง</span>'}</dd></div>`
          : `<div><dt>${sub.status === 'cancelled' ? 'ยกเลิกเมื่อ' : 'ปิดเรื่องเมื่อ'}</dt><dd>${esc(R.thaiDateTime(sub.closedAt))}<small>ใช้เวลาทั้งหมด ${fmt.num(sla.totalAge, 1)} วัน</small></dd></div>`}
          ${req ? `<div><dt>ตามรายการเอกสารที่ต้องส่ง</dt><dd><a class="link" href="#/p/${pid}/subs/required">${esc(req.title)}</a><small>${esc(R.reqDueText(req))}</small></dd></div>` : ''}
        </dl>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>ขั้นตอนการพิจารณา</h2></header>
        <ol class="stepper">${sub.steps.map((x, i) => {
          const t = stepState(x, i);
          return `<li class="sp-${t.cls}"><span class="sp-ic">${icon(t.ic)}</span>
            <div><b>ขั้นที่ ${i + 1}: ${esc(x.label)}</b><small>กำหนด ${esc(x.days)} วัน</small>
            <span class="sp-txt">${t.txt}${t.at ? ` · ${esc(R.thaiDateTime(t.at))}` : ''}</span>
            ${x.comment ? `<q>${esc(x.comment)}</q>` : ''}</div></li>`;
        }).join('')}</ol>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>รายละเอียด</h2></header>
        ${sub.detail ? `<div class="sd-text">${esc(sub.detail)}</div>` : '<p class="muted">ไม่มีรายละเอียดเพิ่มเติม</p>'}
        <h3 class="sub-h">ไฟล์แนบ <small>${(sub.files || []).length} ไฟล์</small></h3>
        ${fileList(p, sub.files)}
      </section>

      ${votePanelHTML(sub, p, me)}

      <section class="panel">
        <header class="panel-head"><h2>ประวัติการดำเนินการ</h2></header>
        <ol class="hist-tl">${[...sub.history].reverse().map((h) => `<li class="ht-${h.action}">
          <span class="ht-ic">${icon(ACT_ICON[h.action] || 'message')}</span>
          <div><p><b>${esc(h.byName || personName(p, h.by))}</b> <small>${esc(R.ROLES[R.roleOf(p, h.by)]?.label || '')}</small> ${esc(R.ACTIONS[h.action] || h.action)}${h.rev > 1 && h.action === 'resubmit' ? ` (ครั้งที่ ${h.rev})` : ''}${['approve', 'reject'].includes(h.action) && sub.steps[h.step] ? ` <span class="muted">ขั้น${esc(sub.steps[h.step].label)}</span>` : ''}</p>
            <small class="muted">${esc(R.thaiDateTime(h.at))}</small>
            ${h.comment ? `<div class="ht-comment ${h.action === 'reject' ? 'is-reject' : ''}">${h.action === 'reject' ? '<b>เหตุผลที่ไม่ผ่าน:</b> ' : ''}${esc(h.comment)}</div>` : ''}
            ${h.action === 'submit' ? '' : fileList(p, h.files, { compact: true })}</div></li>`).join('')}</ol>
      </section>
    </div>

    <aside class="sd-side">
      ${canDecide ? `
      <section class="panel act-panel act-decide" id="act-decide">
        <header class="panel-head"><h2>${icon('shield')}พิจารณาเรื่องนี้</h2></header>
        <p class="hint">${isLast ? 'ผ่าน = อนุมัติเรื่องนี้ (ขั้นสุดท้าย)' : `ผ่าน = ส่งต่อให้${esc(next?.label || '')}`} · ไม่ผ่าน = ตีกลับให้ผู้ส่งแก้ไข (ต้องระบุเหตุผล)</p>
        ${voteBlocks ? `<p class="notice notice-warn">${icon('users')}<span>ยังรอผลโหวตเลือกรูปแบบ — อนุมัติขั้นนี้ได้เมื่อกรรมการโหวตครบหรือประธานปิดโหวตแล้ว (ตีกลับได้ตามปกติ)</span></p>` : ''}
        <label class="field"><span>ความเห็น / เหตุผล</span><textarea id="d-comment" rows="4" placeholder="เช่น เห็นควรอนุมัติ / ขาดเอกสาร มอก. ของเหล็กเส้น"></textarea></label>
        ${dropHTML('d')}
        <div class="act-btns">
          <button class="btn btn-ok" data-do="approve" ${voteBlocks ? 'disabled title="รอผลโหวต"' : ''}>${icon('check')}ผ่าน</button>
          <button class="btn btn-reject" data-do="reject">${icon('x')}ไม่ผ่าน</button>
        </div>
        ${afterApprove ? `<p class="hint">${icon('mail')}เมื่อผ่าน ระบบจะแจ้ง ${afterApprove}</p>` : ''}
      </section>` : ''}
      ${canResubmit ? `
      <section class="panel act-panel">
        <header class="panel-head"><h2>${icon('refresh')}แก้ไขและส่งใหม่</h2></header>
        <p class="hint">เรื่องนี้ไม่ผ่าน — แก้ไขตามเหตุผลแล้วส่งใหม่ ระบบจะเริ่มพิจารณาตั้งแต่ขั้นที่ 1</p>
        <label class="field"><span>ชื่อเรื่อง</span><input id="r-title" value="${esc(sub.title)}"></label>
        <label class="field"><span>รายละเอียด</span><textarea id="r-detail" rows="4">${esc(sub.detail)}</textarea></label>
        <label class="field"><span>สิ่งที่แก้ไข</span><textarea id="r-comment" rows="2" placeholder="เช่น แนบใบ มอก. เพิ่มแล้ว"></textarea></label>
        ${dropHTML('r')}
        <div class="act-btns"><button class="btn btn-primary" data-do="resubmit">${icon('send')}ส่งใหม่</button></div>
      </section>` : ''}
      ${canOpenVote ? `
      <section class="panel act-panel">
        <details class="vote-open"><summary>${icon('users')}<b>เปิดให้คณะกรรมการโหวตเลือกรูปแบบ</b><small>ใช้เมื่อแบบไม่ได้กำหนดสี/รูปแบบ</small></summary>
          ${voteEditorHTML('ov', { open: true })}
          <div class="act-btns"><button class="btn btn-primary" data-do="openVote">${icon('users')}เปิดโหวต</button></div>
        </details>
      </section>` : ''}
      ${canComment ? `
      <section class="panel act-panel">
        <header class="panel-head"><h2>${icon('message')}แสดงความเห็น / สอบถาม</h2></header>
        <label class="field"><textarea id="c-comment" rows="3" placeholder="พิมพ์ข้อความ" aria-label="ความเห็น"></textarea></label>
        ${dropHTML('c')}
        <div class="act-btns"><button class="btn" data-do="comment">${icon('send')}ส่งความเห็น</button></div>
      </section>` : ''}
      ${!canDecide && !canResubmit && !canComment && !R.canVote(sub, p, me) ? `<section class="panel"><p class="muted">${icon('eye')} คุณดูเรื่องนี้ได้อย่างเดียว</p></section>` : ''}
      ${R.canVote(sub, p, me) && !R.ballotOf(sub, me.email) ? `<a class="panel act-panel vote-cta" href="#vote">${icon('users')}<span><b>รอคุณโหวตเลือกรูปแบบ</b><small>${esc(sub.vote.question)}</small></span></a>` : ''}
      ${pending && !canDecide ? `<section class="panel"><p class="hint">${icon('mail')}ผู้พิจารณาขั้นนี้ได้รับแจ้งทางอีเมลแล้ว ผลการพิจารณาจะแจ้งให้ผู้เกี่ยวข้องทราบทางอีเมล</p></section>` : ''}
      ${canCancel ? `<button class="btn btn-ghost btn-danger-text" data-do="cancel">${icon('x')}ยกเลิกเรื่องนี้</button>` : ''}
    </aside>
  </div>`;

  el.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', () => {
    const f = store.data.files.find((x) => x.id === b.dataset.file);
    if (f) preview(f);
  }));
  const drops = {};
  for (const k of ['d', 'r', 'c']) if (el.querySelector(`#${k}-drop`)) drops[k] = bindDrop(el, k);
  const ov = canOpenVote ? bindVoteEditor(el, 'ov') : null;

  const run = async (btn, action, opts, files) => {
    setBusy(btn, true, 'กำลังบันทึก…');
    el.querySelectorAll('[data-do]').forEach((b) => { b.disabled = true; });
    try {
      const res = await store.actSubmission(sub.id, action, opts, files, (msg) => { btn.innerHTML = `<span class="spin"></span>${esc(msg)}`; });
      guard.dirty = false;
      const label = {
        approve: res.sub.status === 'approved' ? 'อนุมัติเรื่องแล้ว' : 'ผ่านและส่งต่อขั้นถัดไปแล้ว', reject: 'ตีกลับเรื่องแล้ว', resubmit: 'ส่งเรื่องใหม่แล้ว',
        cancel: 'ยกเลิกเรื่องแล้ว', comment: 'ส่งความเห็นแล้ว', openVote: 'เปิดโหวตแล้ว',
        vote: res.event === 'voteClosed' ? `บันทึกการโหวตแล้ว — ได้ข้อยุติ: ${R.optionLabel(res.sub.vote, res.sub.vote.result)}` : res.event === 'voteTie' ? 'บันทึกการโหวตแล้ว — คะแนนเท่ากัน รอประธานกรรมการชี้ขาด' : 'บันทึกการโหวตแล้ว',
        closeVote: `ปิดโหวตแล้ว — ผล: ${R.optionLabel(res.sub.vote, res.sub.vote?.result)}`,
      }[action];
      toast(`${label}${mailNote(res.mail, store.mode)}`, res.mail?.error ? 'bad' : 'ok', 6000);
      ctx.rerender();
    } catch (e) {
      toast(e.message, 'bad', 7000);
      setBusy(btn, false);
      el.querySelectorAll('[data-do]').forEach((b) => { b.disabled = false; });
    }
  };
  bindVotePanel(el, sub, p, run);
  el.querySelectorAll('[data-do]').forEach((btn) => btn.addEventListener('click', async () => {
    const action = btn.dataset.do;
    if (action === 'openVote') {
      const c = ov.collect([]);
      if (c.error) { toast(c.error, 'bad'); return; }
      if (!(await confirmBox({ title: 'เปิดโหวตเลือกรูปแบบ', message: `ส่งให้คณะกรรมการ ${R.voters(p, sub).length} คนโหวต ${c.vote.options.length} ตัวเลือก — ระบบจะแจ้งอีเมลกรรมการทุกคน`, ok: 'เปิดโหวต' }))) return;
      run(btn, 'openVote', { vote: c.vote }, c.files);
      return;
    }
    if (action === 'approve' || action === 'reject') {
      const comment = el.querySelector('#d-comment').value.trim();
      if (action === 'reject' && !comment) { toast('กรุณาระบุเหตุผลที่ไม่ผ่าน', 'bad'); el.querySelector('#d-comment').focus(); return; }
      if (!(await confirmBox({
        title: action === 'approve' ? (isLast ? 'อนุมัติเรื่องนี้' : 'ผ่านและส่งต่อ') : 'ไม่ผ่าน — ตีกลับเรื่อง',
        message: action === 'approve'
          ? `${esc(R.subNo(sub))} ${esc(sub.title)} — ${isLast ? 'เรื่องจะเปลี่ยนเป็น "ผ่าน"' : `ส่งต่อให้${esc(next.label)}`}`
          : `ตีกลับ ${esc(R.subNo(sub))} ให้ผู้ส่งแก้ไข เหตุผล: "${esc(comment)}"`,
        ok: action === 'approve' ? 'ยืนยันผ่าน' : 'ยืนยันไม่ผ่าน', danger: action === 'reject',
      }))) return;
      run(btn, action, { comment }, drops.d.files);
    } else if (action === 'resubmit') {
      const title = el.querySelector('#r-title').value.trim();
      if (!title) { toast('กรุณาระบุชื่อเรื่อง', 'bad'); return; }
      const comment = el.querySelector('#r-comment').value.trim();
      run(btn, 'resubmit', { comment, changes: { title, detail: el.querySelector('#r-detail').value, comment } }, drops.r.files);
    } else if (action === 'comment') {
      const comment = el.querySelector('#c-comment').value.trim();
      if (!comment && !drops.c.files.length) { toast('กรุณาพิมพ์ความเห็น', 'bad'); return; }
      run(btn, 'comment', { comment }, drops.c.files);
    } else if (action === 'cancel') {
      if (!(await confirmBox({ title: 'ยกเลิกเรื่อง', message: `ยกเลิก ${esc(R.subNo(sub))} ${esc(sub.title)}? ผู้พิจารณาจะได้รับแจ้งทางอีเมล`, ok: 'ยกเลิกเรื่อง', danger: true }))) return;
      run(btn, 'cancel', { comment: '' }, []);
    }
  }));
}

// ---------- ช่องแนบไฟล์ ----------
function dropHTML(k) {
  return `<div class="field"><label class="drop drop-sm" id="${k}-drop">${icon('clip')}<b>แนบไฟล์</b><span>เลือกหรือลากมาวาง</span><input type="file" multiple hidden id="${k}-files"></label><ul class="pick-list" id="${k}-list"></ul></div>`;
}
function bindDrop(el, k) {
  const state = { files: [] };
  const drop = el.querySelector(`#${k}-drop`);
  const list = el.querySelector(`#${k}-list`);
  const draw = () => {
    list.innerHTML = state.files.map((f, i) => `<li>${icon('file')}<span>${esc(f.name)} <small>${fmt.size(f.size)}</small></span><button type="button" class="icon-btn" data-rm="${i}" aria-label="เอาออก">${icon('x')}</button></li>`).join('');
    list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { state.files.splice(+b.dataset.rm, 1); draw(); }));
  };
  const add = (fl) => {
    const max = store.maxUploadBytes();
    for (const f of fl) {
      if (f.size > max) { toast(`ไฟล์ "${f.name}" ใหญ่เกิน ${Math.round(max / 1048576)} MB`, 'bad'); continue; }
      state.files.push(f);
    }
    guard.dirty = true;
    draw();
  };
  el.querySelector(`#${k}-files`).addEventListener('change', (e) => { add(e.target.files); e.target.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); add(e.dataTransfer.files); });
  return state;
}

// =============================================================
// ส่งเรื่องใหม่
// =============================================================
function renderNew(el, ctx) {
  const { p } = ctx;
  const pid = encodeURIComponent(p.id);
  const me = store.me;
  if (!store.can(p, 'submit')) {
    el.innerHTML = `<section class="panel">${emptyState({ ic: 'lock', title: 'คุณไม่มีสิทธิ์ส่งเรื่องในโครงการนี้', text: 'ให้เจ้าของโครงการแต่งตั้งคุณในบทบาทที่ส่งเรื่องได้ เช่น ผู้รับจ้าง', actions: `<a class="btn" href="#/p/${pid}/subs">กลับ</a>` })}</section>`;
    return;
  }
  const q = query();
  const wfs = R.workflows(p);
  const today = todayISO();
  const subs = store.subsOf(p.id);
  const reqs = store.reqsOf(p.id).map((r) => ({ r, s: R.reqStatus(r, p, subs, today) }))
    .filter((x) => x.s.state !== 'approved' && x.s.state !== 'pending');
  const pre = reqs.find((x) => x.r.id === q.get('req'))?.r;
  const preCat = pre?.category && wfs.some((c) => c.name === pre.category) ? pre.category : (q.get('cat') || wfs[0].name);

  el.innerHTML = `
  <nav class="crumbs crumbs-in"><a href="#/p/${pid}/subs">${icon('chevL')}เรื่องทั้งหมด</a></nav>
  <form class="panel sub-form" id="nf" novalidate>
    <header class="panel-head"><h2>${icon('send')}ส่งเรื่องขออนุมัติ / แจ้งปัญหา</h2><span class="muted">ในนาม ${esc(me.name || me.email)}</span></header>
    <div class="form-grid">
      <label class="field"><span>หมวดเรื่อง <em>*</em></span>
        <select name="category">${wfs.map((c) => `<option ${c.name === preCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>ตามรายการเอกสารที่ต้องส่ง</span>
        <select name="requiredId"><option value="">— ไม่อ้างถึง —</option>${reqs.map(({ r, s }) => `<option value="${esc(r.id)}" ${pre?.id === r.id ? 'selected' : ''}>${esc(r.title)}${s.due ? ` (กำหนด ${fmt.date(s.due)})` : ''}</option>`).join('')}</select>
        <small class="hint">เลือกเพื่อให้ระบบบันทึกว่าส่งเอกสารนี้แล้ว และนับว่าส่งตรงเวลาหรือล่าช้า</small></label>
      <div class="field span-2" id="nf-flow"></div>
      <label class="field span-2"><span>ชื่อเรื่อง <em>*</em></span><input name="title" value="${esc(pre?.title || '')}" placeholder="เช่น ขออนุมัติใช้เหล็กเส้น SD40 ยี่ห้อ ..." required maxlength="200"></label>
      <label class="field span-2"><span>รายละเอียด</span><textarea name="detail" rows="5" placeholder="รายละเอียดของเรื่อง เหตุผล ผลกระทบต่องาน หรือสิ่งที่ต้องการให้พิจารณา"></textarea></label>
      <div class="span-2">${dropHTML('n')}</div>
      <div class="field span-2 vote-toggle">
        <label class="check check-block"><input type="checkbox" id="nf-vote"><span>${icon('users')}ให้คณะกรรมการโหวตเลือกรูปแบบ/สี<small>ใช้เมื่อแบบก่อสร้างไม่ได้กำหนดสีหรือรูปแบบไว้ — เสนอตัวเลือกพร้อมรูปตัวอย่าง ให้กรรมการโหวตตัดสิน</small></span></label>
        ${voteEditorHTML('nv')}
      </div>
    </div>
    <p class="hint" id="nf-notify"></p>
    <footer class="upd-foot">
      <a class="btn" href="#/p/${pid}/subs" data-act="cancel">ยกเลิก</a>
      <button class="btn btn-primary" type="submit" data-act="send">${icon('send')}ส่งเรื่อง</button>
    </footer>
  </form>`;

  const form = el.querySelector('#nf');
  const drop = bindDrop(el, 'n');
  const nv = bindVoteEditor(el, 'nv');
  el.querySelector('#nf-vote').addEventListener('change', (e) => nv.show(e.target.checked));
  form.addEventListener('input', () => { guard.dirty = true; });
  const flow = () => {
    const wf = R.workflowFor(p, form.elements.category.value);
    const fake = R.createSubmission(p, { id: 'x', category: wf.name, title: 'x' }, me, nowIso(), []).sub;
    el.querySelector('#nf-flow').innerHTML = `<div class="flow">${fake.steps.map((s, i) => {
      const who = R.approversFor(p, s, me.email).map((e) => personName(p, e));
      return `${i ? `<span class="flow-arrow">${icon('chevR')}</span>` : ''}<span class="flow-step"><b>${i + 1}. ${esc(s.label)}</b><small>ภายใน ${esc(s.days)} วัน${who.length ? ` · ${esc(who.join(', '))}` : ''}</small></span>`;
    }).join('')}</div>`;
    const rc = R.recipients(p, 'submitted', fake, me.email);
    el.querySelector('#nf-notify').innerHTML = `${icon('mail')}เมื่อส่งแล้ว ระบบจะแจ้งอีเมล${rc.action.length ? ` ถึงผู้พิจารณา: <b>${esc(rc.action.map((e) => personName(p, e)).join(', '))}</b>` : ''}${rc.info.length ? ` และแจ้งเพื่อทราบ: ${esc(rc.info.map((e) => personName(p, e)).join(', '))}` : ''} — คุณจะได้รับอีเมลเมื่อมีผลการพิจารณา`;
  };
  form.elements.category.addEventListener('change', flow);
  form.elements.requiredId.addEventListener('change', () => {
    const r = reqs.find((x) => x.r.id === form.elements.requiredId.value)?.r;
    if (!r) return;
    if (!form.elements.title.value.trim()) form.elements.title.value = r.title;
    if (r.category && wfs.some((c) => c.name === r.category)) { form.elements.category.value = r.category; flow(); }
  });
  flow();
  el.querySelector('[data-act="cancel"]').addEventListener('click', () => { guard.dirty = false; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('[data-act="send"]');
    const title = form.elements.title.value.trim();
    if (!title) { toast('กรุณาระบุชื่อเรื่อง', 'bad'); form.elements.title.focus(); return; }
    let files = drop.files;
    let vote = null;
    if (nv.enabled) {
      const c = nv.collect(drop.files);
      if (c.error) { toast(c.error, 'bad'); return; }
      vote = c.vote; files = c.files;
    }
    setBusy(btn, true, 'กำลังส่ง…');
    try {
      const res = await store.createSubmission(p.id, {
        category: form.elements.category.value, title, detail: form.elements.detail.value.trim(), requiredId: form.elements.requiredId.value,
        ...(vote ? { vote } : {}),
      }, files, (msg) => { btn.innerHTML = `<span class="spin"></span>${esc(msg)}`; });
      guard.dirty = false;
      toast(`ส่งเรื่อง ${R.subNo(res.sub)} แล้ว${mailNote(res.mail, store.mode)}`, res.mail?.error ? 'bad' : 'ok', 6000);
      location.hash = `#/p/${pid}/subs/${encodeURIComponent(res.sub.id)}`;
    } catch (ex) { toast(ex.message, 'bad', 7000); setBusy(btn, false); }
  });
}

// =============================================================
// รายการเอกสารที่ต้องส่งตามสัญญา
// =============================================================
function renderRequired(el, ctx) {
  const { p } = ctx;
  const pid = encodeURIComponent(p.id);
  const canManage = store.can(p, 'manageRequired');
  // ปุ่ม "ส่งเอกสารนี้" แสดงให้ผู้รับจ้าง (หรือผู้ที่ส่งเรื่องได้แต่ไม่ได้เป็นผู้พิจารณา)
  const canSubmit = store.can(p, 'submit') && (store.roleOf(p) === 'contractor' || !store.can(p, 'approve'));
  if (st.reqEdit && st.reqEdit.pid === p.id) { renderReqEdit(el, ctx); return; }
  const subs = store.subsOf(p.id);
  const today = todayISO();
  const rows = store.reqsOf(p.id).map((r) => ({ r, s: R.reqStatus(r, p, subs, today) }));
  const k = {
    total: rows.length,
    approved: rows.filter((x) => x.s.state === 'approved').length,
    pending: rows.filter((x) => x.s.state === 'pending').length,
    none: rows.filter((x) => x.s.state === 'none' || x.s.state === 'rejected').length,
    overdue: rows.filter((x) => x.s.overdueDays > 0).length,
    late: rows.filter((x) => x.s.lateDays > 0).length,
  };
  const editBtn = canManage ? `<button class="btn ${rows.length ? '' : 'btn-primary'}" data-act="edit">${icon('edit')}${rows.length ? 'แก้ไขรายการ' : 'กำหนดรายการเอกสาร'}</button>` : '';

  if (!rows.length) {
    el.innerHTML = `<section class="panel">${emptyState({
      ic: 'clipboard', title: 'ยังไม่ได้กำหนดเอกสารที่ผู้รับจ้างต้องส่ง',
      text: 'ใส่รายการเอกสารตามสัญญา พร้อมกำหนดส่ง เช่น "แผนการทำงาน ส่งภายใน 15 วันหลังเริ่มสัญญา" ระบบจะติดตามว่าส่งแล้วหรือยัง ส่งช้ากี่วัน และเตือนทางอีเมล',
      actions: editBtn,
    })}</section>`;
    el.querySelector('[data-act="edit"]')?.addEventListener('click', () => startReqEdit(el, ctx));
    return;
  }

  const stateCell = ({ s }) => {
    if (s.state === 'approved') return '<span class="chip chip-ok">ผ่านแล้ว</span>';
    if (s.state === 'pending') return '<span class="chip chip-warn">รอพิจารณา</span>';
    if (s.state === 'rejected') return '<span class="chip chip-bad">ไม่ผ่าน — ต้องส่งใหม่</span>';
    return `<span class="chip ${s.overdueDays ? 'chip-bad' : 'chip-muted'}">ยังไม่ส่ง</span>`;
  };
  const timing = ({ s }) => {
    if (s.firstAt) {
      return s.lateDays ? `<span class="is-bad">ส่งช้ากว่ากำหนด ${s.lateDays} วัน</span>` : '<span class="is-good">ส่งตรงเวลา</span>';
    }
    if (!s.due) return '<span class="muted">ระบุวันเริ่ม/สิ้นสุดสัญญาก่อน</span>';
    if (s.overdueDays) return `<b class="is-bad">เลยกำหนด ${s.overdueDays} วัน</b>`;
    return s.leftDays === 0 ? '<b class="warn-ink">ครบกำหนดวันนี้</b>' : `<span class="${s.leftDays <= 7 ? 'warn-ink' : 'muted'}">อีก ${s.leftDays} วัน</span>`;
  };

  el.innerHTML = `
  <div class="sub-kpis">
    <div class="sk"><span>ทั้งหมด</span><b class="num">${k.total}</b></div>
    <div class="sk sk-ok"><span>ผ่านแล้ว</span><b class="num">${k.approved}</b></div>
    <div class="sk sk-warn"><span>รอพิจารณา</span><b class="num">${k.pending}</b></div>
    <div class="sk"><span>ยังไม่ส่ง/ต้องส่งใหม่</span><b class="num">${k.none}</b></div>
    <div class="sk sk-late"><span>เลยกำหนดส่ง</span><b class="num">${k.overdue}</b></div>
    <div class="sk sk-bad"><span>ส่งช้ากว่ากำหนด</span><b class="num">${k.late}</b></div>
  </div>
  <div class="toolbar">
    <div class="tb-info">${p.startDate ? `เริ่มสัญญา ${fmt.date(p.startDate)}` : '<span class="is-bad">ยังไม่ได้ระบุวันเริ่มสัญญา</span>'} <span class="sep"></span> สิ้นสุด ${fmt.date(p.endDate)}</div>
    <div class="tb-actions">${editBtn}</div>
  </div>
  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="boq req-table">
        <thead><tr><th class="c-no">#</th><th>เอกสาร</th><th>กำหนดส่ง</th><th>สถานะ</th><th>ส่งเมื่อ</th><th>ตรงเวลา/ล่าช้า</th><th></th></tr></thead>
        <tbody>${rows.map((x, i) => `<tr class="${x.s.overdueDays ? 'row-bad' : ''}">
          <td class="c-no">${i + 1}</td>
          <td class="c-desc"><b>${esc(x.r.title)}</b>${x.r.category ? `<small class="muted">${esc(x.r.category)}</small>` : ''}${x.r.note ? `<small class="muted">${esc(x.r.note)}</small>` : ''}</td>
          <td class="nowrap">${esc(R.reqDueText(x.r))}<small class="muted">${x.s.due ? fmt.date(x.s.due) : '–'}</small></td>
          <td>${stateCell(x)}</td>
          <td class="nowrap">${x.s.firstAt ? esc(R.thaiDateTime(x.s.firstAt)) : '–'}${x.s.sub ? `<small><a class="link" href="#/p/${pid}/subs/${encodeURIComponent(x.s.sub.id)}">${esc(R.subNo(x.s.sub))}</a></small>` : ''}</td>
          <td class="nowrap">${timing(x)}</td>
          <td class="nowrap">${canSubmit && (x.s.state === 'none' || x.s.state === 'rejected')
            ? (x.s.state === 'rejected' && R.canResubmit(x.s.sub, p, store.me)
              ? `<a class="btn btn-sm" href="#/p/${pid}/subs/${encodeURIComponent(x.s.sub.id)}">${icon('refresh')}แก้ไขส่งใหม่</a>`
              : `<a class="btn btn-sm btn-primary" href="#/p/${pid}/subs/new?req=${encodeURIComponent(x.r.id)}">${icon('send')}ส่งเอกสารนี้</a>`)
            : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </section>
  <p class="hint">"ส่งเมื่อ" นับจากการส่งครั้งแรก ถ้าไม่ผ่านแล้วส่งใหม่ยังนับวันที่ส่งครั้งแรก ${store.mode === 'gas' ? '· ระบบส่งอีเมลเตือนผู้รับจ้างก่อนครบกำหนด 7, 3, 1 วัน และเมื่อเลยกำหนด' : ''}</p>`;
  el.querySelector('[data-act="edit"]')?.addEventListener('click', () => startReqEdit(el, ctx));
}

function startReqEdit(el, ctx) {
  const list = store.reqsOf(ctx.p.id).map((r) => ({ ...r }));
  st.reqEdit = { pid: ctx.p.id, list: list.length ? list : [] };
  if (!list.length) st.reqEdit.list = R.REQUIRED_TEMPLATE.map((t) => ({ ...t, id: '', note: '' }));
  guard.dirty = true;
  renderReqEdit(el, ctx);
}

function renderReqEdit(el, ctx) {
  const { p } = ctx;
  const d = st.reqEdit;
  const cats = R.workflows(p).map((c) => c.name);
  el.innerHTML = `
  <div class="toolbar sticky-bar">
    <div class="tb-info">กำหนดเอกสารที่ผู้รับจ้างต้องส่ง <span class="sep"></span> <b>${d.list.length}</b> รายการ</div>
    <div class="tb-actions">
      <button class="btn" data-act="cancel">ยกเลิก</button>
      <button class="btn btn-primary" data-act="save">${icon('check')}บันทึกรายการ</button>
    </div>
  </div>
  <p class="hint">${icon('calendar')}เลือกรูปแบบกำหนดส่ง เช่น "ภายใน 15 วันหลังเริ่มสัญญา" ระบบคำนวณวันครบกำหนดจากวันเริ่ม/สิ้นสุดสัญญาให้ (เริ่ม ${fmt.date(p.startDate)} · สิ้นสุด ${fmt.date(p.endDate)})</p>
  <section class="panel panel-flush">
    <div class="table-wrap">
      <table class="boq req-edit">
        <thead><tr><th>เอกสาร</th><th>หมวดเรื่องเมื่อส่ง</th><th>กำหนดส่ง</th><th></th><th>ครบกำหนด</th><th>หมายเหตุ</th><th></th></tr></thead>
        <tbody id="rq-body"></tbody>
      </table>
    </div>
  </section>
  <div class="row-actions">
    <button class="btn" data-act="add">${icon('plus')}เพิ่มรายการ</button>
    <button class="btn btn-ghost" data-act="tpl">${icon('copy')}เพิ่มจากแม่แบบ</button>
  </div>`;

  const body = el.querySelector('#rq-body');
  const due = (r) => { const x = R.reqDueDate(r, p); return x ? fmt.date(x) : '–'; };
  const draw = () => {
    body.innerHTML = d.list.map((r, i) => `<tr>
      <td><input class="in-desc" data-i="${i}" data-f="title" value="${esc(r.title)}" placeholder="ชื่อเอกสาร" aria-label="ชื่อเอกสาร"></td>
      <td><select data-i="${i}" data-f="category" aria-label="หมวดเรื่อง">${cats.map((c) => `<option ${r.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td><select data-i="${i}" data-f="dueType" aria-label="รูปแบบกำหนดส่ง">${Object.entries(R.DUE_TYPES).map(([k, v]) => `<option value="${k}" ${r.dueType === k ? 'selected' : ''}>${esc(v.replace('{n}', 'N'))}</option>`).join('')}</select></td>
      <td>${r.dueType === 'date'
        ? `<input type="date" data-i="${i}" data-f="dueDate" value="${esc(r.dueDate || '')}" aria-label="วันที่ต้องส่ง">`
        : `<label class="wf-days">N = <input type="number" min="0" data-i="${i}" data-f="dueDays" value="${esc(r.dueDays ?? '')}" aria-label="จำนวนวัน"> วัน</label>`}</td>
      <td class="nowrap" data-due="${i}">${due(r)}</td>
      <td><input data-i="${i}" data-f="note" value="${esc(r.note || '')}" placeholder="–" aria-label="หมายเหตุ"></td>
      <td class="row-tools">
        <button class="icon-btn" data-mv="${i}" data-dir="-1" aria-label="เลื่อนขึ้น">${icon('arrowUp')}</button>
        <button class="icon-btn" data-mv="${i}" data-dir="1" aria-label="เลื่อนลง">${icon('arrowDown')}</button>
        <button class="icon-btn danger" data-del="${i}" aria-label="ลบ">${icon('trash')}</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted pad">ยังไม่มีรายการ — กดเพิ่มรายการ หรือเพิ่มจากแม่แบบ</td></tr>';
  };
  draw();
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.i == null) return;
    const r = d.list[+t.dataset.i];
    r[t.dataset.f] = t.value;
    const cell = body.querySelector(`[data-due="${t.dataset.i}"]`);
    if (cell) cell.textContent = due(r);
  });
  body.addEventListener('change', (e) => { if (e.target.dataset.f === 'dueType') draw(); });
  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    const mv = e.target.closest('[data-mv]');
    if (del) { d.list.splice(+del.dataset.del, 1); draw(); }
    if (mv) {
      const i = +mv.dataset.mv, j = i + +mv.dataset.dir;
      if (j < 0 || j >= d.list.length) return;
      [d.list[i], d.list[j]] = [d.list[j], d.list[i]];
      draw();
    }
  });
  el.querySelector('[data-act="add"]').addEventListener('click', () => {
    d.list.push({ id: '', title: '', category: cats[cats.length - 1], dueType: 'afterStart', dueDays: 15, dueDate: '', note: '' });
    draw();
    body.querySelector(`[data-i="${d.list.length - 1}"][data-f="title"]`)?.focus();
  });
  el.querySelector('[data-act="tpl"]').addEventListener('click', () => {
    const have = new Set(d.list.map((r) => r.title));
    const add = R.REQUIRED_TEMPLATE.filter((t) => !have.has(t.title));
    if (!add.length) { toast('มีรายการจากแม่แบบครบแล้ว', 'info'); return; }
    d.list.push(...add.map((t) => ({ ...t, id: '', note: '' })));
    draw();
    toast(`เพิ่ม ${add.length} รายการจากแม่แบบ`, 'info');
  });
  el.querySelector('[data-act="cancel"]').addEventListener('click', async () => {
    if (!(await confirmBox({ title: 'ยกเลิกการแก้ไข', message: 'การแก้ไขรายการเอกสารที่ยังไม่บันทึกจะหายไป', ok: 'ยกเลิกการแก้ไข', danger: true }))) return;
    st.reqEdit = null; guard.dirty = false; ctx.rerender();
  });
  el.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const list = d.list.filter((r) => String(r.title || '').trim());
    const badDate = list.find((r) => r.dueType === 'date' && !r.dueDate);
    if (badDate) { toast(`"${badDate.title}" ยังไม่ได้ระบุวันที่ต้องส่ง`, 'bad'); return; }
    const used = store.reqsOf(p.id).filter((r) => !list.some((x) => x.id === r.id) && store.subsOf(p.id).some((s) => s.requiredId === r.id));
    if (used.length && !(await confirmBox({ title: 'ลบรายการที่มีการส่งแล้ว', message: `${used.map((r) => esc(r.title)).join(', ')} มีเรื่องที่ส่งอ้างถึงแล้ว เรื่องเดิมยังอยู่แต่จะไม่แสดงในรายการนี้`, ok: 'บันทึกต่อ', danger: true }))) return;
    setBusy(btn, true, 'กำลังบันทึก…');
    try {
      await store.saveRequired(p.id, list);
      st.reqEdit = null; guard.dirty = false;
      toast(`บันทึกรายการเอกสาร ${list.length} รายการแล้ว`);
      ctx.rerender();
    } catch (ex) { toast(ex.message, 'bad', 6000); setBusy(btn, false); }
  });
}
