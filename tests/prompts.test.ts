import { describe, expect, it } from "vitest";
import { CODE_PRESET, NOVEL_PRESET, TRANSLATE_PRESET } from "../shared/presets";
import {
  buildConsolidationNudgeMessage,
  buildLeadPrompt,
  buildOperatorMessage,
  buildReportRequestMessage,
  buildStopMessage,
} from "../shared/prompts";

const BASE = {
  sessionId: "session-1",
  target: "src/auth/login",
  workspaceId: "workspace-1",
  depth: "standard",
  provider: "codex/gpt-5",
};

describe("buildLeadPrompt", () => {
  it("keeps the code preset behaviour and report protocol", () => {
    const prompt = buildLeadPrompt({
      ...BASE,
      preset: CODE_PRESET,
      lenses: ["correctness", "security"],
    });

    expect(prompt).toContain("You are the lead of a Paseo Review Team session.");
    expect(prompt).toContain("Correctness");
    expect(prompt).toContain("Security");
    expect(prompt).toContain("review-team.lens");
    expect(prompt).toContain('"review-team.preset": "code"');
    expect(prompt).toContain("path:line atau null");
    expect(prompt).toContain("Write the summary, finding titles");
    expect(prompt).toContain("in English");
    expect(prompt).toContain("=== REVIEW TEAM REPORT BEGIN ===");
    expect(prompt).toContain("=== REVIEW TEAM REPORT END ===");
    expect(prompt).toContain("review-final");
    expect(prompt).toContain("review-findings");
    expect(prompt).toContain("Inspect the main path");
  });

  it("uses novel lenses, guidance, and report language", () => {
    const prompt = buildLeadPrompt({
      ...BASE,
      target: "manuscript/bab-03.md",
      preset: NOVEL_PRESET,
      lenses: ["plot", "character"],
    });

    expect(prompt).toContain("novel workshop");
    expect(prompt).toContain("Alur & Benang");
    expect(prompt).toContain("Konsistensi Tokoh");
    expect(prompt).toContain('"review-team.preset": "novel"');
    expect(prompt).toContain("Bab 3, adegan pasar atau null");
    expect(prompt).toContain("in Indonesian");
    expect(prompt).toContain("surrounding chapter for context");
    expect(prompt).toContain("Preserve the author's voice");
    expect(prompt).toContain("review-final");
  });

  it("lists only the selected lenses", () => {
    const prompt = buildLeadPrompt({
      ...BASE,
      preset: NOVEL_PRESET,
      lenses: ["pacing"],
    });

    expect(prompt).toContain("Pacing & Pembaca");
    expect(prompt).not.toContain("Alur & Benang (`plot`)");
    expect(prompt).not.toContain("Konsistensi Tokoh (`character`)");
  });

  it("passes mode and thinking level to the lead and every child agent", () => {
    const reviewPrompt = buildLeadPrompt({
      ...BASE,
      preset: CODE_PRESET,
      lenses: ["correctness"],
      modeId: "full-access",
      modeLabel: "Full access",
      thinkingOptionId: "high",
      thinkingLabel: "High",
    });

    expect(reviewPrompt).toContain(
      "- Mode for you and every child agent: Full access (`full-access`)",
    );
    expect(reviewPrompt).toContain(
      "- Thinking level for you and every child agent: High (`high`)",
    );
    expect(reviewPrompt).toContain(
      '`settings`: `{"modeId":"full-access","thinkingOptionId":"high"}`',
    );
    expect(reviewPrompt).toContain("do not change them per child");

    const translationPrompt = buildLeadPrompt({
      ...BASE,
      target: "manuscript/en/ (bab 1–3)",
      preset: TRANSLATE_PRESET,
      lenses: ["fidelity"],
      outputDir: "translated/id",
      modeId: "full-access",
      thinkingOptionId: "high",
    });
    expect(translationPrompt.match(/`settings`:/g)).toHaveLength(2);

    const withoutSettings = buildLeadPrompt({
      ...BASE,
      preset: CODE_PRESET,
      lenses: ["correctness"],
    });
    expect(withoutSettings).not.toContain("`settings`");
  });

  it("builds a two-phase translation prompt with the translation protocol", () => {
    const prompt = buildLeadPrompt({
      ...BASE,
      target: "manuscript/en/ (bab 1–20)",
      preset: TRANSLATE_PRESET,
      lenses: ["fidelity", "naturalness"],
      outputDir: "translated/id",
      outputDirAbsolute: "C:/workspace/translated/id",
    });

    expect(prompt).toContain("novel translation team");
    expect(prompt).toContain("English → Indonesian");
    expect(prompt).toContain("Source range: manuscript/en/ (bab 1–20)");
    expect(prompt).toContain("Output folder (workspace-relative): `translated/id`");
    expect(prompt).toContain("Output folder on disk: `C:/workspace/translated/id`");
    expect(prompt).toContain("Output file format: `.txt`");
    expect(prompt).toContain('"output":"translated/id/bab-01.txt"');
    expect(prompt).toContain("ending in `.txt`");
    expect(prompt).toContain("Phase 1 — create translators");
    expect(prompt).toContain("Phase 2 — create QA reviewers");
    expect(prompt).toContain("review-team.role");
    expect(prompt).toContain("review-team.unit");
    expect(prompt).toContain("Translator: <unit>");
    expect(prompt).toContain("TRANSLATION_REPORT: DONE|BLOCKED|FAILED");
    expect(prompt).toContain("translation-output");
    expect(prompt).toContain("Kesetiaan Makna");
    expect(prompt).toContain("Kealamian Bahasa");
    expect(prompt).not.toContain("Pacing & Pembaca");
    expect(prompt).toContain("=== REVIEW TEAM REPORT BEGIN ===");
    expect(prompt).toContain("=== REVIEW TEAM REPORT END ===");
    expect(prompt).toContain("review-final");
    expect(prompt).toContain("review-findings");
    expect(prompt).toContain("at most 20 bab");
  });

  it("lets a session override the translation output format", () => {
    const markdown = buildLeadPrompt({
      ...BASE,
      target: "manuscript/en (bab 1)",
      preset: TRANSLATE_PRESET,
      lenses: ["fidelity"],
      outputDir: "translated/id",
      outputExtension: ".md",
    });
    expect(markdown).toContain("Output file format: `.md`");
    expect(markdown).toContain('"output":"translated/id/bab-01.md"');
    expect(markdown).not.toContain("bab-01.txt");

    const invalid = buildLeadPrompt({
      ...BASE,
      target: "manuscript/en (bab 1)",
      preset: TRANSLATE_PRESET,
      lenses: ["fidelity"],
      outputDir: "translated/id",
      outputExtension: "exe",
    });
    expect(invalid).toContain("Output file format: `.txt`");
  });

  it("makes follow-up messages task-aware", () => {
    expect(buildConsolidationNudgeMessage("translate")).toContain("translation units");
    expect(buildReportRequestMessage("translate")).toContain("translation report");
    expect(buildOperatorMessage("fokus bab 3", "translate")).toContain("output folder");
    expect(buildOperatorMessage("fokus bab 3")).toContain("read-only scope");
    expect(buildStopMessage()).toContain("stopped this session");
    expect(buildStopMessage()).not.toContain("review session");
  });
});
