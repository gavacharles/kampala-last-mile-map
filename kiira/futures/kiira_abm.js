/* Kiira futures lab: an agent-based model (ABM) of last-mile shuttles, bodas, shops and families
 * for 100 Greater Kampala suburbs. Runs in Node (pre-computed results) and in the browser (live re-runs).
 *
 * Agents
 *   Households  sampled per suburb (income from Meta RWI, distance to the stop, taste for time and money, habit).
 *               Each week they choose walk, boda or feeder for a peak round trip and an off-peak round trip.
 *               They hear about the feeder from marketing and from neighbours (Bass diffusion), remember
 *               crowding and refusals, and stick with what they used (habit). Some order goods through the aggregator.
 *   Operator    one per suburb. Each month it learns fares by period (hill-climbing on its objective) and
 *               orders or retires vehicles from load and refusals; new vehicles arrive after a lead time.
 *   Boda riders a pool per suburb. Earnings follow the trips left to them; when pay falls below what they could
 *               earn elsewhere some cut fares, some leave for shuttle-driving or courier jobs, the rest for other work.
 *   Shops       join the aggregator when expected orders beat the commission; households adopt ordering when
 *               enough nearby shops are on it. Feeders carry consolidated parcels off-peak; couriers do the last 300 m.
 *   Plant       Kiira's output caps how many vehicles can be delivered each month (network runs).
 *
 * Every parameter is a planning assumption, drawn from a range in uncertainty runs. Credit: Gava Charles.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./kiira_model.js"));
  else root.KiiraABM = factory(root.KiiraModel);
})(typeof self !== "undefined" ? self : this, function (KM) {
  "use strict";
  const { HOURS, PERIODS, PERIOD_OF, HOUR_SHARE, DEFAULTS: MD } = KM;
  const NH = HOURS.length;
  const DIR = HOURS.map((h) => (h >= 7 && h <= 8 ? 0.75 : h >= 16 && h <= 18 ? 0.72 : 0.56));
  const SPEED_F = HOURS.map((h) => (h >= 7 && h <= 8 ? 0.72 : h >= 16 && h <= 18 ? 0.68 : h >= 9 && h <= 15 ? 0.88 : 1));
  const VOT_F = HOURS.map((h) => (h >= 7 && h <= 8 ? 1.25 : h >= 16 && h <= 18 ? 1.2 : h >= 9 && h <= 15 ? 0.85 : 1));
  const WALK_F = HOURS.map((h) => (h <= 6 ? 1.3 : h >= 19 && h <= 21 ? 1.35 : h >= 22 ? 1.7 : 1));
  const BODA_F = HOURS.map((h) => (h >= 7 && h <= 8 ? 1.15 : h >= 16 && h <= 18 ? 1.15 : h >= 19 && h <= 21 ? 1.1 : h >= 22 || h <= 6 ? 1.25 : 1));
  const DEPLOY = HOURS.map((h) => (h >= 7 && h <= 8 ? 1 : h >= 16 && h <= 18 ? 1 : h >= 9 && h <= 15 ? 0.7 : h === 22 ? 0.5 : 0.8));
  const HI = (h) => HOURS.indexOf(h);
  // Peak slot: out 06–08, back 16–19. Off-peak slot: two legs spread over the rest of the day.
  const A_OUT = [6, 7, 8].map(HI), A_BACK = [16, 17, 18, 19].map(HI);
  const B_HRS = [5, 9, 10, 11, 12, 13, 14, 15, 19, 20, 21, 22].map(HI);
  const shareOf = (ix) => ix.reduce((a, k) => a + HOUR_SHARE[k], 0);
  const SHARE_A = Math.min(0.7, (shareOf(A_OUT) + shareOf(A_BACK)));

  const VEH = {
    e14: { key: "e14", name: "Kiira 14-seat e-shuttle", short: "E-shuttle 14", electric: true, cap: 14, usd: 42000, kwhKm: 0.22, battKwh: 60, maintKm: 250, depotKw: 11, depotUsd: 1800, perCharger: 1, local: true },
    midi: { key: "midi", name: "Kayoola EVS 8 m", short: "E-midi 8 m", electric: true, cap: 56, usd: 165000, kwhKm: 0.95, battKwh: 200, maintKm: 450, depotKw: 60, depotUsd: 28000, perCharger: 2, local: true },
    ice14: { key: "ice14", name: "Diesel 14-seat taxi (Hiace type)", short: "Diesel taxi 14", electric: false, cap: 14, usd: 30000, lKm: 0.11, maintKm: 380, local: false },
  };
  const PRICING = {
    flat: { key: "flat", name: "Flat UGX 1,000" },
    learn: { key: "learn", name: "Learning dynamic" },
    inclusive: { key: "inclusive", name: "Inclusive" },
  };

  const DEFAULTS = {
    agents: 90, weeks: 104, seed: 7,
    hhSize: 4.4, legRate: MD.legRate, demandMult: 1, align: MD.align,
    vot: MD.vot, votRwi: MD.votRwi, mu: MD.mu, muRwi: MD.muRwi, tasteSd: 0.35, ascShuttle: MD.ascShuttle, ascSd: 0.35,
    walkKmh: MD.walkKmh, walkW: MD.walkW, waitW: MD.waitW, shuttleKmh: MD.shuttleKmh, layover: MD.layover, rideShare: MD.rideShare, turnover: MD.turnover,
    bodaMin: MD.bodaMin, bodaBase: MD.bodaBase, bodaPerKm: MD.bodaPerKm, bodaKmh: MD.bodaKmh, bodaWait: MD.bodaWait, bodaSafety: MD.bodaSafety,
    habit: 200, bassP: 0.03, bassQ: 0.45, refusalMin: 18, memory: 0.35,
    loadDesign: MD.loadDesign, maxHeadway: MD.maxHeadway, minFleet: MD.minFleet, startFleet: 0.85, leadWeeks: 8, plantMonthly: 2500 * 0.4 / 12,
    fareMin: 500, fareStep: 100, bodaCapShare: MD.bodaCapShare, flatFare: 1000, csWeight: 0.5,
    incl: { peak: 900, off: 700, lowCap: 800, lowRwi: 1.0, grant: 0.2, discount: 200 },
    // Money and costs (UGX unless stated)
    fx: MD.fx, days: MD.days, driverMonthly: MD.driverMonthly, driversPerVeh: MD.driversPerVeh, insurance: MD.insurance, fixedPerVeh: MD.fixedPerVeh,
    battUsdKwh: MD.battUsdKwh, battYear: MD.battYear, overhead: MD.overhead, payFee: MD.payFee, spare: MD.spare, capexMult: 1, iceMult: 1,
    rate: MD.rate, life: MD.life, residual: MD.residual, chargerLife: MD.chargerLife, tariffOff: MD.tariff.off, tariffMult: 1, chargeLoss: MD.chargeLoss, gridUsdKw: MD.gridUsdKw,
    diesel: 4900, ancillaryRate: MD.ancillaryRate, ancillaryUtil: MD.ancillaryUtil,
    // Households and bodas
    incomeBase: 900000, incomeRwi: 0.8, incomeSd: 0.55,
    bodaTripsDay: MD.bodaTripsDay, bodaKmTrip: 2.2, bodaRent: 15000, bodaFuelL: 5200, bodaLitreKm: MD.bodaLitreKm, bodaReserve: 22000, bodaExit: 0.04, bodaPriceWar: 0.12, exBodaHire: 0.6,
    // Aggregator
    shopsPer: 70, shopJoinBase: -2.2, orderValue: 15000, ordersWeek: 1.6, deliveryFee: 800, commission: 0.06, incremental: 0.45, shopMargin: 0.2,
    courierOrdersDay: 40, orderCeil: 0.35, shopCeil: 0.6, shopKm: 0.6, shopBodaShare: 0.25, courierDay: 28000, parcelFee: 250, aggTechMonthly: 6000000, orderBassP: 0.01, orderBassQ: 0.35,
    // Wider effects
    bodaKgKm: MD.bodaKgKm, gridKgKwh: MD.gridKgKwh, dieselKgL: 2.68, plantJobsPerUnit: MD.plantJobsPerUnit, techPerVeh: 0.35, salesPerShopJob: 12000000,
    trunkMin: 28, cbdKmh: 14,
  };

  // Uncertain inputs for the lab. Each run draws one value per input (shared across options: common random numbers).
  const UNCERTAIN = [
    { key: "demandMult", label: "Demand level", lo: 0.65, hi: 1.2 },
    { key: "capexMult", label: "Kiira vehicle and charger prices", lo: 0.85, hi: 1.35 },
    { key: "iceMult", label: "Diesel taxi price", lo: 0.75, hi: 1.3 },
    { key: "diesel", label: "Diesel price (UGX/L)", lo: 4300, hi: 6200 },
    { key: "tariffMult", label: "Electricity price", lo: 0.85, hi: 1.3 },
    { key: "vot", label: "Value of time (UGX/h)", lo: 1800, hi: 3400 },
    { key: "ascShuttle", label: "Trust in a new service", lo: -0.6, hi: 0.2 },
    { key: "bassQ", label: "Word of mouth", lo: 0.2, hi: 0.7 },
    { key: "habit", label: "Habit (UGX)", lo: 100, hi: 450 },
    { key: "bodaReserve", label: "Boda riders' fallback pay (UGX/day)", lo: 16000, hi: 30000 },
    { key: "orderBassQ", label: "Uptake of ordering", lo: 0.15, hi: 0.55 },
    { key: "driverMonthly", label: "Driver pay (UGX/month)", lo: 550000, hi: 950000 },
  ];

  function merge(a, b) { const o = JSON.parse(JSON.stringify(a)); for (const k in b || {}) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? Object.assign({}, o[k], b[k]) : b[k]; return o; }
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const normal = (R) => { let u = 0, v = 0; while (u === 0) u = R(); while (v === 0) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const crf = (r, n) => (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const pick = (R, ix) => { let t = R() * shareOf(ix); for (const k of ix) { t -= HOUR_SHARE[k]; if (t <= 0) return k; } return ix[ix.length - 1]; };
  const midiOk = (s) => s.main_share >= MD.midiMainShare && s.unpaved_share <= MD.midiUnpaved;
  const bodaFare = (P, d) => Math.max(P.bodaMin, P.bodaBase + P.bodaPerKm * d);
  const fareCap = (s, P, pricing) => {
    const c = Math.floor((P.bodaCapShare * bodaFare(P, Math.max(s.lm_gap_km, 0.55))) / P.fareStep) * P.fareStep;
    return pricing === "inclusive" && s.rwi < P.incl.lowRwi ? Math.min(c, P.incl.lowCap) : c;
  };
  const optionsFor = (s) => ["e14", "ice14"].concat(midiOk(s) ? ["midi"] : []);

  /* Build a suburb's households. Same seed => same people across options, so differences are the policy's. */
  function makeAgents(s, P, R) {
    const n = P.agents, hh = s.pop / P.hhSize;
    const incMean = P.incomeBase * Math.exp(P.incomeRwi * (s.rwi - 1.2));
    const legsHH = P.hhSize * P.legRate * P.demandMult; // home-end legs per household per day
    const A = [];
    for (let i = 0; i < n; i++) {
      const far = R() < s.gap_share;
      const d = far ? Math.max(s.lm_gap_km, 0.55) * Math.exp(0.3 * normal(R)) : 0.3 * Math.exp(0.3 * normal(R));
      const z = normal(R);
      const inc = incMean * Math.exp(P.incomeSd * z - P.incomeSd * P.incomeSd / 2);
      A.push({
        d, far, inc, w: hh / n,
        tasteT: Math.exp(P.tasteSd * (0.6 * z + 0.8 * normal(R))) * Math.pow(inc / incMean, 0.25),
        tasteM: Math.pow(incMean / inc, 0.3),
        asc: P.ascSd * normal(R),
        alignA: R() < P.align, alignB: R() < P.align,
        tripsA: legsHH * SHARE_A / 2, tripsB: legsHH * (1 - SHARE_A) / 2,
        hA: [pick(R, A_OUT), pick(R, A_BACK)], hB: [pick(R, B_HRS), pick(R, B_HRS)],
        aware: false, modeA: 0, modeB: 0, orders: false,
        base: null, // baseline logsum and spending
      });
    }
    return A;
  }

  /* One suburb under one option, simulated week by week. */
  function simSuburb(s, Pin, opt, seed, record) {
    const P = Pin;
    const R = rng(seed);
    const V = VEH[opt.vehicle];
    const pricing = opt.pricing, agg = !!opt.agg;
    const discount = pricing === "inclusive" ? P.incl.discount : 0;
    const vot0 = P.vot * Math.exp(P.votRwi * (s.rwi - 1.2)) / 60;
    const mu0 = P.mu * Math.exp(-P.muRwi * (s.rwi - 1.2));
    const ride = P.rideShare * s.route_km;
    const cap = fareCap(s, P, pricing);
    const A = makeAgents(s, P, rng(seed * 31 + 7));
    // fares by period
    let fares = PERIODS.map((p) => pricing === "flat" ? P.flatFare : pricing === "inclusive" ? Math.min(p.band === "peak" ? P.incl.peak : P.incl.off, cap) : Math.min(1000, cap));
    if (pricing === "inclusive" && s.rwi < P.incl.lowRwi) fares = fares.map((f) => Math.min(f, P.incl.lowCap));
    const step = PERIODS.map(() => P.fareStep), lastObj = PERIODS.map(() => null);
    // State
    const refusal = new Array(NH).fill(0);
    let bodaMult = 1, bodaWaitMult = 1;
    const cycleH = HOURS.map((h, k) => (2 * s.route_km / (P.shuttleKmh * SPEED_F[k])) * 60 + P.layover);
    const capPerVeh = HOURS.map((h, k) => DEPLOY[k] * (60 / cycleH[k]) * V.cap * P.turnover);
    // Generalised costs per leg at hour k for an agent (UGX)
    const costs = (a, k, N) => {
      const vot = vot0 * VOT_F[k] * a.tasteT, wW = P.walkW * WALK_F[k];
      const gW = vot * wW * (a.d / P.walkKmh) * 60;
      const bf = bodaFare(P, a.d) * BODA_F[k] * bodaMult;
      const gB = bf + vot * (P.bodaWait * bodaWaitMult + (a.d / P.bodaKmh) * 60) + P.bodaSafety;
      if (N <= 0) return [gW, gB, Infinity, bf, 0];
      const inServ = Math.max(N * DEPLOY[k], 1);
      const hw = cycleH[k] / inServ;
      const w = Math.min(a.d, 0.2 + 0.12 * a.d);
      const paid = Math.max(fares[PERIOD_OF[HOURS[k]]] - discount, 0);
      const speed = P.shuttleKmh * SPEED_F[k];
      const gS = paid + vot * (wW * (w / P.walkKmh) * 60 + P.waitW * (hw / 2 + refusal[k] * P.refusalMin) + (ride / speed) * 60);
      return [gW, gB, gS, bf, paid];
    };
    // Utility of a round trip (2 legs) for each mode; logsum and pick.
    const roundTrip = (a, hrs, N, cur, avail) => {
      const mu = mu0 * a.tasteM / 2; // round trip: same per-leg sensitivity as the network model
      const c0 = costs(a, hrs[0], N), c1 = costs(a, hrs[1], N);
      const g = [c0[0] + c1[0], c0[1] + c1[1], c0[2] + c1[2]];
      const asc = [0, 0, (P.ascShuttle + a.asc) / mu];
      const e = [0, 1, 2].map((m) => (m === 2 && !avail) ? 0 : Math.exp(-mu * (g[m] - asc[m] - (m === cur ? P.habit : 0))));
      const S = e[0] + e[1] + e[2];
      return { e, S, mu, g, money: [0, c0[3] + c1[3], c0[4] + c1[4]] };
    };
    // Baseline (no feeder, no aggregator): logsum and spending per household-day
    for (const a of A) {
      const ra = roundTrip(a, a.hA, 0, -1, false), rb = roundTrip(a, a.hB, 0, -1, false);
      a.modeA = R() < ra.e[1] / ra.S ? 1 : 0; a.modeB = R() < rb.e[1] / rb.S ? 1 : 0;
      a.base = {
        ls: (a.alignA ? a.tripsA * Math.log(ra.S) / ra.mu : 0) + (a.alignB ? a.tripsB * Math.log(rb.S) / rb.mu : 0),
        spend: (a.alignA ? a.tripsA * ra.money[1] * ra.e[1] / ra.S : 0) + (a.alignB ? a.tripsB * rb.money[1] * rb.e[1] / rb.S : 0),
        mins: 0,
      };
    }
    // Boda pool calibrated to baseline boda legs (all legs, aligned or not, use bodas)
    let bodaLegs0 = 0, bodaKm0 = 0;
    for (const a of A) { const ra = roundTrip(a, a.hA, 0, -1, false), rb = roundTrip(a, a.hB, 0, -1, false); const l = a.w * 2 * (a.tripsA * ra.e[1] / ra.S + a.tripsB * rb.e[1] / rb.S); bodaLegs0 += l; bodaKm0 += l * a.d * 1.6; }
    const B0 = bodaLegs0 / P.bodaTripsDay;
    let B = B0, bodaLeft = 0, bodaToDriver = 0, bodaToCourier = 0;
    const bodaNet = (legs, riders) => (legs / Math.max(riders, 1)) * (bodaFare(P, 1.2) * bodaMult - P.bodaKmTrip * P.bodaLitreKm * P.bodaFuelL) - P.bodaRent;
    const bodaPay0 = bodaNet(bodaLegs0, B0);
    // Fleet plan from expected full-awareness demand at starting fares
    // Launch fleet: the operator's planning study (full awareness, no habit), iterated like the network model.
    const N0 = (() => {
      let Ng = Math.max(P.minFleet, Math.ceil(Math.max(...cycleH) / 10));
      for (let it = 0; it < 6; it++) {
        const dem = new Array(NH).fill(0);
        for (const a of A) for (const [hrs, trips, al] of [[a.hA, a.tripsA, a.alignA], [a.hB, a.tripsB, a.alignB]]) {
          if (!al) continue; const r = roundTrip(a, hrs, Ng, -1, true); const p = r.e[2] / r.S;
          dem[hrs[0]] += a.w * trips * p; dem[hrs[1]] += a.w * trips * p;
        }
        let need = Math.max(P.minFleet, Math.ceil(Math.max(...cycleH) / P.maxHeadway));
        for (let k = 0; k < NH; k++) need = Math.max(need, Math.ceil((dem[k] * DIR[k]) / (capPerVeh[k] * P.loadDesign)));
        if (need === Ng) break; Ng = need;
      }
      return Ng;
    })();
    let N = Math.max(P.minFleet, Math.round(N0 * P.startFleet)), maxFleet = N;
    const pipeline = []; // [weekDue, n]
    const fleetAdds = []; // [week, n]
    fleetAdds.push([0, Math.ceil(N * (1 + P.spare))]);
    // Aggregator state
    const shops = s.pop / P.shopsPer;
    let shopsOn = 0, adopters = 0;
    const T = [], weekly = [];
    let bodaKmW = bodaKm0;
    let awareShare = 0, userShare = 0;
    for (let wk = 0; wk < P.weeks; wk++) {
      // deliveries
      for (let i = pipeline.length - 1; i >= 0; i--) if (pipeline[i][0] <= wk) { N += pipeline[i][1]; fleetAdds.push([wk, Math.ceil(pipeline[i][1] * (1 + P.spare))]); pipeline.splice(i, 1); }
      maxFleet = Math.max(maxFleet, N);
      // awareness (Bass)
      const pAware = 1 - Math.exp(-(P.bassP + P.bassQ * userShare));
      const dem = new Array(NH).fill(0);
      let ls = 0, spend = 0, bodaLegs = 0, bodaKm = 0, users = 0, aware = 0, mins = 0;
      const wt = A[0].w;
      for (const a of A) {
        if (!a.aware && R() < pAware) a.aware = true;
        if (a.aware) aware++;
        for (const slot of [0, 1]) {
          const hrs = slot ? a.hB : a.hA, trips = slot ? a.tripsB : a.tripsA, al = slot ? a.alignB : a.alignA;
          const cur = slot ? a.modeB : a.modeA;
          const r = roundTrip(a, hrs, N, cur, a.aware && al);
          let u = R() * r.S, m = 0; while (m < 2 && u > r.e[m]) { u -= r.e[m]; m++; }
          if (slot) a.modeB = m; else a.modeA = m;
          // agents keep the mode they drew (habit, word of mouth); loads use the expected split so 90 agents do not make weeks jumpy
          const pr = [r.e[0] / r.S, r.e[1] / r.S, r.e[2] / r.S];
          bodaLegs += a.w * 2 * trips * pr[1]; bodaKm += a.w * 2 * trips * pr[1] * a.d * 1.6;
          if (!al) continue;
          // welfare without habit terms: recompute plain logsum
          const mu = r.mu, asc2 = (P.ascShuttle + a.asc) / mu;
          const plain = Math.exp(-mu * r.g[0]) + Math.exp(-mu * r.g[1]) + (a.aware && N > 0 ? Math.exp(-mu * (r.g[2] - asc2)) : 0);
          ls += a.w * trips * Math.log(plain) / mu;
          spend += a.w * trips * (pr[1] * r.money[1] + pr[2] * r.money[2]);
          if (m === 2) users++;
          dem[hrs[0]] += a.w * trips * pr[2]; dem[hrs[1]] += a.w * trips * pr[2];
        }
      }
      userShare = users / (A.length * 2 * P.align);
      awareShare = aware / A.length;
      // Operations by hour
      let served = 0, refused = 0, rev = 0, vkm = 0, cs = 0, peakLoad = 0;
      const perRev = PERIODS.map(() => 0), perLoad = PERIODS.map(() => 0), perServ = PERIODS.map(() => 0);
      const servedH = new Array(NH).fill(0);
      for (let k = 0; k < NH; k++) {
        const capDir = N * capPerVeh[k];
        const ratio = dem[k] > 0 ? Math.min(1, capDir / (dem[k] * DIR[k])) : 1;
        const S = dem[k] * ratio;
        refusal[k] = (1 - P.memory) * refusal[k] + P.memory * (1 - ratio);
        const pi = PERIOD_OF[HOURS[k]];
        const paid = fares[pi];
        served += S; refused += dem[k] - S; servedH[k] = S;
        rev += S * (paid);
        perRev[pi] += S * paid; perServ[pi] += S;
        const ld = capDir > 0 ? (dem[k] * DIR[k]) / capDir : 0;
        perLoad[pi] = Math.max(perLoad[pi], ld);
        peakLoad = Math.max(peakLoad, Math.min(ld, 1.5));
        vkm += Math.max(N * DEPLOY[k], N > 0 ? 1 : 0) * (60 / cycleH[k]) * 2 * s.route_km;
      }
      const cityCost = served * discount;
      // Bodas respond
      const pay = bodaNet(bodaLegs, B);
      bodaKmW = bodaKm;
      if (pay < P.bodaReserve && B > 1) {
        const leave = B * P.bodaExit * Math.min(1, (P.bodaReserve - pay) / P.bodaReserve * 3);
        B -= leave; bodaLeft += leave;
        bodaMult = Math.max(1 - P.bodaPriceWar, bodaMult - 0.01);
      } else if (pay > P.bodaReserve * 1.3 && B < B0) { B += B * 0.01; bodaLeft = Math.max(0, bodaLeft - B * 0.01); }
      bodaWaitMult = Math.sqrt(Math.max(0.5, B0 / Math.max(B, 1) * (bodaLegs / Math.max(bodaLegs0, 1))));
      // Aggregator
      let orders = 0, couriers = 0;
      if (agg && N > 0) {
        const orderers = adopters;
        orders = orderers * P.ordersWeek / 6; // per day
        couriers = orders / P.courierOrdersDay;
        const perShop = orders / Math.max(shopsOn, 1);
        const gain = perShop * P.orderValue * P.incremental * P.shopMargin - perShop * P.orderValue * P.commission;
        const pJoin = 1 / (1 + Math.exp(-(P.shopJoinBase + gain / 1500 + 3 * (shopsOn / shops))));
        if (wk % 4 === 0) shopsOn = Math.min(shops * P.shopCeil, shopsOn + (shops * P.shopCeil - shopsOn) * pJoin * 0.25);
        const hhAll = s.pop / P.hhSize;
        const pAdopt = 1 - Math.exp(-(P.orderBassP + P.orderBassQ * adopters / hhAll) * Math.min(1, shopsOn / (shops * 0.3)));
        adopters = Math.min(hhAll * P.orderCeil, adopters + (hhAll * P.orderCeil - adopters) * pAdopt);
      }
      const drivers = N * P.driversPerVeh;
      bodaToDriver = Math.min(bodaLeft * P.exBodaHire, drivers);
      bodaToCourier = Math.min(Math.max(bodaLeft - bodaToDriver, 0), couriers);
      // Operator learns fares monthly (learning dynamic) and adjusts fleet
      if (wk % 4 === 3 && wk > 4) {
        if (pricing === "learn") {
          PERIODS.forEach((p, pi) => {
            // objective: fare revenue + weight x riders' benefit share for this period (proxy: riders x average saving)
            const obj = perRev[pi] + P.csWeight * perServ[pi] * 400 - (perLoad[pi] > 1 ? (perLoad[pi] - 1) * perServ[pi] * 300 : 0);
            if (lastObj[pi] !== null && obj < lastObj[pi]) step[pi] = -step[pi];
            lastObj[pi] = obj;
            fares[pi] = Math.max(P.fareMin, Math.min(cap, fares[pi] + step[pi]));
          });
        }
        const pending = pipeline.reduce((x, y) => x + y[1], 0);
        const refRate = refused / Math.max(served + refused, 1);
        if ((peakLoad > 0.97 || refRate > 0.05) && pending === 0) {
          const add = Math.max(1, Math.ceil(N * Math.min(0.25, Math.max(peakLoad - P.loadDesign, refRate))));
          pipeline.push([wk + P.leadWeeks, add]);
        } else if (wk > 30 && peakLoad < 0.6 && N > Math.max(P.minFleet, Math.ceil(Math.max(...cycleH) / P.maxHeadway)) && pending === 0) { N -= 1; fleetAdds.push([wk, -1]); }
      }
      const w = {
        wk, N, served, refused, rev, cityCost, vkm, aware: awareShare, share: served / Math.max(s.pop * P.legRate * P.demandMult, 1),
        fares: fares.slice(), boda: B, bodaPay: pay, bodaMult, orders, shopsOn, adopters, couriers, drivers, bodaToDriver, bodaToCourier,
        ls, spend, peakLoad, servedH, bodaKm: bodaKmW, bodaKm0,
      };
      T.push(w);
      if (record) weekly.push({ wk, N, served: Math.round(served), boda: Math.round(B), orders: Math.round(orders), fare: Math.round(rev / Math.max(served, 1)), aware: +awareShare.toFixed(3) });
    }
    return summarise(s, P, opt, A, T, fleetAdds, B0, bodaPay0, maxFleet, record ? weekly : null, cap);
  }

  /* Money, families, jobs and climate from the simulated weeks. */
  function summarise(s, P, opt, A, T, fleetAdds, B0, bodaPay0, maxFleet, weekly, cap) {
    const V = VEH[opt.vehicle];
    const last = T.slice(-13);
    const avg = (f) => last.reduce((a, w) => a + f(w), 0) / last.length;
    const N = Math.round(avg((w) => w.N));
    const fleet = Math.ceil(N * (1 + P.spare)); // steady-state fleet; vehicles bought and later released are in the cash flow
    const ridersDay = avg((w) => w.served), revDay = avg((w) => w.rev), vkmDay = avg((w) => w.vkm), orders = avg((w) => w.orders);
    const grant = opt.pricing === "inclusive" && V.electric ? P.incl.grant : 0;
    const priceMult = V.electric ? P.capexMult : P.iceMult;
    const usdVeh = V.usd * priceMult;
    const vehCapex = fleet * usdVeh * P.fx * (1 - grant);
    let energy, chargerCapex = 0, kwhDay = 0, battery = 0, fuelL = 0;
    if (V.electric) {
      kwhDay = vkmDay * V.kwhKm * (1 + P.chargeLoss);
      energy = kwhDay * P.tariffOff * 1.08 * P.tariffMult * P.days;
      chargerCapex = (Math.ceil(fleet / V.perCharger) * V.depotUsd + (kwhDay / 6) * P.gridUsdKw) * P.fx * P.capexMult * (1 - grant);
      battery = fleet * V.battKwh * P.battUsdKwh * P.fx * P.capexMult;
    } else { fuelL = vkmDay * V.lKm * P.days; energy = fuelL * P.diesel; }
    const drivers = N * P.driversPerVeh * P.driverMonthly * 12;
    const maint = vkmDay * V.maintKm * P.days;
    const insurance = fleet * usdVeh * P.fx * P.insurance;
    const fixed = fleet * P.fixedPerVeh;
    const idleVh = N * HOURS.reduce((a, h, k) => a + (1 - DEPLOY[k]), 0);
    const ancillary = idleVh * P.ancillaryRate * P.ancillaryUtil * P.days * (opt.agg ? 0.6 : 1); // some idle time goes to parcels
    const parcel = opt.agg ? orders * P.parcelFee * P.days : 0;
    const revenue = revDay * P.days + ancillary + parcel;
    const opex = (energy + drivers + maint + insurance + fixed + revenue * P.payFee) * (1 + P.overhead);
    const annVeh = (vehCapex * (1 - P.residual / Math.pow(1 + P.rate, P.life)) + battery / Math.pow(1 + P.rate, P.battYear)) * crf(P.rate, P.life);
    const annChg = chargerCapex * crf(P.rate, P.chargerLife);
    const profitYr = revenue - opex - annVeh - annChg;
    // 10-year cash flow: simulated years then steady state
    const H = 10, cf = new Array(H).fill(0);
    const yrs = Math.ceil(T.length / 52);
    for (let t = 0; t < H; t++) {
      const wks = t < yrs ? T.slice(t * 52, (t + 1) * 52) : last;
      const k = wks.reduce((a, w) => a + w.rev, 0) / wks.length / Math.max(revDay, 1);
      const nk = wks.reduce((a, w) => a + w.N, 0) / wks.length / Math.max(N, 1);
      cf[t] = revenue * k - opex * (0.5 + 0.5 * nk);
    }
    // purchases, and vehicles released when demand is lower than planned (sold or moved on at 70% of cost)
    fleetAdds.forEach(([wk, n]) => { const t = Math.min(H - 1, Math.floor(wk / 52)); cf[t] -= n * usdVeh * P.fx * (1 - grant) * (n < 0 ? 0.7 : 1); });
    cf[0] -= chargerCapex;
    if (battery) cf[Math.min(H - 1, P.battYear)] -= battery;
    cf[H - 1] += vehCapex * P.residual;
    const npv = cf.reduce((a, v, t) => a + v / Math.pow(1 + P.rate, t + 1), 0);
    const cityYr = avg((w) => w.cityCost) * P.days;
    // Families
    const hh = s.pop / P.hhSize;
    const baseLs = A.reduce((a, x) => a + x.w * x.base.ls, 0), baseSpend = A.reduce((a, x) => a + x.w * x.base.spend, 0);
    const lsNow = avg((w) => w.ls), spendNow = avg((w) => w.spend);
    const month = P.days / 12;
    const welfareHHm = ((lsNow - baseLs) / hh) * month; // UGX per household per month (money + time, logit consumer surplus)
    const spendHHm = ((spendNow - baseSpend) / hh) * month; // change in cash spent on these trips
    // income terciles: welfare per household from agent-level logsum is not stored per week; use final week by tercile
    const terc = terciles(s, P, A, T[T.length - 1]);
    // Boda households
    const Bend = avg((w) => w.boda), bodaPay = avg((w) => w.bodaPay);
    const bodaJobsLost = B0 - Bend;
    const exBodaDrivers = avg((w) => w.bodaToDriver), exBodaCouriers = avg((w) => w.bodaToCourier);
    const bodaEarnChangeM = ((Bend * bodaPay - B0 * bodaPay0) * month) / Math.max(B0, 1); // per original rider, per month
    // Aggregator
    const adopters = avg((w) => w.adopters), shopsOn = avg((w) => w.shopsOn), couriers = orders / P.courierOrdersDay;
    // Each order replaces a shopping round trip: time on foot, or a boda there and back for some.
    const votS = P.vot * Math.exp(P.votRwi * (s.rwi - 1.2)) / 60;
    const savePerOrder = (2 * P.shopKm / P.walkKmh) * 60 * votS * (1 - P.shopBodaShare) + P.shopBodaShare * 2 * bodaFare(P, P.shopKm) - P.deliveryFee;
    const aggAdopterM = adopters > 0 ? P.ordersWeek * (52 / 12) * savePerOrder : 0; // per ordering household
    const aggHHm = aggAdopterM * adopters / hh; // averaged over all households
    const shopGainM = shopsOn > 0 ? (orders * P.orderValue * (P.incremental * P.shopMargin - P.commission) * month) / shopsOn : 0;
    const platformYr = opt.agg ? orders * P.days * (P.orderValue * P.commission + P.deliveryFee - P.parcelFee - P.courierDay / P.courierOrdersDay) - P.aggTechMonthly * 12 * (s.pop / 150000) : 0;
    const shopJobs = opt.agg ? (orders * P.orderValue * P.incremental * month) / P.salesPerShopJob : 0;
    // Jobs
    const jDrivers = N * P.driversPerVeh, jTech = fleet * P.techPerVeh, jPlant = V.local ? fleet * P.plantJobsPerUnit : 0;
    const jobs = { drivers: jDrivers, tech: jTech, plant: jPlant, couriers, shops: shopJobs, boda: -bodaJobsLost };
    jobs.net = jDrivers + jTech + jPlant + couriers + shopJobs - bodaJobsLost;
    // Climate: boda km avoided, minus feeder energy
    const bodaKmCut = avg((w) => w.bodaKm0 - w.bodaKm);
    const co2 = (bodaKmCut * P.bodaKgKm - (V.electric ? kwhDay * P.gridKgKwh : vkmDay * V.lKm * P.dieselKgL) - (opt.agg ? couriers * 30 * 0.02 : 0)) * P.days / 1000;
    const fuelImportUsd = (V.electric ? 0 : fuelL * 1.0) * 0.85; // ~USD 0.85 per litre landed
    const r = {
      opt, N, fleet, ridersDay, revDay, avgFare: revDay / Math.max(ridersDay, 1), fares: T[T.length - 1].fares, fareCap: cap,
      share: avg((w) => w.share), aware: avg((w) => w.aware), peakLoad: avg((w) => w.peakLoad), refused: avg((w) => w.refused),
      revenueYr: revenue, opexYr: opex, profitYr, npv, cityYr, vehCapex, chargerCapex, kwhDay, fuelL, fuelImportUsd,
      costPerRide: (opex + annVeh + annChg) / Math.max(ridersDay * P.days, 1), costPerSeatKm: (opex + annVeh + annChg) / Math.max(vkmDay * P.days * VEH[opt.vehicle].cap, 1),
      welfareHHm, spendHHm, terc, bodaPct: bodaEarnChangeM / Math.max(1, bodaPay0 * month), bodaB0: B0, bodaEnd: Bend, bodaPay0, bodaPay, bodaEarnChangeM, exBodaDrivers, exBodaCouriers,
      orders, adopters, shopsOn, shops: s.pop / P.shopsPer, couriers, aggHHm, aggAdopterM, bodaKmCut, shopGainM, platformYr,
      jobs, co2, weekly,
      routeRiders: ridersDay, routeKm: s.route_km, servedH: T[T.length - 1].servedH.map((x) => Math.round(x)),
    };
    return r;
  }

  // Welfare (UGX per household-month) by income tercile, from the final week against baseline.
  function terciles(s, P, A, wk) {
    const idx = A.map((a, i) => i).sort((i, j) => A[i].inc - A[j].inc);
    const out = [];
    for (let t = 0; t < 3; t++) {
      const g = idx.slice(Math.floor(t * A.length / 3), Math.floor((t + 1) * A.length / 3)).map((i) => A[i]);
      const share = g.reduce((a, x) => a + ((x.modeA === 2 ? 1 : 0) + (x.modeB === 2 ? 1 : 0)) / 2, 0) / g.length;
      const inc = g.reduce((a, x) => a + x.inc, 0) / g.length;
      out.push({ inc, useShare: share });
    }
    return out;
  }

  // Draw one set of uncertain inputs.
  function draw(R, base, U) { const p = Object.assign({}, base); (U || UNCERTAIN).forEach((u) => (p[u.key] = u.lo + (u.hi - u.lo) * R())); return p; }

  const OPTIONS = [];
  ["e14", "midi", "ice14"].forEach((v) => ["flat", "learn", "inclusive"].forEach((p) => [false, true].forEach((g) => OPTIONS.push({ id: `${v}|${p}|${g ? 1 : 0}`, vehicle: v, pricing: p, agg: g }))));
  const optLabel = (o) => `${VEH[o.vehicle].short} · ${PRICING[o.pricing].name}${o.agg ? " · + aggregator" : ""}`;

  /* Every option for one suburb, over several futures (draws). Returns compact stats. */
  function suburbGrid(s, params, reps, seed, onlyOpts) {
    // params.__unc lets the page move the centre of each uncertain range
    const U = (params && params.__unc) || UNCERTAIN;
    const P0 = merge(DEFAULTS, Object.assign({}, params, { __unc: undefined }));
    const R = rng((seed || 11) + s.sid * 101);
    const draws = [];
    for (let i = 0; i < reps; i++) draws.push(merge(P0, draw(R, {}, U)));
    const ok = optionsFor(s);
    const opts = OPTIONS.filter((o) => ok.includes(o.vehicle) && (!onlyOpts || onlyOpts.includes(o.id)));
    const res = {};
    for (const o of opts) {
      const runs = draws.map((P, i) => simSuburb(s, P, o, 1000 + s.sid * 17 + i, false));
      res[o.id] = runs;
    }
    return { sid: s.sid, code: s.code, opts: opts.map((o) => o.id), res, draws };
  }

  const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);

  // Compact numbers per option (median and 10th/90th percentiles) that the page scores.
  function stats(grid, P) {
    const fx = (P && P.fx) || DEFAULTS.fx;
    const out = {};
    for (const id of grid.opts) {
      const runs = grid.res[id];
      const f = (g) => { const v = runs.map(g); return [q(v, 0.1), q(v, 0.5), q(v, 0.9)]; };
      out[id] = {
        npv: f((r) => r.npv / fx / 1e6), profit: f((r) => r.profitYr / fx / 1e6), pProfit: mean(runs.map((r) => (r.npv > 0 ? 1 : 0))),
        riders: f((r) => r.ridersDay), fleet: f((r) => r.fleet), fare: f((r) => r.avgFare), costRide: f((r) => r.costPerRide),
        welfare: f((r) => r.welfareHHm + r.aggHHm), spend: f((r) => r.spendHHm), agg: f((r) => r.aggHHm),
        jobsNet: f((r) => r.jobs.net), drivers: f((r) => r.jobs.drivers), tech: f((r) => r.jobs.tech), plant: f((r) => r.jobs.plant), couriers: f((r) => r.jobs.couriers), shopJobs: f((r) => r.jobs.shops), bodaLost: f((r) => -r.jobs.boda),
        exBoda: f((r) => r.exBodaDrivers + r.exBodaCouriers), bodaEarn: f((r) => r.bodaEarnChangeM), bodaPct: f((r) => r.bodaPct), bodaB0: f((r) => r.bodaB0),
        co2: f((r) => r.co2), fuelUsd: f((r) => r.fuelImportUsd / 1e6), city: f((r) => r.cityYr / fx / 1e6),
        orders: f((r) => r.orders), shopsOn: f((r) => r.shopsOn), shopGain: f((r) => r.shopGainM), platform: f((r) => r.platformYr / fx / 1e6),
        useLow: f((r) => r.terc[0].useShare), useHigh: f((r) => r.terc[2].useShare), share: f((r) => r.share),
        peakLoad: f((r) => r.peakLoad), fares: runs[Math.floor(runs.length / 2)].fares,
        npvRuns: runs.map((r) => +(r.npv / fx / 1e6).toFixed(3)),
      };
    }
    return out;
  }

  /* Score options for one suburb: weights on families, jobs, operator money, robustness and climate. */
  function score(st, w) {
    const AF = (1 - Math.pow(1.12, -10)) / 0.12; // 10 years at 12%: public subsidy and platform profit count against/with the operator's NPV
    const ids = Object.keys(st);
    const crit = {
      families: (x) => x.welfare[1], jobs: (x) => x.jobsNet[1], money: (x) => x.npv[1] + AF * (x.platform[1] - x.city[1]), robust: (x) => x.npv[0] + AF * (x.platform[0] - x.city[2]), climate: (x) => x.co2[1],
    };
    const norm = {};
    for (const c in crit) { const v = ids.map((i) => crit[c](st[i])); const lo = Math.min(...v), hi = Math.max(...v); norm[c] = (i) => (hi - lo < 1e-9 ? 0.5 : (crit[c](st[i]) - lo) / (hi - lo)); }
    const tw = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    return ids.map((id) => ({ id, score: Object.keys(crit).reduce((a, c) => a + (w[c] || 0) * norm[c](id), 0) / tw, parts: Object.fromEntries(Object.keys(crit).map((c) => [c, norm[c](id)])) })).sort((a, b) => b.score - a.score);
  }

  /* Whole network, week by week. Each suburb runs its chosen option; electric fleets wait for Kiira's output
   * (shared by all suburbs in priority order), diesel taxis are imported and can start at once. */
  function network(subs, params, choice, seedIn) {
    const U = (params && params.__unc) || null;
    const P = merge(DEFAULTS, Object.assign({}, params, { __unc: undefined }, U ? Object.fromEntries(U.map((u) => [u.key, (u.lo + u.hi) / 2])) : {}));
    const pr = KM.priority(subs);
    const order = subs.map((s, i) => i).sort((a, b) => pr[b] - pr[a]);
    const runs = {}, startWeek = {};
    order.forEach((i) => { runs[i] = simSuburb(subs[i], P, choice(subs[i]), (seedIn || 5) + i * 13, true); });
    let stock = 0, wkp = 0;
    order.forEach((i) => {
      const r = runs[i];
      if (!VEH[r.opt.vehicle].local) { startWeek[i] = 0; return; }
      while (stock < r.fleet) { stock += P.plantMonthly; wkp += 52 / 12; }
      stock -= r.fleet; startWeek[i] = Math.round(wkp);
    });
    const W = P.weeks + Math.max(...Object.values(startWeek));
    const weeks = [];
    for (let t = 0; t < W; t += 2) {
      const row = { wk: t, riders: 0, fleet: 0, boda: 0, orders: 0, suburbsLive: 0, by: {} };
      order.forEach((i) => {
        const r = runs[i], k = t - startWeek[i], sid = subs[i].sid;
        if (k < 0) { row.boda += r.bodaB0; row.by[sid] = [0, 0, Math.round(r.bodaB0), 0, 0]; return; }
        const w = r.weekly[Math.min(k, r.weekly.length - 1)];
        row.riders += w.served; row.fleet += Math.ceil(w.N * (1 + P.spare)); row.boda += w.boda; row.orders += w.orders; row.suburbsLive++;
        row.by[sid] = [w.served, w.fare, w.boda, w.orders, w.aware];
      });
      weeks.push(row);
    }
    return { startWeek, runs, weeks, order };
  }

  return { VEH, PRICING, OPTIONS, DEFAULTS, UNCERTAIN, simSuburb, suburbGrid, stats, score, network, optLabel, optionsFor, midiOk, merge, rng, quantile: q };
});
