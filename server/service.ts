import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  LABEL_PRESET,
  LABEL_ROLE,
  LABEL_SESSION,
  MAX_MESSAGE_LENGTH,
  ROLE_LEAD,
} from "../shared/constants";
import type { ProviderOption, ReviewSession, SetupDefaults } from "../shared/contracts";
import {
  presetSummaries,
  resolvePreset,
  translationConfigFor,
  translatorLabelFor,
  type PresetDefinition,
} from "../shared/presets";
import {
  buildLeadPrompt,
  buildOperatorMessage,
  buildReportRequestMessage,
  buildStopMessage,
} from "../shared/prompts";
import { isSafeRelativePath, normalizeRelativePath } from "../shared/translation";
import {
  archiveAgent,
  enableAgentTools,
  errorMessage,
  listProviderOptions,
  readAgentTools,
  sendToAgent,
} from "./agents";
import { reconcileSession } from "./observer";
import { loadPresetCatalog } from "./presets";
import { appendEvent, store, touchSession } from "./store";
import { outputDirAbsolute, validateOutputDir } from "./translation";

const ACTIVE_STATUSES = new Set(["starting", "running", "needs_input"]);

function nowIso(): string {
  return new Date().toISOString();
}

function defaultsFor(
  providers: ProviderOption[],
  saved: SetupDefaults | null,
  presets: readonly PresetDefinition[],
): SetupDefaults {
  const preset = resolvePreset(presets, saved?.presetId);
  const provider =
    (saved ? providers.find((entry) => entry.id === saved.provider) : undefined) ?? providers[0];
  const model = provider
    ? (provider.models.find((entry) => entry.id === saved?.model) ??
      provider.models.find((entry) => entry.isDefault) ??
      provider.models[0])
    : undefined;

  const allowed = new Set(preset.lenses.map((lens) => lens.id));
  const savedLenses =
    saved && saved.presetId === preset.id
      ? Array.from(new Set(saved.lenses.filter((lens) => allowed.has(lens)))).slice(0, 8)
      : [];

  const savedOutputDir =
    saved && saved.presetId === preset.id && saved.outputDir && isSafeRelativePath(saved.outputDir)
      ? normalizeRelativePath(saved.outputDir)
      : null;
  const outputDir =
    preset.task === "translate"
      ? (savedOutputDir ?? preset.translation?.defaultOutputDir ?? null)
      : null;

  return {
    presetId: preset.id,
    provider: provider?.id ?? saved?.provider ?? null,
    model: model?.id ?? saved?.model ?? null,
    lenses: savedLenses.length > 0 ? savedLenses : [...preset.defaultLensIds],
    depth: saved?.depth ?? "standard",
    outputDir,
  };
}

function findSession(sessionId: string): ReviewSession {
  const session = store.get(sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
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

  const catalog = await loadPresetCatalog();

  return {
    session,
    agentToolsEnabled,
    providers,
    defaults: defaultsFor(providers, store.getDefaults(), catalog.presets),
    presets: presetSummaries(catalog.presets),
    presetWarnings: catalog.warnings,
  };
}

export async function startSession(
  input: {
    workspaceId: string;
    presetId?: string;
    target: string;
    lenses: string[];
    depth: "quick" | "standard" | "deep";
    providerId: string;
    modelId: string;
    modeId?: string | null;
    thinkingOptionId?: string | null;
    outputDir?: string;
  },
  { paseo }: PluginHandlerContext,
) {
  await store.ensureLoaded();

  const catalog = await loadPresetCatalog();
  const preset = resolvePreset(catalog.presets, input.presetId);
  const allowed = new Set(preset.lenses.map((lens) => lens.id));

  const agentTools = await readAgentTools(paseo);
  if (!agentTools) {
    throw new Error(
      preset.task === "translate"
        ? "Agent tools Paseo belum aktif. Aktifkan dulu agar lead bisa membuat penerjemah dan peninjau QA lewat create_agent."
        : "Agent tools Paseo belum aktif. Aktifkan dulu agar lead bisa membuat reviewer lewat create_agent.",
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
    throw new Error("Masih ada sesi aktif di workspace ini. Hentikan dulu sesi tersebut.");
  }

  const lenses = Array.from(new Set(input.lenses.map((lens) => lens.trim()).filter(Boolean)));
  if (lenses.length === 0) throw new Error("Pilih minimal satu lensa review.");
  const unknown = lenses.filter((lens) => !allowed.has(lens));
  if (unknown.length > 0) {
    throw new Error(
      `Lensa ${unknown.join(", ")} tidak tersedia untuk preset "${preset.label}". Muat ulang panel lalu pilih ulang lensa.`,
    );
  }

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

  const isTranslation = preset.task === "translate";
  const translationConfig = isTranslation ? translationConfigFor(preset) : null;
  let outputDir: string | null = null;
  let workspaceDirectory: string | null = null;

  if (isTranslation && translationConfig) {
    const requested = input.outputDir?.trim() ?? "";
    if (!requested) {
      throw new Error("Folder hasil wajib diisi untuk preset Terjemahan Novel.");
    }
    const directory = snapshot.workspaceDirectory?.trim();
    if (!directory) {
      throw new Error(
        "Workspace ini tidak punya folder lokal di daemon. Buka workspace dari checkout lokal agar penerjemah bisa menulis hasil.",
      );
    }
    const validated = await validateOutputDir(directory, requested);
    outputDir = validated.relative;
    workspaceDirectory = validated.workspace;
  } else if (input.outputDir?.trim()) {
    throw new Error("Folder hasil hanya dipakai preset terjemahan. Pilih preset Terjemahan Novel.");
  }

  const session: ReviewSession = {
    id: sessionId,
    presetId: preset.id,
    task: preset.task,
    translation:
      isTranslation && translationConfig && outputDir
        ? {
            sourceLanguage: translationConfig.sourceLanguage,
            targetLanguage: translationConfig.targetLanguage,
            outputDir,
            unitLabel: translationConfig.unitLabel,
          }
        : null,
    workspaceId: actualWorkspaceId,
    workspaceName,
    workspaceDirectory,
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
    translators: [],
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
    message: isTranslation
      ? `Sesi ${preset.label} dimulai untuk ${workspaceName}: ${lenses.length} lensa QA, folder hasil ${outputDir}.`
      : `Sesi ${preset.label} dimulai untuk ${workspaceName} dengan ${lenses.length} lensa.`,
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
      preset,
      outputDir,
      outputDirAbsolute: outputDirAbsolute(session),
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
        [LABEL_PRESET]: preset.id,
      },
      prompt,
    });

    session.leadAgentId = lead.id;
    session.leadTitle = `Review Team Lead [${sessionId.slice(0, 8)}] — ${workspaceName}`;
    session.leadAgentStatus = "initializing";
    session.status = "running";
    session.phase = isTranslation ? "translating" : "reviewing";
    appendEvent(session, {
      kind: "lead",
      message: isTranslation
        ? "Lead dibuat dan mulai menyiapkan batch penerjemah."
        : "Lead dibuat dan mulai menyiapkan reviewer.",
      agentId: lead.id,
      lens: null,
    });
    touchSession(session);
    await store.save(session);

    await store
      .saveDefaults({
        presetId: preset.id,
        provider: input.providerId,
        model: input.modelId,
        lenses,
        depth: input.depth,
        outputDir,
      })
      .catch((error) => {
        console.warn("[review-team] could not save setup defaults:", errorMessage(error));
      });

    return { session };
  } catch (error) {
    session.status = "failed";
    session.phase = "failed";
    session.error = isTranslation
      ? `Gagal membuat lead terjemahan: ${errorMessage(error)}`
      : `Gagal membuat lead review: ${errorMessage(error)}`;
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
  if (session.status === "stopped") throw new Error("Sesi sudah dihentikan.");
  if (!session.leadAgentId) throw new Error("Lead belum siap.");

  const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!trimmed) throw new Error("Pesan kosong.");

  await sendToAgent(
    paseo,
    session.leadAgentId,
    buildOperatorMessage(trimmed, session.task),
    "steer",
  );
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
  if (session.status === "stopped") throw new Error("Sesi sudah dihentikan.");
  if (!session.leadAgentId) throw new Error("Lead belum siap.");

  await sendToAgent(
    paseo,
    session.leadAgentId,
    buildReportRequestMessage(session.task),
    "steer",
  );
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
      session.reviewers.some((reviewer) => reviewer.status === "running") ||
      session.translators.some((translator) => translator.status === "running");

    session.status = "stopped";
    if (session.phase !== "complete") session.phase = "stopped";
    session.stoppedAt = nowIso();
    appendEvent(session, {
      kind: "session",
      message: "Sesi dihentikan oleh operator.",
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
    if (
      session.leadAgentId ||
      session.reviewers.length > 0 ||
      session.translators.length > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const catalog = await loadPresetCatalog();
    const preset = resolvePreset(catalog.presets, session.presetId);
    const translatorName = translatorLabelFor(preset);

    const targets: Array<{
      id: string;
      label: string;
      kind: "lead" | "reviewer" | "translator";
    }> = [];
    if (session.leadAgentId) {
      targets.push({ id: session.leadAgentId, label: "Lead", kind: "lead" });
    }
    for (const reviewer of session.reviewers) {
      if (reviewer.status === "archived") continue;
      targets.push({
        id: reviewer.agentId,
        label: `Reviewer ${reviewer.lens}`,
        kind: "reviewer",
      });
    }
    for (const translator of session.translators) {
      if (translator.status === "archived") continue;
      targets.push({
        id: translator.agentId,
        label: `${translatorName} ${translator.unit}`,
        kind: "translator",
      });
    }

    const results = await Promise.allSettled(
      targets.map((target) => archiveAgent(paseo, target.id)),
    );

    results.forEach((result, index) => {
      const target = targets[index];
      if (result.status === "fulfilled") {
        if (target.kind === "reviewer") {
          const reviewer = session.reviewers.find(
            (entry) => entry.agentId === target.id,
          );
          if (reviewer) reviewer.status = "archived";
        } else if (target.kind === "translator") {
          const translator = session.translators.find(
            (entry) => entry.agentId === target.id,
          );
          if (translator) translator.status = "archived";
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
