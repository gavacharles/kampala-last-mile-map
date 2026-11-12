/* A shopkeeper's week: every shop and mobile-money agent mapped on OpenStreetMap in the 100 suburbs, and what restocking by shuttle does for them. */
(function () {
  "use strict";
  const E = window.StoryEngine, D0 = window.SDATA, C = E.C, nf = E.nf, K = window.KIIRA;
  const HUB = Object.fromEntries(K.inputs.map((s) => [s.sid, s.hub]));
  const dots = D0.points.map(([lon, lat, sid, shop, dr, joined, credit]) => ({ lon, lat, sid, shop, dr, joined, credit, near: dr <= 300, trip: D0.subs[sid].trip, save: D0.subs[sid].save, km: D0.subs[sid].km }));
  const N = dots.length, near = dots.filter((d) => d.near).length, joined = dots.filter((d) => d.joined), J = joined.length;
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] || 0; };
  const tripMed = med(dots.map((d) => d.trip)), saveMed = D0.save_med;
  let G = {};
  // dot histogram: values grouped into bins of width `bw` (UGX), each bin a column of dots packed in rows
  function stack(S, key, lo, hi, list, bw) {
    const nb = Math.ceil((hi - lo) / bw), colW = (S.W - 90) / nb, x = (v) => 50 + ((v - lo) / (hi - lo)) * (S.W - 90);
    const groups = Array.from({ length: nb }, () => []);
    list.forEach((d) => groups[Math.min(nb - 1, Math.max(0, Math.floor((d[key] - lo) / bw)))].push(d));
    const mx = Math.max(...groups.map((g) => g.length)), st = Math.max(2.4, Math.min(6, Math.sqrt(((colW - 6) * (S.H - 140)) / mx)));
    const per = Math.max(1, Math.floor((colW - 6) / st)), out = new Map();
    groups.forEach((g, j) => g.forEach((d, i) => out.set(d, [50 + j * colW + 3 + (i % per) * st + st / 2, S.H - 50 - Math.floor(i / per) * st - st / 2])));
    return { pos: out, x, lo, hi, r: st * 0.42 };
  }
  const corridors = (S) => {
    const flow = {}; joined.forEach((d) => (flow[HUB[d.sid]] = (flow[HUB[d.sid]] || 0) + 1));
    const mx = Math.max(1, ...Object.values(flow)); let s = "";
    K.geo.trunks.features.forEach((f) => { const v = flow[f.properties.hub] || 0; if (!v) return; (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates).forEach((line) => { s += `<path d="${line.map(([lo, la], i) => (i ? "L" : "M") + S.geo(lo, la).map((z) => z.toFixed(1)).join(",")).join("")}" fill="none" stroke="rgb(${C.aqua})" stroke-opacity=".6" stroke-width="${(0.8 + 3.4 * Math.sqrt(v / mx)).toFixed(1)}" stroke-linecap="round"/>`; }); });
    const w = S.geo(32.5745, 0.3128); return s + `<circle cx="${w[0]}" cy="${w[1]}" r="7" fill="#0b0b0b" stroke="#fff" stroke-width="2"/><text class="h" x="${w[0] + 10}" y="${w[1] + 4}">Kikuubo and Owino</text>`;
  };
  const beats = [
    { id: "mapped", hook: "Every shop on the map", stat: `${nf(N)} mapped`, sub: `about ${nf(Math.round(D0.total_shops / 1000))},000 small shops really trade here; OpenStreetMap shows about one in ten`,
      html: `<h2>Every shop on the map</h2><p>Each dot is a shop (amber) or mobile-money agent (blue) mapped on OpenStreetMap in the 100 suburbs: <span class="k">${nf(N)}</span> in all. The real number of small shops is closer to <span class="k">${nf(Math.round(D0.total_shops / 1000))},000</span>, so treat each dot as about ten.</p>`,
      cap: "One dot = one mapped shop or agent (about ten real ones).", layout: (d) => ({ x: d._mx, y: d._my, r: 1.9, c: d.shop ? C.amber : C.blue, a: 0.85 }), overlay: (S) => S.legendRow([["Shop", C.amber], ["Mobile-money agent", C.blue]]) },
    { id: "route", hook: "Most are not on the shuttle route", stat: `${Math.round((100 * near) / N)}% within 300 m`, sub: "of their suburb's feeder route; the rest need a last hop",
      html: `<h2>Most are not on the shuttle route</h2><p>Only <span class="k">${Math.round((100 * near) / N)}%</span> are within 300 m of their suburb's feeder route (green). The rest are deeper in the neighbourhood, so anything the shuttle brings needs a short last hop, which a boda rider can do.</p>`,
      cap: "Green: within 300 m of the feeder route.", layout: (d) => ({ x: d._mx, y: d._my, r: 1.9, c: d.near ? C.aqua : C.grey, a: d.near ? 0.95 : 0.6 }), overlay: (S) => S.legendRow([["Within 300 m of the route", C.aqua], ["Farther", C.grey]]) },
    { id: "trip", hook: "Restocking today: shut up shop, take a boda", stat: `UGX ${nf(Math.round(tripMed / 1000) * 1000)} a trip`, sub: "boda fare there and back plus three hours closed, typical shop",
      html: `<h2>Restocking today: shut up shop, take a boda</h2><p>To restock, a shopkeeper closes, rides a boda to Kikuubo or a wholesale cluster, and rides back loaded. Counting the fare and three lost hours of trade, a trip costs about <span class="k">UGX ${nf(Math.round(tripMed / 1000) * 1000)}</span>, more the farther out the shop. Here the dots line up by that cost.</p>`,
      cap: "Shops by the cost of one restock trip today.", layout: (d) => { const p = G.trip.pos.get(d); return { x: p[0], y: p[1], r: G.trip.r, c: C.orange, a: 0.9 }; },
      overlay: (S) => S.axis(G.trip.x, S.ticks(G.trip.lo, G.trip.hi), (v) => nf(v / 1000) + "k", "cost of one restock trip, UGX (boda there and back + hours closed)") },
    { id: "join", hook: "Order by phone, stock comes by shuttle", stat: `${Math.round((100 * J) / N)}% sign up`, sub: `about ${nf(Math.round(D0.joined_shops / 1000))},000 shops across the 100 suburbs`,
      html: `<h2>Order by phone, stock comes by shuttle</h2><p>With the aggregator, a shop orders by phone. Totes leave the wholesale district on idle midday shuttles and ride the feeder to the shop's stop. In the model about <span class="k">${Math.round((100 * J) / N)}%</span> of shops sign up, more where the trip they save is long.</p>`,
      cap: "Shops that sign up for restocking (green).", layout: (d) => { const p = G.join.pos.get(d); return { x: p[0], y: p[1], r: G.join.step * 0.42, c: d.joined ? C.aqua : C.grey, a: 0.95 }; },
      overlay: (S) => S.colLabels(G.join, ["Sign up", "Not yet"], [nf(J) + " mapped shops", nf(N - J) + " mapped shops"]) },
    { id: "hop", hook: "The last hop is a boda's job", stat: `${Math.round((100 * joined.filter((d) => !d.near).length) / Math.max(1, J))}% need a boda hop`, sub: "from the shuttle stop to the shop door: paid work for riders",
      html: `<h2>The last hop is a boda's job</h2><p>Of the shops that sign up, those near the route collect their totes at the stop. The other <span class="k">${Math.round((100 * joined.filter((d) => !d.near).length) / Math.max(1, J))}%</span> need a boda for the last few hundred metres, which is paid work for riders who lose passengers to the shuttle.</p>`,
      cap: "Shops that sign up: collect at the stop, or a boda hop.", layout: (d) => { if (!d.joined) return { x: d._mx, y: d._my, r: 1, c: C.light, a: 0 }; const p = G.hop.pos.get(d); return { x: p[0], y: p[1], r: G.hop.step * 0.42, c: d.near ? C.aqua : C.orange, a: 0.95 }; },
      overlay: (S) => S.colLabels(G.hop, ["Collect at the stop", "Boda hop to the door"], [nf(joined.filter((d) => d.near).length), nf(joined.filter((d) => !d.near).length)].map((v) => v + " mapped shops")) },
    { id: "credit", hook: "Two weeks to pay", stat: "Half buy on credit", sub: "stock credit, repaid from sales; defaults are the risk",
      html: `<h2>Two weeks to pay</h2><p>About half the shops that sign up buy their stock on two-week credit, repaid as it sells. That lets a small shop carry more stock. The platform carries the risk: defaults of 0.5–3% a loan are one of the uncertain inputs in every future.</p>`,
      cap: "Shops that sign up: on credit (blue) or paying cash (green).", layout: (d) => { if (!d.joined) return { x: d._mx, y: d._my, r: 1, c: C.light, a: 0 }; const p = G.credit.pos.get(d); return { x: p[0], y: p[1], r: G.credit.step * 0.42, c: d.credit ? C.blue : C.aqua, a: 0.95 }; },
      overlay: (S) => S.colLabels(G.credit, ["On two-week credit", "Paying cash"], [nf(joined.filter((d) => d.credit).length), nf(joined.filter((d) => !d.credit).length)].map((v) => v + " mapped shops")) },
    { id: "corridors", hook: "The wholesale corridors", stat: "From Kikuubo to every hub", sub: "stock flows out along the trunk roads, then onto the feeders",
      html: `<h2>The wholesale corridors</h2><p>Put together, the orders trace corridors from the Kikuubo and Owino wholesale district out along the trunk roads to every hub. Line width shows how many shops each corridor serves.</p>`,
      cap: "Shops that sign up, and the corridors that supply them.", layout: (d) => ({ x: d._mx, y: d._my, r: d.joined ? 2 : 1.4, c: d.joined ? C.aqua : C.light, a: d.joined ? 0.95 : 0.35 }), overlay: (S) => corridors(S) },
    { id: "saving", hook: "What a shopkeeper saves", stat: `~UGX ${nf(Math.round(saveMed / 1000))},000 a month`, sub: "per shop: trips not taken, hours not closed, margin on credit stock",
      html: `<h2>What a shopkeeper saves</h2><p>No more closing to fetch stock, no boda fares there and back, and some margin on stock bought on credit. A typical shop that signs up saves about <span class="k">UGX ${nf(Math.round(saveMed / 1000))},000</span> a month, after the delivery fee and the boda hop.</p><p>Compare all six ways of using the shuttles for goods in the <a href="../../futures/#agg">futures lab</a>.</p>`,
      cap: "Shops that sign up, by monthly saving.", layout: (d) => { if (!d.joined) return { x: d._mx, y: d._my, r: 1, c: C.light, a: 0 }; const p = G.save.pos.get(d); return { x: p[0], y: p[1], r: G.save.r, c: C.aqua, a: 0.9 }; },
      overlay: (S) => S.axis(G.save.x, S.ticks(G.save.lo, G.save.hi), (v) => nf(v / 1000) + "k", "saving per shop, UGX a month") },
  ];
  E.create({
    title: "A shopkeeper's week", slug: "shops", link: "gavacharles.github.io/kampala-last-mile-map/kiira/story/shops", dots, beats,
    prepare(S) {
      const tl = Math.min(...dots.map((d) => d.trip)), th = Math.max(...dots.map((d) => d.trip));
      G.trip = stack(S, "trip", Math.floor(tl / 1000) * 1000, Math.ceil((th + 1) / 1000) * 1000, dots, 1000);
      G.join = S.grids([dots.filter((d) => d.joined), dots.filter((d) => !d.joined)]);
      G.hop = S.grids([joined.filter((d) => d.near), joined.filter((d) => !d.near)]);
      G.credit = S.grids([joined.filter((d) => d.credit), joined.filter((d) => !d.credit)]);
      const sv = joined.map((d) => d.save); G.save = stack(S, "save", Math.floor(Math.min(...sv) / 10000) * 10000, Math.ceil((Math.max(...sv) + 1) / 10000) * 10000, joined, 10000);
    },
  });
})();
