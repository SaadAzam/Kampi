# Client decisions required

Unresolved product and technical decisions for Kampi.fun beyond this foundation:

1. **First production game** — Confirm Rock Paper Scissors as launch title.
2. **Game rules & economy** — Final entry fees, payouts, house edge, starting balance.
3. **Branding & design** — Logo, colour system, typography, game art, audio.
4. **Authentication** — Email/password is implemented for this phase; OAuth/phone OTP and production guest policy are still open.
5. **Payment provider** — Stripe vs mobile IAP vs both; regional pricing.
6. **Launch regions** — Countries/states; geo restrictions for virtual chips.
7. **Expected concurrency** — Peak CCU for realtime scaling and Redis/Colyseus sizing.
8. **Analytics provider** — Product analytics, funnel tracking, error reporting.
9. **Moderation** — Chat/reporting needs (if social features added).
10. **Native store release** — Capacitor/React Native timeline, App Store / Play policies.
11. **Leaderboard design** — Periods, anti-cheat, reset policy.
12. **Bot difficulty** — Random vs skill-matched bots for retention.
13. **Anti-fraud** — Multi-accounting, collusion detection for ranked play.
14. **Support tooling** — CS workflows for refunds/disputes (virtual chips).

Decisions should be recorded as ADRs in `docs/adr/` once confirmed.
