import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

vi.mock("dotenv", () => ({
  default: {
    config: vi.fn()
  }
}));

vi.mock("../src/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}));

function createMockChild(exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
  };
  child.stderr = new EventEmitter();
  setTimeout(() => child.emit("close", exitCode), 0);
  return child;
}

describe("notifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENCLAW_TARGET;
    delete process.env.IMESSAGE_TARGET;
    process.env.OPENCLAW_CHANNEL = "discord";
  });

  it("falls back when target is missing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { sendMessage } = await import("../src/notifier");
    await sendMessage("hello");
    expect(logSpy).toHaveBeenCalledWith("[notifier:fallback] hello");
    logSpy.mockRestore();
  });

  it("invokes openclaw CLI send when route is configured", async () => {
    process.env.OPENCLAW_TARGET = "12345";
    spawnMock.mockReturnValue(createMockChild(0));
    const { sendMessage } = await import("../src/notifier");
    await sendMessage("hello");

    expect(spawnMock).toHaveBeenCalled();
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args).toContain("message");
    expect(args).toContain("send");
    expect(args).toContain("--target");
    expect(args).toContain("12345");
  });

  it("sends daily digest to both openclaw and imessage when both routes are configured", async () => {
    process.env.OPENCLAW_TARGET = "discord-target";
    process.env.IMESSAGE_TARGET = "+15551234567";
    spawnMock.mockImplementation(() => createMockChild(0));

    const { sendDigest } = await import("../src/notifier");
    await sendDigest("digest text");

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const commands = spawnMock.mock.calls.map((call) => call[0]);
    expect(commands).toContain("openclaw");
    expect(commands).toContain("osascript");
  });
});
