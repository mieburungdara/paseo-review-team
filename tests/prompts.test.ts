import { describe, expect, it } from "vitest";
import { CODE_PRESET, NOVEL_PRESET } from "../shared/presets";
import { buildLeadPrompt } from "../shared/prompts";

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
});
