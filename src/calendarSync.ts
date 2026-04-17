import dotenv from "dotenv";
import { google } from "googleapis";
import { listAssignments, listAssignmentsMissingCalendarEvent, setAssignmentCalendarEventId } from "./db";
import { logInfo, logWarn } from "./logger";
import type { Assignment } from "./types";

dotenv.config();

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is not configured.`);
  }
  return value.trim();
}

function getOauthClient() {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");
  const refreshToken = requireEnv("GOOGLE_REFRESH_TOKEN");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function getCalendarClient() {
  const auth = getOauthClient();
  return google.calendar({ version: "v3", auth });
}

function buildEventPayload(assignment: Assignment) {
  const calendarTimeZone = process.env.TIMEZONE?.trim() || "America/Los_Angeles";
  return {
    summary: assignment.name,
    description: assignment.description ?? "",
    start: { dateTime: assignment.dueAt, timeZone: calendarTimeZone },
    end: { dateTime: assignment.dueAt, timeZone: calendarTimeZone },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup" as const, minutes: 24 * 60 },
        { method: "popup" as const, minutes: 60 }
      ]
    }
  };
}

function getTargetCalendarId(): string {
  return process.env.TARGET_CALENDAR_ID?.trim() || "primary";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableGoogleError(error: unknown): boolean {
  const status = (error as { code?: number; response?: { status?: number } })?.code ??
    (error as { response?: { status?: number } })?.response?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

async function withRetry<T>(label: string, operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retriable = isRetriableGoogleError(error);
      if (attempt < maxAttempts && retriable) {
        logWarn("calendar_retry", {
          label,
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error)
        });
        await sleep(500 * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function createCalendarEvent(assignment: Assignment): Promise<string> {
  const calendar = getCalendarClient();
  const response = await withRetry(`create:${assignment.id}`, () =>
    calendar.events.insert({
      calendarId: getTargetCalendarId(),
      requestBody: buildEventPayload(assignment)
    })
  );

  const eventId = response.data.id;
  if (!eventId) {
    throw new Error(`Google Calendar did not return an event ID for assignment ${assignment.id}.`);
  }

  return eventId;
}

export async function updateCalendarEvent(eventId: string, assignment: Assignment): Promise<void> {
  const calendar = getCalendarClient();
  await withRetry(`update:${assignment.id}`, () =>
    calendar.events.update({
      calendarId: getTargetCalendarId(),
      eventId,
      requestBody: buildEventPayload(assignment)
    })
  );
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const calendar = getCalendarClient();
  await withRetry(`delete:${eventId}`, () =>
    calendar.events.delete({
      calendarId: getTargetCalendarId(),
      eventId
    })
  );
}

export async function syncAllToCalendar(): Promise<void> {
  // Touching this early ensures we fail fast with a clear message if auth is not ready.
  requireEnv("GOOGLE_REFRESH_TOKEN");
  requireEnv("GOOGLE_CLIENT_ID");
  requireEnv("GOOGLE_CLIENT_SECRET");
  requireEnv("GOOGLE_REDIRECT_URI");

  const unsyncedAssignments = listAssignmentsMissingCalendarEvent();
  let syncedCount = 0;
  for (const assignment of unsyncedAssignments) {
    const eventId = await createCalendarEvent(assignment);
    setAssignmentCalendarEventId(assignment.id, eventId);
    syncedCount += 1;
  }
  logInfo("calendar_sync_complete", { unsynced: unsyncedAssignments.length, created: syncedCount });
}

export async function reconcileAllCalendarEvents(): Promise<{ created: number; updated: number }> {
  requireEnv("GOOGLE_REFRESH_TOKEN");
  requireEnv("GOOGLE_CLIENT_ID");
  requireEnv("GOOGLE_CLIENT_SECRET");
  requireEnv("GOOGLE_REDIRECT_URI");

  const assignments = listAssignments();
  let created = 0;
  let updated = 0;

  for (const assignment of assignments) {
    if (assignment.calendarEventId) {
      await updateCalendarEvent(assignment.calendarEventId, assignment);
      updated += 1;
      continue;
    }

    const eventId = await createCalendarEvent(assignment);
    setAssignmentCalendarEventId(assignment.id, eventId);
    created += 1;
  }

  logInfo("calendar_reconcile_complete", {
    total: assignments.length,
    created,
    updated
  });

  return { created, updated };
}

export function getGoogleCalendarScope(): string {
  return GOOGLE_CALENDAR_SCOPE;
}
