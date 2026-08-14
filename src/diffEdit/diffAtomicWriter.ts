import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import {
  isSamePathIdentity,
  normalizePathIdentity,
} from "../scope/pathIdentity";
import { hashBytes } from "./diffPathGuard";

/**
 * v0.0.6 页内编辑原子写入器（纯 Node 实现，可单测）。
 *
 * - 按规范化路径互斥串行化写入（临界区串行）；
 * - 写入同目录临时文件，保留原文件权限；按原文件 BOM/EOL/末尾换行特征
 *   归一化内容后再落盘；
 * - 以**写句柄** fsync 落盘（Windows 上只读句柄 fsync 会确定性 EACCES：
 *   FlushFileBuffers 需要写访问），再原子 rename 替换目标；
 * - 任何失败保留原文件并清理临时文件；
 * - 返回新字节 hash 供结果绑定。
 */

export interface DiffAtomicWriteResult {
  ok: true;
  newHash: string;
  /** 临时文件是否已清理。 */
  cleanedUp: boolean;
}

export interface DiffAtomicWriteError {
  ok: false;
  reason: "targetMoved" | "diskChanged" | "writeFailed";
  message: string;
}

export type DiffAtomicWriteOutcome =
  DiffAtomicWriteResult | DiffAtomicWriteError;

export interface DiffAtomicWriterDeps {
  /** 进入临界区后复验磁盘现状（由 Host 提供 lstat/realpath/hash）。 */
  freshness?: (targetPath: string) => Promise<{
    exists: boolean;
    isRegularFile: boolean;
    realPath: string;
    rawHash: string;
  }>;
}

export interface SyncWritableFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export type OpenSyncWritableFile = (
  filePath: string,
  flags: "w",
  mode: number,
) => Promise<SyncWritableFileHandle>;

/**
 * 以写句柄写入临时文件并 fsync 落盘。
 * `openFile` 可注入，使 macOS/Linux 单测也能锁定 Windows 的
 * FlushFileBuffers 写访问契约。
 */
export async function writeAndSyncTempFile(
  tempPath: string,
  bytes: Buffer,
  mode: number,
  openFile: OpenSyncWritableFile = (filePath, flags, fileMode) =>
    fs.open(filePath, flags, fileMode),
): Promise<void> {
  const handle = await openFile(tempPath, "w", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const pendingWrites = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  pendingWrites.set(
    key,
    current.catch(() => undefined),
  );
  return current;
}

/** 将编辑器内容按原文件特征还原为字节（BOM + EOL + 末尾换行）。 */
export function toPreservingBytes(
  content: string,
  analysis: {
    bom: boolean;
    eol: "\r\n" | "\n" | "mixed";
    finalNewline: boolean;
  },
): Buffer {
  let text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (analysis.eol === "\r\n") {
    text = text.replace(/\n/g, "\r\n");
  }
  const endsWithNewline = /(?:\r\n|\n)$/.test(text);
  if (analysis.finalNewline && !endsWithNewline) {
    text += analysis.eol === "\r\n" ? "\r\n" : "\n";
  } else if (!analysis.finalNewline && endsWithNewline) {
    text = text.replace(/(?:\r\n|\n)$/, "");
  }
  const body = Buffer.from(text, "utf8");
  return analysis.bom
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
    : body;
}

export class DiffAtomicWriter {
  /** 写入原始字节（不归一化），供需要精确字节语义的调用方。 */
  async writeRawBytes(input: {
    targetPath: string;
    bytes: Buffer;
    expectedRawHash?: string;
    analysis?: {
      bom: boolean;
      eol: "\r\n" | "\n" | "mixed";
      finalNewline: boolean;
    };
    freshness?: (targetPath: string) => Promise<{
      exists: boolean;
      isRegularFile: boolean;
      realPath: string;
      rawHash: string;
    }>;
  }): Promise<DiffAtomicWriteOutcome> {
    const targetPath = path.resolve(input.targetPath);
    const targetIdentity = normalizePathIdentity(targetPath);
    return serialize(targetIdentity, async () => {
      const freshness =
        input.freshness ??
        (async () => {
          try {
            const stat = await fs.lstat(targetPath);
            const bytes = await fs.readFile(targetPath);
            const real = await fs.realpath(targetPath);
            return {
              exists: true,
              isRegularFile: stat.isFile(),
              realPath: real,
              rawHash: hashBytes(bytes),
            };
          } catch {
            return {
              exists: false,
              isRegularFile: false,
              realPath: targetPath,
              rawHash: "",
            };
          }
        });
      let current;
      try {
        current = await freshness(targetPath);
      } catch {
        return {
          ok: false,
          reason: "writeFailed",
          message: "保存前无法复验目标文件状态。",
        };
      }
      if (!current.exists) {
        return {
          ok: false,
          reason: "targetMoved",
          message: "目标文件已被移动或删除。",
        };
      }
      if (!current.isRegularFile) {
        return {
          ok: false,
          reason: "targetMoved",
          message: "目标已不再是普通文件。",
        };
      }
      const expectedRealPath = await fs
        .realpath(targetPath)
        .catch(() => targetPath);
      if (!isSamePathIdentity(current.realPath, expectedRealPath)) {
        return {
          ok: false,
          reason: "targetMoved",
          message: "目标路径已变化（符号链接/移动）。",
        };
      }
      if (input.expectedRawHash && current.rawHash !== input.expectedRawHash) {
        return {
          ok: false,
          reason: "diskChanged",
          message: "文件在编辑期间被外部修改；已保留草稿，请刷新后重试。",
        };
      }

      const dir = path.dirname(targetPath);
      const tempName = `.svn-workbench-diff-${randomBytes(6).toString("hex")}.tmp`;
      const tempPath = path.join(dir, tempName);
      let mode: number | undefined;
      try {
        const targetStat = await fs.stat(targetPath);
        mode = targetStat.mode & 0o777;
      } catch {
        return {
          ok: false,
          reason: "targetMoved",
          message: "目标文件状态读取失败。",
        };
      }
      try {
        await writeAndSyncTempFile(tempPath, input.bytes, mode);
        await fs.rename(tempPath, targetPath);
      } catch {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        return {
          ok: false,
          reason: "writeFailed",
          message:
            "写入失败（磁盘满、权限不足或系统错误）；原文件未改动，草稿已保留。",
        };
      }
      return { ok: true, newHash: hashBytes(input.bytes), cleanedUp: true };
    });
  }
}

/**
 * 便捷入口：给定目标与编辑器内容（+ 原文件字节特征），按保留规则原子写入。
 * `expectedRawHash` 为进入临界区前的磁盘 hash，用于 diskChanged 复验。
 */
export class DiffAtomicWriterService {
  constructor(
    private readonly writer = new DiffAtomicWriter(),
    private readonly deps: DiffAtomicWriterDeps = {},
  ) {}

  async save(input: {
    targetPath: string;
    content: string;
    analysis: {
      bom: boolean;
      eol: "\r\n" | "\n" | "mixed";
      finalNewline: boolean;
    };
    expectedRawHash: string;
    freshness?: (targetPath: string) => Promise<{
      exists: boolean;
      isRegularFile: boolean;
      realPath: string;
      rawHash: string;
    }>;
  }): Promise<DiffAtomicWriteOutcome> {
    const bytes = toPreservingBytes(input.content, input.analysis);
    return this.writer.writeRawBytes({
      targetPath: input.targetPath,
      bytes,
      expectedRawHash: input.expectedRawHash,
      freshness: input.freshness ?? this.deps.freshness,
    });
  }
}
