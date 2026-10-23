import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isSafeRelativePath,
  normalizeRelativePath,
  outputStatusLabel,
  translationUnitFromTitle,
} from "../shared/translation";
import {
  outputDirAbsolute,
  validateOutputDir,
  verifyTranslationOutput,
} from "../server/translation";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "review-team-translation-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("relative paths", () => {
  it("accepts workspace-relative paths and normalizes separators", () => {
    expect(isSafeRelativePath("translated/id")).toBe(true);
    expect(isSafeRelativePath("translated\\id")).toBe(true);
    expect(isSafeRelativePath("./translated/id/")).toBe(true);
    expect(normalizeRelativePath("translated\\id//bab-01.md")).toBe(
      "translated/id/bab-01.md",
    );
  });

  it("rejects absolute, drive, UNC, traversal, and empty paths", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("   ")).toBe(false);
    expect(isSafeRelativePath(".")).toBe(false);
    expect(isSafeRelativePath("..")).toBe(false);
    expect(isSafeRelativePath("../outside")).toBe(false);
    expect(isSafeRelativePath("a/../b")).toBe(false);
    expect(isSafeRelativePath("/absolute")).toBe(false);
    expect(isSafeRelativePath("C:\\novel\\out")).toBe(false);
    expect(isSafeRelativePath("\\\\server\\share\\out")).toBe(false);
    expect(isSafeRelativePath("translated/\0id")).toBe(false);
  });
});

describe("translation titles and labels", () => {
  it("reads the unit from a translator title", () => {
    expect(translationUnitFromTitle("Translator: Bab 1")).toBe("Bab 1");
    expect(translationUnitFromTitle("translator:  Scene 2 ")).toBe("Scene 2");
    expect(translationUnitFromTitle("Reviewer: Kesetiaan Makna")).toBeNull();
    expect(translationUnitFromTitle(null)).toBeNull();
  });

  it("labels output verification states", () => {
    expect(outputStatusLabel("present")).toBe("Berkas ada");
    expect(outputStatusLabel("missing")).toBe("Berkas tidak ditemukan");
    expect(outputStatusLabel("outside")).toBe("Di luar folder hasil");
    expect(outputStatusLabel("unsafe")).toBe("Path tidak aman");
    expect(outputStatusLabel("unknown")).toBe("Belum diverifikasi");
  });
});

describe("validateOutputDir", () => {
  it("accepts an existing folder inside the workspace", async () => {
    await mkdir(join(root, "translated", "id"), { recursive: true });
    const validated = await validateOutputDir(root, "translated/id");
    expect(validated.relative).toBe("translated/id");
    expect(validated.absolute).toBe(resolve(root, "translated", "id"));
  });

  it("accepts a folder that does not exist yet without creating it", async () => {
    const validated = await validateOutputDir(root, "translated/id");
    expect(validated.relative).toBe("translated/id");
    await expect(stat(join(root, "translated"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an unsafe, root, or .git path", async () => {
    await expect(validateOutputDir(root, "../outside")).rejects.toThrow(/relatif/);
    await expect(validateOutputDir(root, ".")).rejects.toThrow(/relatif/);
    await expect(validateOutputDir(root, "/absolute")).rejects.toThrow(/relatif/);
    await expect(validateOutputDir(root, "repo/.git/hooks")).rejects.toThrow(/\.git/);
  });

  it("rejects a path that points at a file", async () => {
    await writeFile(join(root, "not-a-folder.md"), "# nope", "utf8");
    await expect(validateOutputDir(root, "not-a-folder.md")).rejects.toThrow(/berkas/);
  });

  it("rejects a symlink that escapes the workspace when the platform allows it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "review-team-outside-"));
    try {
      try {
        await symlink(outside, join(root, "link"), "junction");
      } catch {
        return;
      }
      await expect(validateOutputDir(root, "link/out")).rejects.toThrow(
        /symlink|junction/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("verifyTranslationOutput", () => {
  async function seed() {
    await mkdir(join(root, "manuscript", "en"), { recursive: true });
    await mkdir(join(root, "translated", "id"), { recursive: true });
    await writeFile(join(root, "manuscript", "en", "bab-01.md"), "# One", "utf8");
    await writeFile(join(root, "translated", "id", "bab-01.md"), "# Satu", "utf8");
  }

  it("reports a present file", async () => {
    await seed();
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: root,
        outputDir: "translated/id",
        sourcePath: "manuscript/en/bab-01.md",
        outputPath: "translated/id/bab-01.md",
      }),
    ).resolves.toBe("present");
  });

  it("reports missing files and outside paths", async () => {
    await seed();
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: root,
        outputDir: "translated/id",
        sourcePath: "manuscript/en/bab-01.md",
        outputPath: "translated/id/bab-02.md",
      }),
    ).resolves.toBe("missing");
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: root,
        outputDir: "translated/id",
        sourcePath: "manuscript/en/bab-01.md",
        outputPath: "elsewhere/bab-01.md",
      }),
    ).resolves.toBe("outside");
  });

  it("rejects unsafe paths and writing over the source", async () => {
    await seed();
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: root,
        outputDir: "translated/id",
        sourcePath: "manuscript/en/bab-01.md",
        outputPath: "../outside.md",
      }),
    ).resolves.toBe("unsafe");
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: root,
        outputDir: "translated/id",
        sourcePath: "translated/id/bab-01.md",
        outputPath: "translated/id/bab-01.md",
      }),
    ).resolves.toBe("unsafe");
  });

  it("stays unverified without a workspace or report paths", async () => {
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: null,
        outputDir: "translated/id",
        sourcePath: null,
        outputPath: "translated/id/bab-01.md",
      }),
    ).resolves.toBe("unverified");
    await expect(
      verifyTranslationOutput({
        workspaceDirectory: root,
        outputDir: "translated/id",
        sourcePath: null,
        outputPath: null,
      }),
    ).resolves.toBe("unverified");
  });
});

describe("outputDirAbsolute", () => {
  it("resolves a safe output dir and ignores unsafe ones", () => {
    const session = {
      workspaceDirectory: "C:/workspace",
      translation: {
        sourceLanguage: "English",
        targetLanguage: "Indonesian",
        outputDir: "translated/id",
        outputExtension: ".txt",
        unitLabel: "Bab",
      },
    };
    expect(outputDirAbsolute(session)).toBe(resolve("C:/workspace", "translated", "id"));
    expect(
      outputDirAbsolute({
        ...session,
        translation: { ...session.translation, outputDir: "../outside" },
      }),
    ).toBeNull();
    expect(outputDirAbsolute({ workspaceDirectory: null, translation: session.translation })).toBeNull();
  });
});
