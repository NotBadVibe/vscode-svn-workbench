import * as path from "node:path";

export type GeneratedFileDecision = "exclude" | "review" | "include";

const excludedSegments = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  "__pycache__",
  "obj",
]);

const excludedExtensions = new Set([".log", ".tmp", ".pyc"]);

export function classifyGeneratedFile(
  relativePath: string,
): GeneratedFileDecision {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  const extension = path.extname(normalized).toLocaleLowerCase();

  if (segments.some((segment) => excludedSegments.has(segment))) {
    return "exclude";
  }

  if (segments.length >= 2 && segments[0].toLocaleLowerCase() === "bin") {
    const second = segments[1].toLocaleLowerCase();
    if (second === "debug" || second === "release") {
      return "exclude";
    }
    return "review";
  }

  if (excludedExtensions.has(extension)) {
    return "exclude";
  }

  return "include";
}
