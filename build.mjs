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
import { computeResearch } from './research.mjs';
import { BYLINE, RESEARCH_CSS, barChart, charts as researchCharts, keyStats, methodology, csv as researchCsv, pctFmt, kFmt, longDate, ratio } from './research_pages.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');
const SITE_URL = (process.env.SITE_URL || 'https://guides.skipful.com').replace(/\/$/, '');
const APP_URL = (process.env.APP_URL || 'https://www.skipful.com').replace(/\/$/, '');
const GA4_ID = process.env.GA4_ID || '';
const GSC_TOKEN = process.env.GSC_TOKEN || '';   // Google Search Console "HTML tag" verification value
const XANO = process.env.XANO_SEO_URL || '';
const KEY = process.env.SEO_EXPORT_KEY || '';
const MIN_HOTELS = 3;      // a city needs at least this many collab hotels to get a page
const NAMED_HOTELS = 3;    // hotels named publicly per city; the rest show stats only, names unlock in the app
const LOCKED_ROWS = 9;     // locked rows shown under the named ones before "+ N more"
const SECTION = 'hotels-that-work-with-influencers';
const EMAIL_LIST_URL = process.env.EMAIL_LIST_URL || 'https://x8e3-4uyz-scg3.n7c.xano.io/api:QZQAfPcA/guide_email_list';
const MIN_REAL_FOLLOWERS = 500; // below this the follower count is almost certainly bad data
// Research pages live under /research/. Once Cloudflare serves them at www.skipful.com/research/, set RESEARCH_URL to that.
const RESEARCH_URL = (process.env.RESEARCH_URL || `${SITE_URL}/research`).replace(/\/$/, '');
const PRESS_EMAIL = 'info@skipful.com';

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
  const emails = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    props.push(...await call({ dataset: 'properties', ids: chunk }));
    await sleep(300);
    scores.push(...await call({ dataset: 'scores', ids: chunk }));
    await sleep(300);
    try {
      emails.push(...await call({ dataset: 'emails', ids: chunk })); // counts per hotel only, never addresses
    } catch (e) {
      console.log(`Email counts unavailable: ${e.message}`);
    }
    await sleep(300);
  }
  return { collabs, props, scores, emails };
}

async function loadData() {
  if (!XANO) {
    console.log(`XANO_SEO_URL not set: using ${process.env.DATA_FILE || 'data/sample_compact.json'}`);
    const s = JSON.parse(await fs.readFile(process.env.DATA_FILE || path.join(ROOT, 'data', 'sample_compact.json'), 'utf8'));
    return {
      collabs: s.c.map(([p, d, f]) => ({ p, d, f })),
      props: s.p.map(([id, title, city, state, country, stars, rating, type]) => ({ id, title, city, state, country, stars, rating, type })),
      scores: s.s.map(([p, sc]) => ({ p, s: sc })),
      emails: (s.e || []).map(([p, n]) => ({ p, n })),
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

function shape({ collabs, props, scores, emails = [] }) {
  const propById = new Map(props.map(p => [p.id, p]));
  const emailsById = new Map(emails.map(e => [e.p, Number(e.n) || 0]));
  const scoreById = new Map();
  for (const s of scores) if (s.s != null) scoreById.set(s.p, Math.max(scoreById.get(s.p) ?? 0, s.s));
  const now = Date.now();
  const yearAgo = now - 365 * 864e5;
  const monthAgo = now - 30 * 864e5;

  // Guard against reading the same row twice (rows carry their id as `i`).
  const seen = new Set();
  const byHotel = new Map();
  for (const c of collabs) {
    if (!c.p) continue;
    const dupKey = c.i != null ? `id:${c.i}` : `${c.p}|${c.d}|${c.f}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    let h = byHotel.get(c.p);
    if (!h) byHotel.set(c.p, h = { n: 0, n12: 0, n30: 0, minF: null, last: null, fl: [], small12: 0 });
    h.n++;
    const t = c.d ? Date.parse(c.d) : NaN;
    if (!Number.isNaN(t)) {
      if (t > yearAgo) h.n12++;
      if (t > monthAgo) h.n30++;
      if (h.last === null || t > h.last) h.last = t;
    }
    const f = Number(c.f);
    if (f >= MIN_REAL_FOLLOWERS && (h.minF === null || f < h.minF)) h.minF = f;
    if (f >= MIN_REAL_FOLLOWERS) h.fl.push(f);
    if (f >= MIN_REAL_FOLLOWERS && f < 10000 && !Number.isNaN(t) && t > yearAgo) h.small12++;
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
    if (!C) cities.set(key, C = { city, state: isUS ? state : '', country, isUS, hotels: [], collabs: 0, collabs12: 0, small12: 0, last: null });
    if (/[^\x00-\x7F]/.test(city) && !/[^\x00-\x7F]/.test(C.city)) C.city = city; // prefer "Medellín" over "Medellin"
    C.collabs += h.n;
    C.collabs12 += h.n12;
    C.small12 += h.small12;
    if (h.last && (!C.last || h.last > C.last)) C.last = h.last;
    C.hotels.push({
      id, name: String(p.title).trim(), type: p.type || null,
      stars: p.stars || null, rating: p.rating || null, score: scoreById.get(id) ?? null,
      collabs: h.n, collabs12: h.n12, n30: h.n30, smallest: h.minF, last: h.last, fl: h.fl,
      emails: emailsById.get(id) || 0,
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
    c.withEmail = c.hotels.filter(h => h.emails > 0).length; // hotels with a contact email found (count only)
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
const signupUrl = (campaign, city) => `${APP_URL}/signup/?utm_source=guides&utm_medium=seo&utm_campaign=${encodeURIComponent(campaign)}${city ? `&city=${encodeURIComponent(city)}` : ''}`;
// Locked rows show a blurred decoy name, never the real one: CSS blur still leaves text in the page source.
const DECOY_A = ['The Belmont', 'Marlow', 'The Calloway', 'Ashby', 'The Whitley', 'Hollis', 'The Ellery', 'Prescott', 'The Harlan', 'Wexford', 'The Linden', 'Carraway'];
const DECOY_B = ['Hotel', 'House', 'Hotel & Lounge', 'Inn', 'Hotel, Autograph Collection', 'Suites', 'Hotel Downtown', 'Social Club'];
const decoy = (id, city) => `${DECOY_A[id % DECOY_A.length]} ${DECOY_B[Math.floor(id / 7) % DECOY_B.length]}${id % 3 === 0 ? ` ${city}` : ''}`;
const typeLabel = h => [h.stars ? `${Math.round(h.stars)}-star` : '', (h.type || 'Hotel').toLowerCase()].filter(Boolean).join(' ').replace(/^./, ch => ch.toUpperCase());

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
.hname{font-weight:600}.hmeta{font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin-top:4px}.hmeta .tag{margin-left:0}
.locked .hname{display:flex;align-items:center;gap:6px;min-width:0}.locked .blurname{flex:0 1 auto;min-width:0;overflow:hidden;white-space:nowrap}.locked .unlock{flex:none;margin-left:8px}
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
.sub{color:var(--muted);margin:-4px 0 18px;font-size:15px}
.tbox{overflow-x:auto;border-radius:14px}
.rank{color:var(--mist);font-weight:600}
.locked .hname{color:var(--ink);font-weight:600}
.locked td.num{color:var(--ink)}
.blurname::before{content:attr(data-d)}.blurname{filter:blur(6px);user-select:none;pointer-events:none;color:var(--ink)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.unlock{display:inline-block;margin-left:8px;font-size:12px;font-weight:700;color:var(--ink);background:var(--champ);padding:4px 11px;border-radius:999px;vertical-align:1px;filter:none}
.unlock:hover{text-decoration:none;background:#d6b97f}
.more a{color:var(--bronze)}
.more td{text-align:center;font-weight:600;color:var(--bronze);background:var(--ivory)}
.gate-cta{display:flex;flex-direction:column;align-items:center;gap:8px}.gate-cta small{color:var(--mist);font-size:13px}
.gate .emailtease{color:var(--ivory);margin-top:10px}.gate .emailtease b{color:var(--champ)}.env{color:var(--champ);margin-right:4px}
.mailme{margin-top:14px;border:1px solid var(--line, #E7E0D3);background:#fff;border-radius:18px;padding:18px 22px;display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;justify-content:space-between}
.mm-text{display:flex;flex-direction:column;gap:2px;max-width:420px}.mm-text span{color:#4A5852;font-size:15px}
.mm-row{display:flex;gap:10px;flex:1 1 320px;max-width:460px}
.mailme input{flex:1 1 200px;min-width:0;min-height:46px;border-radius:999px;border:1px solid #D9D2C4;padding:0 18px;font:inherit;font-size:16px;background:#FBF8F2}
.mailme button{min-height:46px;border:0;border-radius:999px;background:var(--ink);color:var(--ivory);font:inherit;font-weight:600;font-size:15px;padding:0 20px;cursor:pointer;white-space:nowrap}
.mailme button:hover{opacity:.9}.mailme button[disabled]{opacity:.6;cursor:default}
.mm-out{flex-basis:100%;margin:0;font-size:15px;color:#4A5852}.mm-out:empty{display:none}.mm-out.ok{color:#2F6B4F;font-weight:600}
.fit{margin-top:30px;background:var(--ink2);border:1px solid #2A3D36;border-radius:18px;padding:22px 24px;max-width:720px}
.fit label{display:block;font-weight:600;font-size:16px;margin-bottom:10px;color:var(--ivory)}
.fit-row{display:flex;gap:10px;flex-wrap:wrap}
.fit input{flex:1 1 200px;min-height:48px;border-radius:999px;border:1px solid #3A4E47;background:var(--ink);color:var(--ivory);padding:0 18px;font:inherit;font-size:16px}
.fit input::placeholder{color:#8C978F}
.fit button{min-height:48px;border:0;border-radius:999px;background:var(--champ);color:var(--ink);font:inherit;font-weight:600;font-size:15px;padding:0 22px;cursor:pointer}
.fit button:hover{background:#d6b97f}
.fit-out{margin:14px 0 0;color:#D9D2C4;font-size:16px}.fit-out b{color:var(--champ);font-size:20px}
.fit-out .btn{margin-left:8px;padding:10px 18px;font-size:14px;vertical-align:middle}
.tag{display:inline-block;margin-left:8px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;vertical-align:1px}
.tag[hidden]{display:none}
.fittag{background:var(--champ);color:var(--ink)}
.hot{background:#E4EFE8;color:#1E4D36}
tr.fit td{background:#FBF4E4}
tr.fit td:first-child{box-shadow:inset 3px 0 0 var(--champ)}
.bars{display:flex;flex-direction:column;gap:10px;max-width:760px}
.bar{display:grid;grid-template-columns:110px minmax(0,1fr) 56px;gap:12px;align-items:center;font-size:15px}
.bt{height:14px;background:var(--ivory);border-radius:999px;overflow:hidden}.bf{display:block;height:100%;background:var(--bronze);border-radius:999px}
.bn{text-align:right;font-weight:600}
.pitchwrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:36px;align-items:center}
.mail{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;font-size:15px}
.mrow{display:flex;gap:12px;padding:10px 18px;border-bottom:1px solid var(--line)}.mrow>span:first-child{color:var(--muted);width:60px;flex:none}
.mbody{padding:16px 18px;position:relative}.mbody p{margin:0 0 10px}
.mfade{filter:blur(4px);user-select:none;-webkit-mask-image:linear-gradient(#000,transparent);mask-image:linear-gradient(#000,transparent)}
.stick{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:14px;background:var(--ink);color:var(--ivory);border:1px solid #2A3D36;border-radius:999px;padding:8px 8px 8px 20px;box-shadow:0 10px 30px rgba(14,26,23,.25);font-weight:600;font-size:15px;max-width:calc(100% - 24px)}
.stick[hidden]{display:none}.stick .btn{padding:10px 18px;font-size:14px;white-space:nowrap}
@media (max-width:720px){.mm-row{flex-direction:column;max-width:none;flex-basis:100%}.mailme{padding:16px}.mailme input{flex:none;width:100%;height:48px}body.stick-on{padding-bottom:84px}.locked .blurname{flex:1 1 auto}.locked .unlock{margin-left:auto}.table{table-layout:fixed}.table th:first-child,.table td:first-child{width:58%}.table th:not(:first-child),.table td.num{width:21%}.table th{font-size:11px;letter-spacing:.04em;white-space:normal;line-height:1.3}.mailme button{width:100%}.pitchwrap{grid-template-columns:1fr}.bar{grid-template-columns:84px minmax(0,1fr) 44px;font-size:14px}.stick{left:12px;right:12px;transform:none;justify-content:space-between;font-size:14px}.fit-out .btn{display:block;margin:12px 0 0;text-align:center}.hide-sm{display:none}.table td,.table th{padding:10px}.stat{flex:1 1 calc(50% - 12px);min-width:0}.gate .btn{width:100%;text-align:center}}
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
<p>Skipful scores 60,000+ hotels on real creator collaborations found on social media, so travel creators can pitch the places already saying yes.</p>
<p><a href="${APP_URL}/">Skipful</a> · <a href="${APP_URL}/pricing/">Pricing</a> · <a href="${SITE_URL}/">All city guides</a> · <a href="${RESEARCH_URL}/">Research</a> · <a href="mailto:info@skipful.com">info@skipful.com</a></p>
</div></footer>
</body>
</html>`;
}

function cityPage(c, related, generatedAt) {
  const url = `${SITE_URL}/${SECTION}/${c.slug}/`;
  const named = c.hotels.slice(0, NAMED_HOTELS);
  const locked = c.hotels.slice(NAMED_HOTELS);
  const lockedShown = locked.slice(0, LOCKED_ROWS);
  const moreHidden = locked.length - lockedShown.length;
  const top = named[0];
  const smallest = fmtFollowers(c.smallest);
  const median = fmtFollowers(c.medianSmallest);
  const title = `${plural(c.hotels.length, 'Hotel')} in ${c.city} That Work With Influencers | Skipful`;
  const description = `${plural(c.hotels.length, 'hotel')} in ${c.place} have hosted travel creators, with ${plural(c.collabs, 'collab')} found on social media.${smallest ? ` Some worked with creators as small as ${smallest} followers.` : ''} See which ones fit your size and how to pitch them.`;
  const startFree = signupUrl(c.slug, c.city);

  const tags = h => `<span class="tag fittag" hidden>Fits you</span>${h.n30 ? `<span class="tag hot">Active this month</span>` : ''}`;
  const row = (h, i, isNamed) => `<tr data-i="${i}"${isNamed ? '' : ' class="locked"'}>
<td>${isNamed
    ? `<div class="hname">${i + 1}. ${esc(h.name)}</div><div class="hmeta">${esc(typeLabel(h))}${tags(h)}</div>`
    : `<div class="hname"><span class="rank">${i + 1}.</span> <span class="blurname" aria-hidden="true" data-nosnippet data-d="${esc(decoy(h.id, c.city))}"></span><span class="sr">Hidden hotel</span> <a class="unlock" data-ev="view_row" href="${esc(startFree)}">View</a></div><div class="hmeta">${esc(typeLabel(h))}${tags(h)}</div>`}</td>
<td class="num">${fmtInt(h.collabs)}</td>
<td class="num hide-sm">${fmtInt(h.collabs12)}</td>
<td class="num">${h.smallest ? fmtFollowers(h.smallest) : '—'}</td>
<td class="num hide-sm">${fmtMonth(h.last)}</td>
</tr>`;
  const rows = [
    ...named.map((h, i) => row(h, i, true)),
    ...lockedShown.map((h, i) => row(h, i + NAMED_HOTELS, false)),
    moreHidden > 0 ? `<tr class="more"><td colspan="5"><a data-ev="view_more" href="${esc(startFree)}">+ ${plural(moreHidden, 'more hotel')} in ${esc(c.city)}. View them all free</a></td></tr>` : '',
  ].join('\n');

  // Fit checker data: follower counts only (no names, no handles), rounded so the page carries no exact figures.
  const round = f => f < 10000 ? Math.round(f / 100) * 100 : Math.round(f / 1000) * 1000;
  const fitData = c.hotels.map(h => [...new Set(h.fl.map(round))]);

  // Who gets hosted here: collabs by creator size (real counts, no names)
  const allF = c.hotels.flatMap(h => h.fl);
  const BUCKETS = [['Under 5K', 0, 5e3], ['5K to 10K', 5e3, 1e4], ['10K to 50K', 1e4, 5e4], ['50K to 100K', 5e4, 1e5], ['100K+', 1e5, Infinity]];
  const counts = BUCKETS.map(([label, lo, hi]) => ({ label, n: allF.filter(f => f >= lo && f < hi).length }));
  const maxN = Math.max(1, ...counts.map(b => b.n));
  const under10 = allF.length ? Math.round(100 * (counts[0].n + counts[1].n) / allF.length) : 0;
  const sizeChart = allF.length >= 10 ? `<section><div class="wrap">
<h2>${under10 >= 15 ? `${under10}% of ${esc(c.city)} collabs went to creators under 10K` : `Who gets hosted in ${esc(c.city)}`}</h2>
<p class="sub">Every creator collab we found at these hotels, by the creator's follower count when they posted.</p>
<div class="bars">${counts.map(b => `<div class="bar"><span class="bl">${b.label}</span><span class="bt"><span class="bf" style="width:${Math.max(2, Math.round(100 * b.n / maxN))}%"></span></span><span class="bn">${fmtInt(b.n)}</span></div>`).join('')}</div>
</div></section>` : '';
  const active30 = c.hotels.filter(h => h.n30 > 0).length;

  // Sample pitch: the opening of the email Skipful drafts, for the #1 named hotel
  const pitch = top ? `<section><div class="wrap pitchwrap">
<div><h2>Skip the blank page</h2><p class="sub">Skipful drafts a pitch for every hotel, built on its own collab history, and finds the inbox to send it to. Here's how one to ${esc(top.name)} starts.</p>
<a class="btn" data-ev="view_pitch" href="${esc(startFree)}">Get your version free</a></div>
<div class="mail" aria-label="Sample pitch email">
<div class="mrow"><span>To</span><span class="blurname" aria-hidden="true" data-nosnippet data-d="partnerships@example-hotel.com"></span><span class="sr">Verified contact, hidden</span></div>
<div class="mrow"><span>Subject</span><b>Creator stay at ${esc(top.name)}</b></div>
<div class="mbody"><p>Hi ${esc(top.name)} team,</p>
<p>I'm a travel content creator, and ${esc(top.name)} is at the top of my list for my upcoming trip to ${esc(c.city)}.</p>
<p>I saw you've partnered with ${plural(top.collabs12 || top.collabs, 'creator')} recently, and I'd love to create something similar for you.</p>
<div class="mfade" aria-hidden="true" data-nosnippet><p>Here's what I have in mind: two short videos and a set of story posts featuring your rooms and the local experience, plus edited photos for your own channels.</p></div>
</div></div>
</div></section>` : '';

  const faqs = [
    [`Which hotels in ${c.city} work with influencers?`,
      `Skipful found ${plural(c.hotels.length, 'hotel')} in ${c.place} with at least one creator collaboration on social media. ${top ? `${top.name} leads with ${plural(top.collabs, 'collab')}.` : ''} The full list, with each hotel's collab history and the right contact, is in Skipful.`],
    [`Do I need a big following to get a hotel collab in ${c.city}?`,
      smallest ? `No. Among these hotels, the smallest creator we found working with them had about ${smallest} followers${median ? `, and for a typical hotel on this list the smallest creator was around ${median}` : ''}. ${c.under10k ? `${plural(c.under10k, 'hotel')} here worked with someone under 10K.` : ''}`
        : `Not necessarily. Many hotels work with micro creators. Skipful shows the follower counts of creators each hotel has hosted, so you can pitch places that fit your size.`],
    [`How does Skipful know a hotel collaborates with creators?`,
      `Skipful looks for social media posts where a creator and the hotel appear together, such as collab posts that tag both accounts, then checks each one before counting it. Hotels with more, and more recent, collabs rank higher.`],
    [`How do I pitch a hotel in ${c.city}?`,
      `Lead with the hotel's own history: mention that they've worked with creators before, propose specific deliverables (for example two short videos, a set of story posts and edited photos), and suggest dates. Skipful drafts a personalized pitch for each hotel and gives you the best inbox to send it to.`],
  ];

  const body = `
<section class="hero"><div class="wrap">
<div class="crumbs"><a href="${SITE_URL}/">City guides</a> / ${esc(c.country)} / ${esc(c.city)}</div>
<p class="eyebrow">${esc(c.place)} · Creator-friendly hotels</p>
<h1>Hotels in ${esc(c.city)} that work with influencers</h1>
<p class="lede">${plural(c.hotels.length, 'hotel')} in ${esc(c.place)} have already hosted travel creators${c.collabs12 ? `, with ${plural(c.collabs12, 'collab')} in the past year alone` : ''}.${c.small12 ? ` ${fmtInt(c.small12)} of those were with creators under 10K followers.` : ''}${active30 ? ` ${plural(active30, 'hotel')} hosted creators in the last 30 days.` : ''}</p>
<div class="stats">
<div class="stat"><b>${fmtInt(c.hotels.length)}</b><span>hotels with collabs</span></div>
<div class="stat"><b>${fmtInt(c.collabs12 || c.collabs)}</b><span>${c.collabs12 ? 'collabs in the past year' : 'creator collabs found'}</span></div>
${smallest ? `<div class="stat"><b>${smallest}</b><span>smallest creator hosted</span></div>` : ''}
${c.withEmail ? `<div class="stat"><b>${fmtInt(c.withEmail)}</b><span>with a contact email found</span></div>` : `<div class="stat"><b>${fmtMonth(c.last)}</b><span>most recent collab</span></div>`}
</div>
<form class="fit" id="fit" action="${esc(startFree)}" method="get" novalidate>
<label for="fit-n">How many followers do you have?</label>
<div class="fit-row"><input id="fit-n" name="followers" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 4,200"><button type="submit">Check my fit</button></div>
<p class="fit-out" id="fit-out" aria-live="polite">See how many ${esc(c.city)} hotels have hosted creators your size.</p>
</form>
</div></section>
<main>
<section><div class="wrap">
<h2>Creator-friendly hotels in ${esc(c.city)}</h2>
<p class="sub">The top ${plural(named.length, 'hotel')} by collabs are named. The numbers below are real; view the names free with a Skipful account.</p>
<div class="tbox"><table class="table">
<thead><tr><th>Hotel</th><th>Collabs</th><th class="hide-sm">Past year</th><th>Smallest creator</th><th class="hide-sm">Latest</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
<div class="gate"><div><h3>See all ${fmtInt(c.hotels.length)} hotels in ${esc(c.city)}</h3>${c.withEmail ? `<p class="emailtease"><span class="env" aria-hidden="true">✉</span> We found a contact email for <b>${fmtInt(c.withEmail)} of these ${fmtInt(c.hotels.length)} hotels</b>, so you can pitch the right inbox, not a booking form.</p>` : ''}<p>Names, each hotel's full collab history, the creators it hosted and the best email to pitch. Pitching ${esc(c.city)} soon? A Trip Pass unlocks every hotel here for 30 days, $15 one time.</p></div><div class="gate-cta"><a class="btn light" data-ev="view_gate" href="${esc(startFree)}">Start free</a><small>7-day free trial · No credit card</small></div></div>
<form class="mailme" id="mailme" novalidate>
<div class="mm-text"><b>Not ready yet? Email me this list.</b><span>We'll send the ${esc(c.city)} list to your inbox so you have it when you plan the trip.</span></div>
<div class="mm-row"><label class="sr" for="mm-email">Your email</label><input id="mm-email" type="email" autocomplete="email" placeholder="you@email.com" required><button type="submit">Email me the list</button></div>
<p class="mm-out" id="mm-out" aria-live="polite"></p>
</form>
<p class="note">"Smallest creator" is the smallest follower count among creators we found collaborating with that hotel. Data updated ${fmtMonth(Date.parse(generatedAt))}.</p>
</div></section>
${sizeChart}
${pitch}
<section><div class="wrap">
<h2>How to land a hotel stay in ${esc(c.city)}</h2>
<div class="cols">
<div class="card"><h3>1. Pick hotels that say yes</h3><p>Start with the hotels above. They've already worked with creators, so your pitch isn't a cold ask.</p></div>
<div class="card"><h3>2. Match your size</h3><p>Check your fit above. Hotels that hosted creators near your following are the ones most likely to say yes to you.</p></div>
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
</main>
<div class="stick" id="stick" hidden><span id="stick-t"></span><a class="btn light" id="stick-a" data-ev="view_sticky" href="${esc(startFree)}">View them free</a></div>
<script>
(function(){
var D=${JSON.stringify(fitData)},CITY=${JSON.stringify(c.city)},SLUG=${JSON.stringify(c.slug)},TOTAL=D.length;
var f=document.getElementById('fit'),inp=document.getElementById('fit-n'),out=document.getElementById('fit-out');
var stick=document.getElementById('stick'),stickT=document.getElementById('stick-t'),stickA=document.getElementById('stick-a');
var stickWanted=false,blockers=new Set();
function stickSync(){var on=stickWanted&&blockers.size===0;stick.hidden=!on;document.body.classList.toggle('stick-on',on);}
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting)blockers.add(x.target);else blockers.delete(x.target);});stickSync();});
['.gate','#mailme','#fit','footer'].forEach(function(q){var el=document.querySelector(q);if(el)io.observe(el);});}
function ev(name,p){try{if(window.gtag)gtag('event',name,Object.assign({city:CITY},p||{}));}catch(e){}}
function k(n){return n<1000?String(n):n<1e6?(n/1000).toFixed(n<10000?1:0).replace(/\.0$/,'')+'K':(n/1e6).toFixed(1).replace(/\.0$/,'')+'M';}
function parse(v){v=String(v).trim().toLowerCase().replace(/,/g,'');var m=v.match(/^([0-9.]+)\s*([km]?)$/);if(!m)return 0;var n=parseFloat(m[1]);if(m[2]==='k')n*=1e3;if(m[2]==='m')n*=1e6;return Math.round(n);}
function bucket(n){return n<5e3?'<5K':n<1e4?'5-10K':n<5e4?'10-50K':n<1e5?'50-100K':'100K+';}
function run(n){
var lo=Math.round(n/3),hi=Math.max(n*3,3000),hits=0,href=f.action+'&followers='+n;
var rows=document.querySelectorAll('tr[data-i]');
for(var r=0;r<rows.length;r++){rows[r].classList.remove('fit');var t=rows[r].querySelector('.fittag');if(t)t.hidden=true;}
for(var i=0;i<D.length;i++){if(D[i].some(function(x){return x>=lo&&x<=hi;})){hits++;var row=document.querySelector('tr[data-i="'+i+'"]');if(row){row.classList.add('fit');var tg=row.querySelector('.fittag');if(tg)tg.hidden=false;}}}
var links=document.querySelectorAll('a[data-ev]');for(var j=0;j<links.length;j++){links[j].href=href;}
out.innerHTML=hits
? '<b>'+hits+' of '+TOTAL+'</b> '+CITY+' hotels have hosted creators your size ('+k(lo)+' to '+k(hi)+' followers), tagged below. <a class="btn light" data-ev="view_fit" href="'+href+'">View all '+hits+'</a>'
: 'None of these '+TOTAL+' hotels have hosted creators between '+k(lo)+' and '+k(hi)+' yet, so you would be a first. Skipful shows nearby cities that fit. <a class="btn light" data-ev="view_fit" href="'+href+'">Find hotels that fit</a>';
stickT.textContent=hits?hits+' '+CITY+' hotels fit you':'Find hotels that fit you';
stickA.textContent=hits?'View all '+hits+' free':'See matches free';
stickWanted=true;stickSync();
try{localStorage.setItem('skipful_followers',String(n));}catch(e){}
ev('fit_check',{followers_bucket:bucket(n),hits:hits});
}
f.addEventListener('submit',function(e){
e.preventDefault();
var n=parse(inp.value);
if(!n){out.textContent='Enter your follower count, like 4200 or 4.2K.';return;}
run(n);
});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-ev]');if(a)ev('guide_signup_click',{where:a.getAttribute('data-ev')});});
var mm=document.getElementById('mailme');
if(mm){mm.addEventListener('submit',function(e){
e.preventDefault();
var em=document.getElementById('mm-email'),mo=document.getElementById('mm-out'),btn=mm.querySelector('button');
var v=String(em.value||'').trim();
if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v)){mo.className='mm-out';mo.textContent='Enter a valid email address.';return;}
var n=0;try{n=parseInt(localStorage.getItem('skipful_followers'),10)||0;}catch(x){}
btn.disabled=true;mo.className='mm-out';mo.textContent='Sending...';
fetch(${JSON.stringify(EMAIL_LIST_URL)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:v,city:CITY,slug:SLUG,followers:n||null})})
.then(function(r){if(!r.ok)throw new Error(r.status);mo.className='mm-out ok';mo.textContent='Sent. Check your inbox (and your spam folder, just in case).';em.value='';ev('email_list',{followers_bucket:n?bucket(n):'unknown'});})
.catch(function(){mo.className='mm-out';mo.textContent='That did not go through. Check the address and try again.';btn.disabled=false;});
});}
try{var saved=parseInt(localStorage.getItem('skipful_followers'),10);if(saved>0){inp.value=saved.toLocaleString('en-US');run(saved);}}catch(e){}
})();
</script>`;

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: `Hotels in ${c.city} that work with influencers`,
      numberOfItems: named.length,
      itemListElement: named.map((h, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Hotel', name: h.name, address: { '@type': 'PostalAddress', addressLocality: c.city, addressRegion: c.state || undefined, addressCountry: c.country } } })),
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
<p class="lede">We scanned social media for real hotel and creator collaborations. Pick a destination to see which hotels are already saying yes to creators, and how small a following they've worked with.</p>
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
    description: `Find hotels already collaborating with travel creators in ${fmtInt(cities.length)} destinations, based on ${fmtInt(totals.collabs)} real social media collabs.`,
    canonical: `${SITE_URL}/`, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Skipful City Guides', url: `${SITE_URL}/` }],
  });
}


// ---------- research ----------

const STATS_SLUG = 'hotel-influencer-marketing-statistics';
const REPORTS = [
  {
    slug: 'independent-vs-branded-hotels',
    kind: 'chain',
    snapshot: 'data/research/2026-11-independent-vs-branded.json',
    published: '2026-11-20',
    title: 'Independent vs. Branded Hotels: Where Small Creators Get the Yes',
    short: 'Independent vs. branded hotels',
    dek: 'Independent hotels give creators under 10K nearly 40% more of their collabs than branded hotels, at every star level. Branded hotels are more likely to make creator stays a habit.',
  },
  {
    slug: 'creator-friendly-hotel-cities',
    kind: 'ranking',
    snapshot: 'data/research/2026-11-creator-friendly-cities.json',
    published: '2026-11-20',
    title: 'The Most Creator-Friendly Hotel Cities of 2026',
    short: 'Creator-friendly hotel cities 2026',
    dek: 'We ranked 87 cities by how often their hotels host creators, how open they are to small creators, and how often they come back for more. Here are the top 50.',
  },
  {
    slug: 'small-creator-advantage',
    snapshot: 'data/research/2026-11-small-creator-advantage.json',
    published: '2026-11-20',
    title: 'The Small-Creator Advantage: Nearly 1 in 3 Hotel Collabs Go to Creators Under 10K',
    short: 'The small-creator advantage',
    dek: 'We analyzed 40,000+ hotel–creator collaborations. Hotels say yes to small creators far more often than most creators think, and some cities and hotel types are much more open than others.',
  },
];

const researchHead = (R, { title, url, lede, eyebrow, meta }) => `<section class="r-hero"><div class="wrap">
<div class="crumbs"><a href="${SITE_URL}/">Skipful</a> / <a href="${RESEARCH_URL}/">Research</a></div>
<p class="eyebrow">${esc(eyebrow)}</p>
<h1>${esc(title)}</h1>
<p class="lede">${lede}</p>
<p class="r-meta">${meta}</p>
</div></section><style>${RESEARCH_CSS}</style>`;

function citeBox(title, url, date) {
  return `<div class="cite"><b>Cite this research</b><br>Free to use with attribution and a link. For press questions or custom cuts of the data, email <a href="mailto:${PRESS_EMAIL}?subject=Press%3A%20Skipful%20Research">${PRESS_EMAIL}</a>.
<code>${esc(BYLINE)}. "${esc(title)}." Skipful, ${esc(longDate(date))}. ${esc(url)}</code></div>`;
}

function chartBlock(R, key, pageUrl) {
  const c = researchCharts(R)[key];
  return barChart({ id: key, ...c, citeUrl: pageUrl, embedUrl: `${RESEARCH_URL}/embed/${key}/` });
}

const researchCta = (where) => `<div class="r-cta"><p><b style="color:var(--ivory)">Are you a travel creator?</b> See which hotels in your city have hosted creators your size, and get the right inbox to pitch.</p><a class="btn light" data-ev="research_${where}" href="${APP_URL}/signup/?utm_source=research&utm_medium=content&utm_campaign=${where}">Find hotels that fit you</a></div>`;

function statsPage(R) {
  const url = `${RESEARCH_URL}/${STATS_SLUG}/`;
  const year = R.generatedAt.slice(0, 4);
  const title = `Hotel Influencer Marketing Statistics (${year})`;
  const L = R.last12;
  const stats = keyStats(R);
  const body = researchHead(R, {
    title, url, eyebrow: 'Skipful Research · Updated regularly',
    lede: `Fresh data on how hotels work with travel creators: who they host, how big those creators are, and where small creators get the most yeses. Based on ${R.totals.collabs.toLocaleString('en-US')} hotel–creator collabs at ${R.totals.hotels.toLocaleString('en-US')} hotels in ${R.totals.countries} countries.`,
    meta: `By the ${BYLINE} · Data updated ${longDate(R.generatedAt)}`,
  }) + `<main>
<section><div class="wrap">
<div class="stats" style="margin-top:0">
<div class="stat" style="background:var(--ink)"><b>${pctFmt(L.under10k)}</b><span>of collabs went to creators under 10K</span></div>
<div class="stat" style="background:var(--ink)"><b>${kFmt(L.median)}</b><span>median creator follower count</span></div>
<div class="stat" style="background:var(--ink)"><b>${pctFmt(R.hosts.hostedUnder10kPct)}</b><span>of hotels have hosted a creator under 10K</span></div>
<div class="stat" style="background:var(--ink)"><b>${pctFmt(R.hosts.repeat2Pct)}</b><span>of hotels hosted creators more than once</span></div>
</div>
</div></section>
<section><div class="wrap"><h2>Key hotel influencer marketing statistics</h2>
<ol class="keylist">${stats.map(s => `<li>${s}</li>`).join('')}</ol>
<p class="note">Figures cover the last 12 months unless noted. <a href="${RESEARCH_URL}/data/skipful-hotel-creator-stats.csv">Download the data (CSV)</a></p>
</div></section>
<section><div class="wrap r-body"><h2>Hotels host creators of every size</h2>
<p>Most hotel–creator collabs don't go to big accounts. The middle of the market, creators with 10K to 50K followers, gets the largest share, and creators under 10K together get ${ratio10(L.under10k)} of all collabs.</p>
${chartBlock(R, 'follower-size', url)}
<h2>Luxury skews bigger, but isn't closed</h2>
<p>The higher the star rating, the bigger the creators a hotel tends to host. 5-star hotels give ${pctFmt(R.byStars['5-star']?.over100k ?? 0)} of their collabs to creators with 100K+ followers, ${timesWord((R.byStars['5-star']?.over100k ?? 0) / (R.byStars['3-star']?.over100k || 1))} the rate at 3-star hotels. Still, ${ratio(R.byStars['5-star']?.under10k ?? 0)} 5-star collabs went to creators under 10K.</p>
${chartBlock(R, 'star-rating', url)}
<h2>Where small creators get the most yeses</h2>
<p>The share of collabs going to creators under 10K varies widely by market, from ${pctFmt(R.countries[0]?.under10k ?? 0)} in ${esc(R.countries[0]?.name || '')} to ${pctFmt(R.countries[R.countries.length - 1]?.under10k ?? 0)} in ${esc(R.countries[R.countries.length - 1]?.name || '')}.</p>
${chartBlock(R, 'countries', url)}
${chartBlock(R, 'cities', url)}
<p>The toughest major cities for smaller creators: ${R.toughestCities.slice(0, 4).map(c => `${esc(c.place.replace(/, (United States|United Kingdom)$/, ''))} (${pctFmt(c.under10k)})`).join(', ')}.</p>
<h2>Hotels that work with creators keep doing it</h2>
<p>Creator partnerships are a habit, not a one-off: ${pctFmt(R.hosts.repeat2Pct)} of hotels in our data hosted creators more than once, and among repeat hosts the median gap between collabs is ${R.hosts.medianDaysBetween} days. On average, each hotel had ${R.hosts.avgCollabsPerHotel} creator collabs in the dataset.</p>
${researchCta('stats')}
</div></section>
<section><div class="wrap r-body"><h2>Methodology</h2>${methodology(R)}
${citeBox(title, url, R.generatedAt)}
<p class="note" style="margin-top:18px">More from Skipful Research: ${REPORTS.map(r => `<a href="${RESEARCH_URL}/${r.slug}/">${esc(r.short)}</a>`).join(' · ')} · <a href="${SITE_URL}/">City guides</a></p>
</div></section>
</main>`;
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'Dataset', name: title, url,
    description: `Aggregate statistics on hotel–creator (influencer) collaborations: creator follower sizes, star ratings, countries and cities. ${R.totals.collabs} collabs at ${R.totals.hotels} hotels.`,
    creator: { '@type': 'Organization', name: BYLINE, parentOrganization: { '@type': 'Organization', name: 'Skipful', url: APP_URL } },
    dateModified: R.generatedAt.slice(0, 10), license: 'https://creativecommons.org/licenses/by/4.0/', isAccessibleForFree: true,
    temporalCoverage: `${R.totals.first}/${R.totals.last}`,
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${RESEARCH_URL}/data/skipful-hotel-creator-stats.csv` }],
  }];
  return { url, html: layout({ title: `${title} | Skipful Research`, description: `${pctFmt(L.under10k)} of hotel–creator collabs go to creators under 10K followers. Updated stats on hotel influencer marketing: follower sizes, star ratings, countries and cities.`, canonical: url, body, jsonLd, ogTitle: title }) };
}
const andList = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const timesWord = x => (x >= 2.75 ? 'about three times' : x >= 1.9 ? 'more than double' : x >= 1.4 ? 'about 1.5 times' : 'slightly above');
const ratio10 = p => (p >= 30 && p < 34 ? 'nearly a third' : `${pctFmt(p)}`);

function reportPage(rep, R) {
  const url = `${RESEARCH_URL}/${rep.slug}/`;
  const L = R.last12, S = R.byStars, H = R.hosts;
  const s5 = S['5-star'], s3 = S['3-star'], s4 = S['4-star'];
  const cities = R.smallFriendlyCities, tough = R.toughestCities;
  const body = researchHead(R, {
    title: rep.title, url, eyebrow: 'Skipful Research · Data report', lede: esc(rep.dek),
    meta: `By the ${BYLINE} · Published ${longDate(rep.published)} · Data through ${longDate(R.generatedAt)}`,
  }) + `<main>
<section><div class="wrap r-body">
<h2>Key findings</h2>
<ul>
<li><b>${pctFmt(L.under10k)}</b> of hotel–creator collabs in the last 12 months went to creators with fewer than 10,000 followers. Only ${pctFmt(L.over100k)} went to creators with 100K+.</li>
<li><b>${pctFmt(H.hostedUnder10kPct)}</b> of hotels that work with creators have hosted at least one creator under 10K.</li>
<li>Smaller creators do best at <b>3- and 4-star hotels</b> (${pctFmt(s3.under10k)} and ${pctFmt(s4.under10k)} of collabs), but even <b>5-star hotels</b> gave ${pctFmt(s5.under10k)} of their collabs to creators under 10K.</li>
<li><b>${esc(cities[0].place)}</b> and <b>${esc(cities[1].place)}</b> are the most small-creator-friendly major cities; <b>${esc(tough[0].place)}</b> is the toughest.</li>
<li>The small-creator share held between ${pctFmt(R.stability.min)} and ${pctFmt(R.stability.max)} in every month with enough data. This is how the market works, not a blip.</li>
</ul>
<p class="pull">Follower count isn't the gate. The hotels you pitch are.</p>
<p>Most creators assume hotels only want big accounts. The data says otherwise. Across ${R.totals.collabs.toLocaleString('en-US')} hotel–creator collabs at ${R.totals.hotels.toLocaleString('en-US')} hotels in ${R.totals.countries} countries, the typical creator in a hotel collab has ${kFmt(L.median)} followers, and ${ratio(L.under10k)} collabs went to creators under 10K.</p>
<h2>1. Small creators get a third of hotel collabs</h2>
<p>Creators with fewer than 5,000 followers alone accounted for ${pctFmt(L.buckets[0].pct)} of collabs, more than creators with 100K to 500K (${pctFmt(L.buckets[4].pct)}). Creators with 500K+ followers, the accounts many assume dominate travel, got just ${pctFmt(L.buckets[5].pct)}.</p>
${chartBlock(R, 'follower-size', url)}
<h2>2. Star rating matters more than follower count suggests</h2>
<p>At 3-star hotels, ${ratio(s3.under10k)} collabs (${pctFmt(s3.under10k)}) went to creators under 10K. At 5-star hotels it was ${pctFmt(s5.under10k)}, and ${pctFmt(s5.over100k)} of 5-star collabs went to creators with 100K+. The median creator hosted by a 5-star hotel had ${kFmt(s5.median)} followers, versus ${kFmt(s3.median)} at 3-star hotels. Resorts also skew bigger than hotels (${pctFmt(R.byType.Resorts.under10k)} vs. ${pctFmt(R.byType.Hotels.under10k)} under 10K).</p>
${chartBlock(R, 'star-rating', url)}
<p>For smaller creators that's a strategy, not a ceiling: lead with 3- and 4-star and boutique properties, build a portfolio of hosted stays, and pitch luxury once you can show results.</p>
<h2>3. Where you pitch changes your odds</h2>
<p>In ${esc(cities[0].place)}, ${pctFmt(cities[0].under10k)} of hotel collabs went to creators under 10K, and the median creator there had just ${kFmt(cities[0].median)} followers. In ${esc(tough[0].place)}, only ${pctFmt(tough[0].under10k)} did, and the median creator had ${kFmt(tough[0].median)}. Big global names like ${esc(tough.filter(t => /London|Paris/.test(t.city)).map(t => t.city).join(' and ') || 'London and Paris')} sit near the bottom too.</p>
${chartBlock(R, 'cities', url)}
<p>By country, ${esc(andList(R.countries.slice(0, 4).map(c => c.name)))} were the most open to smaller creators; ${esc(andList(R.countries.slice(-3).map(c => c.name)))} the least.</p>
${chartBlock(R, 'countries', url)}
<h2>4. Hotels that say yes keep saying yes</h2>
<p>${pctFmt(H.repeat2Pct)} of hotels in our data hosted creators more than once, ${pctFmt(H.repeat5Pct)} hosted five or more, and ${pctFmt(H.repeat10Pct)} hosted ten or more. At repeat hosts, the median gap between collabs was ${H.medianDaysBetween} days. A hotel that has hosted a creator your size recently is the warmest pitch you can send.</p>
<h2>What it means</h2>
<p><b>For creators:</b> follower count is not the gate most people think it is. Pitch hotels that have already hosted creators near your size, start with 3- and 4-star and boutique properties, and favor cities where small creators win more often.</p>
<p><b>For hotels and travel brands:</b> smaller creators are already a core part of the hotel collab market. Fewer than one in four collabs go to creators with 100K+ followers, so hotels that only court big accounts are competing for a small slice of the creators their peers actually work with.</p>
${researchCta(rep.slug)}
</div></section>
<section><div class="wrap r-body"><h2>Methodology</h2>${methodology(R)}
<p>This report uses a fixed snapshot of the data as of ${longDate(R.generatedAt)} so the numbers stay citable. For the latest figures, see <a href="${RESEARCH_URL}/${STATS_SLUG}/">Hotel Influencer Marketing Statistics</a>, which updates regularly.</p>
${citeBox(rep.title, url, rep.published)}
</div></section>
</main>`;
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: rep.title, description: rep.dek, url,
    datePublished: rep.published, dateModified: rep.published,
    author: { '@type': 'Organization', name: BYLINE }, publisher: { '@type': 'Organization', name: 'Skipful', url: APP_URL, logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` } },
    image: `${SITE_URL}/og.png`, mainEntityOfPage: url,
  }];
  return { url, html: layout({ title: `${rep.title} | Skipful Research`, description: rep.dek, canonical: url, body, jsonLd, ogTitle: rep.title }) };
}

function chainPage(rep, S) {
  const url = `${RESEARCH_URL}/${rep.slug}/`;
  const B = S.groups.branded, I = S.groups.independent;
  const stars = ['3-star', '4-star', '5-star'].filter(k => S.byStar[k]);
  const lift = Math.round((I.under10k / B.under10k - 1) * 100);
  const MAJORS = ['Marriott', 'Hilton', 'Hyatt', 'IHG', 'Accor'];
  const P = MAJORS.filter(k => S.byParent[k] && S.byParent[k].collabs12 >= 500).map(k => ({ k, ...S.byParent[k] })).sort((a, b) => b.under10k - a.under10k);
  const pair = (label, b, i, key) => [{ label: `${label} · Independent`, value: i[key], n: i.collabs12, hi: true }, { label: `${label} · Branded`, value: b[key], n: b.collabs12 }];
  const chStars = barChart({ id: 'under10k-by-star', title: 'Share of collabs that went to creators under 10K', subtitle: 'Independent vs. branded hotels, by star rating, last 12 months', rows: Object.assign([...pair('All hotels', B, I, 'under10k'), ...stars.flatMap(k => pair(k.replace('-star', '-star'), S.byStar[k].branded, S.byStar[k].independent, 'under10k'))], { label: 'Group' }), max: 50, note: 'Highlighted: independent hotels', citeUrl: url });
  const chSize = barChart({ id: 'size-mix', title: 'Who each kind of hotel hosts, by creator follower count', subtitle: 'Share of collabs, last 12 months', rows: Object.assign(I.buckets.flatMap((x, n) => [{ label: `${x.label} · Independent`, value: x.pct, hi: true }, { label: `${x.label} · Branded`, value: B.buckets[n].pct }]), { label: 'Followers' }), note: 'Highlighted: independent hotels', citeUrl: url });
  const chRepeat = barChart({ id: 'repeat', title: 'Hotels that host creators again', subtitle: 'Share of hosting hotels with 2+ and 5+ creator collabs', rows: Object.assign([{ label: '2+ collabs · Independent', value: I.repeatRate, hi: true }, { label: '2+ collabs · Branded', value: B.repeatRate }, { label: '5+ collabs · Independent', value: I.repeat5Rate, hi: true }, { label: '5+ collabs · Branded', value: B.repeat5Rate }], { label: 'Group' }), max: 100, note: 'Highlighted: independent hotels', citeUrl: url });
  const chParent = P.length >= 3 ? barChart({ id: 'by-group', title: 'Share of collabs to creators under 10K, by hotel group', subtitle: 'Brands grouped by parent company, last 12 months', rows: Object.assign(P.map(p => ({ label: `${p.k} (${p.collabs12.toLocaleString('en-US')} collabs)`, value: p.under10k, n: p.collabs12 })).concat([{ label: `Independent hotels (${I.collabs12.toLocaleString('en-US')} collabs)`, value: I.under10k, n: I.collabs12, hi: true }]), { label: 'Hotel group' }), max: 50, citeUrl: url }) : '';
  const body = researchHead(S, {
    title: rep.title, url, eyebrow: 'Skipful Research · Data report', lede: esc(rep.dek),
    meta: `By the ${BYLINE} · Published ${longDate(rep.published)} · Data through ${longDate(S.generatedAt)}`,
  }) + `<main>
<section><div class="wrap">
<div class="stats" style="margin-top:0">
<div class="stat" style="background:var(--ink)"><b>${pctFmt(I.hostShare)}</b><span>of hotels that host creators are independent</span></div>
<div class="stat" style="background:var(--ink)"><b>${pctFmt(I.under10k)}</b><span>of independent hotels' collabs go to creators under 10K</span></div>
<div class="stat" style="background:var(--ink)"><b>${pctFmt(B.under10k)}</b><span>at branded hotels</span></div>
<div class="stat" style="background:var(--ink)"><b>${pctFmt(B.repeatRate)}</b><span>of branded hosts work with creators again (independent: ${pctFmt(I.repeatRate)})</span></div>
</div>
</div></section>
<section><div class="wrap r-body">
<h2>Key findings</h2>
<ul>
<li><b>Independents are most of the market.</b> ${pctFmt(I.hostShare)} of the hotels that host creators in our data are independent, and they accounted for ${pctFmt(I.collabShare12)} of hotel–creator collabs in the last 12 months.</li>
<li><b>They're far more open to small creators.</b> ${pctFmt(I.under10k)} of independent hotels' collabs went to creators under 10K, versus ${pctFmt(B.under10k)} at branded hotels, about ${lift}% more. The typical creator at an independent hotel had ${kFmt(I.median)} followers; at a branded hotel, ${kFmt(B.median)}.</li>
<li><b>It holds at every star level</b> (independent vs. branded): ${andList(stars.map(k => `${k}: ${pctFmt(S.byStar[k].independent.under10k)} vs. ${pctFmt(S.byStar[k].branded.under10k)}`))}. It holds in the US (${pctFmt(S.byRegion.US.independent.under10k)} vs. ${pctFmt(S.byRegion.US.branded.under10k)}) and internationally (${pctFmt(S.byRegion.International.independent.under10k)} vs. ${pctFmt(S.byRegion.International.branded.under10k)}) too.</li>
<li><b>Branded hotels make it a habit.</b> ${pctFmt(B.repeatRate)} of branded hotels that host creators have done it more than once, and ${pctFmt(B.repeat5Rate)} five or more times. For independents: ${pctFmt(I.repeatRate)} and ${pctFmt(I.repeat5Rate)}.</li>
${P.length >= 3 ? `<li><b>Among the big groups, ${esc(P[0].k)} brands lean toward the smallest creators</b> (${pctFmt(P[0].under10k)} of collabs to creators under 10K) and <b>${esc(P[P.length - 1].k)} brands lean toward the biggest</b> (${pctFmt(P[P.length - 1].under10k)}).</li>` : ''}
</ul>
<p class="pull">Small creators get a bigger share of the yeses at independent hotels, at every star level.</p>
<h2>1. Small creators win more at independent hotels</h2>
<p>The data can't tell us why, but a likely reason is who decides. At an independent hotel, the owner or general manager can often say yes to a stay on the spot. At a branded hotel, creator partnerships may run through brand marketing teams and programs built around reach. Either way, branded hotels give ${pctFmt(B.over100k)} of their collabs to creators with 100K+ followers, versus ${pctFmt(I.over100k)} at independents.</p>
${chSize}
<h2>2. The gap holds at every star level</h2>
<p>Branded hotels that host creators in our data skew toward 4- and 5-star properties, and higher-star hotels host bigger creators. So we compared like with like. At every star level, independents gave a larger share of their collabs to creators under 10K. The gap is widest at 4-star hotels (${pctFmt(S.byStar['4-star'].independent.under10k)} vs. ${pctFmt(S.byStar['4-star'].branded.under10k)}), the most common tier for hosted stays.</p>
${chStars}
<h2>3. Branded hotels are steadier partners</h2>
<p>Once a branded hotel starts working with creators, it tends to keep going. That fits brands that run creator programs with budgets and calendars. For creators, a branded hotel that has hosted before is a strong repeat target, especially once you've grown past 10K.</p>
${chRepeat}
${chParent ? `<h2>4. Not all hotel groups are alike</h2>
<p>Grouping branded hotels by parent company shows real differences. ${esc(P[0].k)} brands gave ${pctFmt(P[0].under10k)} of their collabs to creators under 10K, close to independent hotels. ${esc(P[P.length - 1].k)} brands gave ${pctFmt(P[P.length - 1].under10k)}, and their typical creator had ${kFmt(P[P.length - 1].median)} followers.</p>
${chParent}` : ''}
<h2>What it means</h2>
<p><b>For creators under 10K:</b> lead with independent and boutique hotels. A bigger share of their collabs go to creators your size, at every star level. Use branded hotels as the next step: they host more consistently, and a hotel that has already worked with creators is the warmest pitch you can send.</p>
<p><b>For independent hotels:</b> you're already where most creator partnerships happen. More than a third of independent hotels' creator collabs already go to creators under 10K, so pitches from smaller creators are worth a real look.</p>
<p><b>For brands:</b> branded hotels lean toward bigger audiences, and small creators already get about a quarter of their collabs. Creators under 10K are a real part of the market at branded hotels too.</p>
${researchCta(rep.slug)}
</div></section>
<section><div class="wrap r-body"><h2>Methodology</h2>
<p>Skipful identifies public social media posts that our system classifies as hotel–creator collaborations (a creator posting about a stay at a specific hotel), links each post to the hotel, and records the creator's follower count when we collected it. Figures cover collabs in the 12 months to ${longDate(S.generatedAt)} unless noted. Accounts under 500 followers are excluded as likely data errors.</p>
<p><b>Branded vs. independent.</b> We tagged a hotel as branded when its name contains a known brand of a major or regional hotel group (for example "Courtyard by Marriott" or "Hotel Indigo"). Everything else counts as independent. We checked the tagging by hand on random samples: 99 of 100 branded tags were correct, but about 1 in 10 hotels tagged independent actually belonged to a smaller regional group. So the independent figures include some small chains, which if anything narrows the gaps we report. Star ratings come from public listing data.</p>
<p><b>What we don't compare.</b> We don't compare how <i>often</i> branded and independent hotels host creators, because the hotels we track aren't an even sample of each group. We report shares within each group instead. Group-level figures are only shown where a group had at least 500 collabs in the period, and cover every hotel operating under that group's brands, including franchised and independently owned hotels. Groups with fewer collabs have wider margins of error, so small differences between groups shouldn't be over-read. All figures are aggregates; we do not publish individual hotels' or creators' data.</p>
${citeBox(rep.title, url, rep.published)}
</div></section>
</main>`;
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: rep.title, description: rep.dek, url,
    datePublished: rep.published, dateModified: rep.published,
    author: { '@type': 'Organization', name: BYLINE }, publisher: { '@type': 'Organization', name: 'Skipful', url: APP_URL, logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` } },
    image: `${SITE_URL}/og.png`, mainEntityOfPage: url,
  }];
  return { url, html: layout({ title: `${rep.title} | Skipful Research`, description: rep.dek, canonical: url, body, jsonLd, ogTitle: rep.title }) };
}

const DISPLAY_PLACE = { 'Brisbane City, Australia': 'Brisbane, Australia', 'Washington, District of Columbia': 'Washington, D.C.' };
const displayPlace = p => DISPLAY_PLACE[p] || p;
const shortPlace = p => (/^Portland, /.test(p) ? `Portland (${p.split(', ')[1]})` : displayPlace(p).split(', ')[0]);

function rankingPage(rep, S, slugByKey) {
  const url = `${RESEARCH_URL}/${rep.slug}/`;
  const T = S.ranking, top = T.slice(0, 10), C = S.categories;
  const anchor = r => slugByKey.get(r.key) || r.key.replace(/[^a-z0-9]+/g, '-');
  const guide = key => { const s = slugByKey.get(key); return s ? `${SITE_URL}/${SECTION}/${s}/` : null; };
  const placeLink = (key, place) => { const g = guide(key); return g ? `<a href="${g}">${esc(displayPlace(place))}</a>` : esc(displayPlace(place)); };
  const intl = T.filter(r => !r.isUS), us = T.filter(r => r.isUS);
  const catCard = (title, sub, list, fmt) => `<div class="rk-cat"><h3>${title}</h3><p class="note">${sub}</p><ol>${list.map(x => `<li>${placeLink(x.key, x.place)} <b>${fmt(x.value)}</b></li>`).join('')}</ol></div>`;
  const rows = T.map(r => `<tr id="${anchor(r)}"><td class="rk-n">${r.rank}</td><td class="rk-city">${placeLink(r.key, r.place)}</td><td class="rk-score"><b>${r.score}</b></td><td>${pctFmt(r.hostingRate)}</td><td>${pctFmt(r.under10k)}</td><td>${pctFmt(r.repeatRate)}</td><td>${kFmt(r.medianFollowers)}</td></tr>`).join('\n');
  const body = researchHead(S, {
    title: rep.title, url, eyebrow: 'Skipful Research · City ranking', lede: esc(rep.dek),
    meta: `By the ${BYLINE} · Published ${longDate(rep.published)} · Data through ${longDate(S.generatedAt)}`,
  }) + `<style>
.rk-top{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:8px 0 6px}
.rk-top a{display:block;background:var(--ink);color:var(--ivory);border-radius:12px;padding:14px 14px 12px;text-decoration:none}
.rk-top a small{color:var(--champ);font-weight:600;letter-spacing:.04em}.rk-top a b{display:block;font-size:17px;margin:2px 0 4px;line-height:1.2}.rk-top a span{font-size:13px;color:var(--mist)}
.rk-cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:12px 0 4px}
.rk-cat{border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:16px 18px}.rk-cat h3{margin:0 0 2px;font-size:18px}.rk-cat ol{margin:10px 0 0;padding-left:20px}.rk-cat li{margin:4px 0}.rk-cat li b{float:right;font-variant-numeric:tabular-nums}
.rk-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:14px 0}
.rk{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums;min-width:600px}
.rk th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b6b6b;padding:8px 8px;border-bottom:2px solid rgba(0,0,0,.12);vertical-align:bottom}
.rk td{padding:9px 8px;border-bottom:1px solid rgba(0,0,0,.07)}.rk tr:target td{background:#fbf3e4}
.rk-n{color:#8a8a8a;width:34px}.rk-city{font-weight:600}.rk-score b{display:inline-block;min-width:34px;text-align:center;background:var(--ink);color:var(--ivory);border-radius:6px;padding:2px 6px}
main code{overflow-wrap:anywhere}
@media(max-width:640px){.rk-top{grid-template-columns:1fr 1fr}}
</style><main>
<section><div class="wrap">
<h2 style="margin-top:0">The top 10</h2>
<div class="rk-top">${top.map(r => `<a href="#${anchor(r)}"><small>#${r.rank}</small><b>${esc(shortPlace(r.place))}</b><span>Score ${r.score} · ${pctFmt(r.under10k)} small creators</span></a>`).join('')}</div>
</div></section>
<section><div class="wrap r-body">
<h2>Key findings</h2>
<ul>
<li><b>${esc(displayPlace(T[0].place))}</b> and <b>${esc(displayPlace(T[1].place))}</b> tie for the top score (${T[0].score}). In ${esc(shortPlace(T[1].place))}, ${pctFmt(T[1].under10k)} of hotel collabs went to creators under 10K and ${pctFmt(T[1].repeatRate)} of hosting hotels came back for more.</li>
<li><b>Smaller cities beat famous ones.</b> ${esc(andList(top.filter(r => /^(La Jolla|San Luis Obispo|Portland, Maine|Napa|Pittsburgh)/.test(r.place)).map(r => shortPlace(r.place))))} all make the top 10, ahead of bigger names like ${esc(andList(T.filter(r => /^(San Francisco|Las Vegas|Nashville|San Diego)/.test(r.place)).map(r => `${shortPlace(r.place)} (#${r.rank})`)))}.</li>
<li><b>${esc(shortPlace(C.mostOpen[0].place))}</b> has the highest share of hotels that have hosted creators (${pctFmt(C.mostOpen[0].value)}), followed by ${esc(andList(C.mostOpen.slice(1, 3).map(x => shortPlace(x.place))))}.</li>
<li><b>${esc(shortPlace(C.smallCreators[0].place))}</b> is the most open to small creators: ${pctFmt(C.smallCreators[0].value)} of its hotel collabs went to creators under 10K, against ${pctFmt(T.find(r => /^Las Vegas/.test(r.place))?.under10k ?? 0)} in Las Vegas.</li>
<li>${intl.length} of the top 50 are outside the US, led by ${esc(andList(intl.slice(0, 3).map(r => `${shortPlace(r.place)} (#${r.rank})`)))}.</li>
</ul>
<p class="pull">The best city to pitch isn't the most famous one. It's the one where hotels already say yes to creators like you.</p>
</div><div class="wrap"><h2>Category winners</h2><div class="rk-cats">
${catCard('Best for small creators', 'Share of collabs going to creators under 10K', C.smallCreators, pctFmt)}
${catCard('Most open hotels', 'Share of tracked hotels that have hosted creators', C.mostOpen, pctFmt)}
${catCard('Most loyal hosts', 'Share of hosting hotels that hosted more than once', C.loyalHosts, pctFmt)}
</div></div></section>
<section><div class="wrap">
<h2>The full ranking: top 50 creator-friendly hotel cities</h2>
<p class="note">Tap a city to see the hotels there that work with creators. Each row has its own link to share (for example <code>${url}#${anchor(T[1])}</code>).</p>
<div class="rk-wrap"><table class="rk"><thead><tr><th>#</th><th>City</th><th>Score</th><th>Hotels that host</th><th>Small-creator share</th><th>Repeat hosts</th><th>Median creator</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p class="note"><b>Score</b> (0–100) averages each city's percentile on the three rates. <b>Hotels that host</b>: share of the hotels Skipful tracks in that city that have hosted at least one creator. <b>Small-creator share</b>: share of the city's hotel collabs in the last 12 months that went to creators under 10K followers. <b>Repeat hosts</b>: share of hosting hotels with more than one collab. <b>Median creator</b>: median follower count of creators hosted in the last 12 months.</p>
</div></section>
<section><div class="wrap r-body">
<h2>What it means</h2>
<p><b>For creators:</b> where you pitch matters as much as how many followers you have. In the top-ranked cities, hotels already work with creators, often small ones, and most come back for more. Start there, use the city guides to find hotels that have hosted creators near your size, and pitch the ones that host repeatedly.</p>
<p><b>For hotels and tourism boards:</b> in the top cities, creator stays are already standard practice for a large share of hotels. A hotel in ${esc(shortPlace(T[0].place))} or ${esc(shortPlace(T[1].place))} that isn't hosting creators is the exception, not the rule.</p>
<p><b>For journalists:</b> every city has its own row, link and numbers. We're happy to share more detail on a specific city for a local story: email <a href="mailto:${PRESS_EMAIL}?subject=Press%3A%20Creator-friendly%20cities">${PRESS_EMAIL}</a>.</p>
${researchCta(rep.slug)}
</div></section>
<section><div class="wrap r-body"><h2>Methodology</h2>
<p>Skipful identifies public social media posts that our system classifies as hotel–creator collaborations (a creator posting about a stay at a specific hotel), links each post to the hotel, and records the creator's follower count when we collected it. We also track hotels from public listing data, whether or not they have hosted a creator. As of ${longDate(S.generatedAt)}, that covers ${S.totals.tracked.toLocaleString('en-US')} hotels and other lodging properties.</p>
<p>A city is ranked only if Skipful tracks at least ${S.method.min.tracked} hotels there, at least ${S.method.min.hosts} of them have hosted creators, and they had at least ${S.method.min.collabs12} creator collabs in the last 12 months. ${S.totals.eligible} cities qualified. For each, we computed three rates (hotels that host, small-creator share, repeat hosts), converted each to a percentile among the qualifying cities, and averaged the three with equal weight. Ties are broken by hosting rate.</p>
<p>"Hotels that host" is a share of the hotels <i>Skipful tracks</i>, not of every hotel in the city, and our coverage of each city's hotels varies. Coverage also skews toward hotels and creators that post publicly and tag properties, and toward English-language markets. Accounts under 500 followers are excluded as likely data errors. Neighborhoods are grouped into their city where listings use them (for example, Seminyak and Canggu count as Bali). All figures are aggregates; we do not publish individual hotels' or creators' data.</p>
<p>This ranking uses a fixed snapshot of the data so the numbers stay citable. For our broader figures, see <a href="${RESEARCH_URL}/${STATS_SLUG}/">Hotel Influencer Marketing Statistics</a>.</p>
${citeBox(rep.title, url, rep.published)}
</div></section>
</main>`;
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: rep.title, description: rep.dek, url,
    datePublished: rep.published, dateModified: rep.published,
    author: { '@type': 'Organization', name: BYLINE }, publisher: { '@type': 'Organization', name: 'Skipful', url: APP_URL, logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon.png` } },
    image: `${SITE_URL}/og.png`, mainEntityOfPage: url,
  }, {
    '@context': 'https://schema.org', '@type': 'ItemList', name: rep.title, numberOfItems: T.length,
    itemListElement: T.map(r => ({ '@type': 'ListItem', position: r.rank, name: displayPlace(r.place), url: `${url}#${anchor(r)}` })),
  }];
  return { url, html: layout({ title: `${rep.title} | Skipful Research`, description: `${displayPlace(T[0].place)} and ${displayPlace(T[1].place)} top our ranking of 87 cities by how often hotels host creators, openness to small creators, and repeat hosting. See all 50.`, canonical: url, body, jsonLd, ogTitle: rep.title }) };
}

function researchHub(R) {
  const url = `${RESEARCH_URL}/`;
  const body = researchHead(R, {
    title: 'Skipful Research', url, eyebrow: 'Data on hotels and travel creators',
    lede: `Original research from the ${BYLINE}, built on ${R.totals.collabs.toLocaleString('en-US')} hotel–creator collaborations at ${R.totals.hotels.toLocaleString('en-US')} hotels in ${R.totals.countries} countries.`,
    meta: `Press and data requests: <a href="mailto:${PRESS_EMAIL}?subject=Press%3A%20Skipful%20Research" style="color:var(--champ)">${PRESS_EMAIL}</a>`,
  }) + `<main><section><div class="wrap">
<div class="r-cards">
<a class="r-card" href="${RESEARCH_URL}/${STATS_SLUG}/"><small>Always up to date</small><h3>Hotel Influencer Marketing Statistics (${R.generatedAt.slice(0, 4)})</h3><p>The key numbers on who hotels host, by follower size, star rating, country and city.</p></a>
${REPORTS.map(r => `<a class="r-card" href="${RESEARCH_URL}/${r.slug}/"><small>Report · ${esc(longDate(r.published))}</small><h3>${esc(r.title)}</h3><p>${esc(r.dek)}</p></a>`).join('\n')}
</div>
</div></section>
<section><div class="wrap r-body"><h2>Using our data</h2>
<p>Journalists, researchers and writers are welcome to cite any figure with attribution to the ${BYLINE} and a link to the page it came from. Every chart can be embedded, and the underlying aggregate data is <a href="${RESEARCH_URL}/data/skipful-hotel-creator-stats.csv">available as a CSV</a>. We're happy to run custom cuts (a city, a hotel type, a follower range) for a story: email <a href="mailto:${PRESS_EMAIL}?subject=Press%3A%20Skipful%20Research">${PRESS_EMAIL}</a>.</p>
<p>All research is aggregate. We never publish individual hotels' or creators' data.</p>
${researchCta('hub')}
</div></section></main>`;
  return { url, html: layout({ title: 'Skipful Research: Data on Hotels and Travel Creators', description: 'Original research on hotel–creator collaborations: who hotels host, by follower size, star rating, country and city. Free to cite.', canonical: url, body }) };
}

function embedPage(R, key) {
  const c = researchCharts(R)[key];
  const src = `${RESEARCH_URL}/${STATS_SLUG}/`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)} | Skipful Research</title><link rel="canonical" href="${esc(src)}"><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Manrope:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}${RESEARCH_CSS}body{background:transparent}.chart{margin:0}.chart a{color:var(--bronze)}</style></head><body>
${barChart({ id: key, ...c, citeUrl: src }).replace(/<a href=/g, '<a target="_blank" rel="noopener" href=')}
</body></html>`;
}

async function writeResearch(raw, cities = []) {
  const R = process.env.RESEARCH_DATA
    ? JSON.parse(await fs.readFile(path.join(ROOT, process.env.RESEARCH_DATA), 'utf8'))
    : computeResearch(raw, { cleanCity, countryName });
  const base = path.join(OUT, 'research');
  const put = async (rel, html) => { await fs.mkdir(path.join(base, rel), { recursive: true }); await fs.writeFile(path.join(base, rel, 'index.html'), html); };
  const urls = [];
  const hub = researchHub(R); await put('', hub.html); urls.push(hub.url);
  const st = statsPage(R); await put(STATS_SLUG, st.html); urls.push(st.url);
  for (const rep of REPORTS) {
    const snap = JSON.parse(await fs.readFile(path.join(ROOT, rep.snapshot), 'utf8'));
    const pg = rep.kind === 'chain' ? chainPage(rep, snap) : rep.kind === 'ranking' ? rankingPage(rep, snap, new Map(cities.map(c => [fold(`${c.city}|${c.isUS ? c.state : ''}|${c.country}`), c.slug]))) : reportPage(rep, snap); await put(rep.slug, pg.html); urls.push(pg.url);
  }
  for (const key of Object.keys(researchCharts(R))) await put(`embed/${key}`, embedPage(R, key));
  await fs.mkdir(path.join(base, 'data'), { recursive: true });
  await fs.writeFile(path.join(base, 'data', 'skipful-hotel-creator-stats.csv'), researchCsv(R));
  return urls;
}

// ---------- build ----------

async function main() {
  const raw = await loadData();
  // Snapshot mode: save this month's research numbers for the next report, then stop (no site build).
  if (process.env.SNAPSHOT_OUT) {
    const R = computeResearch(raw, { cleanCity, countryName });
    await fs.mkdir(path.dirname(path.resolve(ROOT, process.env.SNAPSHOT_OUT)), { recursive: true });
    await fs.writeFile(path.resolve(ROOT, process.env.SNAPSHOT_OUT), JSON.stringify(R) + '\n');
    console.log(`Saved research snapshot: ${R.totals.collabs} collabs, ${R.totals.hotels} hotels -> ${process.env.SNAPSHOT_OUT}`);
    return;
  }
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

  for (const u of await writeResearch(raw, cities)) urls.push(u);

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
