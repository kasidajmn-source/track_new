// งานของฉัน: เรื่องที่รอฉันพิจารณา เรื่องที่ฉันส่ง เรื่องที่ต้องแก้ไข และเอกสารที่ใกล้ครบกำหนด (ทุกโครงการ)
import { store } from '../store.js';
import { esc, fmt, icon, emptyState } from '../ui.js';
import { pageHead } from './common.js';
import { subRow } from './tab-subs.js';

const R = globalThis.PTRules;

/** จำนวนงานที่ต้องทำ (แสดงเป็นตัวเลขบนเมนู) */
export function inboxCount() {
  if (store.legacy) return 0;
  const q = store.myQueue();
  return q.decide.length + q.vote.length + q.resubmit.length + q.reqs.filter((x) => x.st.overdueDays > 0 || x.st.leftDays <= 3).length;
}

export function renderInbox(el) {
  const me = store.me;
  if (store.legacy) {
    el.innerHTML = `${pageHead('งานของฉัน')}<section class="panel">${emptyState({ ic: 'inbox', title: 'ต้องอัปเดตระบบหลังบ้านก่อน', text: 'งานของฉันและเรื่องขออนุมัติต้องใช้ Code.gs เวอร์ชัน 1.0.1' })}</section>`;
    return;
  }
  if (!me.email) {
    el.innerHTML = `${pageHead('งานของฉัน')}<section class="panel">${emptyState({ ic: 'user', title: 'ยังไม่ได้ระบุอีเมลของคุณ', text: 'ระบบใช้อีเมลเพื่อรู้ว่าคุณมีบทบาทอะไรในแต่ละโครงการ', actions: '<a class="btn btn-primary" href="#/settings">ตั้งค่าอีเมลของฉัน</a>' })}</section>`;
    return;
  }
  const q = store.myQueue();
  const total = q.decide.length + q.vote.length + q.resubmit.length + q.reqs.length + q.mine.length;
  const section = (title, ic, rows, empty, hint = '') => `
    <section class="panel panel-flush inbox-sec">
      <header class="panel-head pad-x"><h2>${icon(ic)}${title}</h2><span class="count">${rows.length}</span></header>
      ${hint ? `<p class="hint pad-x">${hint}</p>` : ''}
      ${rows.length ? `<ul class="sublist">${rows.map((x) => subRow(x.p, { ...x, mine: R.currentApprovers(x.sub, x.p).includes(me.email) }, { showProject: true })).join('')}</ul>` : `<p class="muted pad">${empty}</p>`}
    </section>`;

  el.innerHTML = `
  ${pageHead('งานของฉัน', `${me.name && me.name !== me.email ? `${esc(me.name)} <span class="sep"></span> ` : ''}${esc(me.email)}`)}
  ${!total ? `<section class="panel">${emptyState({ ic: 'check', title: 'ไม่มีงานค้าง', text: 'เมื่อมีเรื่องรอคุณพิจารณา หรือเอกสารที่คุณต้องส่ง จะแสดงที่นี่ และแจ้งทางอีเมล' })}</section>` : ''}
  ${q.decide.length || total ? section('รอคุณพิจารณา', 'shield', q.decide, 'ไม่มีเรื่องรอคุณพิจารณา', 'เรียงจากเรื่องที่ค้างนานที่สุด — สีเหลือง/แดงคือค้างเกินกำหนดของโครงการ') : ''}
  ${q.vote.length ? section('รอคุณโหวตเลือกรูปแบบ', 'users', q.vote, '', 'คณะกรรมการโหวตเลือกสี/รูปแบบที่แบบไม่ได้กำหนด — เปิดเรื่องแล้วกด "เลือกแบบนี้"') : ''}
  ${q.resubmit.length ? section('ไม่ผ่าน — ต้องแก้ไขและส่งใหม่', 'refresh', q.resubmit, '') : ''}
  ${q.reqs.length ? `<section class="panel panel-flush inbox-sec">
    <header class="panel-head pad-x"><h2>${icon('clipboard')}เอกสารที่ต้องส่งเร็วๆ นี้</h2><span class="count">${q.reqs.length}</span></header>
    <ul class="req-due">${q.reqs.map(({ p, req, st }) => `<li class="${st.overdueDays ? 'is-late' : st.leftDays <= 3 ? 'is-warn' : ''}">
      <a href="#/p/${encodeURIComponent(p.id)}/subs/new?req=${encodeURIComponent(req.id)}">
        <span><b>${esc(req.title)}</b><small><span class="tag">${esc(p.code || p.name)}</span> ${esc(R.reqDueText(req))} · กำหนด ${fmt.date(st.due)}</small></span>
        <span class="rd-when">${st.overdueDays ? `เลยกำหนด ${st.overdueDays} วัน` : st.leftDays === 0 ? 'ครบกำหนดวันนี้' : `อีก ${st.leftDays} วัน`}</span>
        <span class="btn btn-sm btn-primary">${icon('send')}ส่ง</span>
      </a></li>`).join('')}</ul>
  </section>` : ''}
  ${q.mine.length ? section('เรื่องที่คุณส่ง รอผลการพิจารณา', 'send', q.mine, '') : ''}`;
}
