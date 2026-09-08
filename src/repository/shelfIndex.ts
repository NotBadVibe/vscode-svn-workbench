/**
 * V024-R38/R48：本地搁置索引（纯领域 + 可注入存储）。
 *
 * - 显示名称（中文/空格允许）与内部安全 ID/文件名分离；
 * - 索引按 repositoryUuid 隔离，原子保存（临时文件 + rename）；
 * - 目录边界 fail-closed；旧无索引 patch 文件迁移为可检索条目。
 * - 本文件不依赖 Node 专有类型，可被 Webview 直接导入做实时校验。
 */

export const SHELF_INDEX_VERSION = 1 as const;
export const SHELF_INDEX_FILE_NAME = "index.json" as const;
export const SHELF_DISPLAY_NAME_MAX_LENGTH = 64 as const;
export const SHELF_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ShelfIntegrity = "ok" | "missing-patch" | "corrupt" | "unreadable";

export interface ShelfEntry {
  id: string;
  displayName: string;
  createdAt: string;
  fileCount: number;
  files: string[];
  baselineRevision?: string;
  repositoryUuid: string;
  projectName?: string;
  projectRoot?: string;
  patchFileName: string;
  integrity: ShelfIntegrity;
  integrityDetail?: string;
}

export interface ShelfIndexDeps {
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(
    filePath: string,
    content: string,
    options?: { mode?: number },
  ): Promise<void>;
  renameFile(fromPath: string, toPath: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  listDir(dirPath: string): Promise<string[]>;
}

interface FsError {
  code?: string;
}

function fsErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as FsError).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * V024-R48：显示名称校验（Webview 实时提示与 Host 复验共用）。
 * - 允许中文、空格与常用标点；长度按 Unicode 码点 1–64；
 * - 控制字符（NUL/换行/回车及其他 Cc/C0）一律拒绝；
 * - 重复名称（去首尾空白后精确匹配）拒绝，由调用方传入同仓库已有名称；
 * - 路径分隔符（/ \）允许显示，但永不进入内部路径（ID 独立生成）。
 */
export function validateShelfDisplayName(
  displayName: unknown,
  existingNames: readonly string[] = [],
): string[] {
  const issues: string[] = [];
  if (typeof displayName !== "string") {
    return ["请输入搁置名称。"];
  }
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    return ["请输入搁置名称。"];
  }
  const length = [...trimmed].length;
  if (length > SHELF_DISPLAY_NAME_MAX_LENGTH) {
    issues.push("搁置名称不能超过 64 个字符。");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    issues.push("搁置名称包含不支持的控制字符。");
  }
  const normalized = existingNames.map((name) => name.trim());
  if (normalized.includes(trimmed)) {
    issues.push("已存在同名搁置，请换个名称或用日期/项目区分。");
  }
  return [...new Set(issues)];
}

export function isSafeShelfId(value: unknown): value is string {
  return typeof value === "string" && SHELF_ID_PATTERN.test(value);
}

/**
 * V024-R48：内部安全 ID 独立于显示名称生成，永不携带路径分隔。
 */
export function buildShelfId(nowMs: number, randomSuffix: string): string {
  const safeRandom =
    randomSuffix.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "000000";
  const stamp = Number.isFinite(nowMs) ? Math.floor(nowMs) : Date.now();
  const candidate = `shelf-${String(stamp)}-${safeRandom}`;
  return candidate.length <= 64 ? candidate : candidate.slice(0, 64);
}

export function shelfPatchFileName(shelfId: string): string | undefined {
  if (!isSafeShelfId(shelfId)) return undefined;
  return `${shelfId}.patch`;
}

function joinShelfPath(shelfDir: string, fileName: string): string {
  const separator =
    shelfDir.includes("\\") && !shelfDir.includes("/") ? "\\" : "/";
  const trimmed =
    shelfDir.endsWith("/") || shelfDir.endsWith("\\")
      ? shelfDir.slice(0, -1)
      : shelfDir;
  return `${trimmed}${separator}${fileName}`;
}

/**
 * V024-R38：目录边界 fail-closed（平台无关纯字符串判定）。
 * 内部文件名仅允许安全 ID + .patch，不含任何分隔符，因此拼接后必在目录内。
 */
export function resolveShelfPatchPath(
  shelfDir: string,
  patchFileName: string,
): string | undefined {
  if (!patchFileName.endsWith(".patch")) return undefined;
  if (patchFileName.includes("/") || patchFileName.includes("\\")) {
    return undefined;
  }
  const base = patchFileName.slice(0, -".patch".length);
  if (!isSafeShelfId(base)) return undefined;
  if (!shelfDir || shelfDir.includes("..")) return undefined;
  return joinShelfPath(shelfDir, patchFileName);
}

export function shelfIndexFilePath(shelfDir: string): string {
  return joinShelfPath(shelfDir, SHELF_INDEX_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShelfEntryRecord(value: unknown): value is ShelfEntry {
  if (!isRecord(value)) return false;
  if (!isSafeShelfId(value.id)) return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.createdAt !== "string") return false;
  if (
    typeof value.fileCount !== "number" ||
    !Number.isFinite(value.fileCount)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.files) ||
    !value.files.every((item) => typeof item === "string")
  ) {
    return false;
  }
  if (
    typeof value.repositoryUuid !== "string" ||
    value.repositoryUuid.length === 0
  ) {
    return false;
  }
  if (
    typeof value.patchFileName !== "string" ||
    !value.patchFileName.endsWith(".patch")
  ) {
    return false;
  }
  const integrity = value.integrity;
  if (
    integrity !== "ok" &&
    integrity !== "missing-patch" &&
    integrity !== "corrupt" &&
    integrity !== "unreadable"
  ) {
    return false;
  }
  if (
    (value.baselineRevision !== undefined &&
      typeof value.baselineRevision !== "string") ||
    (value.projectName !== undefined &&
      typeof value.projectName !== "string") ||
    (value.projectRoot !== undefined &&
      typeof value.projectRoot !== "string") ||
    (value.integrityDetail !== undefined &&
      typeof value.integrityDetail !== "string")
  ) {
    return false;
  }
  return true;
}

/**
 * V024-R38：索引文件解析（畸形 fail-closed 为空清单 + 问题说明）。
 */
export function parseShelfIndexFile(content: string): {
  entries: ShelfEntry[];
  issues: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return {
      entries: [],
      issues: ["搁置索引已损坏，将只显示可迁移的补丁文件。"],
    };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    return {
      entries: [],
      issues: ["搁置索引已损坏，将只显示可迁移的补丁文件。"],
    };
  }
  const entries = (parsed.entries as unknown[]).filter(isShelfEntryRecord);
  const issues =
    entries.length !== (parsed.entries as unknown[]).length
      ? ["搁置索引中有无效条目，已跳过。"]
      : [];
  return { entries, issues };
}

/**
 * V024-R38：旧无索引 patch 迁移（纯函数，可单元测试）。
 * 旧文件名形如 `<ascii-name>-<timestamp>.patch`，显示名还原为 ascii 部分；
 * 非安全基名仍可检索（显示名保留，内部文件名保持原样但须通过边界校验）。
 * P3-2：原 patchFileName 若含控制字符/换行则拒绝迁移并给出中文提示
 * （fail-closed，不规范化回写，避免清洗后文件名与磁盘真实文件脱钩）。
 */
export function mergeLegacyPatchFiles(
  indexed: readonly ShelfEntry[],
  patchFileNames: readonly string[],
  options: { repositoryUuid: string; nowIso?: string } = { repositoryUuid: "" },
): { entries: ShelfEntry[]; migratedCount: number; issues: string[] } {
  const known = new Set(indexed.map((entry) => entry.patchFileName));
  const migrated: ShelfEntry[] = [];
  const issues = new Set<string>();
  for (const fileName of patchFileNames) {
    if (!fileName.endsWith(".patch")) continue;
    if (fileName === SHELF_INDEX_FILE_NAME) continue;
    if (known.has(fileName)) continue;
    if (fileName.includes("/") || fileName.includes("\\")) continue;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(fileName)) {
      issues.add(
        "发现旧搁置文件名包含控制字符或换行，已跳过该文件以保护存储路径。",
      );
      continue;
    }
    const base = fileName.slice(0, -".patch".length);
    const legacyMatch = /^(.*)-(\d{10,})$/.exec(base);
    const displayName = (legacyMatch?.[1] ?? base).trim() || base;
    const createdAt = options.nowIso ?? new Date().toISOString();
    const id = isSafeShelfId(base) ? base : `shelf-legacy-${migrated.length}`;
    migrated.push({
      id,
      displayName,
      createdAt,
      fileCount: 0,
      files: [],
      repositoryUuid: options.repositoryUuid,
      patchFileName: fileName,
      integrity: "ok",
      integrityDetail: "旧搁置已迁移，文件数以预览为准。",
    });
  }
  return {
    entries: [...indexed, ...migrated],
    migratedCount: migrated.length,
    issues: [...issues],
  };
}

/**
 * V024-R38：索引原子保存（临时文件 + rename，可注入测试）。
 */
export async function saveShelfIndexAtomic(
  deps: ShelfIndexDeps,
  indexPath: string,
  entries: readonly ShelfEntry[],
): Promise<void> {
  const payload = JSON.stringify(
    { version: SHELF_INDEX_VERSION, entries },
    null,
    2,
  );
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
      : String(Date.now()).slice(-8);
  const tempPath = `${indexPath}.${Date.now()}.${random}.tmp`;
  await deps.writeTextFile(tempPath, payload, { mode: 0o600 });
  try {
    await deps.renameFile(tempPath, indexPath);
  } catch (error) {
    try {
      await deps.removeFile(tempPath);
    } catch {
      // 清理失败不掩盖原错误。
    }
    throw error;
  }
}

/**
 * V024-R38：加载索引 + 迁移旧项（可注入测试权限失败与损坏）。
 */
export async function loadShelfIndex(
  deps: ShelfIndexDeps,
  shelfDir: string,
  repositoryUuid: string,
): Promise<{ entries: ShelfEntry[]; migratedCount: number; issues: string[] }> {
  const indexPath = shelfIndexFilePath(shelfDir);
  let indexed: ShelfEntry[] = [];
  const issues: string[] = [];
  try {
    const content = await deps.readTextFile(indexPath);
    const parsed = parseShelfIndexFile(content);
    indexed = parsed.entries;
    issues.push(...parsed.issues);
  } catch (error) {
    const code = fsErrorCode(error);
    if (code !== "ENOENT") {
      issues.push("搁置索引不可读，将只显示可迁移的补丁文件。");
    }
  }
  let patchFiles: string[];
  try {
    const names = await deps.listDir(shelfDir);
    patchFiles = names.filter((name) => name.endsWith(".patch"));
  } catch (error) {
    const code = fsErrorCode(error);
    if (code !== "ENOENT") {
      issues.push("搁置目录不可读。");
    }
    return {
      entries: indexed.filter(
        (entry) =>
          entry.repositoryUuid === repositoryUuid || !entry.repositoryUuid,
      ),
      migratedCount: 0,
      issues,
    };
  }
  const merged = mergeLegacyPatchFiles(indexed, patchFiles, { repositoryUuid });
  issues.push(...merged.issues);
  const scoped = merged.entries.filter(
    (entry) => !entry.repositoryUuid || entry.repositoryUuid === repositoryUuid,
  );
  if (merged.migratedCount > 0) {
    try {
      await saveShelfIndexAtomic(deps, indexPath, scoped);
    } catch {
      issues.push("搁置索引迁移后保存失败，旧补丁仍可预览但下次需重新迁移。");
    }
  }
  return { entries: scoped, migratedCount: merged.migratedCount, issues };
}
