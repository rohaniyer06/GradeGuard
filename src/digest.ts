import { insertDigest, listAssignmentsBetween } from "./db";
import { generateText, isLlmConfigured } from "./llm";

function now(): Date {
  return new Date();
}

function plusHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function plusDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function fallbackDigest(title: string, windowLabel: string, data: unknown[]): string {
  if (data.length === 0) {
    return `${title}\nNo assignments due ${windowLabel}.`;
  }
  const lines = data.slice(0, 12).map((item: any) => {
    const due = new Date(item.dueAt).toLocaleString();
    return `- ${item.name} (${item.courseName}) due ${due}`;
  });
  return `${title}\n${lines.join("\n")}`;
}

export async function generateDailyDigest(): Promise<string> {
  const start = now();
  const end = plusHours(start, 48);
  const upcoming = listAssignmentsBetween(start.toISOString(), end.toISOString());

  if (!isLlmConfigured()) {
    const fallback = fallbackDigest("Daily Digest", "in the next 48 hours", upcoming);
    insertDigest("daily", fallback);
    return fallback;
  }

  const prompt = `You are a proactive academic assistant for a college student.

Here is their upcoming assignment data (JSON):
${JSON.stringify(upcoming, null, 2)}

Generate a concise, friendly daily digest. Include:
1. Assignments due in the next 48 hours (sorted by urgency)
2. A one-line workload warning if any single day has 3+ items due
3. The next exam or quiz, if one exists within 7 days

Format as plain text suitable for an iMessage. No markdown. Be brief.`;

  const digest = await generateText(prompt);
  insertDigest("daily", digest);
  return digest;
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

  const prompt = `You are a proactive academic assistant for a college student.

Here is their upcoming assignment data (JSON):
${JSON.stringify(upcoming, null, 2)}

Generate a concise weekly digest. Include:
1. All assignments due this week sorted by date
2. Workload distribution by day and identify heavy days
3. Flag any day with 3+ deadlines as a danger zone

Format as plain text suitable for an iMessage. No markdown. Be brief and specific.`;

  const digest = await generateText(prompt);
  insertDigest("weekly", digest);
  return digest;
}
