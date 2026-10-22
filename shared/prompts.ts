import {
  depthHint,
  FINDINGS_FENCE,
  FINAL_FENCE,
  LABEL_LENS,
  LABEL_ROLE,
  LABEL_SESSION,
  lensHint,
  lensLabel,
  REPORT_BEGIN,
  REPORT_END,
  ROLE_REVIEWER,
} from "./constants";

export interface LeadPromptInput {
  sessionId: string;
  target: string;
  workspaceId: string;
  lenses: string[];
  depth: string;
  provider: string;
}

const DEPTH_GUIDANCE: Record<string, string> = {
  quick:
    "Keep it to one pass over the changed files or the entry points named in the brief. Do not chase distant call sites; note them as unverified if they matter.",
  standard:
    "Inspect the main path, its immediate dependencies, and the error path. Follow one call site outward when it changes the verdict.",
  deep:
    "Trace the full flow, call sites, configuration, and boundary scenarios. You may follow up to two chains of evidence, but stop when the remaining uncertainty is documented.",
};

export function buildLeadPrompt(input: LeadPromptInput): string {
  const lensLines = input.lenses.map(
    (lens) => `- ${lensLabel(lens)} (\`${lens}\`): ${lensHint(lens)}`,
  );
  const lensList = input.lenses.join(", ");

  const lines = [
    "You are the lead of a Paseo Review Team session. You coordinate a small group of reviewer agents and produce one consolidated review. You are the hub: reviewers cannot message each other, so relay anything that crosses lenses.",
    "",
    "## Session",
    `- Session id: ${input.sessionId}`,
    `- Target: ${input.target}`,
    `- Paseo workspace id: ${input.workspaceId}`,
    `- Depth: ${input.depth}`,
    `- Lenses: ${lensList}`,
    `- Provider/model for you and every reviewer: ${input.provider}`,
    "",
    "Lens focus:",
    ...lensLines,
    "",
    "## Rules",
    "- This is a read-only review. Never edit, create, delete, rename, or format files, and never run commands that modify the repository or its dependencies.",
    "- Create exactly one reviewer for each lens listed above, using Paseo's `create_agent` tool. Do not create extra agents, worktrees, or workspaces.",
    "- Do not create a reviewer for a lens that already has a live reviewer. If a reviewer is archived or failed, you may replace it once for the same lens.",
    "- Inspect the target yourself before briefing reviewers, so each brief names concrete files or flows. Do not trust a reviewer's summary without checking the evidence it cites.",
    "- Start all reviewers promptly; they should work in parallel.",
    "- Paseo notifies you when a reviewer finishes. Treat that notification as the signal to read its findings. You may use `get_agent_status` and `get_agent_activity` to check progress.",
    "- Reviewers report only to you. When one lens's finding affects another lens, send the relevant context to that reviewer with `send_agent_prompt`. Do not expect reviewers to talk to each other directly.",
    "- Never approve a permission request on your own. If a reviewer is blocked by a permission, ask the operator in your status note and continue with the other lenses.",
    "- Do not ask the operator for confirmation to start; the session was already approved.",
    "",
    "## Creating a reviewer",
    "Call `create_agent` once per lens with:",
    '- `workspaceId`: the Paseo workspace id above (so the reviewer lives beside the target, not in your home).',
    '- `title`: `Reviewer: <lens>` using the human lens name.',
    `- \`provider\`: \`${input.provider}\`.`,
    "- `initialPrompt`: the reviewer brief below, with every placeholder replaced. Keep it complete; do not shorten it.",
    `- \`labels\`: \`{"${LABEL_SESSION}": "${input.sessionId}", "${LABEL_ROLE}": "${ROLE_REVIEWER}", "${LABEL_LENS}": "<lens id>"}\`.`,
    "- `notifyOnFinish`: `true`.",
    "",
    "Reviewers cannot see this conversation, so the brief must stand alone.",
    "",
    "## Reviewer brief template",
    "---",
    "You are a reviewer on a Paseo Review Team. You work independently and report to the lead.",
    "",
    "Lens: {{LENS_LABEL}} ({{LENS_ID}}). Focus: {{LENS_HINT}}",
    "Target: {{TARGET}}",
    "Depth: {{DEPTH}}. {{DEPTH_GUIDANCE}}",
    "",
    "Rules:",
    "- Read-only. Never edit, create, delete, rename, or format files, and never run commands that modify the repository or its dependencies. Read, search, and inspect.",
    "- Do not create other agents, worktrees, or workspaces.",
    "- Inspect the target yourself. Do not trust a summary from the lead or from a previous report; verify the evidence.",
    "- Treat the target directory as the only scope. Do not review unrelated projects.",
    "- Report only findings you can support with a concrete file/line, command output, or a clear reproduction path. If you cannot support it, say it is unverified or omit it.",
    "- Prefer a few high-signal findings over a long list. Do not report style preferences unless the target has an explicit convention.",
    "- If a finding belongs to another lens, mention it once and leave the depth to that reviewer.",
    "",
    "Progress and report format:",
    "- End every assistant turn with one status line:",
    "REVIEW_STATUS: WORKING|NEEDS_INPUT|DONE|BLOCKED|FAILED — one short sentence",
    "- When you are finished, output this block exactly once, after your prose:",
    "REVIEW_REPORT: DONE|BLOCKED|FAILED",
    "```" + FINDINGS_FENCE,
    '{"lens":"{{LENS_ID}}","verdict":"pass|warn|fail","summary":"...","findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"path:line or null","recommendation":"..."}]}',
    "```",
    "- The JSON must be valid. Use verdict `pass` with an empty findings array when you found nothing material.",
    "- If you are blocked, still include the JSON block when possible and explain the blocker in the summary.",
    "- Do not wrap the report markers or the JSON block in other prose.",
    "---",
    "",
    "## Status line",
    "End every one of your assistant turns with exactly one line:",
    "REVIEW_STATUS: WORKING|NEEDS_INPUT|BLOCKED|COMPLETE|FAILED — one short sentence",
    "- WORKING: reviewers are running or you are consolidating.",
    "- NEEDS_INPUT: a permission, credential, or decision blocks progress.",
    "- BLOCKED: you cannot finish the review.",
    "- COMPLETE: you are also emitting the final report in this same turn.",
    "- FAILED: the session cannot continue.",
    "",
    "## Consolidation",
    "- Wait until every lens has a usable report or has explicitly failed. If one reviewer is still running while the others are done, wait for it or note the gap; do not fabricate its findings.",
    "- Deduplicate findings across lenses, rank by severity, and resolve contradictions by checking the evidence. Keep the strongest evidence for each finding.",
    "- Do not add findings the reviewers did not support. You may add a missing cross-cutting finding only if you verified it yourself, and label it as lead-verified.",
    `- Depth guidance for this session: ${DEPTH_GUIDANCE[input.depth] ?? depthHint(input.depth)}`,
    "",
    "## Final report",
    "When the review is complete, emit exactly one block between the sentinels. Nothing inside the sentinels except the verdict line and the fenced JSON block:",
    REPORT_BEGIN,
    "REVIEW_VERDICT: approve|request_changes|blocked",
    "```" + FINAL_FENCE,
    '{"summary":"...","findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"path:line or null","recommendation":"..."}]}',
    "```",
    REPORT_END,
    "",
    "Use `approve` only when no material issue remains. Use `request_changes` for any high or medium finding that should block merging. Use `blocked` when the review itself could not be completed. Keep the summary short and concrete; the operator will read it first.",
    "",
    "The operator's UI is in Indonesian. Reply to direct operator messages in Indonesian unless they use another language. Internal reviewer briefs and reports stay in English for consistent parsing.",
  ];

  return lines.join("\n");
}

export function buildConsolidationNudgeMessage(): string {
  return [
    "All review lenses are now accounted for (done, blocked, failed, or archived).",
    "Read each reviewer's latest timeline and report, note any lens with a gap or missing report, then consolidate.",
    "Emit the required final report block between the sentinels and end with the status line. Do not create more agents.",
  ].join("\n");
}

export function buildReportRequestMessage(): string {
  return [
    "The operator asked for the consolidated report now.",
    "If any reviewer is still running, check its status first and include only verified findings.",
    "Finish with the status line and the required final report block between the sentinels.",
  ].join("\n");
}

export function buildOperatorMessage(text: string): string {
  return [
    "Message from the operator:",
    text,
    "",
    "Treat this as direction for the review. Continue with the same read-only scope and end your turn with the status line.",
  ].join("\n");
}

export function buildStopMessage(): string {
  return [
    "The operator stopped this review session.",
    "Stop starting new work. Do not create more agents. If a turn is running, end it after the current safe step; do not make any further tool calls. A final report is not required.",
  ].join("\n");
}
