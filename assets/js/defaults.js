// ค่าเริ่มต้นของระบบ — แก้ไขได้จากหน้า "ตั้งค่า" ในแอป

export const APP_VERSION = '1.0.2';

/** หมวดในคลังเอกสารสำหรับไฟล์แนบของเรื่องขออนุมัติ */
export const SUB_FILE_CATEGORY = 'เอกสารแนบเรื่องขออนุมัติ';

export const DEFAULT_DOC_CATEGORIES = [
  'สัญญาและเอกสารจัดจ้าง',
  'แบบก่อสร้าง',
  'BOQ / ปร.4 / ปร.5',
  'รายงานประจำวัน/สัปดาห์',
  'รูปถ่ายความคืบหน้า',
  'หนังสือ/บันทึกข้อความ',
  'ผลทดสอบวัสดุ',
  'เอกสารตรวจรับงาน',
  'เอกสารเบิกจ่าย',
  'อื่นๆ',
];

export const DEFAULT_PROJECT_TYPES = [
  'อาคาร',
  'ถนน/ลานจอด',
  'ระบบสาธารณูปโภค',
  'งานโครงสร้างพิเศษ',
  'งานซ่อมแซม/ปรับปรุง',
  'อื่นๆ',
];

export const PROJECT_STATUS = {
  planning: 'เตรียมการ',
  active: 'กำลังดำเนินการ',
  paused: 'หยุดชั่วคราว',
  done: 'แล้วเสร็จ',
  cancelled: 'ยกเลิก',
};

export const DEFAULT_SETTINGS = {
  orgName: '',
  projectTypes: DEFAULT_PROJECT_TYPES,
  docCategories: DEFAULT_DOC_CATEGORIES,
  watchThreshold: 2,   // ต่างจากแผนเกินกี่ % ถือว่า "เฝ้าระวัง"
  behindThreshold: 5,  // ต่างจากแผนเกินกี่ % ถือว่า "ล่าช้ากว่าแผน"
  staleDays: 14,       // ไม่ได้อัปเดตเกินกี่วันให้แจ้งเตือน
  // ---------- ผู้ใช้และสิทธิ์ (1.0.1) ----------
  admins: '',          // อีเมลผู้ดูแลระบบ (คั่นด้วยจุลภาค) — ดูและแก้ได้ทุกโครงการ เปลี่ยนการตั้งค่ากลางได้
  executives: '',      // อีเมลผู้บริหาร — ดูได้ทุกโครงการ (อ่านอย่างเดียว)
  projectCreators: '', // อีเมลหรือโดเมน (@egat.co.th) ที่สร้างโครงการได้ — เว้นว่าง = ทุกคนที่เข้าระบบได้
  slaWarnDays: 7,      // เรื่องค้างพิจารณาเกินกี่วัน = สีเหลือง
  slaLateDays: 14,     // เรื่องค้างพิจารณาเกินกี่วัน = สีแดง
  appUrl: '',          // ลิงก์ของเว็บที่ใส่ในอีเมล (เว้นว่าง = ใช้ที่อยู่ปัจจุบัน)
  spMail: false,       // SharePoint: ส่งอีเมลแจ้งเตือนจากบัญชีผู้ใช้ผ่าน Microsoft Graph
};

export const PHOTO_CATEGORY_HINT = 'รูป';

export function newProject(settings) {
  return {
    id: '',
    code: '',
    name: '',
    type: settings.projectTypes[0] || '',
    tags: [],
    status: 'active',
    owner: '',
    manager: '',
    contractor: '',
    contractNo: '',
    location: '',
    startDate: '',
    endDate: '',
    contractValue: '',
    description: '',
    progressMethod: 'boq_value',
    priceBasis: 'total',
    allowOver: false,
    planMode: 'scurve',
    planPoints: [],
    docCategories: [...settings.docCategories],
    folderId: '',
    folderUrl: '',
    ownerEmail: '',
    ownerName: '',
    members: [],
  };
}
