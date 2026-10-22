import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOVEL_PRESET, TRANSLATE_PRESET } from "../shared/presets";
import {
  PRESET_FILE,
  loadPresetCatalog,
  resetPresetCacheForTests,
} from "../server/presets";

let directory: string;
let previousDataDir: string | undefined;

function customPreset(id = "novel-romance") {
  return {
    id,
    label: "Novel Romance",
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

async function writePresetFile(value: unknown): Promise<void> {
  await writeFile(join(directory, PRESET_FILE), JSON.stringify(value), "utf8");
}

function customTranslationPreset(id = "translate-alt") {
  return {
    id,
    label: TRANSLATE_PRESET.label,
    description: TRANSLATE_PRESET.description,
    task: TRANSLATE_PRESET.task,
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

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "review-team-presets-"));
  previousDataDir = process.env.REVIEW_TEAM_DATA_DIR;
  process.env.REVIEW_TEAM_DATA_DIR = directory;
  resetPresetCacheForTests();
});

afterEach(async () => {
  resetPresetCacheForTests();
  if (previousDataDir === undefined) delete process.env.REVIEW_TEAM_DATA_DIR;
  else process.env.REVIEW_TEAM_DATA_DIR = previousDataDir;
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("loadPresetCatalog", () => {
  it("uses built-ins when presets.json is missing", async () => {
    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual(["code", "novel", "translate"]);
    expect(catalog.warnings).toEqual([]);
  });

  it("loads a valid custom preset and warns about reserved ids", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writePresetFile({
      version: 1,
      presets: [customPreset(), customPreset("code")],
    });

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual([
      "code",
      "novel",
      "translate",
      "novel-romance",
    ]);
    expect(catalog.presets[3].source).toBe("custom");
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]).toContain("code");
    expect(warn).toHaveBeenCalled();
  });

  it("drops invalid entries instead of failing the whole file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writePresetFile({
      version: 1,
      presets: [
        customPreset("novel-romance"),
        { ...customPreset("broken"), defaultLensIds: ["missing"] },
      ],
    });

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual([
      "code",
      "novel",
      "translate",
      "novel-romance",
    ]);
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]).toContain("broken");
  });

  it("loads a custom translation preset alongside the built-ins", async () => {
    await writePresetFile({ version: 1, presets: [customTranslationPreset()] });

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual([
      "code",
      "novel",
      "translate",
      "translate-alt",
    ]);
    const added = catalog.presets[3];
    expect(added.task).toBe("translate");
    expect(added.translation?.defaultOutputDir).toBe("translated/id");
    expect(catalog.warnings).toEqual([]);
  });

  it("loads the documented example presets file", async () => {
    const examplePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "examples",
      "presets.example.json",
    );
    await writeFile(join(directory, PRESET_FILE), await readFile(examplePath, "utf8"), "utf8");

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual([
      "code",
      "novel",
      "translate",
      "game-design",
      "novel-fr-id",
    ]);
    expect(catalog.warnings).toEqual([]);
    expect(catalog.presets[4].task).toBe("translate");
  });

  it("falls back to built-ins for broken JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(join(directory, PRESET_FILE), "{broken", "utf8");

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual(["code", "novel", "translate"]);
    expect(catalog.warnings).toHaveLength(1);
  });

  it("falls back to built-ins for an unsupported version", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writePresetFile({ version: 2, presets: [customPreset()] });

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual(["code", "novel", "translate"]);
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]).toContain("version");
  });
});
