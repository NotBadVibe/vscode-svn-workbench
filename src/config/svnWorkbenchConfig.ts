import * as fs from "node:fs/promises";
import * as path from "node:path";

export const SVN_WORKBENCH_CONFIG_FILE = ".svn-workbench.json";

export type SvnWorkbenchConfigObject = Record<string, unknown>;

export interface SvnWorkbenchConfigParseResult {
  raw?: SvnWorkbenchConfigObject;
  warnings: string[];
}

export interface SvnWorkbenchConfigReadResult extends SvnWorkbenchConfigParseResult {
  configPath: string;
  exists: boolean;
  readError?: unknown;
}

export function getSvnWorkbenchConfigPath(repositoryRoot: string): string {
  return path.join(repositoryRoot, SVN_WORKBENCH_CONFIG_FILE);
}

export function parseSvnWorkbenchConfigContent(
  content: string,
): SvnWorkbenchConfigParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    return {
      warnings: [
        `${SVN_WORKBENCH_CONFIG_FILE} 不是合法 JSON：${describeSvnWorkbenchConfigError(error)}`,
      ],
    };
  }

  if (!isRecord(raw)) {
    return {
      warnings: [`${SVN_WORKBENCH_CONFIG_FILE} 顶层必须是 JSON 对象。`],
    };
  }

  return { raw, warnings: [] };
}

export async function readSvnWorkbenchConfig(
  repositoryRoot: string,
): Promise<SvnWorkbenchConfigReadResult> {
  const configPath = getSvnWorkbenchConfigPath(repositoryRoot);
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      return { configPath, exists: false, warnings: [] };
    }
    return { configPath, exists: false, warnings: [], readError: error };
  }

  const parsed = parseSvnWorkbenchConfigContent(content);
  return { configPath, exists: true, ...parsed };
}

export async function readSvnWorkbenchConfigContent(
  repositoryRoot: string,
): Promise<string> {
  return fs.readFile(getSvnWorkbenchConfigPath(repositoryRoot), "utf8");
}

export function serializeSvnWorkbenchConfig(
  config: SvnWorkbenchConfigObject,
): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function mergeSvnWorkbenchConfigContent(
  content: string,
  updates: SvnWorkbenchConfigObject,
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  let raw: SvnWorkbenchConfigObject = {};
  if (content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (isRecord(parsed)) {
        raw = { ...parsed };
      } else {
        warnings.push(
          `${SVN_WORKBENCH_CONFIG_FILE} 顶层不是对象，保存时已重建。`,
        );
      }
    } catch (error) {
      warnings.push(
        `${SVN_WORKBENCH_CONFIG_FILE} 不是合法 JSON，保存时已重建：${describeSvnWorkbenchConfigError(error)}`,
      );
    }
  }

  Object.assign(raw, updates);
  return {
    content: serializeSvnWorkbenchConfig(raw),
    warnings,
  };
}

export type RemoveSvnWorkbenchConfigKeyResult =
  | { ok: true; removed: boolean; content: string }
  | { ok: false; error: string };

/**
 * 从 `.svn-workbench.json` 内容中精确删除一个顶层键，保留其余键。
 * 与 mergeSvnWorkbenchConfigContent 的“损坏即重建”不同：删除是外科手术式操作，
 * 配置损坏时拒绝执行并给出中文错误，避免误丢其他团队配置。
 * removed=false 表示键本就不存在（幂等），调用方无需写回文件。
 */
export function removeSvnWorkbenchConfigKey(
  content: string,
  key: string,
): RemoveSvnWorkbenchConfigKeyResult {
  if (!content.trim()) {
    return { ok: true, removed: false, content };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    return {
      ok: false,
      error: `${SVN_WORKBENCH_CONFIG_FILE} 不是合法 JSON，无法安全删除 "${key}" 配置：${describeSvnWorkbenchConfigError(error)}。请手动修复或删除该文件后重试。`,
    };
  }
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: `${SVN_WORKBENCH_CONFIG_FILE} 顶层不是 JSON 对象，无法安全删除 "${key}" 配置。请手动修复或删除该文件后重试。`,
    };
  }
  if (!(key in raw)) {
    return { ok: true, removed: false, content };
  }
  const next = { ...raw };
  delete next[key];
  return {
    ok: true,
    removed: true,
    content: serializeSvnWorkbenchConfig(next),
  };
}

export async function ensureSvnWorkbenchConfigFile(
  repositoryRoot: string,
  defaultContent: string,
): Promise<string> {
  const configPath = getSvnWorkbenchConfigPath(repositoryRoot);
  try {
    await fs.access(configPath);
    return configPath;
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }

  await fs.writeFile(configPath, defaultContent, "utf8");
  return configPath;
}

export async function updateSvnWorkbenchConfig(
  repositoryRoot: string,
  updates: SvnWorkbenchConfigObject,
  defaultContent: string,
): Promise<{ configPath: string; warnings: string[] }> {
  const configPath = await ensureSvnWorkbenchConfigFile(
    repositoryRoot,
    defaultContent,
  );
  const content = await fs.readFile(configPath, "utf8");
  const next = mergeSvnWorkbenchConfigContent(content, updates);
  await fs.writeFile(configPath, next.content, "utf8");
  return {
    configPath,
    warnings: next.warnings,
  };
}

export function describeSvnWorkbenchConfigError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is SvnWorkbenchConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
