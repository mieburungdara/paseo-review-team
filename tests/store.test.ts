import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_EVENTS } from "../shared/constants";
import type { ReviewSession } from "../shared/contracts";
import { appendEvent, SessionStore } from "../server/store";

let directory: string;

function makeSession(id: string, updatedAt: string): ReviewSession {
  return {
    id,
    workspaceId: "workspace-1",
    workspaceName: "Demo",
    target: "C:/demo",
    lenses: ["correctness"],
    depth: "standard",
    provider: "codex/gpt-5",
    modeId: null,
    thinkingOptionId: null,
    status: "running",
    phase: "reviewing",
    leadAgentId: "lead-1",
    leadTitle: "Lead",
    leadAgentStatus: "running",
    leadState: "working",
    leadNote: null,
    reviewers: [],
    pendingPermissions: [],
    findings: [],
    finalReport: null,
    finalSummary: null,
    verdict: null,
    coverage: { completed: 0, total: 1 },
    events: [],
    error: null,
    createdAt: updatedAt,
    updatedAt,
    lastActivityAt: updatedAt,
    stoppedAt: null,
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "review-team-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("round-trips a session and its defaults", async () => {
    const store = new SessionStore(directory);
    await store.save(makeSession("session-a", "2026-01-01T00:00:00.000Z"));
    await store.saveDefaults({
      provider: "codex",
      model: "gpt-5",
      lenses: ["correctness", "security"],
      depth: "deep",
    });

    const reopened = new SessionStore(directory);
    await reopened.ensureLoaded();
    expect(reopened.get("session-a")?.workspaceName).toBe("Demo");
    expect(reopened.getDefaults()).toEqual({
      provider: "codex",
      model: "gpt-5",
      lenses: ["correctness", "security"],
      depth: "deep",
    });
  });

  it("returns the latest session for a workspace", async () => {
    const store = new SessionStore(directory);
    await store.save(makeSession("older", "2026-01-01T00:00:00.000Z"));
    await store.save(makeSession("newer", "2026-01-02T00:00:00.000Z"));
    expect(store.latestForWorkspace("workspace-1")?.id).toBe("newer");
  });

  it("skips a corrupt session file and keeps the rest", async () => {
    const store = new SessionStore(directory);
    await store.save(makeSession("good", "2026-01-01T00:00:00.000Z"));

    await mkdir(join(directory, "sessions"), { recursive: true });
    await writeFile(join(directory, "sessions", "bad.json"), "{broken", "utf8");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const reopened = new SessionStore(directory);
      await reopened.ensureLoaded();
      expect(reopened.get("good")).not.toBeNull();
      expect(reopened.get("bad")).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it("caps the event log", () => {
    const session = makeSession("events", "2026-01-01T00:00:00.000Z");
    session.events = Array.from({ length: MAX_EVENTS }, (_, index) => ({
      id: `event-${index}`,
      at: "2026-01-01T00:00:00.000Z",
      kind: "session" as const,
      message: `event ${index}`,
      agentId: null,
      lens: null,
    }));

    appendEvent(session, {
      kind: "message",
      message: "last",
      agentId: null,
      lens: null,
    });

    expect(session.events).toHaveLength(MAX_EVENTS);
    expect(session.events[MAX_EVENTS - 1].message).toBe("last");
  });
});
