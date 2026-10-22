import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FindingSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  title: z.string(),
  detail: z.string(),
  file: z.string().nullable(),
  recommendation: z.string().nullable(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const ReviewerStatusSchema = z.enum([
  "starting",
  "running",
  "needs_input",
  "idle",
  "done",
  "blocked",
  "failed",
  "archived",
  "unknown",
]);

export const ReviewerSchema = z.object({
  agentId: z.string(),
  lens: z.string(),
  title: z.string().nullable(),
  status: ReviewerStatusSchema,
  verdict: z.enum(["pass", "warn", "fail"]).nullable(),
  summary: z.string().nullable(),
  reportText: z.string().nullable(),
  reportFormat: z.enum(["none", "structured", "text"]),
  findings: z.array(FindingSchema),
  lastSeenAt: z.string().nullable(),
});

export type Reviewer = z.infer<typeof ReviewerSchema>;

export const SessionStatusSchema = z.enum(["starting", "running", "needs_input", "stopped", "failed"]);

export const SessionPhaseSchema = z.enum([
  "starting",
  "reviewing",
  "consolidating",
  "complete",
  "stopped",
  "failed",
]);

export const EventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(["session", "lead", "reviewer", "permission", "report", "message", "error"]),
  message: z.string(),
  agentId: z.string().nullable(),
  lens: z.string().nullable(),
});

export type ReviewEvent = z.infer<typeof EventSchema>;

export const ReviewSessionSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  target: z.string(),
  lenses: z.array(z.string()),
  depth: z.enum(["quick", "standard", "deep"]),
  provider: z.string(),
  modeId: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  status: SessionStatusSchema,
  phase: SessionPhaseSchema,
  leadAgentId: z.string().nullable(),
  leadTitle: z.string().nullable(),
  leadAgentStatus: z.enum(["initializing", "idle", "running", "error", "closed"]).nullable(),
  leadState: z.enum(["working", "needs_input", "blocked", "complete", "failed"]).nullable(),
  leadNote: z.string().nullable(),
  reviewers: z.array(ReviewerSchema),
  pendingPermissions: z.array(z.string()),
  findings: z.array(FindingSchema),
  finalReport: z.string().nullable(),
  finalSummary: z.string().nullable(),
  verdict: z.enum(["approve", "request_changes", "blocked"]).nullable(),
  coverage: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  events: z.array(EventSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string(),
  stoppedAt: z.string().nullable(),
});

export type ReviewSession = z.infer<typeof ReviewSessionSchema>;

export const ProviderOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      isDefault: z.boolean(),
    }),
  ),
});

export const SetupDefaultsSchema = z.object({
  provider: z.string().nullable(),
  model: z.string().nullable(),
  lenses: z.array(z.string()),
  depth: z.enum(["quick", "standard", "deep"]),
});

export type ProviderOption = z.infer<typeof ProviderOptionSchema>;
export type SetupDefaults = z.infer<typeof SetupDefaultsSchema>;

const SessionIdInput = z.object({ sessionId: z.string().min(1).max(200) });

export const stateGetRpc = defineRpc({
  name: "review-team.state.get",
  input: z.object({ workspaceId: z.string().min(1).max(200) }),
  output: z.object({
    session: ReviewSessionSchema.nullable(),
    agentToolsEnabled: z.boolean(),
    providers: z.array(ProviderOptionSchema),
    defaults: SetupDefaultsSchema,
  }),
});

export const toolsEnableRpc = defineRpc({
  name: "review-team.tools.enable",
  input: z.object({}),
  output: z.object({ agentTools: z.boolean() }),
});

export const sessionStartRpc = defineRpc({
  name: "review-team.session.start",
  input: z.object({
    workspaceId: z.string().min(1).max(200),
    target: z.string().trim().min(1).max(2000),
    lenses: z.array(z.string().min(1).max(40)).min(1).max(8),
    depth: z.enum(["quick", "standard", "deep"]),
    providerId: z.string().trim().min(1).max(200),
    modelId: z.string().trim().min(1).max(200),
    modeId: z.string().max(200).nullable().optional(),
    thinkingOptionId: z.string().max(200).nullable().optional(),
  }),
  output: z.object({ session: ReviewSessionSchema }),
});

export const sessionRefreshRpc = defineRpc({
  name: "review-team.session.refresh",
  input: SessionIdInput,
  output: z.object({ session: ReviewSessionSchema }),
});

export const sessionStopRpc = defineRpc({
  name: "review-team.session.stop",
  input: SessionIdInput.extend({ archiveAgents: z.boolean() }),
  output: z.object({
    session: ReviewSessionSchema,
    warnings: z.array(z.string()),
  }),
});

export const leadSendRpc = defineRpc({
  name: "review-team.lead.send",
  input: SessionIdInput.extend({ text: z.string().trim().min(1).max(4000) }),
  output: z.object({ ok: z.literal(true) }),
});

export const requestReportRpc = defineRpc({
  name: "review-team.session.request-report",
  input: SessionIdInput,
  output: z.object({ ok: z.literal(true) }),
});

export type ReviewTeamState = z.infer<typeof stateGetRpc.output>;
export type StartSessionInput = z.input<typeof sessionStartRpc.input>;

