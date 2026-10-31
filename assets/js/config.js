// ค่าตั้งค่าของเครื่องนี้ (เก็บใน localStorage)
export function readJSON(k, fallback = null) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
}

const K_CONF = 'pt.conf.v1';

/**
 * mode: 'local' (โหมดทดลอง) | 'gas' (Google Drive ผ่าน Apps Script) | 'sharepoint' (Microsoft 365) | 'onedrive' (OneDrive)
 * sp: { tenant, clientId, site, folder, scopeMode: 'all' | 'selected' }
 */
export const conf = Object.assign(
  {
    mode: 'local', url: '', key: '', user: '', email: '', theme: 'auto', onboarded: false,
    // token: รหัสเข้าสู่ระบบของ Google (ได้จากการยืนยันรหัส OTP ทางอีเมล)
    // actAs: (เฉพาะโหมดทดลอง) สลับเป็นผู้ใช้อื่นเพื่อทดสอบสิทธิ์
    token: '', actAs: '',
    sp: { tenant: '', clientId: '', site: '', folder: 'ProjectTracker', scopeMode: 'all', mail: false },
    od: { tenant: 'organizations', clientId: '', folder: 'ProjectTracker', driveId: '', itemId: '', mail: false },
  },
  readJSON(K_CONF, {}),
);
if (conf.mode === 'cloud') conf.mode = 'gas'; // ค่าจากเวอร์ชันแรก
conf.sp = { tenant: '', clientId: '', site: '', folder: 'ProjectTracker', scopeMode: 'all', mail: false, ...(conf.sp || {}) };
conf.od = { tenant: 'organizations', clientId: '', folder: 'ProjectTracker', driveId: '', itemId: '', mail: false, ...(conf.od || {}) };

export function saveConf() { writeJSON(K_CONF, conf); }
