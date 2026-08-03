# Research: auto-fetching a club's registered teams (prefill team dropdown)

Researched 2026-08-03 (chat C). Question: where can the app dependably fetch ALL teams
of a given Dutch amateur club (JO/MO youth, seniors, reserves, 35+/45+, futsal) to
prefill a team dropdown - with a manual "add team" always available (e.g. 45+ teams
that are real teams but not registered in competition)?

## Hard requirements (Vince, 2026-08-03)

1. **No paid services.**
2. **No club-blockable dependencies.** The app serves parents/coaches; working with the
   club matters, but if a club does not want the app and the parents/coaches do, the
   club must not be able to block it. Club-granted access may only ever be optional
   enrichment.
3. Manual "add team" remains available regardless of any automation.

## Bottom line

**A fully automated, club-independent, free fetch of the complete team list is not
possible from any source found.** The complete roster exists in exactly one place -
Sportlink (the KNVB's member administration) - and every path to it is either paid and
club-controlled (Club.Dataservice) or behind a login wall (voetbal.nl). All public
aggregators carry first teams only.

Recommended design instead (see sketch below): a **convention-based team picker**
(KNVB team-naming patterns generate the dropdown; no external dependency at all) with
manual add as the floor, optionally enriched by public sources for club identity
(name/KNVB-code search) and by Sportlink IF a club volunteers its key (never required).

## What was actually observed (all probed 2026-08-03)

### voetbal.nl - gated anonymously, and PROHIBITED when logged in

- URL shape `voetbal.nl/club/<KNVB-relatiecode>/teams` (relatiecode like `BBDX83U` is
  stable and KNVB-issued).
- Observed: `302 -> voetbal.nl/inloggen` for club/team pages, identical with Chrome UA
  and Googlebot UA - an unconditional login gate, not bot detection.
- **Logged-in route investigated separately (2026-08-03).** Registration IS free and
  open to anyone (email + password only, no KNVB relation, no captcha rendered), and the
  login is a plain Drupal form POST - no OIDC, no 2FA. Two community scrapers are alive
  in 2026 (jongep86/voetbalnl-scraper, timdows/mmm-voetbal-nl), so it is technically easy.
- **But the voetbal.nl gebruikersvoorwaarden (Article 2) prohibit exactly this**, in
  three separate bullets: an account may only be created *for yourself*; accounts may not
  be shared with, created for, or **used by others**; and you may not use
  "software, apparaten, scripts, robots [...] om Voetbal.nl accounts, profielen en
  andere gegevens [...] te scrapen", explicitly including "of handmatige activiteit".
  Article 4 lets KNVB/VM terminate accounts **without notice**; Article 6 puts the legal
  indemnity on the user.
- Failure mode is therefore not "our server gets a 403" but "**our users lose their KNVB
  account**" - the same account they need for KNVB Wedstrijdzaken. For an app aimed at
  parents and coaches that is not a shippable risk. Also: no existing project scrapes a
  club-teams LIST (all are keyed on a team ID you already know), and member visibility
  settings ("Afgeschermd") mean a scraped roster can be substantially redacted anyway.
- **Verdict: rejected on terms, not on feasibility.**
- Source: https://www.voetbal.nl/gebruikersvoorwaarden-voetbal.nl

### hollandsevelden.nl - useful supplement, structurally incomplete

- `clubs/<letter>/<slug>/` pages are server-rendered and fetch fine with a plain curl
  UA (observed 200, full HTML; their robots.txt allows crawling and even flags
  `ai-input=yes`). Page shows the KNVB relatiecode.
- But: first teams in standard competitions ONLY - by their own stated scope. No youth,
  reserves, 35+/45+ or futsal, and no team-level pages in the sitemap. Can never fill
  the dropdown; CAN power club search/autocomplete (name -> KNVB code) and first-team
  fixtures. Caveat: some IP-level filtering observed (403 to one proxy, 200 direct).

### Sportlink Club.Dataservice (data.sportlink.com) - canonical but doubly excluded

- Live-probed: `/list` 200 (catalogue incl. `teams`, `team-gegevens`, `clubgegevens`),
  `/teams` 401 without key. The `teams` article returns exactly the right shape
  (`teamnaam`, `leeftijdscategorie`, `geslacht`, `speeldag`, `poulecode`, ...).
- Access: only a club admin can order it in the Sportlink Club Shop (EUR 125 one-time +
  EUR 1.10/member/year, 2025/2026 pricing) and read the ClientID.
- Excluded by BOTH hard requirements (paid, club-controlled). Permitted role: if a club
  volunteers its ClientID, use it as optional enrichment; the app must never require it.

### Dead ends (verified)

- KNVB Dataservice: discontinued 1 July 2017 (successor = Club.Dataservice).
- Voetbal Datacentre (api.knvbdatacentre.nl): business-contract-only; their own site
  points amateur clubs to Club.Dataservice.
- amateurvoetbal.nl: parked domain, for sale.
- Regional sites (voetbalrotterdam.nl etc.) and stats sites (voetbal.com,
  Transfermarkt): first teams only.
- Clubs' own websites: heterogeneous (WordPress/voetbalassist/custom), no generic parser
  possible.

## Recommended implementation (no external dependency for the core)

**Convention-based team picker.** KNVB team names follow tight conventions, so the
dropdown can be GENERATED instead of fetched:

- Youth: `JO7` .. `JO19` and `MO7` .. `MO20` (steps of 1 age year, KNVB uses odd
  categories primarily: JO8-JO19), each with index suffix `-1`, `-2`, ...
- Seniors: `1`, `2`, `3`, ... (zondag/zaterdag), `VR1` (vrouwen), `35+`, `45+`,
  futsal (`ZA 1`).

UI sketch: two-step picker - category dropdown (JO11, MO15, Senioren zaterdag, 45+, ...)
then team number - producing standard names like `JO11-3`; plus the free-text manual
"add team" for anything else. Zero scraping, zero blockable dependency, works for every
club including teams never registered in competition (the 45+ case).

Optional enrichment layers (later, never load-bearing):

1. **Club identity search** at onboarding: scrape hollandsevelden.nl club pages (or a
   one-time imported KNVB club list) for club name -> KNVB relatiecode + main colors;
   purely cosmetic/bootstrap.
2. **Sportlink ClientID (volunteered)**: if a club shares its Club.Dataservice key, call
   `data.sportlink.com/teams?client_id=...` to prefill/refresh the real registered team
   list. Feature-flag it; absence changes nothing.
3. The F28 speeldagenkalender machinery already covers competition rhythm without
   needing per-team competition data.

## Sources

Sportlink product/pricing: https://www.sportlink.nl/producten/club-dataservice/ ·
articles list: https://sportlinkservices.freshdesk.com/nl/support/solutions/articles/9000062942-lijst-met-artikelen-van-club-dataservice ·
access process: https://sportlinkservices.freshdesk.com/nl/support/solutions/articles/9000062940-voordat-je-club-dataservice-aanschaft ·
KNVB Dataservice stop: https://sportlinkservices.freshdesk.com/nl/support/solutions/articles/9000111338-de-knvb-dataservice-stopt-wat-nu- ·
Voetbal Datacentre: https://voetbaldatacentre.nl/ and https://api.knvbdatacentre.nl/hoofdstuk/teams ·
hollandsevelden API/scope: https://www.hollandsevelden.nl/en/api/ ·
community wrappers (shape evidence): https://github.com/PendoNL/php-club-dataservice ·
live probes: data.sportlink.com `/list` (200) + `/teams` (401 code 4012);
voetbal.nl club pages (302 -> /inloggen, all UAs); hollandsevelden.nl club page (200,
server-rendered, first team only); amateurvoetbal.nl (parked).
