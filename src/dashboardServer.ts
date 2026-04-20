import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import dotenv from "dotenv";
import {
  getDb,
  listAssignments,
  listAssignmentsBetween,
  listAssignmentsMissingCalendarEvent,
  listAssignmentSnapshotForLlm,
  listOverdueAssignments
} from "./db";
import { pollForNewAssignments } from "./icalPoller";
import { reconcileAllCalendarEvents, syncAllToCalendar } from "./calendarSync";
import { runHeartbeat } from "./index";
import { handleQuery } from "./queryHandler";
import { generateDailyDigest, generateWeeklyDigest } from "./digest";
import { extractSyllabusItemsFromFile } from "./syllabusParser";
import { applySyllabusEnrichmentPlan, filterPlanByApprovedAssignmentIds, planAndApplySyllabusItems } from "./syllabusEnrichment";
import { logError, logInfo } from "./logger";

dotenv.config();

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const DEFAULT_PORT = Number(process.env.DASHBOARD_PORT || "4177");

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += String(chunk);
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendStatic(res: http.ServerResponse, fileName: string, contentType: string): void {
  const filePath = path.join(PUBLIC_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.end(fs.readFileSync(filePath));
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function getStatusPayload() {
  const now = new Date();
  const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const assignments = listAssignments();
  const dueSoon = listAssignmentsBetween(now.toISOString(), in48Hours.toISOString());
  const overdue = listOverdueAssignments();
  const unsynced = listAssignmentsMissingCalendarEvent();

  const db = getDb();
  const lastDigest = db
    .prepare("SELECT id, type, sent_at as sentAt FROM digests ORDER BY id DESC LIMIT 1")
    .get() as { id: number; type: string; sentAt: string } | undefined;

  return {
    now: now.toISOString(),
    totals: {
      assignments: assignments.length,
      dueSoon48h: dueSoon.length,
      overdue: overdue.length,
      unsyncedCalendar: unsynced.length
    },
    lastDigest: lastDigest ?? null,
    samples: {
      dueSoon: dueSoon.slice(0, 8),
      overdue: overdue.slice(0, 8)
    }
  };
}

function getAssignmentsPayload() {
  return {
    now: new Date().toISOString(),
    assignments: listAssignmentSnapshotForLlm()
  };
}

async function handleAction(action: string, payload: Record<string, unknown>): Promise<unknown> {
  if (action === "poll") {
    const newlyDiscovered = await pollForNewAssignments();
    return { action, newlyDiscovered: newlyDiscovered.length };
  }
  if (action === "sync") {
    await syncAllToCalendar();
    return { action, status: "ok" };
  }
  if (action === "heartbeat") {
    const result = await runHeartbeat();
    return { action, ...result };
  }
  if (action === "reconcileCalendar") {
    const result = await reconcileAllCalendarEvents();
    return { action, ...result };
  }
  if (action === "query") {
    const message = readString(payload.message);
    if (!message) {
      throw new Error("query action requires a non-empty message");
    }
    const answer = await handleQuery(message);
    return { action, message, answer };
  }
  if (action === "digestDaily") {
    const digest = await generateDailyDigest();
    return { action, digestType: "daily", digest };
  }
  if (action === "digestWeekly") {
    const digest = await generateWeeklyDigest();
    return { action, digestType: "weekly", digest };
  }
  if (action === "syllabusPreview" || action === "syllabusApply") {
    const filePath = readString(payload.filePath);
    if (!filePath) {
      throw new Error("syllabus action requires filePath");
    }

    const minScore = readNumber(payload.minScore, 0.45);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
      throw new Error("minScore must be between 0 and 1");
    }

    const force = readBoolean(payload.force);
    const approvedIds = readStringArray(payload.approvedAssignmentIds);
    const items = await extractSyllabusItemsFromFile(filePath);
    const { plan } = planAndApplySyllabusItems(items, { apply: false, minScore });
    const filteredPlan =
      approvedIds.length > 0 ? filterPlanByApprovedAssignmentIds(plan, new Set(approvedIds)) : plan;
    const applyResult = action === "syllabusApply" ? applySyllabusEnrichmentPlan(filteredPlan, { force }) : null;

    return {
      action,
      filePath: path.resolve(process.cwd(), filePath),
      minScore,
      force,
      extractedCount: items.length,
      matchedCount: filteredPlan.matches.length,
      rejectedMatchesCount: filteredPlan.rejectedMatches.length,
      unmatchedSyllabusCount: filteredPlan.unmatchedSyllabusItems.length,
      unmatchedAssignmentsCount: filteredPlan.unmatchedAssignments.length,
      applyResult,
      matches: filteredPlan.matches,
      rejectedMatches: filteredPlan.rejectedMatches,
      unmatchedSyllabusItems: filteredPlan.unmatchedSyllabusItems.slice(0, 20),
      unmatchedAssignments: filteredPlan.unmatchedAssignments.slice(0, 20)
    };
  }
  throw new Error(`Unknown action: ${action}`);
}

export function startDashboardServer(port = DEFAULT_PORT): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || "GET";
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (method === "GET" && url.pathname === "/") {
        sendStatic(res, "dashboard.html", "text/html; charset=utf-8");
        return;
      }
      if (method === "GET" && url.pathname === "/dashboard.js") {
        sendStatic(res, "dashboard.js", "application/javascript; charset=utf-8");
        return;
      }
      if (method === "GET" && url.pathname === "/dashboard.css") {
        sendStatic(res, "dashboard.css", "text/css; charset=utf-8");
        return;
      }
      if (method === "GET" && url.pathname === "/api/status") {
        json(res, 200, getStatusPayload());
        return;
      }
      if (method === "GET" && url.pathname === "/api/assignments") {
        json(res, 200, getAssignmentsPayload());
        return;
      }
      if (method === "POST" && url.pathname === "/api/action") {
        const bodyText = await readBody(req);
        const parsed = (bodyText ? JSON.parse(bodyText) : {}) as Record<string, unknown>;
        const action = typeof parsed.action === "string" ? parsed.action : "";
        const result = await handleAction(action, parsed);
        json(res, 200, { ok: true, result, status: getStatusPayload() });
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      logError("dashboard_request_failed", {
        message: error instanceof Error ? error.message : String(error)
      });
      json(res, 500, { error: "internal_error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(port, () => {
    logInfo("dashboard_server_started", { port });
    console.log(`Dashboard: http://localhost:${port}`);
  });
  return server;
}

if (require.main === module) {
  startDashboardServer();
}
