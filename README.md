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

## Modules

- `src/icalPoller.ts` Canvas iCal polling + assignment extraction
- `src/calendarSync.ts` Google Calendar create/update/sync/reconcile
- `src/digest.ts` Daily/weekly digest generation
- `src/queryHandler.ts` Natural language academic query handling
- `src/notifier.ts` OpenClaw channel delivery
- `src/index.ts` Heartbeat orchestration
