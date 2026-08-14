import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { normalizePathIdentity as normalizePathKey } from "./pathIdentity";
import { nativePathSemantics } from "./nativePathSemantics";

export interface WorkingCopySetResolution {
  root?: string;
  roots: string[];
  invalidTargets: string[];
  mixed: boolean;
}

export async function resolveWorkingCopyRoot(
  svnPath: string,
  targetPath: string,
): Promise<string | undefined> {
  let cwd: string;
  try {
    const stat = await fs.stat(targetPath);
    cwd = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  } catch {
    return undefined;
  }
  try {
    const result = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "wc-root", targetPath],
      cwd,
    );
    const root = result.stdout.trim();
    if (result.exitCode === 0 && root) return path.resolve(root);
  } catch {
    // Continue with local metadata discovery when the executable is missing.
  }
  return findLocalWorkingCopyRoot(cwd);
}

export async function resolveWorkingCopySet(
  svnPath: string,
  targetPaths: string[],
): Promise<WorkingCopySetResolution> {
  const resolved = await Promise.all(
    targetPaths.map(async (targetPath) => ({
      targetPath,
      root: await resolveWorkingCopyRoot(svnPath, targetPath),
    })),
  );
  const invalidTargets = resolved
    .filter((item) => !item.root)
    .map((item) => item.targetPath);
  const roots = [
    ...new Set(
      resolved.flatMap((item) =>
        item.root ? [normalizePathKey(item.root, nativePathSemantics)] : [],
      ),
    ),
  ];
  return {
    root: roots.length === 1 ? roots[0] : undefined,
    roots,
    invalidTargets,
    mixed: roots.length > 1,
  };
}

async function findLocalWorkingCopyRoot(
  start: string,
): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    try {
      await fs.stat(path.join(current, ".svn"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}
