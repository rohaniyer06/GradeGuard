import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { logInfo, logWarn } from "./logger";
import type { Assignment } from "./types";

dotenv.config();

function formatDue(dueAt: string): string {
  return new Date(dueAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getMessageRoute():
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

export async function sendMessage(text: string): Promise<void> {
  const route = getMessageRoute();
  if (!route) {
    logWarn("notifier_fallback", { reason: "missing_route", hasText: Boolean(text) });
    console.log(`[notifier:fallback] ${text}`);
    return;
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
}

export async function notifyNewAssignment(assignment: Assignment): Promise<void> {
  const message = `New assignment detected:\n"${assignment.name}" — due ${formatDue(
    assignment.dueAt
  )}\nAdded to your Google Calendar.`;
  await sendMessage(message);
}

export async function sendDigest(digestText: string): Promise<void> {
  await sendMessage(digestText);
}
