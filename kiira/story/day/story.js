/* A day on the network: one dot per 100 feeder trips, from the first riders at 05:00 to the last at 22:00. */
(function () {
  "use strict";
  const E = window.StoryEngine, D0 = window.SDATA, C = E.C, nf = E.nf;
  const HOURS = D0.hours, PER = {}; D0.periods.forEach((p, i) => p.hours.forEach((h) => (PER[h] = i)));
  const R = E.rng(5), dots = [];
  let totalTrips = 0, totes = 0;
  D0.subs.forEach((s) => {
    totes += s.totes;
    s.servedH.forEach((v, k) => { totalTrips += v; const n = Math.round(v / 100); for (let i = 0; i < n; i++) { const [lon, lat] = E.randIn(s.sid, R); dots.push({ sid: s.sid, h: HOURS[k], k, fare: s.fares[PER[HOURS[k]]], hub: s.hub, lon, lat, j: i }); } });
  });
  const N = dots.length, inH = (d, a, b) => d.h >= a && d.h <= b;
  const peakAM = dots.filter((d) => inH(d, 7, 8)).length * 100, mid = dots.filter((d) => inH(d, 9, 15)).length * 100, peakPM = dots.filter((d) => inH(d, 16, 18)).length * 100;
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1] || 0; };
  const fPeak = med(dots.filter((d) => inH(d, 7, 8) || inH(d, 16, 18)).map((d) => d.fare)), fOff = med(dots.filter((d) => inH(d, 9, 15)).map((d) => d.fare));
  const FB = [[0, 800, [158, 197, 244]], [800, 1000, [110, 165, 227]], [1000, 1300, C.blue], [1300, 1700, [26, 86, 160]], [1700, 9e9, [15, 55, 104]]];
  const fcol = (d) => FB.find((b) => d.fare >= b[0] && d.fare < b[1])[2];
  let G = {};
  const home = (d, c, a = 0.9) => ({ x: d._mx, y: d._my, r: 1.8, c, a });
  const atHub = (d, c, a = 0.9) => ({ x: d._hx, y: d._hy, r: 1.8, c, a });
  const clock = (S, t) => `<text class="big" x="${S.W - 30}" y="44" text-anchor="end">${t}</text>`;
  const beats = [
    { id: "dawn", hook: "05:00. The first riders leave home", stat: "Before sunrise", sub: "when walking in the dark feels longest",
      html: `<h2>05:00. The first riders leave home</h2><p>Each dot is 100 trips on the feeder shuttles in a day. Before sunrise the first ones head for the main road. A long walk in the dark is when a shuttle feels most worth paying for.</p>`,
      cap: "One dot = 100 shuttle trips. Lit: trips that have started.", layout: (d) => (d.h <= 6 ? home(d, C.amber, 0.95) : home(d, C.light, 0.12)), overlay: (S) => clock(S, "05:00–07:00") },
    { id: "am", hook: "07:00–09:00. The morning rush", stat: `${nf(Math.round(peakAM / 1000))}k trips in two hours`, sub: "everyone heads for the hub at once",
      html: `<h2>07:00–09:00. The morning rush</h2><p>In two hours, <span class="k">${nf(peakAM)}</span> trips converge on the hubs on the main roads. This is the peak that decides how many shuttles each suburb needs.</p>`,
      cap: "Morning trips move from homes to their hub.", layout: (d) => (d.h <= 8 ? atHub(d, d.h <= 6 ? C.amber : C.orange, 0.92) : home(d, C.light, 0.12)), overlay: (S) => clock(S, "07:00–09:00") },
    { id: "mid", hook: "Midday. Quieter, and cheaper", stat: `Fares fall to UGX ${nf(fOff)}`, sub: `and spare seats carry about ${nf(Math.round(totes / 1000))}k totes of shop stock a day`,
      html: `<h2>Midday. Quieter, and cheaper</h2><p>Between 9 and 4, trips thin out to errands, school and shift work: ${nf(mid)} in all. Fares fall to fill the seats, to about UGX ${nf(fOff)} against ${nf(fPeak)} at the peaks. The empty seats and racks carry about <span class="k">${nf(totes)}</span> totes of shop stock.</p>`,
      cap: "Midday trips; fares fall to fill empty seats.", layout: (d) => (inH(d, 9, 15) ? home(d, C.aqua, 0.95) : d.h <= 8 ? atHub(d, C.light, 0.25) : home(d, C.light, 0.1)), overlay: (S) => clock(S, "09:00–16:00") },
    { id: "pm", hook: "16:00–19:00. Everyone heads home", stat: `${nf(Math.round(peakPM / 1000))}k trips`, sub: "the evening peak, back from the hubs to the suburbs",
      html: `<h2>16:00–19:00. Everyone heads home</h2><p>The evening peak runs the other way: <span class="k">${nf(peakPM)}</span> trips from the hubs back into the suburbs.</p>`,
      cap: "Evening trips flow from the hubs back home.", layout: (d) => (inH(d, 16, 18) ? home(d, C.violet, 0.95) : d.h > 18 ? atHub(d, C.light, 0.12) : home(d, C.light, 0.15)), overlay: (S) => clock(S, "16:00–19:00") },
    { id: "late", hook: "After dark, a shuttle beats the walk", stat: "Until 23:00", sub: "late trips are where walking feels least safe",
      html: `<h2>After dark, a shuttle beats the walk</h2><p>Trips carry on into the night, fewer but valued highly: after dark, a long walk feels slower and less safe, so riders will pay more for the shuttle.</p>`,
      cap: "Late trips, 19:00–23:00.", layout: (d) => (d.h >= 19 ? home(d, C.blue, 0.95) : home(d, C.light, 0.12)), overlay: (S) => clock(S, "19:00–23:00") },
    { id: "clock", hook: "The whole day, hour by hour", stat: `${nf(Math.round(totalTrips / 1000))}k trips a day`, sub: "two peaks, and a long quiet middle",
      html: `<h2>The whole day, hour by hour</h2><p>Stack every dot by the hour it starts and the shape of a Kampala day appears: two sharp peaks and a long, quieter middle. <span class="k">${nf(Math.round(totalTrips))}</span> trips a day across 100 suburbs.</p>`,
      cap: "Trips by starting hour.", layout: (d) => { const p = G.hours.pos.get(d); return { x: p[0], y: p[1], r: G.hours.step * 0.42, c: C.blue, a: 0.9 }; },
      overlay: (S) => HOURS.map((h, j) => `<text x="${G.hours.left + j * G.hours.gw + G.hours.gw / 2}" y="${S.H - 18}" text-anchor="middle" style="font-size:11px">${h}</text>`).join("") + `<text x="${S.W - 20}" y="${S.H - 2}" text-anchor="end" style="font-size:11px">hour of day</text>` },
    { id: "fares", hook: "Fares follow the crowd", stat: `UGX ${nf(fPeak)} peak, ${nf(fOff)} midday`, sub: "fares learned month by month, suburb by suburb",
      html: `<h2>Fares follow the crowd</h2><p>Colour each trip by the fare paid. Operators learn fares month by month: higher when buses are full, lower when they run empty. The typical peak fare is <span class="k">UGX ${nf(fPeak)}</span>, against <span class="k">UGX ${nf(fOff)}</span> at midday, always below a boda.</p>`,
      cap: "Trips by hour, coloured by the fare paid.", layout: (d) => { const p = G.hours.pos.get(d); return { x: p[0], y: p[1], r: G.hours.step * 0.42, c: fcol(d), a: 0.95 }; },
      overlay: (S) => S.legendRow(FB.map((b) => [b[1] > 5e3 ? `UGX ${nf(b[0])}+` : `UGX ${nf(b[0])}–${nf(b[1])}`, b[2]])) },
  ];
  E.create({
    title: "A day on the network", slug: "day", link: "gavacharles.github.io/kampala-last-mile-map/kiira/story/day", dots, beats,
    prepare(S) {
      const cnt = {}; dots.forEach((d) => { const key = d.hub.join(","); const k = (cnt[key] = (cnt[key] || 0) + 1); const p = S.geo(d.hub[0], d.hub[1]), a = k * 2.39996, r = 1.2 * Math.sqrt(k); d._hx = p[0] + Math.cos(a) * r; d._hy = p[1] + Math.sin(a) * r; });
      G.hours = S.grids(HOURS.map((h) => dots.filter((d) => d.h === h).sort((a, b) => a.fare - b.fare)), { top: 50, bottom: 34, left: 14 });
    },
  });
})();
