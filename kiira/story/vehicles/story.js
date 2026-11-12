/* From Jinja to the street: every Kiira-built vehicle in the best-option network, from the plant to its suburb, to the depot at night, to jobs. */
(function () {
  "use strict";
  const E = window.StoryEngine, D0 = window.SDATA, C = E.C, nf = E.nf, K = window.KIIRA;
  const R = E.rng(9);
  const dots = [];
  D0.subs.forEach((s) => { for (let i = 0; i < s.fleet; i++) { const [lon, lat] = E.randIn(s.sid, R); dots.push({ sid: s.sid, i, start: s.start, year: 2027 + Math.floor(s.start / 52), q: Math.floor(s.start / 13), midi: s.vehicle === "midi", hub: s.hub, lon, lat, idle: i % 10 < 3 }); } });
  const N = dots.length, YEARS = [...new Set(dots.map((d) => d.year))].sort();
  const YC = [C.blue, C.aqua, C.amber, C.orange, C.violet];
  const ycol = (d) => YC[Math.min(YC.length - 1, YEARS.indexOf(d.year))];
  // nearest charging depot for each suburb
  const DEP = K.geo.depots.features.map((f) => ({ id: f.properties.depot, name: f.properties.site, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], n: 0 }));
  const cen = E.CEN;
  const depOf = {}; D0.subs.forEach((s) => { const c = cen[s.sid]; let b = 0, bd = 1e9; DEP.forEach((d, j) => { const dd = (d.lon - c[0]) ** 2 + (d.lat - c[1]) ** 2; if (dd < bd) { bd = dd; b = j; } }); depOf[s.sid] = b; });
  dots.forEach((d) => { d.dep = depOf[d.sid]; d.k = DEP[d.dep].n++; });
  // jobs: share the dots out in proportion to each kind of job
  const J = D0.jobs, jt = J.drivers + J.tech + J.plant + J.couriers, per = jt / N;
  const JK = [["Drivers", J.drivers, C.blue], ["Depot and charging", J.tech, C.aqua], ["Kiira plant (job-years)", J.plant, C.violet], ["Couriers", J.couriers, C.orange]];
  let acc = 0; const cut = JK.map((j) => (acc += j[1] / jt));
  dots.forEach((d, i) => { const u = (i * 0.61803) % 1; d.job = cut.findIndex((c) => u < c); });
  const months = Math.max(...dots.map((d) => d.start)) / 4.33;
  let G = {};
  const beats = [
    { id: "plant", hook: "Every vehicle starts at Kiira's plant in Jinja", stat: `${nf(N)} vehicles`, sub: "for the best option in all 100 suburbs",
      html: `<h2>Every vehicle starts in Jinja</h2><p>Each dot is one vehicle the network needs: <span class="k">${nf(N)}</span> in all, almost all of them Kiira 14-seat e-shuttles${dots.some((d) => d.midi) ? ", with some Kayoola 8 m e-midi buses" : ""}. They are built at the Kiira Vehicle Plant in Jinja, 80 km east of Kampala.</p>`,
      cap: "One dot = one vehicle.", layout: (d) => { const p = G.plant.get(d); return { x: p[0], y: p[1], r: 2.4, c: C.blue, a: 0.9 }; }, overlay: (S) => `<text class="h" x="${S.W * 0.62}" y="${S.H * 0.18}">Kiira Vehicle Plant, Jinja</text><text x="${S.W * 0.62}" y="${S.H * 0.18 + 18}">80 km east of Kampala</text>` },
    { id: "queue", hook: "The plant sets the pace", stat: `${Math.round(months)} months to build them all`, sub: `at 40% of the plant's output (${nf(D0.plantPerYear)} vehicles a year at first)`,
      html: `<h2>The plant sets the pace</h2><p>If the programme takes 40% of the plant's output (about ${nf(D0.plantPerYear)} vehicles a year at first), building them all takes about <span class="k">${Math.round(months)} months</span>. Here they line up by the quarter they are delivered, coloured by year. Suburbs with the most need go first.</p>`,
      cap: "Vehicles by the quarter they leave the plant.", layout: (d) => { const p = G.queue.pos.get(d); return { x: p[0], y: p[1], r: G.queue.step * 0.42, c: ycol(d), a: 0.95 }; },
      overlay: (S) => YEARS.map((y, j) => `<circle cx="${20 + j * 70}" cy="16" r="5" fill="rgb(${YC[j]})"/><text x="${32 + j * 70}" y="20">${y}</text>`).join("") + `<text x="${S.W - 30}" y="${S.H - 14}" text-anchor="end">quarters from the start of the programme →</text>` },
    { id: "road", hook: "Out to 100 suburbs", stat: `${YEARS[0]}–${YEARS[YEARS.length - 1]}`, sub: "colour shows the year each suburb's fleet arrives",
      html: `<h2>Out to 100 suburbs</h2><p>Each vehicle goes to its suburb, where it runs the feeder to the nearest main-road hub. The colour shows the year it arrives: the inner city and the most crowded suburbs first, the urban edge later.</p>`,
      cap: "Vehicles in their suburbs, coloured by year of arrival.", layout: (d) => ({ x: d._mx, y: d._my, r: 1.9, c: ycol(d), a: 0.9 }),
      overlay: (S) => YEARS.map((y, j) => `<circle cx="${20 + j * 70}" cy="16" r="5" fill="rgb(${YC[j]})"/><text x="${32 + j * 70}" y="20">${y}</text>`).join("") },
    { id: "midday", hook: "At midday, a third are parked", stat: "~30% idle from 9 to 4", sub: "time they can spend carrying shop stock instead",
      html: `<h2>At midday, a third are parked</h2><p>After the morning peak, fewer shuttles are needed. About <span class="k">30%</span> wait at the hub (grey) until the evening rush. With the seats folded, those idle shuttles can carry shop stock from the wholesale district. An electric one does this more cheaply than hiring a van, because each kilometre costs so little.</p>`,
      cap: "Midday: running (blue) and parked at the hub (grey).", layout: (d) => (d.idle ? { x: d._hx, y: d._hy, r: 2.2, c: C.grey, a: 0.95 } : { x: d._mx, y: d._my, r: 1.9, c: C.blue, a: 0.9 }),
      overlay: (S) => S.legendRow([["Running", C.blue], ["Parked at the hub", C.grey]]) },
    { id: "night", hook: "At night they charge at 12 depots", stat: `${nf(D0.charging.eveUnmanaged, 1)} MW avoided`, sub: "at the evening peak, by charging after 11 pm on off-peak power",
      html: `<h2>At night they charge at 12 depots</h2><p>After the last trip, every vehicle goes to one of 12 depots on sites screened in the Kampala E-Mobility Atlas, and charges overnight on cheap off-peak power. If they plugged in straight after work instead, they would add about <span class="k">${nf(D0.charging.eveUnmanaged, 1)} MW</span> to Kampala's evening peak.</p>`,
      cap: "Overnight: every vehicle at its charging depot.", layout: (d) => { const p = G.dep(d); return { x: p[0], y: p[1], r: 1.7, c: C.aqua, a: 0.9 }; },
      overlay: (S) => DEP.filter((d) => d.n >= 220).map((d) => { const p = S.geo(d.lon, d.lat); return `<text x="${p[0] + 1.3 * Math.sqrt(d.n) + 6}" y="${p[1] + 4}" style="font-size:11px">${d.name.split(/[ (]/)[0]} · ${d.n}</text>`; }).join("") + S.legendRow([["Vehicles charging overnight at a depot", C.aqua]]) },
    { id: "jobs", hook: "Each vehicle means jobs", stat: `${nf(jt)} jobs`, sub: `about ${per.toFixed(1)} per vehicle: driving, depots and charging, the plant, couriers`,
      html: `<h2>Each vehicle means jobs</h2><p>Every vehicle needs about 2.2 drivers, a share of depot and charging staff, and work at the plant that a diesel import would never create. In all, about <span class="k">${nf(jt)}</span> jobs, about ${per.toFixed(1)} per vehicle. Each dot here stands for ${per.toFixed(1)} jobs.</p>`,
      cap: `One dot ≈ ${per.toFixed(1)} jobs.`, layout: (d) => { const p = G.jobs.pos.get(d); return { x: p[0], y: p[1], r: G.jobs.step * 0.42, c: JK[d.job][2], a: 0.95 }; },
      overlay: (S) => S.colLabels(G.jobs, JK.map((j) => j[0]), JK.map((j) => nf(j[1]) + " jobs")) },
  ];
  E.create({
    title: "From Jinja to the street", slug: "vehicles", link: "gavacharles.github.io/kampala-last-mile-map/kiira/story/vehicles", dots, beats,
    prepare(S) {
      // plant: a dense block at the right of the stage
      const cols = Math.ceil(Math.sqrt(N * 0.8)), st = Math.min(6, (S.W * 0.34) / cols);
      G.plant = new Map(dots.map((d, i) => [d, [S.W * 0.62 + (i % cols) * st, S.H * 0.25 + Math.floor(i / cols) * st]]));
      const qs = [...new Set(dots.map((d) => d.q))].sort((a, b) => a - b);
      G.queue = S.grids(qs.map((q) => dots.filter((d) => d.q === q)), { top: 60 });
      dots.forEach((d) => { const p = S.geo(d.hub[0], d.hub[1]), a = d.i * 2.39996, r = 1.4 * Math.sqrt(d.i); d._hx = p[0] + Math.cos(a) * r; d._hy = p[1] + Math.sin(a) * r; });
      G.dep = (d) => { const dp = DEP[d.dep], p = S.geo(dp.lon, dp.lat), a = d.k * 2.39996, r = 1.25 * Math.sqrt(d.k); return [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]; };
      G.jobs = S.grids([0, 1, 2, 3].map((k) => dots.filter((d) => d.job === k)));
    },
  });
})();
