# Akhil's Preferences

## Communication Style
- Prefers concise responses — short, direct, no padding

---

# LoyaltyPay — Product Memory

## What is it
LoyaltyPay is a hotel loyalty programme management console built by A3 Rocket Consulting. It's a SaaS operator dashboard that helps hotels run, optimise, and make intelligent decisions about their loyalty programme. Target markets: GCC, UK, Southeast Asia, Europe. India is permanently OUT of ICP.

## The file
Single-file HTML prototype: `/Users/akhils/claude/a3-loyalty-warm.html` (~765KB, ~11,400 lines)
- Custom SVG chart renderers (`_svgLine`, `_svgBar`, `_svgDonut`) — NOT Chart.js
- `RENDERERS.screenname` pattern for every screen
- `AFTER_RENDER.screenname` for post-render callbacks
- `state` object — all app data, persisted via localStorage
- `go(screen)` — navigation
- `mkChart(id, cfg)` — routes to SVG renderers
- `DAILY` — 90-day points data array
- `persistState()` / `loadPersistedState()` — localStorage save/load

## What's built (23 screens)
Dashboard, Guests, Loyalty Model, Points & Tiers, Earn Rules (+ rate-code suppression), Earn Rate Optimiser, Seasonal Earn Calendar, Segment × Demand Earn Matrix, Tier Restructure Simulator, Redemption, Data Upload, Campaigns, Analytics, **Message Templates** (rebuilt — see below), Lifecycle Flows, ROI Planner, Financials, Predictions, Notifications, Settings, Billing, AI Strategy Advisor (slide-out panel), **Programme Intelligence Centre** (3-tab screen)

## Guest Communication Templates — REBUILT (screen id: `templates`)
- **34 templates** across 9 lifecycle stages: pre-arrival, welcome, in-stay, post-stay, tier & points, win-back, milestones, seasonal, ancillary
- **3 tabs**: Template Library (filterable grid) | Performance (ranked table + benchmarks + best send times) | Journey Map (lifecycle coverage visual, gap detection)
- Each template has: `id, name, cat, ch, tone, emailSubject, opens, replies, conv, sends, body`
- Channel filter: All / WhatsApp / Email. Search bar. Category tab filter with counts.
- **Preview modal**: WhatsApp phone bubble + Email inbox mock with merge vars filled from live state
- **Editor**: click-to-insert 23 variable chips, email subject toggles on/off by channel
- **Journey Map**: visual stage tiles (coverage %, red dot on gaps), drill-down cards per stage
- **Performance tab**: ranked table, industry benchmark comparison (GCC data), best send time bars
- **✨ AI Generate**: calls Claude Haiku with hotel/programme context, drops output into editor
- `_tmplTab` (library/performance/journey), `_tmplFilter` (category), `_tmplChFilter`, `_tmplSearch`
- Functions: `tmplPreview(id)`, `tmplEdit(id)`, `tmplClone(id)`, `tmplUseInCampaign(id)`, `tmplNew()`, `tmplAIGenerate()`, `tmplAIExec(prompt,ch,tone)`
- `tmplUseInCampaign` sets `_campData.message`, `_campData.templateId`, `_campStep=3`, routes to Campaign Builder

## Earn intelligence suite (recently built)
- **Earn Rules** — base rates per category, behavior bonuses, group multipliers, occupancy dynamic engine, tier multipliers, rate-code suppression (Section F)
- **Earn Rate Optimiser** — ROI per category, suppression recommendations, one-click apply
- **Seasonal Earn Calendar** — 12-month grid, per-month multiplier (Peak 0.5×, Standard 1×, Shoulder 1.5×, Dead 2×), paint-brush UI, regional templates
- **Segment × Demand Earn Matrix** — 7 segments × 4 demand periods, editable per cell, colour-coded, intervention ROI stack

## The one real API
`https://api.anthropic.com/v1/messages` — Claude Haiku, streaming, powers AI Strategy Advisor. Hotel must supply their own Anthropic API key. PMS endpoints (Mews, Cloudbeds, Apaleo) are UI-only — no real calls fire.

## AI Strategy Advisor vs Programme Intelligence Centre
- **AI Strategy Advisor** (built): Reactive slide-out chat panel. Hotel asks a question, Claude answers with programme context. Screen-aware, suggested chips.
- **Programme Intelligence Centre** (BUILT — screen id: `intelligence`): 3-tab proactive dashboard. Tab 1: Intelligence Dashboard (6 vital signs + ranked intervention stack with AED expected values). Tab 2: Event & Demand Radar (90-day forward calendar, F1/GITEX/GCC holidays, earn recommendations per week). Tab 3: Programme Trajectory (H1/H2/H3 horizons, member growth + revenue contribution sparklines, tier health waterfall, Cost of Inaction counterfactual). `state.intelligenceTab` controls active tab.

---

# Programme Intelligence Centre — Design

## The core idea
Value leak detector with a prescription engine. Every insight has a dollar number. Every recommendation has a cost-of-inaction.

## Three screens to build
1. **Intelligence Dashboard** — 6 vital signs (redemption rate, OTA displacement, member vs non-member ADR premium, tier advancement rate, Platinum churn rate, programme ROI multiple). Ranked intervention stack with expected value per action.
2. **Event & Demand Radar** — forward 90-day calendar. External events (F1, concerts, holidays, Eid, Ramadan), booking pace vs prior year, recommended earn adjustments per week.
3. **Programme Trajectory** — Horizon 3 view. Lifetime value trends, tier health waterfall, where programme will be in 12 months if current trends hold.

## McKinsey frameworks baked in
- **3 Horizons**: H1 = now (0–7 days operational), H2 = tactical (8–90 days), H3 = strategic (90 days+)
- **Loyalty Value Waterfall**: Total rev → loyalty member rev → baseline → incremental → OTA displacement + frequency lift + ancillary uplift + tier pull → net ROI minus liability
- **Guest Portfolio Matrix**: Champions (high freq, high rev), Growers (high rev, low freq), Actives (high freq, low rev), Sleepers (low/low)
- **Intervention ROI Stack**: Every action ranked by cost × probability × expected revenue value
- **Early Warning Radar**: 6 vital signs, threshold-based, red/amber/green
- **Counterfactual Engine**: "If you don't act, here's what happens" — cost of inaction framing

## Event intelligence layer
External events cause demand spikes (suppress earn) or demand collapse (push earn). Sources: F1 calendar, Ticketmaster, national holiday APIs, local tourism board feeds. Cross-referenced with hotel's market (GCC vs UK vs SE Asia — different calendars). Nobody in market connects revenue management demand signals to the loyalty earn engine. This is LoyaltyPay's differentiation.

## Pitch line
"LoyaltyPay doesn't just run your loyalty programme. It watches your market and tells you when to be generous and when to stop."

---

# Production Readiness Gaps

## Login page — COMPLETE (frontend)
Split-screen: left dark navy panel (logo, word rotator, value props, social proof), right parchment panel (Sign In / New Property tabs).
- **Sign In**: email + password fields, demo role selector, demo credentials accordion, loading spinner on submit, field validation, "New property? Set up free →" link. Password field accepts any input in demo mode.
- **New Property**: property name + email + type fields, validation on all 3, seeds `state.hotel.name` / `state.hotel.type` / `state.programName`, 3-step indicator, "Already have an account?" link back to Sign In.
- Word rotator: "hotels" → resorts → boutique properties → golf resorts → spa retreats → city hotels → resort groups → apart-hotels (2.2s interval, CSS slide animation)
- Mobile: left panel hidden ≤900px, right panel gets gradient background
- Backend auth (#36) still pending — any email/password combo works in demo

## Product gaps (features to build)
| # | Feature | Priority |
|---|---|---|
| 30 | ~~Programme Intelligence Centre~~ | ✅ BUILT |
| 31 | ~~Campaign Builder end-to-end~~ | ✅ BUILT |
| 32 | ~~Guest Communication Templates library~~ | ✅ BUILT |
| 33 | ~~Points Redemption Management (front desk flow)~~ | ✅ BUILT |
| 34 | ~~Login page redesign~~ | ✅ COMPLETE |
| 35 | ~~Mobile-responsive polish~~ | ✅ BUILT |
| 47 | Group Owner cross-property reporting (deeper) | MEDIUM |

## Architecture (confirmed)
- **PMS** — READ ONLY. Aisency handles PMS connectors (Mews, Cloudbeds, Apaleo). They pipe guest data, booking data, rate codes INTO LoyaltyPay's database. LoyaltyPay never writes back to PMS.
- **WhatsApp** — A3 owns a WhatsApp Business API account. All campaign messages sent directly from LoyaltyPay dashboard via our own WA API. No third-party like 360dialog needed.
- **Email** — Same: LoyaltyPay sends directly. Campaigns run from the dashboard.
- **Campaign execution** — 100% LoyaltyPay owned. We build the campaign builder, templates, scheduling, send logic. Aisency just feeds us the guest data.
- **Plug & play contract** — Build the frontend + backend first with clean data contracts (guest schema, booking schema, send API shape). Aisency plugs their PMS connectors into those contracts. No rebuild needed.

## Infrastructure gaps (makes it a real product)
| # | Feature | Priority |
|---|---|---|
| 36 | Real authentication (accounts, sessions, JWT) | CRITICAL |
| 37 | Real database (PostgreSQL/Supabase, multi-tenant) | CRITICAL |
| 38 | PMS data intake — Aisency provides connectors, we define schema | CRITICAL |
| 39 | WhatsApp sending — our own WA Business API | CRITICAL |
| 39b | Email sending — our own delivery (SendGrid or similar) | HIGH |
| 40 | Stripe billing live | HIGH |
| 41 | GDPR/PDPA compliance (PII, DPA, consent) | HIGH |
| 42 | Security audit + hardening | HIGH |
| 43 | Multi-tenancy architecture | HIGH |
| 44 | Deploy live at app.loyaltypay.com | HIGH |

## Go-to-market gates
| # | Item | Note |
|---|---|---|
| 45 | Sales demo environment | Pre-loaded fictional GCC hotel, all screens working |
| 46 | First pilot hotel | Free in exchange for case study — proof point |

## Recommended build order
- **Now**: ~~Campaign Builder (#31)~~ ✅, ~~Templates (#32)~~ ✅, ~~Redemption (#33)~~ ✅, ~~Mobile (#35)~~ ✅ — **frontend is complete**
- **Month 2**: Auth (#36), database (#37), multi-tenancy (#43), deploy (#44)
- **Month 3**: WA Business API wiring (#39), email delivery (#39b), define PMS schema for Aisency (#38)
- **Month 4**: Stripe (#40), GDPR (#41), security (#42), pilot hotel (#46)

## Biggest risk
Frontend is the demo asset — must be complete before any hotel meeting. Backend (auth + DB) must be built before Aisency can plug in. The data contract (what fields LoyaltyPay expects from PMS) needs to be agreed with Aisency early so there are no surprises.

---

# A3 Constraints (permanent)
- India permanently OUT of ICP — never mention as target market
- For ALL A3 work: NEVER create files (.docx, .pdf, .xlsx, .pptx). Always write deliverables as plain text in chat.
- Target markets: GCC, UK, Southeast Asia, Europe only
