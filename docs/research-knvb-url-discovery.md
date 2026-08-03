# Research: KNVB speeldagenkalender URL discovery (F28 follow-up)

Researched 2026-08-03 (chat C). Question: can the app discover next season's six
speeldagenkalender PDF URLs automatically instead of hardcoding them in `KNVB_SOURCES`
(`app/server/services/speeldagen.ts`)?

## Verdict

**Scrape the stable landing page; keep hardcoded sources as seed/fallback; let the
instance admin confirm discovered links before they replace configured ones.**
Pattern substitution is a dead end - both the numeric asset ID and the slug change
unpredictably each season, and even the SET of region PDFs changes.

## Evidence

### Current pattern

All six hardcoded URLs follow
`https://www.knvb.nl/downloads/sites/bestand/knvb/<numeric-asset-id>/<slug>`
(IDs 29859-29864 for 2026/'27). The ID is a CMS file ID, not derivable from season
or region.

### Landing page (the discovery source)

`https://www.knvb.nl/assist-wedstrijdsecretarissen/veldvoetbal/seizoensplanning/speeldagenkalenders`

- Server-rendered: all six 2026/'27 hrefs are present in the initial HTML; verified with
  a plain curl (default UA, no cookies, no JS) - a Node `fetch` will see them.
- Extraction is one regex over the HTML (`href` containing `speeldagenkalender` under
  `/downloads/sites/bestand/`).
- The KNVB season-announcement news articles link TO this page and state the latest
  revisions are always posted there.
- Beware the similarly named `knvb.nl/assist/assist-wedstrijdzaken/speeldagenkalender`
  page: no download links (was in maintenance mode when fetched); the
  assist-wedstrijdsecretarissen URL above is the real one.

### Year-over-year stability (Wayback Machine, three seasons)

- 2024/'25: IDs 28351-28354 + 28385; slugs like `speeldagenkalender-veld-noordoost-2024-2025`
  and `speeldagenkalender-landelijke-jeugdcompetities-2024-2025`; 5 PDFs.
- 2025/'26: IDs 29142-29145 + 29396 (jeugd published later, non-contiguous); region slug
  became `noord-oost`; jeugd slug became `speeldagenkalender-veld-landelijk-jeugd-...`; 5 PDFs.
- 2026/'27: IDs 29859-29864; `noord-oost` split into separate `noord` + `oost`; 6 PDFs.
- **The landing-page URL itself is identical across all snapshots (Sept 2024 - Jul 2026).**

So: IDs unpredictable, slugs unstable, region set changes - but the page to scrape is stable.

### Access constraints

- `knvb.nl/robots.txt` returns 403 (verified via three clients) = no published policy;
  under RFC 9309 a 4xx robots.txt means no restrictions.
- The 403 is path-specific, not a WAF: landing page and PDFs (verified with a Range
  request) are served fine to a default curl UA; the app's existing `defaultPdfLoader`
  already fetches the PDFs server-side.
- KNVB site terms of use re automated retrieval: UNVERIFIED (not reviewed). Practical
  risk is low - this is the official publication channel, and we fetch six small PDFs on
  an admin-triggered action, not a crawl.

## Implementation sketch (when picked up)

1. `discoverKnvbSources()` in `app/server/services/speeldagen.ts` (or
   `app/server/utils/knvb-discover.ts`): fetch the landing page (injectable loader like
   `defaultPdfLoader`), regex out the `speeldagenkalender` hrefs, absolutize against
   `https://www.knvb.nl`, parse season (`YYYY-YYYY` slug suffix) and keep the newest.
2. Tolerant slug -> region mapping, most-specific first: `landelijk-jeugd`/`jeugd`, then
   `noord-oost|noordoost`, then `noord`, `oost`, `west`, `zuid`, plain `landelijk` last.
3. Admin flow ("Bronnen vernieuwen" in Beheer > Systeem): show discovered vs configured
   URLs; admin confirms before persisting (settings table; `KNVB_SOURCES` stays the
   seed/fallback). Fits the F28 pending/activate lifecycle style.
4. Explicitly handle unmapped sources (a future `noord-oost` merge, a new region, a
   renamed jeugd slug) as "choose region" prompts instead of errors - history shows this
   WILL happen.
5. Tests: fixture HTML of the current landing page + a synthetic 2025/'26-style fixture
   (combined region, different jeugd slug) to lock in tolerant mapping.

## Sources

- Landing page: https://www.knvb.nl/assist-wedstrijdsecretarissen/veldvoetbal/seizoensplanning/speeldagenkalenders
- KNVB news 70078: https://www.knvb.nl/nieuws/assist-wedstrijdsecretarissen/assist-wedstrijdsecretarissen/70078/speeldagenkalenders
- Wayback 2024-09-23: http://web.archive.org/web/20240923055552/https://www.knvb.nl/assist-wedstrijdsecretarissen/veldvoetbal/seizoensplanning/speeldagenkalenders
- Wayback 2025-06-24: http://web.archive.org/web/20250624095306/https://www.knvb.nl/assist-wedstrijdsecretarissen/veldvoetbal/seizoensplanning/speeldagenkalenders
