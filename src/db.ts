import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Assignment, AssignmentWithCourse, Course } from "./types";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "college_manager.db");

export type DbHandle = Database.Database;
export interface IMessageOutboxItem {
  id: number;
  kind: string;
  dedupeKey: string;
  content: string;
  status: "pending" | "delivered";
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
}

let db: DbHandle | null = null;

function toDbDate(isoString: string | null): string | null {
  if (!isoString) {
    return null;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function getDb(dbPath = DEFAULT_DB_PATH): DbHandle {
  if (!db) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    initDb(db);
  }
  return db;
}

export function initDb(database: DbHandle): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      course_code   TEXT,
      term          TEXT,
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id                TEXT PRIMARY KEY,
      course_id         TEXT NOT NULL,
      name              TEXT NOT NULL,
      description       TEXT,
      due_at            TEXT,
      points_possible   REAL,
      submission_types  TEXT,
      is_submitted      INTEGER DEFAULT 0,
      calendar_event_id TEXT,
      first_seen_at     TEXT DEFAULT (datetime('now')),
      notified_at       TEXT,
      FOREIGN KEY (course_id) REFERENCES courses(id)
    );

    CREATE TABLE IF NOT EXISTS digests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at     TEXT DEFAULT (datetime('now')),
      type        TEXT,
      content     TEXT
    );

    CREATE TABLE IF NOT EXISTS digest_deliveries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL,
      delivered_at  TEXT DEFAULT (datetime('now')),
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS imessage_outbox (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      kind            TEXT NOT NULL,
      dedupe_key      TEXT NOT NULL UNIQUE,
      content         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      attempt_count   INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      delivered_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_due_at ON assignments(due_at);
    CREATE INDEX IF NOT EXISTS idx_assignments_course_id ON assignments(course_id);
    CREATE INDEX IF NOT EXISTS idx_digest_deliveries_type_time ON digest_deliveries(type, delivered_at DESC);
    CREATE INDEX IF NOT EXISTS idx_imessage_outbox_status_created ON imessage_outbox(status, created_at);
  `);
}

export function upsertCourse(course: Pick<Course, "id" | "name" | "courseCode" | "term">): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO courses (id, name, course_code, term, is_active)
    VALUES (@id, @name, @courseCode, @term, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      course_code = excluded.course_code,
      term = excluded.term,
      is_active = 1
  `);

  stmt.run({
    id: course.id,
    name: course.name,
    courseCode: course.courseCode ?? null,
    term: course.term ?? null
  });
}

export function upsertAssignment(assignment: Assignment): void {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO assignments (
      id,
      course_id,
      name,
      description,
      due_at,
      points_possible,
      submission_types,
      is_submitted,
      calendar_event_id,
      notified_at
    )
    VALUES (
      @id,
      @courseId,
      @name,
      @description,
      @dueAt,
      @pointsPossible,
      @submissionTypes,
      @isSubmitted,
      @calendarEventId,
      @notifiedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      course_id = excluded.course_id,
      name = excluded.name,
      description = excluded.description,
      due_at = excluded.due_at,
      points_possible = COALESCE(assignments.points_possible, excluded.points_possible),
      submission_types = COALESCE(assignments.submission_types, excluded.submission_types)
  `);

  stmt.run({
    id: assignment.id,
    courseId: assignment.courseId,
    name: assignment.name,
    description: assignment.description,
    dueAt: toDbDate(assignment.dueAt),
    pointsPossible: assignment.pointsPossible,
    submissionTypes: assignment.submissionTypes,
    isSubmitted: assignment.isSubmitted,
    calendarEventId: assignment.calendarEventId,
    notifiedAt: toDbDate(assignment.notifiedAt)
  });
}

export function assignmentExists(assignmentId: string): boolean {
  const database = getDb();
  const row = database
    .prepare("SELECT 1 FROM assignments WHERE id = ? LIMIT 1")
    .get(assignmentId) as { 1: number } | undefined;
  return Boolean(row);
}

export function getAllAssignmentIds(): Set<string> {
  const database = getDb();
  const rows = database.prepare("SELECT id FROM assignments").all() as { id: string }[];
  return new Set(rows.map((row) => row.id));
}

export function listAssignments(): Assignment[] {
  const database = getDb();
  const rows = database
    .prepare(`
      SELECT
        id,
        course_id as courseId,
        name,
        description,
        due_at as dueAt,
        points_possible as pointsPossible,
        submission_types as submissionTypes,
        is_submitted as isSubmitted,
        calendar_event_id as calendarEventId,
        notified_at as notifiedAt
      FROM assignments
      ORDER BY due_at ASC
    `)
    .all() as Assignment[];
  return rows;
}

export function listAssignmentsMissingCalendarEvent(): Assignment[] {
  const database = getDb();
  const rows = database
    .prepare(`
      SELECT
        id,
        course_id as courseId,
        name,
        description,
        due_at as dueAt,
        points_possible as pointsPossible,
        submission_types as submissionTypes,
        is_submitted as isSubmitted,
        calendar_event_id as calendarEventId,
        notified_at as notifiedAt
      FROM assignments
      WHERE calendar_event_id IS NULL
      ORDER BY due_at ASC
    `)
    .all() as Assignment[];
  return rows;
}

export function setAssignmentCalendarEventId(assignmentId: string, calendarEventId: string): void {
  const database = getDb();
  database
    .prepare(`
      UPDATE assignments
      SET calendar_event_id = @calendarEventId
      WHERE id = @assignmentId
    `)
    .run({ assignmentId, calendarEventId });
}

export function listAssignmentsBetween(startIso: string, endIso: string): AssignmentWithCourse[] {
  const database = getDb();
  return database
    .prepare(`
      SELECT
        a.id,
        a.course_id as courseId,
        a.name,
        a.description,
        a.due_at as dueAt,
        a.points_possible as pointsPossible,
        a.submission_types as submissionTypes,
        a.is_submitted as isSubmitted,
        a.calendar_event_id as calendarEventId,
        a.notified_at as notifiedAt,
        c.name as courseName,
        c.course_code as courseCode
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      WHERE a.due_at IS NOT NULL
        AND a.due_at >= @startIso
        AND a.due_at <= @endIso
      ORDER BY a.due_at ASC
    `)
    .all({ startIso, endIso }) as AssignmentWithCourse[];
}

export function listOverdueAssignments(nowIso = new Date().toISOString()): AssignmentWithCourse[] {
  const database = getDb();
  return database
    .prepare(`
      SELECT
        a.id,
        a.course_id as courseId,
        a.name,
        a.description,
        a.due_at as dueAt,
        a.points_possible as pointsPossible,
        a.submission_types as submissionTypes,
        a.is_submitted as isSubmitted,
        a.calendar_event_id as calendarEventId,
        a.notified_at as notifiedAt,
        c.name as courseName,
        c.course_code as courseCode
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      WHERE a.due_at IS NOT NULL
        AND a.due_at < @nowIso
        AND a.is_submitted = 0
      ORDER BY a.due_at DESC
    `)
    .all({ nowIso }) as AssignmentWithCourse[];
}

export function listAssignmentSnapshotForLlm(): AssignmentWithCourse[] {
  const database = getDb();
  return database
    .prepare(`
      SELECT
        a.id,
        a.course_id as courseId,
        a.name,
        a.description,
        a.due_at as dueAt,
        a.points_possible as pointsPossible,
        a.submission_types as submissionTypes,
        a.is_submitted as isSubmitted,
        a.calendar_event_id as calendarEventId,
        a.notified_at as notifiedAt,
        c.name as courseName,
        c.course_code as courseCode
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      ORDER BY a.due_at ASC
    `)
    .all() as AssignmentWithCourse[];
}

export function insertDigest(type: "daily" | "weekly", content: string): void {
  const database = getDb();
  database
    .prepare(`
      INSERT INTO digests (type, content)
      VALUES (@type, @content)
    `)
    .run({ type, content });
}

export function wasDigestSentToday(type: "daily" | "weekly"): boolean {
  const database = getDb();
  const row = database
    .prepare(`
      SELECT COUNT(*) as count
      FROM digests
      WHERE type = @type
        AND date(sent_at, 'localtime') = date('now', 'localtime')
    `)
    .get({ type }) as { count: number };
  return row.count > 0;
}

export function insertDigestDelivery(
  type: "daily" | "weekly",
  status: "success" | "failed",
  errorMessage: string | null = null
): void {
  const database = getDb();
  database
    .prepare(`
      INSERT INTO digest_deliveries (type, status, error_message)
      VALUES (@type, @status, @errorMessage)
    `)
    .run({ type, status, errorMessage });
}

export function wasDigestDeliveredToday(type: "daily" | "weekly"): boolean {
  const database = getDb();
  const row = database
    .prepare(`
      SELECT COUNT(*) as count
      FROM digest_deliveries
      WHERE type = @type
        AND status = 'success'
        AND date(delivered_at, 'localtime') = date('now', 'localtime')
    `)
    .get({ type }) as { count: number };
  return row.count > 0;
}

export function queueIMessageOutbox(kind: string, dedupeKey: string, content: string): void {
  const database = getDb();
  database
    .prepare(`
      INSERT INTO imessage_outbox (kind, dedupe_key, content, status, attempt_count, last_error, last_attempt_at, delivered_at)
      VALUES (@kind, @dedupeKey, @content, 'pending', 0, NULL, NULL, NULL)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        content = excluded.content,
        status = CASE
          WHEN imessage_outbox.status = 'delivered' THEN imessage_outbox.status
          ELSE 'pending'
        END
    `)
    .run({ kind, dedupeKey, content });
}

export function listPendingIMessageOutbox(limit = 10): IMessageOutboxItem[] {
  const database = getDb();
  return database
    .prepare(`
      SELECT
        id,
        kind,
        dedupe_key as dedupeKey,
        content,
        status,
        attempt_count as attemptCount,
        last_error as lastError,
        created_at as createdAt,
        last_attempt_at as lastAttemptAt,
        delivered_at as deliveredAt
      FROM imessage_outbox
      WHERE status = 'pending'
        AND delivered_at IS NULL
      ORDER BY datetime(created_at) ASC
      LIMIT @limit
    `)
    .all({ limit }) as IMessageOutboxItem[];
}

export function markIMessageOutboxDelivered(id: number): void {
  const database = getDb();
  database
    .prepare(`
      UPDATE imessage_outbox
      SET
        status = 'delivered',
        delivered_at = datetime('now'),
        last_attempt_at = datetime('now'),
        last_error = NULL
      WHERE id = @id
    `)
    .run({ id });
}

export function markIMessageOutboxFailedAttempt(id: number, errorMessage: string): void {
  const database = getDb();
  database
    .prepare(`
      UPDATE imessage_outbox
      SET
        attempt_count = attempt_count + 1,
        last_attempt_at = datetime('now'),
        last_error = @errorMessage
      WHERE id = @id
    `)
    .run({ id, errorMessage });
}

export function listOverdueUnnotifiedAssignments(nowIso = new Date().toISOString()): AssignmentWithCourse[] {
  const database = getDb();
  return database
    .prepare(`
      SELECT
        a.id,
        a.course_id as courseId,
        a.name,
        a.description,
        a.due_at as dueAt,
        a.points_possible as pointsPossible,
        a.submission_types as submissionTypes,
        a.is_submitted as isSubmitted,
        a.calendar_event_id as calendarEventId,
        a.notified_at as notifiedAt,
        c.name as courseName,
        c.course_code as courseCode
      FROM assignments a
      JOIN courses c ON c.id = a.course_id
      WHERE a.is_submitted = 0
        AND a.due_at IS NOT NULL
        AND a.due_at < @nowIso
        AND a.notified_at IS NULL
      ORDER BY a.due_at ASC
    `)
    .all({ nowIso }) as AssignmentWithCourse[];
}

export function markAssignmentNotified(assignmentId: string): void {
  const database = getDb();
  database
    .prepare(`
      UPDATE assignments
      SET notified_at = datetime('now')
      WHERE id = @assignmentId
    `)
    .run({ assignmentId });
}

export function updateAssignmentSyllabusData(
  assignmentId: string,
  data: { pointsPossible: number | null; submissionTypes: string | null },
  force = false
): number {
  const database = getDb();
  const result = database
    .prepare(`
      UPDATE assignments
      SET
        points_possible = CASE
          WHEN @force = 1 THEN @pointsPossible
          ELSE COALESCE(points_possible, @pointsPossible)
        END,
        submission_types = CASE
          WHEN @force = 1 THEN @submissionTypes
          ELSE COALESCE(submission_types, @submissionTypes)
        END
      WHERE id = @assignmentId
    `)
    .run({
      assignmentId,
      pointsPossible: data.pointsPossible,
      submissionTypes: data.submissionTypes,
      force: force ? 1 : 0
    });
  return result.changes;
}
