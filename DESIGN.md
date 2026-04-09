> **For the coding agent:** Sections 1–9 and 11–13 are your build instructions.
> Section 10 describes a workflow convention for the human developer — read it for
> context but you do not need to implement anything from it beyond keeping docs.md updated.

# College Manager Agent — Design Document
**Version:** 1.1 (iCal update)
**Author:** [Your Name]  
**Date:** April 2026  
**Stack:** TypeScript · OpenClaw · Canvas iCal Feed · Google Calendar API · SQLite · Claude/OpenAI LLM

---

## 1. Project Overview

A proactive academic assistant built as an OpenClaw skill. It lives inside OpenClaw and
communicates through the user's preferred messaging platform (iMessage, Slack, Discord, etc.).
It automatically pulls assignment and deadline data from the Canvas iCalendar feed, writes events
to Google Calendar, and sends intelligent daily/weekly digests — without any manual input from
the student after initial setup.

### Goals
- Eliminate manual deadline tracking for college students
- Synthesize data across all enrolled courses into one unified view
- Be genuinely proactive: notify the user before they think to ask
- Be resumé-worthy: demonstrates API integration, agentic scheduling, document parsing, and LLM reasoning

### Non-Goals (V1)
- Syllabus PDF parsing (deferred to V2)
- Grade tracking or GPA calculation
- Multi-user / shared calendar support

### Why iCal instead of Canvas REST API
Canvas administrators at most universities (including UCSB) disable personal access token
generation for students. The Canvas iCalendar feed is a built-in Canvas feature that is almost
never restricted — it requires no admin approval, no OAuth registration, and no API token. The
feed URL contains a personal auth token baked directly into it. For V1 deadline tracking and
calendar sync it provides everything needed: assignment names, due dates, and course names
across all enrolled courses. Points and submission types will be added via syllabus parsing in V2.

**How to get your iCal URL:**
Canvas → Calendar (left sidebar) → scroll to bottom of right panel → "Calendar Feed" →
copy the URL. It looks like:
`https://ucsb.instructure.com/feeds/calendars/user_XXXXXX.ics`

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        OpenClaw                         │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐  ┌─────────────┐ │
│  │  Heartbeat   │    │  Messaging   │  │  LLM Brain  │ │
│  │  Scheduler   │    │   Gateway    │  │(Claude/GPT) │ │
│  │ (every 30m)  │    │(iMsg/Slack)  │  │             │ │
│  └──────┬───────┘    └──────▲───────┘  └──────▲──────┘ │
│         │                   │                 │         │
│         ▼                   │                 │         │
│  ┌──────────────────────────┴─────────────────┴──────┐  │
│  │               college-manager skill               │  │
│  │                                                   │  │
│  │  icalPoller.ts     calendarSync.ts   digest.ts   │  │
│  │  queryHandler.ts   notifier.ts       db.ts        │  │
│  └──────────────────────────┬────────────────────────┘  │
└─────────────────────────────┼───────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    Canvas iCal Feed   Google Calendar API    SQLite DB
```

---

## 3. File Structure

```
college-manager/
├── DESIGN.md                  ← this file
├── docs.md                    ← live project state (agent continuity file)
├── package.json
├── tsconfig.json
├── .env                       ← secrets (gitignored)
├── .env.example               ← committed template
│
├── HEARTBEAT.md               ← OpenClaw heartbeat checklist
├── SKILLS.md                  ← OpenClaw skill registration
│
├── src/
│   ├── index.ts               ← skill entry point
│   ├── db.ts                  ← SQLite schema + queries
│   ├── icalPoller.ts          ← Canvas iCal feed fetcher and parser
│   ├── calendarSync.ts        ← Google Calendar API integration
│   ├── digest.ts              ← weekly/daily digest generator
│   ├── queryHandler.ts        ← natural language query handler
│   ├── notifier.ts            ← OpenClaw message sending
│   └── types.ts               ← shared TypeScript interfaces
│
├── data/
│   └── college_manager.db     ← SQLite database (gitignored)
│
└── tests/
    ├── ical.test.ts
    ├── calendar.test.ts
    └── digest.test.ts
```

---

## 4. Environment Variables

```bash
# .env.example

# Canvas iCal Feed
# Get this from: Canvas → Calendar → "Calendar Feed" (bottom of right panel)
CANVAS_ICAL_URL=https://ucsb.instructure.com/feeds/calendars/user_XXXXXX.ics

# Google Calendar
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/callback
GOOGLE_REFRESH_TOKEN=           # generated on Day 2 via one-time auth script

# LLM
LLM_PROVIDER=openai             # or "anthropic"
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# OpenClaw
OPENCLAW_SKILL_SECRET=
TARGET_CALENDAR_ID=primary      # Google Calendar ID to write to

# App config
HEARTBEAT_INTERVAL_MINUTES=30
DIGEST_SCHEDULE_CRON=0 8 * * *  # 8am daily
TIMEZONE=America/Los_Angeles
```

---

## 5. Database Schema (SQLite)

### `courses`
```sql
CREATE TABLE courses (
  id            TEXT PRIMARY KEY,   -- derived from iCal event context/course name
  name          TEXT NOT NULL,
  course_code   TEXT,
  term          TEXT,               -- e.g. "Spring 2026"
  is_active     INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);
```

### `assignments`
```sql
CREATE TABLE assignments (
  id                TEXT PRIMARY KEY,   -- derived from iCal UID field
  course_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  due_at            TEXT,               -- ISO 8601
  points_possible   REAL,               -- null in V1, populated in V2 via syllabus
  submission_types  TEXT,               -- null in V1, populated in V2 via syllabus
  is_submitted      INTEGER DEFAULT 0,
  calendar_event_id TEXT,               -- Google Calendar event ID
  first_seen_at     TEXT DEFAULT (datetime('now')),
  notified_at       TEXT,               -- null = not yet notified
  FOREIGN KEY (course_id) REFERENCES courses(id)
);
```

### `digests`
```sql
CREATE TABLE digests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sent_at     TEXT DEFAULT (datetime('now')),
  type        TEXT,                    -- "daily" | "weekly"
  content     TEXT                     -- full digest text sent
);
```

---

## 6. Core Modules

### 6.1 `icalPoller.ts`

**Responsibility:** Fetch and parse the Canvas iCalendar feed, extract assignments, and
detect newly added items vs what is already stored in the DB.

**Dependency:** `node-ical` npm package — lightweight iCal parser for Node.

**Key functions:**
```typescript
// Fetch and parse the iCal feed, return all upcoming events as Assignment objects
async function fetchIcalEvents(icalUrl: string): Promise<Assignment[]>

// Compare fetched events against DB, return only newly discovered assignments
async function pollForNewAssignments(): Promise<Assignment[]>

// Parse course name out of an iCal event summary or description
function parseCourseFromEvent(event: ICalEvent): string
```

**Implementation notes:**
- Canvas iCal events have a `summary` field like `"[CS138] Homework 3"` or `"Midterm Exam"`
  with the course code in brackets — parse this to associate events with courses
- The iCal `UID` field is stable and unique per assignment — use it as the `id` in the DB
- Filter out events with no `dtstart` (due date) — these are non-assignment calendar items
- Only store events with a due date in the future or within the past 7 days (to catch recent items)

**Example parsing logic:**
```typescript
import ical from 'node-ical';

async function fetchIcalEvents(icalUrl: string): Promise<Assignment[]> {
  const events = await ical.fromURL(icalUrl);
  return Object.values(events)
    .filter(e => e.type === 'VEVENT' && e.start)
    .map(e => ({
      id: e.uid,
      name: e.summary,
      dueAt: e.start.toISOString(),
      description: e.description ?? null,
      courseId: parseCourseFromEvent(e),
      pointsPossible: null,     // populated in V2 via syllabus parser
      submissionTypes: null,    // populated in V2 via syllabus parser
      calendarEventId: null,
      isSubmitted: 0,
      notifiedAt: null
    }));
}
```

---

### 6.2 `calendarSync.ts`

**Responsibility:** Create, update, and delete Google Calendar events to mirror the assignments DB.

**Key functions:**
```typescript
// Create a calendar event for a given assignment
// Returns the Google Calendar event ID to store in DB
async function createCalendarEvent(assignment: Assignment): Promise<string>

// Update an existing event (e.g. due date changed in Canvas)
async function updateCalendarEvent(eventId: string, assignment: Assignment): Promise<void>

// Delete an event (e.g. assignment was removed from Canvas)
async function deleteCalendarEvent(eventId: string): Promise<void>

// Sync all assignments in DB that have no calendar_event_id yet
async function syncAllToCalendar(): Promise<void>
```

**Google Calendar event format:**
```typescript
{
  summary: assignment.name,   // e.g. "[CS138] Homework 3"
  description: assignment.description ?? '',
  start: { dateTime: assignment.dueAt, timeZone: process.env.TIMEZONE },
  end:   { dateTime: assignment.dueAt, timeZone: process.env.TIMEZONE },
  reminders: {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 24 * 60 },   // 1 day before
      { method: 'popup', minutes: 60 }          // 1 hour before
    ]
  }
}
```

**OAuth flow:** Use the refresh token grant. At startup, exchange `GOOGLE_REFRESH_TOKEN`
for a short-lived access token via the `googleapis` library. The library handles re-exchange
automatically when the access token expires.

**One-time refresh token setup (Day 2):**
The agent will generate a small `scripts/getRefreshToken.ts` script that opens a local
OAuth consent URL in your browser, you approve it once, and it prints the refresh token
to the terminal for you to paste into `.env`. You never need to do this again.

---

### 6.3 `digest.ts`

**Responsibility:** Generate an intelligent plain-text digest by passing structured DB data
to the LLM.

**Key functions:**
```typescript
// Generate a daily digest (assignments due in next 48 hours)
async function generateDailyDigest(): Promise<string>

// Generate a weekly digest (full week view with workload analysis)
async function generateWeeklyDigest(): Promise<string>
```

**LLM prompt structure for daily digest:**
```
You are a proactive academic assistant for a college student.

Here is their upcoming assignment data (JSON):
${JSON.stringify(upcomingAssignments, null, 2)}

Generate a concise, friendly daily digest. Include:
1. Assignments due in the next 48 hours (sorted by urgency)
2. A one-line workload warning if any single day has 3+ items due
3. The next exam or quiz, if one exists within 7 days

Format as plain text suitable for an iMessage. No markdown. Be brief.
```

**Weekly digest additions:** Include workload distribution across the week (which days are
heavy) and flag any single day with 3+ deadlines as a danger zone.

---

### 6.4 `queryHandler.ts`

**Responsibility:** Handle conversational natural language queries from the user via
OpenClaw messages.

**Supported query types (V1):**
- "What's due this week?" → returns all assignments due in next 7 days
- "When is my next exam for [course]?" → filters by course name and keyword "exam"/"midterm"
- "What's my heaviest week this quarter?" → aggregates by week, ranks by item count
- "What did I miss?" → assignments past due with `is_submitted = 0`

**Pattern:**
1. Receive message text from OpenClaw Gateway
2. Pass to LLM with DB snapshot as context
3. LLM returns a natural language answer
4. Pass answer back through OpenClaw Gateway to the user

**LLM prompt:**
```
You are a college academic assistant. Answer the student's question using
ONLY the data below. Be direct and conversational. No markdown formatting.

Student's courses and assignments (JSON):
${JSON.stringify(dbSnapshot)}

Student's question: "${userMessage}"
```

---

### 6.5 `notifier.ts`

**Responsibility:** Send messages to the user through OpenClaw's Gateway.

**Key functions:**
```typescript
// Send a plain text message to the user via OpenClaw
async function sendMessage(text: string): Promise<void>

// Send a new-assignment notification
async function notifyNewAssignment(assignment: Assignment): Promise<void>

// Send a digest message
async function sendDigest(digestText: string): Promise<void>
```

**New assignment notification format:**
```
📚 New assignment detected:
"[Assignment Name]" — due [Due Date]
Added to your Google Calendar.
```

---

## 7. OpenClaw Integration

### 7.1 `HEARTBEAT.md`

This file is read by OpenClaw on every heartbeat tick. The agent evaluates each step and
decides whether action is needed.

```markdown
# College Manager Heartbeat

## Steps

1. **Poll Canvas iCal feed** — call `icalPoller.pollForNewAssignments()`
   - If new assignments found: sync to Google Calendar, send notification via notifier
   - If no new assignments: output HEARTBEAT_OK and stop

2. **Check digest schedule** — has a daily digest been sent today?
   - If not and current time is after 8am: generate and send daily digest
   - If yes: skip

3. **Check for overdue items** — any assignments now past due with is_submitted=0?
   - If yes and not yet notified: send a gentle reminder
   - If no: HEARTBEAT_OK

## Output
- New items found → send notifications, log to digests table
- Nothing new → output: HEARTBEAT_OK (no message sent, no tokens wasted)
```

### 7.2 `SKILLS.md`

```markdown
# college-manager

A proactive academic assistant for college students.

## Triggers
- Heartbeat (every 30 minutes)
- User message containing academic keywords (assignment, due, exam, class, course, grade, canvas)

## Capabilities
- Answer natural language questions about upcoming assignments
- Send proactive daily/weekly digests
- Notify user immediately when new Canvas assignments are posted
- Manage Google Calendar events for all deadlines

## Entry Point
src/index.ts
```

---

## 8. Build Plan (V1 — 1 Week)

### Day 1: Scaffolding + Canvas iCal Poller
- [ ] Initialize TypeScript project (`npm init`, `tsconfig.json`)
- [ ] Install dependencies: `node-ical`, `better-sqlite3`, `axios`, `googleapis`, `dotenv`, `openai` / `@anthropic-ai/sdk`
- [ ] Implement `db.ts` — schema creation and CRUD queries
- [ ] Implement `icalPoller.ts` — fetch iCal URL, parse events, store in SQLite
- [ ] Manually verify iCal events are correctly parsed and stored in DB

### Day 2: Google Calendar Sync
- [ ] Agent generates `scripts/getRefreshToken.ts` — run it once to get `GOOGLE_REFRESH_TOKEN`
- [ ] Paste refresh token into `.env`
- [ ] Implement `calendarSync.ts` — `createCalendarEvent` and `syncAllToCalendar`
- [ ] Manually run sync and verify events appear in Google Calendar

### Day 3: Digest + Query Handler
- [ ] Implement `digest.ts` — generate daily digest with LLM, verify output quality
- [ ] Implement `queryHandler.ts` — wire up 4 core query types
- [ ] Test queries manually with hardcoded messages

### Day 4: OpenClaw Wiring
- [ ] Write `HEARTBEAT.md` and `SKILLS.md`
- [ ] Implement `notifier.ts` — send test message through OpenClaw Gateway
- [ ] Wire heartbeat loop: iCal poll → new assignment check → conditional notify
- [ ] Register skill in OpenClaw and trigger first real heartbeat

### Day 5: Integration Testing + Polish
- [ ] End-to-end test: verify new iCal event → calendar event created → notification sent
- [ ] Test all 4 natural language query types
- [ ] Add error handling: iCal fetch failures, Google 401 refresh, network retries
- [ ] Write `docs.md` initial state

### Day 6: V1 Cleanup + Demo Prep
- [ ] Clean up logging (structured JSON logs, not console.log spam)
- [ ] Write README with setup instructions
- [ ] Record demo: show iCal event → agent detects it → calendar updated → message sent

### Day 7: Buffer / V2 Start (Syllabus Parser)
- [ ] Buffer for any integration bugs
- [ ] OR begin syllabus PDF parsing with `pdf-parse` (Node) or `pdfplumber` (Python subprocess)

---

## 9. V2 Roadmap (Syllabus Parser)

**Why this becomes more valuable in V2:** Since the iCal feed does not include points or
submission types, the syllabus parser fills that gap — adding grade weights and assignment
context to everything already tracked.

**The engineering problem:** Syllabi are unstructured PDFs with inconsistently formatted
dates ("Week 4 — Midterm", "Due 10/15", "April 22nd by midnight"). No regex covers all cases.

**Approach:**
1. Student uploads syllabus PDF via OpenClaw message or file drop
2. `pdf-parse` (Node) extracts raw text from the PDF
3. Raw text is passed to LLM with a structured extraction prompt:

```
Extract all assignments, exams, quizzes, and due dates from this syllabus text.
Return a JSON array with this schema:
[{ "name": string, "type": "assignment"|"exam"|"quiz"|"project",
   "dueDate": "YYYY-MM-DD or null if unclear", "points": number|null,
   "weight": number|null, "rawText": string }]

Syllabus text:
${rawText}
```

4. LLM output is validated against the schema, ambiguous dates are flagged
5. Student is shown a confirmation: "I found 12 items. Does this look right?"
6. Confirmed items update the existing `assignments` rows with `points_possible`
   and `submission_types`, enriching the data already sourced from the iCal feed

---

## 10. docs.md — Agent Continuity Protocol

> **This section defines how to use `docs.md` to switch between coding agents
> without losing context.**

### What is `docs.md`?

`docs.md` is a living document in the project root that tracks the current state of
the project. It is **not** a design spec — it is a runtime log of what has been built,
what works, what is broken, and what is next. It is the first thing a new coding agent
should read at the start of every session.

### File Location
```
college-manager/docs.md
```

### Template

Copy this into `docs.md` on Day 1 before starting the build:

```markdown
# College Manager — Project State
Last updated: [DATE] by [AGENT NAME]

## Current Phase
V1 — Day 1: Project not yet started

## What Works (verified manually)
- [ ] SQLite schema created and migrations run
- [ ] iCal poller fetches and parses Canvas feed correctly
- [ ] iCal poller detects new assignments vs DB
- [ ] Google Calendar OAuth refresh token obtained
- [ ] createCalendarEvent works end-to-end
- [ ] Daily digest generates correctly via LLM
- [ ] Query handler responds to all 4 query types
- [ ] OpenClaw heartbeat fires and notifies on new assignments

## Current File States
| File | Status | Notes |
|------|--------|-------|
| src/db.ts | ❌ Not started | |
| src/icalPoller.ts | ❌ Not started | |
| src/calendarSync.ts | ❌ Not started | |
| src/digest.ts | ❌ Not started | |
| src/queryHandler.ts | ❌ Not started | |
| src/notifier.ts | ❌ Not started | |
| src/index.ts | ❌ Not started | |
| src/types.ts | ❌ Not started | |
| HEARTBEAT.md | ❌ Not started | |
| SKILLS.md | ❌ Not started | |
| scripts/getRefreshToken.ts | ❌ Not started | |

## Known Issues / Blockers
- None yet

## Environment
- Node version: 22.x
- DB file path: ./data/college_manager.db
- Canvas iCal URL: set in .env as CANVAS_ICAL_URL
- Google OAuth credentials: CLIENT_ID and CLIENT_SECRET set in .env
- GOOGLE_REFRESH_TOKEN: not yet obtained (Day 2 task)

## Next Task
Begin Day 1: scaffold the TypeScript project, install all dependencies
from package.json in Section 11, implement db.ts schema, and implement
icalPoller.ts to fetch and parse the Canvas iCal feed into SQLite.
```

---

### How to Update `docs.md`

At the **end of every coding session**, prompt your agent with:

> "Please update docs.md to reflect everything we did this session. Mark completed
> items as done, add any new known issues we discovered, update the file status table,
> and set the Next Task to exactly what we should do at the start of next session."

### How to Start a New Session with a New Agent

Paste this prompt at the start of every new session with any agent:

> "Please read the file `docs.md` in the project root. It contains the current
> state of this project. Once you've read it, summarize back to me: what phase we're
> in, what's working, any blockers, and what the next task is. Then we'll get started."

### Why This Works

- Every agent starts with identical ground truth — no re-explaining architecture
- The "Next Task" field eliminates ambiguity about where to begin
- The file status table prevents agents from re-implementing things that already work
- Known issues are surfaced immediately, not re-discovered 30 minutes into a session
- Switching between GPT-5.3 Codex, GPT-5.4, and Opus 4.6 mid-project is seamless

---

## 11. Dependencies

```json
{
  "dependencies": {
    "node-ical": "^0.18.0",
    "better-sqlite3": "^9.4.0",
    "axios": "^1.7.0",
    "googleapis": "^144.0.0",
    "dotenv": "^16.4.0",
    "openai": "^4.47.0",
    "@anthropic-ai/sdk": "^0.21.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

---

## 12. Security Notes

- `CANVAS_ICAL_URL` contains a personal auth token baked into the URL — treat it like
  a password. Never commit it to git. It is in `.env` which is gitignored.
- `GOOGLE_REFRESH_TOKEN` is long-lived — store only in `.env`, never commit to git
- Add `data/` and `.env` to `.gitignore` immediately on Day 1
- The SQLite DB contains course and assignment names — treat as personal academic data
- If the iCal URL is ever compromised, regenerate it from Canvas Calendar settings

---

## 13. Demo Script (Interview)

> *"I built a proactive academic agent on top of OpenClaw that integrates with
> Canvas LMS and Google Calendar. Every 30 minutes, a heartbeat wakes the agent,
> it fetches my Canvas iCalendar feed across all enrolled courses, and if any new
> assignment has appeared since the last poll it sends me a message on iMessage and
> creates the calendar event automatically. It also generates a daily digest every
> morning that synthesizes my workload across all courses and uses an LLM to flag
> heavy days. The interesting engineering problems were: parsing iCal events and
> correctly associating them to courses, the Google OAuth refresh token flow, and
> designing the heartbeat so it only invokes the LLM when something actually
> warrants it — so I'm not burning tokens on empty polls."*

---

*End of Design Document — v1.1*
