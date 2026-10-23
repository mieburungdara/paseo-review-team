import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  CODE_PRESET,
  CustomPresetFileSchema,
  CustomPresetSchema,
  NOVEL_PRESET,
  TRANSLATE_PRESET,
  lensIdFromTitle,
  presetSummary,
  resolvePreset,
  reviewerLensId,
  translationConfigFor,
  translatorLabelFor,
  translatorPluralFor,
} from "../shared/presets";

function customOf(id = "novel-alt") {
  return {
    id,
    label: NOVEL_PRESET.label,
    description: NOVEL_PRESET.description,
    target: NOVEL_PRESET.target,
    lenses: NOVEL_PRESET.lenses,
    defaultLensIds: NOVEL_PRESET.defaultLensIds,
    depths: NOVEL_PRESET.depths,
    roles: NOVEL_PRESET.roles,
    labels: NOVEL_PRESET.labels,
    ui: NOVEL_PRESET.ui,
    prompt: NOVEL_PRESET.prompt,
  };
}

function customTranslateOf(id = "translate-alt") {
  return {
    id,
    label: TRANSLATE_PRESET.label,
    description: TRANSLATE_PRESET.description,
    task: "translate" as const,
    translation: TRANSLATE_PRESET.translation,
    target: TRANSLATE_PRESET.target,
    lenses: TRANSLATE_PRESET.lenses,
    defaultLensIds: TRANSLATE_PRESET.defaultLensIds,
    depths: TRANSLATE_PRESET.depths,
    roles: TRANSLATE_PRESET.roles,
    labels: TRANSLATE_PRESET.labels,
    ui: TRANSLATE_PRESET.ui,
    prompt: TRANSLATE_PRESET.prompt,
  };
}

describe("built-in presets", () => {
  it("exposes code, novel, and translate with valid default lenses", () => {
    expect(BUILTIN_PRESETS.map((preset) => preset.id)).toEqual(["code", "novel", "translate"]);

    for (const preset of BUILTIN_PRESETS) {
      expect(preset.lenses.length).toBeGreaterThan(0);
      expect(preset.defaultLensIds.length).toBeGreaterThan(0);
      for (const lensId of preset.defaultLensIds) {
        expect(preset.lenses.some((lens) => lens.id === lensId)).toBe(true);
      }
    }
  });

  it("describes the translation preset as English to Indonesian", () => {
    expect(TRANSLATE_PRESET.task).toBe("translate");
    expect(TRANSLATE_PRESET.translation?.sourceLanguage).toBe("English");
    expect(TRANSLATE_PRESET.translation?.targetLanguage).toBe("Indonesian");
    expect(TRANSLATE_PRESET.translation?.defaultOutputDir).toBe("translated/id");
    expect(TRANSLATE_PRESET.translation?.outputExtension).toBe(".txt");
    expect(translationConfigFor(TRANSLATE_PRESET).unitLabel).toBe("Bab");
    expect(translatorLabelFor(TRANSLATE_PRESET)).toBe("Penerjemah");
    expect(translatorPluralFor(TRANSLATE_PRESET)).toBe("para penerjemah");
    expect(CODE_PRESET.task).toBe("review");
    expect(NOVEL_PRESET.translation).toBeNull();
  });

  it("keeps the code preset compatible with the old lens ids", () => {
    expect(CODE_PRESET.lenses.map((lens) => lens.id)).toEqual([
      "correctness",
      "security",
      "tests",
      "architecture",
      "performance",
    ]);
    expect(CODE_PRESET.defaultLensIds).toEqual([
      "correctness",
      "security",
      "tests",
      "architecture",
    ]);
  });

  it("summaries never include prompt fragments", () => {
    const summary = presetSummary(NOVEL_PRESET);
    expect(summary.id).toBe("novel");
    expect(summary.task).toBe("review");
    expect("prompt" in summary).toBe(false);

    const translate = presetSummary(TRANSLATE_PRESET);
    expect(translate.task).toBe("translate");
    expect(translate.translation?.defaultOutputDir).toBe("translated/id");
    expect("prompt" in translate).toBe(false);
  });

  it("falls back to the first preset for an unknown id", () => {
    expect(resolvePreset(BUILTIN_PRESETS, "novel").id).toBe("novel");
    expect(resolvePreset(BUILTIN_PRESETS, "missing").id).toBe("code");
    expect(resolvePreset(BUILTIN_PRESETS, null).id).toBe("code");
  });
});

describe("custom preset validation", () => {
  it("accepts a full custom preset", () => {
    const parsed = CustomPresetSchema.safeParse(customOf());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe("novel-alt");
      expect(parsed.data.task).toBe("review");
      expect(parsed.data.translation).toBeNull();
      expect(parsed.data.lenses.map((lens) => lens.id)).toContain("plot");
    }
  });

  it("accepts a full custom translation preset", () => {
    const parsed = CustomPresetSchema.safeParse(customTranslateOf());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.task).toBe("translate");
      expect(parsed.data.translation?.defaultOutputDir).toBe("translated/id");
      expect(parsed.data.prompt.translatorRole).toBeTruthy();
    }
  });

  it("rejects a translation preset without a translation config", () => {
    const broken = { ...customTranslateOf(), translation: null };
    expect(CustomPresetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unsafe translation output directory", () => {
    const base = customTranslateOf();
    const broken = {
      ...base,
      translation: { ...base.translation!, defaultOutputDir: "../outside" },
    };
    expect(CustomPresetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unsafe translation output extension", () => {
    const base = customTranslateOf();
    const broken = {
      ...base,
      translation: { ...base.translation!, outputExtension: "txt" },
    };
    expect(CustomPresetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a translation preset without translator roles and prompts", () => {
    const base = customTranslateOf();
    const broken = {
      ...base,
      roles: { lead: "Ketua", reviewer: "QA", reviewerPlural: "para QA" },
      prompt: { ...base.prompt, translatorRole: undefined, translatorRules: undefined, translationFocus: undefined },
    };
    expect(CustomPresetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a review preset that carries a translation block", () => {
    const broken = { ...customOf(), translation: TRANSLATE_PRESET.translation };
    expect(CustomPresetSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects reserved ids", () => {
    expect(CustomPresetSchema.safeParse(customOf("code")).success).toBe(false);
    expect(CustomPresetSchema.safeParse(customOf("novel")).success).toBe(false);
    expect(CustomPresetSchema.safeParse(customTranslateOf("translate")).success).toBe(false);
  });

  it("rejects invalid ids", () => {
    expect(CustomPresetSchema.safeParse(customOf("Game Design")).success).toBe(false);
    expect(CustomPresetSchema.safeParse(customOf("-leading")).success).toBe(false);
  });

  it("rejects duplicate lens ids", () => {
    const base = customOf();
    const duplicate = {
      ...base,
      lenses: [...base.lenses, base.lenses[0]],
    };
    expect(CustomPresetSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects default lenses outside the lens list", () => {
    expect(
      CustomPresetSchema.safeParse({ ...customOf(), defaultLensIds: ["missing"] }).success,
    ).toBe(false);
  });

  it("rejects an empty rule list", () => {
    const base = customOf();
    const invalid = {
      ...base,
      prompt: { ...base.prompt, leadRules: [] },
    };
    expect(CustomPresetSchema.safeParse(invalid).success).toBe(false);
  });

  it("keeps the published example valid", () => {
    const file = JSON.parse(
      readFileSync(new URL("../examples/presets.example.json", import.meta.url), "utf8"),
    );
    const parsed = CustomPresetFileSchema.safeParse(file);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    for (const entry of parsed.data.presets) {
      expect(CustomPresetSchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("reviewer lens resolution", () => {
  it("parses code titles", () => {
    expect(lensIdFromTitle("Reviewer: Correctness", CODE_PRESET)).toBe("correctness");
    expect(lensIdFromTitle("Reviewer: Performance", CODE_PRESET)).toBe("performance");
  });

  it("parses novel titles before legacy titles", () => {
    expect(lensIdFromTitle("Reviewer: Alur & Benang", NOVEL_PRESET)).toBe("plot");
    expect(lensIdFromTitle("Reviewer: Gaya & Suara", NOVEL_PRESET)).toBe("prose");
    expect(lensIdFromTitle("Reviewer: Security", NOVEL_PRESET)).toBe("security");
  });

  it("slugs unknown titles and handles missing titles", () => {
    expect(lensIdFromTitle("Reviewer: Custom Lens", NOVEL_PRESET)).toBe("custom-lens");
    expect(lensIdFromTitle(null, NOVEL_PRESET)).toBe("unknown");
  });

  it("prefers the agent label over the title", () => {
    expect(
      reviewerLensId({
        sessionLenses: ["plot", "character"],
        preset: NOVEL_PRESET,
        label: "plot",
        title: "Reviewer: Konsistensi Tokoh",
      }),
    ).toBe("plot");
  });

  it("ignores labels for lenses outside the session", () => {
    expect(
      reviewerLensId({
        sessionLenses: ["plot"],
        preset: NOVEL_PRESET,
        label: "character",
        title: "Reviewer: Alur & Benang",
      }),
    ).toBe("plot");
  });

  it("falls back to the title when the label is unknown", () => {
    expect(
      reviewerLensId({
        sessionLenses: ["plot"],
        preset: NOVEL_PRESET,
        label: "unknown",
        title: "Reviewer: Alur & Benang",
      }),
    ).toBe("plot");
  });
});
