import { insertDigest, listAssignmentsBetween } from "./db";
import { generateText, isLlmConfigured } from "./llm";
import { formatMetadataSuffix } from "./syllabusMetadata";

function now(): Date {
  return new Date();
}

function plusHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function plusDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function getTimezone(): string {
  return process.env.TIMEZONE?.trim() || "America/Los_Angeles";
}

function formatDueInTimezone(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getTimezone()
  });
}

function fallbackDigest(title: string, windowLabel: string, data: unknown[]): string {
  if (data.length === 0) {
    return `${title}\nNo assignments due ${windowLabel}.`;
  }
  const lines = data.slice(0, 12).map((item: any) => {
    const due = formatDueInTimezone(item.dueAt);
    const meta = formatMetadataSuffix({
      pointsPossible: item.pointsPossible,
      submissionTypes: item.submissionTypes
    });
    return `- ${item.name} (${item.courseName}) due ${due}${meta}`;
  });
  return `${title}\n${lines.join("\n")}`;
}

function fallbackDailyDigestWithNextDue(start: Date): string {
  const searchEnd = plusDays(start, 90);
  const future = listAssignmentsBetween(start.toISOString(), searchEnd.toISOString());
  const next = future[0];

  if (!next) {
    return "Daily Digest\nNo assignments due in the next 48 hours.\nNext assignment: none scheduled.";
  }

  const due = formatDueInTimezone(next.dueAt);
  const meta = formatMetadataSuffix({
    pointsPossible: next.pointsPossible,
    submissionTypes: next.submissionTypes
  });
  return `Daily Digest\nNo assignments due in the next 48 hours.\nNext assignment: ${next.name} (${next.courseName}) due ${due}${meta}.`;
}

function looksLikeNoDataLlmReply(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("don't see any data") ||
    normalized.includes("do not see any data") ||
    normalized.includes("share the actual assignment data") ||
    normalized.includes("please provide the data")
  );
}

export async function generateDailyDigest(): Promise<string> {
  const start = now();
  const end = plusHours(start, 48);
  const upcoming = listAssignmentsBetween(start.toISOString(), end.toISOString());

  // Keep empty-window output deterministic to avoid unhelpful LLM "no data" responses.
  if (upcoming.length === 0) {
    const fallback = fallbackDailyDigestWithNextDue(start);
    insertDigest("daily", fallback);
    return fallback;
  }

  if (!isLlmConfigured()) {
    const fallback = fallbackDigest("Daily Digest", "in the next 48 hours", upcoming);
    insertDigest("daily", fallback);
    return fallback;
  }

  const upcomingForPrompt = upcoming.map((item: any) => ({
    ...item,
    dueAtLocal: formatDueInTimezone(item.dueAt),
    dueTimezone: getTimezone()
  }));

  const prompt = `You are a proactive academic assistant for a college student.
Use the dueAtLocal field as the source of truth for displayed due times.
The student's timezone is ${getTimezone()}.

Here is their upcoming assignment data (JSON):
${JSON.stringify(upcomingForPrompt, null, 2)}

Generate a concise, friendly daily digest. Include:
1. Assignments due in the next 48 hours (sorted by urgency)
2. A one-line workload warning if any single day has 3+ items due
3. The next exam or quiz, if one exists within 7 days

Format as plain text suitable for an iMessage. No markdown. Be brief.`;

  const digest = await generateText(prompt);
  const finalDigest = looksLikeNoDataLlmReply(digest)
    ? fallbackDigest("Daily Digest", "in the next 48 hours", upcoming)
    : digest;
  insertDigest("daily", finalDigest);
  return finalDigest;
}

export async function generateWeeklyDigest(): Promise<string> {
  const start = now();
  const end = plusDays(start, 7);
  const upcoming = listAssignmentsBetween(start.toISOString(), end.toISOString());

  if (!isLlmConfigured()) {
    const fallback = fallbackDigest("Weekly Digest", "this week", upcoming);
    insertDigest("weekly", fallback);
    return fallback;
  }

  const upcomingForPrompt = upcoming.map((item: any) => ({
    ...item,
    dueAtLocal: formatDueInTimezone(item.dueAt),
    dueTimezone: getTimezone()
  }));

  const prompt = `You are a proactive academic assistant for a college student.
Use the dueAtLocal field as the source of truth for displayed due times.
The student's timezone is ${getTimezone()}.

Here is their upcoming assignment data (JSON):
${JSON.stringify(upcomingForPrompt, null, 2)}

Generate a concise weekly digest. Include:
1. All assignments due this week sorted by date
2. Workload distribution by day and identify heavy days
3. Flag any day with 3+ deadlines as a danger zone

Format as plain text suitable for an iMessage. No markdown. Be brief and specific.`;

  const digest = await generateText(prompt);
  insertDigest("weekly", digest);
  return digest;
}
