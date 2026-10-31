// โหมดนำเสนอเต็มจอ: สไลด์ภาพรวม + สไลด์ละโครงการ
import { store } from '../store.js';
import { planSeries, actualSeries, groupBreakdown, todayISO, METHODS } from '../calc.js';
import { esc, fmt, icon, gauge, chip, moneyHTML, daysText, fileKind } from '../ui.js';
import { deltaHTML } from './common.js';
import { mountSCurve } from '../charts.js';

export function startPresentation(rows, pf) {
  const S = store.settings;
  const today = todayISO();
  const slides = [];

  slides.push({
    html: `<div class="sl sl-cover">
      <p class="sl-kicker">${esc(S.orgName || 'รายงานความคืบหน้าโครงการ')}</p>
      <h1>สรุปความคืบหน้าโครงการ</h1>
      <p class="sl-date">ข้อมูล ณ วันที่ ${fmt.dateLong(today)}</p>
      <div class="sl-cover-fig">
        <div><span>ผลงานรวม</span><b class="num">${fmt.pctNum(pf.actual)}<i>%</i></b><small>แผน ${fmt.pct(pf.plan)} ${deltaHTML(pf.diff)}</small></div>
        <div><span>จำนวนโครงการ</span><b class="num">${rows.length}</b><small>ล่าช้า ${pf.behind} <span class="sep"></span> เฝ้าระวัง ${pf.watch}</small></div>
        <div><span>มูลค่าสัญญารวม</span><b class="num">${fmt.moneyShort(pf.value).v}</b><small>${fmt.moneyShort(pf.value).u}</small></div>
      </div>
      ${gauge(pf.actual, pf.plan, { size: 'lg', scale: true })}
    </div>`,
  });

  for (let i = 0; i < rows.length; i += 8) {
    const chunk = rows.slice(i, i + 8);
    slides.push({
      html: `<div class="sl sl-cmp">
        <h2>แผนเทียบผลงานรายโครงการ${rows.length > 8 ? ` <small>(${i + 1}–${i + chunk.length})</small>` : ''}</h2>
        <div class="cmp cmp-lg">${chunk.map(({ p, a }) => `
          <div class="cmp-row">
            <span class="cmp-name"><b>${esc(p.name)}</b><small>${esc(daysText(p, a))}</small></span>
            ${gauge(a.actual, a.plan, { size: 'md' })}
            <span class="cmp-num"><b class="num">${fmt.pct(a.actual)}</b><small>แผน ${fmt.pct(a.plan)}</small></span>
            ${chip(a.status)}
          </div>`).join('')}</div>
      </div>`,
    });
  }

  for (const { p, a } of rows) {
    const items = store.boqOf(p.id);
    const ups = store.updatesOf(p.id).filter((u) => u.date <= today);
    const groups = groupBreakdown(p, items, a.cum).slice(0, 6);
    const last = ups[ups.length - 1];
    const issue = [...ups].reverse().find((u) => u.issues);
    const photo = store.filesOf(p.id).find((f) => fileKind(f).kind === 'image');
    slides.push({
      p, a, items, ups, photo,
      html: `<div class="sl sl-proj">
        <header class="slp-head">
          <div><p class="sl-kicker">${esc([p.code, p.type].filter(Boolean).join(' / '))}</p><h2>${esc(p.name)}</h2>
          <p class="slp-facts"><span>${esc(p.contractor || '')}</span><span>${fmt.date(p.startDate)} – ${fmt.date(p.endDate)}</span><span>${a.value ? moneyHTML(a.value) : ''}</span></p></div>
          <div class="slp-fig">${chip(a.status)}<b class="num">${fmt.pctNum(a.actual)}<i>%</i></b><small>แผน ${fmt.pct(a.plan)} ${deltaHTML(a.diff)}</small><small>${esc(daysText(p, a))}</small></div>
        </header>
        <div class="slp-body">
          <div class="slp-chart"><div class="chart-legend"><span><i class="lg-a"></i>ผลงานจริง</span><span><i class="lg-p"></i>แผนงาน</span></div><div class="slp-sc"></div></div>
          <div class="slp-side">
            ${groups.length ? `<h3>ตามหมวดงาน</h3><ul class="slp-groups">${groups.map((g) => `<li><span>${esc(g.name)}</span><div class="mini"><span style="width:${Math.min(100, g.pct * 100).toFixed(1)}%"></span></div><b class="num">${fmt.pct(g.pct)}</b></li>`).join('')}</ul>`
              : `<p class="muted">${esc(METHODS[p.progressMethod || 'boq_value'].label)}</p>`}
            ${last ? `<h3>ผลการดำเนินงานล่าสุด <small>${fmt.date(last.date)}</small></h3><p>${esc(last.note || '–')}</p>` : ''}
            ${issue ? `<h3>ปัญหาและอุปสรรค</h3><p class="t-issue">${icon('alert')}${esc(issue.issues)}</p>` : ''}
            ${photo ? '<div class="slp-photo"><img alt="รูปถ่ายความคืบหน้าล่าสุด"></div>' : ''}
          </div>
        </div>
      </div>`,
    });
  }

  const ov = document.createElement('div');
  ov.className = 'present';
  ov.innerHTML = `
    <div class="present-stage"></div>
    <nav class="present-nav">
      <button class="icon-btn" data-prev aria-label="สไลด์ก่อนหน้า">${icon('chevL')}</button>
      <span class="present-count"></span>
      <button class="icon-btn" data-next aria-label="สไลด์ถัดไป">${icon('chevR')}</button>
      <button class="icon-btn" data-exit aria-label="ออกจากโหมดนำเสนอ">${icon('x')}</button>
    </nav>`;
  document.body.appendChild(ov);
  document.body.classList.add('has-present');
  const stage = ov.querySelector('.present-stage');
  let idx = 0;

  const show = async () => {
    const s = slides[idx];
    stage.innerHTML = s.html;
    stage.firstElementChild.classList.add('in');
    ov.querySelector('.present-count').textContent = `${idx + 1} / ${slides.length}`;
    if (s.p) {
      const box = stage.querySelector('.slp-sc');
      mountSCurve(box, {
        plan: planSeries(s.p, 60, s.items), actual: actualSeries(s.p, s.items, s.ups),
        start: s.p.startDate, end: s.p.endDate, height: Math.max(220, Math.min(420, window.innerHeight * 0.45)),
      });
      if (s.photo) {
        const url = await store.thumbUrl(s.photo);
        const img = stage.querySelector('.slp-photo img');
        if (img && url) { img.src = url; img.onerror = () => img.parentElement.remove(); } else img?.parentElement.remove();
      }
    }
  };
  const go = (d) => { idx = Math.max(0, Math.min(slides.length - 1, idx + d)); show(); };
  const exit = () => {
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    ov.remove();
    document.body.classList.remove('has-present');
  };
  const onKey = (e) => {
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); go(-1); }
    else if (e.key === 'Home') { idx = 0; show(); }
    else if (e.key === 'End') { idx = slides.length - 1; show(); }
    else if (e.key === 'Escape') exit();
    else if (e.key.toLowerCase() === 'f') ov.requestFullscreen?.().catch(() => {});
  };
  document.addEventListener('keydown', onKey);
  ov.querySelector('[data-prev]').addEventListener('click', () => go(-1));
  ov.querySelector('[data-next]').addEventListener('click', () => go(1));
  ov.querySelector('[data-exit]').addEventListener('click', exit);
  ov.addEventListener('fullscreenchange', () => {});
  let tx = null;
  stage.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (tx == null) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    tx = null;
  });
  ov.requestFullscreen?.().catch(() => {});
  show();
}
