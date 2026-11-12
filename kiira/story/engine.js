/* Shared engine for the Kiira scrolling stories: one canvas of dots that move between layouts as the reader scrolls.
 * Each story page supplies dots, beats (text + a layout function + an optional SVG overlay) and a prepare() step.
 * The picture is a pure function of the scroll position: the end frame of beat i eases into beat i+1 in the last 45% of its scroll.
 * Credit: Gava Charles. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const nf = (v, d = 0) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }));
  const C = { blue: [42, 120, 214], orange: [235, 104, 52], aqua: [27, 175, 122], violet: [98, 80, 214], amber: [237, 161, 0], grey: [160, 159, 152], ink: [11, 11, 11], light: [205, 204, 196], red: [227, 73, 72] };
  const SEQ = [[220, 234, 251], [158, 197, 244], [110, 165, 227], [42, 120, 214], [26, 86, 160], [15, 55, 104]];
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // Suburb polygons from the main page's data.js
  const K = window.KIIRA, polys = {}, BB = {}, CEN = {};
  if (K) K.geo.suburbs.features.forEach((f) => (polys[f.properties.sid] = f.geometry));
  const bbox = (g) => { let a = [1e9, 1e9, -1e9, -1e9]; (g.type === "Polygon" ? [g.coordinates] : g.coordinates).forEach((p) => p[0].forEach(([x, y]) => { a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; })); return a; };
  for (const k in polys) { BB[k] = bbox(polys[k]); CEN[k] = [(BB[k][0] + BB[k][2]) / 2, (BB[k][1] + BB[k][3]) / 2]; }
  if (K) K.inputs.forEach((s) => (CEN[s.sid] = [s.lon, s.lat]));
  function inPoly(x, y, g) {
    for (const poly of g.type === "Polygon" ? [g.coordinates] : g.coordinates) { let ins = false; const r = poly[0]; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } if (ins) return true; }
    return false;
  }
  const R0 = rng(42);
  function randIn(sid, R = R0) { const g = polys[sid], b = BB[sid]; if (!g) return CEN[sid] || [32.58, 0.33]; for (let t = 0; t < 60; t++) { const x = b[0] + R() * (b[2] - b[0]), y = b[1] + R() * (b[3] - b[1]); if (inPoly(x, y, g)) return [x, y]; } return CEN[sid]; }

  function create(cfg) {
    const { dots, beats } = cfg, N = dots.length;
    const cv = $("cv"), ctx = cv.getContext("2d"), over = $("over"), steps = $("steps");
    const S = { W: 0, H: 0, DPR: 1, geo: null, dots, C, SEQ, nf };
    // map projection that fits the 100 suburbs (or cfg.extent [lon0, lat0, lon1, lat1]) into the stage
    S.fitMap = (ext, pad = 18) => {
      let b = ext || [1e9, 1e9, -1e9, -1e9]; if (!ext) Object.values(BB).forEach((x) => { b = [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])]; });
      const k = Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180), sx = (S.W - 2 * pad) / ((b[2] - b[0]) * k), sy = (S.H - 2 * pad) / (b[3] - b[1]), s = Math.min(sx, sy);
      const ox = (S.W - (b[2] - b[0]) * k * s) / 2, oy = (S.H - (b[3] - b[1]) * s) / 2;
      return (lon, lat) => [ox + (lon - b[0]) * k * s, oy + (b[3] - lat) * s];
    };
    // unit grid: columns of dots stacked bottom-up
    S.grids = (groups, opts = {}) => {
      const n = groups.length, top = opts.top || 72, bottom = S.H - (opts.bottom || 40), left = opts.left || 20, gw = (S.W - left - 20) / n;
      const mx = Math.max(1, ...groups.map((g) => g.length));
      const step = opts.step || Math.max(2.6, Math.min(9, Math.sqrt(((gw - 18) * (bottom - top)) / mx) * 0.98));
      const per = Math.max(1, Math.floor((gw - 18) / step)), pos = new Map();
      groups.forEach((g, j) => g.forEach((d, i) => pos.set(d, [left + j * gw + 9 + (i % per) * step + step / 2, bottom - Math.floor(i / per) * step])));
      return { pos, step, gw, per, top, bottom, left };
    };
    S.legendRow = (items, y = 16) => { let x = 10; return items.map(([t, c]) => { const s = `<circle cx="${x + 5}" cy="${y}" r="5" fill="rgb(${c})"/><text x="${x + 14}" y="${y + 4}">${t}</text>`; x += 26 + t.length * 7.2; return s; }).join(""); };
    S.colLabels = (g, labels, subs) => labels.map((l, j) => `<text class="h" x="${g.left + j * g.gw + 9}" y="${g.top - 34}">${l}</text><text x="${g.left + j * g.gw + 9}" y="${g.top - 16}">${subs ? subs[j] : ""}</text>`).join("");
    S.axis = (x, ticks, fmt, label, y) => { y = y || S.H - 40; let s = `<line x1="40" x2="${S.W - 30}" y1="${y}" y2="${y}" stroke="#c3c2b7"/>`; ticks.forEach((v) => (s += `<text x="${x(v)}" y="${y + 18}" text-anchor="middle">${fmt(v)}</text>`)); return s + `<text x="${S.W - 30}" y="${y + 34}" text-anchor="end">${label}</text>`; };
    // round tick values between lo and hi
    S.ticks = (lo, hi, n = 5) => { const raw = (hi - lo) / n, m = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map((k) => k * m).find((k) => k >= raw); const out = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) out.push(+v.toFixed(6)); return out; };
    S.hide = (d) => ({ x: d._mx != null ? d._mx : S.W / 2, y: d._my != null ? d._my : S.H / 2, r: 1, c: C.light, a: 0 });

    beats.forEach((b) => { const d = document.createElement("section"); d.className = "step"; d.id = "b-" + b.id; d.innerHTML = `<div class="card">${typeof b.html === "function" ? b.html(S) : b.html}</div>`; steps.appendChild(d); });
    const stepEls = [...steps.children];
    let LAY = [], last = null;
    function layout() {
      const box = $("stage").getBoundingClientRect(); S.W = box.width; S.H = box.height; S.DPR = Math.min(2, window.devicePixelRatio || 1);
      cv.width = S.W * S.DPR; cv.height = S.H * S.DPR; over.setAttribute("viewBox", `0 0 ${S.W} ${S.H}`);
      S.geo = S.fitMap(cfg.extent);
      dots.forEach((d) => { if (d.lon != null) [d._mx, d._my] = S.geo(d.lon, d.lat); });
      if (cfg.prepare) cfg.prepare(S);
      LAY = beats.map((b) => { const L = { x: new Float32Array(N), y: new Float32Array(N), r: new Float32Array(N), a: new Float32Array(N), c: new Uint8Array(N * 3) };
        dots.forEach((d, i) => { const t = b.layout(d, S); L.x[i] = t.x; L.y[i] = t.y; L.r[i] = t.r; L.a[i] = t.a; L.c[i * 3] = t.c[0]; L.c[i * 3 + 1] = t.c[1]; L.c[i * 3 + 2] = t.c[2]; }); return L; });
      beats.forEach((b) => (b.svg = b.overlay ? b.overlay(S) : ""));
      last = null; render();
    }
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function state() {
      const mid = window.innerHeight * 0.55, tops = stepEls.map((e) => e.getBoundingClientRect().top);
      let i = 0; while (i + 1 < tops.length && tops[i + 1] <= mid) i++;
      const span = i + 1 < tops.length ? tops[i + 1] - tops[i] : 1, p = Math.max(0, Math.min(1, (mid - tops[i]) / span));
      return { i, t: i + 1 < tops.length ? ease(Math.max(0, Math.min(1, (p - 0.55) / 0.45))) : 0 };
    }
    function render() {
      const s = state(), key = s.i + ":" + s.t.toFixed(3); if (key === last) return; last = key;
      const A = LAY[s.i], B = LAY[Math.min(s.i + 1, LAY.length - 1)], t = s.t;
      ctx.setTransform(S.DPR, 0, 0, S.DPR, 0, 0); ctx.clearRect(0, 0, S.W, S.H);
      for (let k = 0; k < N; k++) {
        const a = A.a[k] + (B.a[k] - A.a[k]) * t; if (a < 0.02) continue;
        const c0 = k * 3;
        ctx.fillStyle = `rgba(${Math.round(A.c[c0] + (B.c[c0] - A.c[c0]) * t)},${Math.round(A.c[c0 + 1] + (B.c[c0 + 1] - A.c[c0 + 1]) * t)},${Math.round(A.c[c0 + 2] + (B.c[c0 + 2] - A.c[c0 + 2]) * t)},${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(A.x[k] + (B.x[k] - A.x[k]) * t, A.y[k] + (B.y[k] - A.y[k]) * t, Math.max(0.6, A.r[k] + (B.r[k] - A.r[k]) * t), 0, 6.2832); ctx.fill();
      }
      over.innerHTML = `<g opacity="${(1 - Math.min(1, t * 2)).toFixed(2)}">${beats[s.i].svg}</g>` + (t > 0.5 ? `<g opacity="${((t - 0.5) * 2).toFixed(2)}">${beats[Math.min(s.i + 1, beats.length - 1)].svg}</g>` : "");
      $("prog").style.width = ((window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100).toFixed(1) + "%";
      $("cap").textContent = beats[Math.min(t > 0.5 ? s.i + 1 : s.i, beats.length - 1)].cap || "";
    }
    let raf = 0; window.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }, { passive: true });
    let rz = 0; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(layout, 150); });
    layout();
    if (location.hash.startsWith("#b-") && $(location.hash.slice(1))) { const e = $(location.hash.slice(1)); window.scrollTo(0, e.getBoundingClientRect().top + scrollY + e.offsetHeight * 0.35 - innerHeight * 0.55); render(); }
    // for the clip and film scripts: one hook, number and sub-line per beat
    window.STORY_META = { title: cfg.title, slug: cfg.slug, link: cfg.link, beats: beats.map((b) => ({ id: b.id, hook: b.hook, stat: b.stat, sub: b.sub })) };
    window.storyReady = true;
  }
  window.StoryEngine = { create, rng, randIn, inPoly, CEN, BB, C, SEQ, nf };
})();
