# สถาปัตยกรรมระบบ (สำหรับผู้พัฒนาต่อ)

## ภาพรวม

```
                                   ┌─ backends/gas.js ──▶ Apps Script Web App (Code.gs)
เบราว์เซอร์ (GitHub Pages)          │      text/plain JSON    ├─ Google Sheet : ตารางข้อมูล
index.html + assets/js ─ store.js ─┤                         └─ Google Drive : ไฟล์เอกสาร
localStorage / IndexedDB           │
(โหมดทดลอง และแคช)                 ├─ backends/sharepoint.js ─▶ Microsoft Graph (ด้วย token ของผู้ใช้)
                                   │    ms-auth.js (OAuth PKCE)   ├─ SharePoint List : PT_*
                                   │                              └─ Document Library : ไฟล์เอกสาร
                                   └─ backends/onedrive.js ───▶ Microsoft Graph
                                                                  ├─ OneDrive _data/*.json : ข้อมูล
                                                                  └─ OneDrive โฟลเดอร์โครงการ : ไฟล์เอกสาร
```

`store.js` เรียกตัวเชื่อม (backend) ผ่านชุดคำสั่งเดียวกัน: `getAll, saveProject, deleteProject, saveBoq,
saveUpdate, deleteUpdate, uploadFile, addLink, updateFile, deleteFile, scanDrive, saveSettings, importAll,
fileUrls, thumbUrl` และตั้งแต่ 1.0.1: `saveRequired` + เรื่องขออนุมัติ (Google: `createSubmission, actSubmission, transferOwner`;
SharePoint/OneDrive: `subsOfProject, getSub, saveSub, sendMail`; OneDrive เพิ่ม `shareRoot, isDriveOwner, rootRef`) — จะเพิ่มที่เก็บแบบอื่นก็เขียนไฟล์ใน `backends/` แล้วลงทะเบียนใน `BACKENDS`
(`store.direct` = ตัวเชื่อมที่หน้าเว็บเขียนข้อมูลเองตามกฎใน rules.js: SharePoint และ OneDrive)

## กฎกลาง: `assets/js/rules.js` (1.0.1, 1.0.2)

ไฟล์เดียวที่กำหนด **บทบาท สิทธิ์ ขั้นตอนพิจารณา ระยะเวลา (SLA) เอกสารที่ต้องส่ง ผู้รับอีเมล และรูปแบบอีเมล**
เขียนเป็น JavaScript แบบ ES5 ไม่มี import/export และกำหนดค่าให้ `globalThis.PTRules` เพื่อใช้ได้ 2 ที่

1. หน้าเว็บ — โหลดด้วย `<script src="assets/js/rules.js">` ก่อน `app.js`
2. Apps Script — คัดลอกไว้ท้าย `backend/Code.gs` ระหว่างบรรทัด `RULES BEGIN` / `RULES END`
   (แก้ที่ rules.js แล้วรัน `node tools/sync-rules.mjs` · ตรวจว่าตรงกัน `node tools/sync-rules.mjs --check`)

ฟังก์ชันหลัก: `can(project, user, perm)`, `canView`, `roleOf`, `approversFor`, `currentApprovers`, `createSubmission`,
`act(sub, project, actor, 'approve'|'reject'|'resubmit'|'cancel'|'comment'|'openVote'|'vote'|'closeVote', opts, nowIso)` (คืน `{ sub, event }` โดยไม่แก้ของเดิม),
`committeeSeats` (กรรมการเรียงลำดับพิจารณา), `tally`/`voters`/`voteChair`/`canVote`/`canCloseVote` (โหวต), `mailPlan` (อีเมลทั้งหมดของเหตุการณ์ — ใช้ทั้งหน้าเว็บและ Code.gs),
`subSla` (อายุ/กำหนด/สี), `reqStatus` (เอกสารที่ต้องส่ง), `recipients(project, event, sub, actorEmail)` → `{ action, info }`, `subEmail`, `progressEmail`, `inviteEmail`, `reminderEmail`

ผู้ใช้ (`user`) = `{ email, name, isAdmin, isExec }` · สิทธิ์ (`perm`) = `editProject, editBoq, recordProgress, uploadDocs, submit, approve, manageRequired`
และสิทธิ์พิเศษ `view, manageMembers (เจ้าของเท่านั้น), transferOwner, deleteProject (เจ้าของหรือผู้ดูแลระบบ)`

### ข้อมูลที่เพิ่มในโครงการ

| ฟิลด์ | ความหมาย |
|---|---|
| ownerEmail, ownerName | เจ้าของโครงการ (ผู้สร้าง) — ว่าง = โครงการเก่า ผู้ดูแลระบบทำหน้าที่แทน |
| ownerRole | เจ้าของทำหน้าที่ใดในงาน: supervisor (ค่าเริ่มต้น) · committee · head · none |
| members[] | `{ email, name, role, notify, seat }` — role: supervisor/committee/contractor/head/viewer · notify: all/decisions/mine/none · seat (เฉพาะกรรมการ): 1..9 = กรรมการลำดับที่ n, 0 = ประธานกรรมการ (ไม่กำหนด = ลำดับว่างถัดไปตามลำดับรายชื่อ เริ่มที่ประธาน) |
| ownerSeat | ลำดับกรรมการของเจ้าของ เมื่อ ownerRole = committee |
| rolePerms | `{ role: [perm…] }` เฉพาะบทบาทที่ปรับจากค่าเริ่มต้น (null = ค่าเริ่มต้น) |
| workflow[] | `{ name, steps: [{ role, days, label, mode }] }` หมวดเรื่องและขั้นตอนพิจารณา ([] = ค่าเริ่มต้น 7 หมวด) · mode ของขั้นคณะกรรมการ: `seq` (ค่าเริ่มต้น — แตกเป็นขั้นละ 1 คน: ลำดับ 1 → 2 → … → ประธาน, days = วันต่อคน) หรือ `any` |
| slaWarnDays, slaLateDays | เกณฑ์สีเหลือง/แดงรายโครงการ (ว่าง = ค่ากลาง) |

BOQ เพิ่ม `ps`, `pe` = วันที่เริ่ม/จบตามแผน นับเป็นวันที่ของสัญญา (วันที่ 1 = startDate)

### เรื่องขออนุมัติ (Submissions)

`id, projectId, no (เลขเรื่องในโครงการ), rev (ครั้งที่ส่ง), category, title, detail, requiredId, files[fileId], submittedBy, submittedByName,
submittedAt, status (pending/approved/rejected/cancelled), currentStep, stepStartedAt, steps[{ role, days, label, status, by, byName, at, comment, startedAt }],
history[{ at, by, byName, action, step, comment, files, rev }], closedAt, updatedAt`

- ขั้นของกรรมการแบบเรียงลำดับเก็บ `steps[i].seat` — ผู้พิจารณาคำนวณจากสมาชิกที่อยู่ในลำดับนั้น ณ ปัจจุบัน (เปลี่ยนตัวกรรมการได้ระหว่างทาง) ไม่มีผู้ใดในลำดับนั้น = เจ้าของโครงการ
- `vote` (ถ้ามี) = `{ question, options[{ id, label, detail, fileId }], status: open|closed, openedBy, openedAt, ballots[{ by, byName, seat, option, at, comment }], result, closedAt, closedBy, closeReason: majority|chair|casting|manual }`
  ปิดอัตโนมัติเมื่อผู้มีสิทธิ์โหวตครบ (เสียงข้างมาก / เท่ากันใช้เสียงประธาน) · ระหว่างเปิดโหวต ขั้นคณะกรรมการและขั้นสุดท้ายอนุมัติไม่ได้ · เหตุการณ์อีเมล: `voteOpened`, `voteTie`, `voteClosed`
- ขั้นตอนถูก**คัดลอกไว้ในเรื่อง**ตอนส่ง (แก้ขั้นตอนของโครงการภายหลังไม่กระทบเรื่องที่ส่งไปแล้ว) ส่งใหม่หลังไม่ผ่าน = เริ่มขั้นที่ 1 ด้วยขั้นตอนปัจจุบัน
- อายุของเรื่องนับจาก `stepStartedAt` (วันที่ได้รับในขั้นปัจจุบัน) · ไฟล์แนบอัปโหลดก่อนแล้วอ้างถึงด้วย `Files.subId`

### เอกสารที่ต้องส่ง (Required)

`id, projectId, title, category, dueType (afterStart/beforeEnd/afterEnd/date), dueDays, dueDate, note, order` — สถานะคำนวณจากเรื่องที่ `requiredId` ตรงกัน (นับวันส่งครั้งแรก)

## ตัวเชื่อม Google (Apps Script)

- หน้าเว็บเป็น static ล้วน (HTML/CSS/JS แบบ ES module ไม่มีขั้นตอน build) วางบน GitHub Pages ได้ทันที
- เรียก API ด้วย `Content-Type: text/plain` เพื่อให้เป็น *simple request* เพราะ Apps Script ไม่ตอบ CORS preflight
- ทุกคำขอแนบ `key` (รหัสเข้าใช้งาน), `token` (เซสชันจากการยืนยัน OTP) และ `appUrl` (ใช้สร้างลิงก์ในอีเมลเมื่อไม่ได้ตั้ง `APP_URL`)
- **เข้าสู่ระบบ:** `requestOtp(email)` → ส่งรหัส 6 หลักด้วย MailApp (เก็บ hash ใน CacheService 10 นาที, จำกัด 5 ครั้ง/ชม./อีเมล, ผิดได้ 5 ครั้ง)
  → `verifyOtp(email, code, name)` → คืน `token` (เก็บ hash ของ token ใน Script Properties `sess_*` อายุ 30 วัน ต่ออายุอัตโนมัติ) และ `me`
- **ผู้ดูแลระบบ** = เจ้าของสคริปต์ + `CONFIG.ADMIN_EMAILS` + `settings.admins` · ผู้เข้าระบบได้ = ผู้ดูแล ผู้บริหาร ผู้สร้างโครงการได้ และสมาชิกของโครงการใดก็ได้
- ทุกคำสั่งตรวจสิทธิ์ด้วย `PTRules.can()` ที่เซิร์ฟเวอร์ · `getAll` คืนเฉพาะโครงการที่ `canView` (และ BOQ/ไฟล์/เรื่องของโครงการนั้น) พร้อม `meta.me`
- อีเมล: ผู้ต้องดำเนินการได้รับฉบับเดียวกัน ผู้รับเพื่อทราบได้รับแยกรายคน · `replyTo` = ผู้ทำรายการ · บันทึกทุกฉบับในชีต `MailLog`
- `dailyReminders` (ตั้งเวลาด้วย `installTriggers` ซึ่ง `setup` เรียกให้) เตือนเรื่องที่ค้างครบเกณฑ์เหลือง/แดง เลยกำหนด และทุก 7 วันหลังจากนั้น และเตือนผู้รับจ้างก่อนครบกำหนดส่งเอกสาร 7/3/1/0 วัน
- คำสั่งที่เขียนข้อมูลใช้ `LockService` กันการเขียนชนกันเมื่อหลายคนบันทึกพร้อมกัน
- ที่เก็บออนไลน์ทั้งสองแบบแคชข้อมูลล่าสุดไว้ใน localStorage และดึงใหม่อัตโนมัติเมื่อกลับมาที่แท็บ (ทุก 2 นาทีขึ้นไป)

### ตารางข้อมูล (ชีตใน Google Sheet)

| ชีต | คอลัมน์ |
|---|---|
| Projects | id, code, name, type, tags[], status, owner, manager, contractor, contractNo, location, startDate, endDate, contractValue, description, progressMethod, priceBasis, allowOver, planMode, planPoints[], docCategories[], folderId, folderUrl, createdBy, createdAt, updatedAt |
| BOQ | id, projectId, group, no, desc, unit, qty, mat, labor, weight, order |
| Updates | id, projectId, date, week, entries{boqId: ปริมาณที่ทำได้ครั้งนี้}, manualPct, note, issues, createdBy, createdAt, updatedAt |
| Files | id, projectId, category, name, mime, size, driveId, url, note, updateId, uploadedBy, uploadedAt, subId, uploadedByEmail |
| Submissions | id, projectId, no, rev, category, title, detail, requiredId, files[], submittedBy, submittedByName, submittedAt, status, currentStep, stepStartedAt, steps[], history[], closedAt, updatedAt |
| Required | id, projectId, title, category, dueType, dueDays, dueDate, note, order |
| Settings | key, value (JSON) |
| Users | email, name, lastLoginAt, createdAt |
| MailLog | at, to, subject, event, projectId, ok, error |

Projects เพิ่ม `ownerEmail, ownerName, ownerRole, members[], rolePerms{}, workflow[], slaWarnDays, slaLateDays` · BOQ เพิ่ม `ps, pe` · Updates เพิ่ม `createdByEmail`

- ค่าที่เป็นอาร์เรย์/อ็อบเจกต์เก็บเป็นข้อความ JSON
- ข้อความที่หน้าตาเหมือนตัวเลขหรือวันที่ (เช่น ลำดับ `1.10`, วันที่ `2026-10-28`) ถูกเติม `'` นำหน้าเพื่อไม่ให้ Sheets แปลงชนิด
- `Updates.entries` เก็บปริมาณ **เฉพาะของครั้งนั้น** ยอดสะสม = ผลรวมของทุกครั้งจนถึงวันที่ที่ดู

### โครงสร้างโฟลเดอร์ใน Drive

```
<ROOT_FOLDER>/
└── <รหัส> <ชื่อโครงการ>/        ← Projects.folderId (เปลี่ยนเป็นโฟลเดอร์อื่นได้ที่แท็บตั้งค่าโครงการ)
    ├── สัญญาและเอกสารจัดจ้าง/
    ├── แบบก่อสร้าง/
    ├── รูปถ่ายความคืบหน้า/
    └── …                        ← ชื่อหมวดเอกสาร (สร้างเมื่อมีไฟล์แรก)
```

### คำสั่ง API (`action`)

| action | ข้อมูลที่ส่ง | คืนค่า |
|---|---|---|
| ping | – | version, maxUploadMB, auth |
| requestOtp / verifyOtp / logout / updateMe | email / email, code, name / – / name | – / token, me / – / me |
| getAll | – | projects, boq, updates, files, subs, reqs, settings, meta{ me, mailQuota … } (เฉพาะโครงการที่มีสิทธิ์) |
| transferOwner | projectId, email | project |
| createSubmission | projectId, id, input{ category, title, detail, requiredId, files[] } | { sub, event, mail } |
| actSubmission | id, op (approve/reject/resubmit/cancel/comment), comment, changes, files[] | { sub, event, mail } |
| saveRequired | projectId, items[] | items (แทนที่ทั้งชุดของโครงการ) |
| saveProject | project | project (สร้างโฟลเดอร์ Drive ถ้ายังไม่มี) |
| deleteProject | id | – (ไฟล์ใน Drive ไม่ถูกลบ) |
| saveBoq | projectId, items[] | items (แทนที่ BOQ ทั้งชุดของโครงการ) |
| saveUpdate / deleteUpdate | update / id | update |
| uploadFile | projectId, category, name, mime, base64, note, updateId | file |
| addLink | projectId, category, name, url, note | file |
| updateFile | id, changes{name, category, note} | file (เปลี่ยนชื่อ/ย้ายโฟลเดอร์ใน Drive ด้วย) |
| deleteFile | id | – (ย้ายไฟล์ไปถังขยะ) |
| scanDrive | projectId | ไฟล์ใหม่ที่พบในโฟลเดอร์ Drive |
| saveSettings | settings | settings |
| importAll | data{projects, boq, updates, files, settings} | projectIds (ใช้ย้ายจากโหมดทดลอง/กู้คืนไฟล์สำรอง) |

## ตัวเชื่อม SharePoint (Microsoft Graph)

- **ลงชื่อเข้าใช้** (`ms-auth.js`): OAuth 2.0 Authorization Code + PKCE ผ่านหน้าต่าง pop-up → `auth.html` ส่งผลกลับด้วย BroadcastChannel / postMessage / localStorage
  แล้วแลก code เป็น token ที่ `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (ต้องลงทะเบียน Redirect URI แบบ SPA)
  refresh token ของ SPA ใช้ได้ 24 ชม. หลังจากนั้นระบบแสดงกล่องให้กดลงชื่อเข้าใช้ใหม่ — token เก็บใน localStorage ของเบราว์เซอร์
- **สิทธิ์ที่ขอ**: `Sites.ReadWrite.All` (ประจำ) และ `Sites.Manage.All` เฉพาะตอนสร้างรายการครั้งแรก หรือ `Sites.Selected` ถ้าองค์กรจำกัดรายไซต์
- **ฐานข้อมูล**: List `PT_Projects`, `PT_BOQ`, `PT_Updates`, `PT_Files`, `PT_Settings` (+ `PT_Submissions`, `PT_Required` ตั้งแต่ 1.0.1 — ถ้าไซต์ยังไม่มี ส่วนเดิมยังใช้ได้และหน้าตั้งค่ามีปุ่มอัปเดตโครงสร้าง) แต่ละแถวมีคอลัมน์
  `Title` (ชื่อที่คนอ่านได้), `RecId` (รหัสในระบบ, index), `ProjectId` (index), `Data` (ระเบียนเต็มเป็น JSON, หลายบรรทัด)
- **การเขียนหลายแถว** (บันทึก BOQ, ลบโครงการ, ย้ายข้อมูล) ใช้ `$batch` ครั้งละ 20 คำสั่ง เปรียบเทียบกับของเดิมแล้วส่งเฉพาะแถวที่เปลี่ยน และลองใหม่อัตโนมัติเมื่อเจอ 429/503
- **ไฟล์**: `<คลังเอกสารของไซต์>/<โฟลเดอร์หลัก>/<รหัส ชื่อโครงการ>/<หมวด>/` · ไม่เกิน 60 MB อัปโหลดครั้งเดียว (`PUT …/content`)
  ใหญ่กว่านั้นใช้ upload session ส่งเป็นช่วงละ 6.25 MiB · `Files.driveId` = id ของไฟล์, `Files.spDrive` = id ของคลังเอกสาร
  · `Projects.folderId` เก็บเป็น `<driveId>|<itemId>` · ดูตัวอย่างไฟล์ใช้ `POST /drives/{d}/items/{i}/preview`

## ตัวเชื่อม OneDrive (Microsoft Graph) — 1.0.2

- **ที่เก็บ**: โฟลเดอร์หลักใน OneDrive ของผู้ดูแล (`/me/drive/root:/<ชื่อ>`) หรือโฟลเดอร์ที่ถูกแชร์มา (ระบุด้วย `driveId`+`itemId` จากลิงก์เชิญ หรือ URL ผ่าน `/shares/{u!…}`)
- **ข้อมูล**: `_data/settings.json` และ `_data/project-<id>.json` = `{ v, project, boq[], updates[], files[], subs[], reqs[] }` · `getAll` อ่านรายการไฟล์ใน `_data` แล้วดาวน์โหลดเฉพาะไฟล์ที่ eTag เปลี่ยน (ผ่าน `@microsoft.graph.downloadUrl` ไม่ส่ง token)
- **การเขียน**: `mutate(pid, fn)` = อ่านไฟล์ล่าสุด → แก้ → `PUT …:/content` พร้อม `If-Match: <eTag>` (ไฟล์ใหม่ใช้ `conflictBehavior=fail`) ถ้าได้ 412/409 อ่านใหม่และทำซ้ำสูงสุด 6 ครั้ง
  `saveSub(sub, { prev })` ปฏิเสธถ้าเรื่องถูกผู้อื่นเปลี่ยนหลังจากที่ตรวจสิทธิ์ (updatedAt ไม่ตรง) · เลขเรื่องซ้ำ → คำนวณใหม่ในไฟล์ล่าสุด
- **สิทธิ์**: เจ้าของโฟลเดอร์ใช้ `Files.ReadWrite` · ผู้ที่เปิดโฟลเดอร์ของผู้อื่นใช้ `Files.ReadWrite.All` (+ `Mail.Send` ถ้าเปิดอีเมล) · ผู้ดูแลระบบ = เจ้าของ drive ที่เก็บโฟลเดอร์ + `settings.admins`
  `shareRoot([{ email, write }])` → `POST /drives/{d}/items/{root}/invite` (`requireSignIn: true`, roles `write`/`read`)
- **ไฟล์เอกสาร**: เหมือน SharePoint (`Files.driveId` = item id, `Files.spDrive` = drive id, `Projects.folderId` = `<driveId>|<itemId>`)
- `ms-auth.js` เก็บ token แยกตาม `tenant|clientId` (localStorage `pt.msauth.v1` = `{ key: token }`) — SharePoint และ OneDrive ใช้คนละแอปได้โดยไม่ลบ token ของกันและกัน และตัวเชื่อมเรียก `reset()` ก่อนทุกคำขอ

## ไฟล์ฝั่งหน้าเว็บ

| ไฟล์ | หน้าที่ |
|---|---|
| `app.js` | สร้างเมนู, hash router (`#/`, `#/inbox`, `#/projects`, `#/p/:id/:tab/:sub`, `#/summary`, `#/settings`, `#/connect?…`), เข้าสู่ระบบ (Google OTP), ตัวเลขงานค้างบนเมนู, กันออกจากหน้าที่ยังไม่บันทึก |
| `rules.js` | กฎกลาง (สิทธิ์ ขั้นตอนพิจารณา SLA อีเมล) ใช้ร่วมกับ Code.gs |
| `store.js` | อ่าน/เขียนข้อมูล ตรวจสิทธิ์ก่อนส่ง (`store.me`, `store.can()`), สร้าง/ส่งอีเมลสำหรับ SharePoint และโหมดทดลอง (Google ให้เซิร์ฟเวอร์ส่ง), แคชผลวิเคราะห์ |
| `config.js` | ค่าตั้งค่าของเครื่องนี้ (โหมด, URL, ค่า SharePoint/OneDrive (`conf.sp`, `conf.od`), ชื่อผู้ใช้, ธีม) |
| `backends/*.js` | ตัวเชื่อม Google / SharePoint / OneDrive และการลงชื่อเข้าใช้ Microsoft |
| `calc.js` | สูตรทั้งหมด (ไม่มีการเข้าถึงหน้าจอ ทดสอบแยกได้) |
| `charts.js` | วาด S-Curve เป็น SVG ตามขนาดจริงของกล่อง |
| `views/*.js` | หน้าจอแต่ละหน้า — สร้าง HTML ด้วย template string และ escape ข้อความผู้ใช้ด้วย `esc()` เสมอ · 1.0.1: `tab-members` (สมาชิก/สิทธิ์/ขั้นตอน), `tab-subs` (เรื่องขออนุมัติ เอกสารที่ต้องส่ง), `tab-plan` (Gantt), `inbox` (งานของฉัน), `login` (OTP) · 1.0.2: `vote` (แก้ไขตัวเลือก/แผงผลโหวต), `help` (คู่มือ `#/help`) |

เส้นทางของเรื่องขออนุมัติ: `#/p/:id/subs` · `#/p/:id/subs/new?req=<requiredId>` · `#/p/:id/subs/<subId>` (ลิงก์ในอีเมล) · `#/p/:id/subs/required` · แผนงาน `#/p/:id/boq/plan`

## แนวทางพัฒนาต่อ

- เพิ่มฟิลด์ในโครงการ: เพิ่มชื่อคอลัมน์ใน `SCHEMA.Projects` (Code.gs) — ชีตเดิมจะได้คอลัมน์ใหม่อัตโนมัติ แล้วเพิ่มช่องกรอกใน `views/project-form.js`
- เพิ่มวิธีคำนวณความคืบหน้า: เพิ่มใน `METHODS` และ `progressFromCum()` ใน `calc.js`
- ถ้าข้อมูลโตมาก (หลายหมื่นแถว) ควรเปลี่ยน `getAll` เป็นโหลดรายโครงการ หรือเพิ่มตัวเชื่อมฐานข้อมูลอื่น (เช่น Supabase) เป็นไฟล์ใหม่ใน `backends/`
