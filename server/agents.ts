import type { PaseoAgent, PaseoAgentListResult, PaseoApi } from "@getpaseo/client";
import { LABEL_SESSION } from "../shared/constants";
import type { ProviderModel, ProviderOption } from "../shared/contracts";

const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

export interface AgentListEntry {
  id: string;
  title: string | null;
  status: "initializing" | "idle" | "running" | "error" | "closed";
  labels: Record<string, string>;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  archivedAt?: string | null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readAgentTools(paseo: PaseoApi): Promise<boolean> {
  const { config } = await paseo.config.get();
  return config.mcp?.injectIntoAgents === true;
}

export async function enableAgentTools(paseo: PaseoApi): Promise<boolean> {
  await paseo.config.patch({ mcp: { injectIntoAgents: true } });
  return readAgentTools(paseo);
}

interface ProviderSnapshotModeLike {
  id: string;
  label: string;
  description?: string;
}

interface ProviderSnapshotThinkingLike {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

interface ProviderSnapshotModelLike {
  id: string;
  label: string;
  isSelectable?: boolean;
  isDefault?: boolean;
  thinkingOptions?: ProviderSnapshotThinkingLike[];
  defaultThinkingOptionId?: string;
}

export interface ProviderSnapshotEntryLike {
  provider: string;
  enabled?: boolean;
  label?: string;
  modes?: ProviderSnapshotModeLike[];
  defaultModeId?: string | null;
  models?: ProviderSnapshotModelLike[];
}

function defaultThinkingId(model: ProviderSnapshotModelLike): string | null {
  const options = model.thinkingOptions ?? [];
  const preferred = model.defaultThinkingOptionId;
  if (preferred && options.some((option) => option.id === preferred)) return preferred;
  return options.find((option) => option.isDefault)?.id ?? null;
}

export function providerOptionFromSnapshotEntry(
  entry: ProviderSnapshotEntryLike,
): ProviderOption | null {
  const models: ProviderModel[] = (entry.models ?? [])
    .filter((model) => model.isSelectable !== false)
    .map((model) => ({
      id: model.id,
      label: model.label,
      isDefault: model.isDefault === true,
      thinkingOptions: (model.thinkingOptions ?? []).map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description ?? null,
      })),
      defaultThinkingOptionId: defaultThinkingId(model),
    }));
  if (models.length === 0) return null;

  const modes = (entry.modes ?? []).map((mode) => ({
    id: mode.id,
    label: mode.label,
    description: mode.description ?? null,
  }));
  const defaultModeId =
    entry.defaultModeId && modes.some((mode) => mode.id === entry.defaultModeId)
      ? entry.defaultModeId
      : null;

  return {
    id: entry.provider,
    label: entry.label?.trim() || entry.provider,
    modes,
    defaultModeId,
    models,
  };
}

export function resolveModeId(
  provider: Pick<ProviderOption, "modes" | "defaultModeId"> | null | undefined,
  requested?: string | null,
): string | null {
  if (!provider || provider.modes.length === 0) return null;
  return (
    provider.modes.find((mode) => mode.id === requested)?.id ??
    provider.modes.find((mode) => mode.id === provider.defaultModeId)?.id ??
    provider.modes[0].id
  );
}

export function resolveThinkingOptionId(
  model: Pick<ProviderModel, "thinkingOptions" | "defaultThinkingOptionId"> | null | undefined,
  requested?: string | null,
): string | null {
  if (!model || model.thinkingOptions.length === 0) return null;
  return (
    model.thinkingOptions.find((option) => option.id === requested)?.id ??
    model.thinkingOptions.find(
      (option) => option.id === model.defaultThinkingOptionId,
    )?.id ??
    model.thinkingOptions[0].id
  );
}

export async function listProviderOptions(paseo: PaseoApi): Promise<ProviderOption[]> {
  try {
    const snapshot = await paseo.providers.snapshot();
    const fromSnapshot = snapshot.entries
      .filter((entry) => entry.enabled !== false)
      .map(providerOptionFromSnapshotEntry)
      .filter((entry): entry is ProviderOption => entry !== null);

    if (fromSnapshot.length > 0) {
      return fromSnapshot.sort((left, right) => left.label.localeCompare(right.label));
    }
  } catch (error) {
    console.warn("[review-team] provider snapshot failed, trying provider lists:", error);
  }

  const available = await paseo.providers.listAvailable();
  const entries = await Promise.all(
    available.providers
      .filter((provider) => provider.available)
      .map(async (provider) => {
        try {
          const [modelResult, modeResult] = await Promise.all([
            paseo.providers.listModels(provider.provider),
            paseo.providers.listModes(provider.provider).catch((error) => {
              console.warn(
                `[review-team] could not list modes for ${provider.provider}:`,
                error,
              );
              return null;
            }),
          ]);
          return providerOptionFromSnapshotEntry({
            provider: provider.provider,
            label: provider.provider,
            models: (modelResult.models ?? []).map((model) => ({
              id: model.id,
              label: model.label,
              isSelectable: model.isSelectable,
              isDefault: model.isDefault,
              thinkingOptions: model.thinkingOptions,
              defaultThinkingOptionId: model.defaultThinkingOptionId,
            })),
            modes: modeResult?.modes,
            defaultModeId: null,
          });
        } catch (error) {
          console.warn(`[review-team] could not list models for ${provider.provider}:`, error);
          return null;
        }
      }),
  );

  return entries
    .filter((entry): entry is ProviderOption => entry !== null)
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function refreshAgent(paseo: PaseoApi, agentId: string): Promise<PaseoAgent | null> {
  const handle = paseo.agents.ref(agentId);
  const refreshed = await handle.refresh();
  return refreshed?.agent ?? handle.current();
}

export async function readTimelineTail(paseo: PaseoApi, agentId: string, limit = 80) {
  return paseo.agents.ref(agentId).timeline.refetch({
    direction: "tail",
    limit,
    projection: "projected",
  });
}

export async function listSessionAgents(
  paseo: PaseoApi,
  sessionId: string,
  leadAgentId: string | null,
): Promise<AgentListEntry[]> {
  const requests: Promise<PaseoAgentListResult>[] = [
    paseo.agents.list({
      scope: "active",
      filter: { labels: { [LABEL_SESSION]: sessionId } },
      page: { limit: 100 },
    }),
  ];

  if (leadAgentId) {
    requests.push(
      paseo.agents.list({
        scope: "active",
        filter: { labels: { [PARENT_AGENT_ID_LABEL]: leadAgentId } },
        page: { limit: 100 },
      }),
    );
  }

  const results = await Promise.all(requests);
  const merged = new Map<string, AgentListEntry>();
  for (const result of results) {
    for (const entry of result.entries) {
      merged.set(entry.agent.id, {
        id: entry.agent.id,
        title: entry.agent.title,
        status: entry.agent.status,
        labels: entry.agent.labels,
        requiresAttention: entry.agent.requiresAttention,
        attentionReason: entry.agent.attentionReason,
        archivedAt: entry.agent.archivedAt,
      });
    }
  }
  return Array.from(merged.values());
}

export async function sendToAgent(
  paseo: PaseoApi,
  agentId: string,
  text: string,
  activeTurnBehavior: "steer" | "interrupt",
): Promise<void> {
  await paseo.agents.ref(agentId).send(text, { activeTurnBehavior });
}

export async function archiveAgent(paseo: PaseoApi, agentId: string): Promise<void> {
  await paseo.agents.ref(agentId).archive();
}
