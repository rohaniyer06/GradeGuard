import ical from "node-ical";
import { getAllAssignmentIds, upsertAssignment, upsertCourse } from "./db";
import { logInfo, logWarn } from "./logger";
import { loadEnv } from "./loadEnv";
import type { Assignment } from "./types";

loadEnv();

interface ICalEventLike {
  type?: string;
  uid?: string;
  summary?: string;
  description?: string;
  start?: Date;
  end?: Date;
  datetype?: string;
}

function toCourseId(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown-course";
}

export function parseCourseFromEvent(event: ICalEventLike): string {
  const summary = event.summary ?? "";
  const fromBracket = summary.match(/\[([^\]]+)\]/)?.[1]?.trim();
  if (fromBracket) {
    return fromBracket;
  }

  const description = event.description ?? "";
  const fromDescription = description.match(/course[:\s]+(.+)/i)?.[1]?.trim();
  if (fromDescription) {
    return fromDescription.split(/\r?\n/)[0].trim();
  }

  return "General";
}

function isDueWithinAllowedWindow(date: Date): boolean {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  return date.getTime() >= sevenDaysAgo;
}

function resolveDueAt(event: ICalEventLike): string {
  if (!(event.start instanceof Date)) {
    throw new Error("Event is missing a valid start date.");
  }

  // Canvas often sends assignment due dates as all-day events with an exclusive end date.
  // For those, treat the due time as 11:59 PM local on the displayed day.
  if (event.datetype === "date" && event.end instanceof Date) {
    return new Date(event.end.getTime() - 60_000).toISOString();
  }

  return event.start.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchIcalRawWithRetry(icalUrl: string, maxAttempts = 3): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await ical.async.fromURL(icalUrl);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        logWarn("ical_fetch_retry", {
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error)
        });
        await sleep(400 * attempt);
      }
    }
  }
  throw lastError;
}

export async function fetchIcalEvents(icalUrl: string): Promise<Assignment[]> {
  if (!icalUrl) {
    throw new Error("fetchIcalEvents requires a valid iCal URL.");
  }

  const parsed = await fetchIcalRawWithRetry(icalUrl);
  const events = Object.values(parsed) as ICalEventLike[];

  return events
    .filter((event) => event.type === "VEVENT" && event.start instanceof Date && !!event.uid)
    .filter((event) => isDueWithinAllowedWindow(event.start as Date))
    .map((event) => {
      const courseName = parseCourseFromEvent(event);
      return {
        id: event.uid as string,
        courseId: toCourseId(courseName),
        name: event.summary?.trim() || "Untitled Assignment",
        description: event.description?.trim() || null,
        dueAt: resolveDueAt(event),
        pointsPossible: null,
        submissionTypes: null,
        isSubmitted: 0,
        calendarEventId: null,
        notifiedAt: null
      } satisfies Assignment;
    });
}

export async function pollForNewAssignments(): Promise<Assignment[]> {
  const icalUrl = process.env.CANVAS_ICAL_URL;
  if (!icalUrl) {
    throw new Error("CANVAS_ICAL_URL is not configured in environment variables.");
  }

  const fetchedAssignments = await fetchIcalEvents(icalUrl);
  const existingIds = getAllAssignmentIds();
  const newAssignments: Assignment[] = [];

  for (const assignment of fetchedAssignments) {
    const bracketCode = assignment.name.match(/\[([^\]]+)\]/)?.[1]?.trim() ?? null;
    const fallbackName = assignment.courseId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const courseName = bracketCode ?? fallbackName;
    upsertCourse({
      id: assignment.courseId,
      name: courseName,
      courseCode: bracketCode,
      term: null
    });

    const isNew = !existingIds.has(assignment.id);
    upsertAssignment(assignment);
    if (isNew) {
      newAssignments.push(assignment);
    }
  }

  logInfo("ical_poll_complete", {
    fetched: fetchedAssignments.length,
    newlyDiscovered: newAssignments.length
  });

  return newAssignments;
}
