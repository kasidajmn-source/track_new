// โหวตเลือกรูปแบบ/สีวัสดุ — ใช้เมื่อแบบก่อสร้างไม่ได้กำหนดไว้ ให้คณะกรรมการโหวตตัดสิน
// ผลโหวต: เสียงข้างมาก — ถ้าเท่ากัน ประธานกรรมการชี้ขาด (ปิดโหวตก่อนครบได้โดยประธานหรือเจ้าของโครงการ)
import { store } from '../store.js';
import { esc, icon, toast, confirmBox, fmt } from '../ui.js';
import { personName } from './common.js';

const R = globalThis.PTRules;
const MAX_OPTS = 8;

// ---------- ตัวแก้ไขตัวเลือก (ตอนส่งเรื่อง / ตอนเปิดโหวต) ----------
export function voteEditorHTML(k, { open = false } = {}) {
  return `<div class="vote-ed" id="${k}-vote" ${open ? '' : 'hidden'}>
    <label class="field"><span>คำถามให้คณะกรรมการตัดสิน</span><input data-vq placeholder="เช่น เลือกสีกระเบื้องผนังห้องน้ำ (แบบไม่ได้ระบุสี)" maxlength="200"></label>
    <div class="vote-opts" data-vopts></div>
    <button type="button" class="btn btn-sm btn-ghost" data-vadd>${icon('plus')}เพิ่มตัวเลือก</button>
    <p class="hint">${icon('users')}กรรมการทุกคนโหวตได้คนละ 1 เสียง (เปลี่ยนได้จนกว่าจะปิดโหวต) — ได้ข้อยุติเมื่อโหวตครบ: เสียงข้างมากชนะ ถ้าเท่ากันประธานกรรมการชี้ขาด
      · ขั้นพิจารณาของคณะกรรมการจะอนุมัติได้หลังได้ข้อยุติแล้ว</p>
  </div>`;
}

export function bindVoteEditor(root, k) {
  const box = root.querySelector(`#${k}-vote`);
  const st = { options: [{ label: '', detail: '', file: null }, { label: '', detail: '', file: null }] };
  const list = box.querySelector('[data-vopts]');
  const draw = () => {
    list.innerHTML = st.options.map((o, i) => `<div class="vote-opt-ed">
      <span class="vo-no">${String.fromCharCode(65 + i)}</span>
      <input data-vo="${i}|label" value="${esc(o.label)}" placeholder="ชื่อแบบ/สี เช่น เทาอ่อน รหัส 7021" maxlength="120" aria-label="ตัวเลือก ${i + 1}">
      <input data-vo="${i}|detail" value="${esc(o.detail)}" placeholder="รายละเอียด (ยี่ห้อ รุ่น ราคา)" maxlength="500" aria-label="รายละเอียดตัวเลือก ${i + 1}">
      <label class="btn btn-sm vo-pic" title="แนบรูปตัวอย่าง">${icon(o.file ? 'check' : 'clip')}<span>${o.file ? esc(o.file.name.slice(0, 18)) : 'รูปตัวอย่าง'}</span><input type="file" accept="image/*,.pdf" hidden data-vf="${i}"></label>
      ${st.options.length > 2 ? `<button type="button" class="icon-btn" data-vrm="${i}" aria-label="ลบตัวเลือก">${icon('x')}</button>` : '<span></span>'}
    </div>`).join('');
    box.querySelector('[data-vadd]').hidden = st.options.length >= MAX_OPTS;
  };
  list.addEventListener('input', (e) => {
    const [i, f] = (e.target.dataset.vo || '').split('|');
    if (f) st.options[+i][f] = e.target.value;
  });
  list.addEventListener('change', (e) => {
    if (e.target.dataset.vf == null) return;
    const f = e.target.files[0];
    if (f && f.size > store.maxUploadBytes()) { toast(`ไฟล์ "${f.name}" ใหญ่เกินกำหนด`, 'bad'); return; }
    st.options[+e.target.dataset.vf].file = f || null;
    draw();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vrm]');
    if (b) { st.options.splice(+b.dataset.vrm, 1); draw(); }
  });
  box.querySelector('[data-vadd]').addEventListener('click', () => { st.options.push({ label: '', detail: '', file: null }); draw(); });
  draw();
  return {
    get enabled() { return !box.hidden; },
    show(on) { box.hidden = !on; },
    /** คืน { vote, files } — files = baseFiles ต่อด้วยรูปของตัวเลือก (อ้างด้วย fileIdx) ; ข้อมูลไม่ครบคืน error */
    collect(baseFiles = []) {
      const opts = st.options.map((o) => ({ ...o, label: o.label.trim(), detail: o.detail.trim() })).filter((o) => o.label);
      const names = new Set(opts.map((o) => o.label.toLowerCase()));
      if (opts.length < 2) return { error: 'ใส่ตัวเลือกให้คณะกรรมการโหวตอย่างน้อย 2 แบบ' };
      if (names.size !== opts.length) return { error: 'ชื่อตัวเลือกซ้ำกัน' };
      const files = [...baseFiles];
      const options = opts.map((o) => {
        const out = { label: o.label, detail: o.detail };
        if (o.file) { out.fileIdx = files.length; files.push(o.file); }
        return out;
      });
      return { vote: { question: box.querySelector('[data-vq]').value.trim(), options }, files };
    },
  };
}

// ---------- แผงผลโหวต (หน้ารายละเอียดเรื่อง) ----------
export function votePanelHTML(sub, p, me) {
  const v = sub.vote;
  if (!v) return '';
  const t = R.tally(sub, p);
  const mine = R.ballotOf(sub, me.email);
  const canVote = R.canVote(sub, p, me);
  const canClose = R.canCloseVote(sub, p, me);
  const closed = v.status === 'closed';
  const chair = R.voteChair(p, sub);
  const reason = { majority: 'เสียงข้างมาก', chair: 'คะแนนเท่ากัน ประธานกรรมการชี้ขาด', casting: 'คะแนนเท่ากัน ชี้ขาดโดยผู้ปิดโหวต', manual: 'ปิดโหวตก่อนครบ' }[v.closeReason] || '';
  const fileOf = (id) => store.data.files.find((f) => f.id === id);
  const opt = (o, i) => {
    const n = t.counts[o.id] || 0;
    const pct = t.eligible ? (n / t.eligible) * 100 : 0;
    const who = (v.ballots || []).filter((b) => b.option === o.id).map((b) => b.byName || personName(p, b.by));
    const win = closed && v.result === o.id;
    const f = o.fileId ? fileOf(o.fileId) : null;
    return `<li class="vote-opt ${win ? 'is-win' : ''} ${mine?.option === o.id ? 'is-mine' : ''}">
      <span class="vo-no">${String.fromCharCode(65 + i)}</span>
      <div class="vo-body">
        <b>${esc(o.label)}${win ? ` <span class="chip chip-ok">${icon('check')}ผลการตัดสิน</span>` : ''}${mine?.option === o.id ? ' <span class="chip">ที่คุณเลือก</span>' : ''}</b>
        ${o.detail ? `<small>${esc(o.detail)}</small>` : ''}
        ${f ? `<button type="button" class="link vo-file" data-file="${esc(f.id)}">${icon('eye')}ดูตัวอย่าง: ${esc(f.name)}</button>` : ''}
        <div class="vo-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        <small class="muted">${n} เสียง${who.length ? ` — ${esc(who.join(', '))}` : ''}</small>
      </div>
      ${canVote ? `<button type="button" class="btn btn-sm ${mine?.option === o.id ? 'btn-primary' : ''}" data-vote="${esc(o.id)}">${mine?.option === o.id ? 'เลือกแล้ว' : 'เลือกแบบนี้'}</button>` : ''}
    </li>`;
  };
  const missing = t.missing.map((e) => personName(p, e));
  const tie = !closed && t.leaders.length > 1 && t.total > 0;
  return `<section class="panel vote-panel ${closed ? 'is-closed' : ''}" id="vote">
    <header class="panel-head"><h2>${icon('users')}โหวตเลือกรูปแบบ</h2>
      <span class="chip ${closed ? 'chip-ok' : 'chip-warn'}">${closed ? 'ได้ข้อยุติแล้ว' : 'กำลังโหวต'}</span></header>
    <p class="vote-q"><b>${esc(v.question)}</b><small class="muted">เปิดโดย ${esc(v.openedByName || personName(p, v.openedBy))} · ${esc(R.thaiDateTime(v.openedAt))}</small></p>
    <ol class="vote-list">${(v.options || []).map(opt).join('')}</ol>
    <p class="hint">${icon('users')}โหวตแล้ว <b>${t.total}/${t.eligible}</b> คน${!closed && missing.length ? ` · ยังไม่ได้โหวต: ${esc(missing.join(', '))}` : ''}
      ${chair ? ` · ผู้ชี้ขาดเมื่อคะแนนเท่ากัน: ${esc(personName(p, chair))}` : ''}</p>
    ${closed ? `<p class="vote-result">${icon('check')}ผล: <b>${esc(R.optionLabel(v, v.result))}</b> <small>(${esc(reason)} · ${esc(R.thaiDateTime(v.closedAt))}${v.closedByName ? ` โดย ${esc(v.closedByName)}` : ''})</small></p>` : ''}
    ${canVote ? `<label class="field"><span>เหตุผลประกอบ (ถ้ามี)</span><input id="v-comment" maxlength="500" placeholder="เช่น สีเข้ากับอาคารเดิม ดูแลรักษาง่าย"></label>` : ''}
    ${canClose ? `<div class="vote-close">
      ${tie ? `<label class="field field-inline"><span>คะแนนเท่ากัน — ชี้ขาดเป็น</span><select id="v-pick">${t.leaders.map((id) => `<option value="${esc(id)}">${esc(R.optionLabel(v, id))}</option>`).join('')}</select></label>` : ''}
      <button type="button" class="btn btn-sm" data-vclose ${t.total ? '' : 'disabled'}>${icon('lock')}${tie ? 'ชี้ขาดและปิดโหวต' : 'ปิดโหวตตอนนี้'}</button>
      <small class="muted">${t.total ? 'ผลคือแบบที่ได้คะแนนสูงสุด ณ ตอนปิด' : 'ต้องมีผู้โหวตอย่างน้อย 1 คน'}</small></div>` : ''}
  </section>`;
}

/** run(btn, action, opts, files) = ฟังก์ชันบันทึกของหน้ารายละเอียด */
export function bindVotePanel(el, sub, p, run) {
  el.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', () => {
    const option = b.dataset.vote;
    if (R.ballotOf(sub, store.me.email)?.option === option) return;
    run(b, 'vote', { option, comment: el.querySelector('#v-comment')?.value.trim() || '' }, []);
  }));
  el.querySelector('[data-vclose]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const t = R.tally(sub, p);
    const pick = el.querySelector('#v-pick')?.value || (t.leaders.length === 1 ? t.leaders[0] : '');
    const label = R.optionLabel(sub.vote, pick);
    if (!(await confirmBox({
      title: 'ปิดโหวต', ok: 'ยืนยันปิดโหวต',
      message: `ผลการตัดสิน: "${esc(label)}" (${fmt.num(t.counts[pick] || 0)} เสียง จากผู้โหวต ${t.total}/${t.eligible} คน) — ปิดแล้วเปลี่ยนไม่ได้`,
    }))) return;
    run(btn, 'closeVote', { option: pick }, []);
  });
}
