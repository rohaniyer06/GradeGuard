# College Manager

Proactive academic assistant that:
- pulls assignments from Canvas iCal,
- syncs deadlines to Google Calendar,
- sends digest/reminder notifications via OpenClaw channels.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy env template and fill values:
```bash
cp .env.example .env
```

3. Generate Google refresh token once:
```bash
npm run google:token
```
Paste the printed token into `GOOGLE_REFRESH_TOKEN` in `.env`.

4. Build:
```bash
npm run build
```

## Run

- One heartbeat execution:
```bash
npm run heartbeat
```

- Canvas poll check:
```bash
npm run poll
```

- Calendar sync check:
```bash
npm run sync:calendar
```

- Full smoke check:
```bash
npm run smoke
```

- Syllabus extraction (V2 starter, PDF or text input):
```bash
npm run syllabus:extract -- ./path/to/syllabus.pdf
```

- Syllabus enrichment preview (no DB writes):
```bash
npm run syllabus:enrich -- ./path/to/syllabus.pdf
```
This creates a timestamped review report JSON under `reports/`.

- Syllabus enrichment apply (fills `points_possible` + syllabus metadata):
```bash
npm run syllabus:enrich -- ./path/to/syllabus.pdf --apply
```

- Syllabus enrichment with explicit report path:
```bash
npm run syllabus:enrich -- ./path/to/syllabus.pdf --out ./reports/latest-enrichment.json
```

- Syllabus enrichment apply with stricter confidence gate:
```bash
npm run syllabus:enrich -- ./path/to/syllabus.pdf --apply --min-score 0.6
```

- Syllabus enrichment apply with explicit approvals file:
```bash
npm run syllabus:enrich -- ./path/to/syllabus.pdf --apply --approve-file ./reports/approved-ids.json
```
`--approve-file` supports either:
- a JSON array of assignment ids: `["event-assignment-123", "..."]`
- or an object: `{ "approvedAssignmentIds": ["event-assignment-123"] }`

- Type check:
```bash
npm run typecheck
```

- Tests:
```bash
npm test -- --run
```

## Required Env Highlights

- `CANVAS_ICAL_URL` Canvas calendar feed URL
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`
- `OPENCLAW_CHANNEL`, `OPENCLAW_TARGET` (for outbound notifications)
- `OPENAI_API_KEY` (or Anthropic equivalent) for LLM digest/query generation

## Troubleshooting

- `invalid_grant` from Google Calendar:
  - Re-run `npm run google:token` and update `GOOGLE_REFRESH_TOKEN`.
  - Keep OAuth client id/secret/redirect URI consistent.

- Notifier fallback logs:
  - Ensure `OPENCLAW_CHANNEL` and `OPENCLAW_TARGET` are set in this project’s `.env`.
  - Confirm OpenClaw channel routing is active and bot has permission to post.

## Demo Runbook

Use this command sequence for a clean demo:

```bash
npm run build
npm run poll
npm run sync:calendar
npm run heartbeat
```

Expected successful signals:
- `poll_complete` with numeric `newAssignments`
- `calendar_sync_complete` with `status: "ok"` (or sync log showing `created` count)
- heartbeat JSON with `event: "heartbeat_complete"`

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|------|--------|-------|
| `invalid_grant` from Google | Expired/revoked refresh token | Run `npm run google:token`, update `.env`, retry |
| `[notifier:fallback] Missing OPENCLAW_TARGET...` | Missing routing vars in project `.env` | Set `OPENCLAW_CHANNEL` + `OPENCLAW_TARGET` |
| `TypeError: fetch failed` from OpenClaw send | Gateway transport/config mismatch | Ensure OpenClaw gateway is running and channel is connected |
| No new events detected | Canvas feed unchanged | Verify `CANVAS_ICAL_URL` and create test assignment in Canvas |

## Modules

- `src/icalPoller.ts` Canvas iCal polling + assignment extraction
- `src/calendarSync.ts` Google Calendar create/update/sync/reconcile
- `src/digest.ts` Daily/weekly digest generation
- `src/queryHandler.ts` Natural language academic query handling
- `src/notifier.ts` OpenClaw channel delivery
- `src/index.ts` Heartbeat orchestration
- `src/syllabusParser.ts` V2 syllabus extraction from raw syllabus text
- `src/syllabusEnrichment.ts` Match extracted syllabus items to assignments and apply enrichment

## Dashboard UI

Run local dashboard:
```bash
npm run dashboard
```

Open:
`http://localhost:4177`

Current dashboard capabilities:
- View assignment/sync/overdue status snapshot
- Trigger `poll`, `sync`, and full `heartbeat` actions
- Trigger full calendar reconciliation (`reconcileCalendar`)
- Ask natural-language academic queries through `queryHandler`
- Generate daily/weekly digest text on demand
- Run syllabus enrichment preview/apply with in-UI match approvals
- Browse assignments with search, sort, upcoming-only filter, and course grouping
