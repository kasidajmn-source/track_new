/**
 * ระบบติดตามโครงการ — Backend (Google Apps Script) เวอร์ชัน 1.0.1
 * ---------------------------------------------------------------
 * ทำหน้าที่เป็น API ให้หน้าเว็บบน GitHub Pages
 *  - ข้อมูล (โครงการ, BOQ, บันทึกความคืบหน้า, รายชื่อไฟล์, เรื่องขออนุมัติ) เก็บใน Google Sheet
 *  - ไฟล์เอกสารเก็บใน Google Drive แยกโฟลเดอร์ตามโครงการ > หมวดเอกสาร
 *  - ผู้ใช้เข้าสู่ระบบด้วยอีเมล + รหัสยืนยัน 6 หลักที่ส่งทางอีเมล (ไม่ต้องมีบัญชี Google)
 *  - ตรวจสิทธิ์ทุกคำสั่งตามบทบาทในโครงการ และส่งอีเมลแจ้งเตือนผู้เกี่ยวข้อง
 *
 * วิธีติดตั้ง (ดูรายละเอียดใน README.md)
 *  1) สร้าง Google Sheet ใหม่ > ส่วนขยาย > Apps Script > วางโค้ดนี้แทนของเดิม
 *  2) (ไม่บังคับ) ใส่ลิงก์หรือ ID โฟลเดอร์ Google Drive ใน CONFIG.ROOT_FOLDER_ID
 *     และใส่ลิงก์หน้าเว็บ (GitHub Pages) ใน CONFIG.APP_URL เพื่อให้ลิงก์ในอีเมลถูกต้อง
 *  3) เลือกฟังก์ชัน setup แล้วกด "เรียกใช้" > อนุญาตสิทธิ์ > ดูรหัสเข้าใช้งานใน "บันทึกการดำเนินการ"
 *  4) ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > เว็บแอป
 *     ดำเนินการในฐานะ: ฉัน / ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 *  5) นำ URL ที่ลงท้ายด้วย /exec และรหัสเข้าใช้งาน ไปใส่ในหน้า "ตั้งค่า" ของเว็บ
 *
 * อัปเดตจาก 1.0.0: วางโค้ดนี้แทนของเดิม > รัน setup อีกครั้ง (เพื่ออนุญาตสิทธิ์ส่งอีเมลและตั้งเวลาเตือนรายวัน)
 *  > จัดการการทำให้ใช้งานได้ > แก้ไข > เวอร์ชันใหม่ (URL เดิมใช้ต่อได้)
 */

var CONFIG = {
  // ลิงก์หรือ ID โฟลเดอร์ Google Drive ที่ใช้เก็บไฟล์ทุกโครงการ (เว้นว่าง = ให้ setup สร้างให้)
  ROOT_FOLDER_ID: '',
  // รหัสเข้าใช้งานของทีม (เว้นว่าง = ให้ setup สร้างให้ และเก็บใน Script Properties)
  ACCESS_KEY: '',
  // true = ตั้งไฟล์ที่อัปโหลดเป็น "ทุกคนที่มีลิงก์ดูได้" (ไม่แนะนำสำหรับเอกสารภายใน)
  LINK_SHARING: false,
  // ขนาดไฟล์สูงสุดต่อการอัปโหลดผ่านเว็บ (MB) — Apps Script รับข้อมูลได้ราว 50 MB ต่อคำขอ
  MAX_UPLOAD_MB: 25,

  // ---------- ผู้ใช้ สิทธิ์ และอีเมล (1.0.1) ----------
  // อีเมลผู้ดูแลระบบเพิ่มเติม คั่นด้วยจุลภาค (เจ้าของสคริปต์เป็นผู้ดูแลระบบเสมอ)
  ADMIN_EMAILS: '',
  // ลิงก์หน้าเว็บของระบบ เช่น https://ชื่อ.github.io/project-tracker/ (ใช้ในลิงก์ของอีเมล)
  APP_URL: '',
  // ส่งอีเมลแจ้งเตือนเรื่องขออนุมัติ/ความคืบหน้า (รหัสเข้าสู่ระบบส่งเสมอ)
  SEND_EMAIL: true,
  // แชร์โฟลเดอร์โครงการใน Google Drive ให้สมาชิก (ดูอย่างเดียว) เพื่อให้เปิดไฟล์ได้
  SHARE_DRIVE_WITH_MEMBERS: true,
  // อายุการเข้าสู่ระบบ (วัน)
  SESSION_DAYS: 30,
  // ชื่อผู้ส่งในอีเมล
  MAIL_SENDER_NAME: 'ระบบติดตามโครงการ',
  // เวลาส่งอีเมลเตือนงานค้างรายวัน (ชั่วโมง 0–23 ตามเวลาของสคริปต์)
  REMINDER_HOUR: 8,
};

var VERSION = '1.0.2';
var SUB_FILE_CATEGORY = 'เอกสารแนบเรื่องขออนุมัติ';

var SCHEMA = {
  Projects: ['id', 'code', 'name', 'type', 'tags', 'status', 'owner', 'manager', 'contractor', 'contractNo', 'location',
    'startDate', 'endDate', 'contractValue', 'description', 'progressMethod', 'priceBasis', 'allowOver', 'planMode',
    'planPoints', 'docCategories', 'folderId', 'folderUrl', 'createdBy', 'createdAt', 'updatedAt',
    'ownerEmail', 'ownerName', 'ownerRole', 'members', 'rolePerms', 'workflow', 'slaWarnDays', 'slaLateDays', 'ownerSeat'],
  BOQ: ['id', 'projectId', 'group', 'no', 'desc', 'unit', 'qty', 'mat', 'labor', 'weight', 'order', 'ps', 'pe'],
  Updates: ['id', 'projectId', 'date', 'week', 'entries', 'manualPct', 'note', 'issues', 'createdBy', 'createdAt', 'updatedAt', 'createdByEmail'],
  Files: ['id', 'projectId', 'category', 'name', 'mime', 'size', 'driveId', 'url', 'note', 'updateId', 'uploadedBy', 'uploadedAt', 'subId', 'uploadedByEmail'],
  Submissions: ['id', 'projectId', 'no', 'rev', 'category', 'title', 'detail', 'requiredId', 'files', 'submittedBy', 'submittedByName',
    'submittedAt', 'status', 'currentStep', 'stepStartedAt', 'steps', 'history', 'closedAt', 'updatedAt', 'vote'],
  Required: ['id', 'projectId', 'title', 'category', 'dueType', 'dueDays', 'dueDate', 'note', 'order'],
  Settings: ['key', 'value'],
  Users: ['email', 'name', 'lastLoginAt', 'createdAt'],
  MailLog: ['at', 'to', 'subject', 'event', 'projectId', 'ok', 'error'],
};
var JSON_FIELDS = {
  Projects: ['tags', 'planPoints', 'docCategories', 'members', 'rolePerms', 'workflow'],
  Updates: ['entries'], Settings: ['value'], Submissions: ['files', 'steps', 'history', 'vote'],
};
var NUM_FIELDS = {
  Projects: ['contractValue', 'slaWarnDays', 'slaLateDays'], BOQ: ['qty', 'mat', 'labor', 'weight', 'order', 'ps', 'pe'],
  Updates: ['week', 'manualPct'], Files: ['size'], Submissions: ['no', 'rev', 'currentStep'], Required: ['dueDays', 'order'],
};
var BOOL_FIELDS = { Projects: ['allowOver'], MailLog: ['ok'] };
var DATE_FIELDS = { Projects: ['startDate', 'endDate'], Updates: ['date'], Required: ['dueDate'] };
// ตารางที่ไม่มีคอลัมน์ id (ใช้คีย์อื่น)
var KEY_FIELD = { Settings: 'key', Users: 'email' };

// คำสั่งที่เรียกได้โดยยังไม่เข้าสู่ระบบ และคำสั่งที่ไม่ต้องล็อก
var PUBLIC_ACTIONS = ['ping', 'requestOtp', 'verifyOtp'];
var READ_ONLY = ['ping', 'getAll', 'requestOtp'];
// ฟิลด์ที่เฉพาะเจ้าของโครงการเปลี่ยนได้
var OWNER_FIELDS = ['ownerRole', 'ownerSeat', 'members', 'rolePerms', 'workflow', 'slaWarnDays', 'slaLateDays'];

function R_() { return globalThis.PTRules; }

// =============================================================
// จุดเข้า Web app
// =============================================================
function doGet() {
  return json_({ ok: true, data: { app: 'project-tracker', version: VERSION, message: 'API พร้อมใช้งาน — เปิดหน้าเว็บของระบบเพื่อใช้งาน' } });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'รูปแบบคำขอไม่ถูกต้อง' });
  }
  var key = accessKey_();
  if (key && body.key !== key) {
    return json_({ ok: false, code: 'auth', error: 'รหัสเข้าใช้งานไม่ถูกต้อง — ตรวจสอบรหัสในหน้าตั้งค่า' });
  }
  var fn = ACTIONS[body.action];
  if (!fn) return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + body.action });

  var lock = null;
  try {
    if (READ_ONLY.indexOf(body.action) < 0) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }
    var ctx = { me: null, settings: null };
    if (PUBLIC_ACTIONS.indexOf(body.action) < 0) {
      var sess = session_(body.token);
      if (!sess) return json_({ ok: false, code: 'login', error: 'กรุณาเข้าสู่ระบบด้วยอีเมลของคุณ' });
      ctx.settings = readSettings_();
      ctx.me = userCtx_(sess.email, sess.name, ctx.settings);
      rememberAppUrl_(body.appUrl);
    }
    var data = fn(body, ctx);
    return json_({ ok: true, data: data });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, code: (err && err.code) || '', error: String((err && err.message) || err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg, code) {
  var e = new Error(msg);
  e.code = code || '';
  throw e;
}
function forbid_(msg) { fail_(msg || 'คุณไม่มีสิทธิ์ทำรายการนี้ในโครงการนี้', 'forbidden'); }
function need_(p, me, perm, msg) { if (!R_().can(p, me, perm)) forbid_(msg); }
function nowIso_() { return new Date().toISOString(); }

// =============================================================
// คำสั่งของ API
// =============================================================
var ACTIONS = {
  ping: function () {
    return { version: VERSION, time: nowIso_(), maxUploadMB: CONFIG.MAX_UPLOAD_MB, auth: 'otp' };
  },

  // ---------- เข้าสู่ระบบ ----------
  requestOtp: function (b) {
    var R = R_();
    var email = R.norm(b.email);
    if (!R.validEmail(email)) fail_('อีเมลไม่ถูกต้อง');
    var settings = readSettings_();
    if (!loginAllowed_(email, settings)) {
      fail_('อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าใช้ระบบ — ให้เจ้าของโครงการเพิ่มอีเมลของคุณเป็นสมาชิกก่อน', 'not_member');
    }
    var cache = CacheService.getScriptCache();
    var rlKey = 'otprl_' + hash_(email).slice(0, 32);
    var count = +(cache.get(rlKey) || 0);
    if (count >= 5) fail_('ขอรหัสบ่อยเกินไป กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่', 'rate');
    var all = +(cache.get('otprl_all') || 0);
    if (all >= 120) fail_('ระบบได้รับคำขอรหัสจำนวนมาก กรุณาลองใหม่ภายหลัง', 'rate');
    var code = otpCode_();
    cache.put('otp_' + hash_(email).slice(0, 32), JSON.stringify({ h: hash_(email + '|' + code), tries: 0 }), 600);
    cache.put(rlKey, String(count + 1), 3600);
    cache.put('otprl_all', String(all + 1), 3600);
    MailApp.sendEmail({
      to: email,
      subject: 'รหัสเข้าสู่ระบบติดตามโครงการ: ' + code,
      htmlBody: '<div style="font-family:Tahoma,Arial,sans-serif;font-size:14px;color:#172238;line-height:1.6">' +
        '<p>รหัสสำหรับเข้าสู่ระบบติดตามโครงการของคุณคือ</p>' +
        '<p style="font-size:30px;letter-spacing:8px;font-weight:bold;margin:8px 0 16px">' + code + '</p>' +
        '<p style="color:#737D90">รหัสใช้ได้ภายใน 10 นาที หากคุณไม่ได้ขอรหัสนี้ ไม่ต้องดำเนินการใดๆ</p></div>',
      body: 'รหัสเข้าสู่ระบบติดตามโครงการ: ' + code + ' (ใช้ได้ภายใน 10 นาที)',
      name: CONFIG.MAIL_SENDER_NAME,
    });
    return { sent: true, email: email };
  },

  verifyOtp: function (b) {
    var R = R_();
    var email = R.norm(b.email);
    var code = String(b.code || '').replace(/\D/g, '');
    var cache = CacheService.getScriptCache();
    var ck = 'otp_' + hash_(email).slice(0, 32);
    var raw = cache.get(ck);
    if (!raw) fail_('รหัสหมดอายุหรือยังไม่ได้ขอรหัส — กด "ส่งรหัสอีกครั้ง"', 'otp_expired');
    var o = JSON.parse(raw);
    if (o.h !== hash_(email + '|' + code)) {
      o.tries = (o.tries || 0) + 1;
      if (o.tries >= 5) { cache.remove(ck); fail_('ใส่รหัสผิดหลายครั้ง — กด "ส่งรหัสอีกครั้ง" เพื่อขอรหัสใหม่', 'otp_expired'); }
      cache.put(ck, JSON.stringify(o), 600);
      fail_('รหัสไม่ถูกต้อง (เหลือโอกาสอีก ' + (5 - o.tries) + ' ครั้ง)', 'otp_wrong');
    }
    cache.remove(ck);
    var settings = readSettings_();
    var user = findUser_(email);
    var name = String(b.name || '').trim() || (user && user.name) || nameFromProjects_(email) || email.split('@')[0];
    var now = nowIso_();
    upsertKey_('Users', 'email', { email: email, name: name, lastLoginAt: now, createdAt: user ? user.createdAt : now });
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    var props = PropertiesService.getScriptProperties();
    props.setProperty('sess_' + hash_(token), JSON.stringify({ email: email, name: name, exp: Date.now() + CONFIG.SESSION_DAYS * 864e5 }));
    cleanSessions_();
    return { token: token, me: userCtx_(email, name, settings) };
  },

  logout: function (b) {
    if (b.token) PropertiesService.getScriptProperties().deleteProperty('sess_' + hash_(b.token));
    return { ok: true };
  },

  /** เปลี่ยนชื่อที่แสดงของผู้ใช้ */
  updateMe: function (b, ctx) {
    var name = String(b.name || '').trim();
    if (!name) fail_('กรุณาระบุชื่อ');
    var props = PropertiesService.getScriptProperties();
    var k = 'sess_' + hash_(b.token);
    var s = JSON.parse(props.getProperty(k));
    s.name = name;
    props.setProperty(k, JSON.stringify(s));
    var u = findUser_(ctx.me.email) || { email: ctx.me.email, createdAt: nowIso_() };
    u.name = name;
    upsertKey_('Users', 'email', u);
    return userCtx_(ctx.me.email, name, ctx.settings);
  },

  // ---------- อ่านข้อมูล (เฉพาะโครงการที่มีสิทธิ์) ----------
  getAll: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var projects = readTable_('Projects').filter(function (p) { return R.canView(p, me); });
    var ids = {};
    projects.forEach(function (p) { ids[p.id] = true; });
    var pick = function (t) { return readTable_(t).filter(function (r) { return ids[r.projectId]; }); };
    return {
      projects: projects,
      boq: pick('BOQ'),
      updates: pick('Updates'),
      files: pick('Files'),
      subs: pick('Submissions'),
      reqs: pick('Required'),
      settings: ctx.settings,
      meta: {
        rootFolderUrl: me.isAdmin ? safeRootUrl_() : '', maxUploadMB: CONFIG.MAX_UPLOAD_MB, version: VERSION,
        me: me, auth: 'otp', mailQuota: me.isAdmin ? mailQuota_() : null, sendEmail: CONFIG.SEND_EMAIL,
      },
    };
  },

  // ---------- โครงการ ----------
  saveProject: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var p = b.project || {};
    var old = p.id ? findById_('Projects', p.id) : null;
    var owner = true;
    if (old) {
      owner = R.isOwner(old, me);
      if (!owner && !R.can(old, me, 'editProject')) forbid_('คุณไม่มีสิทธิ์แก้ไขข้อมูลโครงการนี้');
      // เปลี่ยนเจ้าของได้ทางคำสั่ง transferOwner เท่านั้น
      p.ownerEmail = old.ownerEmail || '';
      p.ownerName = old.ownerName || '';
      if (!owner) OWNER_FIELDS.forEach(function (k) { p[k] = old[k]; });
      // โฟลเดอร์ Drive: เฉพาะผู้ดูแลระบบเปลี่ยนไปใช้โฟลเดอร์อื่นได้ (กันการชี้ไปโฟลเดอร์ของโครงการอื่น/โฟลเดอร์ส่วนตัวของบัญชีที่ติดตั้ง)
      if (!me.isAdmin) { p.folderId = old.folderId; p.folderUrl = old.folderUrl; }
      p.createdBy = old.createdBy; p.createdAt = old.createdAt;
    } else {
      if (!me.canCreate) forbid_('บัญชีนี้ยังไม่ได้รับสิทธิ์สร้างโครงการ — ติดต่อผู้ดูแลระบบ');
      p.ownerEmail = me.email;
      p.ownerName = me.name;
      if (!me.isAdmin) { p.folderId = ''; p.folderUrl = ''; }
      if (p.id && !/^[\w-]{4,60}$/.test(p.id)) p.id = '';
    }
    if (owner) {
      p.ownerRole = R.OWNER_ACTS[p.ownerRole] ? p.ownerRole : 'supervisor';
      p.ownerSeat = p.ownerRole === 'committee' ? seat_(p.ownerSeat) : '';
      p.members = cleanMembers_(p.members, p.ownerEmail);
      p.rolePerms = cleanRolePerms_(p.rolePerms);
      p.workflow = cleanWorkflow_(p.workflow);
      p.slaWarnDays = p.slaWarnDays === '' || p.slaWarnDays == null ? '' : Math.max(1, num_(p.slaWarnDays));
      p.slaLateDays = p.slaLateDays === '' || p.slaLateDays == null ? '' : Math.max(1, num_(p.slaLateDays));
    }
    var saved = saveProject_(p, me.name);
    var mail = null;
    if (owner) mail = afterMembersChanged_(old, saved, me, b, ctx);
    if (mail) saved._mail = mail;
    return saved;
  },

  transferOwner: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var p = requireProject_(b.projectId);
    need_(p, me, 'transferOwner', 'เฉพาะเจ้าของโครงการหรือผู้ดูแลระบบเท่านั้นที่โอนความเป็นเจ้าของได้');
    var e = R.norm(b.email);
    if (!R.validEmail(e)) fail_('อีเมลไม่ถูกต้อง');
    var target = (p.members || []).filter(function (m) { return R.norm(m.email) === e; })[0];
    var members = (p.members || []).filter(function (m) { return R.norm(m.email) !== e; });
    if (p.ownerEmail && R.norm(p.ownerEmail) !== e) {
      members.push({ email: R.norm(p.ownerEmail), name: p.ownerName || '', role: 'supervisor', notify: 'all' });
    }
    p.ownerEmail = e;
    p.ownerName = (target && target.name) || ((findUser_(e) || {}).name) || '';
    p.members = members;
    var saved = saveProject_(p, me.name);
    shareFolder_(saved, [e], []);
    var msg = R.inviteEmail(saved, { email: e, role: 'owner', name: saved.ownerName }, me, appUrl_(b, ctx.settings), 'gas');
    sendMails_([Object.assign({ to: [e], kind: 'invite', event: 'owner' }, msg)], { projectId: saved.id, replyTo: me.email });
    return saved;
  },

  deleteProject: function (b, ctx) {
    if (!b.id) fail_('ไม่ได้ระบุโครงการ');
    var p = requireProject_(b.id);
    need_(p, ctx.me, 'deleteProject', 'เฉพาะเจ้าของโครงการหรือผู้ดูแลระบบเท่านั้นที่ลบโครงการได้');
    deleteWhere_('Projects', function (r) { return r.id === b.id; });
    ['BOQ', 'Updates', 'Files', 'Submissions', 'Required'].forEach(function (t) {
      deleteWhere_(t, function (r) { return r.projectId === b.id; });
    });
    return { id: b.id };
  },

  // ---------- BOQ และแผนงาน ----------
  saveBoq: function (b, ctx) {
    if (!b.projectId) fail_('ไม่ได้ระบุโครงการ');
    var p = requireProject_(b.projectId);
    need_(p, ctx.me, 'editBoq', 'คุณไม่มีสิทธิ์แก้ไข BOQ และแผนงานของโครงการนี้');
    // รหัสรายการที่เป็นของโครงการอื่น ห้ามนำมาใช้ซ้ำ
    var foreign = {};
    readTable_('BOQ').forEach(function (r) { if (r.projectId !== b.projectId) foreign[r.id] = true; });
    var items = (b.items || []).map(function (it, i) {
      var ps = num_(it.ps), pe = num_(it.pe);
      return {
        id: it.id && !foreign[it.id] && /^[\w-]{1,60}$/.test(it.id) ? it.id : newId_('B'), projectId: b.projectId, group: it.group || '', no: it.no || '', desc: it.desc || '',
        unit: it.unit || '', qty: num_(it.qty), mat: num_(it.mat), labor: num_(it.labor),
        weight: it.weight === '' || it.weight == null ? '' : num_(it.weight), order: i + 1,
        ps: ps > 0 ? Math.round(ps) : '', pe: pe > 0 ? Math.round(pe) : '',
      };
    });
    replaceWhere_('BOQ', function (r) { return r.projectId === b.projectId; }, items);
    return items;
  },

  // ---------- บันทึกความคืบหน้า ----------
  saveUpdate: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var u = b.update || {};
    if (!u.projectId) fail_('ไม่ได้ระบุโครงการ');
    if (!u.date) fail_('ไม่ได้ระบุวันที่');
    var p = requireProject_(u.projectId);
    need_(p, me, 'recordProgress', 'คุณไม่มีสิทธิ์บันทึกความคืบหน้าของโครงการนี้');
    var now = nowIso_();
    var old = u.id ? findById_('Updates', u.id) : null;
    if (old && old.projectId !== p.id) forbid_();
    var rec = {
      id: u.id || newId_('U'), projectId: u.projectId, date: u.date, week: u.week === '' ? '' : num_(u.week),
      entries: u.entries || {}, manualPct: u.manualPct === '' || u.manualPct == null ? '' : num_(u.manualPct),
      note: u.note || '', issues: u.issues || '',
      createdBy: old ? old.createdBy : me.name, createdByEmail: old ? (old.createdByEmail || '') : me.email,
      createdAt: old ? old.createdAt : now, updatedAt: now,
    };
    upsert_('Updates', rec);
    if (b.notify) {
      var rc = R.recipients(p, 'progress', null, me.email);
      if (rc.info.length) {
        var m = R.progressEmail(p, rec, me, appUrl_(b, ctx.settings), b.summary || {});
        rec._mail = sendMails_([Object.assign({ to: rc.info, kind: 'info', event: 'progress' }, m)], { projectId: p.id, replyTo: me.email });
      }
    }
    return rec;
  },

  deleteUpdate: function (b, ctx) {
    var u = findById_('Updates', b.id);
    if (u) need_(requireProject_(u.projectId), ctx.me, 'recordProgress', 'คุณไม่มีสิทธิ์ลบบันทึกความคืบหน้าของโครงการนี้');
    deleteWhere_('Updates', function (r) { return r.id === b.id; });
    return { id: b.id };
  },

  // ---------- ไฟล์ ----------
  uploadFile: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var p = requireProject_(b.projectId);
    if (b.subId) {
      if (!(R.can(p, me, 'submit') || R.can(p, me, 'approve') || R.isOwner(p, me))) forbid_('คุณไม่มีสิทธิ์แนบไฟล์ในเรื่องขออนุมัติของโครงการนี้');
      var sref = findById_('Submissions', b.subId);
      if (sref && (sref.projectId !== p.id || !R.canView(p, me))) forbid_();
      if (!/^[\w-]{4,60}$/.test(String(b.subId))) fail_('รหัสเรื่องไม่ถูกต้อง');
    } else if (!(b.updateId && R.can(p, me, 'recordProgress'))) need_(p, me, 'uploadDocs', 'คุณไม่มีสิทธิ์อัปโหลดเอกสารในคลังของโครงการนี้');
    if (!b.base64) fail_('ไม่มีข้อมูลไฟล์');
    var bytes = Utilities.base64Decode(b.base64);
    if (bytes.length > CONFIG.MAX_UPLOAD_MB * 1048576) fail_('ไฟล์ใหญ่เกิน ' + CONFIG.MAX_UPLOAD_MB + ' MB');
    // ไฟล์แนบของเรื่องขออนุมัติเก็บในหมวดเฉพาะเสมอ
    var category = b.subId ? SUB_FILE_CATEGORY : (b.category || 'อื่นๆ');
    var folder = categoryFolder_(p, category);
    var blob = Utilities.newBlob(bytes, b.mime || 'application/octet-stream', b.name || 'ไฟล์');
    var file = folder.createFile(blob);
    if (b.note) file.setDescription(b.note);
    if (CONFIG.LINK_SHARING) {
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* โดเมนอาจไม่อนุญาต */ }
    }
    // รหัสไฟล์เดิมใช้ต่อได้เฉพาะตอนผู้ดูแลย้ายข้อมูลจากโหมดทดลอง (ให้เรื่องขออนุมัติอ้างถึงไฟล์ได้ถูกต้อง)
    var id = b.fileId && me.isAdmin && /^[\w-]{4,60}$/.test(b.fileId) && !findById_('Files', b.fileId) ? b.fileId : newId_('F');
    var rec = {
      id: id, projectId: p.id, category: category, name: file.getName(), mime: file.getMimeType(),
      size: file.getSize(), driveId: file.getId(), url: file.getUrl(), note: b.note || '', updateId: b.updateId || '',
      subId: b.subId || '', uploadedBy: me.name, uploadedByEmail: me.email, uploadedAt: nowIso_(),
    };
    upsert_('Files', rec);
    return rec;
  },

  addLink: function (b, ctx) {
    var p = requireProject_(b.projectId);
    need_(p, ctx.me, 'uploadDocs', 'คุณไม่มีสิทธิ์เพิ่มเอกสารในคลังของโครงการนี้');
    if (!/^https?:\/\//i.test(b.url || '')) fail_('ลิงก์ไม่ถูกต้อง');
    var rec = {
      id: newId_('F'), projectId: b.projectId, category: b.category || 'อื่นๆ', name: b.name || b.url, mime: 'link',
      size: 0, driveId: '', url: b.url, note: b.note || '', updateId: '', subId: '',
      uploadedBy: ctx.me.name, uploadedByEmail: ctx.me.email, uploadedAt: nowIso_(),
    };
    upsert_('Files', rec);
    return rec;
  },

  updateFile: function (b, ctx) {
    var rec = findById_('Files', b.id);
    if (!rec) fail_('ไม่พบไฟล์');
    var p = requireProject_(rec.projectId);
    canEditFile_(rec, p, ctx.me);
    var ch = b.changes || {};
    if (rec.driveId) {
      try {
        var file = DriveApp.getFileById(rec.driveId);
        if (ch.name && ch.name !== rec.name) file.setName(ch.name);
        if (ch.category && ch.category !== rec.category) file.moveTo(categoryFolder_(p, ch.category));
        if (ch.note != null) file.setDescription(ch.note);
      } catch (e) {
        fail_('แก้ไขไฟล์ใน Drive ไม่ได้: ' + e.message);
      }
    }
    ['name', 'category', 'note'].forEach(function (k) { if (ch[k] != null) rec[k] = ch[k]; });
    upsert_('Files', rec);
    return rec;
  },

  deleteFile: function (b, ctx) {
    var rec = findById_('Files', b.id);
    if (!rec) return { id: b.id };
    canEditFile_(rec, requireProject_(rec.projectId), ctx.me);
    if (rec.driveId) {
      try { DriveApp.getFileById(rec.driveId).setTrashed(true); } catch (e) { /* ไฟล์อาจถูกลบไปแล้ว */ }
    }
    deleteWhere_('Files', function (r) { return r.id === b.id; });
    return { id: b.id };
  },

  /** เพิ่มไฟล์ที่ถูกวางไว้ในโฟลเดอร์ Drive ของโครงการโดยตรง (เช่น ไฟล์ใหญ่) เข้าระบบ */
  scanDrive: function (b, ctx) {
    var p = requireProject_(b.projectId);
    need_(p, ctx.me, 'uploadDocs', 'คุณไม่มีสิทธิ์จัดการคลังเอกสารของโครงการนี้');
    var root = projectFolder_(p);
    var known = {};
    readTable_('Files').forEach(function (f) { if (f.driveId) known[f.driveId] = true; });
    var added = [];
    // ชื่อโฟลเดอร์หมวดถูกแทน / ด้วย - ตอนสร้าง จึงจับคู่กลับเป็นชื่อหมวดเดิม
    var catByFolder = {};
    (p.docCategories || []).forEach(function (c) { catByFolder[String(c).replace(/[\\/]/g, '-')] = c; });
    var walk = function (folder, category, depth) {
      var files = folder.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        if (known[f.getId()] || f.isTrashed()) continue;
        added.push({
          id: newId_('F'), projectId: p.id, category: category, name: f.getName(), mime: f.getMimeType(),
          size: f.getSize(), driveId: f.getId(), url: f.getUrl(), note: f.getDescription() || '', updateId: '', subId: '',
          uploadedBy: ctx.me.name + ' (ดึงจาก Drive)', uploadedByEmail: ctx.me.email, uploadedAt: (f.getDateCreated() || new Date()).toISOString(),
        });
        known[f.getId()] = true;
      }
      if (depth > 3) return;
      var subs = folder.getFolders();
      while (subs.hasNext()) {
        var s = subs.next();
        walk(s, depth === 0 ? (catByFolder[s.getName()] || s.getName()) : category, depth + 1);
      }
    };
    walk(root, 'อื่นๆ', 0);
    if (added.length) appendRows_('Files', added);
    return added;
  },

  // ---------- เรื่องขออนุมัติ / แจ้งปัญหา ----------
  createSubmission: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var p = requireProject_(b.projectId);
    var input = b.input || {};
    var id = b.id && /^[\w-]{4,60}$/.test(b.id) && !findById_('Submissions', b.id) ? b.id : newId_('S');
    var files = ownFiles_(input.files, p.id, b.id || id);
    if (input.requiredId) {
      var req = findById_('Required', input.requiredId);
      if (!req || req.projectId !== p.id) input.requiredId = '';
    }
    var out = R.createSubmission(p, {
      id: id, category: input.category, title: input.title, detail: input.detail, requiredId: input.requiredId, files: files,
      vote: input.vote || null,
    }, me, nowIso_(), readTable_('Submissions'));
    upsert_('Submissions', out.sub);
    var mail = notifySub_(p, out.event, out.sub, me, b, ctx);
    return { sub: out.sub, event: out.event, mail: mail };
  },

  /** b.op = approve | reject | resubmit | cancel | comment | openVote | vote | closeVote */
  actSubmission: function (b, ctx) {
    var R = R_();
    var me = ctx.me;
    var cur = findById_('Submissions', b.id);
    if (!cur) fail_('ไม่พบเรื่องนี้ (อาจถูกลบไปแล้ว)');
    var p = requireProject_(cur.projectId);
    if (!R.canView(p, me)) forbid_();
    var files = ownFiles_(b.files, p.id, cur.id);
    var out = R.act(cur, p, me, b.op, {
      comment: b.comment, changes: b.changes || { comment: b.comment }, files: files, option: b.option, vote: b.vote || null,
    }, nowIso_());
    upsert_('Submissions', out.sub);
    var mail = notifySub_(p, out.event, out.sub, me, b, ctx);
    return { sub: out.sub, event: out.event, mail: mail };
  },

  saveRequired: function (b, ctx) {
    var R = R_();
    var p = requireProject_(b.projectId);
    need_(p, ctx.me, 'manageRequired', 'คุณไม่มีสิทธิ์กำหนดรายการเอกสารที่ต้องส่ง');
    var items = (b.items || []).map(function (r, i) {
      return {
        id: r.id || newId_('Q'), projectId: p.id, title: String(r.title || '').trim(), category: String(r.category || ''),
        dueType: R.DUE_TYPES[r.dueType] ? r.dueType : 'afterStart', dueDays: Math.max(0, Math.round(num_(r.dueDays))),
        dueDate: r.dueType === 'date' ? String(r.dueDate || '') : '', note: String(r.note || '').trim(), order: i + 1,
      };
    }).filter(function (r) { return r.title; });
    replaceWhere_('Required', function (r) { return r.projectId === p.id; }, items);
    return items;
  },

  // ---------- ตั้งค่ากลาง (ผู้ดูแลระบบ) ----------
  saveSettings: function (b, ctx) {
    if (!ctx.me.isAdmin) forbid_('เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนการตั้งค่ากลางได้');
    var s = b.settings || {};
    var rows = Object.keys(s).map(function (k) { return { key: k, value: s[k] }; });
    replaceWhere_('Settings', function () { return true; }, rows);
    return readSettings_();
  },

  /** นำเข้าข้อมูลทั้งชุด (ย้ายจากโหมดทดลอง / กู้คืนไฟล์สำรอง) — ผู้ดูแลระบบเท่านั้น */
  importAll: function (b, ctx) {
    if (!ctx.me.isAdmin) forbid_('เฉพาะผู้ดูแลระบบเท่านั้นที่นำเข้าข้อมูลได้');
    var d = b.data || {};
    var ids = {};
    var existing = {};
    readTable_('Projects').forEach(function (p) { existing[p.id] = p; });
    (d.projects || []).forEach(function (p) {
      var old = existing[p.id];
      var rec = Object.assign({}, p, { folderId: old ? old.folderId : '', folderUrl: old ? old.folderUrl : '' });
      if (!rec.ownerEmail && !old) { rec.ownerEmail = ctx.me.email; rec.ownerName = ctx.me.name; }
      var saved = saveProject_(rec, p.createdBy || ctx.me.name);
      ids[p.id] = saved.id;
    });
    mergeById_('BOQ', d.boq || []);
    mergeById_('Updates', d.updates || []);
    mergeById_('Files', (d.files || []).filter(function (f) { return f.driveId || f.mime === 'link'; }));
    mergeById_('Submissions', d.subs || []);
    mergeById_('Required', d.reqs || []);
    if (d.settings && Object.keys(d.settings).length) ACTIONS.saveSettings({ settings: Object.assign(readSettings_(), d.settings) }, ctx);
    return { projectIds: ids };
  },
};

// =============================================================
// ผู้ใช้และการเข้าสู่ระบบ
// =============================================================
function hash_(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return raw.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function otpCode_() {
  var hex = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var n = parseInt(hex.slice(0, 12), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

function session_(token) {
  if (!token || String(token).length < 20) return null;
  var props = PropertiesService.getScriptProperties();
  var k = 'sess_' + hash_(token);
  var raw = props.getProperty(k);
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  if (!s.exp || s.exp < Date.now()) { props.deleteProperty(k); return null; }
  // ต่ออายุเมื่อใช้งานเกินครึ่งอายุแล้ว
  if (s.exp - Date.now() < CONFIG.SESSION_DAYS * 864e5 / 2) {
    s.exp = Date.now() + CONFIG.SESSION_DAYS * 864e5;
    props.setProperty(k, JSON.stringify(s));
  }
  return s;
}

function cleanSessions_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

function scriptOwner_() {
  var e = prop_('OWNER_EMAIL');
  if (!e) {
    try { e = Session.getEffectiveUser().getEmail(); } catch (x) { e = ''; }
    if (e) setProp_('OWNER_EMAIL', e);
  }
  return R_().norm(e);
}

/** ข้อมูลผู้ใช้สำหรับตรวจสิทธิ์: { email, name, isAdmin, isExec, canCreate } */
function userCtx_(email, name, settings) {
  var R = R_();
  email = R.norm(email);
  settings = settings || {};
  var owner = scriptOwner_();
  var isAdmin = (!!owner && email === owner) || R.listHas(CONFIG.ADMIN_EMAILS, email) || R.listHas(settings.admins, email);
  var me = { email: email, name: name || email, isAdmin: !!isAdmin, isExec: R.listHas(settings.executives, email) };
  me.canCreate = R.canCreateProject(settings, me);
  return me;
}

/** ใครเข้าสู่ระบบได้: ผู้ดูแล ผู้บริหาร ผู้สร้างโครงการได้ และสมาชิกของโครงการใดก็ได้ */
function loginAllowed_(email, settings) {
  var R = R_();
  var me = userCtx_(email, '', settings);
  if (me.isAdmin || me.isExec) return true;
  var creators = R.parseList(settings.projectCreators);
  if (!creators.length || R.listHas(creators, email)) return true;
  return readTable_('Projects').some(function (p) { return !!R.roleOf(p, email); });
}

function findUser_(email) {
  var e = R_().norm(email);
  var rows = readTable_('Users');
  for (var i = 0; i < rows.length; i++) if (R_().norm(rows[i].email) === e) return rows[i];
  return null;
}

function nameFromProjects_(email) {
  var R = R_();
  var ps = readTable_('Projects');
  for (var i = 0; i < ps.length; i++) {
    var n = R.memberName(ps[i], email);
    if (n && n !== R.norm(email)) return n;
  }
  return '';
}

// =============================================================
// สมาชิก สิทธิ์ และขั้นตอนพิจารณา
// =============================================================
function cleanMembers_(list, ownerEmail) {
  var R = R_();
  var seen = {};
  var seats = {};
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (m) {
    var e = R.norm(m && m.email);
    if (!e) return;
    if (!R.validEmail(e)) fail_('อีเมล "' + e + '" ไม่ถูกต้อง');
    if (seen[e] || e === R.norm(ownerEmail)) return;
    seen[e] = true;
    var role = R.MEMBER_ROLES.indexOf(m.role) >= 0 ? m.role : 'viewer';
    var rec = { email: e, name: String(m.name || '').trim().slice(0, 120), role: role, notify: R.NOTIFY[m.notify] ? m.notify : R.DEFAULT_NOTIFY[role] };
    if (role === 'committee') {
      var st = seat_(m.seat);
      if (st !== '' && seats[st]) fail_('ลำดับกรรมการ "' + R.seatLabel(st) + '" ซ้ำกัน');
      if (st !== '') { seats[st] = true; rec.seat = st; }
    }
    out.push(rec);
  });
  return out;
}

/** ลำดับกรรมการ: 0 = ประธานกรรมการ, 1..9 = กรรมการลำดับที่ n — ค่าอื่นคืน '' */
function seat_(v) {
  if (v === '' || v == null || !isFinite(+v)) return '';
  var n = Math.round(+v);
  return n >= 0 && n <= R_().MAX_SEAT ? n : '';
}

function cleanRolePerms_(rp) {
  var R = R_();
  if (!rp || typeof rp !== 'object' || Array.isArray(rp)) return null;
  var out = {};
  R.MEMBER_ROLES.forEach(function (role) {
    if (Array.isArray(rp[role])) out[role] = rp[role].filter(function (k) { return R.PERM_KEYS.indexOf(k) >= 0; });
  });
  return Object.keys(out).length ? out : null;
}

function cleanWorkflow_(wf) {
  var R = R_();
  if (!Array.isArray(wf) || !wf.length) return [];
  var names = {};
  return wf.map(function (c) {
    var name = String((c && c.name) || '').trim().slice(0, 120);
    var steps = ((c && c.steps) || []).filter(function (s) { return s && R.ROLES[s.role]; }).slice(0, 6).map(function (s) {
      return { role: s.role, days: Math.max(1, Math.round(num_(s.days) || 7)), label: String(s.label || '').trim().slice(0, 80), mode: s.role === 'committee' && s.mode === 'any' ? 'any' : (s.role === 'committee' ? 'seq' : 'any') };
    });
    return { name: name, steps: steps };
  }).filter(function (c) {
    if (!c.name || !c.steps.length || names[c.name]) return false;
    names[c.name] = true;
    return true;
  });
}

/** หลังเจ้าของโครงการบันทึกสมาชิก: แชร์โฟลเดอร์ Drive และส่งอีเมลแจ้งการแต่งตั้ง */
function afterMembersChanged_(old, saved, me, b, ctx) {
  var R = R_();
  var before = {};
  R.members(old || {}).forEach(function (m) { before[m.email] = m; });
  var after = R.members(saved);
  var nowSet = {};
  after.forEach(function (m) { nowSet[m.email] = true; });
  var added = after.filter(function (m) { return m.role !== 'owner' && !before[m.email]; });
  var removed = Object.keys(before).filter(function (e) { return !nowSet[e] && before[e].role !== 'owner'; });
  shareFolder_(saved, added.map(function (m) { return m.email; }), removed);
  if (b.invite === false || !added.length) return null;
  var url = appUrl_(b, ctx.settings);
  return sendMails_(added.map(function (m) {
    return Object.assign({ to: [m.email], kind: 'invite', event: 'invite' }, R.inviteEmail(saved, m, me, url, 'gas'));
  }), { projectId: saved.id, replyTo: me.email });
}

function shareFolder_(p, add, remove) {
  if (!CONFIG.SHARE_DRIVE_WITH_MEMBERS || (!add.length && !remove.length)) return;
  var folder;
  try { folder = projectFolder_(p); } catch (e) { return; }
  add.forEach(function (e) { try { folder.addViewer(e); } catch (x) { /* อีเมลที่ไม่ใช่บัญชี Google แชร์ไม่ได้ */ } });
  remove.forEach(function (e) { try { folder.removeViewer(e); } catch (x) { /* ignore */ } });
}

function canEditFile_(rec, p, me) {
  var R = R_();
  if (rec.subId) { if (!R.isOwner(p, me)) forbid_('ไฟล์แนบของเรื่องขออนุมัติเก็บเป็นหลักฐาน — แก้ไขหรือลบได้เฉพาะเจ้าของโครงการ'); return; }
  need_(p, me, 'uploadDocs', 'คุณไม่มีสิทธิ์แก้ไขไฟล์ในคลังของโครงการนี้');
}

/** รับเฉพาะรหัสไฟล์ที่อยู่ในโครงการนี้ และแนบกับเรื่องนี้ */
function ownFiles_(ids, pid, subId) {
  if (!Array.isArray(ids) || !ids.length) return [];
  var byId = {};
  readTable_('Files').forEach(function (f) { byId[f.id] = f; });
  return ids.filter(function (id) { var f = byId[id]; return f && f.projectId === pid && (!f.subId || f.subId === subId); });
}

// =============================================================
// อีเมล
// =============================================================
function appUrl_(b, settings) {
  return CONFIG.APP_URL || (settings && settings.appUrl) || (b && b.appUrl) || prop_('LAST_APP_URL') || '';
}

function rememberAppUrl_(u) {
  if (!u || !/^https?:\/\//.test(u) || CONFIG.APP_URL) return;
  u = String(u).split('#')[0].slice(0, 300);
  if (prop_('LAST_APP_URL') !== u) setProp_('LAST_APP_URL', u);
}

function mailQuota_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return null; }
}

function notifySub_(p, event, sub, me, b, ctx) {
  var msgs = R_().mailPlan(p, event, sub, me, appUrl_(b, ctx.settings), ctx.settings);
  return sendMails_(msgs, { projectId: p.id, replyTo: me.email });
}

function htmlToText_(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<\/td>/gi, '  ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2: $1')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * ส่งอีเมล: ผู้ต้องดำเนินการได้รับฉบับเดียวกัน ส่วนผู้รับเพื่อทราบได้รับแยกรายคน (ไม่เห็นอีเมลกันและกัน)
 * คืน { sent, failed, to: [...] }
 */
function sendMails_(msgs, meta) {
  var res = { sent: 0, failed: 0, to: [], error: '' };
  if (!CONFIG.SEND_EMAIL) { res.disabled = true; return res; }
  var logs = [];
  (msgs || []).forEach(function (m) {
    if (!m || !m.to || !m.to.length) return;
    var batches = m.kind === 'info' ? m.to.map(function (e) { return [e]; }) : [m.to];
    batches.forEach(function (to) {
      var row = { at: nowIso_(), to: to.join(', '), subject: m.subject, event: m.event || '', projectId: (meta && meta.projectId) || '', ok: true, error: '' };
      try {
        var opt = { to: to.join(','), subject: m.subject, htmlBody: m.html, body: htmlToText_(m.html), name: CONFIG.MAIL_SENDER_NAME };
        if (meta && meta.replyTo && R_().validEmail(meta.replyTo)) opt.replyTo = meta.replyTo;
        MailApp.sendEmail(opt);
        res.sent += to.length;
        res.to = res.to.concat(to);
      } catch (e) {
        row.ok = false;
        row.error = String(e.message || e).slice(0, 300);
        res.failed += to.length;
        res.error = row.error;
      }
      logs.push(row);
    });
  });
  try { if (logs.length) appendRows_('MailLog', logs); } catch (e) { /* ignore */ }
  return res;
}

// =============================================================
// เตือนงานค้างรายวัน (ตั้งเวลาด้วย installTriggers)
// =============================================================
function dailyReminders() {
  var R = R_();
  var settings = readSettings_();
  var now = nowIso_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var url = appUrl_(null, settings);
  var subsAll = readTable_('Submissions');
  var reqsAll = readTable_('Required');
  var sent = 0;
  readTable_('Projects').forEach(function (p) {
    if (p.status === 'done' || p.status === 'cancelled') return;
    var subs = subsAll.filter(function (s) { return s.projectId === p.id; });
    var sla = R.slaSettings(p, settings);
    // เรื่องค้างพิจารณา: เตือนเมื่อครบ warn วัน, late วัน, เลยกำหนดวันแรก และทุก 7 วันหลังจากนั้น
    var byApprover = {};
    subs.forEach(function (s) {
      if (s.status !== 'pending') return;
      var st = R.subSla(s, p, settings, now);
      var age = Math.floor(st.age);
      var due = st.dueAt && st.overdue > 0 && st.overdue <= 1;
      var hit = age === sla.warn || age === sla.late || (age > sla.late && (age - sla.late) % 7 === 0) || due;
      if (!hit) return;
      R.currentApprovers(s, p).forEach(function (e) { (byApprover[e] = byApprover[e] || []).push(s); });
    });
    Object.keys(byApprover).forEach(function (e) {
      var m = R.reminderEmail(p, byApprover[e], [], url, settings, now);
      sent += sendMails_([Object.assign({ to: [e], kind: 'action', event: 'reminder' }, m)], { projectId: p.id }).sent;
    });
    // เอกสารที่ต้องส่ง: เตือนผู้รับจ้างก่อนครบกำหนด 7, 3, 1 วัน วันครบกำหนด และหลังเลยกำหนดทุก 7 วัน
    var due = [];
    reqsAll.filter(function (r) { return r.projectId === p.id; }).forEach(function (r) {
      var st = R.reqStatus(r, p, subs, today);
      if (!st.due || (st.state !== 'none' && st.state !== 'rejected')) return;
      var hit = [7, 3, 1, 0].indexOf(st.leftDays) >= 0 || st.overdueDays === 1 || (st.overdueDays > 1 && st.overdueDays % 7 === 0);
      if (hit) due.push({ req: r, st: st });
    });
    if (due.length) {
      var to = R.members(p).filter(function (m) { return m.role === 'contractor'; }).map(function (m) { return m.email; });
      if (to.length) {
        var m2 = R.reminderEmail(p, [], due, url, settings, now);
        sent += sendMails_([Object.assign({ to: to, kind: 'action', event: 'reminder' }, m2)], { projectId: p.id }).sent;
      }
    }
  });
  Logger.log('ส่งอีเมลเตือนงานค้าง ' + sent + ' ฉบับ');
  return sent;
}

/** ตั้งเวลาเตือนงานค้างทุกวัน (setup เรียกให้อัตโนมัติ) */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(CONFIG.REMINDER_HOUR).create();
  Logger.log('ตั้งเวลาเตือนงานค้างทุกวัน เวลาประมาณ ' + CONFIG.REMINDER_HOUR + ':00 น.');
}

// =============================================================
// โครงการและโฟลเดอร์
// =============================================================
function saveProject_(p, user) {
  if (!p.name) fail_('กรุณาระบุชื่อโครงการ');
  var now = nowIso_();
  var old = p.id ? findById_('Projects', p.id) : null;
  var rec = Object.assign({}, p, {
    id: p.id || newId_('P'),
    createdAt: old ? old.createdAt : (p.createdAt || now),
    createdBy: old ? old.createdBy : (p.createdBy || user || ''),
    updatedAt: now,
  });
  delete rec._mail;
  var folder = projectFolder_(rec);
  rec.folderId = folder.getId();
  rec.folderUrl = folder.getUrl();
  upsert_('Projects', rec);
  return rec;
}

function requireProject_(id) {
  var p = findById_('Projects', id);
  if (!p) fail_('ไม่พบโครงการ (อาจถูกลบไปแล้ว)');
  return p;
}

function rootFolder_() {
  var id = extractId_(CONFIG.ROOT_FOLDER_ID) || prop_('ROOT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {
      fail_('เปิดโฟลเดอร์หลักใน Google Drive ไม่ได้ — ตรวจสอบ ROOT_FOLDER_ID และสิทธิ์ของบัญชีที่ติดตั้ง');
    }
  }
  var f = DriveApp.createFolder('ระบบติดตามโครงการ - เอกสาร');
  setProp_('ROOT_FOLDER_ID', f.getId());
  return f;
}

function safeRootUrl_() {
  try { return rootFolder_().getUrl(); } catch (e) { return ''; }
}

function projectFolder_(p) {
  var id = extractId_(p.folderId || '');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {
      fail_('เปิดโฟลเดอร์ Google Drive ของโครงการไม่ได้ — ตรวจสอบลิงก์และสิทธิ์ของบัญชีที่ติดตั้งระบบ');
    }
  }
  var name = ((p.code ? p.code + ' ' : '') + (p.name || 'โครงการ')).replace(/[\\/]/g, '-').slice(0, 120);
  return rootFolder_().createFolder(name);
}

function categoryFolder_(p, category) {
  var parent = projectFolder_(p);
  var name = String(category || 'อื่นๆ').replace(/[\\/]/g, '-');
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// =============================================================
// ฐานข้อมูลบน Google Sheet
// =============================================================
function ss_() {
  var id = prop_('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var a = SpreadsheetApp.getActiveSpreadsheet();
  if (a) { setProp_('SHEET_ID', a.getId()); return a; }
  fail_('ยังไม่ได้ติดตั้งฐานข้อมูล — เปิด Apps Script แล้วรันฟังก์ชัน setup ก่อน');
}

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  var cols = SCHEMA[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#E7EAE5');
    sh.setFrozenRows(1);
    return sh;
  }
  // เพิ่มคอลัมน์ใหม่ที่ยังไม่มี (เมื่ออัปเดตเวอร์ชัน)
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    var start = head.filter(String).length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#E7EAE5');
  }
  return sh;
}

function header_(sh) {
  return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
}

function inList_(map, table, field) { return (map[table] || []).indexOf(field) >= 0; }

function toCell_(table, field, v) {
  if (v == null) return '';
  if (inList_(JSON_FIELDS, table, field)) {
    var j = JSON.stringify(v);
    if (j.length > 49000) fail_('ข้อมูล "' + field + '" ยาวเกินกว่าที่ Google Sheet เก็บได้ในช่องเดียว');
    return j;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v);
  // กันไม่ให้ Sheets แปลงข้อความที่หน้าตาเหมือนตัวเลข/วันที่ (เช่น ลำดับ "1.10" หรือวันที่) เป็นชนิดอื่น
  if (/^[\d\s.,:\/+\-]+$/.test(s) || /^(true|false)$/i.test(s) || /^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function fromCell_(table, field, v) {
  if (v instanceof Date) {
    return inList_(DATE_FIELDS, table, field)
      ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : v.toISOString();
  }
  if (inList_(JSON_FIELDS, table, field)) {
    var empty = field === 'entries' ? {} : (field === 'value' || field === 'rolePerms' || field === 'vote' ? null : []);
    if (v === '' || v == null) return empty;
    try { return JSON.parse(v); } catch (e) { return empty; }
  }
  if (inList_(NUM_FIELDS, table, field)) return v === '' || v == null ? '' : Number(v);
  if (inList_(BOOL_FIELDS, table, field)) return v === true || String(v).toLowerCase() === 'true';
  return v == null ? '' : String(v);
}

function readTable_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = header_(sh);
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' || vals[i][0] == null) continue;
    var o = {};
    for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = fromCell_(name, head[c], vals[i][c]);
    out.push(o);
  }
  return out;
}

function toRow_(name, head, obj) {
  return head.map(function (h) { return h ? toCell_(name, h, obj[h]) : ''; });
}

function writeAll_(name, objs) {
  var sh = sheet_(name);
  var head = header_(sh);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  if (objs.length) sh.getRange(2, 1, objs.length, head.length).setValues(objs.map(function (o) { return toRow_(name, head, o); }));
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var head = header_(sh);
  sh.getRange(sh.getLastRow() + 1, 1, objs.length, head.length).setValues(objs.map(function (o) { return toRow_(name, head, o); }));
}

function findById_(name, id) {
  if (!id) return null;
  var rows = readTable_(name);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

function upsert_(name, obj) { return upsertKey_(name, 'id', obj); }

function upsertKey_(name, key, obj) {
  var sh = sheet_(name);
  var head = header_(sh);
  var col = head.indexOf(key) + 1;
  var last = sh.getLastRow();
  if (last > 1 && col > 0) {
    var ids = sh.getRange(2, col, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(obj[key])) {
        sh.getRange(i + 2, 1, 1, head.length).setValues([toRow_(name, head, obj)]);
        return obj;
      }
    }
  }
  sh.getRange(last + 1, 1, 1, head.length).setValues([toRow_(name, head, obj)]);
  return obj;
}

function deleteWhere_(name, pred) {
  var rows = readTable_(name);
  var keep = rows.filter(function (r) { return !pred(r); });
  if (keep.length !== rows.length) writeAll_(name, keep);
}

function replaceWhere_(name, pred, newRows) {
  var rows = readTable_(name).filter(function (r) { return !pred(r); });
  writeAll_(name, rows.concat(newRows));
}

function mergeById_(name, incoming) {
  if (!incoming.length) return;
  var rows = readTable_(name);
  var idx = {};
  rows.forEach(function (r, i) { idx[r.id] = i; });
  incoming.forEach(function (r) {
    var clean = {};
    SCHEMA[name].forEach(function (k) { if (r[k] !== undefined) clean[k] = r[k]; });
    if (idx[clean.id] != null) rows[idx[clean.id]] = clean; else { idx[clean.id] = rows.length; rows.push(clean); }
  });
  writeAll_(name, rows);
}

function readSettings_() {
  var o = {};
  readTable_('Settings').forEach(function (r) { if (r.key) o[r.key] = r.value; });
  return o;
}

// =============================================================
// ตัวช่วย
// =============================================================
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function accessKey_() { return CONFIG.ACCESS_KEY || prop_('ACCESS_KEY') || ''; }
function num_(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
function newId_(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/** รับได้ทั้ง ID และลิงก์ Google Drive */
function extractId_(s) {
  s = String(s || '').trim();
  if (!s) return '';
  var m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

// =============================================================
// ติดตั้งครั้งแรก / อัปเดตเวอร์ชัน: เลือกฟังก์ชันนี้แล้วกด "เรียกใช้"
// =============================================================
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    ss = SpreadsheetApp.create('ระบบติดตามโครงการ - ฐานข้อมูล');
  }
  setProp_('SHEET_ID', ss.getId());
  Object.keys(SCHEMA).forEach(function (n) { sheet_(n); });
  var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);

  var root = rootFolder_();
  if (!accessKey_()) setProp_('ACCESS_KEY', 'PT-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase());
  var owner = '';
  try { owner = Session.getEffectiveUser().getEmail(); if (owner) setProp_('OWNER_EMAIL', owner); } catch (e) { /* ignore */ }
  var trig = 'ตั้งเวลาเตือนงานค้างรายวันแล้ว';
  try { installTriggers(); } catch (e) { trig = 'ตั้งเวลาเตือนงานค้างไม่สำเร็จ (' + e.message + ') — รันฟังก์ชัน installTriggers ภายหลัง'; }
  var quota = mailQuota_();

  var msg = [
    '================ ติดตั้งเรียบร้อย (เวอร์ชัน ' + VERSION + ') ================',
    'ฐานข้อมูล (Google Sheet): ' + ss.getUrl(),
    'โฟลเดอร์เก็บไฟล์ (Google Drive): ' + root.getUrl(),
    'รหัสเข้าใช้งาน (Access key): ' + accessKey_(),
    'ผู้ดูแลระบบ: ' + (owner || '(บัญชีที่ติดตั้ง)') + (CONFIG.ADMIN_EMAILS ? ', ' + CONFIG.ADMIN_EMAILS : ''),
    trig,
    'โควตาอีเมลคงเหลือวันนี้: ' + (quota == null ? '-' : quota),
    '',
    'ขั้นต่อไป: ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท: เว็บแอป',
    '  ดำเนินการในฐานะ: ฉัน | ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน',
    'แล้วนำ URL ของเว็บแอป (ลงท้าย /exec) และรหัสเข้าใช้งานไปใส่ในหน้า "ตั้งค่า" ของเว็บ',
    '(ถ้าอัปเดตจากเวอร์ชันเดิม: จัดการการทำให้ใช้งานได้ > แก้ไข > เวอร์ชันใหม่)',
    '==================================================',
  ].join('\n');
  Logger.log(msg);
  return msg;
}

/** เปลี่ยนรหัสเข้าใช้งานใหม่ (เมื่อรหัสหลุด) — ทุกคนต้องใส่รหัสใหม่ */
function resetAccessKey() {
  setProp_('ACCESS_KEY', 'PT-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase());
  Logger.log('รหัสเข้าใช้งานใหม่: ' + accessKey_() + (CONFIG.ACCESS_KEY ? ' (แต่ CONFIG.ACCESS_KEY ในโค้ดยังมีค่า ระบบจะใช้ค่าในโค้ดก่อน)' : ''));
}

/** ให้ทุกคนออกจากระบบ (เช่น เมื่อเครื่องสูญหาย) */
function logoutEveryone() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var n = 0;
  Object.keys(all).forEach(function (k) { if (k.indexOf('sess_') === 0) { props.deleteProperty(k); n++; } });
  Logger.log('ออกจากระบบทั้งหมด ' + n + ' รายการ');
}

// ===================== RULES BEGIN — คัดลอกจาก assets/js/rules.js (ห้ามแก้ตรงนี้ ให้แก้ที่ rules.js แล้วรัน tools/sync-rules.mjs) =====================
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
// ===================== RULES END =====================
