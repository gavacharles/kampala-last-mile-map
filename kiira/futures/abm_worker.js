// Runs the agent-based model off the page's main thread so the map stays responsive.
self.window = self;
importScripts("../kiira_model.js", "kiira_abm.js");
const A = self.KiiraABM;
let stop = false;
onmessage = (e) => {
  const m = e.data;
  if (m.type === "stop") { stop = true; return; }
  if (m.type === "grid") {
    stop = false;
    const t0 = Date.now();
    const grid = {};
    for (let i = 0; i < m.subs.length; i++) {
      if (stop) { postMessage({ type: "stopped" }); return; }
      const s = m.subs[i];
      grid[s.sid] = A.stats(A.suburbGrid(s, m.params, m.reps, 11));
      postMessage({ type: "suburb", sid: s.sid, stats: grid[s.sid], done: i + 1, n: m.subs.length, ms: Date.now() - t0 });
    }
    postMessage({ type: "chunkDone" });
  }
  if (m.type === "net") {
    // Network roll-out with each suburb on its chosen option (ids from the page's ranking).
    const net = A.network(m.subs, m.params, (s) => { const id = m.choice[s.sid].split("|"); return { vehicle: id[0], pricing: id[1], agg: id[2] === "1" }; });
    postMessage({ type: "network", net: { startWeek: net.startWeek, weeks: net.weeks.map((w) => ({ wk: w.wk, riders: w.riders, fleet: w.fleet, boda: w.boda, orders: w.orders, live: w.suburbsLive, by: w.by })) } });
  }
  if (m.type === "one") {
    // One suburb, one option, one future, week by week: the "watch it unfold" chart.
    const o = A.OPTIONS.find((x) => x.id === m.id);
    const r = A.simSuburb(m.sub, A.merge(A.DEFAULTS, m.params), o, m.seed || 5, true);
    postMessage({ type: "one", sid: m.sub.sid, id: m.id, weekly: r.weekly, fares: r.fares });
  }
};
