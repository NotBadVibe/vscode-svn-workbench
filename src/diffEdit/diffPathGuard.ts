import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import type { DiffEditTargetContext } from "./diffEditTypes";

/**
 * v0.0.6 页内编辑路径守卫（纯 Node 实现，可单测；真实调用由 Host 驱动）。
 *
 * 打开编辑态与每次保存前均复验：
 * - lstat 为普通文件（拒绝目录/设备/symlink/junction/其它特殊文件）；
 * - realpath 解析后仍位于工作副本根与 operationScope 内；
 * - 目标大小 ≤ 5 MB；
 * - 内容为可可靠确认的 UTF-8（允许 BOM/无 BOM，拒绝非法 UTF-8 与未知编码）。
 */

export const MAX_EDITABLE_BYTES = 5 * 1024 * 1024;

export type DiffPathGuardErrorCode =
  | "notFound"
  | "notRegularFile"
  | "symlink"
  | "outOfScope"
  | "tooLarge"
  | "binary"
  | "unsupportedEncoding"
  | "ioError";

export interface DiffPathGuardError {
  ok: false;
  code: DiffPathGuardErrorCode;
  message: string;
}

export type DiffPathGuardResult =
  { ok: true; context: DiffEditTargetContext } | DiffPathGuardError;

/** 读取文件原始字节并计算 SHA-256（大写 hex）。 */
export function hashBytes(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

/** 文本原始字节的编码/EOL/末尾换行分析，供保存时保留原貌。 */
export interface DiffByteAnalysis {
  ok: boolean;
  bom: boolean;
  eol: "\r\n" | "\n" | "mixed";
  finalNewline: boolean;
}

/**
 * 把原始字节解码为编辑器文本模型：剥离 BOM、统一 \n（与
 * toPreservingBytes 的归一化互逆），供草稿初始化与脏判定使用。
 */
export function normalizeEditText(buffer: Buffer): string {
  let text = buffer.toString("utf8");
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 检测字节序列是否合法 UTF-8，并给出 BOM / EOL / 末尾换行特征。 */
export function analyzeUtf8(buffer: Buffer): DiffByteAnalysis {
  if (buffer.length === 0) {
    return { ok: true, bom: false, eol: "\n", finalNewline: false };
  }
  let bom = false;
  let offset = 0;
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    bom = true;
    offset = 3;
  }
  let ok = true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(offset));
  } catch {
    ok = false;
  }
  const text = buffer.subarray(offset).toString("utf8");
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const eol: "\r\n" | "\n" | "mixed" =
    crlf === 0 && lf === 0
      ? "\n"
      : crlf > 0 && lf === 0
        ? "\r\n"
        : lf > 0 && crlf === 0
          ? "\n"
          : "mixed";
  const finalNewline = buffer[buffer.length - 1] === 0x0a;
  return { ok, bom, eol, finalNewline };
}

/**
 * 校验目标路径并返回编辑上下文。scope 之外的路径、符号链接、目录、
 * 设备、超限与非 UTF-8 一律拒绝。
 */
export async function validateDiffEditTarget(input: {
  scope: OperationScope;
  repositoryRoot: string;
  targetPath: string;
  baseContents: string;
  baseRevision: string;
}): Promise<DiffPathGuardResult> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(input.targetPath);
  } catch {
    return {
      ok: false,
      code: "notFound",
      message: "目标文件不存在或已被移动。",
    };
  }
  if (stat.isSymbolicLink()) {
    return {
      ok: false,
      code: "symlink",
      message: "目标为符号链接，拒绝页内编辑；请使用原生编辑器。",
    };
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      code: "notRegularFile",
      message: "页内编辑仅支持普通文件；目录或设备文件请使用原生编辑器。",
    };
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(input.targetPath);
  } catch {
    return { ok: false, code: "ioError", message: "无法解析目标真实路径。" };
  }
  const resolved = path.resolve(realPath);
  // 文件本身为 symlink 已由 lstat 拒绝；父目录的系统符号链接（如 /var →
  // /private/var）不构成越界。比较时把 scope 根也解析到真实路径，保证
  // 同一基准（否则 /var 前缀不一致会误判 outOfScope）。
  const repositoryRootResolved = path.resolve(
    await fs.realpath(input.repositoryRoot).catch(() => input.repositoryRoot),
  );
  const resolvedRoots = await Promise.all(
    input.scope.roots.map(async (root) => ({
      ...root,
      absolutePath: path.resolve(
        await fs.realpath(root.absolutePath).catch(() => root.absolutePath),
      ),
    })),
  );
  const resolvedScope: OperationScope = {
    ...input.scope,
    repositoryRoot: repositoryRootResolved,
    roots: resolvedRoots,
  };
  if (!isPathInScope(resolvedScope, resolved, nativePathSemantics)) {
    return {
      ok: false,
      code: "outOfScope",
      message: "目标已移出当前操作范围，请重新打开差异。",
    };
  }
  const relativeToRoot = path.relative(repositoryRootResolved, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return {
      ok: false,
      code: "outOfScope",
      message: "目标不在当前工作副本内，拒绝页内编辑。",
    };
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(resolved);
  } catch {
    return { ok: false, code: "ioError", message: "无法读取目标文件内容。" };
  }
  if (buffer.byteLength > MAX_EDITABLE_BYTES) {
    return {
      ok: false,
      code: "tooLarge",
      message: "超过 5 MB 的文件不支持页内编辑，请使用原生编辑器。",
    };
  }
  // 含 NUL 即视为二进制：NUL 是合法 UTF-8，编码检测无法拦截，必须独立拒绝。
  if (buffer.indexOf(0) !== -1) {
    return {
      ok: false,
      code: "binary",
      message: "二进制文件不支持页内编辑；请使用原生编辑器。",
    };
  }
  if (!analyzeUtf8(buffer).ok) {
    return {
      ok: false,
      code: "unsupportedEncoding",
      message:
        "文件不是可可靠确认的 UTF-8 文本，页内编辑已禁用；请使用原生编辑器。",
    };
  }

  return {
    ok: true,
    context: {
      absolutePath: resolved,
      baseContents: input.baseContents,
      baseRevision: input.baseRevision,
      baseHash: hashBytes(Buffer.from(input.baseContents, "utf8")),
      rawHash: hashBytes(buffer),
      workingContents: normalizeEditText(buffer),
      isRegularFile: true,
      sizeBytes: buffer.byteLength,
    },
  };
}
