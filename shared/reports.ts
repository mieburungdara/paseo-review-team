import {
  FINDINGS_FENCE,
  FINAL_FENCE,
  MAX_FINDINGS,
  MAX_REPORT_TEXT,
  MAX_TRANSLATION_NOTES,
  REPORT_BEGIN,
  REPORT_END,
  TRANSLATION_FENCE,
} from "./constants";

export type Severity = "high" | "medium" | "low";
export type ReviewerVerdict = "pass" | "warn" | "fail";
export type FinalVerdict = "approve" | "request_changes" | "blocked";
export type LeadState = "working" | "needs_input" | "blocked" | "complete" | "failed";
export type ReviewerState = "working" | "needs_input" | "done" | "blocked" | "failed";
export type ReviewerReportMarker = "done" | "blocked" | "failed";

export interface ParsedFinding {
  severity: Severity;
  title: string;
  detail: string;
  file: string | null;
  recommendation: string | null;
}

export interface ParsedReviewerReport {
  marker: ReviewerReportMarker | null;
  verdict: ReviewerVerdict | null;
  summary: string | null;
  findings: ParsedFinding[];
  lens: string | null;
  parsed: boolean;
  unparsedJson: boolean;
  raw: string;
}

export interface ParsedLeadStatus {
  state: LeadState;
  note: string;
}

export interface ParsedFinalReport {
  reportText: string;
  verdict: FinalVerdict | null;
  summary: string | null;
  findings: ParsedFinding[];
  parsed: boolean;
  unparsedJson: boolean;
}

export type TranslationReportMarker = "done" | "blocked" | "failed";

export interface ParsedTranslationReport {
  marker: TranslationReportMarker | null;
  unit: string | null;
  source: string | null;
  output: string | null;
  summary: string | null;
  notes: string[];
  parsed: boolean;
  unparsedJson: boolean;
  raw: string;
}

interface TimelineEntryLike {
  item: {
    type: string;
    text?: string;
  };
}

function lastRegexMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  let last: RegExpExecArray | null = null;
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = global.exec(text)) !== null) {
    last = match;
    if (match[0].length === 0) global.lastIndex += 1;
  }
  return last;
}

function extractFencedBlock(text: string, language: string): string | null {
  const pattern = new RegExp("```" + language + "\\s*\\r?\\n([\\s\\S]*?)```", "gi");
  const matches = Array.from(text.matchAll(pattern));
  const last = matches[matches.length - 1];
  return last ? last[1].trim() : null;
}

function extractJsonObject(text: string, preferredFence: string): string | null {
  const fenced = extractFencedBlock(text, preferredFence);
  if (fenced) return fenced;

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  const candidate = text.slice(firstBrace, lastBrace + 1);
  if (!candidate.includes('"findings"') && !candidate.includes('"summary"')) return null;
  return candidate;
}

function parseJsonObject(source: string): { value: unknown; error: boolean } {
  try {
    return { value: JSON.parse(source), error: false };
  } catch {
    const withoutTrailingCommas = source.replace(/,\s*([}\]])/g, "$1");
    try {
      return { value: JSON.parse(withoutTrailingCommas), error: false };
    } catch {
      return { value: null, error: true };
    }
  }
}

function asString(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}

function asSeverity(value: unknown): Severity {
  if (typeof value !== "string") return "medium";
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "critical" || normalized === "blocker") return "high";
  if (normalized === "low" || normalized === "minor" || normalized === "nit") return "low";
  return "medium";
}

function asFile(value: unknown): string | null {
  if (typeof value === "string") return asString(value, 500);
  if (Array.isArray(value)) {
    const files = value
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 3)
      .join(", ");
    return files === "" ? null : files;
  }
  return null;
}

function normalizeFinding(value: unknown): ParsedFinding | null {
  if (typeof value === "string") {
    const title = asString(value, 300);
    if (!title) return null;
    return {
      severity: "medium",
      title,
      detail: title,
      file: null,
      recommendation: null,
    };
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const title =
    asString(record.title, 300) ??
    asString(record.issue, 300) ??
    asString(record.summary, 300) ??
    asString(record.message, 300);
  if (!title) return null;
  const detail = asString(record.detail, 6000) ?? asString(record.description, 6000) ?? title;
  return {
    severity: asSeverity(record.severity),
    title,
    detail,
    file: asFile(record.file ?? record.files ?? record.location),
    recommendation:
      asString(record.recommendation, 2000) ??
      asString(record.fix, 2000) ??
      asString(record.suggestion, 2000),
  };
}

function normalizeFindings(value: unknown): ParsedFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeFinding)
    .filter((finding): finding is ParsedFinding => finding !== null)
    .slice(0, MAX_FINDINGS);
}

function asReviewerVerdict(value: unknown): ReviewerVerdict | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "pass" || normalized === "ok" || normalized === "clean") return "pass";
  if (normalized === "warn" || normalized === "warning" || normalized === "concerns") return "warn";
  if (normalized === "fail" || normalized === "block" || normalized === "blocked") return "fail";
  return null;
}

export function parseReviewerReport(text: string): ParsedReviewerReport {
  const raw = text.slice(0, MAX_REPORT_TEXT);
  const markerMatch = lastRegexMatch(raw, /REVIEW_REPORT:\s*(DONE|BLOCKED|FAILED)/i);
  const marker = markerMatch
    ? (markerMatch[1].toLowerCase() as ReviewerReportMarker)
    : null;

  const jsonSource = extractJsonObject(raw, FINDINGS_FENCE);
  if (jsonSource) {
    const { value, error } = parseJsonObject(jsonSource);
    if (!error && typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      return {
        marker,
        verdict: asReviewerVerdict(record.verdict),
        summary: asString(record.summary, 4000) ?? asString(record.overview, 4000),
        findings: normalizeFindings(record.findings),
        lens: asString(record.lens, 100),
        parsed: true,
        unparsedJson: false,
        raw,
      };
    }
    return {
      marker,
      verdict: null,
      summary: null,
      findings: [],
      lens: null,
      parsed: false,
      unparsedJson: true,
      raw,
    };
  }

  return {
    marker,
    verdict: null,
    summary: null,
    findings: [],
    lens: null,
    parsed: false,
    unparsedJson: false,
    raw,
  };
}

function asNotes(value: unknown): string[] {
  if (typeof value === "string") {
    const note = asString(value, 1000);
    return note ? [note] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? asString(entry, 1000) : null))
    .filter((entry): entry is string => entry !== null)
    .slice(0, MAX_TRANSLATION_NOTES);
}

export function parseTranslationReport(text: string): ParsedTranslationReport {
  const raw = text.slice(0, MAX_REPORT_TEXT);
  const markerMatch = lastRegexMatch(raw, /TRANSLATION_REPORT:\s*(DONE|BLOCKED|FAILED)/i);
  const marker = markerMatch
    ? (markerMatch[1].toLowerCase() as TranslationReportMarker)
    : null;

  const jsonSource = extractFencedBlock(raw, TRANSLATION_FENCE);
  if (!jsonSource) {
    return {
      marker,
      unit: null,
      source: null,
      output: null,
      summary: null,
      notes: [],
      parsed: false,
      unparsedJson: false,
      raw,
    };
  }

  const { value, error } = parseJsonObject(jsonSource);
  if (error || typeof value !== "object" || value === null) {
    return {
      marker,
      unit: null,
      source: null,
      output: null,
      summary: null,
      notes: [],
      parsed: false,
      unparsedJson: true,
      raw,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    marker,
    unit: asString(record.unit, 120),
    source: asString(record.source, 500),
    output: asString(record.output, 500),
    summary: asString(record.summary, 4000),
    notes: asNotes(record.notes),
    parsed: true,
    unparsedJson: false,
    raw,
  };
}

export function parseLeadStatus(text: string): ParsedLeadStatus | null {
  const match = lastRegexMatch(
    text,
    /REVIEW_STATUS:\s*(WORKING|NEEDS_INPUT|BLOCKED|COMPLETE|FAILED)\s*[—–:-]?\s*([^\n]*)/i,
  );
  if (!match) return null;
  const state = match[1].toLowerCase() as LeadState;
  const note = (match[2] ?? "").trim().slice(0, 300);
  return { state, note };
}

/** Reviewers and translators share the same status-line grammar. */
export function parseReviewerStatus(
  text: string,
): { state: ReviewerState; note: string } | null {
  const match = lastRegexMatch(
    text,
    /REVIEW_STATUS:\s*(WORKING|NEEDS_INPUT|DONE|COMPLETE|BLOCKED|FAILED)\s*[—–:-]?\s*([^\n]*)/i,
  );
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const state = (raw === "complete" ? "done" : raw) as ReviewerState;
  return { state, note: (match[2] ?? "").trim().slice(0, 300) };
}

export function parseFinalReport(text: string): ParsedFinalReport | null {
  const beginIndex = text.lastIndexOf(REPORT_BEGIN);
  if (beginIndex === -1) return null;

  const contentStart = beginIndex + REPORT_BEGIN.length;
  const endIndex = text.indexOf(REPORT_END, contentStart);
  const rawBlock = (endIndex === -1 ? text.slice(contentStart) : text.slice(contentStart, endIndex)).trim();
  if (rawBlock === "") return null;
  const reportText = rawBlock.slice(0, MAX_REPORT_TEXT);

  const verdictMatch = lastRegexMatch(reportText, /REVIEW_VERDICT:\s*(APPROVE|REQUEST_CHANGES|BLOCKED)/i);
  const verdict = verdictMatch
    ? (verdictMatch[1].toLowerCase() as FinalVerdict)
    : null;

  const jsonSource = extractJsonObject(reportText, FINAL_FENCE);
  if (jsonSource) {
    const { value, error } = parseJsonObject(jsonSource);
    if (!error && typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      return {
        reportText,
        verdict,
        summary: asString(record.summary, 6000) ?? asString(record.overview, 6000),
        findings: normalizeFindings(record.findings),
        parsed: true,
        unparsedJson: false,
      };
    }
    return {
      reportText,
      verdict,
      summary: reportText.length === 0 ? null : reportText,
      findings: [],
      parsed: false,
      unparsedJson: true,
    };
  }

  return {
    reportText,
    verdict,
    summary: reportText,
    findings: [],
    parsed: false,
    unparsedJson: false,
  };
}

export function recentAssistantText(entries: readonly TimelineEntryLike[], maxMessages = 4): string {
  const messages: string[] = [];
  for (let index = entries.length - 1; index >= 0 && messages.length < maxMessages; index -= 1) {
    const entry = entries[index];
    if (entry.item.type !== "assistant_message") continue;
    const text = entry.item.text?.trim();
    if (text) messages.unshift(text);
  }
  return messages.join("\n\n").slice(-60_000);
}

