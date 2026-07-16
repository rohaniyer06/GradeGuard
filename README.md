# GradeGuard

GradeGuard is a local-first academic dashboard for tracking Canvas assignments, syncing deadlines to Google Calendar, and sending daily Discord/OpenClaw digests.

It is intended as a clone-and-run personal tool, not a hosted multi-user SaaS app.

## Features

- Polls a Canvas iCalendar feed for assignments.
- Deduplicates assignments in SQLite.
- Syncs deadlines to Google Calendar through OAuth2.
- Runs a local React dashboard for assignments, settings, syllabus uploads, and workload views.
- Sends new-assignment alerts and daily digest notifications through OpenClaw/Discord.
- Supports optional local macOS Messages/iMessage delivery.
- Uses an LLM for natural-language questions, digest generation, and syllabus parsing.
- Ingests syllabus PDFs and creates dated assignments when the parser can recover due dates.

## Requirements

- macOS or Linux-like shell
- Node.js 22 LTS
- npm
- Canvas calendar feed URL
- Google OAuth credentials, if using calendar sync
- OpenClaw/Discord setup, if using notifications
- OpenAI-compatible or Anthropic API key, if using LLM features

This project uses native SQLite dependencies, so Node 22 is recommended. If you use `nvm`:

```bash
nvm use
```

## Setup

Install dependencies:

```bash
npm install
```

Create your local env file:

```bash
cp .env.example .env
```

Fill the values you need in `.env`. At minimum, the dashboard is most useful with:

```bash
CANVAS_ICAL_URL=
LLM_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

For Groq or other OpenAI-compatible providers, set:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_provider_key
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_MODEL=llama-3.1-8b-instant
```

For Google Calendar sync, generate a refresh token:

```bash
npm run google:token
```

Then paste the printed token into `GOOGLE_REFRESH_TOKEN` in `.env`.

## Run The App

Start the local dashboard and background schedulers:

```bash
npm run start:ui
```

Open:

```text
http://localhost:3141
```

`start:ui` builds the React dashboard, starts the Express server, schedules daily digest checks, and schedules Canvas polling.

## Common Commands

Type check:

```bash
npm run typecheck
```

Run tests:

```bash
npm test -- --run
```

Build backend TypeScript:

```bash
npm run build
```

Build React dashboard only:

```bash
npm run build:ui
```

Poll Canvas once:

```bash
npm run poll
```

Sync assignments to Google Calendar:

```bash
npm run sync:calendar
```

Run one compiled heartbeat:

```bash
npm run build
npm run heartbeat
```

## Environment Variables

Core:

- `CANVAS_ICAL_URL`: Canvas calendar feed URL.
- `TIMEZONE`: local timezone, for example `America/Los_Angeles`.
- `DIGEST_SCHEDULE_CRON`: daily digest cron expression, for example `0 8 * * *`.
- `HEARTBEAT_INTERVAL_MINUTES`: Canvas polling interval, default `30`.

LLM:

- `LLM_PROVIDER`: `openai` or `anthropic`.
- `OPENAI_API_KEY`: OpenAI or OpenAI-compatible API key.
- `OPENAI_MODEL`: model name.
- `OPENAI_BASE_URL`: optional OpenAI-compatible base URL.
- `ANTHROPIC_API_KEY`: Anthropic API key.
- `ANTHROPIC_MODEL`: Anthropic model name.

Google Calendar:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_REFRESH_TOKEN`
- `TARGET_CALENDAR_ID`

Notifications:

- `OPENCLAW_CHANNEL`: usually `discord`.
- `OPENCLAW_TARGET`: OpenClaw target/channel id.
- `OPENCLAW_ACCOUNT`: optional.
- `OPENCLAW_SKILL_SECRET`: optional gateway token/secret.
- `IMESSAGE_TARGET`: optional Apple ID/email for local macOS Messages delivery.

## Dashboard

The dashboard includes:

- Active, overdue, and past assignment views.
- Assignment completion checkboxes.
- Assignment detail drawer.
- 7-day, 2-week, and 4-week workload views.
- Course filtering.
- Recently added assignment notifications.
- Health check panel.
- Ask GradeGuard natural-language query panel.
- Settings for Canvas URL, notification target, digest time, dark mode, and syllabus upload.
- Syllabus upload debug output showing extracted, matched, created, and unmatched items.

## Syllabus Ingestion

Syllabus upload is intentionally best-effort:

- PDF text is extracted with `pdf-parse`.
- An LLM extracts assignments, quizzes, projects, and exams.
- A deterministic fallback recovers explicit long-form schedule dates like `Wednesday, July 15, 2026`.
- Existing assignments are matched only within the selected course.
- Unmatched syllabus items with clear dates are created as dashboard assignments.
- Items with no date are shown in the upload debug output but are not added to the assignment list.

You can also run parser/enrichment scripts manually:

```bash
npm run syllabus:extract -- ./path/to/syllabus.pdf
npm run syllabus:enrich -- ./path/to/syllabus.pdf
npm run syllabus:enrich -- ./path/to/syllabus.pdf --apply
```

## Notification Notes

Discord/OpenClaw is the reliable notification path for this project.

For automatic daily digests and new-assignment alerts, keep running:

- GradeGuard via `npm run start:ui`
- OpenClaw daemon/gateway, if your OpenClaw setup requires them
- Your Discord bot/channel configuration

iMessage support is local-machine best effort. It depends on macOS Messages state and may fail if the Mac is asleep, locked, disconnected, or if Messages/iCloud is not ready.

## Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Dashboard is blank white | Static asset route or stale build issue | Restart `npm run start:ui`, hard-refresh browser |
| Settings disappear after reload | Boot data injection route not active | Restart `npm run start:ui` |
| `invalid_grant` from Google | Expired/revoked refresh token | Run `npm run google:token` and update `.env` |
| No Discord notifications | Missing OpenClaw target/channel or gateway not running | Check `OPENCLAW_CHANNEL`, `OPENCLAW_TARGET`, OpenClaw daemon/gateway |
| Syllabus found items but created none | Items had no clear dates or matched existing assignments | Check the upload debug lists |
| Native dependency errors | Wrong Node version | Use Node 22 LTS |

## Project Structure

- `src/server.ts`: local dashboard API/server, cron scheduling, settings, syllabus upload.
- `ui/`: React dashboard source.
- `public/`: built dashboard assets served by Express.
- `src/icalPoller.ts`: Canvas iCal polling and assignment extraction.
- `src/calendarSync.ts`: Google Calendar sync.
- `src/digest.ts`: daily/weekly digest generation.
- `src/queryHandler.ts`: natural-language question handling.
- `src/notifier.ts`: Discord/OpenClaw and optional iMessage delivery.
- `src/syllabusParser.ts`: syllabus text/PDF item extraction.
- `src/syllabusEnrichment.ts`: syllabus-to-assignment matching.
- `src/db.ts`: SQLite schema and persistence helpers.

## Privacy

GradeGuard stores data locally in SQLite under `data/`, which is gitignored. API keys and tokens belong in `.env`, also gitignored.

LLM features send relevant prompt text to your configured LLM provider. Do not upload syllabi or ask questions containing data you do not want sent to that provider.

## License

ISC
