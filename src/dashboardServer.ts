import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import dotenv from "dotenv";
import { getDb, listAssignments, listAssignmentsBetween, listAssignmentsMissingCalendarEvent, listOverdueAssignments } from "./db";
import { pollForNewAssignments } from "./icalPoller";
import { syncAllToCalendar } from "./calendarSync";
import { runHeartbeat } from "./index";
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

async function handleAction(action: string, bodyText: string): Promise<unknown> {
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
  if (action === "enrichFromReport") {
    // placeholder for future UI workflow
    const body = bodyText ? JSON.parse(bodyText) : {};
    return { action, status: "not_implemented", body };
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
      if (method === "POST" && url.pathname === "/api/action") {
        const bodyText = await readBody(req);
        const parsed = bodyText ? JSON.parse(bodyText) : {};
        const action = typeof parsed.action === "string" ? parsed.action : "";
        const result = await handleAction(action, bodyText);
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
