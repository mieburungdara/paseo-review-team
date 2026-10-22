import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_EVENTS, PLUGIN_ID } from "../shared/constants";
import {
  ReviewSessionSchema,
  SetupDefaultsSchema,
  type ReviewEvent,
  type ReviewSession,
  type SetupDefaults,
} from "../shared/contracts";
import { pluginDataDir } from "./data-dir";

interface StoreIndex {
  version: 1;
  sessionIds: string[];
}

const INDEX_FILE = "index.json";
const DEFAULTS_FILE = "defaults.json";
const SESSIONS_DIR = "sessions";

function nowIso(): string {
  return new Date().toISOString();
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[${PLUGIN_ID}] could not read ${file}:`, error);
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temp, file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EEXIST") {
      await rm(temp, { force: true });
      throw error;
    }
    await rm(file, { force: true });
    await rename(temp, file);
  }
}

export function touchSession(session: ReviewSession, at = nowIso()): void {
  session.updatedAt = at;
  session.lastActivityAt = at;
}

export function appendEvent(
  session: ReviewSession,
  event: Omit<ReviewEvent, "id" | "at">,
  at = nowIso(),
): void {
  session.events.push({
    id: randomUUID(),
    at,
    ...event,
  });
  if (session.events.length > MAX_EVENTS) {
    session.events.splice(0, session.events.length - MAX_EVENTS);
  }
  touchSession(session, at);
}

function isIndex(value: unknown): value is StoreIndex {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Array.isArray(record.sessionIds) &&
    record.sessionIds.every((id) => typeof id === "string")
  );
}

export class SessionStore {
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private defaults: SetupDefaults | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private indexChain: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string = pluginDataDir()) {}

  get directory(): string {
    return this.dataDir;
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
  }

  private sessionPath(id: string): string {
    return join(this.dataDir, SESSIONS_DIR, `${id}.json`);
  }

  private async load(): Promise<void> {
    const sessionsDir = join(this.dataDir, SESSIONS_DIR);
    await mkdir(sessionsDir, { recursive: true });

    const ids = new Set<string>();
    const index = await readJson(join(this.dataDir, INDEX_FILE));
    if (isIndex(index)) {
      for (const id of index.sessionIds) ids.add(id);
    } else if (index !== null) {
      console.warn(`[${PLUGIN_ID}] ignoring an invalid index.json`);
    }

    try {
      const files = await readdir(sessionsDir);
      for (const file of files) {
        if (file.endsWith(".json")) ids.add(file.slice(0, -".json".length));
      }
    } catch (error) {
      console.warn(`[${PLUGIN_ID}] could not scan the sessions directory:`, error);
    }

    for (const id of ids) {
      const raw = await readJson(this.sessionPath(id));
      if (raw === null) continue;
      const parsed = ReviewSessionSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(`[${PLUGIN_ID}] skipping invalid session ${id}:`, parsed.error.message);
        continue;
      }
      this.sessions.set(parsed.data.id, parsed.data);
    }

    const rawDefaults = await readJson(join(this.dataDir, DEFAULTS_FILE));
    if (rawDefaults !== null) {
      const parsed = SetupDefaultsSchema.safeParse(rawDefaults);
      if (parsed.success) this.defaults = parsed.data;
    }

    this.loaded = true;
  }

  get(id: string): ReviewSession | null {
    return this.sessions.get(id) ?? null;
  }

  list(): ReviewSession[] {
    return Array.from(this.sessions.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  latestForWorkspace(workspaceId: string): ReviewSession | null {
    const matches = this.list().filter((session) => session.workspaceId === workspaceId);
    return matches[0] ?? null;
  }

  findByLeadAgentId(agentId: string): ReviewSession | null {
    return this.list().find((session) => session.leadAgentId === agentId) ?? null;
  }

  getDefaults(): SetupDefaults | null {
    return this.defaults;
  }

  async saveDefaults(defaults: SetupDefaults): Promise<void> {
    await this.ensureLoaded();
    this.defaults = defaults;
    await mkdir(this.dataDir, { recursive: true });
    await writeJsonAtomic(join(this.dataDir, DEFAULTS_FILE), defaults);
  }

  async save(session: ReviewSession): Promise<void> {
    await this.ensureLoaded();
    this.sessions.set(session.id, session);

    const previous = this.writeChains.get(session.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(join(this.dataDir, SESSIONS_DIR), { recursive: true });
        const current = this.sessions.get(session.id);
        if (!current) return;
        await writeJsonAtomic(this.sessionPath(session.id), current);
        await this.queueIndexWrite();
      })
      .catch((error) => {
        console.error(`[${PLUGIN_ID}] could not save session ${session.id}:`, error);
      });

    this.writeChains.set(session.id, next);
    await next;
    if (this.writeChains.get(session.id) === next) this.writeChains.delete(session.id);
  }

  private async queueIndexWrite(): Promise<void> {
    const previous = this.indexChain;
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.dataDir, { recursive: true });
        const index: StoreIndex = {
          version: 1,
          sessionIds: this.list().map((session) => session.id),
        };
        await writeJsonAtomic(join(this.dataDir, INDEX_FILE), index);
      })
      .catch((error) => {
        console.error(`[${PLUGIN_ID}] could not save index.json:`, error);
      });
    this.indexChain = next;
    await next;
  }
}

export const store = new SessionStore();
