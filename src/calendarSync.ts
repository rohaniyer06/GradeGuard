import dotenv from "dotenv";
import { google } from "googleapis";
import { listAssignments, listAssignmentsMissingCalendarEvent, setAssignmentCalendarEventId } from "./db";
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

export async function createCalendarEvent(assignment: Assignment): Promise<string> {
  const calendar = getCalendarClient();
  const response = await calendar.events.insert({
    calendarId: getTargetCalendarId(),
    requestBody: buildEventPayload(assignment)
  });

  const eventId = response.data.id;
  if (!eventId) {
    throw new Error(`Google Calendar did not return an event ID for assignment ${assignment.id}.`);
  }

  return eventId;
}

export async function updateCalendarEvent(eventId: string, assignment: Assignment): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.update({
    calendarId: getTargetCalendarId(),
    eventId,
    requestBody: buildEventPayload(assignment)
  });
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: getTargetCalendarId(),
    eventId
  });
}

export async function syncAllToCalendar(): Promise<void> {
  // Touching this early ensures we fail fast with a clear message if auth is not ready.
  requireEnv("GOOGLE_REFRESH_TOKEN");
  requireEnv("GOOGLE_CLIENT_ID");
  requireEnv("GOOGLE_CLIENT_SECRET");
  requireEnv("GOOGLE_REDIRECT_URI");

  const unsyncedAssignments = listAssignmentsMissingCalendarEvent();
  for (const assignment of unsyncedAssignments) {
    const eventId = await createCalendarEvent(assignment);
    setAssignmentCalendarEventId(assignment.id, eventId);
  }
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

  return { created, updated };
}

export function getGoogleCalendarScope(): string {
  return GOOGLE_CALENDAR_SCOPE;
}
