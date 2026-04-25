import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import cron, { type ScheduledTask } from "node-cron";
import pdfParse from "pdf-parse";
import { getDb } from "./db";
import { handleQuery } from "./queryHandler";
import { pollForNewAssignments } from "./icalPoller";
import { notifyNewAssignment, sendDigest, sendMessage } from "./notifier";
import { generateDailyDigest } from "./digest";
import { syncAllToCalendar } from "./calendarSync";
import { extractSyllabusItemsFromText } from "./syllabusParser";
import { planAndApplySyllabusItems } from "./syllabusEnrichment";

dotenv.config();

const app = express();
const port = 3141;
const upload = multer({ storage: multer.memoryStorage() });
const publicDir = path.resolve(process.cwd(), "public");
const envPath = path.resolve(process.cwd(), ".env");
let dailyDigestTask: ScheduledTask | null = null;
let digestCatchupInterval: NodeJS.Timeout | null = null;
let assignmentPollTask: ScheduledTask | null = null;
let isAssignmentPollRunning = false;
let isDailyDigestRunning = false;

interface UploadedSyllabus {
  course: string;
  uploadedAt: string;
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

function ensureUiTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploaded_syllabi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course TEXT NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_uploaded_syllabi_uploaded_at ON uploaded_syllabi(uploaded_at DESC);
  `);
}

function listUploadedSyllabi(): UploadedSyllabus[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        course,
        uploaded_at as uploadedAt
      FROM uploaded_syllabi
      ORDER BY datetime(uploaded_at) DESC
    `)
    .all() as UploadedSyllabus[];
}

function insertUploadedSyllabus(course: string): void {
  const db = getDb();
  db.prepare(
    `
      INSERT INTO uploaded_syllabi (course, uploaded_at)
      VALUES (@course, datetime('now'))
    `
  ).run({ course });
}

function maskValue(value: string, keep = 40): string {
  if (!value) {
    return "";
  }
  if (value.length <= keep) {
    return value;
  }
  return `${value.slice(0, keep)}...`;
}

function parseCronToTimeValue(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  const minute = Number.parseInt(parts[0] ?? "0", 10);
  const hour = Number.parseInt(parts[1] ?? "8", 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return "08:00";
  }
  const hh = String(Math.max(0, Math.min(23, hour))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, minute))).padStart(2, "0");
  return `${hh}:${mm}`;
}

function timeValueToCron(timeValue: string): string {
  const match = timeValue.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return "0 8 * * *";
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return "0 8 * * *";
  }
  return `${minute} ${hour} * * *`;
}

function readEnv(): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const raw = fs.readFileSync(envPath, "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1);
    out[key] = value;
  }
  return out;
}

function updateEnvValue(key: string, value: string): void {
  const safeKey = key.trim();
  if (!safeKey) {
    throw new Error("Settings key cannot be empty.");
  }

  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = current ? current.split(/\r?\n/) : [];
  let found = false;

  const nextLines = lines.map((line) => {
    if (!line || line.trim().startsWith("#")) {
      return line;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      return line;
    }
    const existingKey = line.slice(0, idx).trim();
    if (existingKey !== safeKey) {
      return line;
    }
    found = true;
    return `${safeKey}=${value}`;
  });

  if (!found) {
    nextLines.push(`${safeKey}=${value}`);
  }

  fs.writeFileSync(envPath, `${nextLines.join("\n")}\n`);
  process.env[safeKey] = value;
}

function getStatusPayload() {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const lastSyncRow = db
    .prepare("SELECT MAX(first_seen_at) as lastSync FROM assignments")
    .get() as { lastSync: string | null };

  const upcomingRow = db
    .prepare("SELECT COUNT(*) as count FROM assignments WHERE due_at IS NOT NULL AND due_at > ?")
    .get(nowIso) as { count: number };

  return {
    lastSync: lastSyncRow.lastSync,
    upcomingCount: upcomingRow.count
  };
}

function getUiBootPayload() {
  const env = readEnv();
  const canvasIcal = env.CANVAS_ICAL_URL ?? process.env.CANVAS_ICAL_URL ?? "";
  const target = env.OPENCLAW_TARGET ?? process.env.OPENCLAW_TARGET ?? "";
  const digestCron = env.DIGEST_SCHEDULE_CRON ?? process.env.DIGEST_SCHEDULE_CRON ?? "0 8 * * *";
  const alertsEnabled = (env.NEW_ASSIGNMENT_ALERTS ?? process.env.NEW_ASSIGNMENT_ALERTS ?? "true") !== "false";
  const theme = (env.UI_THEME ?? process.env.UI_THEME ?? "light").trim().toLowerCase() === "dark" ? "dark" : "light";

  return {
    settings: {
      canvasIcalUrl: canvasIcal,
      canvasIcalMasked: canvasIcal,
      notificationTargetMasked: maskValue(target),
      digestTime: parseCronToTimeValue(digestCron),
      newAssignmentAlerts: alertsEnabled,
      theme
    },
    uploadedSyllabi: listUploadedSyllabi()
  };
}

function getTimezone(): string {
  return process.env.TIMEZONE?.trim() || "America/Los_Angeles";
}

function getDigestCronExpression(): string {
  return process.env.DIGEST_SCHEDULE_CRON?.trim() || "0 8 * * *";
}

function getHeartbeatIntervalMinutes(): number {
  const raw = Number.parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES?.trim() || "30", 10);
  if (Number.isNaN(raw)) {
    return 30;
  }
  return Math.min(Math.max(raw, 1), 59);
}

function getHeartbeatCronExpression(): string {
  return `*/${getHeartbeatIntervalMinutes()} * * * *`;
}

function alertsEnabled(): boolean {
  return (process.env.NEW_ASSIGNMENT_ALERTS?.trim() || "true") !== "false";
}

async function runDailyDigestJob(): Promise<void> {
  if (isDailyDigestRunning) {
    console.log("[ui-cron] Daily digest skipped: prior run still in progress.");
    return;
  }
  isDailyDigestRunning = true;
  try {
    const digestText = await generateDailyDigest();
    await sendDigest(digestText);
    console.log(`[ui-cron] Daily digest sent at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("[ui-cron] Daily digest failed:", error instanceof Error ? error.message : String(error));
  } finally {
    isDailyDigestRunning = false;
  }
}

function scheduleDailyDigest(cronExpression: string): void {
  if (dailyDigestTask) {
    dailyDigestTask.stop();
    dailyDigestTask.destroy();
    dailyDigestTask = null;
  }

  dailyDigestTask = cron.schedule(
    cronExpression,
    () => {
      void runDailyDigestJob();
    },
    {
      timezone: getTimezone()
    }
  );
  console.log(`[ui-cron] Scheduled daily digest: "${cronExpression}" (${getTimezone()})`);
}

function parseDailyDigestScheduleMinutes(cronExpression: string): number | null {
  const [minuteRaw, hourRaw] = cronExpression.trim().split(/\s+/);
  const minute = Number.parseInt(minuteRaw ?? "", 10);
  const hour = Number.parseInt(hourRaw ?? "", 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return null;
  }
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

function getLocalTimeParts(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone
  });
  const parts = formatter.formatToParts(date);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value || "0"),
    minute: Number(parts.find((p) => p.type === "minute")?.value || "0")
  };
}

function toUtcDateFromSqlDateTime(value: string): Date | null {
  const normalized = value.trim().replace(" ", "T");
  const parsed = new Date(`${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function wasDigestSentAfterScheduleToday(scheduledMinutes: number): boolean {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT sent_at as sentAt
      FROM digests
      WHERE type = 'daily'
        AND date(sent_at, 'localtime') = date('now', 'localtime')
      ORDER BY sent_at DESC
    `)
    .all() as Array<{ sentAt: string }>;

  if (!rows.length) {
    return false;
  }

  for (const row of rows) {
    const sentAt = toUtcDateFromSqlDateTime(row.sentAt);
    if (!sentAt) {
      continue;
    }
    const local = getLocalTimeParts(sentAt, getTimezone());
    const sentMinutes = local.hour * 60 + local.minute;
    if (sentMinutes >= scheduledMinutes) {
      return true;
    }
  }

  return false;
}

function shouldRunDailyDigestCatchup(): boolean {
  const scheduledMinutes = parseDailyDigestScheduleMinutes(getDigestCronExpression());
  if (scheduledMinutes === null) {
    return false;
  }
  if (wasDigestSentAfterScheduleToday(scheduledMinutes)) {
    return false;
  }
  const now = getLocalTimeParts(new Date(), getTimezone());
  const nowMinutes = now.hour * 60 + now.minute;
  return nowMinutes >= scheduledMinutes;
}

function runDailyDigestCatchupCheck(): void {
  if (!shouldRunDailyDigestCatchup()) {
    return;
  }
  void runDailyDigestJob();
}

function startDailyDigestCatchupWatcher(): void {
  if (digestCatchupInterval) {
    clearInterval(digestCatchupInterval);
    digestCatchupInterval = null;
  }

  // Sleep/wake-safe fallback: timer resumes after wake and runs catch-up check.
  digestCatchupInterval = setInterval(() => {
    runDailyDigestCatchupCheck();
  }, 15_000);
  console.log("[ui-cron] Enabled daily digest catch-up watcher (15s interval).");
}

async function runAssignmentPollingJob(): Promise<void> {
  if (isAssignmentPollRunning) {
    console.log("[ui-cron] Assignment poll skipped: prior run still in progress.");
    return;
  }
  isAssignmentPollRunning = true;
  try {
    const newAssignments = await pollForNewAssignments();
    if (newAssignments.length === 0) {
      console.log("[ui-cron] Assignment poll complete: no new assignments.");
      return;
    }

    let calendarSyncOk = true;
    try {
      await syncAllToCalendar();
    } catch (error) {
      calendarSyncOk = false;
      console.error("[ui-cron] Calendar sync failed during assignment poll:", error instanceof Error ? error.message : String(error));
    }

    if (!alertsEnabled()) {
      console.log(`[ui-cron] Assignment poll found ${newAssignments.length} new assignments, alerts disabled.`);
      return;
    }

    for (const assignment of newAssignments) {
      if (calendarSyncOk) {
        await notifyNewAssignment(assignment);
      } else {
        await sendMessage(`New assignment detected:\n"${assignment.name}" — due ${new Date(assignment.dueAt).toLocaleString()}`);
      }
    }
    console.log(`[ui-cron] Assignment notifications sent: ${newAssignments.length}`);
  } catch (error) {
    console.error("[ui-cron] Assignment poll failed:", error instanceof Error ? error.message : String(error));
  } finally {
    isAssignmentPollRunning = false;
  }
}

function scheduleAssignmentPolling(cronExpression: string): void {
  if (assignmentPollTask) {
    assignmentPollTask.stop();
    assignmentPollTask.destroy();
    assignmentPollTask = null;
  }

  assignmentPollTask = cron.schedule(cronExpression, () => {
    void runAssignmentPollingJob();
  });
  console.log(`[ui-cron] Scheduled assignment polling: "${cronExpression}"`);
}

app.get("/api/assignments", (_req, res) => {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rows = db
    .prepare(`
      SELECT
        a.id,
        a.name,
        a.due_at as dueAt,
        a.first_seen_at as firstSeenAt,
        c.course_code as courseCode,
        c.name as courseName
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      WHERE a.due_at IS NOT NULL AND a.due_at > ?
      ORDER BY a.due_at ASC
    `)
    .all(nowIso);

  res.json({ assignments: rows });
});

app.get("/api/assignments/recent", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT
        a.id,
        a.name,
        a.due_at as dueAt,
        a.first_seen_at as firstSeenAt,
        c.course_code as courseCode,
        c.name as courseName
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      WHERE datetime(a.first_seen_at) > datetime('now', '-48 hours')
      ORDER BY datetime(a.first_seen_at) DESC
    `)
    .all();

  res.json({ assignments: rows });
});

app.get("/api/courses", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT id, name, course_code as courseCode, term
      FROM courses
      WHERE is_active = 1
      ORDER BY name ASC
    `)
    .all();

  res.json({ courses: rows });
});

app.post("/api/query", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const response = await handleQuery(message);
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/sync", async (_req, res) => {
  try {
    const found = await pollForNewAssignments();
    res.json({ newAssignments: found.length, message: found.length ? `Done — ${found.length} new assignments found` : "Done — nothing new" });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/settings", (req, res) => {
  try {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    if (!key) {
      res.status(400).json({ error: "key is required" });
      return;
    }

    if (key === "SEND_TEST_MESSAGE") {
      sendMessage("GradeGuard test notification from dashboard.")
        .then(() => res.json({ ok: true, key }))
        .catch((error) => {
          res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
        });
      return;
    }

    if (key === "DIGEST_SCHEDULE_CRON") {
      const cronExpression = value.match(/^\d{2}:\d{2}$/) ? timeValueToCron(value) : value.trim();
      updateEnvValue(key, cronExpression || "0 8 * * *");
      scheduleDailyDigest(cronExpression || "0 8 * * *");
      runDailyDigestCatchupCheck();
    } else {
      updateEnvValue(key, value);
    }

    res.json({ ok: true, key });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/syllabus", upload.single("file"), async (req, res) => {
  try {
    const course = typeof req.body?.course === "string" ? req.body.course.trim() : "";
    if (!course) {
      res.status(400).json({ error: "course is required" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }

    const parsedPdf = await pdfParse(req.file.buffer);
    const items = await extractSyllabusItemsFromText(parsedPdf.text || "");
    const { plan, applyResult } = planAndApplySyllabusItems(items, { apply: true });

    insertUploadedSyllabus(course);

    res.json({
      found: items.length,
      matched: plan.matches.length,
      applied: applyResult?.updatedRows ?? 0,
      message: `Found ${items.length} items for ${course}. Added to your schedule.`
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/status", (_req, res) => {
  res.json(getStatusPayload());
});

app.use((_req, res) => {
  const htmlPath = path.join(publicDir, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const bootJson = JSON.stringify(getUiBootPayload());
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html.replace("__GRADEGUARD_BOOT__", bootJson));
});

app.listen(port, () => {
  ensureUiTables();
  scheduleDailyDigest(getDigestCronExpression());
  startDailyDigestCatchupWatcher();
  runDailyDigestCatchupCheck();
  scheduleAssignmentPolling(getHeartbeatCronExpression());
  console.log(`GradeGuard UI running at http://localhost:${port}`);
});
