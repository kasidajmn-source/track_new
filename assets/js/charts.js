// กราฟ S-Curve (SVG) — วาดตามความกว้างจริงของกล่อง และวาดใหม่เมื่อขนาดเปลี่ยน
import { parseISO, toISO, todayISO } from './calc.js';
import { fmt, onCleanup, esc } from './ui.js';

const DAY = 864e5;

function interp(series, t) {
  if (!series.length) return null;
  if (t <= series[0].t) return series[0].v;
  for (let i = 1; i < series.length; i++) {
    if (t <= series[i].t) {
      const a = series[i - 1], b = series[i];
      return a.v + (b.v - a.v) * ((t - a.t) / ((b.t - a.t) || 1));
    }
  }
  return null;
}

export function mountSCurve(el, { plan = [], actual = [], start, end, today = todayISO(), height = 280, compact = false }) {
  const P = plan.map((d) => ({ t: +parseISO(d.date), v: d.v, date: d.date }));
  const A = actual.map((d) => ({ t: +parseISO(d.date), v: d.v, date: d.date }));
  const allT = [...P, ...A].map((d) => d.t);
  if (start) allT.push(+parseISO(start));
  if (end) allT.push(+parseISO(end));
  if (allT.length < 2) {
    el.innerHTML = '<div class="chart-empty">ระบุวันเริ่มและวันสิ้นสุดสัญญาเพื่อแสดงแผนงาน</div>';
    return;
  }
  const t0 = Math.min(...allT), t1 = Math.max(...allT, t0 + DAY);
  const vMax = Math.max(1, ...A.map((d) => d.v), ...P.map((d) => d.v));
  const todayT = +parseISO(today);
  let lastW = 0;

  const draw = () => {
    const W = Math.max(260, Math.floor(el.clientWidth));
    lastW = W;
    const H = height;
    const pad = { l: compact ? 34 : 44, r: 14, t: 14, b: 28 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * iw;
    const y = (v) => pad.t + ih - (v / vMax) * ih;

    // เส้นกริดแนวนอน
    let grid = '';
    for (const g of [0, 0.25, 0.5, 0.75, 1]) {
      const gy = y(g * vMax);
      grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${gy}" y2="${gy}" class="c-grid"/>`;
      grid += `<text x="${pad.l - 8}" y="${gy + 4}" class="c-ylab" text-anchor="end">${Math.round(g * vMax * 100)}%</text>`;
    }
    // ป้ายเดือนแกน X
    const d0 = new Date(t0), months = [];
    const cur = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    while (+cur <= t1) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }
    const step = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(iw / 62))));
    let xt = '';
    months.forEach((m, i) => {
      const mx = x(+m);
      xt += `<line x1="${mx}" x2="${mx}" y1="${pad.t + ih}" y2="${pad.t + ih + 4}" class="c-tick"/>`;
      if (i % step === 0) {
        const lab = (m.getMonth() === 0 || i === 0) ? fmt.monthYear(m) : fmt.month(m);
        xt += `<text x="${mx}" y="${H - 8}" class="c-xlab" text-anchor="middle">${esc(lab)}</text>`;
      }
    });

    const path = (s) => s.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join('');
    const planPath = P.length ? `<path d="${path(P)}" class="c-plan"/>` : '';
    let actualSvg = '';
    if (A.length) {
      const area = `${path(A)}L${x(A[A.length - 1].t).toFixed(1)},${y(0)}L${x(A[0].t).toFixed(1)},${y(0)}Z`;
      actualSvg = `<path d="${area}" class="c-area"/><path d="${path(A)}" class="c-actual"/>`
        + A.slice(1).map((d) => `<circle cx="${x(d.t).toFixed(1)}" cy="${y(d.v).toFixed(1)}" r="${compact ? 2.5 : 3.2}" class="c-dot"/>`).join('');
    }
    const showToday = todayT >= t0 && todayT <= t1;
    const todayLine = showToday
      ? `<line x1="${x(todayT)}" x2="${x(todayT)}" y1="${pad.t}" y2="${pad.t + ih}" class="c-today"/><text x="${x(todayT) + 4}" y="${pad.t + 10}" class="c-todaylab">วันนี้</text>`
      : '';

    el.innerHTML = `<div class="chart-box" style="height:${H}px">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟ S-Curve แผนงานเทียบผลงานจริง">
        ${grid}${xt}${todayLine}${planPath}${actualSvg}
        <line class="c-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" style="display:none"/>
        <rect class="c-hit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      <div class="c-tip" hidden></div>
    </div>`;

    const svg = el.querySelector('svg');
    const tip = el.querySelector('.c-tip');
    const cross = el.querySelector('.c-cross');
    const hit = el.querySelector('.c-hit');
    const lastA = A.length ? A[A.length - 1].t : -Infinity;
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = Math.min(Math.max(clientX - r.left, pad.l), W - pad.r);
      const t = t0 + ((px - pad.l) / iw) * (t1 - t0);
      const pv = interp(P, t);
      const av = t <= lastA ? interp(A, t) : null;
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.style.display = '';
      tip.hidden = false;
      tip.innerHTML = `<b>${fmt.date(toISO(new Date(t)))}</b>
        ${av != null ? `<span class="t-a">ผลงาน ${(av * 100).toFixed(1)}%</span>` : ''}
        ${pv != null ? `<span class="t-p">แผน ${(pv * 100).toFixed(1)}%</span>` : ''}`;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(px - tw / 2, 0), W - tw)}px`;
      tip.style.top = `${pad.t}px`;
    };
    const leave = () => { tip.hidden = true; cross.style.display = 'none'; };
    hit.addEventListener('mousemove', (e) => move(e.clientX));
    hit.addEventListener('mouseleave', leave);
    hit.addEventListener('touchstart', (e) => move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchend', () => setTimeout(leave, 1500));
  };

  draw();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      if (el.isConnected && Math.abs(el.clientWidth - lastW) > 6) draw();
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  }
}
