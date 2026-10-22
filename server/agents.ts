import type { PaseoAgent, PaseoAgentListResult, PaseoApi } from "@getpaseo/client";
import { LABEL_SESSION } from "../shared/constants";
import type { ProviderOption } from "../shared/contracts";

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

export async function listProviderOptions(paseo: PaseoApi): Promise<ProviderOption[]> {
  try {
    const snapshot = await paseo.providers.snapshot();
    const fromSnapshot = snapshot.entries
      .filter((entry) => entry.enabled !== false)
      .map((entry) => ({
        id: entry.provider,
        label: entry.label ?? entry.provider,
        models: (entry.models ?? [])
          .filter((model) => model.isSelectable !== false)
          .map((model) => ({
            id: model.id,
            label: model.label,
            isDefault: model.isDefault === true,
          })),
      }))
      .filter((entry) => entry.models.length > 0);

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
          const result = await paseo.providers.listModels(provider.provider);
          const models = (result.models ?? []).map((model) => ({
            id: model.id,
            label: model.label,
            isDefault: model.isDefault === true,
          }));
          return {
            id: provider.provider,
            label: provider.provider,
            models,
          };
        } catch (error) {
          console.warn(`[review-team] could not list models for ${provider.provider}:`, error);
          return null;
        }
      }),
  );

  return entries
    .filter((entry): entry is ProviderOption => entry !== null && entry.models.length > 0)
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
