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
    presetId: "code",
    task: "review",
    translation: null,
    workspaceId: "workspace-1",
    workspaceName: "Demo",
    workspaceDirectory: null,
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
    translators: [],
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
      presetId: "code",
      provider: "codex",
      model: "gpt-5",
      modeId: "full-access",
      thinkingOptionId: "high",
      lenses: ["correctness", "security"],
      depth: "deep",
      outputDir: null,
      outputExtension: null,
    });

    const reopened = new SessionStore(directory);
    await reopened.ensureLoaded();
    expect(reopened.get("session-a")?.workspaceName).toBe("Demo");
    expect(reopened.getDefaults()).toEqual({
      presetId: "code",
      provider: "codex",
      model: "gpt-5",
      modeId: "full-access",
      thinkingOptionId: "high",
      lenses: ["correctness", "security"],
      depth: "deep",
      outputDir: null,
      outputExtension: null,
    });
  });

  it("defaults legacy sessions and defaults to the code preset", async () => {
    const legacy = makeSession("legacy", "2026-01-01T00:00:00.000Z") as unknown as Record<
      string,
      unknown
    >;
    delete legacy.presetId;
    delete legacy.modeId;
    delete legacy.thinkingOptionId;

    await mkdir(join(directory, "sessions"), { recursive: true });
    await writeFile(
      join(directory, "sessions", "legacy.json"),
      JSON.stringify(legacy),
      "utf8",
    );
    await writeFile(
      join(directory, "defaults.json"),
      JSON.stringify({
        provider: "codex",
        model: "gpt-5",
        lenses: ["correctness"],
        depth: "standard",
      }),
      "utf8",
    );

    const store = new SessionStore(directory);
    await store.ensureLoaded();
    expect(store.get("legacy")?.presetId).toBe("code");
    expect(store.get("legacy")?.task).toBe("review");
    expect(store.get("legacy")?.translation).toBeNull();
    expect(store.get("legacy")?.translators).toEqual([]);
    expect(store.get("legacy")?.workspaceDirectory).toBeNull();
    expect(store.get("legacy")?.modeId).toBeNull();
    expect(store.get("legacy")?.thinkingOptionId).toBeNull();
    expect(store.getDefaults()?.presetId).toBe("code");
    expect(store.getDefaults()?.lenses).toEqual(["correctness"]);
    expect(store.getDefaults()?.modeId).toBeNull();
    expect(store.getDefaults()?.thinkingOptionId).toBeNull();
    expect(store.getDefaults()?.outputDir).toBeNull();
    expect(store.getDefaults()?.outputExtension).toBeNull();
  });

  it("round-trips a translation session with translator progress", async () => {
    const store = new SessionStore(directory);
    const session: ReviewSession = {
      ...makeSession("translate-session", "2026-01-01T00:00:00.000Z"),
      presetId: "translate",
      task: "translate",
      translation: {
        sourceLanguage: "English",
        targetLanguage: "Indonesian",
        outputDir: "translated/id",
        outputExtension: ".txt",
        unitLabel: "Bab",
      },
      workspaceDirectory: "C:/workspace",
      phase: "translating",
      translators: [
        {
          agentId: "translator-1",
          unit: "Bab 1",
          title: "Translator: Bab 1",
          status: "done",
          sourcePath: "manuscript/en/bab-01.md",
          outputPath: "translated/id/bab-01.md",
          outputStatus: "present",
          summary: "Selesai",
          notes: [],
          reportText: "laporan",
          reportFormat: "structured",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    await store.save(session);

    const reopened = new SessionStore(directory);
    await reopened.ensureLoaded();
    const loaded = reopened.get("translate-session");
    expect(loaded?.task).toBe("translate");
    expect(loaded?.translation?.outputDir).toBe("translated/id");
    expect(loaded?.translation?.outputExtension).toBe(".txt");
    expect(loaded?.workspaceDirectory).toBe("C:/workspace");
    expect(loaded?.translators[0].unit).toBe("Bab 1");
    expect(loaded?.translators[0].outputStatus).toBe("present");
  });

  it("keeps a novel preset on a session", async () => {
    const store = new SessionStore(directory);
    const session = {
      ...makeSession("novel-session", "2026-01-01T00:00:00.000Z"),
      presetId: "novel",
      lenses: ["plot", "character"],
    };
    await store.save(session);

    const reopened = new SessionStore(directory);
    await reopened.ensureLoaded();
    expect(reopened.get("novel-session")?.presetId).toBe("novel");
    expect(reopened.get("novel-session")?.lenses).toEqual(["plot", "character"]);
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
