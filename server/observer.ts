import type { PaseoApi } from "@getpaseo/client";
import type {
  PluginHookAgent,
  PluginLifecycleEvents,
  PluginLifecycleRegistration,
} from "@getpaseo/plugin/server";
import {
  ENRICH_DELAY_MS,
  LABEL_ROLE,
  LABEL_SESSION,
  LENSES,
  RECONCILE_INTERVAL_MS,
  ROLE_LEAD,
} from "../shared/constants";
import type { Reviewer, ReviewSession } from "../shared/contracts";
import { buildConsolidationNudgeMessage } from "../shared/prompts";
import {
  parseFinalReport,
  parseLeadStatus,
  parseReviewerReport,
  parseReviewerStatus,
  recentAssistantText,
} from "../shared/reports";
import {
  errorMessage,
  listSessionAgents,
  readTimelineTail,
  refreshAgent,
  sendToAgent,
  type AgentListEntry,
} from "./agents";
import { appendEvent, store, touchSession } from "./store";

interface ResolvedAgent {
  session: ReviewSession;
  role: "lead" | "reviewer";
}

const LEAD_TITLE_PATTERN = /^Review Team Lead \[([0-9a-f]{8})\]/i;
const ENRICH_LIMIT = 8;
const RECONCILE_THROTTLE_MS = 5_000;

const CONSOLIDATION_NUDGE_EVENT =
  "Semua lensa sudah memberi hasil. Lead diminta menyusun laporan konsolidasi.";

const lastReconcileAt = new Map<string, number>();
const enrichTimers = new Set<ReturnType<typeof setTimeout>>();
const consolidationNudges = new Set<string>();
let lastPaseo: PaseoApi | null = null;
let reconciling = false;

interface AgentLike {
  id: string;
  title: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function titleForAgent(agent: AgentLike): string | null {
  return agent.title?.trim() || null;
}

function parseLens(title: string | null): string {
  if (!title) return "unknown";
  const withoutPrefix = title.replace(/^Reviewer:\s*/i, "").trim();
  const match = LENSES.find(
    (lens) =>
      lens.id === withoutPrefix.toLowerCase() ||
      lens.label.toLowerCase() === withoutPrefix.toLowerCase(),
  );
  if (match) return match.id;
  const slug = withoutPrefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "unknown";
}

async function resolveSessionForAgent(
  agent: PluginHookAgent,
  paseo?: PaseoApi,
): Promise<ResolvedAgent | null> {
  await store.ensureLoaded();

  const asLead = store.findByLeadAgentId(agent.id);
  if (asLead) return { session: asLead, role: "lead" };

  if (agent.parentAgentId) {
    const parentSession = store.findByLeadAgentId(agent.parentAgentId);
    if (parentSession) return { session: parentSession, role: "reviewer" };
  }

  const title = titleForAgent(agent);
  if (title) {
    const titleMatch = LEAD_TITLE_PATTERN.exec(title);
    if (titleMatch) {
      const session = store
        .list()
        .find((entry) => entry.id.startsWith(titleMatch[1].toLowerCase()));
      if (session) return { session, role: "lead" };
    }
  }

  if (!paseo) return null;
  try {
    const snapshot = await refreshAgent(paseo, agent.id);
    if (!snapshot) return null;
    const sessionId = snapshot.labels?.[LABEL_SESSION];
    if (!sessionId) return null;
    const session = store.get(sessionId);
    if (!session) return null;
    const role =
      snapshot.labels?.[LABEL_ROLE] === ROLE_LEAD || session.leadAgentId === null
        ? "lead"
        : "reviewer";
    return { session, role };
  } catch (error) {
    console.warn(`[review-team] could not resolve agent ${agent.id}:`, errorMessage(error));
    return null;
  }
}

function findReviewer(session: ReviewSession, agentId: string): Reviewer | undefined {
  return session.reviewers.find((reviewer) => reviewer.agentId === agentId);
}

function upsertReviewer(
  session: ReviewSession,
  agent: AgentLike,
  status: Reviewer["status"],
): { reviewer: Reviewer; created: boolean } {
  const existing = findReviewer(session, agent.id);
  if (existing) {
    const title = titleForAgent(agent);
    if (title && existing.title !== title) existing.title = title;
    existing.lastSeenAt = nowIso();
    return { reviewer: existing, created: false };
  }

  const title = titleForAgent(agent);
  const reviewer: Reviewer = {
    agentId: agent.id,
    lens: parseLens(title),
    title,
    status,
    verdict: null,
    summary: null,
    reportText: null,
    reportFormat: "none",
    findings: [],
    lastSeenAt: nowIso(),
  };
  session.reviewers.push(reviewer);
  return { reviewer, created: true };
}

function updateCoverage(session: ReviewSession): void {
  const completed = new Set(
    session.reviewers
      .filter(
        (reviewer) =>
          session.lenses.includes(reviewer.lens) && reviewer.status === "done",
      )
      .map((reviewer) => reviewer.lens),
  ).size;
  session.coverage = { completed, total: session.lenses.length };
}

function allLensesAccounted(session: ReviewSession): boolean {
  if (session.lenses.length === 0) return false;
  return session.lenses.every((lens) =>
    session.reviewers.some(
      (reviewer) =>
        reviewer.lens === lens &&
        (reviewer.status === "done" ||
          reviewer.status === "blocked" ||
          reviewer.status === "failed" ||
          reviewer.status === "archived"),
    ),
  );
}

function refreshStatusFlags(session: ReviewSession): void {
  if (session.status === "stopped" || session.status === "failed") return;
  updateCoverage(session);

  if (session.finalReport) {
    session.phase = "complete";
    session.status = session.verdict === "blocked" ? "needs_input" : "running";
  } else if (session.leadState === "failed") {
    session.status = "failed";
    session.phase = "failed";
  } else if (
    session.pendingPermissions.length > 0 ||
    session.reviewers.some((reviewer) => reviewer.status === "needs_input") ||
    session.leadState === "blocked"
  ) {
    session.status = "needs_input";
  } else if (session.status === "needs_input") {
    session.status = "running";
  }

  if (
    session.phase !== "complete" &&
    session.phase !== "failed" &&
    session.phase !== "stopped" &&
    allLensesAccounted(session)
  ) {
    if (session.phase !== "consolidating") {
      session.phase = "consolidating";
      appendEvent(session, {
        kind: "report",
        message: "Semua lensa sudah memberikan hasil. Menunggu laporan konsolidasi lead.",
        agentId: session.leadAgentId,
        lens: null,
      });
    }
  }
}

function addReportEvent(
  session: ReviewSession,
  message: string,
  agentId: string | null,
  lens: string | null,
): void {
  const duplicate = session.events
    .slice(-3)
    .some((event) => event.kind === "report" && event.message === message);
  if (duplicate) return;
  appendEvent(session, {
    kind: "report",
    message,
    agentId,
    lens,
  });
}

function applyLeadText(session: ReviewSession, text: string): boolean {
  let changed = false;
  const status = parseLeadStatus(text);
  if (status) {
    if (session.leadState !== status.state) {
      session.leadState = status.state;
      changed = true;
    }
    const note = status.note || null;
    if (session.leadNote !== note) {
      session.leadNote = note;
      changed = true;
    }
  }

  const final = parseFinalReport(text);
  if (final) {
    const isNew = session.finalReport !== final.reportText;
    session.finalReport = final.reportText;
    session.finalSummary = final.summary;
    session.verdict = final.verdict;
    session.findings = final.findings;
    session.leadState = "complete";
    session.phase = "complete";
    session.status = final.verdict === "blocked" ? "needs_input" : "running";
    if (isNew) {
      addReportEvent(
        session,
        final.parsed
          ? "Laporan akhir diterima."
          : "Laporan akhir diterima dalam format teks (JSON tidak valid).",
        session.leadAgentId,
        null,
      );
      changed = true;
    }
    return true;
  }

  if (status?.state === "complete") {
    if (session.phase !== "consolidating") session.phase = "consolidating";
    addReportEvent(
      session,
      "Lead menandai selesai tetapi blok laporan akhir belum ditemukan. Minta laporan ulang.",
      session.leadAgentId,
      null,
    );
    changed = true;
  }

  if (status?.state === "failed") {
    session.status = "failed";
    session.phase = "failed";
    session.error = status.note || "Lead melaporkan kegagalan.";
    changed = true;
  }

  return changed;
}

function applyReviewerText(session: ReviewSession, reviewer: Reviewer, text: string): boolean {
  const report = parseReviewerReport(text);
  const status = parseReviewerStatus(text);
  const hasReport =
    report.parsed ||
    report.marker !== null ||
    report.summary !== null ||
    report.findings.length > 0;
  if (!hasReport && !status) return false;

  const previousStatus = reviewer.status;
  const previousReport = reviewer.reportText;
  const previousVerdict = reviewer.verdict;
  const previousCount = reviewer.findings.length;

  if (hasReport) {
    reviewer.reportText = report.raw;
    reviewer.reportFormat = report.parsed ? "structured" : "text";
    reviewer.summary =
      report.summary ??
      (report.marker === "blocked"
        ? "Reviewer melaporkan hambatan."
        : report.marker === "failed"
          ? "Reviewer gagal menyelesaikan review."
          : null);
    reviewer.verdict = report.verdict;
    reviewer.findings = report.findings;
    reviewer.lastSeenAt = nowIso();

    if (report.marker === "blocked") reviewer.status = "blocked";
    else if (report.marker === "failed") reviewer.status = "failed";
    else if (report.marker === "done" || report.parsed) reviewer.status = "done";
  }

  if (status && (!hasReport || (report.marker === null && !report.parsed))) {
    reviewer.status = status.state === "working" ? "running" : status.state;
    if (status.note && !reviewer.summary) reviewer.summary = status.note;
    reviewer.lastSeenAt = nowIso();
  }

  const statusChanged = reviewer.status !== previousStatus;
  const reportChanged =
    reviewer.reportText !== previousReport ||
    reviewer.verdict !== previousVerdict ||
    reviewer.findings.length !== previousCount;

  if (reviewer.status === "done" && (statusChanged || reportChanged)) {
    addReportEvent(
      session,
      reviewer.reportFormat === "none"
        ? `Reviewer ${reviewer.lens} menandai selesai tanpa laporan terstruktur.`
        : `Laporan ${reviewer.lens} diterima (${reviewer.findings.length} temuan).`,
      reviewer.agentId,
      reviewer.lens,
    );
  } else if (reviewer.status === "blocked" && statusChanged) {
    addReportEvent(session, `Reviewer ${reviewer.lens} terhambat.`, reviewer.agentId, reviewer.lens);
  } else if (reviewer.status === "failed" && statusChanged) {
    addReportEvent(session, `Reviewer ${reviewer.lens} gagal.`, reviewer.agentId, reviewer.lens);
  }

  return statusChanged || reportChanged;
}

async function enrichAgent(
  paseo: PaseoApi,
  session: ReviewSession,
  agentId: string,
): Promise<void> {
  if (session.status === "stopped") return;

  const isLead = session.leadAgentId === agentId;
  const reviewer = isLead ? undefined : findReviewer(session, agentId);
  if (!isLead && !reviewer) return;

  try {
    const payload = await readTimelineTail(paseo, agentId, 80);
    const text = recentAssistantText(payload.entries);
    if (!text) return;

    const changed = isLead ? applyLeadText(session, text) : applyReviewerText(session, reviewer!, text);
    if (!changed) return;

    refreshStatusFlags(session);
    touchSession(session);
    await store.save(session);
  } catch (error) {
    console.warn(`[review-team] could not read the timeline of ${agentId}:`, errorMessage(error));
  }
}

function scheduleEnrich(
  paseo: PaseoApi,
  session: ReviewSession,
  agentId: string,
): void {
  const timer = setTimeout(() => {
    enrichTimers.delete(timer);
    void enrichAgent(paseo, session, agentId);
  }, ENRICH_DELAY_MS);
  enrichTimers.add(timer);
}

async function maybeNudgeConsolidation(
  paseo: PaseoApi,
  session: ReviewSession,
): Promise<void> {
  if (
    !session.leadAgentId ||
    session.finalReport ||
    session.phase !== "consolidating" ||
    session.status === "stopped" ||
    session.status === "failed"
  ) {
    return;
  }
  if (
    session.events.some(
      (event) => event.kind === "message" && event.message === CONSOLIDATION_NUDGE_EVENT,
    )
  ) {
    return;
  }
  if (consolidationNudges.has(session.id)) return;

  consolidationNudges.add(session.id);
  try {
    await sendToAgent(paseo, session.leadAgentId, buildConsolidationNudgeMessage(), "steer");
    appendEvent(session, {
      kind: "message",
      message: CONSOLIDATION_NUDGE_EVENT,
      agentId: session.leadAgentId,
      lens: null,
    });
    touchSession(session);
    await store.save(session);
  } catch (error) {
    console.warn(
      `[review-team] could not nudge the lead of ${session.id}:`,
      errorMessage(error),
    );
  } finally {
    consolidationNudges.delete(session.id);
  }
}

function statusFromEntry(
  entry: AgentListEntry,
  current: Reviewer["status"] | null,
): Reviewer["status"] {
  if (entry.archivedAt) return "archived";
  if (entry.status === "closed") return "archived";
  if (entry.status === "error") return "failed";
  if (entry.status === "running") return "running";
  if (entry.status === "initializing") return current === "starting" ? "starting" : "running";
  if (entry.requiresAttention && entry.attentionReason === "permission") return "needs_input";
  if (current === "done" || current === "blocked" || current === "failed") return current;
  return "idle";
}

export async function reconcileSession(
  paseo: PaseoApi,
  session: ReviewSession,
  force = false,
): Promise<ReviewSession> {
  await store.ensureLoaded();

  if (session.status === "stopped") return session;

  const last = lastReconcileAt.get(session.id) ?? 0;
  if (!force && Date.now() - last < RECONCILE_THROTTLE_MS) return session;
  lastReconcileAt.set(session.id, Date.now());

  try {
    const entries = await listSessionAgents(paseo, session.id, session.leadAgentId);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    if (!session.leadAgentId) {
      const candidate = entries.find((entry) => entry.labels[LABEL_ROLE] === ROLE_LEAD);
      if (candidate) {
        session.leadAgentId = candidate.id;
        session.leadTitle = candidate.title;
        session.leadAgentStatus = candidate.status;
      }
    }

    for (const entry of entries) {
      if (entry.id === session.leadAgentId) continue;
      const { reviewer, created } = upsertReviewer(session, entry, "starting");
      const nextStatus = statusFromEntry(entry, created ? "starting" : reviewer.status);
      reviewer.status = nextStatus;
      reviewer.lastSeenAt = nowIso();
    }

    if (session.leadAgentId) {
      const leadEntry = byId.get(session.leadAgentId);
      if (leadEntry) {
        session.leadAgentStatus = leadEntry.status;
        session.leadTitle = leadEntry.title ?? session.leadTitle;
      } else {
        try {
          const snapshot = await refreshAgent(paseo, session.leadAgentId);
          if (snapshot) {
            session.leadAgentStatus = snapshot.status;
            session.leadTitle = snapshot.title ?? session.leadTitle;
          } else if (session.phase !== "complete") {
            session.status = "failed";
            session.phase = "failed";
            session.error = "Lead tidak ditemukan. Sesi tidak bisa dilanjutkan.";
            appendEvent(session, {
              kind: "error",
              message: session.error,
              agentId: session.leadAgentId,
              lens: null,
            });
          }
        } catch (error) {
          console.warn("[review-team] could not refresh the lead:", errorMessage(error));
        }
      }
    }

    refreshStatusFlags(session);

    const toEnrich = session.reviewers
      .filter(
        (reviewer) =>
          !reviewer.reportText &&
          reviewer.status !== "archived" &&
          reviewer.status !== "failed" &&
          reviewer.status !== "running",
      )
      .slice(0, ENRICH_LIMIT)
      .map((reviewer) => reviewer.agentId);

    if (!session.finalReport && session.leadAgentId) {
      toEnrich.unshift(session.leadAgentId);
    }

    for (const agentId of toEnrich.slice(0, ENRICH_LIMIT)) {
      await enrichAgent(paseo, session, agentId);
    }

    touchSession(session);
    await store.save(session);
    await maybeNudgeConsolidation(paseo, session);
  } catch (error) {
    console.warn(`[review-team] could not reconcile session ${session.id}:`, errorMessage(error));
  }

  return session;
}

function handleAgentCreated(
  event: PluginLifecycleEvents["agent.created"],
  paseo: PaseoApi,
): void {
  void (async () => {
    const resolved = await resolveSessionForAgent(event.agent, paseo);
    if (!resolved) return;
    const { session, role } = resolved;

    if (role === "lead") {
      const isNew = session.leadAgentId !== event.agent.id;
      session.leadAgentId = event.agent.id;
      session.leadTitle = titleForAgent(event.agent);
      session.leadAgentStatus = "initializing";
      if (session.status === "starting") session.status = "running";
      if (isNew) {
        appendEvent(session, {
          kind: "lead",
          message: "Lead review dimulai.",
          agentId: event.agent.id,
          lens: null,
        });
      }
    } else {
      const { reviewer, created } = upsertReviewer(session, event.agent, "starting");
      reviewer.status = "starting";
      if (created) {
        appendEvent(session, {
          kind: "reviewer",
          message: `Reviewer ${reviewer.lens} bergabung.`,
          agentId: event.agent.id,
          lens: reviewer.lens,
        });
      }
    }

    touchSession(session);
    await store.save(session);
  })().catch((error) => {
    console.warn("[review-team] agent.created handler failed:", errorMessage(error));
  });
}

function handleTurnStarted(
  event: PluginLifecycleEvents["agent.turn_started"],
): void {
  void (async () => {
    const resolved = await resolveSessionForAgent(event.agent);
    if (!resolved) return;
    const { session, role } = resolved;
    if (session.status === "stopped" || session.status === "failed") return;

    if (role === "lead") {
      session.leadAgentStatus = "running";
      if (!session.leadState || session.leadState === "needs_input") session.leadState = "working";
    } else {
      const reviewer = findReviewer(session, event.agent.id);
      if (reviewer) {
        reviewer.status = "running";
        reviewer.lastSeenAt = nowIso();
      }
    }

    if (session.pendingPermissions.length === 0) session.status = "running";
    touchSession(session);
    await store.save(session);
  })().catch((error) => {
    console.warn("[review-team] agent.turn_started handler failed:", errorMessage(error));
  });
}

function handleTurnEnded(
  event: PluginLifecycleEvents["agent.turn_ended"],
  paseo: PaseoApi,
): void {
  void (async () => {
    const resolved = await resolveSessionForAgent(event.agent);
    if (!resolved) return;
    const { session, role } = resolved;
    if (session.status === "stopped") return;

    if (role === "lead") {
      session.leadAgentStatus = event.outcome.kind === "failed" ? "error" : "idle";
      if (event.outcome.kind === "failed") {
        session.status = "failed";
        session.phase = "failed";
        session.error = event.outcome.error.message || "Giliran lead gagal.";
        appendEvent(session, {
          kind: "error",
          message: session.error,
          agentId: event.agent.id,
          lens: null,
        });
      }
    } else {
      const reviewer = findReviewer(session, event.agent.id);
      if (reviewer) {
        reviewer.lastSeenAt = nowIso();
        if (event.outcome.kind === "failed") {
          reviewer.status = "failed";
          appendEvent(session, {
            kind: "error",
            message: `Giliran reviewer ${reviewer.lens} gagal: ${event.outcome.error.message}`,
            agentId: event.agent.id,
            lens: reviewer.lens,
          });
        } else if (event.outcome.kind === "canceled") {
          if (reviewer.status === "running" || reviewer.status === "starting") {
            reviewer.status = "idle";
          }
        } else if (reviewer.status === "running" || reviewer.status === "starting") {
          reviewer.status = "idle";
        }
      }
    }

    refreshStatusFlags(session);
    touchSession(session);
    await store.save(session);
    await maybeNudgeConsolidation(paseo, session);
    scheduleEnrich(paseo, session, event.agent.id);
  })().catch((error) => {
    console.warn("[review-team] agent.turn_ended handler failed:", errorMessage(error));
  });
}

function handlePermissionRequested(
  event: PluginLifecycleEvents["agent.permission_requested"],
): void {
  void (async () => {
    const resolved = await resolveSessionForAgent(event.agent);
    if (!resolved) return;
    const { session } = resolved;
    if (session.status === "stopped") return;

    if (!session.pendingPermissions.includes(event.agent.id)) {
      session.pendingPermissions.push(event.agent.id);
    }

    const reviewer = findReviewer(session, event.agent.id);
    if (reviewer) reviewer.status = "needs_input";
    session.status = "needs_input";

    const requestTitle =
      event.request.title?.trim() ||
      event.request.name?.trim() ||
      "Permintaan izin";
    appendEvent(session, {
      kind: "permission",
      message: `Menunggu izin: ${requestTitle}`,
      agentId: event.agent.id,
      lens: reviewer?.lens ?? null,
    });

    touchSession(session);
    await store.save(session);
  })().catch((error) => {
    console.warn("[review-team] agent.permission_requested handler failed:", errorMessage(error));
  });
}

function handlePermissionResolved(
  event: PluginLifecycleEvents["agent.permission_resolved"],
): void {
  void (async () => {
    const resolved = await resolveSessionForAgent(event.agent);
    if (!resolved) return;
    const { session } = resolved;
    if (session.status === "stopped") return;

    session.pendingPermissions = session.pendingPermissions.filter(
      (agentId) => agentId !== event.agent.id,
    );

    const reviewer = findReviewer(session, event.agent.id);
    if (reviewer && reviewer.status === "needs_input") {
      reviewer.status = "running";
    }

    if (session.pendingPermissions.length === 0) {
      refreshStatusFlags(session);
      if (session.status === "needs_input" && session.leadState !== "blocked") {
        session.status = "running";
      }
    }

    appendEvent(session, {
      kind: "permission",
      message:
        event.resolution.behavior === "allow" ? "Izin diberikan." : "Izin ditolak.",
      agentId: event.agent.id,
      lens: reviewer?.lens ?? null,
    });

    touchSession(session);
    await store.save(session);
  })().catch((error) => {
    console.warn("[review-team] agent.permission_resolved handler failed:", errorMessage(error));
  });
}

function handleAgentGone(
  agent: PluginHookAgent,
  reason: "archived" | "closed",
): void {
  void (async () => {
    const resolved = await resolveSessionForAgent(agent);
    if (!resolved) return;
    const { session, role } = resolved;
    if (session.status === "stopped") return;

    if (role === "lead") {
      session.status = "stopped";
      if (session.phase !== "complete") session.phase = "stopped";
      session.stoppedAt = nowIso();
      session.leadAgentStatus = "closed";
      appendEvent(session, {
        kind: "session",
        message: `Lead ${reason === "archived" ? "diarsipkan" : "ditutup"}. Sesi dihentikan.`,
        agentId: agent.id,
        lens: null,
      });
    } else {
      const reviewer = findReviewer(session, agent.id);
      if (reviewer) {
        reviewer.status = "archived";
        reviewer.lastSeenAt = nowIso();
        appendEvent(session, {
          kind: "reviewer",
          message: `Reviewer ${reviewer.lens} ${reason === "archived" ? "diarsipkan" : "ditutup"}.`,
          agentId: agent.id,
          lens: reviewer.lens,
        });
      }
    }

    refreshStatusFlags(session);
    touchSession(session);
    await store.save(session);
  })().catch((error) => {
    console.warn("[review-team] agent gone handler failed:", errorMessage(error));
  });
}

export function registerObserver(server: PluginLifecycleRegistration): () => void {
  const unregister: Array<() => void> = [];

  unregister.push(
    server.on("agent.created", (event, context) => {
      lastPaseo = context.paseo;
      handleAgentCreated(event, context.paseo);
    }),
  );
  unregister.push(
    server.on("agent.turn_started", (event, context) => {
      lastPaseo = context.paseo;
      handleTurnStarted(event);
    }),
  );
  unregister.push(
    server.on("agent.turn_ended", (event, context) => {
      lastPaseo = context.paseo;
      handleTurnEnded(event, context.paseo);
    }),
  );
  unregister.push(
    server.on("agent.permission_requested", (event, context) => {
      lastPaseo = context.paseo;
      handlePermissionRequested(event);
    }),
  );
  unregister.push(
    server.on("agent.permission_resolved", (event, context) => {
      lastPaseo = context.paseo;
      handlePermissionResolved(event);
    }),
  );
  unregister.push(
    server.on("agent.archived", (event, context) => {
      lastPaseo = context.paseo;
      handleAgentGone(event.agent, "archived");
    }),
  );
  unregister.push(
    server.on("agent.closed", (event, context) => {
      lastPaseo = context.paseo;
      handleAgentGone(event.agent, "closed");
    }),
  );

  const interval = setInterval(() => {
    void (async () => {
      if (!lastPaseo || reconciling) return;
      await store.ensureLoaded();
      const active = store
        .list()
        .filter(
          (session) =>
            session.status !== "stopped" &&
            session.status !== "failed" &&
            session.phase !== "complete" &&
            session.phase !== "stopped" &&
            session.phase !== "failed",
        );
      if (active.length === 0) return;

      reconciling = true;
      try {
        for (const session of active.slice(0, 6)) {
          await reconcileSession(lastPaseo, session, true);
        }
      } finally {
        reconciling = false;
      }
    })().catch((error) => {
      console.warn("[review-team] reconcile timer failed:", errorMessage(error));
    });
  }, RECONCILE_INTERVAL_MS);
  interval.unref?.();

  return () => {
    for (const dispose of unregister) dispose();
    clearInterval(interval);
    for (const timer of enrichTimers) clearTimeout(timer);
    enrichTimers.clear();
    lastReconcileAt.clear();
    consolidationNudges.clear();
    lastPaseo = null;
    reconciling = false;
  };
}
