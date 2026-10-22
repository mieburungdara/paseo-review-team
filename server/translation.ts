import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ReviewSession } from "../shared/contracts";
import {
  isSafeRelativePath,
  normalizeRelativePath,
  type OutputStatus,
} from "../shared/translation";
import { errorMessage } from "./agents";

export interface ValidatedOutputDir {
  workspace: string;
  absolute: string;
  relative: string;
}

function comparable(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (rel === "" || isAbsolute(rel)) return false;
  return !rel.startsWith(`..${"/"}`) && !rel.startsWith("..\\") && rel !== "..";
}

function pathError(code: string | undefined): Error | null {
  if (code === "ENOTDIR") {
    return new Error("Folder hasil menunjuk ke berkas, bukan folder.");
  }
  return null;
}

export async function validateOutputDir(
  workspaceDirectory: string,
  requested: string,
): Promise<ValidatedOutputDir> {
  if (!isSafeRelativePath(requested)) {
    throw new Error(
      'Folder hasil harus path relatif yang aman di dalam workspace, tanpa "..", drive, atau path absolut.',
    );
  }

  const normalized = normalizeRelativePath(requested);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    throw new Error("Folder hasil tidak boleh berada di dalam .git.");
  }

  let workspace: string;
  try {
    workspace = await realpath(workspaceDirectory);
  } catch {
    throw new Error("Workspace tidak punya folder lokal yang bisa diakses.");
  }

  const absolute = resolve(workspace, ...segments);
  if (comparable(absolute) === comparable(workspace) || !isInside(workspace, absolute)) {
    throw new Error("Folder hasil harus berada di dalam workspace, bukan root workspace.");
  }

  let cursor = absolute;
  let existing: string | null = null;
  while (!existing) {
    try {
      await lstat(cursor);
      existing = cursor;
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const mapped = pathError(code);
      if (mapped) throw mapped;
      if (code !== "ENOENT") {
        throw new Error(`Tidak bisa memeriksa folder hasil: ${errorMessage(error)}`);
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }

  if (!existing) throw new Error("Folder hasil tidak bisa diverifikasi.");

  let realExisting: string;
  try {
    realExisting = await realpath(existing);
  } catch {
    throw new Error("Folder hasil tidak bisa diverifikasi.");
  }
  if (
    comparable(realExisting) !== comparable(workspace) &&
    !isInside(workspace, realExisting)
  ) {
    throw new Error("Folder hasil keluar dari workspace lewat symlink atau junction.");
  }

  if (comparable(existing) === comparable(absolute)) {
    const info = await stat(absolute).catch(() => null);
    if (!info || !info.isDirectory()) {
      throw new Error("Folder hasil menunjuk ke berkas, bukan folder.");
    }
  }

  return { workspace, absolute, relative: normalized };
}

export interface VerifyOutputInput {
  workspaceDirectory: string | null;
  outputDir: string | null;
  sourcePath: string | null;
  outputPath: string | null;
}

export async function verifyTranslationOutput(
  input: VerifyOutputInput,
): Promise<OutputStatus> {
  try {
    if (!input.workspaceDirectory || !input.outputDir || !input.outputPath) {
      return "unverified";
    }
    if (!isSafeRelativePath(input.outputPath) || !isSafeRelativePath(input.outputDir)) {
      return "unsafe";
    }

    const outputDir = normalizeRelativePath(input.outputDir);
    const outputPath = normalizeRelativePath(input.outputPath);
    if (!comparable(outputPath).startsWith(`${comparable(outputDir)}/`)) {
      return "outside";
    }

    const sourcePath =
      input.sourcePath && isSafeRelativePath(input.sourcePath)
        ? normalizeRelativePath(input.sourcePath)
        : null;
    if (sourcePath && comparable(sourcePath) === comparable(outputPath)) {
      return "unsafe";
    }

    let workspace: string;
    try {
      workspace = await realpath(input.workspaceDirectory);
    } catch {
      return "unverified";
    }

    const absolute = resolve(workspace, ...outputPath.split("/"));
    if (!isInside(workspace, absolute)) return "outside";

    try {
      await lstat(absolute);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unverified";
    }

    let real: string;
    try {
      real = await realpath(absolute);
    } catch {
      return "missing";
    }
    if (!isInside(workspace, real)) return "outside";

    const info = await stat(real).catch(() => null);
    if (!info || !info.isFile()) return "missing";

    if (sourcePath) {
      const sourceAbsolute = resolve(workspace, ...sourcePath.split("/"));
      try {
        const realSource = await realpath(sourceAbsolute);
        if (comparable(realSource) === comparable(real)) return "unsafe";
      } catch {
        // Source may be outside this checkout or not exist; the path comparison above still applies.
      }
    }

    return "present";
  } catch {
    return "unverified";
  }
}

export function outputDirAbsolute(
  session: Pick<ReviewSession, "workspaceDirectory" | "translation">,
): string | null {
  const outputDir = session.translation?.outputDir;
  if (!session.workspaceDirectory || !outputDir || !isSafeRelativePath(outputDir)) {
    return null;
  }
  return resolve(session.workspaceDirectory, ...normalizeRelativePath(outputDir).split("/"));
}
