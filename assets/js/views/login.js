// เข้าสู่ระบบ (Google Apps Script): ใส่อีเมล → รับรหัส 6 หลักทางอีเมล → ยืนยัน
import { conf, saveConf } from '../config.js';
import { gasBackend } from '../backends/gas.js';
import { esc, icon, openModal, setBusy, toast } from '../ui.js';

let open = null;

/** เปิดหน้าต่างเข้าสู่ระบบ — คืน Promise ที่สำเร็จเมื่อเข้าสู่ระบบแล้ว */
export function openLogin({ reason = '' } = {}) {
  if (open) return open;
  open = new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: 'เข้าสู่ระบบ',
      size: 'sm',
      dismissable: false,
      onClose: () => {
        if (done) return;
        clearInterval(timer);
        open = null;
        window.dispatchEvent(new Event('pt:login-cancel'));
      },
      body: `<div class="login" id="lg">
        <div class="login-head">${icon('lock')}<div><b>ยืนยันตัวตนด้วยอีเมล</b><span>ระบบใช้อีเมลเพื่อรู้ว่าคุณมีสิทธิ์อะไรในแต่ละโครงการ ไม่ต้องมีรหัสผ่าน</span></div></div>
        ${reason ? `<p class="notice notice-warn">${esc(reason)}</p>` : ''}
        <form id="lg-1" novalidate>
          <label class="field"><span>อีเมลของคุณ</span><input type="email" name="email" value="${esc(conf.email)}" placeholder="name@egat.co.th" autocomplete="email" required autofocus></label>
          <label class="field"><span>ชื่อที่แสดง <small class="muted">(ครั้งแรกเท่านั้น)</small></span><input name="name" value="${esc(conf.user)}" placeholder="เช่น นายสมชาย ใจดี" autocomplete="name"></label>
          <button class="btn btn-primary btn-block" type="submit">${icon('mail')}ส่งรหัสเข้าสู่ระบบทางอีเมล</button>
        </form>
        <form id="lg-2" novalidate hidden>
          <p class="login-sent">ส่งรหัส 6 หลักไปที่ <b id="lg-to"></b> แล้ว<br><small class="muted">ตรวจในกล่องจดหมาย (หรือจดหมายขยะ) รหัสใช้ได้ 10 นาที</small></p>
          <label class="field"><span>รหัสยืนยัน</span><input class="otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required></label>
          <button class="btn btn-primary btn-block" type="submit">${icon('check')}เข้าสู่ระบบ</button>
          <div class="login-links"><button type="button" class="btn btn-ghost btn-sm" data-act="back">${icon('chevL')}เปลี่ยนอีเมล</button><button type="button" class="btn btn-ghost btn-sm" data-act="resend">ส่งรหัสอีกครั้ง</button></div>
        </form>
        <p class="hint login-foot">${icon('database')}เชื่อมต่อกับ Google Drive ของทีม · <a class="link" href="#/settings" data-act="settings">เปลี่ยนการเชื่อมต่อ</a></p>
      </div>`,
    });
    const f1 = m.el.querySelector('#lg-1');
    const f2 = m.el.querySelector('#lg-2');
    let email = '';
    let cooldown = 0;
    var timer = null; // eslint-disable-line no-var
    const resendBtn = m.el.querySelector('[data-act="resend"]');
    const tick = () => {
      cooldown--;
      resendBtn.disabled = cooldown > 0;
      resendBtn.textContent = cooldown > 0 ? `ส่งรหัสอีกครั้ง (${cooldown})` : 'ส่งรหัสอีกครั้ง';
      if (cooldown <= 0) clearInterval(timer);
    };
    const send = async (btn) => {
      setBusy(btn, true, 'กำลังส่งรหัส…');
      try {
        await gasBackend.requestOtp(email);
        m.el.querySelector('#lg-to').textContent = email;
        f1.hidden = true; f2.hidden = false;
        f2.elements.code.value = '';
        f2.elements.code.focus();
        cooldown = 60; clearInterval(timer); timer = setInterval(tick, 1000); tick();
      } catch (e) {
        toast(e.message, 'bad', 8000);
      } finally { setBusy(btn, false); }
    };
    f1.addEventListener('submit', (e) => {
      e.preventDefault();
      email = f1.elements.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('อีเมลไม่ถูกต้อง', 'bad'); f1.elements.email.focus(); return; }
      conf.email = email;
      if (f1.elements.name.value.trim()) conf.user = f1.elements.name.value.trim();
      saveConf();
      send(f1.querySelector('[type="submit"]'));
    });
    resendBtn.addEventListener('click', () => send(resendBtn));
    m.el.querySelector('[data-act="back"]').addEventListener('click', () => { f2.hidden = true; f1.hidden = false; f1.elements.email.focus(); });
    const code = f2.elements.code;
    code.addEventListener('input', () => {
      code.value = code.value.replace(/\D/g, '').slice(0, 6);
      if (code.value.length === 6) f2.requestSubmit();
    });
    f2.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (code.value.length !== 6) { toast('กรอกรหัส 6 หลัก', 'bad'); return; }
      const btn = f2.querySelector('[type="submit"]');
      setBusy(btn, true, 'กำลังตรวจรหัส…');
      try {
        const r = await gasBackend.verifyOtp(email, code.value, f1.elements.name.value.trim());
        clearInterval(timer);
        done = true;
        m.close();
        open = null;
        toast(`ยินดีต้อนรับ ${r.me?.name || email}`);
        resolve(r);
      } catch (ex) {
        toast(ex.message, 'bad', 7000);
        setBusy(btn, false);
        if (ex.code === 'otp_expired') { f2.hidden = true; f1.hidden = false; }
        else { code.value = ''; code.focus(); }
      }
    });
    m.el.querySelector('[data-act="settings"]').addEventListener('click', () => { clearInterval(timer); done = true; m.close(); open = null; });
  });
  return open;
}
