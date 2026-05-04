import { spawn } from "node:child_process";
import { logInfo, logWarn } from "./logger";
import { loadEnv } from "./loadEnv";
import type { Assignment } from "./types";

loadEnv();

const IMESSAGE_APPLESCRIPT = `
on run argv
  set targetHandle to item 1 of argv
  set outgoingText to item 2 of argv
  tell application "Messages"
    if not running then
      launch
      delay 0.2
    end if
    set allAccounts to every account whose service type = iMessage
    set delivered to false
    set lastErr to ""
    repeat with acc in allAccounts
      try
        if enabled of acc is false then error "account disabled"
        set targetParticipant to participant targetHandle of acc
        send outgoingText to targetParticipant
        set delivered to true
        exit repeat
      on error errText number errNum
        set lastErr to errText & " (" & errNum & ")"
      end try
    end repeat
  end tell
  if delivered is false then error "iMessage delivery failed for " & targetHandle & ". " & lastErr
end run
`;

const IMESSAGE_MAX_CHARS = 1200;
const IMESSAGE_FAILURE_WARN_THRESHOLD = 3;
let consecutiveIMessageFailures = 0;

function formatDue(dueAt: string): string {
  return new Date(dueAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getOpenClawRoute():
  | { channel: string; target: string; account?: string }
  | null {
  const channel = process.env.OPENCLAW_CHANNEL?.trim() || "discord";
  const target = process.env.OPENCLAW_TARGET?.trim() || "";
  const account = process.env.OPENCLAW_ACCOUNT?.trim() || "";

  if (!channel || !target) {
    return null;
  }

  return account ? { channel, target, account } : { channel, target };
}

function getIMessageTarget(): string | null {
  const target = process.env.IMESSAGE_TARGET?.trim() || "";
  return target ? target : null;
}

function normalizeIMessageTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) {
    return trimmed;
  }
  return hasPlus ? `+${digits}` : digits;
}

function chunkTextForIMessage(text: string): string[] {
  if (text.length <= IMESSAGE_MAX_CHARS) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > IMESSAGE_MAX_CHARS) {
    const slice = remaining.slice(0, IMESSAGE_MAX_CHARS);
    const splitAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const end = splitAt > 200 ? splitAt : IMESSAGE_MAX_CHARS;
    chunks.push(remaining.slice(0, end).trimEnd());
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining.length) {
    chunks.push(remaining);
  }
  return chunks;
}

function runOpenClawMessageSend(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env } as NodeJS.ProcessEnv;
    // Let OpenClaw CLI use its own configured gateway transport unless explicitly
    // overridden in the user's shell. Project-level env URL overrides can force an
    // incompatible transport and lead to generic fetch failures.
    delete childEnv.OPENCLAW_GATEWAY_URL;

    // The OpenClaw CLI expects OPENCLAW_GATEWAY_TOKEN for explicit gateway URL overrides.
    if (!childEnv.OPENCLAW_GATEWAY_TOKEN && childEnv.OPENCLAW_SKILL_SECRET) {
      childEnv.OPENCLAW_GATEWAY_TOKEN = childEnv.OPENCLAW_SKILL_SECRET;
    }

    const child = spawn("openclaw", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `openclaw message send failed (exit ${code ?? "unknown"})`));
    });
  });
}

function runIMessageSend(target: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", IMESSAGE_APPLESCRIPT, target, text], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `osascript iMessage send failed (exit ${code ?? "unknown"})`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(args: string[], maxAttempts = 2): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runOpenClawMessageSend(args);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        logWarn("notifier_retry", {
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error)
        });
        await sleep(300 * attempt);
      }
    }
  }
  throw lastError;
}

async function sendOpenClawMessageIfConfigured(text: string): Promise<boolean> {
  const route = getOpenClawRoute();
  if (!route) {
    return false;
  }

  const args = [
    "message",
    "send",
    "--channel",
    route.channel,
    "--target",
    route.target,
    "--message",
    text
  ];

  if (route.account) {
    args.push("--account", route.account);
  }

  await sendWithRetry(args);
  logInfo("notifier_send_complete", { channel: route.channel });
  return true;
}

async function sendIMessageDigestIfConfigured(text: string): Promise<boolean> {
  const target = getIMessageTarget();
  if (!target) {
    return false;
  }
  const normalizedTarget = normalizeIMessageTarget(target);
  const chunks = chunkTextForIMessage(text);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      for (const chunk of chunks) {
        await runIMessageSend(normalizedTarget, chunk);
        await sleep(120);
      }
      if (consecutiveIMessageFailures > 0) {
        logInfo("imessage_recovered_after_failures", {
          previousConsecutiveFailures: consecutiveIMessageFailures
        });
      }
      consecutiveIMessageFailures = 0;
      logInfo("imessage_send_complete", { target: normalizedTarget, chunks: chunks.length });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        logWarn("imessage_retry", {
          attempt,
          maxAttempts: 2,
          message: error instanceof Error ? error.message : String(error)
        });
        await sleep(300 * attempt);
      }
    }
  }

  consecutiveIMessageFailures += 1;
  if (consecutiveIMessageFailures >= IMESSAGE_FAILURE_WARN_THRESHOLD) {
    logWarn("imessage_reliability_warning", {
      consecutiveFailures: consecutiveIMessageFailures,
      recommendation:
        "Restart GradeGuard UI process and re-open Messages app. Verify Mac/iPhone iMessage Send & Receive addresses match."
    });
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function sendMessage(text: string): Promise<void> {
  const sent = await sendOpenClawMessageIfConfigured(text);
  if (!sent) {
    logWarn("notifier_fallback", { reason: "missing_route", hasText: Boolean(text) });
    console.log(`[notifier:fallback] ${text}`);
  }
}

export async function notifyNewAssignment(assignment: Assignment): Promise<void> {
  const message = `New assignment detected:\n"${assignment.name}" — due ${formatDue(
    assignment.dueAt
  )}\nAdded to your Google Calendar.`;
  await sendMessage(message);
}

export async function sendDigest(digestText: string): Promise<void> {
  await sendAcrossRoutes(digestText);
}

export async function sendMultiRouteTestMessage(text: string): Promise<void> {
  await sendAcrossRoutes(text);
}

async function sendAcrossRoutes(text: string): Promise<void> {
  const errors: string[] = [];
  let delivered = false;

  try {
    const sentToOpenClaw = await sendOpenClawMessageIfConfigured(text);
    delivered = delivered || sentToOpenClaw;
  } catch (error) {
    errors.push(`OpenClaw: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const sentToIMessage = await sendIMessageDigestIfConfigured(text);
    delivered = delivered || sentToIMessage;
  } catch (error) {
    errors.push(`iMessage: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!delivered && errors.length === 0) {
    logWarn("digest_delivery_fallback", { reason: "no_routes", hasText: Boolean(text) });
    console.log(`[notifier:fallback] ${text}`);
    return;
  }

  if (!delivered) {
    throw new Error(`Digest delivery failed: ${errors.join(" | ")}`);
  }

  if (errors.length) {
    logWarn("digest_partial_delivery", { errors });
  }
}
