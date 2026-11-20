# Skipful Research: report plan

The monthly drafting task reads this file. Edit it to change topics or rules.

## Rules (never break these)

- Byline: **Skipful Research Team**. Never use a person's name or "founder".
- Aggregate only: no hotel names, no creator handles, no individual hotel or creator data. City and country figures only where the sample meets the thresholds in `research.mjs`.
- **Shares, not volume.** Collection coverage changed over time (about 3,500 collabs a month were captured in 2025 versus about 800 a month in 2026), so never report month-to-month counts, growth, "rising cities" or seasonality until the unlock below is met.
- Every number in a report must come from that month's snapshot file. No numbers from memory or outside sources. Round the way `research_pages.mjs` does.
- Check the snapshot against last month's before writing. If a headline share moved more than 5 points, or totals fell, stop and flag it in the PR instead of writing around it.
- Never name a social platform (no Instagram, TikTok, YouTube, Reels, etc.). Say "social media", "posts", "short videos".
- Plain, confident, newsy writing; one headline stat a reporter could quote; no hype words.

## Seasonality and growth unlock

Allowed only once captured collabs per month have stayed within ±20% of their average for 6 straight months. The drafting task checks this each month and notes the status in the PR.

## Topic queue (next one at the top; move it to Done when its PR merges)

1. **Luxury, decoded:** 5-star vs. 4-star vs. 3-star: who they host, median creator size, the share to 100K+, and what smaller creators should pitch first.
2. **Resorts vs. hotels vs. boutique:** follower-size mix by property type. Add a boutique split to `research.mjs` if the sample is big enough (200+ collabs).
3. **The global picture:** country rankings by small-creator share; US vs. international.
4. **Hotels that come back:** repeat hosting, the gap between collabs, and what share of repeat hosts work with creators under 10K.
5. **The follower-size sweet spot:** the 10K–50K middle of the market and where each size band gets the most yeses.
6. **Quarterly City Index** (January, April, July, October; this takes priority in those months): ranked friendliest and toughest cities for creators under 10K, with changes since last quarter as shares only.
7. **Flagship: The State of Hotel × Creator Collabs** (January and July): all of the above in one report.

## Done

- 2026-11-20: The Small-Creator Advantage (`small-creator-advantage`)

## Inbound series (added 2026-11-20)
Done: 2026-11-20 — The Most Creator-Friendly Hotel Cities of 2026 (`creator-friendly-hotel-cities`). Snapshot: data/research/2026-11-creator-friendly-cities.json, computed with `computeCityRanking` in research.mjs (needs every tracked property, not only hotels with collabs). Re-rank each January as "... of 2027".

Done: 2026-11-20 — Independent vs. Branded Hotels (`independent-vs-branded-hotels`). Snapshot: data/research/2026-11-independent-vs-branded.json via `computeChainStudy` + brands.mjs. Hand checks: 99/100 branded tags right; ~1 in 10 "independent" are small regional groups (disclosed). Never compare hosting *rates* between groups (tracking isn't an even sample).

Next, in order:
1. (done above) Independent vs chain hotels. Tag chains by matching hotel names to brand lists (internal only; publish aggregates). Spot-check ~100 tags by hand first. Early read: chains host at a slightly higher rate (12.3% vs 9.7%), but independents are ~70% of hotels that host. Lead with the second point, state the first honestly.
2. Hosted-stay ROI benchmark + calculator. Modeled, not measured: label every assumption.
3. Repeat hosting deep-dive (repeat rates only; no per-year counts until coverage is steady).
4. Seasonality. Blocked until ~March 2027 (needs 12 steady months of collection).
Dropped: "Luxury paradox" — the data shows 5-star hotels do skew to bigger creators. Covered honestly by "Luxury decoded".
