import {
  FINDINGS_FENCE,
  FINAL_FENCE,
  LABEL_LENS,
  LABEL_PRESET,
  LABEL_ROLE,
  LABEL_SESSION,
  LABEL_UNIT,
  REPORT_BEGIN,
  REPORT_END,
  ROLE_REVIEWER,
  ROLE_TRANSLATOR,
  TRANSLATION_FENCE,
} from "./constants";
import {
  depthFor,
  lensHintFor,
  lensLabelFor,
  translationConfigFor,
  translatorLabelFor,
  translatorPluralFor,
  type PresetDefinition,
  type PresetTask,
} from "./presets";
import { normalizeOutputExtension } from "./translation";

export interface LeadPromptInput {
  sessionId: string;
  target: string;
  workspaceId: string;
  lenses: string[];
  depth: string;
  provider: string;
  modeId?: string | null;
  modeLabel?: string | null;
  thinkingOptionId?: string | null;
  thinkingLabel?: string | null;
  preset: PresetDefinition;
  outputDir?: string | null;
  outputDirAbsolute?: string | null;
  outputExtension?: string | null;
}

function bullets(lines: string[]): string[] {
  return lines.map((line) => `- ${line}`);
}

function settingLabel(label: string | null | undefined, id: string): string {
  const trimmed = label?.trim();
  return trimmed ? `${trimmed} (\`${id}\`)` : `\`${id}\``;
}

function providerSettingLines(input: LeadPromptInput): string[] {
  return [
    ...(input.modeId
      ? [
          `- Mode for you and every child agent: ${settingLabel(input.modeLabel, input.modeId)}`,
        ]
      : []),
    ...(input.thinkingOptionId
      ? [
          `- Thinking level for you and every child agent: ${settingLabel(
            input.thinkingLabel,
            input.thinkingOptionId,
          )}`,
        ]
      : []),
  ];
}

function childSettingsLine(input: LeadPromptInput): string | null {
  const settings: { modeId?: string; thinkingOptionId?: string } = {};
  if (input.modeId) settings.modeId = input.modeId;
  if (input.thinkingOptionId) settings.thinkingOptionId = input.thinkingOptionId;
  if (Object.keys(settings).length === 0) return null;
  return `- \`settings\`: \`${JSON.stringify(
    settings,
  )}\`. Use these exact settings for this agent; do not change them per child.`;
}

export function buildLeadPrompt(input: LeadPromptInput): string {
  return input.preset.task === "translate"
    ? buildTranslationLeadPrompt(input)
    : buildReviewLeadPrompt(input);
}

function buildReviewLeadPrompt(input: LeadPromptInput): string {
  const { preset } = input;
  const depth = depthFor(preset, input.depth);
  const lensLines = input.lenses.map(
    (lens) => `- ${lensLabelFor(preset, lens)} (\`${lens}\`): ${lensHintFor(preset, lens)}`,
  );
  const lensList = input.lenses.join(", ");
  const location = preset.prompt.locationExample;
  const settingsLine = childSettingsLine(input);

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
    ...providerSettingLines(input),
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
    ...(settingsLine ? [settingsLine] : []),
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

function buildTranslationLeadPrompt(input: LeadPromptInput): string {
  const { preset } = input;
  const depth = depthFor(preset, input.depth);
  const config = translationConfigFor(preset);
  const translator = translatorLabelFor(preset);
  const translatorPlural = translatorPluralFor(preset);
  const outputDir = input.outputDir?.trim() || config.defaultOutputDir;
  const outputDirAbsolute = input.outputDirAbsolute?.trim() || "tidak tersedia";
  const outputExtension = normalizeOutputExtension(input.outputExtension) ?? config.outputExtension;
  const location = preset.prompt.locationExample;
  const languages = `${config.sourceLanguage} → ${config.targetLanguage}`;
  const lensLines = input.lenses.map(
    (lens) => `- ${lensLabelFor(preset, lens)} (\`${lens}\`): ${lensHintFor(preset, lens)}`,
  );
  const lensList = input.lenses.join(", ");
  const translatorRules = preset.prompt.translatorRules ?? [];
  const translationFocus = preset.prompt.translationFocus ?? [];
  const reportLanguage = preset.prompt.reportLanguage;
  const settingsLine = childSettingsLine(input);

  const lines = [
    preset.prompt.leadRole,
    "",
    "## Session",
    `- Session id: ${input.sessionId}`,
    `- Preset: ${preset.label} (\`${preset.id}\`)`,
    `- Mode: novel translation (${languages})`,
    `- Source range: ${input.target}`,
    `- Output folder (workspace-relative): \`${outputDir}\``,
    `- Output folder on disk: \`${outputDirAbsolute}\``,
    `- Output file format: \`${outputExtension}\``,
    `- Paseo workspace id: ${input.workspaceId}`,
    `- Depth: ${depth.label} (\`${input.depth}\`). ${depth.guidance}`,
    `- QA lenses: ${lensList}`,
    `- Provider/model for you, every ${translator.toLowerCase()}, and every QA reviewer: ${input.provider}`,
    ...providerSettingLines(input),
    `- Batch limits for this session: at most ${config.maxUnitsPerSession} ${config.unitLabel.toLowerCase()} and at most ${config.maxConcurrentTranslators} concurrent ${translatorPlural}.`,
    "",
    "QA lens focus:",
    ...lensLines,
    "",
    "## Rules",
    ...bullets(preset.prompt.leadRules),
    "",
    "## Phase 1 — create translators",
    `Call \`create_agent\` once per translation unit with:`,
    '- `workspaceId`: the Paseo workspace id above (so the agent lives beside the manuscript).',
    `- \`title\`: \`Translator: <unit>\` using the unit name, for example \`Translator: ${config.unitLabel} 1\`. Keep the \`Translator:\` prefix exactly; the plugin uses it to match the agent.`,
    `- \`provider\`: \`${input.provider}\`.`,
    ...(settingsLine ? [settingsLine] : []),
    "- `initialPrompt`: the translator brief below, with every placeholder replaced. Keep it complete; do not shorten it.",
    `- \`labels\`: \`{"${LABEL_SESSION}": "${input.sessionId}", "${LABEL_ROLE}": "${ROLE_TRANSLATOR}", "${LABEL_UNIT}": "<unit>", "${LABEL_PRESET}": "${preset.id}"}\`.`,
    "- `notifyOnFinish`: `true`.",
    "",
    `Start at most ${config.maxConcurrentTranslators} ${translatorPlural} at once, then start the next unit as soon as one finishes until the batch limit. Do not wait for the whole batch before the first translator starts.`,
    "Translators cannot see this conversation, so each brief must stand alone. Include the glossary or terminology decisions the translator needs.",
    "",
    "## Translator brief template",
    "---",
    preset.prompt.translatorRole ?? "",
    "",
    `Unit: {{UNIT}} (for example ${config.unitLabel} 1)`,
    "Source: {{SOURCE_PATH}} (workspace-relative)",
    `Output: {{OUTPUT_PATH}} inside \`${outputDir}\` (workspace-relative, ending in \`${outputExtension}\`)`,
    `Languages: ${languages}`,
    "Glossary / terminology: {{GLOSSARY_OR_NONE}}",
    "Depth: {{DEPTH}}. {{DEPTH_GUIDANCE}}",
    "",
    "Translation focus:",
    ...bullets(translationFocus),
    "",
    "Rules:",
    ...bullets(translatorRules),
    `- Write only the assigned output file inside \`${outputDir}\`. Never edit the source file, another unit, or anything outside the output folder.`,
    "- The plugin verifies the output path after your report. If the file is missing, outside the output folder, or equal to the source path, the unit is not counted as done.",
    "",
    "Progress and report format:",
    "- End every assistant turn with one status line:",
    "REVIEW_STATUS: WORKING|NEEDS_INPUT|DONE|BLOCKED|FAILED — one short sentence",
    "- When the unit is translated and the output file is written, output this block exactly once, after your prose:",
    "TRANSLATION_REPORT: DONE|BLOCKED|FAILED",
    "```" + TRANSLATION_FENCE,
    `{"unit":"${config.unitLabel} 1","source":"manuscript/en/bab-01.md","output":"${outputDir}/bab-01${outputExtension}","summary":"...","notes":["..."]}`,
    "```",
    "- `source` and `output` must be workspace-relative paths, never absolute. Both must point at regular files.",
    "- The JSON must be valid. `notes` is optional. Write the summary and notes in " + reportLanguage + "; keep the JSON keys and marker values exactly as shown.",
    "- If you are blocked, still include the JSON block when possible and explain the blocker in the summary.",
    "- Do not wrap the report markers or the JSON block in other prose.",
    "---",
    "",
    "## Phase 2 — create QA reviewers",
    `Do not create QA reviewers until every translator has reached a terminal state: done, blocked, failed, or archived. Then call \`create_agent\` once per QA lens with:`,
    '- `workspaceId`: the Paseo workspace id above.',
    '- `title`: `Reviewer: <lens>` using the human lens name. Keep the `Reviewer:` prefix exactly; the plugin uses it to match the agent.',
    `- \`provider\`: \`${input.provider}\`.`,
    ...(settingsLine ? [settingsLine] : []),
    "- `initialPrompt`: the QA brief below, with every placeholder replaced.",
    `- \`labels\`: \`{"${LABEL_SESSION}": "${input.sessionId}", "${LABEL_ROLE}": "${ROLE_REVIEWER}", "${LABEL_LENS}": "<lens id>", "${LABEL_PRESET}": "${preset.id}"}\`.`,
    "- `notifyOnFinish`: `true`.",
    "",
    "## QA reviewer brief template",
    "---",
    preset.prompt.reviewerRole,
    "",
    "Lens: {{LENS_LABEL}} ({{LENS_ID}}). Focus: {{LENS_HINT}}",
    `Source range: ${input.target}`,
    `Translated output folder: \`${outputDir}\` (workspace-relative)`,
    `Output file format: \`${outputExtension}\``,
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
    `- Write the summary, finding titles, details, and recommendations in ${reportLanguage}. Keep the JSON keys and the fixed marker values exactly as shown.`,
    "- Report missing, empty, truncated, or corrupted translated units as findings even when the prose reads well.",
    "- Do not wrap the report markers or the JSON block in other prose.",
    "---",
    "",
    "## Status line",
    "End every one of your assistant turns with exactly one line:",
    "REVIEW_STATUS: WORKING|NEEDS_INPUT|BLOCKED|COMPLETE|FAILED — one short sentence",
    "- WORKING: translators or QA reviewers are running, or you are consolidating.",
    "- NEEDS_INPUT: a permission, credential, or decision blocks progress.",
    "- BLOCKED: you cannot finish the translation or QA.",
    "- COMPLETE: you are also emitting the final report in this same turn.",
    "- FAILED: the session cannot continue.",
    "",
    "## Consolidation",
    ...bullets(preset.prompt.consolidationFocus),
    `- Depth guidance for this session: ${depth.guidance}`,
    "- Confirm that every translated unit in scope is reported and present in the output folder before you approve.",
    "",
    "## Final report",
    "When the translation and QA are complete, emit exactly one block between the sentinels. Nothing inside the sentinels except the verdict line and the fenced JSON block:",
    REPORT_BEGIN,
    "REVIEW_VERDICT: approve|request_changes|blocked",
    "```" + FINAL_FENCE,
    `{"summary":"...","findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"${location}","recommendation":"..."}]}`,
    "```",
    REPORT_END,
    "",
    preset.prompt.verdictGuidance,
    `Write the final summary, findings, and recommendations in ${reportLanguage}; keep the JSON keys and verdict values exactly as shown.`,
    "",
    "The operator's UI is in Indonesian. Reply to direct operator messages in Indonesian unless they use another language.",
  ];

  return lines.join("\n");
}

export function buildConsolidationNudgeMessage(task: PresetTask = "review"): string {
  if (task === "translate") {
    return [
      "All translation units are final and every QA lens is now accounted for (done, blocked, failed, or archived).",
      "Read each QA reviewer's latest timeline and report, check that every translated unit in scope is present in the output folder, then consolidate.",
      "Emit the required final report block between the sentinels and end with the status line. Do not create more translator or QA agents.",
    ].join("\n");
  }
  return [
    "All review lenses are now accounted for (done, blocked, failed, or archived).",
    "Read each reviewer's latest timeline and report, note any lens with a gap or missing report, then consolidate.",
    "Emit the required final report block between the sentinels and end with the status line. Do not create more agents.",
  ].join("\n");
}

export function buildReportRequestMessage(task: PresetTask = "review"): string {
  if (task === "translate") {
    return [
      "The operator asked for the consolidated translation report now.",
      "If any translator or QA reviewer is still running, check its status first and include only verified findings.",
      "Finish with the status line and the required final report block between the sentinels.",
    ].join("\n");
  }
  return [
    "The operator asked for the consolidated report now.",
    "If any reviewer is still running, check its status first and include only verified findings.",
    "Finish with the status line and the required final report block between the sentinels.",
  ].join("\n");
}

export function buildOperatorMessage(text: string, task: PresetTask = "review"): string {
  if (task === "translate") {
    return [
      "Message from the operator:",
      text,
      "",
      "Treat this as direction for the translation session. Continue within the same scope: translators write only inside the output folder, while QA reviewers and you stay read-only. End your turn with the status line.",
    ].join("\n");
  }
  return [
    "Message from the operator:",
    text,
    "",
    "Treat this as direction for the review. Continue with the same read-only scope and end your turn with the status line.",
  ].join("\n");
}

export function buildStopMessage(): string {
  return [
    "The operator stopped this session.",
    "Stop starting new work. Do not create more agents. If a turn is running, end it after the current safe step; do not make any further tool calls. A final report is not required.",
  ].join("\n");
}
