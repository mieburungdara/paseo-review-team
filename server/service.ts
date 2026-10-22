import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  DEFAULT_LENS_IDS,
  LABEL_ROLE,
  LABEL_SESSION,
  MAX_MESSAGE_LENGTH,
  ROLE_LEAD,
} from "../shared/constants";
import type { ProviderOption, ReviewSession, SetupDefaults } from "../shared/contracts";
import {
  buildLeadPrompt,
  buildOperatorMessage,
  buildReportRequestMessage,
  buildStopMessage,
} from "../shared/prompts";
import {
  archiveAgent,
  enableAgentTools,
  errorMessage,
  listProviderOptions,
  readAgentTools,
  sendToAgent,
} from "./agents";
import { reconcileSession } from "./observer";
import { appendEvent, store, touchSession } from "./store";

const ACTIVE_STATUSES = new Set(["starting", "running", "needs_input"]);

function nowIso(): string {
  return new Date().toISOString();
}

function defaultsFor(
  providers: ProviderOption[],
  saved: SetupDefaults | null,
): SetupDefaults {
  const provider =
    (saved ? providers.find((entry) => entry.id === saved.provider) : undefined) ?? providers[0];
  const model = provider
    ? (provider.models.find((entry) => entry.id === saved?.model) ??
      provider.models.find((entry) => entry.isDefault) ??
      provider.models[0])
    : undefined;

  const savedLenses = (saved?.lenses ?? []).filter((lens) => lens.trim() !== "").slice(0, 8);
  return {
    provider: provider?.id ?? saved?.provider ?? null,
    model: model?.id ?? saved?.model ?? null,
    lenses: savedLenses.length > 0 ? savedLenses : [...DEFAULT_LENS_IDS],
    depth: saved?.depth ?? "standard",
  };
}

function findSession(sessionId: string): ReviewSession {
  const session = store.get(sessionId);
  if (!session) throw new Error("Sesi review tidak ditemukan.");
  return session;
}

async function validateProvider(
  paseo: PaseoApi,
  providerId: string,
  modelId: string,
): Promise<{ provider: ProviderOption; modelId: string; combined: string }> {
  const providers = await listProviderOptions(paseo);
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(
      `Provider "${providerId}" tidak tersedia. Pilih provider lain di formulir setup.`,
    );
  }
  const model = provider.models.find((entry) => entry.id === modelId);
  if (!model) {
    throw new Error(`Model "${modelId}" tidak tersedia untuk provider "${providerId}".`);
  }
  return { provider, modelId: model.id, combined: `${provider.id}/${model.id}` };
}

export async function getState(
  { workspaceId }: { workspaceId: string },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();

  let session = store.latestForWorkspace(workspaceId);
  if (
    session &&
    ACTIVE_STATUSES.has(session.status) &&
    session.phase !== "complete" &&
    session.phase !== "stopped" &&
    session.phase !== "failed"
  ) {
    session = await reconcileSession(paseo, session, false);
  }

  const agentToolsEnabled = await readAgentTools(paseo).catch((error) => {
    console.warn("[review-team] could not read the agent tools setting:", errorMessage(error));
    return false;
  });

  const setupAvailable =
    !session ||
    session.status === "stopped" ||
    session.status === "failed" ||
    session.phase === "complete";
  const providers = setupAvailable
    ? await listProviderOptions(paseo).catch((error) => {
        console.warn("[review-team] could not list providers:", errorMessage(error));
        return [] as ProviderOption[];
      })
    : [];

  return {
    session,
    agentToolsEnabled,
    providers,
    defaults: defaultsFor(providers, store.getDefaults()),
  };
}

export async function startSession(
  input: {
    workspaceId: string;
    target: string;
    lenses: string[];
    depth: "quick" | "standard" | "deep";
    providerId: string;
    modelId: string;
    modeId?: string | null;
    thinkingOptionId?: string | null;
  },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();

  const agentTools = await readAgentTools(paseo);
  if (!agentTools) {
    throw new Error(
      "Agent tools Paseo belum aktif. Aktifkan dulu agar lead bisa membuat reviewer lewat create_agent.",
    );
  }

  const existing = store.latestForWorkspace(input.workspaceId);
  if (
    existing &&
    ACTIVE_STATUSES.has(existing.status) &&
    existing.phase !== "complete" &&
    existing.phase !== "stopped" &&
    existing.phase !== "failed"
  ) {
    throw new Error("Masih ada sesi review aktif di workspace ini. Hentikan dulu sesi tersebut.");
  }

  const lenses = Array.from(new Set(input.lenses.map((lens) => lens.trim()).filter(Boolean)));
  if (lenses.length === 0) throw new Error("Pilih minimal satu lensa review.");

  const { combined } = await validateProvider(paseo, input.providerId, input.modelId);

  const workspace = paseo.workspaces.ref(input.workspaceId);
  let snapshot = workspace.current();
  try {
    snapshot = (await workspace.refresh()) ?? snapshot;
  } catch (error) {
    console.warn("[review-team] could not refresh the workspace:", errorMessage(error));
  }
  if (!snapshot) {
    throw new Error(
      "Workspace tidak ditemukan di daemon ini. Buka workspace lewat Paseo lalu muat ulang panel.",
    );
  }

  const workspaceName =
    snapshot.name?.trim() || snapshot.title?.trim() || input.workspaceId;
  const actualWorkspaceId = snapshot.id || input.workspaceId;
  const sessionId = randomUUID();
  const createdAt = nowIso();

  const session: ReviewSession = {
    id: sessionId,
    workspaceId: actualWorkspaceId,
    workspaceName,
    target: input.target,
    lenses,
    depth: input.depth,
    provider: combined,
    modeId: input.modeId || null,
    thinkingOptionId: input.thinkingOptionId || null,
    status: "starting",
    phase: "starting",
    leadAgentId: null,
    leadTitle: null,
    leadAgentStatus: null,
    leadState: null,
    leadNote: null,
    reviewers: [],
    findings: [],
    finalReport: null,
    finalSummary: null,
    verdict: null,
    coverage: { completed: 0, total: lenses.length },
    events: [],
    error: null,
    createdAt,
    updatedAt: createdAt,
    lastActivityAt: createdAt,
    stoppedAt: null,
    pendingPermissions: [],
  };

  const modeId = input.modeId || null;
  const thinkingOptionId = input.thinkingOptionId || null;

  appendEvent(session, {
    kind: "session",
    message: `Sesi review dimulai untuk ${workspaceName} dengan ${lenses.length} lensa.`,
    agentId: null,
    lens: null,
  });
  await store.save(session);

  try {
    const prompt = buildLeadPrompt({
      sessionId,
      target: input.target,
      workspaceId: actualWorkspaceId,
      lenses,
      depth: input.depth,
      provider: combined,
    });

    const lead = await workspace.agents.create({
      config: {
        provider: combined,
        ...(modeId ? { modeId } : {}),
        ...(thinkingOptionId ? { thinkingOptionId } : {}),
      },
      title: `Review Team Lead [${sessionId.slice(0, 8)}] — ${workspaceName}`.slice(0, 120),
      labels: {
        [LABEL_SESSION]: sessionId,
        [LABEL_ROLE]: ROLE_LEAD,
      },
      prompt,
    });

    session.leadAgentId = lead.id;
    session.leadTitle = `Review Team Lead [${sessionId.slice(0, 8)}] — ${workspaceName}`;
    session.leadAgentStatus = "initializing";
    session.status = "running";
    session.phase = "reviewing";
    appendEvent(session, {
      kind: "lead",
      message: "Lead dibuat dan mulai menyiapkan reviewer.",
      agentId: lead.id,
      lens: null,
    });
    touchSession(session);
    await store.save(session);

    await store
      .saveDefaults({
        provider: input.providerId,
        model: input.modelId,
        lenses,
        depth: input.depth,
      })
      .catch((error) => {
        console.warn("[review-team] could not save setup defaults:", errorMessage(error));
      });

    return { session };
  } catch (error) {
    session.status = "failed";
    session.phase = "failed";
    session.error = `Gagal membuat lead review: ${errorMessage(error)}`;
    appendEvent(session, {
      kind: "error",
      message: session.error,
      agentId: session.leadAgentId,
      lens: null,
    });
    touchSession(session);
    await store.save(session);
    throw new Error(session.error);
  }
}

export async function refreshSession(
  { sessionId }: { sessionId: string },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();
  const session = findSession(sessionId);
  if (
    ACTIVE_STATUSES.has(session.status) &&
    session.phase !== "complete" &&
    session.phase !== "stopped" &&
    session.phase !== "failed"
  ) {
    await reconcileSession(paseo, session, true);
  }
  return { session };
}

export async function sendLeadMessage(
  { sessionId, text }: { sessionId: string; text: string },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();
  const session = findSession(sessionId);
  if (session.status === "stopped") throw new Error("Sesi review sudah dihentikan.");
  if (!session.leadAgentId) throw new Error("Lead belum siap.");

  const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!trimmed) throw new Error("Pesan kosong.");

  await sendToAgent(paseo, session.leadAgentId, buildOperatorMessage(trimmed), "steer");
  appendEvent(session, {
    kind: "message",
    message: "Pesan operator dikirim ke lead.",
    agentId: session.leadAgentId,
    lens: null,
  });
  await store.save(session);
  return { ok: true as const };
}

export async function requestReport(
  { sessionId }: { sessionId: string },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();
  const session = findSession(sessionId);
  if (session.status === "stopped") throw new Error("Sesi review sudah dihentikan.");
  if (!session.leadAgentId) throw new Error("Lead belum siap.");

  await sendToAgent(paseo, session.leadAgentId, buildReportRequestMessage(), "steer");
  appendEvent(session, {
    kind: "message",
    message: "Operator meminta laporan konsolidasi.",
    agentId: session.leadAgentId,
    lens: null,
  });
  await store.save(session);
  return { ok: true as const };
}

export async function stopSession(
  { sessionId, archiveAgents }: { sessionId: string; archiveAgents: boolean },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();
  const session = findSession(sessionId);

  if (session.status !== "stopped") {
    const wasRunning =
      session.leadAgentStatus === "running" ||
      session.pendingPermissions.length > 0 ||
      session.reviewers.some((reviewer) => reviewer.status === "running");

    session.status = "stopped";
    if (session.phase !== "complete") session.phase = "stopped";
    session.stoppedAt = nowIso();
    appendEvent(session, {
      kind: "session",
      message: "Sesi review dihentikan oleh operator.",
      agentId: session.leadAgentId,
      lens: null,
    });
    touchSession(session);
    await store.save(session);

    if (wasRunning && session.leadAgentId) {
      try {
        await sendToAgent(paseo, session.leadAgentId, buildStopMessage(), "interrupt");
      } catch (error) {
        console.warn("[review-team] could not interrupt the lead:", errorMessage(error));
      }
    }
  }

  const warnings: string[] = [];
  if (archiveAgents) {
    if (session.leadAgentId || session.reviewers.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const targets: Array<{ id: string; label: string; reviewerLens?: string }> = [];
    if (session.leadAgentId) {
      targets.push({ id: session.leadAgentId, label: "Lead" });
    }
    for (const reviewer of session.reviewers) {
      if (reviewer.status === "archived") continue;
      targets.push({ id: reviewer.agentId, label: `Reviewer ${reviewer.lens}`, reviewerLens: reviewer.lens });
    }

    const results = await Promise.allSettled(
      targets.map((target) => archiveAgent(paseo, target.id)),
    );

    results.forEach((result, index) => {
      const target = targets[index];
      if (result.status === "fulfilled") {
        if (target.reviewerLens) {
          const reviewer = session.reviewers.find(
            (entry) => entry.agentId === target.id,
          );
          if (reviewer) reviewer.status = "archived";
        } else {
          session.leadAgentStatus = "closed";
        }
      } else {
        warnings.push(
          `${target.label} gagal diarsipkan: ${errorMessage(result.reason)}`,
        );
      }
    });

    touchSession(session);
    await store.save(session);
  }

  return { session, warnings };
}

export async function enableTools({}, { paseo }: PluginHandlerContext) {
  const agentTools = await enableAgentTools(paseo);
  return { agentTools };
}
