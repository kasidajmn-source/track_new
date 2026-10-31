/*
 * กฎกลางของระบบ: บทบาท สิทธิ์ ขั้นตอนอนุมัติ การแจ้งเตือน และรูปแบบอีเมล
 * ไฟล์นี้ใช้ร่วมกัน 2 ที่ (แก้ที่เดียวแล้วคัดลอกให้ตรงกัน):
 *   1) หน้าเว็บ  — โหลดผ่าน <script src="assets/js/rules.js"> ใช้งานผ่าน globalThis.PTRules
 *   2) Apps Script — ส่วนท้ายของ backend/Code.gs (ระหว่างบรรทัด RULES BEGIN / RULES END)
 * เขียนแบบ JavaScript ทั่วไป (ไม่ใช้ import/export) เพื่อให้รันได้ทั้งสองที่
 */
(function (root) {
  'use strict';

  var DAY = 864e5;

  var ROLES = {
    owner: { label: 'เจ้าของโครงการ', desc: 'ผู้สร้างโครงการ ทำได้ทุกอย่าง และเป็นผู้เดียวที่แต่งตั้งหรือถอดถอนสมาชิกได้' },
    supervisor: { label: 'ผู้ควบคุมงาน', desc: 'ตรวจสอบและอนุมัติเอกสารของผู้รับจ้าง บันทึกความคืบหน้า ดูแล BOQ และแผนงาน' },
    committee: { label: 'คณะกรรมการตรวจรับ', desc: 'พิจารณาเรื่องที่ต้องผ่านคณะกรรมการ เช่น การส่งมอบงานงวด' },
    contractor: { label: 'ผู้รับจ้าง', desc: 'ส่งเอกสารขออนุมัติ แจ้งปัญหา และติดตามผลการพิจารณา' },
    head: { label: 'หัวหน้า/ผู้บริหาร', desc: 'ดูข้อมูลได้อย่างเดียว รับอีเมลเมื่อมีผลการพิจารณาหรือมีการอัปเดตความคืบหน้า' },
    viewer: { label: 'ผู้ติดตาม', desc: 'ดูข้อมูลได้อย่างเดียว' },
  };
  var MEMBER_ROLES = ['supervisor', 'committee', 'contractor', 'head', 'viewer'];
  // ลำดับในคณะกรรมการ: 1..n = กรรมการลำดับที่ n, 0 = ประธานกรรมการ (พิจารณาเป็นคนสุดท้าย)
  var MAX_SEAT = 9;
  function seatLabel(seat) {
    if (seat == null || seat === '') return '';
    return +seat === 0 ? 'ประธานกรรมการ' : 'กรรมการลำดับที่ ' + (+seat);
  }
  function seatStepLabel(seat) { var l = seatLabel(seat); return /\d$/.test(l) ? l + ' พิจารณา' : l + 'พิจารณา'; }
  /** ลำดับการพิจารณา: กรรมการลำดับ 1, 2, 3 … แล้วจึงประธานกรรมการ */
  function seatOrder(seat) { return +seat === 0 ? 1000 : +seat; }
  // วิธีพิจารณาในแต่ละขั้น
  var STEP_MODES = {
    any: 'คนใดคนหนึ่งในบทบาทนี้พิจารณาได้',
    seq: 'ทุกคนพิจารณาเรียงตามลำดับ (กรรมการลำดับ 1 → 2 → 3 … → ประธานกรรมการ)',
  };
  // เจ้าของโครงการทำหน้าที่ใดในงาน (ใช้หาผู้พิจารณาแต่ละขั้น)
  var OWNER_ACTS = { supervisor: 'ผู้ควบคุมงาน', committee: 'คณะกรรมการตรวจรับ', head: 'หัวหน้า/ผู้บริหาร', none: 'ไม่ร่วมพิจารณา (พิจารณาแทนได้เมื่อจำเป็น)' };

  var PERMS = {
    editProject: 'แก้ไขข้อมูลและตั้งค่าโครงการ',
    editBoq: 'แก้ไข BOQ และแผนงาน',
    recordProgress: 'บันทึกความคืบหน้า',
    uploadDocs: 'อัปโหลด/จัดการคลังเอกสาร',
    submit: 'ส่งเรื่องขออนุมัติ/แจ้งปัญหา',
    approve: 'พิจารณาอนุมัติ/ตีกลับ',
    manageRequired: 'กำหนดรายการเอกสารที่ต้องส่ง',
  };
  var PERM_KEYS = Object.keys(PERMS);

  var DEFAULT_ROLE_PERMS = {
    supervisor: ['editProject', 'editBoq', 'recordProgress', 'uploadDocs', 'submit', 'approve', 'manageRequired'],
    committee: ['submit', 'approve'],
    contractor: ['submit'],
    head: [],
    viewer: [],
  };

  var NOTIFY = {
    all: 'ทุกเรื่องในโครงการ',
    decisions: 'เฉพาะผลการพิจารณาและการอัปเดตความคืบหน้า',
    mine: 'เฉพาะเรื่องที่ตนส่งหรือต้องพิจารณา',
    none: 'ไม่รับอีเมลแจ้งเพื่อทราบ',
  };
  var DEFAULT_NOTIFY = { owner: 'all', supervisor: 'all', committee: 'mine', contractor: 'mine', head: 'decisions', viewer: 'none' };

  // หมวดเรื่องขออนุมัติ และขั้นตอนพิจารณาเริ่มต้น (ปรับได้ในแต่ละโครงการ)
  var DEFAULT_WORKFLOWS = [
    { name: 'ขออนุมัติวัสดุ/อุปกรณ์', steps: [{ role: 'supervisor', days: 7, mode: 'any' }, { role: 'committee', days: 3, mode: 'seq' }] },
    { name: 'ขออนุมัติแบบ (Shop Drawing)', steps: [{ role: 'supervisor', days: 7, mode: 'any' }, { role: 'committee', days: 3, mode: 'seq' }] },
    { name: 'ขออนุมัติแผนงาน/วิธีการทำงาน', steps: [{ role: 'supervisor', days: 7, mode: 'any' }, { role: 'committee', days: 3, mode: 'seq' }] },
    { name: 'แจ้งปัญหา/อุปสรรค', steps: [{ role: 'supervisor', days: 3, mode: 'any' }] },
    { name: 'ขอขยายเวลา/เปลี่ยนแปลงงาน', steps: [{ role: 'supervisor', days: 7, mode: 'any' }, { role: 'committee', days: 5, mode: 'seq' }] },
    { name: 'ส่งมอบงาน/ขอตรวจรับงวดงาน', steps: [{ role: 'supervisor', days: 3, mode: 'any' }, { role: 'committee', days: 2, mode: 'seq' }] },
    { name: 'อื่นๆ', steps: [{ role: 'supervisor', days: 7, mode: 'any' }] },
  ];

  // รายการเอกสารที่ผู้รับจ้างต้องส่งตามสัญญา (แม่แบบ ปรับแก้ได้)
  var REQUIRED_TEMPLATE = [
    { title: 'แผนการทำงาน (Work Schedule)', category: 'ขออนุมัติแผนงาน/วิธีการทำงาน', dueType: 'afterStart', dueDays: 15 },
    { title: 'รายชื่อวิศวกรและผู้ควบคุมงานของผู้รับจ้าง พร้อมใบอนุญาต', category: 'อื่นๆ', dueType: 'afterStart', dueDays: 7 },
    { title: 'แผนความปลอดภัยในการทำงาน (Safety Plan)', category: 'ขออนุมัติแผนงาน/วิธีการทำงาน', dueType: 'afterStart', dueDays: 15 },
    { title: 'แบบขยายรายละเอียด (Shop Drawing)', category: 'ขออนุมัติแบบ (Shop Drawing)', dueType: 'afterStart', dueDays: 30 },
    { title: 'รายการวัสดุและผลิตภัณฑ์ที่ใช้ (Material Submittal)', category: 'ขออนุมัติวัสดุ/อุปกรณ์', dueType: 'afterStart', dueDays: 30 },
    { title: 'แบบก่อสร้างจริง (As-built Drawing)', category: 'ส่งมอบงาน/ขอตรวจรับงวดงาน', dueType: 'afterEnd', dueDays: 30 },
  ];

  var DUE_TYPES = {
    afterStart: 'ภายใน {n} วันหลังเริ่มสัญญา',
    beforeEnd: 'ก่อนสิ้นสุดสัญญา {n} วัน',
    afterEnd: 'ภายใน {n} วันหลังสิ้นสุดสัญญา',
    date: 'ภายในวันที่กำหนด',
  };

  var SUB_STATUS = {
    pending: { label: 'รอพิจารณา', tone: 'warn' },
    approved: { label: 'ผ่าน', tone: 'ok' },
    rejected: { label: 'ไม่ผ่าน', tone: 'bad' },
    cancelled: { label: 'ยกเลิก', tone: 'muted' },
  };

  var ACTIONS = {
    submit: 'ส่งเรื่อง',
    resubmit: 'แก้ไขและส่งใหม่',
    approve: 'ผ่าน',
    reject: 'ไม่ผ่าน',
    comment: 'แสดงความเห็น',
    cancel: 'ยกเลิกเรื่อง',
    openVote: 'เปิดโหวต',
    vote: 'โหวต',
    closeVote: 'ปิดโหวต',
  };

  // ---------- ตัวช่วยทั่วไป ----------
  function norm(e) { return String(e || '').trim().toLowerCase(); }
  function uniq(arr) {
    var seen = {}, out = [];
    for (var i = 0; i < arr.length; i++) { var v = norm(arr[i]); if (v && !seen[v]) { seen[v] = 1; out.push(v); } }
    return out;
  }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }
  /** รายการอีเมลหรือโดเมน (เช่น @egat.co.th) */
  function listHas(list, email) {
    var e = norm(email);
    if (!e) return false;
    var items = Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/);
    for (var i = 0; i < items.length; i++) {
      var x = norm(items[i]);
      if (!x) continue;
      if (x.charAt(0) === '@' ? e.slice(-x.length) === x : e === x) return true;
    }
    return false;
  }
  function parseList(v) {
    return (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(norm).filter(Boolean);
  }
  function pad3(n) { var s = String(n); while (s.length < 3) s = '0' + s; return s; }
  function subNo(sub) { return '#' + pad3(sub.no || 0); }
  function toDate(iso) {
    if (!iso) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  }
  function isoDate(d) {
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function addDaysIso(iso, n) { var d = toDate(iso); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  /** ข้อผิดพลาดพร้อมรหัส: forbidden = ไม่มีสิทธิ์, invalid = ข้อมูลไม่ถูกต้อง */
  function fail(msg, code) { var e = new Error(msg); e.code = code; return e; }

  // ---------- สมาชิกและสิทธิ์ ----------
  function seatValue(v) {
    if (v === '' || v == null || !isFinite(+v)) return null;
    var n = Math.round(+v);
    return n >= 0 && n <= MAX_SEAT ? n : null;
  }
  /**
   * สมาชิกทั้งหมดรวมเจ้าของ: [{email, name, role, notify, seat}]
   * seat ใช้กับคณะกรรมการ (และเจ้าของที่ทำหน้าที่กรรมการ) — ผู้ที่ยังไม่ได้กำหนดลำดับ จะได้ลำดับว่างถัดไปตามลำดับในรายชื่อ
   */
  function members(p) {
    var out = [];
    if (p && p.ownerEmail) out.push({ email: norm(p.ownerEmail), name: p.ownerName || '', role: 'owner', notify: p.ownerNotify || 'all', seat: null });
    var ms = (p && p.members) || [];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (!m || !m.email || norm(m.email) === norm(p.ownerEmail)) continue;
      out.push({ email: norm(m.email), name: m.name || '', role: m.role || 'viewer', notify: m.notify || DEFAULT_NOTIFY[m.role] || 'mine', seat: m.role === 'committee' ? seatValue(m.seat) : null });
    }
    // ลำดับกรรมการ
    var ownerCommittee = p && OWNER_ACTS[p.ownerRole] && p.ownerRole === 'committee';
    var taken = {}, j, x;
    for (j = 0; j < out.length; j++) {
      x = out[j];
      if (x.role === 'owner') { if (ownerCommittee) x.seat = seatValue(p.ownerSeat); else continue; }
      if (x.role !== 'committee' && x.role !== 'owner') continue;
      if (x.seat != null) { if (taken[x.seat]) x.seat = null; else taken[x.seat] = 1; }
    }
    for (j = 0; j < out.length; j++) {
      x = out[j];
      var inCommittee = x.role === 'committee' || (x.role === 'owner' && ownerCommittee);
      if (!inCommittee || x.seat != null) continue;
      var s = 0;
      while (taken[s]) s++;
      x.seat = s; taken[s] = 1;
    }
    return out;
  }
  /** คณะกรรมการเรียงตามลำดับพิจารณา (กรรมการลำดับ 1, 2, 3 … ประธานกรรมการเป็นคนสุดท้าย) — เฉพาะผู้มีสิทธิ์พิจารณา ไม่นับ excludeEmail */
  function committeeSeats(p, excludeEmail) {
    var ex = norm(excludeEmail);
    return members(p).filter(function (m) {
      if (m.seat == null || m.email === ex) return false;
      return m.role === 'owner' || permsOf(p, m.role).indexOf('approve') >= 0;
    }).sort(function (a, b) { return seatOrder(a.seat) - seatOrder(b.seat); });
  }
  function seatOf(p, email) {
    var e = norm(email), all = members(p);
    for (var i = 0; i < all.length; i++) if (all[i].email === e) return all[i].seat;
    return null;
  }
  function roleOf(p, email) {
    var e = norm(email);
    if (!p || !e) return null;
    if (norm(p.ownerEmail) === e) return 'owner';
    var ms = p.members || [];
    for (var i = 0; i < ms.length; i++) if (norm(ms[i].email) === e) return ms[i].role || 'viewer';
    return null;
  }
  function memberName(p, email) {
    var e = norm(email);
    var all = members(p);
    for (var i = 0; i < all.length; i++) if (all[i].email === e) return all[i].name || e;
    return e;
  }
  function permsOf(p, role) {
    if (role === 'owner') return PERM_KEYS.slice();
    var custom = p && p.rolePerms && p.rolePerms[role];
    return Array.isArray(custom) ? custom.slice() : (DEFAULT_ROLE_PERMS[role] || []).slice();
  }
  /** เจ้าของโครงการ — โครงการเก่าที่ยังไม่มีเจ้าของ ให้ผู้ดูแลระบบทำหน้าที่แทน */
  function isOwner(p, user) {
    if (!p || !user) return false;
    if (!p.ownerEmail) return !!user.isAdmin;
    return norm(p.ownerEmail) === norm(user.email);
  }
  function canView(p, user) {
    if (!p || !user) return false;
    return !!(user.isAdmin || user.isExec || roleOf(p, user.email) || isOwner(p, user));
  }
  /** user = { email, isAdmin, isExec } ; perm = คีย์ใน PERMS หรือ 'view' | 'manageMembers' | 'deleteProject' */
  function can(p, user, perm) {
    if (!p || !user) return false;
    if (perm === 'manageMembers') return isOwner(p, user);
    if (perm === 'deleteProject' || perm === 'transferOwner') return isOwner(p, user) || !!user.isAdmin;
    if (perm === 'view') return canView(p, user);
    if (isOwner(p, user)) return true;
    var role = roleOf(p, user.email);
    if (!role) return !!user.isAdmin && perm !== 'submit' && perm !== 'approve';
    if (permsOf(p, role).indexOf(perm) >= 0) return true;
    return !!user.isAdmin && perm !== 'submit' && perm !== 'approve';
  }
  function canCreateProject(settings, user) {
    if (!user || !user.email) return false;
    if (user.isAdmin) return true;
    var list = parseList(settings && settings.projectCreators);
    return !list.length || listHas(list, user.email);
  }

  // ---------- ขั้นตอนอนุมัติ ----------
  function workflows(p) {
    return (p && Array.isArray(p.workflow) && p.workflow.length) ? p.workflow : DEFAULT_WORKFLOWS;
  }
  function workflowFor(p, category) {
    var wfs = workflows(p);
    for (var i = 0; i < wfs.length; i++) if (wfs[i].name === category) return wfs[i];
    return wfs[wfs.length - 1] || DEFAULT_WORKFLOWS[DEFAULT_WORKFLOWS.length - 1];
  }
  function stepMode(step) {
    if (!step) return 'any';
    if (step.mode === 'any' || step.mode === 'seq') return step.role === 'committee' ? step.mode : 'any';
    return step.role === 'committee' ? 'seq' : 'any';
  }
  function stepLabel(step) {
    if (!step) return '';
    if (step.label) return step.label;
    if (step.seat != null && step.seat !== '') return seatStepLabel(step.seat);
    return ((ROLES[step.role] || {}).label || step.role) + 'พิจารณา';
  }
  /** บทบาทในงานของเจ้าของโครงการ (ค่าเริ่มต้น: ผู้ควบคุมงาน) — ใช้หาผู้พิจารณา */
  function ownerActsAs(p) { return (p && OWNER_ACTS[p.ownerRole]) ? p.ownerRole : 'supervisor'; }
  /** ผู้มีสิทธิ์พิจารณาขั้นนี้: สมาชิกบทบาทนั้นที่มีสิทธิ์ approve (ไม่นับผู้ส่ง) — ถ้าไม่มี ให้เจ้าของโครงการ */
  function approversFor(p, step, submitterEmail) {
    if (!step) return [];
    var sub = norm(submitterEmail);
    var list = [];
    var all = members(p);
    var acts = ownerActsAs(p);
    if (step.seat != null && step.seat !== '') {
      // ขั้นที่ผูกกับลำดับกรรมการ: เฉพาะผู้ที่อยู่ในลำดับนั้น — ไม่มีผู้ใดอยู่ในลำดับนั้นแล้ว ให้เจ้าของโครงการพิจารณาแทน
      var seated = committeeSeats(p, sub).filter(function (m) { return m.seat === +step.seat; }).map(function (m) { return m.email; });
      if (seated.length) return seated;
      return p.ownerEmail && norm(p.ownerEmail) !== sub ? [norm(p.ownerEmail)] : [];
    }
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      if (m.role === 'owner') { if (step.role === 'owner' || acts === step.role) list.push(m.email); continue; }
      if (m.role !== step.role) continue;
      if (permsOf(p, m.role).indexOf('approve') < 0) continue;
      list.push(m.email);
    }
    var others = list.filter(function (e) { return e !== sub; });
    if (others.length) return others;
    if (p.ownerEmail && norm(p.ownerEmail) !== sub) return [norm(p.ownerEmail)];
    return list.length ? list : (p.ownerEmail ? [norm(p.ownerEmail)] : []);
  }
  function currentApprovers(sub, p) {
    if (!sub || sub.status !== 'pending') return [];
    var step = (sub.steps || [])[sub.currentStep || 0];
    return approversFor(p, step, sub.submittedBy);
  }
  function currentStep(sub) { return sub ? (sub.steps || [])[sub.currentStep || 0] || null : null; }
  function canDecide(sub, p, user) {
    if (!sub || sub.status !== 'pending' || !user) return false;
    if (currentApprovers(sub, p).indexOf(norm(user.email)) >= 0) return true;
    // ขั้นของกรรมการแต่ละลำดับ: เฉพาะกรรมการในลำดับนั้นเท่านั้น (เจ้าของพิจารณาแทนไม่ได้ เว้นแต่ไม่มีผู้ใดอยู่ในลำดับนั้น)
    var step = currentStep(sub);
    if (step && step.seat != null && step.seat !== '') return false;
    return isOwner(p, user) && norm(user.email) !== norm(sub.submittedBy);
  }
  function canComment(sub, p, user) {
    if (!sub || !canView(p, user)) return false;
    var r = roleOf(p, user.email);
    return norm(user.email) === norm(sub.submittedBy) || isOwner(p, user) ||
      (r && (permsOf(p, r).indexOf('submit') >= 0 || permsOf(p, r).indexOf('approve') >= 0));
  }
  function canResubmit(sub, p, user) {
    return !!sub && sub.status === 'rejected' && !!user && norm(user.email) === norm(sub.submittedBy) && can(p, user, 'submit');
  }
  function canCancel(sub, p, user) {
    return !!sub && sub.status === 'pending' && !!user && (norm(user.email) === norm(sub.submittedBy) || isOwner(p, user));
  }

  /** คัดลอกขั้นตอนพิจารณาไว้ในเรื่อง — ขั้นคณะกรรมการแบบเรียงลำดับ แตกเป็นขั้นละ 1 คนตามลำดับกรรมการ */
  function snapshotSteps(p, category, submitterEmail) {
    var wf = workflowFor(p, category);
    var out = [];
    (wf.steps || []).forEach(function (s) {
      var base = { role: s.role, days: +s.days || 7, status: 'waiting', by: '', byName: '', at: '', comment: '' };
      if (s.role === 'committee' && stepMode(s) === 'seq') {
        var seats = committeeSeats(p, submitterEmail);
        if (seats.length) {
          seats.forEach(function (m) {
            out.push(Object.assign({}, base, { seat: m.seat, label: seatStepLabel(m.seat), mode: 'seq' }));
          });
          return;
        }
      }
      out.push(Object.assign({}, base, { label: stepLabel(s), mode: stepMode(s) }));
    });
    return out;
  }

  function hist(actor, action, extra) {
    return Object.assign({ at: extra.at, by: norm(actor.email), byName: actor.name || '', action: action }, extra);
  }

  function nextNo(subs, pid) {
    var max = 0;
    for (var i = 0; i < (subs || []).length; i++) if (subs[i].projectId === pid && +subs[i].no > max) max = +subs[i].no;
    return max + 1;
  }

  /** สร้างเรื่องใหม่ — input: { id, category, title, detail, requiredId, files } */
  function createSubmission(p, input, actor, nowIso, existing) {
    if (!can(p, actor, 'submit')) throw fail('คุณไม่มีสิทธิ์ส่งเรื่องในโครงการนี้', 'forbidden');
    var title = String(input.title || '').trim();
    if (!title) throw fail('กรุณาระบุชื่อเรื่อง', 'invalid');
    var steps = snapshotSteps(p, input.category, actor.email);
    if (!steps.length) throw fail('หมวดเรื่องนี้ยังไม่มีขั้นตอนพิจารณา', 'invalid');
    var files0 = (input.files || []).slice();
    var vote = input.vote ? cleanVote(input.vote, files0, actor, nowIso) : null;
    steps[0].status = 'current';
    steps[0].startedAt = nowIso;
    var sub = {
      id: input.id, projectId: p.id, no: nextNo(existing, p.id), rev: 1,
      category: workflowFor(p, input.category).name, title: title, detail: String(input.detail || ''),
      requiredId: input.requiredId || '', files: (input.files || []).slice(),
      submittedBy: norm(actor.email), submittedByName: actor.name || '', submittedAt: nowIso,
      status: 'pending', currentStep: 0, stepStartedAt: nowIso, steps: steps, updatedAt: nowIso,
      history: [],
    };
    if (vote) sub.vote = vote;
    sub.history.push(hist(actor, 'submit', { at: nowIso, step: 0, comment: '', files: sub.files.slice(), rev: 1 }));
    return { sub: sub, event: 'submitted' };
  }

  /** พิจารณา: decision = 'approve' | 'reject' */
  function decide(subIn, p, actor, decision, comment, nowIso, files) {
    var sub = clone(subIn);
    if (!canDecide(sub, p, actor)) throw fail('เรื่องนี้ไม่ได้รอการพิจารณาจากคุณ', 'forbidden');
    comment = String(comment || '').trim();
    if (decision === 'reject' && !comment) throw fail('กรุณาระบุเหตุผลที่ไม่ผ่าน', 'invalid');
    if (decision !== 'approve' && decision !== 'reject') throw fail('ผลการพิจารณาไม่ถูกต้อง', 'invalid');
    var i = sub.currentStep || 0;
    var step = sub.steps[i];
    if (decision === 'approve' && sub.vote && sub.vote.status === 'open' && (step.role === 'committee' || i === sub.steps.length - 1)) {
      throw fail('ยังมีการโหวตเลือกรูปแบบที่ยังไม่ได้ข้อยุติ — ต้องโหวตให้ครบหรือปิดโหวตก่อนจึงจะอนุมัติขั้นนี้ได้', 'invalid');
    }
    step.status = decision === 'approve' ? 'approved' : 'rejected';
    step.by = norm(actor.email); step.byName = actor.name || ''; step.at = nowIso; step.comment = comment;
    sub.history.push(hist(actor, decision, { at: nowIso, step: i, comment: comment, files: (files || []).slice() }));
    if (files && files.length) sub.files = (sub.files || []).concat(files);
    var event;
    if (decision === 'reject') { sub.status = 'rejected'; event = 'rejected'; }
    else if (i + 1 < sub.steps.length) {
      sub.currentStep = i + 1;
      sub.stepStartedAt = nowIso;
      sub.steps[i + 1].status = 'current';
      sub.steps[i + 1].startedAt = nowIso;
      event = 'advanced';
    } else { sub.status = 'approved'; event = 'approved'; }
    sub.closedAt = sub.status === 'pending' ? '' : nowIso;
    sub.updatedAt = nowIso;
    return { sub: sub, event: event };
  }

  function resubmit(subIn, p, actor, changes, nowIso, files) {
    var sub = clone(subIn);
    if (!canResubmit(sub, p, actor)) throw fail('ส่งใหม่ได้เฉพาะผู้ส่งเรื่อง เมื่อเรื่องไม่ผ่านการพิจารณา', 'forbidden');
    changes = changes || {};
    if (changes.title != null && String(changes.title).trim()) sub.title = String(changes.title).trim();
    if (changes.detail != null) sub.detail = String(changes.detail);
    sub.rev = (+sub.rev || 1) + 1;
    sub.steps = snapshotSteps(p, sub.category, sub.submittedBy);
    if (files && files.length) sub.files = (sub.files || []).concat(files);
    if (changes.vote) sub.vote = cleanVote(changes.vote, sub.files || [], actor, nowIso);
    else if (sub.vote) { sub.vote.status = 'open'; sub.vote.ballots = []; sub.vote.result = ''; sub.vote.closedAt = ''; sub.vote.closedBy = ''; sub.vote.closeReason = ''; }
    sub.steps[0].status = 'current';
    sub.steps[0].startedAt = nowIso;
    sub.currentStep = 0;
    sub.stepStartedAt = nowIso;
    sub.status = 'pending';
    sub.closedAt = '';
    sub.history.push(hist(actor, 'resubmit', { at: nowIso, step: 0, comment: String(changes.comment || '').trim(), files: (files || []).slice(), rev: sub.rev }));
    sub.updatedAt = nowIso;
    return { sub: sub, event: 'resubmitted' };
  }

  function cancelSub(subIn, p, actor, comment, nowIso) {
    var sub = clone(subIn);
    if (!canCancel(sub, p, actor)) throw fail('ยกเลิกได้เฉพาะผู้ส่งเรื่องขณะรอพิจารณา', 'forbidden');
    sub.status = 'cancelled';
    sub.closedAt = nowIso;
    sub.history.push(hist(actor, 'cancel', { at: nowIso, step: sub.currentStep || 0, comment: String(comment || '').trim() }));
    sub.updatedAt = nowIso;
    return { sub: sub, event: 'cancelled' };
  }

  function commentSub(subIn, p, actor, text, nowIso, files) {
    var sub = clone(subIn);
    if (!canComment(sub, p, actor)) throw fail('คุณไม่มีสิทธิ์แสดงความเห็นในเรื่องนี้', 'forbidden');
    text = String(text || '').trim();
    if (!text && !(files && files.length)) throw fail('กรุณาพิมพ์ความเห็น', 'invalid');
    if (files && files.length) sub.files = (sub.files || []).concat(files);
    sub.history.push(hist(actor, 'comment', { at: nowIso, step: sub.currentStep || 0, comment: text, files: (files || []).slice() }));
    sub.updatedAt = nowIso;
    return { sub: sub, event: 'commented' };
  }

  /** ทำรายการกับเรื่อง: action = approve | reject | resubmit | cancel | comment */
  function act(sub, p, actor, action, opts, nowIso) {
    opts = opts || {};
    if (action === 'approve' || action === 'reject') return decide(sub, p, actor, action, opts.comment, nowIso, opts.files);
    if (action === 'resubmit') return resubmit(sub, p, actor, opts.changes || { comment: opts.comment }, nowIso, opts.files);
    if (action === 'cancel') return cancelSub(sub, p, actor, opts.comment, nowIso);
    if (action === 'comment') return commentSub(sub, p, actor, opts.comment, nowIso, opts.files);
    if (action === 'openVote') return openVote(sub, p, actor, opts.vote, nowIso, opts.files);
    if (action === 'vote') return castVote(sub, p, actor, opts.option, opts.comment, nowIso);
    if (action === 'closeVote') return closeVote(sub, p, actor, opts.option, opts.comment, nowIso);
    throw fail('ไม่รู้จักคำสั่ง ' + action, 'invalid');
  }

  // ---------- โหวตเลือกรูปแบบ/สี (คณะกรรมการตัดสิน เมื่อแบบไม่ได้กำหนดไว้) ----------
  var VOTE_STATUS = { open: 'กำลังโหวต', closed: 'ได้ข้อยุติแล้ว' };
  function cut(s, n) { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) : s; }
  /** ตรวจและจัดรูปข้อมูลโหวต: { question, options:[{label, detail, fileId}] } */
  function cleanVote(v, allowedFiles, actor, nowIso) {
    v = v || {};
    var seen = {}, opts = [];
    var src = Array.isArray(v.options) ? v.options : [];
    for (var i = 0; i < src.length && opts.length < 12; i++) {
      var o = src[i] || {};
      var label = cut(o.label, 120);
      if (!label || seen[label.toLowerCase()]) continue;
      seen[label.toLowerCase()] = 1;
      var fid = String(o.fileId || '');
      opts.push({ id: 'o' + (opts.length + 1), label: label, detail: cut(o.detail, 500), fileId: fid && (allowedFiles || []).indexOf(fid) >= 0 ? fid : '' });
    }
    if (opts.length < 2) throw fail('การโหวตต้องมีตัวเลือกอย่างน้อย 2 แบบ (ชื่อไม่ซ้ำกัน)', 'invalid');
    return {
      question: cut(v.question, 200) || 'เลือกรูปแบบ/สีที่จะใช้', options: opts, status: 'open',
      openedBy: norm(actor.email), openedByName: actor.name || '', openedAt: nowIso,
      ballots: [], result: '', closedAt: '', closedBy: '', closedByName: '', closeReason: '',
    };
  }
  /** ผู้มีสิทธิ์โหวต: คณะกรรมการทุกลำดับ (ไม่นับผู้ส่งเรื่อง) — ถ้าไม่มีคณะกรรมการ ให้เจ้าของโครงการ */
  function voters(p, sub) {
    var list = committeeSeats(p, sub && sub.submittedBy).map(function (m) { return m.email; });
    if (list.length) return list;
    return p && p.ownerEmail && norm(p.ownerEmail) !== norm(sub && sub.submittedBy) ? [norm(p.ownerEmail)] : [];
  }
  /** ประธานกรรมการ (ผู้ชี้ขาดเมื่อคะแนนเท่ากัน) — ถ้าไม่มีประธาน ให้เจ้าของโครงการ */
  function voteChair(p, sub) {
    var chair = committeeSeats(p, sub && sub.submittedBy).filter(function (m) { return m.seat === 0; })[0];
    return chair ? chair.email : (p && p.ownerEmail ? norm(p.ownerEmail) : '');
  }
  function optionLabel(vote, id) {
    var o = (vote && vote.options || []).filter(function (x) { return x.id === id; })[0];
    return o ? o.label : '';
  }
  /** นับคะแนน: { counts:{id:n}, total, eligible, leaders:[id], missing:[email] } — นับเฉพาะผู้มีสิทธิ์โหวตปัจจุบัน */
  function tally(sub, p) {
    var v = sub && sub.vote;
    var res = { counts: {}, total: 0, eligible: 0, leaders: [], missing: [], top: 0 };
    if (!v) return res;
    var elig = voters(p, sub);
    res.eligible = elig.length;
    (v.options || []).forEach(function (o) { res.counts[o.id] = 0; });
    var voted = {};
    (v.ballots || []).forEach(function (b) {
      if (elig.indexOf(b.by) < 0 || res.counts[b.option] == null) return;
      res.counts[b.option]++; res.total++; voted[b.by] = 1;
    });
    res.missing = elig.filter(function (e) { return !voted[e]; });
    for (var id in res.counts) if (res.counts[id] > res.top) res.top = res.counts[id];
    if (res.top > 0) for (var k in res.counts) if (res.counts[k] === res.top) res.leaders.push(k);
    return res;
  }
  function ballotOf(sub, email) {
    var e = norm(email);
    return ((sub && sub.vote && sub.vote.ballots) || []).filter(function (b) { return b.by === e; })[0] || null;
  }
  function canVote(sub, p, user) {
    return !!(sub && user && sub.status === 'pending' && sub.vote && sub.vote.status === 'open' && voters(p, sub).indexOf(norm(user.email)) >= 0);
  }
  function canOpenVote(sub, p, user) {
    if (!sub || !user || sub.status !== 'pending' || (sub.vote && sub.vote.status === 'open')) return false;
    var e = norm(user.email);
    if (e === norm(sub.submittedBy) && can(p, user, 'submit')) return true;
    if (isOwner(p, user)) return true;
    var r = roleOf(p, e);
    return !!r && r !== 'contractor' && permsOf(p, r).indexOf('approve') >= 0;
  }
  /** ปิดโหวต: ประธานกรรมการ หรือเจ้าของโครงการ */
  function canCloseVote(sub, p, user) {
    if (!sub || !user || sub.status !== 'pending' || !sub.vote || sub.vote.status !== 'open') return false;
    var e = norm(user.email);
    return e === voteChair(p, sub) || (isOwner(p, user) && e !== norm(sub.submittedBy));
  }
  function finishVote(sub, actor, optionId, reason, nowIso) {
    sub.vote.status = 'closed';
    sub.vote.result = optionId;
    sub.vote.closedAt = nowIso;
    sub.vote.closedBy = actor ? norm(actor.email) : '';
    sub.vote.closedByName = actor ? actor.name || '' : '';
    sub.vote.closeReason = reason;
  }
  function openVote(subIn, p, actor, v, nowIso, files) {
    var sub = clone(subIn);
    if (!canOpenVote(sub, p, actor)) throw fail('คุณไม่มีสิทธิ์เปิดโหวตในเรื่องนี้ หรือมีการโหวตที่ยังเปิดอยู่', 'forbidden');
    if (files && files.length) sub.files = (sub.files || []).concat(files);
    sub.vote = cleanVote(v, sub.files || [], actor, nowIso);
    sub.history.push(hist(actor, 'openVote', { at: nowIso, step: sub.currentStep || 0, comment: sub.vote.question, files: (files || []).slice() }));
    sub.updatedAt = nowIso;
    return { sub: sub, event: 'voteOpened' };
  }
  function castVote(subIn, p, actor, optionId, comment, nowIso) {
    var sub = clone(subIn);
    if (!canVote(sub, p, actor)) throw fail('คุณไม่มีสิทธิ์โหวตในเรื่องนี้ หรือการโหวตปิดแล้ว', 'forbidden');
    if (!optionLabel(sub.vote, optionId)) throw fail('กรุณาเลือกตัวเลือกที่จะโหวต', 'invalid');
    var e = norm(actor.email);
    sub.vote.ballots = (sub.vote.ballots || []).filter(function (b) { return b.by !== e; });
    sub.vote.ballots.push({ by: e, byName: actor.name || '', seat: seatOf(p, e), option: optionId, at: nowIso, comment: cut(comment, 500) });
    sub.history.push(hist(actor, 'vote', { at: nowIso, step: sub.currentStep || 0, comment: 'เลือก "' + optionLabel(sub.vote, optionId) + '"' + (comment ? ' — ' + cut(comment, 500) : '') }));
    sub.updatedAt = nowIso;
    var t = tally(sub, p);
    var event = 'voted';
    if (!t.missing.length) {
      if (t.leaders.length === 1) { finishVote(sub, null, t.leaders[0], 'majority', nowIso); event = 'voteClosed'; }
      else {
        // คะแนนเท่ากัน: ใช้เสียงของประธานกรรมการชี้ขาด
        var chairBallot = ballotOf(sub, voteChair(p, sub));
        if (chairBallot && t.leaders.indexOf(chairBallot.option) >= 0) { finishVote(sub, null, chairBallot.option, 'chair', nowIso); event = 'voteClosed'; }
        else event = 'voteTie';
      }
    }
    return { sub: sub, event: event };
  }
  /** ปิดโหวตก่อนครบ หรือชี้ขาดเมื่อคะแนนเท่ากัน: ผลคือคะแนนสูงสุด ถ้าเท่ากันต้องระบุ option */
  function closeVote(subIn, p, actor, optionId, comment, nowIso) {
    var sub = clone(subIn);
    if (!canCloseVote(sub, p, actor)) throw fail('ปิดโหวตได้เฉพาะประธานกรรมการหรือเจ้าของโครงการ', 'forbidden');
    var t = tally(sub, p);
    if (!t.total) throw fail('ยังไม่มีผู้โหวต — ปิดโหวตไม่ได้', 'invalid');
    var pick = '';
    if (t.leaders.length === 1) pick = t.leaders[0];
    else {
      if (!optionId || t.leaders.indexOf(optionId) < 0) throw fail('คะแนนเท่ากัน — กรุณาเลือกแบบที่ชี้ขาดจากตัวเลือกที่ได้คะแนนสูงสุด', 'invalid');
      pick = optionId;
    }
    finishVote(sub, actor, pick, t.leaders.length > 1 ? 'casting' : 'manual', nowIso);
    sub.history.push(hist(actor, 'closeVote', { at: nowIso, step: sub.currentStep || 0, comment: 'ผลโหวต: "' + optionLabel(sub.vote, pick) + '"' + (comment ? ' — ' + cut(comment, 500) : '') }));
    sub.updatedAt = nowIso;
    return { sub: sub, event: 'voteClosed' };
  }

  // ---------- ระยะเวลาพิจารณา (SLA) ----------
  function slaSettings(p, settings) {
    var warn = +(p && p.slaWarnDays) || +(settings && settings.slaWarnDays) || 7;
    var late = +(p && p.slaLateDays) || +(settings && settings.slaLateDays) || 14;
    return { warn: warn, late: Math.max(late, warn) };
  }
  /** สถานะเวลาของเรื่องที่รอพิจารณา: อายุ (วัน) นับจากวันที่ได้รับในขั้นปัจจุบัน */
  function subSla(sub, p, settings, nowIso) {
    var res = { age: 0, totalAge: 0, dueAt: '', dueDays: 0, overdue: 0, left: 0, tone: 'ok' };
    if (!sub) return res;
    var now = new Date(nowIso || new Date().toISOString());
    res.totalAge = Math.max(0, (now - new Date(sub.submittedAt)) / DAY);
    if (sub.status !== 'pending') { res.tone = 'done'; return res; }
    var step = (sub.steps || [])[sub.currentStep || 0] || {};
    var start = new Date(sub.stepStartedAt || sub.submittedAt);
    res.age = Math.max(0, (now - start) / DAY);
    res.dueDays = +step.days || 0;
    if (res.dueDays) {
      var due = new Date(start.getTime() + res.dueDays * DAY);
      res.dueAt = due.toISOString();
      res.left = (due - now) / DAY;
      res.overdue = Math.max(0, -res.left);
    }
    var s = slaSettings(p, settings);
    res.tone = res.age >= s.late ? 'late' : res.age >= s.warn ? 'warn' : (res.overdue > 0 ? 'warn' : 'ok');
    return res;
  }

  // ---------- เอกสารที่ต้องส่ง ----------
  function reqDueText(req) {
    var t = DUE_TYPES[req.dueType] || DUE_TYPES.afterStart;
    return t.replace('{n}', String(+req.dueDays || 0));
  }
  function reqDueDate(req, p) {
    if (req.dueType === 'date') return req.dueDate || '';
    var n = +req.dueDays || 0;
    if (req.dueType === 'beforeEnd') return p.endDate ? addDaysIso(p.endDate, -n) : '';
    if (req.dueType === 'afterEnd') return p.endDate ? addDaysIso(p.endDate, n) : '';
    return p.startDate ? addDaysIso(p.startDate, n) : '';
  }
  /** สถานะเอกสารที่ต้องส่ง เทียบกับเรื่องที่ส่งมา (เรื่องที่อ้างถึงรายการนี้) */
  function reqStatus(req, p, subs, todayIso) {
    var due = reqDueDate(req, p);
    var linked = (subs || []).filter(function (s) { return s.requiredId === req.id && s.status !== 'cancelled'; })
      .sort(function (a, b) { return String(a.submittedAt).localeCompare(String(b.submittedAt)); });
    var first = linked[0] || null;
    var last = linked[linked.length - 1] || null;
    var res = { due: due, sub: last, firstAt: first ? first.submittedAt : '', state: 'none', lateDays: 0, overdueDays: 0, leftDays: null, tone: 'muted' };
    if (first && due) res.lateDays = Math.max(0, daysBetween(due, first.submittedAt.slice(0, 10)));
    if (last) res.state = last.status;
    if (res.state === 'approved') { res.tone = 'ok'; return res; }
    if (due) {
      res.leftDays = daysBetween(todayIso, due);
      if (res.state === 'none' || res.state === 'rejected') {
        if (res.leftDays < 0) { res.overdueDays = -res.leftDays; res.tone = 'bad'; }
        else if (res.leftDays <= 7) res.tone = 'warn';
      } else res.tone = 'warn';
    }
    return res;
  }

  // ---------- การแจ้งเตือน ----------
  function levelOf(m) { return m.notify || DEFAULT_NOTIFY[m.role] || 'mine'; }

  /** ผู้รับอีเมล: action = ต้องดำเนินการ, info = เพื่อทราบ */
  function recipients(p, event, sub, actorEmail) {
    var actor = norm(actorEmail);
    var action = [], info = [];
    var all = members(p);
    var byLevel = function (levels) { return all.filter(function (m) { return levels.indexOf(levelOf(m)) >= 0; }).map(function (m) { return m.email; }); };
    var deciders = sub ? (sub.history || []).filter(function (h) { return h.action === 'approve' || h.action === 'reject'; }).map(function (h) { return h.by; }) : [];
    switch (event) {
      case 'submitted':
      case 'resubmitted':
        action = currentApprovers(sub, p);
        info = byLevel(['all']);
        break;
      case 'advanced':
        action = currentApprovers(sub, p);
        info = [sub.submittedBy].concat(byLevel(['all', 'decisions']), deciders);
        break;
      case 'approved':
      case 'rejected':
        info = [sub.submittedBy].concat(byLevel(['all', 'decisions']), deciders);
        break;
      case 'commented':
        info = [sub.submittedBy].concat(currentApprovers(sub, p), byLevel(['all']), deciders);
        break;
      case 'cancelled':
        info = currentApprovers(subWithStatus(sub, 'pending'), p).concat(byLevel(['all']));
        break;
      case 'progress':
        info = byLevel(['all', 'decisions']);
        break;
      case 'voteOpened':
        action = tally(sub, p).missing;
        info = [sub.submittedBy].concat(byLevel(['all']));
        break;
      case 'voteTie':
        action = [voteChair(p, sub)];
        break;
      case 'voteClosed':
        action = currentApprovers(sub, p);
        info = [sub.submittedBy].concat(voters(p, sub), byLevel(['all', 'decisions']));
        break;
      default:
        break;
    }
    action = uniq(action).filter(function (e) { return e !== actor; });
    var none = all.filter(function (m) { return levelOf(m) === 'none'; }).map(function (m) { return m.email; });
    var mustTell = sub ? [norm(sub.submittedBy)] : [];
    info = uniq(info).filter(function (e) {
      return e !== actor && action.indexOf(e) < 0 && (none.indexOf(e) < 0 || mustTell.indexOf(e) >= 0);
    });
    return { action: action, info: info };
  }
  function subWithStatus(sub, status) { var s = clone(sub); s.status = status; return s; }

  // ---------- อีเมล ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  /** วันที่และเวลาแบบไทย (เวลาประเทศไทย UTC+7) */
  function thaiDateTime(iso, withTime) {
    if (!iso) return '–';
    var d = new Date(iso);
    if (isNaN(d)) return '–';
    var hasTime = withTime !== false && String(iso).length > 10;
    var t = hasTime ? new Date(d.getTime() + 7 * 3600e3) : d;
    var day = hasTime ? t.getUTCDate() : t.getDate();
    var mon = hasTime ? t.getUTCMonth() : t.getMonth();
    var yr = (hasTime ? t.getUTCFullYear() : t.getFullYear()) + 543;
    var s = day + ' ' + THAI_MONTHS[mon] + ' ' + String(yr).slice(-2);
    if (hasTime) {
      var hh = t.getUTCHours(), mm = t.getUTCMinutes();
      s += ' ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ' น.';
    }
    return s;
  }
  function appLink(appUrl, p, sub) {
    if (!appUrl) return '';
    var base = String(appUrl).split('#')[0];
    return base + '#/p/' + encodeURIComponent(p.id) + (sub ? '/subs/' + encodeURIComponent(sub.id) : '');
  }
  function layout(title, lead, rows, body, link, linkLabel) {
    var rowHtml = rows.map(function (r) {
      return '<tr><td style="padding:4px 12px 4px 0;color:#737D90;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td><td style="padding:4px 0;color:#172238">' + r[1] + '</td></tr>';
    }).join('');
    return '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#172238;max-width:620px">' +
      '<div style="border-left:4px solid #F2A900;padding:4px 0 4px 14px;margin-bottom:14px"><div style="font-size:12px;color:#737D90">ระบบติดตามโครงการ</div>' +
      '<div style="font-size:18px;font-weight:bold">' + esc(title) + '</div></div>' +
      (lead ? '<p style="margin:0 0 12px">' + lead + '</p>' : '') +
      '<table style="border-collapse:collapse;margin:0 0 12px">' + rowHtml + '</table>' +
      (body || '') +
      (link ? '<p style="margin:18px 0"><a href="' + esc(link) + '" style="background:#172238;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">' + esc(linkLabel || 'เปิดในระบบ') + '</a></p>' : '') +
      '<p style="font-size:12px;color:#737D90;margin-top:20px">อีเมลนี้ส่งอัตโนมัติจากระบบติดตามโครงการ ปรับการรับอีเมลได้ที่เจ้าของโครงการ</p></div>';
  }

  var VERB = {
    submit: 'ส่งเรื่องเข้ามา',
    resubmit: 'แก้ไขและส่งเรื่องใหม่',
    approve: 'พิจารณาให้ผ่าน',
    reject: 'พิจารณาว่าไม่ผ่าน',
    comment: 'แสดงความเห็น',
    cancel: 'ยกเลิกเรื่อง',
    openVote: 'เปิดให้คณะกรรมการโหวตเลือกรูปแบบ',
    vote: 'โหวต',
    closeVote: 'ปิดโหวต',
  };

  var EVENT_TEXT = {
    submitted: { action: 'มีเรื่องรอคุณพิจารณา', info: 'มีเรื่องใหม่ส่งเข้ามา' },
    resubmitted: { action: 'มีเรื่องแก้ไขส่งใหม่ รอคุณพิจารณา', info: 'มีเรื่องแก้ไขส่งใหม่' },
    advanced: { action: 'มีเรื่องรอคุณพิจารณา (ผ่านขั้นก่อนหน้าแล้ว)', info: 'เรื่องผ่านการพิจารณาขั้นที่' },
    approved: { action: 'ผลการพิจารณา: ผ่าน', info: 'ผลการพิจารณา: ผ่าน' },
    rejected: { action: 'ผลการพิจารณา: ไม่ผ่าน', info: 'ผลการพิจารณา: ไม่ผ่าน' },
    commented: { action: 'มีความเห็นใหม่', info: 'มีความเห็นใหม่' },
    cancelled: { action: 'เรื่องถูกยกเลิก', info: 'เรื่องถูกยกเลิก' },
    voteOpened: { action: 'ขอให้โหวตเลือกรูปแบบ', info: 'เปิดโหวตเลือกรูปแบบ' },
    voteTie: { action: 'ผลโหวตเท่ากัน รอประธานชี้ขาด', info: 'ผลโหวตเท่ากัน' },
    voteClosed: { action: 'ได้ผลโหวตแล้ว — ดำเนินการพิจารณาต่อได้', info: 'ผลโหวตเลือกรูปแบบ' },
  };
  function voteHtml(sub, p) {
    var v = sub.vote;
    if (!v) return '';
    var t = tally(sub, p);
    var items = (v.options || []).map(function (o) {
      var win = v.status === 'closed' && v.result === o.id;
      return '<li style="margin:2px 0">' + (win ? '<b>✔ ' : '') + esc(o.label) + (win ? '</b>' : '') +
        (o.detail ? ' <span style="color:#737D90">— ' + esc(o.detail) + '</span>' : '') +
        ' <span style="color:#737D90">(' + (t.counts[o.id] || 0) + ' เสียง)</span></li>';
    }).join('');
    return '<p style="margin:10px 0 4px"><b>' + esc(v.question) + '</b> <span style="color:#737D90">— โหวตแล้ว ' + t.total + '/' + t.eligible + ' คน</span></p>' +
      '<ul style="margin:0 0 8px;padding-left:20px">' + items + '</ul>';
  }

  function isVoteEv(ev) { return ev === 'voteOpened' || ev === 'voteTie' || ev === 'voteClosed'; }
  /** อีเมลแจ้งเรื่องอนุมัติ — kind: 'action' | 'info' */
  function subEmail(event, p, sub, actor, kind, appUrl, settings) {
    var t = EVENT_TEXT[event] || { action: event, info: event };
    var step = (sub.steps || [])[sub.currentStep || 0] || {};
    var last = (sub.history || [])[sub.history.length - 1] || {};
    var head = t[kind] || t.info;
    if (event === 'voteClosed' && sub.vote) head = (kind === 'action' ? t.action : 'ผลโหวต') + ': ' + optionLabel(sub.vote, sub.vote.result);
    if (event === 'advanced' && kind === 'info') head = 'ผ่านขั้น "' + ((sub.steps[(sub.currentStep || 1) - 1] || {}).label || '') + '" แล้ว';
    var code = p.code ? '[' + p.code + '] ' : '';
    var subject = code + head + ' — ' + subNo(sub) + ' ' + sub.title;
    var sla = subSla(sub, p, settings, last.at || sub.updatedAt);
    var actorName = actor.name || actor.email;
    var actorRole = (ROLES[roleOf(p, actor.email)] || {}).label || '';
    var rows = [
      ['โครงการ', esc(p.name)],
      ['เรื่อง', esc(subNo(sub) + ' ' + sub.title) + (sub.rev > 1 ? ' (ครั้งที่ ' + sub.rev + ')' : '')],
      ['หมวด', esc(sub.category)],
      ['ผู้ส่ง', esc(sub.submittedByName || sub.submittedBy)],
      ['ได้รับเมื่อ', esc(thaiDateTime(sub.stepStartedAt || sub.submittedAt))],
    ];
    if (sub.status === 'pending') {
      rows.push(['ขั้นตอนปัจจุบัน', esc('ขั้นที่ ' + ((sub.currentStep || 0) + 1) + '/' + sub.steps.length + ' ' + (step.label || ''))]);
      if (sla.dueAt) rows.push(['ต้องพิจารณาภายใน', esc(step.days + ' วัน (ภายใน ' + thaiDateTime(sla.dueAt) + ')')]);
    } else {
      rows.push(['สถานะ', '<b>' + esc((SUB_STATUS[sub.status] || {}).label || sub.status) + '</b>']);
    }
    var body = '';
    if (event === 'submitted' || event === 'resubmitted') {
      if (sub.detail) body += '<div style="background:#F0F2EE;padding:10px 14px;border-radius:6px;white-space:pre-wrap">' + esc(sub.detail) + '</div>';
    } else if (last.comment && !isVoteEv(event)) {
      body += '<p style="margin:0 0 4px;color:#737D90">' + (last.action === 'reject' ? 'เหตุผลที่ไม่ผ่าน' : 'ความเห็น') + ' — ' + esc(actorName) + (actorRole ? ' (' + esc(actorRole) + ')' : '') + '</p>' +
        '<div style="background:' + (last.action === 'reject' ? '#FBE6E3' : '#F0F2EE') + ';padding:10px 14px;border-radius:6px;white-space:pre-wrap">' + esc(last.comment) + '</div>';
    }
    var isVote = event === 'voteOpened' || event === 'voteTie' || event === 'voteClosed';
    if (isVote || ((event === 'submitted' || event === 'resubmitted') && sub.vote)) body += voteHtml(sub, p);
    var nFiles = (last.files || []).length;
    if (nFiles) body += '<p style="color:#737D90">แนบไฟล์ ' + nFiles + ' ไฟล์ — เปิดดูในระบบ</p>';
    var who = '<b>' + esc(actorName) + '</b>' + (actorRole ? ' (' + esc(actorRole) + ')' : '');
    var lead;
    if (event === 'voteOpened') lead = kind === 'action' ? who + ' เปิดให้คณะกรรมการโหวตเลือกรูปแบบ — กรุณาเข้าระบบเพื่อเลือกแบบที่เห็นสมควร' : who + ' เปิดให้คณะกรรมการโหวตเลือกรูปแบบ';
    else if (event === 'voteTie') lead = 'กรรมการโหวตครบแล้วแต่คะแนนเท่ากัน — กรุณาเข้าระบบเพื่อชี้ขาด';
    else if (event === 'voteClosed') lead = 'การโหวตได้ข้อยุติแล้ว: <b>' + esc(optionLabel(sub.vote, sub.vote && sub.vote.result)) + '</b>' + (kind === 'action' ? ' — กรุณาพิจารณาเรื่องนี้ต่อในระบบ' : '');
    else lead = kind === 'action'
      ? who + ' ' + esc(VERB[last.action] || 'ส่งเรื่องเข้ามา') + ' — กรุณาพิจารณา <b>ผ่าน</b> หรือ <b>ไม่ผ่าน</b> พร้อมระบุเหตุผลในระบบ'
      : who + ' ' + esc(VERB[last.action] || '');
    var html = layout(head, lead, rows, body, appLink(appUrl, p, sub), event === 'voteOpened' && kind === 'action' ? 'เปิดเพื่อโหวต' : kind === 'action' ? 'เปิดเพื่อพิจารณา' : 'ดูรายละเอียด');
    return { subject: subject, html: html };
  }

  /** อีเมลทั้งหมดของเหตุการณ์หนึ่ง: [{ to, kind, event, subject, html }] — ส่งเรื่องที่มีโหวต แจ้งกรรมการให้โหวตด้วย */
  function mailPlan(p, event, sub, actor, appUrl, settings) {
    var out = [];
    var rc = recipients(p, event, sub, actor.email);
    var mk = function (to, kind, ev) {
      var m = subEmail(ev, p, sub, actor, kind, appUrl, settings);
      return { to: to, kind: kind, event: ev, subject: m.subject, html: m.html };
    };
    if (rc.action.length) out.push(mk(rc.action, 'action', event));
    if (rc.info.length) out.push(mk(rc.info, 'info', event));
    if ((event === 'submitted' || event === 'resubmitted') && sub && sub.vote && sub.vote.status === 'open') {
      var extra = recipients(p, 'voteOpened', sub, actor.email).action.filter(function (e) { return rc.action.indexOf(e) < 0; });
      if (extra.length) out.push(mk(extra, 'action', 'voteOpened'));
    }
    return out;
  }

  function progressEmail(p, update, actor, appUrl, info) {
    info = info || {};
    var code = p.code ? '[' + p.code + '] ' : '';
    var pct = function (r) { return r == null ? '–' : (r * 100).toFixed(1) + '%'; };
    var rows = [
      ['โครงการ', esc(p.name)],
      ['วันที่บันทึก', esc(thaiDateTime(update.date, false)) + (update.week ? ' (สัปดาห์ที่ ' + esc(update.week) + ')' : '')],
      ['ผลงานสะสม', '<b>' + esc(pct(info.actual)) + '</b>' + (info.plan != null ? ' — แผน ' + esc(pct(info.plan)) : '')],
      ['ผู้บันทึก', esc(actor.name || actor.email)],
    ];
    var body = '';
    if (update.note) body += '<p style="margin:0 0 4px;color:#737D90">ผลการดำเนินงาน</p><div style="background:#F0F2EE;padding:10px 14px;border-radius:6px;white-space:pre-wrap">' + esc(update.note) + '</div>';
    if (update.issues) body += '<p style="margin:10px 0 4px;color:#B86E00">ปัญหาและอุปสรรค</p><div style="background:#FCEFD8;padding:10px 14px;border-radius:6px;white-space:pre-wrap">' + esc(update.issues) + '</div>';
    return {
      subject: code + 'อัปเดตความคืบหน้า ' + pct(info.actual) + ' — ' + p.name,
      html: layout('อัปเดตความคืบหน้าโครงการ', '', rows, body, appLink(appUrl, p), 'ดูโครงการ'),
    };
  }

  function inviteEmail(p, member, actor, appUrl, mode) {
    var role = ROLES[member.role] || {};
    var how = mode === 'gas' ? 'เปิดลิงก์ด้านล่าง แล้วเข้าสู่ระบบด้วยอีเมลนี้ (ระบบจะส่งรหัสยืนยัน 6 หลักให้ทางอีเมล)'
      : (mode === 'sharepoint' || mode === 'onedrive') ? 'เปิดลิงก์ด้านล่าง แล้วลงชื่อเข้าใช้ด้วยบัญชี Microsoft ของคุณ (ต้องเป็นบัญชีของอีเมลนี้)' : 'เปิดลิงก์ด้านล่างเพื่อเข้าใช้งาน';
    return {
      subject: (p.code ? '[' + p.code + '] ' : '') + 'คุณได้รับแต่งตั้งเป็น' + (role.label || member.role) + ' — ' + p.name,
      html: layout('แต่งตั้งเป็น' + (role.label || member.role), esc(actor.name || actor.email) + ' แต่งตั้งคุณเป็นสมาชิกของโครงการ',
        [['โครงการ', esc(p.name)], ['บทบาท', '<b>' + esc(role.label || member.role) + '</b>'], ['สิทธิ์', esc(role.desc || '')]],
        '<p>' + esc(how) + '</p>', appLink(appUrl, p), 'เปิดโครงการ'),
    };
  }

  function reminderEmail(p, pendingSubs, dueReqs, appUrl, settings, nowIso) {
    var rows = [['โครงการ', esc(p.name)]];
    var body = '';
    if (pendingSubs.length) {
      body += '<p style="margin:8px 0 4px"><b>เรื่องที่รอพิจารณานาน</b></p><ul style="margin:0;padding-left:20px">' + pendingSubs.map(function (s) {
        var sla = subSla(s, p, settings, nowIso);
        return '<li>' + esc(subNo(s) + ' ' + s.title) + ' — ค้าง ' + Math.floor(sla.age) + ' วัน' + (sla.overdue >= 1 ? ' (เกินกำหนด ' + Math.floor(sla.overdue) + ' วัน)' : sla.overdue > 0 ? ' (เกินกำหนดแล้ว)' : '') + '</li>';
      }).join('') + '</ul>';
    }
    if (dueReqs.length) {
      body += '<p style="margin:12px 0 4px"><b>เอกสารที่ต้องส่ง</b></p><ul style="margin:0;padding-left:20px">' + dueReqs.map(function (r) {
        return '<li>' + esc(r.req.title) + ' — ' + (r.st.overdueDays ? 'เลยกำหนด ' + r.st.overdueDays + ' วัน' : 'ครบกำหนด ' + esc(thaiDateTime(r.st.due, false))) + '</li>';
      }).join('') + '</ul>';
    }
    return {
      subject: (p.code ? '[' + p.code + '] ' : '') + 'เตือน: มีงานค้างในโครงการ ' + p.name,
      html: layout('สรุปงานค้าง', '', rows, body, appLink(appUrl, p), 'เปิดโครงการ'),
    };
  }

  root.PTRules = {
    ROLES: ROLES, MEMBER_ROLES: MEMBER_ROLES, OWNER_ACTS: OWNER_ACTS, PERMS: PERMS, PERM_KEYS: PERM_KEYS,
    MAX_SEAT: MAX_SEAT, STEP_MODES: STEP_MODES, VOTE_STATUS: VOTE_STATUS, seatLabel: seatLabel, seatOf: seatOf, committeeSeats: committeeSeats, stepMode: stepMode,
    voters: voters, voteChair: voteChair, tally: tally, ballotOf: ballotOf, optionLabel: optionLabel,
    canVote: canVote, canOpenVote: canOpenVote, canCloseVote: canCloseVote, cleanVote: cleanVote, currentStep: currentStep,
    DEFAULT_ROLE_PERMS: DEFAULT_ROLE_PERMS, NOTIFY: NOTIFY, DEFAULT_NOTIFY: DEFAULT_NOTIFY,
    DEFAULT_WORKFLOWS: DEFAULT_WORKFLOWS, REQUIRED_TEMPLATE: REQUIRED_TEMPLATE, DUE_TYPES: DUE_TYPES,
    SUB_STATUS: SUB_STATUS, ACTIONS: ACTIONS,
    norm: norm, validEmail: validEmail, listHas: listHas, parseList: parseList, subNo: subNo,
    members: members, roleOf: roleOf, memberName: memberName, permsOf: permsOf, isOwner: isOwner,
    canView: canView, can: can, canCreateProject: canCreateProject,
    workflows: workflows, workflowFor: workflowFor, stepLabel: stepLabel, approversFor: approversFor, ownerActsAs: ownerActsAs,
    currentApprovers: currentApprovers, canDecide: canDecide, canComment: canComment, canResubmit: canResubmit, canCancel: canCancel,
    createSubmission: createSubmission, act: act, nextNo: nextNo,
    slaSettings: slaSettings, subSla: subSla,
    reqDueText: reqDueText, reqDueDate: reqDueDate, reqStatus: reqStatus,
    recipients: recipients, subEmail: subEmail, mailPlan: mailPlan, progressEmail: progressEmail, inviteEmail: inviteEmail, reminderEmail: reminderEmail,
    thaiDateTime: thaiDateTime,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
