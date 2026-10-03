// The Agent Forge — presentation layer only. Adds the entry sequence, ambient command-center
// environment and attention hierarchy. It never calls the API or touches application state.
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const CYAN = '61, 225, 255';
  const BLUE = '57, 139, 255';

  function fitCanvas(canvas, maxDpr = 1.75) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* ───────────── Ambient command-center environment ───────────── */
  function startEnvironment() {
    const canvas = document.createElement('canvas');
    canvas.id = 'jv-environment';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    let ctx, w, h, particles = [], paths = [];
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

    function buildPath() {
      const pts = [];
      let x = rand(0, w), y = rand(0.1, 0.9) * h;
      const horizontalFirst = Math.random() > 0.5;
      pts.push({ x, y });
      const steps = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < steps; i++) {
        const horizontal = (i % 2 === 0) === horizontalFirst;
        const dist = rand(90, 340);
        if (horizontal) x += (Math.random() > 0.5 ? 1 : -1) * dist; else y += (Math.random() > 0.5 ? 1 : -1) * dist * 0.7;
        x = clamp(x, -40, w + 40); y = clamp(y, -40, h + 40);
        pts.push({ x, y });
      }
      let length = 0;
      const seg = [];
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(l); length += l; }
      return { pts, seg, length, packets: Array.from({ length: 1 + Math.floor(Math.random() * 2) }, () => ({ p: Math.random(), v: rand(0.018, 0.045) })) };
    }
    function pointAt(path, dist) {
      let d = dist;
      for (let i = 0; i < path.seg.length; i++) {
        if (d <= path.seg[i]) { const k = path.seg[i] ? d / path.seg[i] : 0; return { x: path.pts[i].x + (path.pts[i + 1].x - path.pts[i].x) * k, y: path.pts[i].y + (path.pts[i + 1].y - path.pts[i].y) * k }; }
        d -= path.seg[i];
      }
      const last = path.pts[path.pts.length - 1];
      return { x: last.x, y: last.y };
    }

    function resize() {
      ({ ctx, w, h } = fitCanvas(canvas, 1.5));
      const count = Math.round(clamp((w * h) / 22000, 28, 90));
      particles = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, z: rand(0.2, 1), s: rand(0.4, 1.4), tw: Math.random() * TAU }));
      paths = Array.from({ length: Math.round(clamp(w / 220, 4, 9)) }, buildPath);
      if (reduceMotion) draw(0, 0);
    }

    function draw(t, dt) {
      mouse.x += (mouse.tx - mouse.x) * 0.04; mouse.y += (mouse.ty - mouse.y) * 0.04;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      // drifting light
      for (let i = 0; i < 3; i++) {
        const cx = w * (0.5 + 0.42 * Math.sin(t * 0.00006 * (i + 1) + i * 2.1)) + mouse.x * 30 * (i + 1);
        const cy = h * (0.45 + 0.35 * Math.cos(t * 0.00005 * (i + 2) + i));
        const r = Math.max(w, h) * (0.32 + i * 0.07);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${i === 1 ? BLUE : CYAN}, ${i === 1 ? 0.07 : 0.045})`);
        g.addColorStop(1, `rgba(${BLUE}, 0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }

      // perspective floor
      const horizon = h * 0.56, vx = w / 2 + mouse.x * 40;
      const floor = ctx.createLinearGradient(0, horizon, 0, h);
      floor.addColorStop(0, `rgba(${CYAN}, 0)`); floor.addColorStop(1, `rgba(${CYAN}, 0.1)`);
      ctx.strokeStyle = floor; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -14; i <= 14; i++) { ctx.moveTo(vx, horizon); ctx.lineTo(vx + i * w * 0.14, h); }
      const scroll = (t * 0.00005) % 1;
      for (let i = 0; i < 14; i++) {
        const k = ((i + scroll) / 14), y = horizon + (h - horizon) * k * k;
        ctx.moveTo(0, y); ctx.lineTo(w, y);
      }
      ctx.stroke();

      // data paths + travelling packets
      for (const path of paths) {
        ctx.strokeStyle = `rgba(${BLUE}, 0.07)`; ctx.lineWidth = 1;
        ctx.beginPath();
        path.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        ctx.fillStyle = `rgba(${CYAN}, 0.16)`;
        for (const p of path.pts) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        for (const pk of path.packets) {
          pk.p = (pk.p + pk.v * dt * 0.001) % 1.2;
          const dist = pk.p * path.length;
          for (let s = 0; s < 8; s++) {
            const d = dist - s * 7; if (d < 0 || d > path.length) continue;
            const pt = pointAt(path, d);
            ctx.fillStyle = `rgba(${CYAN}, ${(0.55 * (1 - s / 8)).toFixed(3)})`;
            ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2);
          }
        }
      }

      // depth particles
      for (const p of particles) {
        p.y -= p.z * p.s * dt * 0.006; p.x += Math.sin(t * 0.0003 + p.tw) * p.z * 0.06;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        const a = (0.14 + 0.22 * Math.sin(t * 0.0012 + p.tw) ** 2) * p.z;
        ctx.fillStyle = `rgba(${CYAN}, ${a.toFixed(3)})`;
        const size = p.s * p.z * 1.6;
        ctx.fillRect(p.x + mouse.x * 26 * p.z, p.y + mouse.y * 18 * p.z, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    let last = performance.now(), running = false;
    function loop(now) {
      if (!running) return;
      const dt = Math.min(now - last, 64); last = now;
      draw(now, dt);
      requestAnimationFrame(loop);
    }
    function setRunning(on) { if (on && !running && !reduceMotion) { running = true; last = performance.now(); requestAnimationFrame(loop); } else if (!on) running = false; }
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', e => { mouse.tx = e.clientX / window.innerWidth - 0.5; mouse.ty = e.clientY / window.innerHeight - 0.5; }, { passive: true });
    document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
    resize(); setRunning(true);
  }

  /* ───────────── Cinematic entry: FORGE CORE ───────────── */
  function buildIntro() {
    const intro = document.createElement('div');
    intro.id = 'jv-intro';
    intro.innerHTML = `<canvas aria-hidden="true"></canvas>
      <div class="jv-hud" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="jv-scale jv-scale-l"></span><span class="jv-scale jv-scale-r"></span></div>
      <div class="jv-intro-copy"><h1>WELCOME TO EMPIRE FINANCIAL</h1><button type="button" class="jv-enter"><span>ENTER</span></button></div>`;
    document.body.append(intro);
    const canvas = intro.querySelector('canvas');
    let ctx, w, h, cx, cy, R;
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    let boost = 0, leaving = 0, leavingStart = 0, raf = 0, stopped = false;

    // geodesic lattice
    const nodes = Array.from({ length: 46 }, (_, i) => {
      const y = 1 - (i / 45) * 2, r = Math.sqrt(1 - y * y), phi = i * 2.399963;
      return { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r };
    });
    const edges = [];
    nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.62) edges.push([i, j]); }));
    const rays = Array.from({ length: 72 }, (_, i) => ({ a: (i / 72) * TAU + rand(-0.02, 0.02), len: rand(0.35, 1.5), p: Math.random(), v: rand(0.12, 0.4), bright: Math.random() > 0.7 }));
    const dust = Array.from({ length: 170 }, () => ({ a: Math.random() * TAU, r: rand(0.5, 2.6), v: rand(0.02, 0.2) * (Math.random() > 0.5 ? 1 : -1), s: rand(0.5, 1.8), tw: Math.random() * TAU, inward: Math.random() > 0.8 }));
    const arcSets = [[0, 1.1, 1.7, 0.9, 3.4, 1.4], [0.4, 0.5, 1.2, 1.5, 3.9, 0.6, 4.8, 1.0], [0, 2.4, 3.1, 1.3], [0.3, 0.2, 0.8, 0.2, 1.4, 0.2, 2.2, 1.6, 4.4, 1.2]];

    function resize() {
      ({ ctx, w, h } = fitCanvas(canvas, 1.75));
      cx = w / 2; cy = h * (w < 700 ? 0.38 : 0.42);
      R = Math.min(w, h) * (w < 700 ? 0.2 : 0.19);
    }

    const project = (x, y, z, ry, rx, scale) => {
      const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
      const x1 = x * cY + z * sY, z1 = -x * sY + z * cY;
      const y2 = y * cX - z1 * sX, z2 = y * sX + z1 * cX;
      const persp = 1 / (1 - z2 * 0.25);
      return { x: cx + x1 * scale * persp, y: cy + y2 * scale * persp, z: z2 };
    };

    function ring(radius, arcs, rot, width, alpha, color = CYAN) {
      ctx.lineWidth = width; ctx.strokeStyle = `rgba(${color}, ${alpha})`;
      for (let i = 0; i < arcs.length; i += 2) { ctx.beginPath(); ctx.arc(cx, cy, radius, rot + arcs[i], rot + arcs[i] + arcs[i + 1]); ctx.stroke(); }
    }

    function frame(now) {
      if (stopped) return;
      const t = now / 1000;
      mouse.x += (mouse.tx - mouse.x) * 0.05; mouse.y += (mouse.ty - mouse.y) * 0.05;
      let k = 0;
      if (leaving) { k = clamp((now - leavingStart) / 1100, 0, 1); boost = k * k * 7; }
      const sp = 1 + boost;
      const flare = leaving ? Math.sin(k * Math.PI * 0.5) : 0;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const ox = mouse.x * 14, oy = mouse.y * 10;
      ctx.save(); ctx.translate(ox, oy);

      // halo
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (2.6 + flare * 3));
      halo.addColorStop(0, `rgba(${CYAN}, ${0.5 + flare * 0.4})`);
      halo.addColorStop(0.18, `rgba(${CYAN}, ${0.16 + pulse * 0.05 + flare * 0.2})`);
      halo.addColorStop(0.5, `rgba(${BLUE}, 0.06)`);
      halo.addColorStop(1, `rgba(${BLUE}, 0)`);
      ctx.fillStyle = halo; ctx.fillRect(-ox, -oy, w, h);

      // energy rays
      for (const r of rays) {
        r.p = (r.p + r.v * 0.004 * sp) % 1;
        const r0 = R * 1.05, r1 = R * (1.05 + r.len * (1 + flare * 1.5));
        const ca = Math.cos(r.a), sa = Math.sin(r.a);
        ctx.strokeStyle = `rgba(${BLUE}, ${r.bright ? 0.16 : 0.07})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx + ca * r0, cy + sa * r0); ctx.lineTo(cx + ca * r1, cy + sa * r1); ctx.stroke();
        const d0 = r0 + (r1 - r0) * r.p, d1 = r0 + (r1 - r0) * Math.min(1, r.p + 0.09);
        ctx.strokeStyle = `rgba(${CYAN}, ${(r.bright ? 0.9 : 0.5) * (1 - r.p)})`; ctx.lineWidth = r.bright ? 1.6 : 1;
        ctx.beginPath(); ctx.moveTo(cx + ca * d0, cy + sa * d0); ctx.lineTo(cx + ca * d1, cy + sa * d1); ctx.stroke();
      }

      // flat HUD rings
      ring(R * 1.22, arcSets[0], t * 0.25 * sp, 2, 0.75);
      ring(R * 1.4, arcSets[1], -t * 0.18 * sp, 1, 0.55, BLUE);
      ring(R * 1.62, arcSets[2], t * 0.1 * sp, 3, 0.35);
      ring(R * 1.86, arcSets[3], -t * 0.07 * sp, 1, 0.5, BLUE);
      // tick ring
      ctx.strokeStyle = `rgba(${CYAN}, 0.4)`; ctx.lineWidth = 1;
      const tickRot = t * 0.05 * sp;
      ctx.beginPath();
      for (let i = 0; i < 120; i++) { const a = tickRot + (i / 120) * TAU, long = i % 10 === 0, r0 = R * 2.02, r1 = r0 + R * (long ? 0.1 : 0.04); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); }
      ctx.stroke();

      // gyroscope rings (3D)
      for (let g = 0; g < 3; g++) {
        const spin = t * (0.5 + g * 0.23) * sp * (g % 2 ? -1 : 1), tiltX = 1.1 + g * 0.55, tiltY = g * 1.05 + t * 0.12 * sp;
        ctx.strokeStyle = `rgba(${g === 1 ? BLUE : CYAN}, ${0.5 - g * 0.08})`; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 90; i++) {
          const a = (i / 90) * TAU + spin;
          const p = project(Math.cos(a), Math.sin(a), 0, tiltY, tiltX, R * 0.98);
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        }
        ctx.stroke();
        const bead = project(Math.cos(spin * 2), Math.sin(spin * 2), 0, tiltY, tiltX, R * 0.98);
        ctx.fillStyle = `rgba(${CYAN}, 0.95)`; ctx.beginPath(); ctx.arc(bead.x, bead.y, 2.6, 0, TAU); ctx.fill();
      }

      // geodesic lattice
      const ry = t * 0.32 * sp, rx = 0.45 + Math.sin(t * 0.2) * 0.2 + mouse.y * 0.3;
      const scale = R * (0.56 + pulse * 0.02 + flare * 0.3);
      const pr = nodes.map(n => project(n.x, n.y, n.z, ry + mouse.x * 0.4, rx, scale));
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        const depth = (pr[i].z + pr[j].z) / 2;
        ctx.strokeStyle = `rgba(${CYAN}, ${(0.18 + (depth + 1) * 0.25).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(pr[i].x, pr[i].y); ctx.lineTo(pr[j].x, pr[j].y); ctx.stroke();
      }
      for (const p of pr) { ctx.fillStyle = `rgba(255,255,255,${(0.35 + (p.z + 1) * 0.3).toFixed(3)})`; ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4); }

      // inner core
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.34 + flare * 0.5));
      core.addColorStop(0, 'rgba(235, 252, 255, 1)'); core.addColorStop(0.3, `rgba(${CYAN}, 0.85)`); core.addColorStop(1, `rgba(${CYAN}, 0)`);
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, R * (0.4 + flare * 0.6), 0, TAU); ctx.fill();

      // particles
      for (const d of dust) {
        d.a += d.v * 0.01 * sp;
        if (d.inward) { d.r -= 0.002 * sp; if (d.r < 0.45) d.r = rand(1.8, 2.6); }
        const rr = R * d.r, x = cx + Math.cos(d.a) * rr, y = cy + Math.sin(d.a) * rr * 0.92;
        const a = (0.2 + 0.6 * Math.sin(t * 1.4 + d.tw) ** 2) * (d.inward ? 1 : 0.7);
        ctx.fillStyle = `rgba(${CYAN}, ${a.toFixed(3)})`; ctx.fillRect(x, y, d.s, d.s);
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    function enter() {
      if (leaving) return;
      leaving = 1; leavingStart = performance.now();
      intro.classList.add('jv-leaving');
      document.body.classList.add('jv-entered');
      setTimeout(destroy, 1350);
    }
    function destroy() { stopped = true; cancelAnimationFrame(raf); intro.remove(); }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', e => { mouse.tx = e.clientX / w - 0.5; mouse.ty = e.clientY / h - 0.5; }, { passive: true });
    intro.querySelector('.jv-enter').addEventListener('click', enter);
    if (reduceMotion) { frame(0); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(frame);
    requestAnimationFrame(() => intro.classList.add('jv-ready'));
    intro.querySelector('.jv-enter').focus({ preventScroll: true });
    return { enter, el: intro };
  }

  /* ───────────── Attention hierarchy + physical interaction ───────────── */
  function setupAttention() {
    const app = document.getElementById('app');
    const title = document.getElementById('page-title');
    if (!app || !title) return;
    let lastKey = '', enterTimer = 0;
    const apply = () => {
      const role = typeof me !== 'undefined' && me ? me.role : '';
      document.body.dataset.role = role;
      const key = role + '|' + title.textContent;
      if (key !== lastKey) {
        lastKey = key; app.classList.remove('jv-arrive'); void app.offsetWidth; app.classList.add('jv-arrive');
        clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove('jv-arrive'), 700);
      }
      document.body.classList.toggle('jv-has-objective', !!app.querySelector('.current-objective'));
      app.querySelector('.current-card')?.classList.add('jv-hero');
      app.querySelectorAll('.req-item:not(.done):not(.current-objective)').forEach(el => el.classList.add('jv-queued'));
    };
    new MutationObserver(apply).observe(app, { childList: true });
    new MutationObserver(apply).observe(title, { childList: true, characterData: true, subtree: true });
    apply();

    // pointer light + gentle tilt on elements that should feel physical
    const tiltSel = '.jv-hero, .milestone-card, .attention-panel, .card, .stage-node:not(:disabled), .primary-button, .reward-card';
    let active = null;
    document.addEventListener('pointermove', e => {
      const el = e.target.closest?.(tiltSel);
      if (active && active !== el) { active.style.removeProperty('--rx'); active.style.removeProperty('--ry'); }
      active = el || null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      if (r.width < 760 && r.height < 520 && !reduceMotion) { el.style.setProperty('--rx', ((0.5 - py) * 3).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((px - 0.5) * 4).toFixed(2) + 'deg'); }
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (active) { active.style.removeProperty('--rx'); active.style.removeProperty('--ry'); active = null; } }, true);

    // energy pulse on activation
    document.addEventListener('pointerdown', e => {
      if (reduceMotion) return;
      const el = e.target.closest?.('button, a, .req-item, .nav-item, .stage-node');
      if (!el || el.disabled) return;
      const ring = document.createElement('span');
      ring.className = 'jv-pulse'; ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
      document.body.append(ring);
      ring.addEventListener('animationend', () => ring.remove());
    }, true);
  }

  /* ───────────── Boot ───────────── */
  function init() {
    startEnvironment();
    setupAttention();
    // The entry screen shows on every load; an active session is kept and simply revealed on entry.
    buildIntro();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
