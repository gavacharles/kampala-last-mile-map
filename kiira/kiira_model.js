/* Kiira EV last-mile model for 100 Greater Kampala suburbs.
 * One file runs in Node (pipeline outputs) and in the browser (live scenario panel), so both always agree.
 *
 * Per suburb and hour of the day: residents' home-end trip legs choose between walking, a boda and a Kiira-built
 * electric feeder (multinomial logit on generalised cost). The feeder fleet is sized for the design-fare peak;
 * pricing strategies (flat, time-of-day, dynamic, inclusive-dynamic) then set fares by suburb and period on that fleet.
 * Costs cover vehicles, depot and hub charging, grid connection, drivers, energy on Uganda's time-of-use tariff,
 * maintenance and overheads. Plant output limits how fast suburbs can be served.
 * Every number in DEFAULTS is a planning assumption to be replaced with survey, operator or Kiira data.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KiiraModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const PERIODS = [
    { id: "early", label: "Early 05–07", hours: [5, 6], band: "shoulder" },
    { id: "am", label: "Morning peak 07–09", hours: [7, 8], band: "peak" },
    { id: "mid", label: "Midday 09–16", hours: [9, 10, 11, 12, 13, 14, 15], band: "off" },
    { id: "pm", label: "Evening peak 16–19", hours: [16, 17, 18], band: "peak" },
    { id: "eve", label: "Evening 19–22", hours: [19, 20, 21], band: "shoulder" },
    { id: "late", label: "Late 22–23", hours: [22], band: "off" },
  ];
  const PERIOD_OF = {};
  PERIODS.forEach((p, i) => p.hours.forEach((h) => (PERIOD_OF[h] = i)));
  // Share of a day's home-end legs starting in each hour (normalised below); a two-peak Kampala profile.
  const RAW_SHARE = { 5: 0.03, 6: 0.07, 7: 0.12, 8: 0.11, 9: 0.06, 10: 0.04, 11: 0.035, 12: 0.035, 13: 0.035, 14: 0.035, 15: 0.045, 16: 0.06, 17: 0.1, 18: 0.1, 19: 0.06, 20: 0.04, 21: 0.03, 22: 0.02 };
  const TOT = HOURS.reduce((a, h) => a + RAW_SHARE[h], 0);
  const HOUR_SHARE = HOURS.map((h) => RAW_SHARE[h] / TOT);
  const DIR = HOURS.map((h) => (h >= 7 && h <= 8 ? 0.75 : h >= 16 && h <= 18 ? 0.72 : 0.56)); // share of riders in the busier direction
  const SPEED_F = HOURS.map((h) => (h >= 7 && h <= 8 ? 0.72 : h >= 16 && h <= 18 ? 0.68 : h >= 9 && h <= 15 ? 0.88 : 1)); // congestion
  const VOT_F = HOURS.map((h) => (h >= 7 && h <= 8 ? 1.25 : h >= 16 && h <= 18 ? 1.2 : h >= 9 && h <= 15 ? 0.85 : 1)); // time pressure
  const WALK_F = HOURS.map((h) => (h <= 6 ? 1.3 : h >= 19 && h <= 21 ? 1.35 : h >= 22 ? 1.7 : 1)); // walking in the dark feels longer and less safe
  const BODA_F = HOURS.map((h) => (h >= 7 && h <= 8 ? 1.15 : h >= 16 && h <= 18 ? 1.15 : h >= 19 && h <= 21 ? 1.1 : h >= 22 || h <= 6 ? 1.25 : 1)); // boda surcharges
  const DEPLOY = HOURS.map((h) => (h >= 7 && h <= 8 ? 1 : h >= 16 && h <= 18 ? 1 : h >= 9 && h <= 15 ? 0.7 : h === 22 ? 0.5 : 0.8)); // share of fleet in service

  const VEHICLES = {
    shuttle: { key: "shuttle", name: "Kiira 14-seat e-shuttle", note: "product concept sized like a taxi; not yet in Kiira's range", cap: 14, usd: 42000, kwhKm: 0.22, battKwh: 60, maintKm: 250, depotKw: 11, depotUsd: 1800, perCharger: 1 },
    trunk: { key: "trunk", name: "Kayoola EVS 12 m", note: "90 passengers (49 seated), up to 300 km range", cap: 90, usd: 250000, kwhKm: 1.25, battKwh: 350, maintKm: 600, depotKw: 120, depotUsd: 45000, perCharger: 2 },
    midi: { key: "midi", name: "Kayoola EVS 8 m", note: "56 passengers (28 seated), ~200 km range", cap: 56, usd: 165000, kwhKm: 0.95, battKwh: 200, maintKm: 450, depotKw: 60, depotUsd: 28000, perCharger: 2 },
  };

  const DEFAULTS = {
    fx: 3650, days: 310, demandMult: 1, legRate: 0.75, align: 0.6,
    vot: 2500, votRwi: 0.45, mu: 1 / 1400, muRwi: 0.5, turnover: 1.5, ascShuttle: -0.3, ascBoda: 0,
    walkKmh: 4.5, walkW: 1.6, waitW: 1.5, shuttleKmh: 17, layover: 6, rideShare: 0.5,
    bodaMin: 2000, bodaBase: 1000, bodaPerKm: 1000, bodaKmh: 20, bodaWait: 2, bodaSafety: 600,
    designFare: 1000, loadDesign: 0.85, maxHeadway: 20, minFleet: 2,
    pricing: "dynamic", ancillaryRate: 15000, ancillaryUtil: 0.3, flatFare: 1000, tod: { peak: 1300, shoulder: 1000, off: 700 },
    fareMin: 500, fareMax: 3000, fareStep: 100, bodaCapShare: 0.85,
    csWeight: 0.5, equityRwi: 1.0, equityCap: 800, equityTarget: 1.0,
    integratedDiscount: 0, subsidyPerRide: 0,
    vehicle: "auto", midiMainShare: 0.12, midiUnpaved: 0.35,
    driverMonthly: 700000, driversPerVeh: 2.2, insurance: 0.03, fixedPerVeh: 6000000, battUsdKwh: 140, battYear: 7, overhead: 0.1, payFee: 0.02, spare: 0.1,
    capexMult: 1, grant: 0, rate: 0.12, life: 10, residual: 0.1, chargerLife: 12,
    tariff: { peak: 650.8, shoulder: 546.4, off: 414 }, tariffMult: 1, charging: "managed", chargeLoss: 0.1,
    hubUsd: 55000, hubKw: 120, hubPerVeh: 6, gridUsdKw: 180,
    plantCap: [2500, 2500, 5000, 5000, 5000, 10000, 10000, 10000, 10000, 10000], plantShare: 0.4, startYear: 2027, horizon: 10,
    ramp: [0.6, 0.85, 1],
    suburbs: 100, bodaKgKm: 0.065, gridKgKwh: 0.045, bodaTripsDay: 25, bodaLitreKm: 0.028,
    localShare: 0.3, trunkShare: 0.35, trunkKmh: 14, trunkMinKm: 2.5, trunkMinRiders: 1500, taxiKgPkm: 0.055, plantJobsPerUnit: 0.18,
  };

  function merge(a, b) {
    const o = JSON.parse(JSON.stringify(a));
    for (const k in b || {}) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? Object.assign({}, o[k], b[k]) : b[k];
    return o;
  }
  const crf = (r, n) => (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const bodaFare = (P, d) => Math.max(P.bodaMin, P.bodaBase + P.bodaPerKm * d);

  // Priority for the build order: need (people beyond a 500 m walk), viability (density), distance and low income.
  function priority(subs) {
    const rank = (arr) => { const s = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = new Array(arr.length); s.forEach((x, k) => (r[x[1]] = k / (arr.length - 1))); return r; };
    const a = rank(subs.map((s) => s.gap_pop)), b = rank(subs.map((s) => s.density)), c = rank(subs.map((s) => s.lm_gap_km)), d = rank(subs.map((s) => -s.rwi));
    return subs.map((s, i) => 0.45 * a[i] + 0.25 * b[i] + 0.15 * c[i] + 0.15 * d[i]);
  }

  /* One suburb, one fleet, one fare per period: hourly demand, service and money. */
  function evaluate(s, P, vk, N, fares) {
    const V = VEHICLES[vk];
    const vot0 = P.vot * Math.exp(P.votRwi * (s.rwi - 1.2)) / 60; // UGX per minute
    const mu = P.mu * Math.exp(-P.muRwi * (s.rwi - 1.2)); // poorer suburbs are more price-sensitive
    const classes = [
      { legs: Math.max(s.pop - s.gap_pop, 0), d: 0.3 },
      { legs: s.gap_pop, d: Math.max(s.lm_gap_km, 0.55) },
    ];
    const ride = P.rideShare * s.route_km;
    const out = { csH: [], cityCost: 0, idleVh: 0, demand: [], served: [], denied: [], cap: [], headway: [], fare: [], rev: 0, riders: 0, cs: 0, vkm: 0, fromBoda: 0, fromWalk: 0, bodaKm: 0, loadPeak: 0, seatKm: 0, paxKm: 0 };
    for (let k = 0; k < HOURS.length; k++) {
      const speed = P.shuttleKmh * SPEED_F[k];
      const cycle = (2 * s.route_km / speed) * 60 + P.layover;
      const inServ = Math.max(N * DEPLOY[k], 1);
      const hw = cycle / inServ;
      const F = fares[PERIOD_OF[HOURS[k]]];
      const paid = Math.max(F - P.integratedDiscount, 0);
      let D = 0, cs = 0, fb = 0, fw = 0, bkm = 0;
      const vot = vot0 * VOT_F[k], wW = P.walkW * WALK_F[k];
      for (const c of classes) {
        const m = c.legs * P.legRate * P.demandMult * HOUR_SHARE[k];
        const w = Math.min(c.d, 0.2 + 0.12 * c.d);
        const gW = vot * wW * (c.d / P.walkKmh) * 60;
        const gB = bodaFare(P, c.d) * BODA_F[k] + vot * (P.bodaWait + (c.d / P.bodaKmh) * 60) + P.bodaSafety;
        const gS = paid + vot * (wW * (w / P.walkKmh) * 60 + P.waitW * hw / 2 + (ride / speed) * 60);
        const eW = Math.exp(-mu * gW), eB = Math.exp(-mu * gB + P.ascBoda), eS = Math.exp(-mu * gS + P.ascShuttle);
        const pS = eS / (eW + eB + eS);
        const ma = m * P.align; // legs heading the way the feeder runs
        D += ma * pS;
        cs += (ma * Math.log((eW + eB + eS) / (eW + eB))) / mu;
        // Where riders come from: proportional substitution under the logit.
        const pB0 = eB / (eW + eB);
        fb += ma * pS * pB0; fw += ma * pS * (1 - pB0); bkm += ma * pS * pB0 * c.d;
      }
      const capDir = inServ * (60 / cycle) * V.cap * P.turnover; // seats are reused as riders board and alight along the route
      const ratio = D > 0 ? Math.min(1, capDir / (D * DIR[k])) : 1;
      const S = D * ratio;
      out.demand.push(D); out.served.push(S); out.denied.push(D - S); out.cap.push(capDir); out.headway.push(hw); out.fare.push(F);
      out.rev += S * F + S * P.subsidyPerRide;
      out.cityCost += S * (Math.min(P.integratedDiscount, F) + P.subsidyPerRide);
      out.idleVh += N * (1 - DEPLOY[k]);
      out.riders += S;
      out.cs += cs * ratio;
      out.csH.push(cs * ratio);
      out.fromBoda += fb * ratio; out.fromWalk += fw * ratio; out.bodaKm += bkm * ratio;
      out.loadPeak = Math.max(out.loadPeak, capDir > 0 ? (S * DIR[k]) / capDir : 0);
      const vkm = inServ * (60 / cycle) * 2 * s.route_km;
      out.vkm += vkm; out.seatKm += vkm * V.cap * P.turnover; out.paxKm += S * ride;
    }
    return out;
  }

  function sizeFleet(s, P, vk, fares) {
    const V = VEHICLES[vk];
    const flat = fares || PERIODS.map(() => P.designFare);
    const cycPeak = Math.max(...HOURS.map((h, k) => (2 * s.route_km / (P.shuttleKmh * SPEED_F[k])) * 60 + P.layover));
    let N = Math.max(P.minFleet, Math.ceil(cycPeak / 10));
    for (let it = 0; it < 6; it++) {
      const e = evaluate(s, P, vk, N, flat);
      let need = Math.max(P.minFleet, Math.ceil(cycPeak / P.maxHeadway));
      HOURS.forEach((h, k) => {
        const cycle = (2 * s.route_km / (P.shuttleKmh * SPEED_F[k])) * 60 + P.layover;
        need = Math.max(need, Math.ceil((e.demand[k] * DIR[k] * cycle) / 60 / (V.cap * P.turnover * P.loadDesign) / DEPLOY[k]));
      });
      if (need === N) break;
      N = need;
    }
    return N;
  }

  function costs(s, P, vk, N, ev) {
    const V = VEHICLES[vk];
    const fleet = Math.ceil(N * (1 + P.spare));
    const vehCapex = fleet * V.usd * P.fx * P.capexMult * (1 - P.grant);
    const kmPerVeh = ev.vkm / Math.max(N, 1);
    const rangeKm = (0.85 * V.battKwh) / V.kwhKm;
    const oppShare = kmPerVeh > rangeKm ? (kmPerVeh - rangeKm) / kmPerVeh : 0; // energy topped up at hubs by day
    const kwhDay = ev.vkm * V.kwhKm * (1 + P.chargeLoss);
    const depotChargers = Math.ceil(fleet / V.perCharger);
    const hubChargers = oppShare > 0 ? Math.ceil(N / P.hubPerVeh) : 0;
    const managedKw = (kwhDay * (1 - oppShare)) / 6 + (kwhDay * oppShare) / 5; // overnight 23:00–05:00, top-ups 10:00–15:00
    const unmanagedKw = Math.min(depotChargers * V.depotKw, kwhDay * 0.45 / 2.5) + hubChargers * P.hubKw * 0.5;
    const gridKw = P.charging === "managed" ? managedKw : Math.max(managedKw, unmanagedKw);
    const chargerCapex = (depotChargers * V.depotUsd + hubChargers * P.hubUsd + gridKw * P.gridUsdKw) * P.fx * P.capexMult * (1 - P.grant);
    const T = P.tariff, tm = P.tariffMult;
    const blend = P.charging === "managed"
      ? (1 - oppShare) * T.off + oppShare * T.shoulder
      : 0.45 * T.peak + 0.35 * T.shoulder + 0.2 * T.off;
    const yr = P.days;
    const energy = kwhDay * blend * tm * yr;
    const drivers = N * P.driversPerVeh * P.driverMonthly * 12;
    const fixed = fleet * P.fixedPerVeh; // depot land, supervision, platform and security
    const maint = ev.vkm * V.maintKm * yr;
    const insurance = fleet * V.usd * P.fx * P.capexMult * P.insurance;
    const ancillary = ev.idleVh * P.ancillaryRate * P.ancillaryUtil * yr; // off-peak hire, school runs and parcels
    const revenue = ev.rev * yr + ancillary;
    const pay = revenue * P.payFee;
    const opexCore = energy + drivers + maint + insurance + pay + fixed;
    const opex = opexCore * (1 + P.overhead);
    const battery = fleet * V.battKwh * P.battUsdKwh * P.fx * P.capexMult; // one mid-life battery replacement
    const annVeh = (vehCapex * (1 - P.residual / Math.pow(1 + P.rate, P.life)) + battery / Math.pow(1 + P.rate, P.battYear)) * crf(P.rate, P.life);
    const annChg = chargerCapex * crf(P.rate, P.chargerLife);
    return { battery, fixed, ancillary, fareRevenue: ev.rev * yr, cityCost: ev.cityCost * yr, fleet, vehCapex, chargerCapex, depotChargers, hubChargers, managedKw, unmanagedKw, gridKw, kwhDay, oppShare, kmPerVeh, energy, drivers, maint, insurance, pay, opex, annVeh, annChg, revenue, ebitda: revenue - opex, profit: revenue - opex - annVeh - annChg, blend };
  }

  const fareGrid = (P, cap) => { const g = []; for (let f = P.fareMin; f <= Math.min(P.fareMax, cap) + 1e-9; f += P.fareStep) g.push(f); return g.length ? g : [P.fareMin]; };

  // Fare caps: below the boda fare for the same leg, and the inclusive cap in lower-income suburbs.
  function fareCap(s, P) {
    const capB = Math.floor((P.bodaCapShare * bodaFare(P, Math.max(s.lm_gap_km, 0.55))) / P.fareStep) * P.fareStep;
    return P.pricing === "inclusive" && s.rwi < P.equityRwi ? Math.min(capB, P.equityCap) : capB;
  }
  const PEAKS = PERIODS.map((p, i) => (p.band === "peak" ? i : -1)).filter((i) => i >= 0);
  const OFFS = PERIODS.map((p, i) => (p.band !== "peak" ? i : -1)).filter((i) => i >= 0);

  // Served riders and fare revenue by period for one set of fares.
  function byPeriod(e) {
    const r = PERIODS.map(() => ({ rev: 0, served: 0, cs: 0 }));
    HOURS.forEach((h, k) => { const i = PERIOD_OF[h]; r[i].rev += e.served[k] * e.fare[k]; r[i].served += e.served[k]; r[i].cs += e.csH[k]; });
    return r;
  }
  // For a fixed fleet, the best fare in each listed period (periods do not interact in this model).
  function bestFares(s, P, vk, N, base, periods, score, grid) {
    const f = base.slice();
    const tab = grid.map((F) => byPeriod(evaluate(s, P, vk, N, PERIODS.map(() => F))));
    periods.forEach((pi) => { let bi = 0; grid.forEach((F, gi) => { if (score(tab[gi][pi]) > score(tab[bi][pi])) bi = gi; }); f[pi] = grid[bi]; });
    return f;
  }
  function package_(s, P, vk, fares, N) {
    N = N || sizeFleet(s, P, vk, fares);
    const ev = evaluate(s, P, vk, N, fares);
    return { vk, N, fares, ev, c: costs(s, P, vk, N, ev) };
  }

  function plan(s, P, vk) {
    if (P.pricing === "flat") return package_(s, P, vk, PERIODS.map(() => P.flatFare));
    if (P.pricing === "tod") return package_(s, P, vk, PERIODS.map((p) => P.tod[p.band]));
    const grid = fareGrid(P, fareCap(s, P));
    if (P.pricing === "dynamic" || P.pricing === "balanced") {
      // Peak fares decide how many vehicles are needed, so choose them together with the fleet;
      // off-peak fares then fill the seats that fleet already provides.
      // dynamic: maximise annual profit. balanced: profit plus a weight on riders' benefit (consumer surplus).
      const w = P.pricing === "balanced" ? P.csWeight : 0;
      let best = null, bestScore = -Infinity;
      for (const Fp of grid) {
        const f0 = PERIODS.map(() => Fp);
        const N = sizeFleet(s, P, vk, f0);
        const f = bestFares(s, P, vk, N, f0, OFFS, (x) => x.rev + w * x.cs, grid);
        const r = package_(s, P, vk, f, Math.max(N, sizeFleet(s, P, vk, f)));
        const sc = r.c.profit + w * r.ev.cs * P.days;
        if (sc > bestScore) { best = r; bestScore = sc; }
      }
      return best;
    }
    // Inclusive: carry the most riders while fares still cover running costs at the target ratio.
    let N = sizeFleet(s, P, vk);
    const pick = (lam, n) => bestFares(s, P, vk, n, PERIODS.map(() => P.designFare), PERIODS.map((_, i) => i), (x) => x.served + (lam * x.rev) / 1000, grid);
    let out = null;
    for (let pass = 0; pass < 2; pass++) {
      const ok = (f) => { const r = package_(s, P, vk, f, N); return [r.c.revenue >= P.equityTarget * r.c.opex, r]; };
      let lo = 0, hi = 60, t = ok(pick(0, N));
      if (!t[0]) {
        let tb = ok(pick(hi, N));
        if (tb[0]) { for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; const tm = ok(pick(m, N)); if (tm[0]) { hi = m; tb = tm; } else lo = m; } }
        t = tb;
      }
      out = t[1];
      N = sizeFleet(s, P, vk, out.fares);
    }
    return package_(s, P, vk, out.fares, N);
  }

  function runSuburb(s, P) {
    const midiOk = s.main_share >= P.midiMainShare && s.unpaved_share <= P.midiUnpaved;
    const opts = P.vehicle === "auto" ? (midiOk ? ["shuttle", "midi"] : ["shuttle"]) : P.vehicle === "midi" && !midiOk ? ["shuttle"] : [P.vehicle];
    let best = null;
    for (const vk of opts) { const r = plan(s, P, vk); if (!best || r.c.profit > best.c.profit) best = r; }
    return best;
  }

  /* Whole network: suburbs, build order under plant output, cash flows, charging load and impacts. */
  function run(subsIn, params) {
    const P = merge(DEFAULTS, params);
    const pr = priority(subsIn);
    const order = subsIn.map((s, i) => i).sort((a, b) => pr[b] - pr[a]).slice(0, P.suburbs);
    const res = order.map((i) => Object.assign({ s: subsIn[i], priority: pr[i] }, runSuburb(subsIn[i], P)));
    // Build order: deliveries per year = plant output x share allocated to this programme.
    let y = 0, left = P.plantCap[0] * P.plantShare;
    res.forEach((r) => {
      let need = r.c.fleet;
      while (need > 0 && y < 30) { const t = Math.min(need, left); need -= t; left -= t; if (left <= 1e-9 && need > 0) { y++; left = (P.plantCap[y] || P.plantCap[P.plantCap.length - 1]) * P.plantShare; } }
      r.year = y;
      if (left <= 1e-9) { y++; left = (P.plantCap[y] || P.plantCap[P.plantCap.length - 1]) * P.plantShare; }
    });
    res.forEach((r, i) => (r.wave = Math.min(3, Math.floor(i / 25)) + 1));
    // Cash flows over the horizon (real UGX).
    const H = P.horizon, cf = new Array(H).fill(0), rev = new Array(H).fill(0), opx = new Array(H).fill(0), cap = new Array(H).fill(0), riders = new Array(H).fill(0), units = new Array(H).fill(0);
    res.forEach((r) => {
      for (let t = 0; t < H; t++) {
        if (t === r.year) { cap[t] += r.c.vehCapex + r.c.chargerCapex; units[t] += r.c.fleet; }
        if (t === r.year + P.life) cap[t] += r.c.vehCapex; // fleet renewal if horizon is longer than vehicle life
        if (t === r.year + P.battYear) cap[t] += r.c.battery;
        if (t >= r.year) { const k = P.ramp[Math.min(t - r.year, P.ramp.length - 1)]; rev[t] += r.c.revenue * k; opx[t] += r.c.opex * (0.6 + 0.4 * k); riders[t] += r.ev.riders * k; }
      }
    });
    const resid = res.reduce((a, r) => a + (r.year < H ? r.c.vehCapex * Math.max(0, 1 - (H - r.year) / P.life) + r.c.vehCapex * P.residual * ((H - r.year) >= P.life ? 1 : 0) : 0), 0);
    for (let t = 0; t < H; t++) cf[t] = rev[t] - opx[t] - cap[t] + (t === H - 1 ? resid : 0);
    const npv = cf.reduce((a, v, t) => a + v / Math.pow(1 + P.rate, t + 1), 0);
    const irr = (() => { let lo = -0.9, hi = 1.5; const f = (r) => cf.reduce((a, v, t) => a + v / Math.pow(1 + r, t + 1), 0); if (f(lo) * f(hi) > 0) return null; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; } return (lo + hi) / 2; })();
    let cum = 0, payback = null, trough = 0;
    cf.forEach((v, t) => { cum += v; trough = Math.min(trough, cum); if (payback === null && cum >= 0 && t > 0) payback = t + 1; });
    // Network-level charging load over 24 hours (MW).
    const loadM = new Array(24).fill(0), loadU = new Array(24).fill(0);
    res.forEach((r) => {
      const e = r.c.kwhDay, o = r.c.oppShare;
      for (let h = 0; h < 24; h++) {
        if (h >= 23 || h < 5) loadM[h] += (e * (1 - o)) / 6 / 1000;
        if (h >= 10 && h < 15) loadM[h] += (e * o) / 5 / 1000;
        // Unmanaged: vehicles plug in as they finish, mostly into the evening peak.
        const u = { 19: 0.16, 20: 0.17, 21: 0.15, 22: 0.12, 23: 0.08, 0: 0.05, 1: 0.03, 12: 0.06, 13: 0.06, 14: 0.05, 10: 0.03, 11: 0.04 }[h] || 0;
        loadU[h] += (e * u) / 1000;
      }
    });
    const sum = (f) => res.reduce((a, r) => a + f(r), 0);
    // Feeder riders who continue towards the city centre create demand for Kayoola EVS 12 m trunk buses at each hub.
    const hubs = {};
    const peakShare = Math.max(...HOUR_SHARE) * 0.75;
    res.forEach((r) => {
      const k = r.s.hub; if (!hubs[k]) hubs[k] = { hub: k, lon: r.s.hub_lon, lat: r.s.hub_lat, trunkKm: r.s.trunk_km, transfers: 0, suburbs: [] };
      hubs[k].transfers += r.ev.riders * P.trunkShare; hubs[k].suburbs.push(r.s.code);
    });
    const TV = VEHICLES.trunk;
    const hubList = Object.values(hubs).map((h) => {
      const dx = (h.lon - 32.5811) * 111.32 * Math.cos(0.005), dy = (h.lat - 0.3136) * 110.57;
      const km = h.trunkKm > 0 ? h.trunkKm : Math.hypot(dx, dy) * 1.3; // road distance when known
      const viable = km >= P.trunkMinKm && h.transfers >= P.trunkMinRiders;
      const cycle = (2 * km / P.trunkKmh) * 60 + 10;
      const buses = viable ? Math.max(2, Math.ceil((h.transfers * peakShare * cycle) / 60 / (TV.cap * P.loadDesign * 1.2))) : 0;
      const busKm = viable ? buses * 0.85 * 16 * (60 / cycle) * 2 * km : 0;
      return Object.assign(h, { km, buses, fleet: Math.ceil(buses * (1 + P.spare)), busKm, riders: viable ? h.transfers : 0 });
    });
    const trunkPkm = hubList.reduce((a, h) => a + h.riders * h.km * 0.8, 0), trunkKwh = hubList.reduce((a, h) => a + h.busKm * TV.kwhKm * (1 + P.chargeLoss), 0);
    const T = {
      suburbs: res.length,
      residents: sum((r) => r.s.pop), gapResidents: sum((r) => r.s.gap_pop),
      ridersDay: sum((r) => r.ev.riders), deniedDay: sum((r) => r.ev.denied.reduce((a, b) => a + b, 0)),
      revenueDay: sum((r) => r.ev.rev), revenueYr: sum((r) => r.c.revenue), opexYr: sum((r) => r.c.opex),
      annCapexYr: sum((r) => r.c.annVeh + r.c.annChg), profitYr: sum((r) => r.c.profit), ebitdaYr: sum((r) => r.c.ebitda),
      ancillaryYr: sum((r) => r.c.ancillary), fareRevenueYr: sum((r) => r.c.fareRevenue), cityCostYr: sum((r) => r.c.cityCost),
      fleet: sum((r) => r.c.fleet), inService: sum((r) => r.N), shuttles: sum((r) => (r.vk === "shuttle" ? r.c.fleet : 0)), midis: sum((r) => (r.vk === "midi" ? r.c.fleet : 0)),
      vehCapex: sum((r) => r.c.vehCapex), chargerCapex: sum((r) => r.c.chargerCapex),
      depotChargers: sum((r) => r.c.depotChargers), hubChargers: sum((r) => r.c.hubChargers),
      mwhDay: sum((r) => r.c.kwhDay) / 1000, peakMwManaged: Math.max(...loadM), peakMwUnmanaged: Math.max(...loadU), eveMwManaged: Math.max(...loadM.slice(19, 22)), eveMwUnmanaged: Math.max(...loadU.slice(19, 22)),
      vkmDay: sum((r) => r.ev.vkm), paxKmDay: sum((r) => r.ev.paxKm), seatKmDay: sum((r) => r.ev.seatKm),
      csDay: sum((r) => r.ev.cs), fromBodaDay: sum((r) => r.ev.fromBoda), fromWalkDay: sum((r) => r.ev.fromWalk),
      co2Tyr: (sum((r) => r.ev.bodaKm) * P.bodaKgKm - sum((r) => r.c.kwhDay) * P.gridKgKwh) * P.days / 1000,
      co2TrunkTyr: (trunkPkm * P.taxiKgPkm - trunkKwh * P.gridKgKwh) * P.days / 1000,
      trunkBuses: hubList.reduce((a, h) => a + h.fleet, 0), trunkRidersDay: hubList.reduce((a, h) => a + h.riders, 0), trunkMwhDay: trunkKwh / 1000,
      trunkSalesUsd: hubList.reduce((a, h) => a + h.fleet, 0) * TV.usd * P.capexMult, hubsServed: hubList.filter((h) => h.buses > 0).length,
      fuelLyr: sum((r) => r.ev.bodaKm) * P.bodaLitreKm * P.days,
      bodasDisplaced: sum((r) => r.ev.fromBoda) / P.bodaTripsDay,
      jobsOps: sum((r) => r.N * P.driversPerVeh + r.c.fleet * 0.35),
      npv, irr, payback, trough, years: Math.max(...res.map((r) => r.year)) + 1,
    };
    T.avgFare = T.revenueDay / Math.max(T.ridersDay, 1);
    T.farebox = T.revenueYr / Math.max(T.opexYr, 1);
    T.costPerRide = (T.opexYr + T.annCapexYr) / Math.max(T.ridersDay * P.days, 1);
    T.loadFactor = T.paxKmDay / Math.max(T.seatKmDay, 1);
    T.feederSalesUsd = sum((r) => r.c.fleet * VEHICLES[r.vk].usd * P.capexMult);
    T.kiiraSalesUsd = T.feederSalesUsd + T.trunkSalesUsd;
    T.kiiraUnits = T.fleet + T.trunkBuses;
    T.kiiraLocalUsd = T.kiiraSalesUsd * P.localShare;
    T.plantJobYears = T.kiiraUnits * P.plantJobsPerUnit;
    T.plantShareOfOutput = T.kiiraUnits / P.plantCap.slice(0, T.years).reduce((a, b) => a + b, 0);
    // Hourly network profile for charts.
    const hourly = HOURS.map((h, k) => ({ hour: h, period: PERIOD_OF[h], demand: sum((r) => r.ev.demand[k]), served: sum((r) => r.ev.served[k]), cap: sum((r) => r.ev.cap[k]), dirServed: sum((r) => r.ev.served[k]) * DIR[k], fare: sum((r) => r.ev.fare[k] * r.ev.served[k]) / Math.max(sum((r) => r.ev.served[k]), 1) }));
    const suburbs = res.map((r) => ({
      sid: r.s.sid, code: r.s.code, name: r.s.name, segment: r.s.segment, vehicle: r.vk, inService: r.N, fleet: r.c.fleet, year: r.year, wave: r.wave, priority: r.priority,
      fares: r.fares, riders: r.ev.riders, denied: r.ev.denied.reduce((a, b) => a + b, 0), revenueYr: r.c.revenue, opexYr: r.c.opex, profitYr: r.c.profit, ebitdaYr: r.c.ebitda,
      farebox: r.c.revenue / Math.max(r.c.opex, 1), loadPeak: r.ev.loadPeak, headwayPeak: Math.min(...r.ev.headway), headwayOff: r.ev.headway[HOURS.indexOf(11)],
      kwhDay: r.c.kwhDay, kmPerVeh: r.c.kmPerVeh, oppShare: r.c.oppShare, depotChargers: r.c.depotChargers, hubChargers: r.c.hubChargers, managedKw: r.c.managedKw, gridKw: r.c.gridKw,
      csDay: r.ev.cs, fromBoda: r.ev.fromBoda, fromWalk: r.ev.fromWalk, avgFare: r.ev.rev / Math.max(r.ev.riders, 1),
      share: r.ev.riders / Math.max(r.s.pop * P.legRate * P.demandMult, 1),
      hourlyServed: r.ev.served, hourlyFare: r.ev.fare,
      bodaSaveMonth: Math.max(0, (bodaFare(P, Math.max(r.s.lm_gap_km, 0.55)) - r.ev.rev / Math.max(r.ev.riders, 1))) * 2 * 22,
    }));
    return { params: P, totals: T, hubs: hubList, suburbs, hourly, loadManaged: loadM, loadUnmanaged: loadU, cash: { cf, rev, opx, cap, riders, units } };
  }

  // Seeded random numbers so Monte Carlo runs repeat exactly.
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const UNCERTAIN = [
    { key: "demandMult", label: "Demand level", lo: 0.6, hi: 1.2 },
    { key: "capexMult", label: "Vehicle and charger prices", lo: 0.85, hi: 1.35 },
    { key: "vot", label: "Value of time (UGX/h)", lo: 1800, hi: 3400 },
    { key: "tariffMult", label: "Electricity price", lo: 0.85, hi: 1.3 },
    { key: "driverMonthly", label: "Driver pay (UGX/month)", lo: 550000, hi: 950000 },
    { key: "align", label: "Share of legs heading to the hub", lo: 0.45, hi: 0.75 },
    { key: "ascShuttle", label: "Trust in a new service", lo: -0.6, hi: 0.2 },
    { key: "turnover", label: "Seat turnover along the route", lo: 1.2, hi: 1.7 },
    { key: "shuttleKmh", label: "Free-flow speed (km/h)", lo: 13, hi: 20 },
  ];
  function monteCarlo(subs, params, n, seed) {
    const R = rng(seed || 7), out = [];
    for (let i = 0; i < n; i++) {
      const p = Object.assign({}, params);
      UNCERTAIN.forEach((u) => (p[u.key] = u.lo + (u.hi - u.lo) * R()));
      const r = run(subs, p);
      out.push(Object.assign({ npv: r.totals.npv, profitYr: r.totals.profitYr, ridersDay: r.totals.ridersDay, fleet: r.totals.fleet, farebox: r.totals.farebox }, ...UNCERTAIN.map((u) => ({ [u.key]: p[u.key] }))));
    }
    return out;
  }
  function tornado(subs, params) {
    const base = run(subs, params).totals.npv;
    return UNCERTAIN.map((u) => ({ key: u.key, label: u.label, lo: u.lo, hi: u.hi, npvLo: run(subs, Object.assign({}, params, { [u.key]: u.lo })).totals.npv - base, npvHi: run(subs, Object.assign({}, params, { [u.key]: u.hi })).totals.npv - base }));
  }

  const SCENARIOS = [
    { id: "S1", name: "Pilot", blurb: "First 25 suburbs by priority, e-shuttles only, one flat UGX 1,000 fare", params: { suburbs: 25, vehicle: "shuttle", pricing: "flat" } },
    { id: "S2", name: "Time-of-day", blurb: "All 100 suburbs; fixed fares of UGX 1,300 peak, 1,000 shoulder, 700 off-peak", params: { pricing: "tod" } },
    { id: "S3", name: "Profit-max dynamic", blurb: "Fares by suburb and period, chosen with the fleet size to maximise operator profit", params: { pricing: "dynamic" } },
    { id: "S4", name: "Balanced dynamic", blurb: "Fares by suburb and period that maximise operator profit plus half of riders' benefit (recommended)", params: { pricing: "balanced" } },
    { id: "S5", name: "Inclusive", blurb: "Most riders while fares cover running costs; UGX 800 cap in lower-income suburbs; 20% green-finance grant; UGX 200 city-funded transfer discount", params: { pricing: "inclusive", grant: 0.2, integratedDiscount: 200 } },
    { id: "S6", name: "Stress test", blurb: "Balanced pricing with 25% less demand, 25% dearer vehicles, 20% dearer power and unmanaged charging", params: { pricing: "balanced", demandMult: 0.75, capexMult: 1.25, tariffMult: 1.2, charging: "unmanaged" } },
  ];


  return { HOURS, PERIODS, PERIOD_OF, HOUR_SHARE, VEHICLES, DEFAULTS, SCENARIOS, UNCERTAIN, run, monteCarlo, tornado, priority, bodaFare: (d, p) => bodaFare(merge(DEFAULTS, p), d) };
});
