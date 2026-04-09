# College Manager — Project State
Last updated: April 8, 2026 by Codex (GPT-5)

## Current Phase
V1 — Day 3 complete (Day 4 next)

## What Works (verified manually)
- [x] SQLite schema created and migrations run
- [x] iCal poller fetches and parses Canvas feed correctly
- [x] iCal poller detects new assignments vs DB
- [x] Google Calendar OAuth refresh token obtained
- [x] createCalendarEvent works end-to-end
- [x] Daily digest generates correctly via LLM
- [x] Query handler responds to all 4 query types
- [ ] OpenClaw heartbeat fires and notifies on new assignments

## Current File States
| File | Status | Notes |
|------|--------|-------|
| src/db.ts | ✅ Implemented | Schema + upserts + query helpers + digest insert helper |
| src/icalPoller.ts | ✅ Implemented | iCal fetch/parse/poll with all-day assignment normalization to 11:59 PM local |
| src/calendarSync.ts | ✅ Implemented | Create/update/delete + sync + reconcile pass for existing Google events |
| src/digest.ts | ✅ Implemented | Daily/weekly digest generation with DB persistence |
| src/queryHandler.ts | ✅ Implemented | 4 core query intents + LLM path + deterministic fallback |
| src/llm.ts | ✅ Implemented | Shared OpenAI/Anthropic wrapper; supports OPENAI_BASE_URL (Groq compatible) |
| src/notifier.ts | ❌ Not started | Day 4 task |
| src/index.ts | ❌ Not started | Day 4 task |
| src/types.ts | ✅ Implemented | Shared interfaces including AssignmentWithCourse |
| HEARTBEAT.md | ❌ Not started | Day 4 task |
| SKILLS.md | ❌ Not started | Day 4 task |
| scripts/getRefreshToken.ts | ✅ Implemented | One-time OAuth flow for GOOGLE_REFRESH_TOKEN |
| package.json | ✅ Implemented | TS scripts + dependencies + google:token script |
| tsconfig.json | ✅ Implemented | Strict TS build config |

## Known Issues / Blockers
- No active blockers.
- Dependency note: `better-sqlite3` was upgraded from `^9.4.0` (design doc) to `^12.0.0` for compatibility with local Node `v25.1.0`.
- Timezone behavior note: Canvas all-day assignments are normalized to 11:59 PM local (via iCal exclusive end-date); if desired, this can be made configurable later.

## Environment
- Node version: 25.1.0
- npm version: 11.6.2
- DB file path: `./data/college_manager.db`
- Canvas iCal URL: set in `.env` as `CANVAS_ICAL_URL`
- Google OAuth credentials: set in `.env`
- GOOGLE_REFRESH_TOKEN: obtained and set
- Calendar sync state: all known assignments reconciled to Google Calendar (`updated: 45`)
- LLM path tested with Groq via OpenAI-compatible endpoint (`OPENAI_BASE_URL=https://api.groq.com/openai/v1`)

## Next Task
Begin Day 4: implement OpenClaw wiring by creating `HEARTBEAT.md` and `SKILLS.md`, implement `src/notifier.ts`, implement `src/index.ts` heartbeat orchestration (poll Canvas -> sync calendar -> notify -> digest checks), and run an end-to-end manual heartbeat test.
