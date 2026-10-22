import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOVEL_PRESET } from "../shared/presets";
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
    expect(catalog.presets.map((preset) => preset.id)).toEqual(["code", "novel"]);
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
      "novel-romance",
    ]);
    expect(catalog.presets[2].source).toBe("custom");
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
      "novel-romance",
    ]);
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]).toContain("broken");
  });

  it("falls back to built-ins for broken JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(join(directory, PRESET_FILE), "{broken", "utf8");

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual(["code", "novel"]);
    expect(catalog.warnings).toHaveLength(1);
  });

  it("falls back to built-ins for an unsupported version", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writePresetFile({ version: 2, presets: [customPreset()] });

    const catalog = await loadPresetCatalog();
    expect(catalog.presets.map((preset) => preset.id)).toEqual(["code", "novel"]);
    expect(catalog.warnings).toHaveLength(1);
    expect(catalog.warnings[0]).toContain("version");
  });
});
