import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PLUGIN_ID } from "../shared/constants";
import {
  BUILTIN_PRESETS,
  CustomPresetFileSchema,
  CustomPresetSchema,
  MAX_PRESET_FILE_BYTES,
  type PresetDefinition,
} from "../shared/presets";
import { pluginDataDir } from "./data-dir";

export const PRESET_FILE = "presets.json";

export interface PresetCatalog {
  presets: PresetDefinition[];
  warnings: string[];
}

let cache: { key: string; catalog: PresetCatalog } | null = null;

function builtinCatalog(warnings: string[] = []): PresetCatalog {
  return { presets: [...BUILTIN_PRESETS], warnings };
}

function issueText(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return "format tidak dikenali";
  const path = issue.path.length > 0 ? issue.path.join(".") : "preset";
  return `${path}: ${issue.message}`;
}

function withWarning(message: string): PresetCatalog {
  console.warn(`[${PLUGIN_ID}] ${message}`);
  return builtinCatalog([message]);
}

export async function loadPresetCatalog(): Promise<PresetCatalog> {
  const file = join(pluginDataDir(), PRESET_FILE);

  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return builtinCatalog();
    return withWarning(`Tidak bisa membaca ${PRESET_FILE}: ${String(error)}`);
  }

  const key = `${file}:${info.mtimeMs}:${info.size}`;
  if (cache?.key === key) return cache.catalog;

  if (info.size > MAX_PRESET_FILE_BYTES) {
    const catalog = withWarning(
      `${PRESET_FILE} lebih dari ${Math.round(MAX_PRESET_FILE_BYTES / 1024)} KB dan diabaikan.`,
    );
    cache = { key, catalog };
    return catalog;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    const catalog = withWarning(`Tidak bisa mem-parse ${PRESET_FILE}: ${String(error)}`);
    cache = { key, catalog };
    return catalog;
  }

  const fileResult = CustomPresetFileSchema.safeParse(raw);
  if (!fileResult.success) {
    const catalog = withWarning(
      `${PRESET_FILE} tidak valid (${issueText(fileResult.error)}); hanya preset bawaan yang dipakai.`,
    );
    cache = { key, catalog };
    return catalog;
  }

  const presets = [...BUILTIN_PRESETS];
  const warnings: string[] = [];
  const seen = new Set(presets.map((preset) => preset.id));

  fileResult.data.presets.forEach((entry, index) => {
    const label =
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === "string"
        ? (entry as { id: string }).id
        : `#${index + 1}`;

    const parsed = CustomPresetSchema.safeParse(entry);
    if (!parsed.success) {
      const warning = `Preset "${label}" diabaikan: ${issueText(parsed.error)}`;
      warnings.push(warning);
      console.warn(`[${PLUGIN_ID}] ${warning}`);
      return;
    }

    if (seen.has(parsed.data.id)) {
      const warning = `Preset "${parsed.data.id}" diabaikan: ID sudah dipakai preset lain.`;
      warnings.push(warning);
      console.warn(`[${PLUGIN_ID}] ${warning}`);
      return;
    }

    seen.add(parsed.data.id);
    presets.push({ ...parsed.data, source: "custom" });
  });

  const catalog = { presets, warnings };
  cache = { key, catalog };
  return catalog;
}

export function resetPresetCacheForTests(): void {
  cache = null;
}
