export const PLUGIN_ID = "review-team";

export const LABEL_SESSION = "review-team.session";
export const LABEL_ROLE = "review-team.role";
export const LABEL_LENS = "review-team.lens";
export const LABEL_PRESET = "review-team.preset";

export const ROLE_LEAD = "lead";
export const ROLE_REVIEWER = "reviewer";

export const REPORT_BEGIN = "=== REVIEW TEAM REPORT BEGIN ===";
export const REPORT_END = "=== REVIEW TEAM REPORT END ===";
export const FINAL_FENCE = "review-final";
export const FINDINGS_FENCE = "review-findings";

export const MAX_EVENTS = 200;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_REPORT_TEXT = 12_000;
export const MAX_FINDINGS = 50;

export const ENRICH_DELAY_MS = 300;
export const RECONCILE_INTERVAL_MS = 15_000;
export const PANEL_REFRESH_MS = 4_000;

export const LENSES = [
  {
    id: "correctness",
    label: "Correctness",
    hint: "Logika, edge case, error handling, dan bug perilaku.",
  },
  {
    id: "security",
    label: "Security",
    hint: "Autentikasi, otorisasi, injeksi, secret, dan batas kepercayaan.",
  },
  {
    id: "tests",
    label: "Tests",
    hint: "Cakupan tes, regresi yang tidak diuji, dan tes yang menyesatkan.",
  },
  {
    id: "architecture",
    label: "Architecture",
    hint: "Struktur, coupling, konsistensi pola, dan batas modul.",
  },
  {
    id: "performance",
    label: "Performance",
    hint: "Query panas, alokasi boros, blocking, dan beban I/O.",
  },
] as const;

export type LensId = (typeof LENSES)[number]["id"];

export const DEFAULT_LENS_IDS: LensId[] = ["correctness", "security", "tests", "architecture"];

export const DEPTHS = [
  {
    id: "quick",
    label: "Quick",
    hint: "Satu lintasan membaca diff/perubahan utama. Cepat, fokus pada risiko besar.",
  },
  {
    id: "standard",
    label: "Standard",
    hint: "Telusuri jalur utama, konteks sekitarnya, dan jalur error.",
  },
  {
    id: "deep",
    label: "Deep",
    hint: "Telusuri alur menyeluruh, dependensi, dan skenario batas. Paling lambat.",
  },
] as const;

export type DepthId = (typeof DEPTHS)[number]["id"];

/** Human-readable lens names for labels and events. */
export function lensLabel(lens: string): string {
  return LENSES.find((entry) => entry.id === lens)?.label ?? lens;
}

export function lensHint(lens: string): string {
  return LENSES.find((entry) => entry.id === lens)?.hint ?? "Fokus pada risiko yang didukung bukti.";
}

export function depthHint(depth: string): string {
  return DEPTHS.find((entry) => entry.id === depth)?.hint ?? DEPTHS[1].hint;
}
