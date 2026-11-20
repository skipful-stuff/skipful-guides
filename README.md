# Skipful city guides

Static SEO site for guides.skipful.com: one page per destination listing the hotels that already work with travel creators, built from Skipful's Xano data.

## How it works

- `build.mjs` pulls public-safe data from the Xano endpoint `seo_city_pages` (Opportunities API group, #1342) in small pages, so the small Xano instance isn't strained (~40 seconds per build).
- It de-duplicates collabs, cleans messy city names (Prague 9 → Prague, Badung Regency → Bali), and writes one page per city with 3+ creator-friendly hotels, plus an index, sitemap.xml and robots.txt into `dist/`.
- Each page shows the top 12 hotels; the rest, plus creator history and contacts, are gated behind "Start free" (links carry `utm_source=guides`).
- No creator handles, emails, captions or post links are ever published.
- GitHub Actions rebuilds every Monday and on every push to `main`, and deploys to GitHub Pages.

## One-time setup (about 10 minutes)

1. **Create the repo.** On GitHub (agent account is fine), create a public repo named `skipful-guides` and upload everything in this folder, including `.github/`.
2. **Turn on Pages.** Repo → Settings → Pages → Source: **GitHub Actions**.
3. **Point the subdomain.** In your DNS provider for skipful.com, add a CNAME record: `guides` → `<github-username>.github.io`.
4. **Custom domain.** Repo → Settings → Pages → Custom domain: `guides.skipful.com`, then tick **Enforce HTTPS** once it's available.
5. **Run it.** Actions tab → "Build city guides" → Run workflow.
6. **Tell Google.** In Google Search Console, add `guides.skipful.com` and submit `https://guides.skipful.com/sitemap.xml`.

## Optional

- **GA4:** Repo → Settings → Secrets and variables → Actions → Variables → `GA4_ID` = your `G-…` id.
- **Lock the export:** In Xano → Keys & Variables, add `SEO_EXPORT_KEY` (any long random string). Add the same value as a repo **secret** named `SEO_EXPORT_KEY`. Until then the endpoint is open, but it only returns the same public-safe fields the pages show.

## Run locally

```
node build.mjs                      # uses data/sample_compact.json
XANO_SEO_URL=https://x8e3-4uyz-scg3.n7c.xano.io/api:QZQAfPcA/seo_city_pages node build.mjs   # real data
```

## Email teaser and "Email me this list"

- The build also asks `seo_city_pages` for `dataset: "emails"`, which returns only a count of contact emails per hotel (never addresses). Guides show "We found a contact email for N of these hotels".
- The "Email me this list" form posts to the public Xano endpoint `guide_email_list` (Opportunities group, #1352; source in `xano/guide_email_list.xs`). It saves the request in the `guide_leads` table and sends one fixed-template email per address and city per day, capped at 100 sends an hour. Override the URL with `EMAIL_LIST_URL`.

## Skipful Research (`/research/`)

Built from the same data as the city guides, by `research.mjs` (the numbers) and `research_pages.mjs` (charts, key stats, methodology, CSV). Byline: **Skipful Research Team**. Everything is aggregate: no hotel names, no creator handles.

- `/research/` hub, with press contact and data-use terms.
- `/research/hotel-influencer-marketing-statistics/`: always-on stats page, recomputed on every build.
- `/research/<report>/`: dated reports. Each reads a frozen snapshot in `data/research/` so cited numbers never change. Add one by appending to `REPORTS` in `build.mjs` with a new snapshot file.
- `/research/embed/<chart>/`: embeddable charts that link back to the source page.
- `/research/data/skipful-hotel-creator-stats.csv`: aggregate data download.

We publish **shares only**, never volume trends: collection coverage changed over time (for example, far fewer collabs per month were captured in 2026 than in 2025), so month-to-month counts reflect our pipeline, not the market.

`RESEARCH_URL` (repo variable) sets canonical URLs. Leave it unset for `https://guides.skipful.com/research`; set it to `https://www.skipful.com/research` once Cloudflare serves the pages there.

Local preview with the real snapshot: `RESEARCH_DATA=data/research/2026-11-small-creator-advantage.json node build.mjs`

### Monthly autopilot

1. On the 1st of each month, the **Research snapshot** GitHub Action saves `data/research/snapshots/YYYY-MM.json` from Xano. You can also run it by hand from the Actions tab.
2. Later that day, a scheduled Claude task drafts the next report from `data/research/REPORT_PLAN.md`. It adds a frozen copy of the snapshot plus an entry in `REPORTS`, then opens a PR with a preview, a press-pitch draft and social posts.
3. Review and merge, and the report is live. Nothing publishes without a merge.

### Serving research at skipful.com/research/

`cloudflare/skipful-apex-worker.js` runs on the route `skipful.com/*`. It serves `/research/...` from this site and 301-redirects every other path to the same path on `www.skipful.com`. `www.skipful.com` is untouched: it stays DNS-only to WeWeb's hosting. Once the Worker is live, set the repo variable `RESEARCH_URL=https://skipful.com/research`, so canonical links, guide footers and the research sitemap (`/research/sitemap.xml`) use that address.
