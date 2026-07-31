# Changelog

All notable changes to teamplanner are documented here (Keep a Changelog; SemVer).

## [Unreleased]

### Added
- Initial scaffold (interactive-app) on 2026-07-31.
- `docs/FEATURES.md` - feature backlog F1-F19 logged ahead of build (identity and access, club and teams, trainings and schedule, attendance, communication, platform) plus architecture principles and stack decisions.

### Changed
- `docs/FEATURES.md` refined feature by feature with Vince: attendance flipped to an opt-out model with time-classified absence (F13, F14 dropped); parent-player linking with age-based management rules at P1 (F5); matches + Sportlink `.ical` import into MVP (F12, new F21); club branding/theming added (new F20); URL-per-club architecture; two-level no-training periods (F10); transparency of attendance stats to the whole team (F15, P1); Build spec added - every feature ships with a main-flow + edge-case test-set (Vitest/@nuxt/test-utils, Playwright later). First tenant FC Aalsmeer, first team MO17-4.
