// Market research stats for Skipful Research pages.
// Pure function over the same public-safe data the city guides use:
//   collabs: [{ i?, p, d, f }]  hotel id, post date (YYYY-MM-DD), creator followers
//   props:   [{ id, title, city, state, country, stars, rating, type }]
// Output is aggregate only: no hotel names, no creator handles.

export const MIN_REAL_FOLLOWERS = 500;
export const BUCKETS = [
  ['Under 5K', 0, 5e3], ['5K–10K', 5e3, 1e4], ['10K–50K', 1e4, 5e4],
  ['50K–100K', 5e4, 1e5], ['100K–500K', 1e5, 5e5], ['500K+', 5e5, Infinity],
];

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const bucketOf = f => BUCKETS.findIndex(([, lo, hi]) => f >= lo && f < hi);
function split(list) {
  const n = BUCKETS.map(() => 0);
  for (const f of list) n[bucketOf(f)]++;
  const total = list.length;
  return {
    total,
    buckets: BUCKETS.map(([label], i) => ({ label, n: n[i], pct: pct(n[i], total) })),
    under10k: pct(n[0] + n[1], total),
    over100k: pct(n[4] + n[5], total),
    median: median(list),
  };
}

export function computeResearch({ collabs, props }, { now = Date.now(), cleanCity = c => c, countryName = c => c } = {}) {
  const propById = new Map(props.map(p => [p.id, p]));
  const seen = new Set();
  const rows = [];
  for (const c of collabs) {
    if (!c.p) continue;
    const key = c.i != null ? `id:${c.i}` : `${c.p}|${c.d}|${c.f}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = Number(c.f);
    const t = c.d ? Date.parse(c.d) : NaN;
    if (!(f >= MIN_REAL_FOLLOWERS) || Number.isNaN(t) || t > now + 864e5) continue;
    rows.push({ p: c.p, t, f, prop: propById.get(c.p) || null });
  }

  const yearAgo = now - 365 * 864e5;
  const last12 = rows.filter(r => r.t > yearAgo);

  // Hotels
  const hotels = new Map();
  for (const r of rows) {
    let h = hotels.get(r.p);
    if (!h) hotels.set(r.p, h = { n: 0, ts: [], min: Infinity });
    h.n++; h.ts.push(r.t); if (r.f < h.min) h.min = r.f;
  }
  const hotelList = [...hotels.values()];
  const gaps = [];
  for (const h of hotelList) {
    if (h.n < 2) continue;
    const ts = h.ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const g = (ts[i] - ts[i - 1]) / 864e5;
      if (g >= 1) gaps.push(g); // same-day posts are usually one stay
    }
  }

  // Splits by property attributes (last 12 months)
  const byStars = {};
  for (const s of [3, 4, 5]) {
    const list = last12.filter(r => r.prop && Math.round(Number(r.prop.stars)) === s).map(r => r.f);
    if (list.length >= 200) byStars[`${s}-star`] = split(list);
  }
  const typeOf = p => {
    const t = String(p?.type || '').toLowerCase();
    if (/resort/.test(t)) return 'Resorts';
    if (/boutique/.test(t)) return 'Boutique hotels';
    if (/villa|bungalow|guest|hostel|inn|lodge|b&b|bed/.test(t)) return 'Villas, inns & lodges';
    if (/hotel/.test(t) || !t) return 'Hotels';
    return 'Other';
  };
  const byType = {};
  for (const r of last12) {
    if (!r.prop) continue;
    (byType[typeOf(r.prop)] ||= []).push(r.f);
  }
  for (const k of Object.keys(byType)) byType[k] = byType[k].length >= 200 ? split(byType[k]) : undefined;

  // Countries and cities (last 12 months)
  const countries = new Map();
  const cities = new Map();
  for (const r of last12) {
    if (!r.prop) continue;
    const country = countryName(r.prop.country) || 'Unknown';
    const isUS = /^(US|USA|United States)$/i.test(String(r.prop.country || '').trim());
    const city = cleanCity(r.prop.city || '');
    let C = countries.get(country);
    if (!C) countries.set(country, C = { name: country, f: [], hotels: new Set() });
    C.f.push(r.f); C.hotels.add(r.p);
    if (!city) continue;
    const key = `${city}|${isUS ? r.prop.state || '' : ''}|${country}`;
    let K = cities.get(key);
    if (!K) cities.set(key, K = { city, state: isUS ? String(r.prop.state || '') : '', country, isUS, f: [], hotels: new Set(), prev: 0 });
    K.f.push(r.f); K.hotels.add(r.p);
  }
  const place = K => (K.isUS && K.state ? `${K.city}, ${K.state}` : K.country && K.country !== K.city ? `${K.city}, ${K.country}` : K.city);
  const cityRows = [...cities.values()].map(K => {
    const s = split(K.f);
    return { city: K.city, place: place(K), country: K.country, isUS: K.isUS, state: K.state, collabs: s.total, hotels: K.hotels.size, under10k: s.under10k, median: s.median };
  });
  const countryRows = [...countries.values()].map(C => {
    const s = split(C.f);
    return { name: C.name, collabs: s.total, hotels: C.hotels.size, under10k: s.under10k, median: s.median };
  }).sort((a, b) => b.collabs - a.collabs);

  // Stability check: the under-10K share month by month (months with enough data).
  // Collection volume changed over time, so we only ever publish shares, never volume trends.
  const monthShares = [];
  {
    const byMonth = new Map();
    for (const r of rows) { const k = new Date(r.t).toISOString().slice(0, 7); (byMonth.get(k) || byMonth.set(k, []).get(k)).push(r.f); }
    for (const [m, l] of [...byMonth].sort()) if (l.length >= 300) monthShares.push({ month: m, under10k: split(l).under10k });
  }

  const hostedSmall = hotelList.filter(h => h.min < 1e4).length;
  const repeat2 = hotelList.filter(h => h.n >= 2).length;
  const repeat5 = hotelList.filter(h => h.n >= 5).length;
  const repeat10 = hotelList.filter(h => h.n >= 10).length;

  return {
    generatedAt: new Date(now).toISOString(),
    totals: {
      collabs: rows.length,
      collabs12: last12.length,
      hotels: hotels.size,
      countries: new Set(rows.map(r => r.prop && countryName(r.prop.country)).filter(Boolean)).size,
      cities: new Set(rows.map(r => r.prop && cleanCity(r.prop.city || '')).filter(Boolean)).size,
      first: rows.length ? new Date(Math.min(...rows.map(r => r.t))).toISOString().slice(0, 10) : null,
      last: rows.length ? new Date(Math.max(...rows.map(r => r.t))).toISOString().slice(0, 10) : null,
    },
    allTime: split(rows.map(r => r.f)),
    last12: split(last12.map(r => r.f)),
    byStars, byType,
    stability: monthShares.length ? { months: monthShares.length, min: Math.min(...monthShares.map(m => m.under10k)), max: Math.max(...monthShares.map(m => m.under10k)) } : null,
    hosts: {
      hotels: hotels.size,
      hostedUnder10kPct: pct(hostedSmall, hotels.size),
      repeat2Pct: pct(repeat2, hotels.size), repeat5Pct: pct(repeat5, hotels.size), repeat10Pct: pct(repeat10, hotels.size),
      medianDaysBetween: median(gaps.map(Math.round)),
      avgCollabsPerHotel: Math.round((rows.length / Math.max(1, hotels.size)) * 10) / 10,
    },
    countries: countryRows.filter(c => c.collabs >= 150).sort((a, b) => b.under10k - a.under10k),
    smallFriendlyCities: cityRows.filter(c => c.collabs >= 60 && c.hotels >= 8).sort((a, b) => b.under10k - a.under10k).slice(0, 12),
    toughestCities: cityRows.filter(c => c.collabs >= 60 && c.hotels >= 8).sort((a, b) => a.under10k - b.under10k).slice(0, 6),
  };
}

// ---------- City ranking: "The Most Creator-Friendly Hotel Cities" ----------
// allProps: every hotel Skipful tracks (with or without collabs), so each city has a real hosting rate.
// Shares and rates only; no volume trends, no hotel names.
export const RANK_MIN = { tracked: 30, hosts: 6, collabs12: 30 };
const LODGING_TYPE = /hotel|resort|inn|motel|lodge|hostel|suites|guest ?house|bed (and|&) breakfast|b&b|villa|bungalow|ryokan|aparthotel|serviced apartment|cottage|cabin|glamping/i;

export function computeCityRanking({ collabs, allProps }, { now = Date.now(), cleanCity = c => c, countryName = c => c, fold = s => String(s).toLowerCase(), top = 50 } = {}) {
  const yearAgo = now - 365 * 864e5;
  const seen = new Set();
  const byHotel = new Map();
  for (const c of collabs) {
    if (!c.p) continue;
    const key = c.i != null ? `id:${c.i}` : `${c.p}|${c.d}|${c.f}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = Number(c.f), t = c.d ? Date.parse(c.d) : NaN;
    if (!(f >= MIN_REAL_FOLLOWERS) || Number.isNaN(t) || t > now + 864e5) continue;
    let h = byHotel.get(c.p);
    if (!h) byHotel.set(c.p, h = { n: 0, f12: [] });
    h.n++;
    if (t > yearAgo) h.f12.push(f);
  }

  const cities = new Map();
  let tracked = 0, hosting = 0;
  for (const p of allProps) {
    if (!LODGING_TYPE.test(String(p.type || 'Hotel'))) continue;
    const city = cleanCity(p.city || '');
    if (!city) continue;
    tracked++;
    const country = countryName(p.country) || '';
    const isUS = /^(US|USA|United States)$/i.test(String(p.country || '').trim());
    const state = isUS ? String(p.state || '').trim() : '';
    const key = fold(`${city}|${state}|${country}`);
    let K = cities.get(key);
    if (!K) cities.set(key, K = { key, city, state, country, isUS, tracked: 0, hosts: 0, repeat: 0, f12: [], five: 0, fiveHosts: 0 });
    K.tracked++;
    const five = Math.round(Number(p.stars)) === 5;
    if (five) K.five++;
    const h = byHotel.get(p.id);
    if (h) {
      hosting++;
      K.hosts++;
      if (h.n >= 2) K.repeat++;
      for (const f of h.f12) K.f12.push(f);
      if (five) K.fiveHosts++;
    }
  }

  const rows = [...cities.values()].map(K => ({
    key: K.key, city: K.city, state: K.state, country: K.country, isUS: K.isUS,
    place: K.isUS && K.state ? `${K.city}, ${K.state}` : (K.country && K.country !== K.city ? `${K.city}, ${K.country}` : K.city),
    tracked: K.tracked, hosts: K.hosts,
    hostingRate: pct(K.hosts, K.tracked),
    collabs12: K.f12.length,
    under10k: pct(K.f12.filter(f => f < 1e4).length, K.f12.length),
    medianFollowers: median(K.f12),
    repeatRate: pct(K.repeat, K.hosts),
    fiveStar: K.five, fiveStarHosts: K.fiveHosts, fiveStarHostingRate: pct(K.fiveHosts, K.five),
  }));
  const eligible = rows.filter(r => r.tracked >= RANK_MIN.tracked && r.hosts >= RANK_MIN.hosts && r.collabs12 >= RANK_MIN.collabs12);

  // Score: equal-weighted percentile ranks of three rates, scaled 0-100.
  const pctRank = (list, k) => { const s = list.map(r => r[k]).sort((a, b) => a - b); return v => (s.length > 1 ? (s.filter(x => x < v).length + (s.filter(x => x === v).length - 1) / 2) / (s.length - 1) : 1); };
  const pr = { hostingRate: pctRank(eligible, 'hostingRate'), under10k: pctRank(eligible, 'under10k'), repeatRate: pctRank(eligible, 'repeatRate') };
  for (const r of eligible) r.score = Math.round(((pr.hostingRate(r.hostingRate) + pr.under10k(r.under10k) + pr.repeatRate(r.repeatRate)) / 3) * 100);
  eligible.sort((a, b) => (b.score - a.score) || (b.hostingRate - a.hostingRate) || (b.hosts - a.hosts));
  eligible.forEach((r, i) => { r.rank = i + 1; });

  const topN = (list, k, n = 5) => [...list].sort((a, b) => (b[k] - a[k]) || (b.hosts - a.hosts)).slice(0, n).map(r => ({ key: r.key, place: r.place, value: r[k] }));
  return {
    generatedAt: new Date(now).toISOString(),
    method: { min: RANK_MIN, weights: { hostingRate: 1 / 3, under10k: 1 / 3, repeatRate: 1 / 3 } },
    totals: { tracked, hosting, cities: rows.filter(r => r.hosts > 0).length, eligible: eligible.length },
    ranking: eligible.slice(0, top).map(({ fiveStarHostingRate, ...r }) => r),
    categories: {
      smallCreators: topN(eligible, 'under10k'),
      mostOpen: topN(eligible, 'hostingRate'),
      luxury: topN(eligible.filter(r => r.fiveStar >= 6 && r.fiveStarHosts >= 4), 'fiveStarHostingRate').map(x => ({ ...x, of: eligible.find(r => r.key === x.key).fiveStar, hosts: eligible.find(r => r.key === x.key).fiveStarHosts })),
      loyalHosts: topN(eligible.filter(r => r.hosts >= 10), 'repeatRate'),
    },
  };
}
