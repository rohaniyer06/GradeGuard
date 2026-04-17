# College Manager

Proactive academic assistant that pulls Canvas iCal deadlines, syncs them to Google Calendar, and sends digest/reminder notifications through OpenClaw channels.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure environment in `.env`:
- Canvas feed (`CANVAS_ICAL_URL`)
- Google OAuth credentials and refresh token
- LLM provider keys
- OpenClaw routing (`OPENCLAW_CHANNEL`, `OPENCLAW_TARGET`)

3. Build and run heartbeat:
```bash
npm run build
npm run heartbeat
```

## Useful Commands

- Type check:
```bash
npm run typecheck
```

- Build:
```bash
npm run build
```

- Run tests:
```bash
npm test
```

- Generate Google refresh token:
```bash
npm run google:token
```

## Current Modules

- `src/icalPoller.ts` Canvas iCal polling + assignment extraction
- `src/calendarSync.ts` Google Calendar create/update/sync/reconcile
- `src/digest.ts` Daily/weekly digest generation
- `src/queryHandler.ts` Natural language academic query handling
- `src/notifier.ts` OpenClaw channel delivery
- `src/index.ts` Heartbeat orchestration
