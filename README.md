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
