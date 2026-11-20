// Skipful Research pages: hub, always-on statistics page, dated reports, embeddable charts, CSV.
// Everything here is aggregate. No hotel names, no creator handles.

export const BYLINE = 'Skipful Research Team';

const pctFmt = n => `${Number(n).toFixed(1).replace(/\.0$/, '')}%`;
const kFmt = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);
const longDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthYear = iso => new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const ratio = p => (p >= 30 && p < 34 ? 'nearly 1 in 3' : p >= 34 && p < 36 ? 'about 1 in 3' : p >= 22 && p < 25 ? 'nearly 1 in 4' : p >= 25 && p < 27 ? 'about 1 in 4' : p >= 36 && p < 40 ? 'nearly 2 in 5' : p >= 40 && p < 42 ? 'about 2 in 5' : p >= 47 && p < 50 ? 'nearly half' : p >= 60 && p < 67 ? 'about two-thirds' : pctFmt(p));

export const RESEARCH_CSS = `
.r-hero{background:var(--ink);color:var(--ivory);padding:56px 0 60px}
.r-meta{font-size:14px;color:var(--mist);margin-top:16px}
.r-body{max-width:760px}
.r-body p{margin:0 0 16px}
.r-body h2{margin-top:6px}
.keylist{counter-reset:k;list-style:none;padding:0;margin:0;display:grid;gap:12px}
.keylist li{counter-increment:k;background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px 16px 56px;position:relative}
.keylist li::before{content:counter(k);position:absolute;left:18px;top:14px;font:600 22px/1 'Cormorant Garamond',Georgia,serif;color:var(--bronze)}
.keylist b{font-weight:600}
.chart{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px 22px 14px;margin:22px 0}
.chart figcaption{margin-bottom:14px}
.chart .ct{font-weight:600;font-size:17px;display:block}
.chart .cs{font-size:14px;color:var(--muted);display:block}
.hb{display:grid;grid-template-columns:minmax(96px,170px) minmax(0,1fr) 56px;gap:8px 12px;align-items:center;font-size:15px;padding:3px 0}
.hb .l{color:var(--ink)}
.hb .t{height:16px;position:relative}
.hb .f{display:block;height:100%;background:#D9CBAA;border-radius:0 4px 4px 0;min-width:2px}
.hb.hi .f{background:var(--bronze)}
.hb .v{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.hb:hover .f{filter:brightness(.92)}
.chart .src{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);margin-top:14px;padding-top:10px}
.chart details{font-size:13px}
.chart details summary{cursor:pointer;color:var(--bronze)}
.chart details table{border-collapse:collapse;margin-top:8px;width:100%}
.chart details td,.chart details th{border-top:1px solid var(--line);padding:6px 8px;text-align:left}
.chart pre{white-space:pre-wrap;word-break:break-all;background:var(--ivory);padding:10px;border-radius:8px;font-size:12px;margin:8px 0 0}
.cite{background:var(--ivory);border-radius:16px;padding:20px 22px;font-size:15px}
.cite code{display:block;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px;font-size:13px;white-space:normal}
.r-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.r-card{display:block;background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;color:var(--ink)}
.r-card:hover{text-decoration:none;border-color:var(--champ)}
.r-card small{color:var(--muted);font-size:13px;display:block;margin-bottom:6px}
.r-card p{color:var(--muted);margin:8px 0 0;font-size:15px}
.pull{font:600 26px/1.25 'Cormorant Garamond',Georgia,serif;border-left:3px solid var(--champ);padding:4px 0 4px 18px;margin:26px 0}
.r-cta{background:var(--ink);color:var(--ivory);border-radius:18px;padding:26px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between}
.r-cta p{margin:0;max-width:520px;color:#D9D2C4}
@media (max-width:720px){.hb{grid-template-columns:92px minmax(0,1fr) 48px;font-size:14px}.keylist li{padding-left:48px}.chart{padding:16px 14px 10px}}
`;

// ---------- charts ----------

// One series, so one color; the highlighted rows carry the story, the rest stay quiet.
// Values sit at the bar tips in text ink; hover shows the exact value and sample size.
export function barChart({ id, title, subtitle, rows, max, unit = '%', note, embedUrl, citeUrl }) {
  const m = max ?? Math.max(...rows.map(r => r.value)) * 1.05;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = v => (unit === '%' ? pctFmt(v) : kFmt(v));
  const bars = rows.map(r => `<div class="hb${r.hi ? ' hi' : ''}" title="${esc(r.label)}: ${esc(fmt(r.value))}${r.n ? ` (${Number(r.n).toLocaleString('en-US')} collabs)` : ''}"><span class="l">${esc(r.label)}</span><span class="t"><span class="f" style="width:${Math.max(0.5, (r.value / m) * 100).toFixed(1)}%"></span></span><span class="v">${esc(fmt(r.value))}</span></div>`).join('');
  const table = `<details><summary>Show data table</summary><table><tr><th>${esc(rows.label || 'Group')}</th><th>Value</th>${rows.some(r => r.n) ? '<th>Collabs</th>' : ''}</tr>${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(fmt(r.value))}</td>${r.n ? `<td>${Number(r.n).toLocaleString('en-US')}</td>` : ''}</tr>`).join('')}</table></details>`;
  const embed = embedUrl ? `<details><summary>Embed this chart</summary><pre>&lt;iframe src="${esc(embedUrl)}" title="${esc(title)}" width="100%" height="${110 + rows.length * 30}" style="border:0" loading="lazy"&gt;&lt;/iframe&gt;&lt;p&gt;Source: &lt;a href="${esc(citeUrl)}"&gt;Skipful Research&lt;/a&gt;&lt;/p&gt;</pre></details>` : '';
  return `<figure class="chart" id="${esc(id)}" role="group" aria-label="${esc(title)}">
<figcaption><span class="ct">${esc(title)}</span>${subtitle ? `<span class="cs">${esc(subtitle)}</span>` : ''}</figcaption>
${bars}
<div class="src"><span>${note ? `${esc(note)} · ` : ''}Source: <a href="${esc(citeUrl)}">Skipful Research</a></span><span>${table}${embed}</span></div>
</figure>`;
}

export function charts(R) {
  const L = R.last12;
  const stars = Object.entries(R.byStars).map(([k, v]) => ({ label: k.replace('-star', '-star hotels'), value: v.under10k, n: v.total }));
  return {
    'follower-size': {
      title: 'Who hotels host, by creator follower count',
      subtitle: `Share of hotel–creator collabs, last 12 months (${L.total.toLocaleString('en-US')} collabs)`,
      rows: L.buckets.map((b, i) => ({ label: b.label, value: b.pct, n: b.n, hi: i < 2 })),
      note: 'Highlighted: creators under 10K',
    },
    'star-rating': {
      title: 'Share of collabs that went to creators under 10K, by star rating',
      subtitle: 'Last 12 months',
      rows: Object.assign(stars.map(r => ({ ...r, hi: true })), { label: 'Star rating' }),
      max: 50,
    },
    countries: {
      title: 'Share of collabs that went to creators under 10K, by country',
      subtitle: 'Last 12 months, countries with 150+ collabs',
      rows: Object.assign(R.countries.map(c => ({ label: c.name, value: c.under10k, n: c.collabs, hi: c.under10k >= L.under10k })), { label: 'Country' }),
      max: 70,
      note: 'Highlighted: above the global average',
    },
    cities: {
      title: 'Friendliest cities for creators under 10K',
      subtitle: 'Share of each city’s collabs that went to creators under 10K, last 12 months (cities with 60+ collabs at 8+ hotels)',
      rows: Object.assign(R.smallFriendlyCities.slice(0, 10).map(c => ({ label: c.place.replace(/, (United States|United Kingdom)$/, ''), value: c.under10k, n: c.collabs, hi: true })), { label: 'City' }),
      max: 70,
    },
  };
}

// ---------- key stats (quotable sentences) ----------

export function keyStats(R) {
  const L = R.last12, S = R.byStars, H = R.hosts;
  const s = [];
  s.push(`<b>${ratio(L.under10k).replace(/^./, c => c.toUpperCase())} hotel–creator collabs (${pctFmt(L.under10k)}) went to creators with fewer than 10,000 followers</b> in the last 12 months.`);
  s.push(`<b>${pctFmt(L.buckets[0].pct)}</b> of hotel collabs went to creators with <b>fewer than 5,000 followers</b>.`);
  s.push(`Only <b>${pctFmt(L.over100k)}</b> of hotel collabs went to creators with <b>100,000+ followers</b>, and just ${pctFmt(L.buckets[5].pct)} to creators with 500,000+.`);
  s.push(`The <b>median creator</b> in a hotel collab has <b>${kFmt(L.median)} followers</b>.`);
  s.push(`<b>${pctFmt(H.hostedUnder10kPct)}</b> of hotels that work with creators have hosted at least one creator with under 10,000 followers.`);
  if (S['3-star'] && S['5-star']) s.push(`At <b>3-star hotels, ${pctFmt(S['3-star'].under10k)}</b> of collabs went to creators under 10K, versus <b>${pctFmt(S['5-star'].under10k)} at 5-star hotels</b>.`);
  if (S['5-star']) s.push(`Luxury skews bigger but isn't closed: <b>${pctFmt(S['5-star'].over100k)}</b> of 5-star hotel collabs went to creators with 100K+ followers, yet <b>${ratio(S['5-star'].under10k)}</b> still went to creators under 10K.`);
  if (R.byType.Resorts && R.byType.Hotels) s.push(`Resorts work with slightly bigger creators than hotels: <b>${pctFmt(R.byType.Resorts.under10k)}</b> of resort collabs went to creators under 10K, versus <b>${pctFmt(R.byType.Hotels.under10k)}</b> at hotels.`);
  s.push(`<b>${pctFmt(H.repeat2Pct)}</b> of hotels that work with creators did it more than once; <b>${pctFmt(H.repeat5Pct)}</b> hosted 5 or more collabs and <b>${pctFmt(H.repeat10Pct)}</b> hosted 10 or more.`);
  s.push(`At hotels that host repeatedly, the <b>median gap between creator collabs is ${H.medianDaysBetween} days</b>.`);
  const top = R.countries[0], bottom = R.countries[R.countries.length - 1];
  if (top && bottom) s.push(`By country, <b>${top.name}</b> had the highest share of collabs going to creators under 10K (<b>${pctFmt(top.under10k)}</b>); <b>${bottom.name}</b> had the lowest (<b>${pctFmt(bottom.under10k)}</b>).`);
  const c1 = R.smallFriendlyCities[0], c2 = R.smallFriendlyCities[1], t1 = R.toughestCities[0];
  if (c1 && c2) s.push(`<b>${c1.place}</b> (${pctFmt(c1.under10k)}) and <b>${c2.place}</b> (${pctFmt(c2.under10k)}) led all major cities for collabs with creators under 10K.`);
  if (t1) s.push(`<b>${t1.place}</b> was the toughest major city for smaller creators: only <b>${pctFmt(t1.under10k)}</b> of its hotel collabs went to creators under 10K, and the median creator there had <b>${kFmt(t1.median)} followers</b>.`);
  if (R.stability) s.push(`The small-creator share is steady: in every month with enough data it stayed between <b>${pctFmt(R.stability.min)}</b> and <b>${pctFmt(R.stability.max)}</b>.`);
  return s;
}

export function methodology(R) {
  return `<p>Skipful identifies public social media posts that our system classifies as hotel–creator collaborations (a creator posting about a stay at a specific hotel), then links each post to the hotel and records the creator's follower count when we collected it. This dataset covers <b>${R.totals.collabs.toLocaleString('en-US')} collabs</b> at <b>${R.totals.hotels.toLocaleString('en-US')} hotels</b> in <b>${R.totals.countries} countries</b>, posted between ${monthYear(R.totals.first)} and ${monthYear(R.totals.last)}. "Last 12 months" figures use the ${R.totals.collabs12.toLocaleString('en-US')} collabs posted in the 365 days before ${longDate(R.generatedAt)}.</p>
<p>Each collab is counted once; a creator who works with several hotels counts once per hotel. Accounts under 500 followers are excluded as likely data errors. Star ratings and property types come from public listing data. Country and city figures include only places with enough collabs to be meaningful (150+ for countries, 60+ collabs across 8+ hotels for cities).</p>
<p>Our collection coverage has grown and changed over time, so we report <b>shares</b> (what portion of collabs went to which creators), not month-to-month volume. Coverage skews toward hotels and creators that post publicly and tag properties, and toward English-language markets. All figures are aggregates; we do not publish individual hotels' or creators' data.</p>`;
}

export function csv(R) {
  const rows = [['metric', 'segment', 'value', 'collabs']];
  for (const b of R.last12.buckets) rows.push(['share_of_collabs_last_12m', b.label, b.pct, b.n]);
  rows.push(['share_under_10k_last_12m', 'All hotels', R.last12.under10k, R.last12.total]);
  rows.push(['share_100k_plus_last_12m', 'All hotels', R.last12.over100k, R.last12.total]);
  rows.push(['median_creator_followers_last_12m', 'All hotels', R.last12.median, R.last12.total]);
  for (const [k, v] of Object.entries(R.byStars)) { rows.push(['share_under_10k_last_12m', k, v.under10k, v.total]); rows.push(['share_100k_plus_last_12m', k, v.over100k, v.total]); rows.push(['median_creator_followers_last_12m', k, v.median, v.total]); }
  for (const [k, v] of Object.entries(R.byType)) if (v) rows.push(['share_under_10k_last_12m', k, v.under10k, v.total]);
  for (const c of R.countries) rows.push(['share_under_10k_last_12m', c.name, c.under10k, c.collabs]);
  for (const c of R.smallFriendlyCities) rows.push(['share_under_10k_last_12m', c.place, c.under10k, c.collabs]);
  for (const c of R.toughestCities) rows.push(['share_under_10k_last_12m', c.place, c.under10k, c.collabs]);
  const H = R.hosts;
  rows.push(['hotels_hosted_any_creator_under_10k_pct', 'All hotels', H.hostedUnder10kPct, '']);
  rows.push(['hotels_with_2plus_collabs_pct', 'All hotels', H.repeat2Pct, '']);
  rows.push(['hotels_with_5plus_collabs_pct', 'All hotels', H.repeat5Pct, '']);
  rows.push(['hotels_with_10plus_collabs_pct', 'All hotels', H.repeat10Pct, '']);
  rows.push(['median_days_between_collabs_repeat_hosts', 'All hotels', H.medianDaysBetween, '']);
  const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return `# Skipful Research: hotel-creator collaboration statistics. Data as of ${R.generatedAt.slice(0, 10)}. Free to use: please credit Skipful (https://www.skipful.com) and link to the source page.\n` + rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}

export { pctFmt, kFmt, longDate, monthYear, ratio };
