import {
  FINDINGS_FENCE,
  FINAL_FENCE,
  LABEL_LENS,
  LABEL_PRESET,
  LABEL_ROLE,
  LABEL_SESSION,
  REPORT_BEGIN,
  REPORT_END,
  ROLE_REVIEWER,
} from "./constants";
import {
  depthFor,
  lensHintFor,
  lensLabelFor,
  type PresetDefinition,
} from "./presets";

export interface LeadPromptInput {
  sessionId: string;
  target: string;
  workspaceId: string;
  lenses: string[];
  depth: string;
  provider: string;
  preset: PresetDefinition;
}

function bullets(lines: string[]): string[] {
  return lines.map((line) => `- ${line}`);
}

export function buildLeadPrompt(input: LeadPromptInput): string {
  const { preset } = input;
  const depth = depthFor(preset, input.depth);
  const lensLines = input.lenses.map(
    (lens) => `- ${lensLabelFor(preset, lens)} (\`${lens}\`): ${lensHintFor(preset, lens)}`,
  );
  const lensList = input.lenses.join(", ");
  const location = preset.prompt.locationExample;

  const lines = [
    preset.prompt.leadRole,
    "",
    "## Session",
    `- Session id: ${input.sessionId}`,
    `- Preset: ${preset.label} (\`${preset.id}\`)`,
    `- Target: ${input.target}`,
    `- Paseo workspace id: ${input.workspaceId}`,
    `- Depth: ${depth.label} (\`${input.depth}\`). ${depth.guidance}`,
    `- Lenses: ${lensList}`,
    `- Provider/model for you and every reviewer: ${input.provider}`,
    "",
    "Lens focus:",
    ...lensLines,
    "",
    "## Rules",
    ...bullets(preset.prompt.leadRules),
    "",
    "## Creating a reviewer",
    "Call `create_agent` once per lens with:",
    '- `workspaceId`: the Paseo workspace id above (so the reviewer lives beside the target, not in your home).',
    '- `title`: `Reviewer: <lens>` using the human lens name. Keep the `Reviewer:` prefix exactly; the plugin uses it to match the agent.',
    `- \`provider\`: \`${input.provider}\`.`,
    "- `initialPrompt`: the reviewer brief below, with every placeholder replaced. Keep it complete; do not shorten it.",
    `- \`labels\`: \`{"${LABEL_SESSION}": "${input.sessionId}", "${LABEL_ROLE}": "${ROLE_REVIEWER}", "${LABEL_LENS}": "<lens id>", "${LABEL_PRESET}": "${preset.id}"}\`.`,
    "- `notifyOnFinish`: `true`.",
    "",
    "Reviewers cannot see this conversation, so the brief must stand alone.",
    "",
    "## Reviewer brief template",
    "---",
    preset.prompt.reviewerRole,
    "",
    "Lens: {{LENS_LABEL}} ({{LENS_ID}}). Focus: {{LENS_HINT}}",
    "Target: {{TARGET}}",
    "Depth: {{DEPTH}}. {{DEPTH_GUIDANCE}}",
    "",
    "Rules:",
    ...bullets(preset.prompt.reviewerRules),
    ...bullets(preset.prompt.evidenceRules),
    "",
    "Progress and report format:",
    "- End every assistant turn with one status line:",
    "REVIEW_STATUS: WORKING|NEEDS_INPUT|DONE|BLOCKED|FAILED — one short sentence",
    "- When you are finished, output this block exactly once, after your prose:",
    "REVIEW_REPORT: DONE|BLOCKED|FAILED",
    "```" + FINDINGS_FENCE,
    `{"lens":"{{LENS_ID}}","verdict":"pass|warn|fail","summary":"...","findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"${location}","recommendation":"..."}]}`,
    "```",
    "- The JSON must be valid. Use verdict `pass` with an empty findings array when you found nothing material.",
    `- Write the summary, finding titles, details, and recommendations in ${preset.prompt.reportLanguage}. Keep the JSON keys and the fixed marker values exactly as shown.`,
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
    ...bullets(preset.prompt.consolidationFocus),
    `- Depth guidance for this session: ${depth.guidance}`,
    "",
    "## Final report",
    "When the review is complete, emit exactly one block between the sentinels. Nothing inside the sentinels except the verdict line and the fenced JSON block:",
    REPORT_BEGIN,
    "REVIEW_VERDICT: approve|request_changes|blocked",
    "```" + FINAL_FENCE,
    `{"summary":"...","findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"${location}","recommendation":"..."}]}`,
    "```",
    REPORT_END,
    "",
    preset.prompt.verdictGuidance,
    `Write the final summary, findings, and recommendations in ${preset.prompt.reportLanguage}; keep the JSON keys and verdict values exactly as shown.`,
    "",
    "The operator's UI is in Indonesian. Reply to direct operator messages in Indonesian unless they use another language.",
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
