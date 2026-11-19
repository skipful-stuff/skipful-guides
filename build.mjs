// Skipful city guides: static site generator.
// Pulls public-safe data from the Xano seo_city_pages endpoint in small pages,
// groups it by city, and writes one page per city plus an index, sitemap and robots.txt.
//
// Env:
//   XANO_SEO_URL   full URL of the seo_city_pages endpoint (if missing, uses data/sample.json)
//   SEO_EXPORT_KEY optional key the endpoint checks once it exists in Xano
//   SITE_URL       public URL of this site, default https://guides.skipful.com
//   APP_URL        Skipful app, default https://www.skipful.com
//   GA4_ID         optional Google Analytics measurement id (G-XXXX)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://guides.skipful.com').replace(/\/$/, '');
const APP_URL = (process.env.APP_URL || 'https://www.skipful.com').replace(/\/$/, '');
const GA4_ID = process.env.GA4_ID || '';
const GSC_TOKEN = process.env.GSC_TOKEN || '';   // Google Search Console "HTML tag" verification value
const XANO = process.env.XANO_SEO_URL || '';
const KEY = process.env.SEO_EXPORT_KEY || '';
const MIN_HOTELS = 3;      // a city needs at least this many collab hotels to get a page
const SHOWN_HOTELS = 12;   // hotels listed publicly per city; the rest stay in the app
const SECTION = 'hotels-that-work-with-influencers';
const MIN_REAL_FOLLOWERS = 500; // below this the follower count is almost certainly bad data

// ---------- data ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(body, attempt = 1) {
  try {
    const res = await fetch(XANO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(KEY ? { ...body, key: KEY } : body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt >= 4) throw new Error(`Xano ${body.dataset} failed: ${e.message}`);
    await sleep(3000 * attempt); // be gentle with the small instance
    return call(body, attempt + 1);
  }
}

async function fetchAll() {
  const collabs = [];
  for (let page = 1; page < 500; page++) {
    const rows = await call({ dataset: 'collabs', page });
    if (!Array.isArray(rows) || rows.length === 0) break;
    collabs.push(...rows);
    await sleep(400);
  }
  const ids = [...new Set(collabs.map(c => c.p).filter(Boolean))];
  const props = [];
  const scores = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    props.push(...await call({ dataset: 'properties', ids: chunk }));
    await sleep(300);
    scores.push(...await call({ dataset: 'scores', ids: chunk }));
    await sleep(300);
  }
  return { collabs, props, scores };
}

async function loadData() {
  if (!XANO) {
    console.log('XANO_SEO_URL not set: using data/sample_compact.json');
    const s = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'sample_compact.json'), 'utf8'));
    return {
      collabs: s.c.map(([p, d, f]) => ({ p, d, f })),
      props: s.p.map(([id, title, city, state, country, stars, rating, type]) => ({ id, title, city, state, country, stars, rating, type })),
      scores: s.s.map(([p, sc]) => ({ p, s: sc })),
    };
  }
  const data = await fetchAll();
  console.log(`Fetched ${data.collabs.length} collabs, ${data.props.length} hotels, ${data.scores.length} scores`);
  if (data.collabs.length < 100) throw new Error('Suspiciously little data; refusing to publish a near-empty site');
  return data;
}

// ---------- shaping ----------

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(c) {
  const s = String(c || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) { try { return regionNames.of(s.toUpperCase()) || s; } catch { return s; } }
  return s;
}

function slugify(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// City names in the data are messy ("Prague 9", "Medellín, El Poblado, Medellin",
// "Badung Regency"). Clean them so one destination gets one page.
const fold = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const CITY_ALIASES = {
  'badung regency': 'Bali', 'badung': 'Bali', 'kabupaten badung': 'Bali', 'kuta': 'Bali', 'north kuta': 'Bali',
  'south kuta': 'Bali', 'kuta selatan': 'Bali', 'kuta utara': 'Bali', 'seminyak': 'Bali', 'canggu': 'Bali',
  'gianyar regency': 'Ubud', 'gianyar': 'Ubud', 'kabupaten gianyar': 'Ubud',
  'new york city': 'New York', 'nyc': 'New York', 'manhattan': 'New York',
  'ciudad de mexico': 'Mexico City', 'cdmx': 'Mexico City',
  'thalang': 'Phuket', 'kathu': 'Phuket', 'phuket': 'Phuket', 'karon': 'Phuket', 'patong': 'Phuket',
  'ko samui': 'Koh Samui', 'ko chang': 'Koh Chang', 'ko pha ngan': 'Koh Phangan', 'ko tao': 'Koh Tao',
  'bang lamung': 'Pattaya', 'chiang mai': 'Chiang Mai', 'krabi': 'Krabi', 'ao nang': 'Krabi',
  'central lombok': 'Lombok', 'east lombok': 'Lombok', 'north lombok': 'Lombok', 'west lombok': 'Lombok',
  'cartagena': 'Cartagena',
  'khlong toei': 'Bangkok', 'watthana': 'Bangkok', 'pathum wan': 'Bangkok', 'bang rak': 'Bangkok', 'sathon': 'Bangkok',
  'ratchathewi': 'Bangkok', 'huai khwang': 'Bangkok', 'phra nakhon': 'Bangkok', 'khlong san': 'Bangkok', 'bangkok': 'Bangkok',
  'denpasar city': 'Denpasar', 'mataram city': 'Lombok', 'mataram': 'Lombok',
};
const JAKARTA = /^(central|south|north|west|east) jakarta( city)?$|^jakarta( city)?$/;
function cleanCity(raw) {
  let parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return '';
  let city = parts[0];
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (parts.slice(0, -1).some(p => fold(p) === fold(last))) city = parts.find(p => fold(p) === fold(last) && /[^\x00-\x7F]/.test(p)) || last;
  }
  city = city.replace(/\s+\d+([\s-].*)?$/, '').trim();          // "Prague 9", "Prague 5-Smíchov"
  city = city.replace(/^(Mueang|Amphoe|Kabupaten|Kota)\s+/i, '')  // "Mueang Phuket District"
    .replace(/\s+(District|Regency|Province|Municipality)$/i, '').trim();
  if (JAKARTA.test(fold(city))) return 'Jakarta';
  return CITY_ALIASES[fold(city)] || city;
}

function shape({ collabs, props, scores }) {
  const propById = new Map(props.map(p => [p.id, p]));
  const scoreById = new Map();
  for (const s of scores) if (s.s != null) scoreById.set(s.p, Math.max(scoreById.get(s.p) ?? 0, s.s));
  const now = Date.now();
  const yearAgo = now - 365 * 864e5;

  // Guard against reading the same row twice (rows carry their id as `i`).
  const seen = new Set();
  const byHotel = new Map();
  for (const c of collabs) {
    if (!c.p) continue;
    const dupKey = c.i != null ? `id:${c.i}` : `${c.p}|${c.d}|${c.f}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    let h = byHotel.get(c.p);
    if (!h) byHotel.set(c.p, h = { n: 0, n12: 0, minF: null, last: null });
    h.n++;
    const t = c.d ? Date.parse(c.d) : NaN;
    if (!Number.isNaN(t)) {
      if (t > yearAgo) h.n12++;
      if (h.last === null || t > h.last) h.last = t;
    }
    const f = Number(c.f);
    if (f >= MIN_REAL_FOLLOWERS && (h.minF === null || f < h.minF)) h.minF = f;
  }

  const cities = new Map();
  for (const [id, h] of byHotel) {
    const p = propById.get(id);
    if (!p || !p.city || !p.title) continue;
    const city = cleanCity(p.city);
    if (!city) continue;
    const country = countryName(p.country);
    const state = String(p.state || '').trim();
    const isUS = /^(US|USA|United States)$/i.test(String(p.country || '').trim());
    const key = fold(`${city}|${isUS ? state : ''}|${country}`);
    let C = cities.get(key);
    if (!C) cities.set(key, C = { city, state: isUS ? state : '', country, isUS, hotels: [], collabs: 0, collabs12: 0, last: null });
    if (/[^\x00-\x7F]/.test(city) && !/[^\x00-\x7F]/.test(C.city)) C.city = city; // prefer "Medellín" over "Medellin"
    C.collabs += h.n;
    C.collabs12 += h.n12;
    if (h.last && (!C.last || h.last > C.last)) C.last = h.last;
    C.hotels.push({
      id, name: String(p.title).trim(), type: p.type || null,
      stars: p.stars || null, rating: p.rating || null, score: scoreById.get(id) ?? null,
      collabs: h.n, collabs12: h.n12, smallest: h.minF, last: h.last,
    });
  }

  const list = [...cities.values()].filter(c => c.hotels.length >= MIN_HOTELS);
  const used = new Set();
  for (const c of list) {
    c.hotels.sort((a, b) => (b.collabs - a.collabs) || ((b.score || 0) - (a.score || 0)));
    const smalls = c.hotels.map(h => h.smallest).filter(Boolean).sort((a, b) => a - b);
    c.smallest = smalls[0] ?? null;
    c.medianSmallest = smalls.length ? smalls[Math.floor(smalls.length / 2)] : null;
    c.under10k = c.hotels.filter(h => h.smallest && h.smallest < 10000).length;
    let slug = slugify(c.isUS && c.state ? `${c.city} ${c.state}` : `${c.city} ${c.country}`);
    if (used.has(slug)) slug = `${slug}-${c.hotels[0].id}`;
    used.add(slug);
    c.slug = slug;
    c.place = c.isUS && c.state ? `${c.city}, ${c.state}` : (c.country && c.country !== c.city ? `${c.city}, ${c.country}` : c.city);
  }
  list.sort((a, b) => b.collabs - a.collabs);
  return list;
}

// ---------- formatting ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmtInt = n => Number(n).toLocaleString('en-US');
function fmtFollowers(n) {
  if (!n) return null;
  if (n < 1000) return `${n}`;
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}
const fmtMonth = t => t ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const stars = n => n ? `${Math.round(n)}-star` : '';
const plural = (n, one, many = one + 's') => `${fmtInt(n)} ${n === 1 ? one : many}`;
const signupUrl = campaign => `${APP_URL}/signup/?utm_source=guides&utm_medium=seo&utm_campaign=${encodeURIComponent(campaign)}`;

// ---------- templates ----------

const CSS = `
:root{--ink:#0E1A17;--ink2:#15241F;--ivory:#F3EDE2;--paper:#FBF8F2;--champ:#C8A86B;--bronze:#8A6A2E;--line:#E7E0D3;--muted:#4A5852;--mist:#A9B3AC}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.65 Manrope,system-ui,-apple-system,Segoe UI,sans-serif}
a{color:var(--bronze);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
header.top{background:var(--ink);color:var(--ivory)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;height:68px}
.logo{font:600 26px/1 'Cormorant Garamond',Georgia,serif;color:var(--ivory);letter-spacing:.01em}
.logo:hover{text-decoration:none}
.navcta{font-size:14px;font-weight:600;color:var(--ink);background:var(--champ);padding:10px 18px;border-radius:999px}
.navcta:hover{text-decoration:none;background:#d6b97f}
.hero{background:var(--ink);color:var(--ivory);padding:56px 0 64px}
.eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--champ);font-weight:600;margin:0 0 14px}
h1,h2,h3{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;line-height:1.1;margin:0}
h1{font-size:clamp(36px,5.4vw,58px);max-width:860px}
h2{font-size:clamp(28px,3.6vw,38px);margin-bottom:14px}
h3{font-size:24px}
.lede{font-size:19px;color:#D9D2C4;max-width:720px;margin:18px 0 0}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.stat{border:1px solid #2A3D36;border-radius:14px;padding:14px 18px;min-width:150px}
.stat b{display:block;font:600 30px/1 'Cormorant Garamond',Georgia,serif;color:var(--champ)}
.stat span{font-size:13px;color:var(--mist)}
.crumbs{font-size:13px;color:var(--mist);margin-bottom:18px}.crumbs a{color:var(--mist)}
main section{padding:52px 0;border-bottom:1px solid var(--line)}
.btn{display:inline-block;background:var(--bronze);color:#fff;font-weight:600;padding:14px 24px;border-radius:999px;font-size:15px}
.btn:hover{text-decoration:none;background:#765925}
.btn.light{background:var(--champ);color:var(--ink)}.btn.light:hover{background:#d6b97f}
.table{width:100%;border-collapse:collapse;font-size:15px;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.table th{text-align:left;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;background:var(--ivory);padding:12px 14px}
.table td{padding:14px;border-top:1px solid var(--line);vertical-align:top}
.table td.num{white-space:nowrap}
.hname{font-weight:600}.hmeta{font-size:13px;color:var(--muted)}
.locked td{color:var(--mist)}
.blur{filter:blur(5px);user-select:none}
.gate{margin-top:22px;background:var(--ink);color:var(--ivory);border-radius:18px;padding:28px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between}
.gate p{margin:6px 0 0;color:#D9D2C4;max-width:560px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
.card p{margin:8px 0 0;color:var(--muted);font-size:15px}
.faq details{border-top:1px solid var(--line);padding:16px 0}
.faq summary{cursor:pointer;font-weight:600;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq p{margin:10px 0 0;color:var(--muted)}
.links{columns:3 220px;column-gap:28px;padding:0;margin:0;list-style:none}
.links li{break-inside:avoid;padding:6px 0;border-bottom:1px solid var(--line);font-size:15px}
.links small{color:var(--muted)}
.country{margin-top:34px}
footer{background:var(--ink);color:var(--mist);font-size:14px;padding:36px 0}
footer a{color:var(--ivory)}
.note{font-size:13px;color:var(--muted);margin-top:14px}
@media (max-width:720px){.hide-sm{display:none}.table td,.table th{padding:10px}.stat{flex:1 1 calc(50% - 12px);min-width:0}.gate .btn{width:100%;text-align:center}}
`;

function layout({ title, description, canonical, body, jsonLd = [], ogTitle }) {
  const ga = GA4_ID ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA4_ID)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(GA4_ID)}');</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Skipful">
<meta property="og:title" content="${esc(ogTitle || title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta name="twitter:card" content="summary_large_image">
${GSC_TOKEN ? `<meta name="google-site-verification" content="${esc(GSC_TOKEN)}">` : ''}
<link rel="icon" href="${SITE_URL}/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Manrope:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
${jsonLd.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
${ga}
</head>
<body>
<header class="top"><div class="wrap"><a class="logo" href="${SITE_URL}/">Skipful</a><a class="navcta" href="${signupUrl('nav')}">Start free</a></div></header>
${body}
<footer><div class="wrap">
<p>Skipful scores 60,000+ hotels on real creator collaborations found on Instagram, so travel creators can pitch the places already saying yes.</p>
<p><a href="${APP_URL}/">Skipful</a> · <a href="${APP_URL}/pricing/">Pricing</a> · <a href="${SITE_URL}/">All city guides</a> · <a href="mailto:info@skipful.com">info@skipful.com</a></p>
</div></footer>
</body>
</html>`;
}

function cityPage(c, related, generatedAt) {
  const url = `${SITE_URL}/${SECTION}/${c.slug}/`;
  const shown = c.hotels.slice(0, SHOWN_HOTELS);
  const hidden = c.hotels.length - shown.length;
  const top = shown[0];
  const smallest = fmtFollowers(c.smallest);
  const median = fmtFollowers(c.medianSmallest);
  const title = `${plural(c.hotels.length, 'Hotel')} in ${c.city} That Work With Influencers | Skipful`;
  const description = `${plural(c.hotels.length, 'hotel')} in ${c.place} have hosted travel creators, with ${plural(c.collabs, 'collab')} found on Instagram.${smallest ? ` Some worked with creators as small as ${smallest} followers.` : ''} See which ones and how to pitch them.`;

  const rows = shown.map((h, i) => `<tr>
<td><div class="hname">${i + 1}. ${esc(h.name)}</div><div class="hmeta">${esc([stars(h.stars), h.type].filter(Boolean).join(' · '))}</div></td>
<td class="num">${fmtInt(h.collabs)}</td>
<td class="num hide-sm">${h.smallest ? fmtFollowers(h.smallest) : '—'}</td>
<td class="num hide-sm">${fmtMonth(h.last)}</td>
</tr>`).join('\n');
  const lockedRows = hidden > 0 ? Array.from({ length: Math.min(3, hidden) }, () => `<tr class="locked"><td><div class="hname blur">Hidden hotel name here</div><div class="hmeta">Unlock in Skipful</div></td><td class="num blur">00</td><td class="num hide-sm blur">0K</td><td class="num hide-sm blur">Jan 2026</td></tr>`).join('\n') : '';

  const faqs = [
    [`Which hotels in ${c.city} work with influencers?`,
      `Skipful found ${plural(c.hotels.length, 'hotel')} in ${c.place} with at least one creator collaboration on Instagram. ${top ? `${top.name} leads with ${plural(top.collabs, 'collab')}.` : ''} The full list, with each hotel's collab history and the right contact, is in Skipful.`],
    [`Do I need a big following to get a hotel collab in ${c.city}?`,
      smallest ? `No. Among these hotels, the smallest creator we found working with them had about ${smallest} followers${median ? `, and for a typical hotel on this list the smallest creator was around ${median}` : ''}. ${c.under10k ? `${plural(c.under10k, 'hotel')} here worked with someone under 10K.` : ''}`
        : `Not necessarily. Many hotels work with micro creators. Skipful shows the follower counts of creators each hotel has hosted, so you can pitch places that fit your size.`],
    [`How does Skipful know a hotel collaborates with creators?`,
      `Skipful looks for Instagram posts where a creator and the hotel appear together, such as collab posts that tag both accounts, then checks each one before counting it. Hotels with more, and more recent, collabs rank higher.`],
    [`How do I pitch a hotel in ${c.city}?`,
      `Lead with the hotel's own history: mention that they've worked with creators before, propose specific deliverables (for example one Reel, three Stories and edited photos), and suggest dates. Skipful drafts a personalized pitch for each hotel and gives you the best inbox to send it to.`],
  ];

  const body = `
<section class="hero"><div class="wrap">
<div class="crumbs"><a href="${SITE_URL}/">City guides</a> / ${esc(c.country)} / ${esc(c.city)}</div>
<p class="eyebrow">${esc(c.place)} · Creator-friendly hotels</p>
<h1>Hotels in ${esc(c.city)} that work with influencers</h1>
<p class="lede">${plural(c.hotels.length, 'hotel')} in ${esc(c.place)} have already hosted travel creators. Here are the ones collaborating most, based on ${plural(c.collabs, 'creator collab')} found on Instagram.</p>
<div class="stats">
<div class="stat"><b>${fmtInt(c.hotels.length)}</b><span>hotels with collabs</span></div>
<div class="stat"><b>${fmtInt(c.collabs)}</b><span>creator collabs found</span></div>
${smallest ? `<div class="stat"><b>${smallest}</b><span>smallest creator hosted</span></div>` : ''}
<div class="stat"><b>${fmtMonth(c.last)}</b><span>most recent collab</span></div>
</div>
</div></section>
<main>
<section><div class="wrap">
<h2>Top creator-friendly hotels in ${esc(c.city)}</h2>
<table class="table">
<thead><tr><th>Hotel</th><th>Collabs</th><th class="hide-sm">Smallest creator</th><th class="hide-sm">Latest</th></tr></thead>
<tbody>
${rows}
${lockedRows}
</tbody></table>
<div class="gate"><div><h3>${hidden > 0 ? `See all ${fmtInt(c.hotels.length)} hotels in ${esc(c.city)}` : `Pitch these hotels with confidence`}</h3><p>Get each hotel's full collab history, the creators they've hosted, the best email to pitch, and a ready-to-send pitch. Free for 7 days, no credit card.</p></div><a class="btn light" href="${signupUrl(c.slug)}">Start free</a></div>
<p class="note">"Smallest creator" is the smallest follower count among creators we found collaborating with that hotel. Data updated ${fmtMonth(Date.parse(generatedAt))}.</p>
</div></section>
<section><div class="wrap">
<h2>How to land a hotel stay in ${esc(c.city)}</h2>
<div class="cols">
<div class="card"><h3>1. Pick hotels that say yes</h3><p>Start with the hotels above. They've already worked with creators, so your pitch isn't a cold ask.</p></div>
<div class="card"><h3>2. Match your size</h3><p>Look at the smallest creator each hotel hosted. If it's close to your following, you're in range.</p></div>
<div class="card"><h3>3. Send a specific pitch</h3><p>Name the deliverables, the dates and why you love the property. Skipful writes the first draft for you.</p></div>
</div>
</div></section>
<section class="faq"><div class="wrap">
<h2>${esc(c.city)} hotel collabs: common questions</h2>
${faqs.map(([q, a]) => `<details open><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</div></section>
${related.length ? `<section><div class="wrap">
<h2>More creator-friendly destinations${related.sameArea ? (c.isUS ? ' in the US' : ` in ${esc(c.country)}`) : ''}</h2>
<ul class="links">${related.map(r => `<li><a href="${SITE_URL}/${SECTION}/${r.slug}/">${esc(r.place)}</a> <small>${plural(r.hotels.length, 'hotel')}</small></li>`).join('')}</ul>
</div></section>` : ''}
</main>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: `Hotels in ${c.city} that work with influencers`,
      numberOfItems: shown.length,
      itemListElement: shown.map((h, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Hotel', name: h.name, address: { '@type': 'PostalAddress', addressLocality: c.city, addressRegion: c.state || undefined, addressCountry: c.country } } })),
    },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'City guides', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: c.city, item: url } ] },
  ];
  return { url, html: layout({ title, description, canonical: url, body, jsonLd, ogTitle: `Hotels in ${c.city} that work with influencers` }) };
}

function indexPage(cities, totals) {
  const byCountry = new Map();
  for (const c of cities) {
    const k = c.isUS ? 'United States' : c.country || 'Other';
    if (!byCountry.has(k)) byCountry.set(k, []);
    byCountry.get(k).push(c);
  }
  const countries = [...byCountry.entries()].sort((a, b) => b[1].reduce((s, c) => s + c.collabs, 0) - a[1].reduce((s, c) => s + c.collabs, 0));
  const topCities = cities.slice(0, 12);
  const body = `
<section class="hero"><div class="wrap">
<p class="eyebrow">City guides · Updated ${fmtMonth(Date.now())}</p>
<h1>Hotels that work with influencers, city by city</h1>
<p class="lede">We scanned Instagram for real hotel and creator collaborations. Pick a destination to see which hotels are already saying yes to creators, and how small a following they've worked with.</p>
<div class="stats">
<div class="stat"><b>${fmtInt(cities.length)}</b><span>destinations</span></div>
<div class="stat"><b>${fmtInt(totals.hotels)}</b><span>hotels with creator collabs</span></div>
<div class="stat"><b>${fmtInt(totals.collabs)}</b><span>collabs found</span></div>
</div>
<p style="margin-top:28px"><a class="btn light" href="${signupUrl('guides_index')}">Search all 60,000+ hotels free</a></p>
</div></section>
<main>
<section><div class="wrap">
<h2>Most active destinations</h2>
<div class="cols">${topCities.map(c => `<a class="card" href="${SITE_URL}/${SECTION}/${c.slug}/"><h3>${esc(c.place)}</h3><p>${plural(c.hotels.length, 'hotel')} · ${plural(c.collabs, 'collab')}${c.smallest ? ` · creators from ${fmtFollowers(c.smallest)}` : ''}</p></a>`).join('')}</div>
</div></section>
<section><div class="wrap">
<h2>All destinations</h2>
${countries.map(([country, list]) => `<div class="country"><h3>${esc(country)}</h3><ul class="links">${list.map(c => `<li><a href="${SITE_URL}/${SECTION}/${c.slug}/">${esc(c.isUS && c.state ? `${c.city}, ${c.state}` : c.city)}</a> <small>${plural(c.hotels.length, 'hotel')}</small></li>`).join('')}</ul></div>`).join('\n')}
</div></section>
</main>`;
  return layout({
    title: 'Hotels That Work With Influencers, by City | Skipful',
    description: `Find hotels already collaborating with travel creators in ${fmtInt(cities.length)} destinations, based on ${fmtInt(totals.collabs)} real Instagram collabs.`,
    canonical: `${SITE_URL}/`, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Skipful City Guides', url: `${SITE_URL}/` }],
  });
}

// ---------- build ----------

async function main() {
  const raw = await loadData();
  const generatedAt = new Date().toISOString();
  const cities = shape(raw);
  if (!cities.length) throw new Error('No cities to publish');

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(path.join(OUT, SECTION), { recursive: true });

  const urls = [`${SITE_URL}/`];
  for (const c of cities) {
    const sameArea = cities.filter(o => o !== c && (c.isUS ? o.isUS : o.country === c.country));
    const fallback = cities.filter(o => o !== c && !sameArea.includes(o));
    const related = (sameArea.length >= 3 ? sameArea : [...sameArea, ...fallback]).slice(0, 12);
    related.sameArea = sameArea.length >= 3;
    const { url, html } = cityPage(c, related, generatedAt);
    const dir = path.join(OUT, SECTION, c.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), html);
    urls.push(url);
  }

  const totals = { hotels: cities.reduce((s, c) => s + c.hotels.length, 0), collabs: cities.reduce((s, c) => s + c.collabs, 0) };
  await fs.writeFile(path.join(OUT, 'index.html'), indexPage(cities, totals));
  // Old/odd URLs under the section go to the index
  await fs.writeFile(path.join(OUT, SECTION, 'index.html'), `<!doctype html><meta http-equiv="refresh" content="0;url=${SITE_URL}/"><link rel="canonical" href="${SITE_URL}/">`);
  await fs.writeFile(path.join(OUT, '404.html'), layout({ title: 'Page not found | Skipful', description: 'This page moved.', canonical: `${SITE_URL}/`, body: `<section class="hero"><div class="wrap"><h1>That page isn't here</h1><p class="lede"><a href="${SITE_URL}/" style="color:var(--champ)">Browse all city guides</a></p></div></section>` }));

  const today = generatedAt.slice(0, 10);
  await fs.writeFile(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  await fs.writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  if (process.env.CNAME_DOMAIN) await fs.writeFile(path.join(OUT, 'CNAME'), process.env.CNAME_DOMAIN + '\n');
  // Everything in static/ is published at the site root (images, Google verification files, etc.)
  try {
    for (const f of await fs.readdir(path.join(ROOT, 'static'))) {
      await fs.copyFile(path.join(ROOT, 'static', f), path.join(OUT, f));
    }
  } catch {}
  console.log(`Built ${cities.length} city pages (${totals.hotels} hotels, ${totals.collabs} collabs) into dist/`);
}

main().catch(e => { console.error(e); process.exit(1); });
