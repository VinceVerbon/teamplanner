# Research: production email delivery (feeds F9/F16/F18)

Researched 2026-08-03 (chat C). Question: which outbound email route should teamplanner
use in production? The app already abstracts sending behind `app/server/utils/mailer.ts`
(nodemailer over `SMTP_HOST/PORT/SECURE/USER/PASS` + `MAIL_FROM`; unset host = dev capture),
so this is purely an ops/provider decision - no code change needed beyond env vars.

Context: one club, ~50-500 mails/month initially (invitations, reminders, pre-match
mails), maybe a few thousand later; self-hosted Docker on dexter.syquens.com; own DNS;
no-lock-in preference.

## Decision (Vince, 2026-08-03)

**MVP: send via a plain Gmail account** (`smtp.gmail.com` + app password). Accepted
trade-offs at MVP volume: mail goes out as the gmail.com address (From is rewritten by
Google), 500 recipients/day cap, ~20/hour observed rate limit. **Hosted/production
setting: switch to a domain-registered sender** - the ranking below (SMTP2GO first) is
the standing recommendation for that moment; revisit pricing then.

MVP env settings (values via 1Password, never committed):

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false          # STARTTLS on 587
SMTP_USER=<gmail address>
SMTP_PASS=<app password>   # requires 2FA on the account; store in 1Password
MAIL_FROM=<gmail address>  # Google rewrites From to the authenticated account anyway
```

No code change needed - `mailer.ts` already speaks SMTP via these env vars.

## Verdict

**Hybrid: self-hosted app relaying through a SaaS SMTP provider.** Direct self-hosted
outbound SMTP is an unwinnable IP-reputation game at this volume (VPS ranges pre-listed
on blocklists, port 25 commonly blocked, and 500/month is far too little traffic to warm
an IP). Because nodemailer already speaks SMTP, every provider below is swappable in
minutes by changing four env vars - that IS the no-lock-in property.

Ranked recommendation:

1. **SMTP2GO** - best overall fit. Free tier 1,000/mo (200/day cap), no credit card, no
   expiry; SMTP-first product; genuine EU data residency (Amsterdam DC, auto-assigned for
   EU signups). Paid entry $10/mo for 10k. Gotcha: 25/hour limit until the sender domain
   is verified.
2. **Scaleway TEM** - best EU-sovereignty pick, cheapest at scale. 300/mo free, then
   EUR 0.25 per 1,000 with no monthly fee (a few thousand mails/month costs under EUR 1).
   Second only because the free tier is tighter than expected volume and its
   deliverability track record is shorter.
3. **Resend** - best DX, biggest relevant free tier (3,000/mo, 100/day cap), SMTP relay on
   the free plan. Third because only the sending region is EU (account data/logs stay in
   the US) and the 100/day cap could pinch a club-wide match-day blast.

## SaaS comparison (pricing verified on provider pages 2026-08-03)

| Provider | Free tier | Paid entry | SMTP | EU residency | Gotchas |
|---|---|---|---|---|---|
| SMTP2GO | 1,000/mo, 200/day, no CC, no expiry | $10/mo / 10k | Yes | Yes (Amsterdam DC) | 25/hr until domain verified; USD billing |
| Scaleway TEM | 300/mo, no expiry | EUR 0.25/1k pay-as-you-go | Yes | Yes (French/EU) | Domain must pass SPF/DKIM/DMARC before sending |
| Resend | 3,000/mo, 100/day, 1 domain | Pro $20/mo / 50k | Yes | Sending region only (eu-west-1); data in US | Region != residency |
| Mailgun | 100/day forever | Basic $15/mo / 10k | Yes | Yes (selectable region) | Per-day cap; historic trial-expiry surprises; Sinch-owned |
| Postmark | 100/mo, never expires | Basic $15/mo / 10k | Yes | No (US only) | Free tier too small here; strict transactional review; superb deliverability |
| Brevo | 300/day, no expiry | Starter ~$9/mo (UNVERIFIED exact 2026 price) | Yes | Yes (French/EU) | SMTP needs manual support activation (1-2 business days) |
| Amazon SES | New accounts: $200 credits 6-12 mo (old 3k/mo tier gone) | $0.16/1k pay-as-you-go | Yes | Yes (EU regions) | Sandbox exit via support request (1-3 days, can be rejected); AWS overhead |
| Mailtrap Sending | 4,000/mo, 150/day | Basic $15/mo / 10k | Yes | Not selectable | Sending product is young; 3-day log retention on free |

SaaS advisory disclosures: SMTP2GO/Resend/Scaleway/Mailtrap free tiers are permanent
(no trial expiry); Mailgun and SES are the ones with expiry/credit mechanics; none of
the top-3 require a credit card to start; identity lock-in is nil since only SMTP
credentials + DNS records (SPF/DKIM) bind us, and those are re-issued per provider.

## What about Gmail as the sender?

Two distinct variants, both work with the existing nodemailer/SMTP abstraction:

- **Personal gmail.com + app password** (`smtp.gmail.com:587`, requires 2FA + app
  password): 500 recipients/day, ~20/hour observed rate limit, 10 concurrent sessions.
  Disqualifying for production: mail goes out as `...@gmail.com` (Gmail rewrites the
  From header to the authenticated account), so no club-domain sender, no SPF/DKIM
  alignment on our own domain, and consumer accounts get temporarily locked when
  automated sending trips quota ("Daily sending quota exceeded"). Fine as a personal
  hack, not for the app.
- **Google Workspace SMTP relay** (`smtp-relay.gmail.com`): the legitimate variant -
  10,000 recipients/user/day, 100 recipients per SMTP transaction, custom domain with
  proper SPF/DKIM, designed for applications/transactional mail. Requirement: a paid
  Google Workspace subscription on the sending domain, plus relay configuration in the
  admin console. **If the sending domain already has Workspace, this is a credible
  top-3 option at zero marginal cost.** If not, a Workspace seat exists solely to relay
  mail, which is more expensive and more lock-in than any provider above - so it did
  not make the ranking on its own merits.

Sources: https://serversmtp.com/limits-of-gmail-smtp-server/ ·
https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace ·
https://knowledge.workspace.google.com/admin/gmail/advanced/route-outgoing-smtp-relay-messages-through-google

## Self-hosted options (for the record)

Mailu / poste.io / Maddy / Stalwart all run fine in Docker (Stalwart is the strongest
2026 choice if inbound mailboxes are ever wanted), but 2026 consensus is unanimous:
relay outbound through a SaaS unless you already have established IP reputation.
Blockers: VPS IP ranges pre-listed on spam blocklists; port 25 outbound blocked by
default at most providers (Hetzner a notable exception); Gmail/Outlook throttle unknown
new IPs; at 500/mo the volume can never warm an IP.

## Mailbox-provider requirements (as of 2026, sender < 5,000/day - we are 10-100x under)

- **Gmail** (support.google.com/a/answer/81126): required = SPF **or** DKIM, valid
  forward + reverse DNS, TLS, spam rate < 0.3%. DMARC, alignment and one-click
  unsubscribe only kick in at 5k+/day, and the unsubscribe rule exempts transactional mail.
- **Yahoo**: mirrors Gmail (joint Feb 2024 rollout).
- **Microsoft Outlook.com**: since May 2025 enforces SPF+DKIM+DMARC(p=none, aligned) for
  5k+/day senders; rejects non-compliant bulk mail (550 5.7.15).
- **Baseline for us regardless**: set SPF + DKIM + DMARC p=none at domain verification
  anyway (provider hands us the records, DNS is ours) - future-proof and better inboxing.
  When F16 reminder volume grows, adding a List-Unsubscribe header is cheap insurance,
  not yet mandatory.

## Action items

MVP (decision above):
- [ ] Pick/create the Gmail account to send from; enable 2FA; generate an app password.
- [ ] Store the app password in 1Password; set the six SMTP env vars (block above).

Hosted/production (later, at F18 deploy):
- [ ] Pick provider (standing recommendation: SMTP2GO).
- [ ] Create account + verify sending domain (SPF/DKIM records in DNS; add DMARC p=none).
- [ ] Store SMTP credentials in 1Password (item reference in deploy docs, never values).
- [ ] Set `SMTP_HOST/PORT/SECURE/USER/PASS/MAIL_FROM` in the F18 deploy stack env.

## Sources

- https://www.smtp2go.com/pricing/ and https://support.smtp2go.com/hc/en-gb/articles/12974008254873-EU-Data-Center
- https://www.scaleway.com/en/pricing/managed-services/ and https://www.scaleway.com/en/docs/transactional-email/faq/
- https://resend.com/pricing and https://resend.com/docs/dashboard/domains/regions
- https://www.mailgun.com/pricing/ · https://postmarkapp.com/pricing · https://aws.amazon.com/ses/pricing/ · https://mailtrap.io/pricing/
- Brevo: https://www.emailtooltester.com/en/reviews/brevo/pricing/ (official page unreadable; Starter price UNVERIFIED) and https://help.mailreach.co/en/article/how-to-get-your-brevo-formerly-sendinblue-smtp-account-activated-1v0cj4y/
- Gmail: https://support.google.com/a/answer/81126
- Microsoft: https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730
- Yahoo/joint: https://www.courier.com/blog/email-sender-requirements and https://powerdmarc.com/bulk-email-sender-requirements/
- Self-hosted deliverability: https://mailflowauthority.com/self-hosted-smtp/best-vps-email-server · https://webshanks.com/vps-with-open-port-25/ · https://profor.pro/blog/self-hosted-email-2026-mailcow-stalwart-mailu/
