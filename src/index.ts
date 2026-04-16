import dotenv from "dotenv";
import { pollForNewAssignments } from "./icalPoller";
import { syncAllToCalendar } from "./calendarSync";
import { generateDailyDigest } from "./digest";
import { listOverdueUnnotifiedAssignments, markAssignmentNotified, wasDigestSentToday } from "./db";
import { notifyNewAssignment, sendDigest, sendMessage } from "./notifier";

dotenv.config();

function getTimezone(): string {
  return process.env.TIMEZONE?.trim() || "America/Los_Angeles";
}

function getLocalTimeParts(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return { hour, minute };
}

function parseDailyDigestSchedule(): { hour: number; minute: number } {
  const cron = process.env.DIGEST_SCHEDULE_CRON?.trim() || "0 8 * * *";
  const [minutePart, hourPart] = cron.split(/\s+/);
  const minute = Number.parseInt(minutePart ?? "0", 10);
  const hour = Number.parseInt(hourPart ?? "8", 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return { hour: 8, minute: 0 };
  }
  return { hour, minute };
}

function shouldSendDailyDigestNow(): boolean {
  if (wasDigestSentToday("daily")) {
    return false;
  }
  const schedule = parseDailyDigestSchedule();
  const now = getLocalTimeParts(new Date(), getTimezone());
  const nowMinutes = now.hour * 60 + now.minute;
  const scheduledMinutes = schedule.hour * 60 + schedule.minute;
  return nowMinutes >= scheduledMinutes;
}

function formatOverdueReminder(name: string, dueAt: string): string {
  const due = new Date(dueAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  return `Reminder: "${name}" is now overdue (was due ${due}).`;
}

export async function runHeartbeat(): Promise<{
  newAssignments: number;
  overdueNotified: number;
  digestSent: boolean;
}> {
  let newAssignmentsNotified = 0;
  let overdueNotified = 0;
  let digestSent = false;

  const newAssignments = await pollForNewAssignments();
  await syncAllToCalendar();

  for (const assignment of newAssignments) {
    await notifyNewAssignment(assignment);
    newAssignmentsNotified += 1;
  }

  if (shouldSendDailyDigestNow()) {
    const digest = await generateDailyDigest();
    await sendDigest(digest);
    digestSent = true;
  }

  const overdue = listOverdueUnnotifiedAssignments();
  for (const assignment of overdue) {
    await sendMessage(formatOverdueReminder(assignment.name, assignment.dueAt));
    markAssignmentNotified(assignment.id);
    overdueNotified += 1;
  }

  if (newAssignmentsNotified === 0 && overdueNotified === 0 && !digestSent) {
    console.log("HEARTBEAT_OK");
  }

  return {
    newAssignments: newAssignmentsNotified,
    overdueNotified,
    digestSent
  };
}

async function main(): Promise<void> {
  const result = await runHeartbeat();
  console.log(
    JSON.stringify(
      {
        event: "heartbeat_complete",
        ...result
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error("heartbeat_failed", error);
    process.exit(1);
  });
}
