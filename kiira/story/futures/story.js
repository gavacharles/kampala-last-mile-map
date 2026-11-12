/* 1,200 futures: every suburb run 12 times with different prices, demand and trust. One dot per suburb-future. */
(function () {
  "use strict";
  const E = window.StoryEngine, D0 = window.SDATA, C = E.C, nf = E.nf;
  const SUB = Object.fromEntries(D0.subs.map((s) => [s.sid, s]));
  const dots = D0.dots.map(([sid, i, diff, npvE, diesel, capex, demand, tariff, win]) => ({ sid, i, diff, npvE, diesel, capex, demand, tariff, win, seg: SUB[sid].segment }));
  const n = dots.length, wins = dots.filter((d) => d.diff > 0).length, prof = dots.filter((d) => d.npvE > 0).length;
  const winCount = [0, 1, 2].map((k) => dots.filter((d) => d.win === k).length);
  const minDiesel = Math.min(...dots.map((d) => d.diesel)), cheap = dots.filter((d) => d.diesel < minDiesel + 300);
  const dear = dots.filter((d) => d.capex > 1.28);
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const col = (d) => (d.diff > 0 ? C.aqua : C.grey);
  const FARE = [["Flat UGX 1,000", C.blue], ["Learning dynamic", C.aqua], ["Inclusive", C.orange]];
  let swarm, scat = {};
  // beeswarm-style stacking along x
  function stack(S, key, lo, hi, filter) {
    const x = (v) => 50 + ((v - lo) / (hi - lo)) * (S.W - 90), bins = {}, bw = 5, out = new Map();
    dots.filter(filter || (() => true)).slice().sort((a, b) => a[key] - b[key]).forEach((d) => { const b = Math.round(x(Math.max(lo, Math.min(hi, d[key]))) / bw); bins[b] = (bins[b] || 0) + 1; out.set(d, [b * bw, S.H - 50 - bins[b] * 4.6]); });
    const mx = Math.max(...Object.values(bins)); if (mx * 4.6 > S.H - 130) { const k = (S.H - 130) / (mx * 4.6); out.forEach((p) => (p[1] = S.H - 50 - (S.H - 50 - p[1]) * k)); }
    return { pos: out, x };
  }
  function scatter(S, key, lo, hi) {
    const ylo = Math.min(0, ...dots.map((d) => d.diff)), yhi = Math.max(...dots.map((d) => d.diff)) * 1.05;
    const x = (v) => 60 + ((v - lo) / (hi - lo)) * (S.W - 100), y = (v) => S.H - 50 - ((v - ylo) / (yhi - ylo)) * (S.H - 120);
    return { x, y, ylo, yhi };
  }
  const beats = [
    { id: "map", hook: "Every suburb, 12 possible futures", stat: "1,200 futures", sub: "each with its own fuel and vehicle prices, demand and trust",
      html: `<h2>Every suburb, 12 possible futures</h2><p>Nobody knows what diesel will cost in 2030, how much Kiira's vehicles will cost, or how many people will ride. So the model runs every suburb <b>12 times</b>, each time drawing those inputs from wide ranges.</p><p>Each dot is one suburb in one of those futures: <span class="k">1,200</span> in all.</p>`,
      cap: "One dot = one suburb in one future.", layout: (d) => ({ x: d._mx, y: d._my, r: 2.6, c: col(d), a: 0.9 }),
      overlay: (S) => S.legendRow([["Electric earns more", C.aqua], ["Diesel earns more", C.grey]]) },
    { id: "spread", hook: "Electric earns more in almost every one", stat: `${nf(wins)} of ${nf(n)} futures`, sub: "Kiira e-shuttle minus a diesel taxi, 10-year value per suburb",
      html: `<h2>Electric earns more in almost every one</h2><p>In each future, the same families, fares and routes are run twice: once with Kiira 14-seat e-shuttles, once with diesel 14-seat taxis. Here the dots line up by how much more the e-shuttle earns over 10 years.</p><p>The e-shuttle comes out ahead in <span class="k">${nf(wins)} of ${nf(n)}</span>.</p>`,
      cap: "Extra 10-year value of an e-shuttle over a diesel taxi.", layout: (d) => { const p = swarm.pos.get(d); return { x: p[0], y: p[1], r: 2.1, c: col(d), a: 0.9 }; },
      overlay: (S) => S.axis(swarm.x, [0, 0.5, 1, 1.5, 2, 3, 4].filter((v) => v <= swarm.hi), (v) => "+$" + v + "m", "e-shuttle minus diesel, USD million per suburb over 10 years") + `<line x1="${swarm.x(0)}" x2="${swarm.x(0)}" y1="60" y2="${S.H - 40}" stroke="#0b0b0b" stroke-dasharray="3 3"/><text x="${swarm.x(0) + 6}" y="72">diesel better ← | → electric better</text>` },
    { id: "diesel", hook: "Even when diesel is cheap", stat: `Still ahead at UGX ${nf(minDiesel)}/L`, sub: "the lowest diesel price drawn in any future",
      html: `<h2>Even when diesel is cheap</h2><p>Spread the futures by the diesel price drawn, from UGX ${nf(minDiesel)} to 6,200 a litre. Cheap diesel narrows the gap, but even in the cheapest-diesel futures the e-shuttle earns more in <span class="k">${Math.round((100 * cheap.filter((d) => d.diff > 0).length) / Math.max(1, cheap.length))}%</span> of suburbs.</p>`,
      cap: "Each future placed by its diesel price.", layout: (d) => { const s = scat.diesel; return { x: s.x(d.diesel), y: s.y(d.diff), r: 2.2, c: col(d), a: 0.85 }; },
      overlay: (S) => { const s = scat.diesel; return S.axis(s.x, [4400, 4800, 5200, 5600, 6000], (v) => nf(v), "diesel price drawn, UGX per litre") + `<line x1="60" x2="${S.W - 30}" y1="${s.y(0)}" y2="${s.y(0)}" stroke="#0b0b0b" stroke-dasharray="3 3"/><text x="64" y="${s.y(0) - 6}">break-even</text><text class="h" x="64" y="40">e-shuttle advantage ↑</text>`; } },
    { id: "capex", hook: "Even when Kiira's vehicles cost more", stat: `${Math.round((100 * dear.filter((d) => d.diff > 0).length) / Math.max(1, dear.length))}% still ahead`, sub: "in futures where Kiira prices are 28–35% above plan",
      html: `<h2>Even when Kiira's vehicles cost more</h2><p>Now spread them by the price of Kiira's vehicles and chargers, from 15% below to 35% above the planning figure. The e-shuttle costs more to buy, but far less to run. In futures where Kiira prices are 28% or more above plan, it still earns more in <span class="k">${Math.round((100 * dear.filter((d) => d.diff > 0).length) / Math.max(1, dear.length))}%</span>.</p>`,
      cap: "Each future placed by Kiira's vehicle price.", layout: (d) => { const s = scat.capex; return { x: s.x(d.capex), y: s.y(d.diff), r: 2.2, c: col(d), a: 0.85 }; },
      overlay: (S) => { const s = scat.capex; return S.axis(s.x, [0.9, 1, 1.1, 1.2, 1.3], (v) => (v >= 1 ? "+" : "−") + Math.abs(Math.round((v - 1) * 100)) + "%", "Kiira vehicle and charger prices against plan") + `<line x1="60" x2="${S.W - 30}" y1="${s.y(0)}" y2="${s.y(0)}" stroke="#0b0b0b" stroke-dasharray="3 3"/><text class="h" x="64" y="40">e-shuttle advantage ↑</text>`; } },
    { id: "demand", hook: "Riders decide how big the gap is", stat: "More riders, bigger lead", sub: "more kilometres on cheap power widen the electric advantage",
      html: `<h2>Riders decide how big the gap is</h2><p>Demand matters most. With more riders, the fleet runs more kilometres, and every kilometre is cheaper on electricity than on diesel, so the lead grows. With fewer riders the lead shrinks, but it rarely disappears.</p>`,
      cap: "Each future placed by its demand level.", layout: (d) => { const s = scat.demand; return { x: s.x(d.demand), y: s.y(d.diff), r: 2.2, c: col(d), a: 0.85 }; },
      overlay: (S) => { const s = scat.demand; return S.axis(s.x, [0.7, 0.8, 0.9, 1, 1.1, 1.2], (v) => Math.round(v * 100) + "%", "demand against the central estimate") + `<line x1="60" x2="${S.W - 30}" y1="${s.y(0)}" y2="${s.y(0)}" stroke="#0b0b0b" stroke-dasharray="3 3"/><text class="h" x="64" y="40">e-shuttle advantage ↑</text>`; } },
    { id: "operator", hook: "The uncertain part: operator profit", stat: `Profitable in ${Math.round((100 * prof) / n)}% of futures`, sub: "e-shuttles with learning fares, pickup and restocking",
      html: `<h2>The uncertain part: operator profit</h2><p>Choosing electric over diesel is a safe bet. Whether a feeder pays for itself is less certain. Here each dot is the e-shuttle operator's own 10-year value in that suburb and future: profitable in <span class="k">${Math.round((100 * prof) / n)}%</span> of them (blue). Thin, far-out suburbs are where it loses.</p>`,
      cap: "Operator's 10-year value per suburb, e-shuttles.", layout: (d) => { const p = swarm.op.pos.get(d); return { x: p[0], y: p[1], r: 2.1, c: d.npvE > 0 ? C.blue : C.orange, a: 0.9 }; },
      overlay: (S) => { const x = swarm.op.x; return S.axis(x, [-1, -0.5, 0, 0.5, 1].filter((v) => v >= swarm.op.lo && v <= swarm.op.hi), (v) => (v < 0 ? "−$" : "$") + Math.abs(v) + "m", "operator's 10-year value per suburb, USD million") + `<line x1="${x(0)}" x2="${x(0)}" y1="60" y2="${S.H - 40}" stroke="#0b0b0b" stroke-dasharray="3 3"/>` + S.legendRow([["Profitable", C.blue], ["Loses money", C.orange]]); } },
    { id: "fares", hook: "Which fare rule makes the most money?", stat: `Learning fares in ${Math.round((100 * winCount[1]) / n)}%`, sub: "operator's best fare rule in each suburb-future",
      html: `<h2>Which fare rule makes the most money?</h2><p>In each future, which way of setting fares earns the operator most? Fares that learn month by month win in <span class="k">${Math.round((100 * winCount[1]) / n)}%</span>, a flat UGX 1,000 in ${Math.round((100 * winCount[0]) / n)}%, and inclusive fares in ${Math.round((100 * winCount[2]) / n)}%. Inclusive fares are kinder to families but cost the operator, which is why the lab weighs both.</p>`,
      cap: "Best fare rule for the operator, by suburb-future.", layout: (d) => { const p = swarm.fares.pos.get(d); return { x: p[0], y: p[1], r: swarm.fares.step * 0.42, c: FARE[d.win][1], a: 0.95 }; },
      overlay: (S) => S.colLabels(swarm.fares, FARE.map((f) => f[0]), winCount.map((c) => nf(c) + " futures")) },
    { id: "end", hook: "Electric holds in every suburb", stat: "Every suburb, nearly every future", sub: "change the ranges yourself and re-run the agents in the futures lab",
      html: `<h2>Electric holds in every suburb</h2><p>Back on the map: whatever happens to fuel, vehicle prices, power or demand, the electric 14-seater stays the better buy almost everywhere. What remains uncertain is how much the operator earns, and that depends on fares, routes and take-up, which can be managed.</p><p>Change the ranges and re-run every agent in the <a href="../../futures/">futures lab</a>.</p>`,
      cap: "One dot = one suburb in one future.", layout: (d) => ({ x: d._mx, y: d._my, r: 2.6, c: col(d), a: 0.9 }),
      overlay: (S) => S.legendRow([["Electric earns more", C.aqua], ["Diesel earns more", C.grey]]) },
  ];
  E.create({
    title: "1,200 futures", slug: "futures", link: "gavacharles.github.io/kampala-last-mile-map/kiira/story/futures", dots, beats,
    prepare(S) {
      // each suburb's 12 futures in a small ring around its centre
      dots.forEach((d) => { const [lon, lat] = E.CEN[d.sid] || [32.58, 0.33]; const p = S.geo(lon, lat), a = (d.i / 12) * 2 * Math.PI; d._mx = p[0] + Math.cos(a) * 5.5; d._my = p[1] + Math.sin(a) * 5.5; });
      const hi = Math.max(...dots.map((d) => d.diff)); swarm = stack(S, "diff", Math.min(0, ...dots.map((d) => d.diff)), hi * 1.02); swarm.hi = hi;
      const olo = Math.max(-1.2, Math.min(...dots.map((d) => d.npvE))), ohi = Math.min(1.5, Math.max(...dots.map((d) => d.npvE)));
      swarm.op = stack(S, "npvE", olo, ohi); swarm.op.lo = olo; swarm.op.hi = ohi;
      swarm.fares = S.grids([0, 1, 2].map((k) => dots.filter((d) => d.win === k)));
      scat.diesel = scatter(S, "diesel", 4250, 6250); scat.capex = scatter(S, "capex", 0.84, 1.36); scat.demand = scatter(S, "demand", 0.63, 1.22);
    },
  });
})();
