/**
 * Starter templates for the interactive animation block.
 *
 * Each `html` is a fully self-contained document body (canvas/SVG + inline
 * script/style) that:
 *  - reads the injected page palette via `var(--accent)` / `var(--muted)` etc.,
 *    so it themes with the page and follows the live theme toggle;
 *  - honors `prefers-reduced-motion: reduce` (draws a static frame / no anim);
 *  - loads nothing external — the block's inner CSP blocks the network.
 *
 * They are inserted verbatim into the block's `html` prop, so they must remain
 * dependency-free strings (this module is also bundled by the guest editor).
 */
export interface AnimationTemplate {
  id: string;
  label: string;
  html: string;
}

const BOUNCING_SHAPES = `<canvas id="c" width="640" height="360" style="width:100%;height:100%;display:block"></canvas>
<script>
  const g = document.getElementById('c').getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const balls = Array.from({ length: 6 }, (_, i) => ({
    x: 80 + i * 90, y: 60 + (i % 3) * 80,
    vx: 1.3 + i * 0.3, vy: 1 + (i % 2) * 0.6, r: 12 + (i % 3) * 6,
  }));
  function frame() {
    g.clearRect(0, 0, 640, 360);
    for (const b of balls) {
      if (!reduce) {
        b.x += b.vx; b.y += b.vy;
        if (b.x < b.r || b.x > 640 - b.r) b.vx *= -1;
        if (b.y < b.r || b.y > 360 - b.r) b.vy *= -1;
      }
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      g.fillStyle = v('--accent'); g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
    }
    if (!reduce) requestAnimationFrame(frame);
  }
  frame();
</script>`;

const ANALOG_CLOCK = `<canvas id="c" width="360" height="360" style="width:100%;height:100%;display:block"></canvas>
<script>
  const g = document.getElementById('c').getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function hand(a, len, w, col) {
    g.beginPath(); g.lineWidth = w; g.lineCap = 'round'; g.strokeStyle = col;
    g.moveTo(180, 180); g.lineTo(180 + len * Math.sin(a), 180 - len * Math.cos(a)); g.stroke();
  }
  function draw() {
    g.clearRect(0, 0, 360, 360);
    g.beginPath(); g.arc(180, 180, 140, 0, Math.PI * 2);
    g.strokeStyle = v('--muted'); g.lineWidth = 2; g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(180 + 126 * Math.sin(a), 180 - 126 * Math.cos(a));
      g.lineTo(180 + 140 * Math.sin(a), 180 - 140 * Math.cos(a));
      g.strokeStyle = v('--muted'); g.lineWidth = 2; g.stroke();
    }
    const d = new Date(), s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
    hand(((h + m / 60) / 12) * Math.PI * 2, 70, 6, v('--text'));
    hand(((m + s / 60) / 60) * Math.PI * 2, 100, 4, v('--text'));
    hand((s / 60) * Math.PI * 2, 120, 2, v('--accent'));
  }
  draw();
  if (!reduce) setInterval(draw, 1000);
</script>`;

const CONSTELLATION = `<canvas id="c" width="640" height="360" style="width:100%;height:100%;display:block"></canvas>
<script>
  const g = document.getElementById('c').getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const N = 40, pts = Array.from({ length: N }, () => ({
    x: Math.random() * 640, y: Math.random() * 360,
    vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6,
  }));
  function frame() {
    g.clearRect(0, 0, 640, 360);
    for (const p of pts) if (!reduce) { p.x = (p.x + p.vx + 640) % 640; p.y = (p.y + p.vy + 360) % 360; }
    g.strokeStyle = v('--muted');
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 90) { g.globalAlpha = 1 - d / 90; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    }
    g.globalAlpha = 1; g.fillStyle = v('--accent');
    for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, 2.5, 0, Math.PI * 2); g.fill(); }
    if (!reduce) requestAnimationFrame(frame);
  }
  frame();
</script>`;

const SPINNER_RING = `<div style="display:flex;align-items:center;justify-content:center;height:100%">
  <div class="ring"></div>
</div>
<style>
  .ring {
    width: 72px; height: 72px; border-radius: 50%;
    border: 7px solid var(--muted); border-top-color: var(--accent);
    animation: spin 1.1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
</style>`;

export const ANIMATION_TEMPLATES: AnimationTemplate[] = [
  { id: "bouncing", label: "Bouncing shapes", html: BOUNCING_SHAPES },
  { id: "clock", label: "Analog clock", html: ANALOG_CLOCK },
  { id: "constellation", label: "Constellation", html: CONSTELLATION },
  { id: "spinner", label: "Spinner ring", html: SPINNER_RING },
];
