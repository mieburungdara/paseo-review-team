import { z } from "zod";
import { DEFAULT_LENS_IDS, DEPTHS, LENSES } from "./constants";

export const PRESET_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
export const DEFAULT_PRESET_ID = "code";
export const RESERVED_PRESET_IDS = new Set(["code", "novel"]);
export const MAX_PRESET_LENSES = 8;
export const MAX_CUSTOM_PRESETS = 25;
export const MAX_PRESET_FILE_BYTES = 64 * 1024;

export type PresetSource = "builtin" | "custom";
export type PresetDepthId = "quick" | "standard" | "deep";
export const PRESET_DEPTH_IDS: readonly PresetDepthId[] = ["quick", "standard", "deep"];

export interface PresetLens {
  id: string;
  label: string;
  hint: string;
}

export interface PresetDepth {
  label: string;
  hint: string;
  guidance: string;
}

export type PresetDepths = Record<PresetDepthId, PresetDepth>;

export interface PresetTarget {
  label: string;
  hint: string;
  placeholder: string;
}

export interface PresetRoles {
  lead: string;
  reviewer: string;
  reviewerPlural: string;
}

export interface PresetVerdictLabels {
  approve: string;
  request_changes: string;
  blocked: string;
  pass: string;
  warn: string;
  fail: string;
}

export interface PresetLabels {
  findings: string;
  location: string | null;
  recommendation: string;
  verdicts: PresetVerdictLabels;
}

export interface PresetUi {
  startHint: string;
}

export interface PresetPrompt {
  leadRole: string;
  leadRules: string[];
  reviewerRole: string;
  reviewerRules: string[];
  evidenceRules: string[];
  consolidationFocus: string[];
  verdictGuidance: string;
  locationExample: string;
  reportLanguage: string;
}

export interface PresetClientConfig {
  id: string;
  label: string;
  description: string;
  source: PresetSource;
  target: PresetTarget;
  lenses: PresetLens[];
  defaultLensIds: string[];
  depths: PresetDepths;
  roles: PresetRoles;
  labels: PresetLabels;
  ui: PresetUi;
}

export interface PresetDefinition extends PresetClientConfig {
  prompt: PresetPrompt;
}

export type PresetSummary = PresetClientConfig;

const shortText = z.string().trim().min(1).max(80);
const mediumText = z.string().trim().min(1).max(400);
const ruleText = z.string().trim().min(1).max(400);
const ruleList = z.array(ruleText).min(1).max(12);

const PresetLensSchema = z.object({
  id: z.string().regex(PRESET_ID_PATTERN, "ID lensa harus slug huruf kecil."),
  label: shortText,
  hint: mediumText,
});

const PresetDepthSchema = z.object({
  label: shortText,
  hint: mediumText,
  guidance: z.string().trim().min(1).max(1000),
});

const PresetCoreSchema = z.object({
  id: z
    .string()
    .regex(PRESET_ID_PATTERN, "ID preset harus slug huruf kecil, mis. \"novel-romance\"."),
  label: shortText,
  description: mediumText,
  target: z.object({
    label: shortText,
    hint: mediumText,
    placeholder: z.string().trim().min(1).max(200),
  }),
  lenses: z.array(PresetLensSchema).min(1).max(MAX_PRESET_LENSES),
  defaultLensIds: z.array(z.string().regex(PRESET_ID_PATTERN)).min(1).max(MAX_PRESET_LENSES),
  depths: z.object({
    quick: PresetDepthSchema,
    standard: PresetDepthSchema,
    deep: PresetDepthSchema,
  }),
  roles: z.object({
    lead: shortText,
    reviewer: shortText,
    reviewerPlural: shortText,
  }),
  labels: z.object({
    findings: shortText,
    location: shortText.nullable(),
    recommendation: shortText,
    verdicts: z.object({
      approve: shortText,
      request_changes: shortText,
      blocked: shortText,
      pass: shortText,
      warn: shortText,
      fail: shortText,
    }),
  }),
  ui: z.object({ startHint: mediumText }),
});

export const PresetPromptSchema = z.object({
  leadRole: z.string().trim().min(1).max(600),
  leadRules: ruleList,
  reviewerRole: z.string().trim().min(1).max(600),
  reviewerRules: ruleList,
  evidenceRules: z.array(ruleText).min(1).max(8),
  consolidationFocus: z.array(ruleText).min(1).max(8),
  verdictGuidance: z.string().trim().min(1).max(800),
  locationExample: z.string().trim().min(1).max(120),
  reportLanguage: z.string().trim().min(1).max(40),
});

export const PresetClientConfigSchema = PresetCoreSchema.extend({
  source: z.enum(["builtin", "custom"]),
});

export const CustomPresetSchema = PresetCoreSchema.extend({
  prompt: PresetPromptSchema,
}).superRefine((preset, ctx) => {
  if (RESERVED_PRESET_IDS.has(preset.id)) {
    ctx.addIssue({
      code: "custom",
      path: ["id"],
      message: `ID "${preset.id}" dicadangkan untuk preset bawaan.`,
    });
  }

  const lensIds = new Set<string>();
  preset.lenses.forEach((lens, index) => {
    if (lensIds.has(lens.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["lenses", index, "id"],
        message: `ID lensa "${lens.id}" duplikat.`,
      });
      return;
    }
    lensIds.add(lens.id);
  });

  const defaults = new Set(preset.defaultLensIds);
  if (defaults.size !== preset.defaultLensIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultLensIds"],
      message: "defaultLensIds berisi duplikat.",
    });
  }
  for (const lensId of preset.defaultLensIds) {
    if (!lensIds.has(lensId)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultLensIds"],
        message: `Lensa default "${lensId}" tidak ada di lenses.`,
      });
    }
  }
});

export const CustomPresetFileSchema = z.object({
  version: z.literal(1),
  presets: z.array(z.unknown()).max(MAX_CUSTOM_PRESETS),
});

const CODE_LENSES: PresetLens[] = LENSES.map((lens) => ({
  id: lens.id,
  label: lens.label,
  hint: lens.hint,
}));

function codeDepth(id: PresetDepthId, guidance: string): PresetDepth {
  const depth = DEPTHS.find((entry) => entry.id === id) ?? DEPTHS[1];
  return { label: depth.label, hint: depth.hint, guidance };
}

export const CODE_PRESET: PresetDefinition = {
  id: "code",
  label: "Code Review",
  description:
    "Review perubahan kode dari beberapa lensa teknis, dengan temuan terstruktur dan verdict kelayakan merge.",
  source: "builtin",
  target: {
    label: "Target review",
    hint: "Jelaskan apa yang harus diperiksa. Sebutkan diff, branch, PR, atau area kode yang relevan agar reviewer tidak menebak.",
    placeholder: "mis. diff vs main, src/auth/login, atau PR #42",
  },
  lenses: CODE_LENSES,
  defaultLensIds: [...DEFAULT_LENS_IDS],
  depths: {
    quick: codeDepth(
      "quick",
      "Keep it to one pass over the changed files or the entry points named in the brief. Do not chase distant call sites; note them as unverified if they matter.",
    ),
    standard: codeDepth(
      "standard",
      "Inspect the main path, its immediate dependencies, and the error path. Follow one call site outward when it changes the verdict.",
    ),
    deep: codeDepth(
      "deep",
      "Trace the full flow, call sites, configuration, and boundary scenarios. You may follow up to two chains of evidence, but stop when the remaining uncertainty is documented.",
    ),
  },
  roles: { lead: "Lead", reviewer: "Reviewer", reviewerPlural: "reviewer" },
  labels: {
    findings: "Temuan",
    location: "File",
    recommendation: "Saran",
    verdicts: {
      approve: "APPROVE",
      request_changes: "PERLU PERUBAHAN",
      blocked: "BLOCKED",
      pass: "PASS",
      warn: "WARN",
      fail: "FAIL",
    },
  },
  ui: {
    startHint:
      "Satu agen lead akan membuat satu reviewer per lensa yang dipilih, lalu mengonsolidasikan laporan.",
  },
  prompt: {
    leadRole:
      "You are the lead of a Paseo Review Team session. You coordinate a small group of reviewer agents and produce one consolidated review. You are the hub: reviewers cannot message each other, so relay anything that crosses lenses.",
    leadRules: [
      "This is a read-only review. Never edit, create, delete, rename, or format files, and never run commands that modify the repository or its dependencies.",
      "Create exactly one reviewer for each lens listed above, using Paseo's `create_agent` tool. Do not create extra agents, worktrees, or workspaces.",
      "Do not create a reviewer for a lens that already has a live reviewer. If a reviewer is archived or failed, you may replace it once for the same lens.",
      "Inspect the target yourself before briefing reviewers, so each brief names concrete files or flows. Do not trust a reviewer's summary without checking the evidence it cites.",
      "Start all reviewers promptly; they should work in parallel.",
      "Paseo notifies you when a reviewer finishes. Treat that notification as the signal to read its findings. You may use `get_agent_status` and `get_agent_activity` to check progress.",
      "Reviewers report only to you. When one lens's finding affects another lens, send the relevant context to that reviewer with `send_agent_prompt`. Do not expect reviewers to talk to each other directly.",
      "Never approve a permission request on your own. If a reviewer is blocked by a permission, ask the operator in your status note and continue with the other lenses.",
      "Do not ask the operator for confirmation to start; the session was already approved.",
    ],
    reviewerRole:
      "You are a reviewer on a Paseo Review Team. You work independently and report to the lead.",
    reviewerRules: [
      "Read-only. Never edit, create, delete, rename, or format files, and never run commands that modify the repository or its dependencies. Read, search, and inspect.",
      "Do not create other agents, worktrees, or workspaces.",
      "Inspect the target yourself. Do not trust a summary from the lead or from a previous report; verify the evidence.",
      "Treat the target directory as the only scope. Do not review unrelated projects.",
      "Prefer a few high-signal findings over a long list. Do not report style preferences unless the target has an explicit convention.",
      "If a finding belongs to another lens, mention it once and leave the depth to that reviewer.",
    ],
    evidenceRules: [
      "Report only findings you can support with a concrete file/line, command output, or a clear reproduction path. If you cannot support it, say it is unverified or omit it.",
    ],
    consolidationFocus: [
      "Wait until every lens has a usable report or has explicitly failed. If one reviewer is still running while the others are done, wait for it or note the gap; do not fabricate its findings.",
      "Deduplicate findings across lenses, rank by severity, and resolve contradictions by checking the evidence. Keep the strongest evidence for each finding.",
      "Do not add findings the reviewers did not support. You may add a missing cross-cutting finding only if you verified it yourself, and label it as lead-verified.",
    ],
    verdictGuidance:
      "Use `approve` only when no material issue remains. Use `request_changes` for any high or medium finding that should block merging. Use `blocked` when the review itself could not be completed. Keep the summary short and concrete; the operator will read it first.",
    locationExample: "path:line atau null",
    reportLanguage: "English",
  },
};

export const NOVEL_PRESET: PresetDefinition = {
  id: "novel",
  label: "Review Novel",
  description:
    "Review naskah fiksi dari lensa alur, tokoh, dunia, gaya, dan pacing, dengan catatan revisi yang menjaga suara penulis.",
  source: "builtin",
  target: {
    label: "Naskah / bab",
    hint: "Sebutkan file naskah, bab, atau adegan yang harus dibaca. Sertakan ringkasan kanon, wiki, atau catatan benang bila tersedia agar reviewer tidak menebak.",
    placeholder: "mis. manuscript/bab-03.md, adegan pasar, atau bab 3–5",
  },
  lenses: [
    {
      id: "plot",
      label: "Alur & Benang",
      hint: "Kausalitas, plot hole, benang yang menggantung, dan konsistensi kejadian.",
    },
    {
      id: "character",
      label: "Konsistensi Tokoh",
      hint: "Motivasi, suara, pengetahuan, dan perkembangan tokoh sepanjang naskah.",
    },
    {
      id: "world",
      label: "Dunia & Istilah",
      hint: "Kanon, aturan dunia, istilah, dan konsistensi latar.",
    },
    {
      id: "prose",
      label: "Gaya & Suara",
      hint: "Pilihan kata, ritme kalimat, sudut pandang, dan suara naratif.",
    },
    {
      id: "pacing",
      label: "Pacing & Pembaca",
      hint: "Tempo, ketegangan, informasi yang bocor terlalu awal, dan pengalaman pembaca.",
    },
  ],
  defaultLensIds: ["plot", "character", "world", "prose"],
  depths: {
    quick: {
      label: "Cepat",
      hint: "Satu pembacaan pada bab/adegan yang disebut. Fokus pada kontinuitas dan kesan pembaca terbesar.",
      guidance:
        "Read only the chapters or scenes named in the brief. Do not audit the whole manuscript; note any dependency you could not check as unverified.",
    },
    standard: {
      label: "Standar",
      hint: "Baca bab target dan satu bab sebelum/sesudahnya untuk konteks alur dan tokoh.",
      guidance:
        "Read the target chapters plus the surrounding chapter for context. Follow one plot thread or character arc outward when it changes the assessment.",
    },
    deep: {
      label: "Mendalam",
      hint: "Telusuri arc target, kanon/wiki, ringkasan bab, dan benang plot terkait.",
      guidance:
        "Read the full target arc, canon or summary material if present, and related plot threads. Stop when the remaining uncertainty is documented.",
    },
  },
  roles: { lead: "Ketua", reviewer: "Peninjau", reviewerPlural: "para peninjau" },
  labels: {
    findings: "Temuan",
    location: "Bab/adegan",
    recommendation: "Saran revisi",
    verdicts: {
      approve: "SIAP",
      request_changes: "PERLU REVISI",
      blocked: "TERTAHAN",
      pass: "LULUS",
      warn: "CATATAN",
      fail: "GAGAL",
    },
  },
  ui: {
    startHint:
      "Reviewer membaca naskah dan catatan kanon di workspace. Plugin tidak mengakses database D1; ekspor atau salin naskah ke workspace lebih dulu.",
  },
  prompt: {
    leadRole:
      "You are the lead of a Paseo novel workshop. You coordinate a small group of editorial reviewer agents and produce one consolidated editorial review. You are the hub: reviewers cannot message each other, so relay anything that crosses lenses.",
    leadRules: [
      "This is a read-only editorial review. Never rewrite, edit, create, or delete manuscript files, and never run commands that modify the workspace.",
      "Create exactly one reviewer for each lens listed above, using Paseo's `create_agent` tool. Do not create extra agents, worktrees, or workspaces.",
      "Do not create a reviewer for a lens that already has a live reviewer. If a reviewer is archived or failed, you may replace it once for the same lens.",
      "Read the manuscript or summary and any canon notes yourself before briefing reviewers, so each brief names concrete chapters, scenes, or characters.",
      "Start all reviewers promptly; they should work in parallel.",
      "Paseo notifies you when a reviewer finishes. Treat that notification as the signal to read its findings. You may use `get_agent_status` and `get_agent_activity` to check progress.",
      "Reviewers report only to you. When one lens's finding affects another lens, send the relevant context to that reviewer with `send_agent_prompt`.",
      "Never approve a permission request on your own. If a reviewer is blocked by a permission, ask the operator in your status note and continue with the other lenses.",
      "Do not ask the operator for confirmation to start; the session was already approved.",
      "Distinguish a hard continuity error from an intentional mystery. Do not demand that the draft explain something it is deliberately withholding.",
    ],
    reviewerRole:
      "You are an editorial reviewer on a Paseo novel workshop. You read the manuscript independently and report to the lead.",
    reviewerRules: [
      "Read-only. Quote the manuscript, but never rewrite or edit it. Do not modify any file in the workspace.",
      "Do not create other agents, worktrees, or workspaces.",
      "Read the target manuscript yourself. Do not trust a summary from the lead or a previous report; verify against the text and canon notes when they exist.",
      "Treat the named manuscript or chapters as the only scope. Do not review unrelated projects.",
      "Judge the draft as it is. Do not invent missing plot or assume chapters you did not read.",
      "Focus on reader experience and craft, not personal taste. Do not line-edit every paragraph; prefer the few notes that most improve the draft.",
      "If a finding belongs to another lens, mention it once and leave the depth to that reviewer.",
    ],
    evidenceRules: [
      "Support every finding with a chapter/scene reference and a short quote or close paraphrase. If a claim depends on material you could not read, mark it unverified or omit it.",
      "Separate hard continuity errors from subjective preferences, and say which one a finding is.",
    ],
    consolidationFocus: [
      "Wait until every lens has a usable report or has explicitly failed. If one reviewer is still running while the others are done, wait for it or note the gap; do not fabricate its findings.",
      "Merge overlapping notes across lenses, prioritise by impact on the reader and on continuity, and resolve contradictions by checking the manuscript.",
      "Preserve the author's voice. Do not rewrite prose in the report; describe the effect and the smallest useful revision.",
      "Do not add findings the reviewers did not support. You may add a missing cross-cutting note only if you verified it yourself, and label it as lead-verified.",
    ],
    verdictGuidance:
      "Use `approve` only when the manuscript is coherent and no high-impact continuity or craft issue remains. Use `request_changes` when any high or medium issue needs revision before publication. Use `blocked` when the review itself could not be completed. Keep the summary short, concrete, and useful to the author.",
    locationExample: "Bab 3, adegan pasar atau null",
    reportLanguage: "Indonesian",
  },
};

export const BUILTIN_PRESETS: readonly PresetDefinition[] = [CODE_PRESET, NOVEL_PRESET];

export function presetSummaries(presets: readonly PresetDefinition[]): PresetSummary[] {
  return presets.map((preset) => presetSummary(preset));
}

export function presetSummary(preset: PresetDefinition): PresetSummary {
  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    source: preset.source,
    target: preset.target,
    lenses: preset.lenses,
    defaultLensIds: preset.defaultLensIds,
    depths: preset.depths,
    roles: preset.roles,
    labels: preset.labels,
    ui: preset.ui,
  };
}

export function builtinPreset(id: string | null | undefined): PresetDefinition {
  return BUILTIN_PRESETS.find((preset) => preset.id === id) ?? CODE_PRESET;
}

export function resolvePreset(
  presets: readonly PresetDefinition[],
  id: string | null | undefined,
): PresetDefinition {
  return presets.find((preset) => preset.id === id) ?? presets[0] ?? CODE_PRESET;
}

export function lensLabelFor(
  preset: Pick<PresetClientConfig, "lenses">,
  lensId: string,
): string {
  return preset.lenses.find((lens) => lens.id === lensId)?.label ?? lensId;
}

export function lensHintFor(
  preset: Pick<PresetClientConfig, "lenses">,
  lensId: string,
): string {
  return (
    preset.lenses.find((lens) => lens.id === lensId)?.hint ??
    "Fokus pada risiko yang didukung bukti."
  );
}

export function depthFor(
  preset: Pick<PresetClientConfig, "depths">,
  depth: string,
): PresetDepth {
  if (depth === "quick" || depth === "standard" || depth === "deep") {
    return preset.depths[depth];
  }
  return preset.depths.standard;
}

export function lensIdFromTitle(
  title: string | null,
  preset: Pick<PresetClientConfig, "lenses"> | null,
): string {
  if (!title) return "unknown";
  const withoutPrefix = title.replace(/^Reviewer:\s*/i, "").trim();
  const wanted = withoutPrefix.toLowerCase();

  const matches = (entry: { id: string; label: string }) =>
    entry.id.toLowerCase() === wanted || entry.label.toLowerCase() === wanted;

  const presetMatch = preset?.lenses.find(matches);
  if (presetMatch) return presetMatch.id;

  const legacyMatch = LENSES.find(matches);
  if (legacyMatch) return legacyMatch.id;

  const slug = wanted
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "unknown";
}

export function reviewerLensId(input: {
  sessionLenses: readonly string[];
  preset: Pick<PresetClientConfig, "lenses"> | null;
  label: string | null | undefined;
  title: string | null;
}): string {
  const label = input.label?.trim().toLowerCase();
  if (label) {
    const presetMatch = input.preset?.lenses.find(
      (lens) => lens.id.toLowerCase() === label || lens.label.toLowerCase() === label,
    );
    if (presetMatch && input.sessionLenses.includes(presetMatch.id)) return presetMatch.id;
    if (input.sessionLenses.includes(label)) return label;
  }
  return lensIdFromTitle(input.title, input.preset);
}
