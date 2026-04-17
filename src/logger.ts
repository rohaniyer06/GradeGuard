type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, details?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(details || {})
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logInfo(event: string, details?: Record<string, unknown>): void {
  write("info", event, details);
}

export function logWarn(event: string, details?: Record<string, unknown>): void {
  write("warn", event, details);
}

export function logError(event: string, details?: Record<string, unknown>): void {
  write("error", event, details);
}
