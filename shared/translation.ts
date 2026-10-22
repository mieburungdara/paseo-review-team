import { MAX_UNIT_LENGTH } from "./constants";

export type OutputStatus = "unverified" | "present" | "missing" | "outside" | "unsafe";

const OUTPUT_STATUS_LABELS: Record<OutputStatus, string> = {
  unverified: "Belum diverifikasi",
  present: "Berkas ada",
  missing: "Berkas tidak ditemukan",
  outside: "Di luar folder hasil",
  unsafe: "Path tidak aman",
};

export function normalizeRelativePath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+$/, "");
}

export function isSafeRelativePath(input: string): boolean {
  if (typeof input !== "string" || input.includes("\0")) return false;
  const normalized = normalizeRelativePath(input);
  if (normalized === "") return false;
  if (/^[a-z]:/i.test(normalized)) return false;
  if (normalized.startsWith("/")) return false;

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return true;
}

export function translationUnitFromTitle(title: string | null): string | null {
  if (!title) return null;
  const match = /^Translator:\s*(.+)$/i.exec(title.trim());
  if (!match) return null;
  const unit = match[1].trim();
  return unit === "" ? null : unit.slice(0, MAX_UNIT_LENGTH);
}

export function outputStatusLabel(status: string): string {
  return OUTPUT_STATUS_LABELS[status as OutputStatus] ?? OUTPUT_STATUS_LABELS.unverified;
}

export interface TranslationProgress {
  total: number;
  done: number;
  running: number;
  failed: number;
  blocked: number;
}

export function translationProgress(
  translators: readonly { status: string }[],
): TranslationProgress {
  const progress: TranslationProgress = {
    total: translators.length,
    done: 0,
    running: 0,
    failed: 0,
    blocked: 0,
  };
  for (const translator of translators) {
    if (translator.status === "done") progress.done += 1;
    else if (
      translator.status === "running" ||
      translator.status === "starting" ||
      translator.status === "needs_input"
    ) {
      progress.running += 1;
    } else if (translator.status === "failed") progress.failed += 1;
    else if (translator.status === "blocked") progress.blocked += 1;
  }
  return progress;
}
