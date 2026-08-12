import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { DiffEditingService } from "../../diffEdit/diffEditingService";
import { DiffEditTokenRegistry } from "../../diffEdit/diffEditTokenRegistry";
import { DiffDraftService } from "../../diffEdit/diffDraftService";
import { DiffAtomicWriterService } from "../../diffEdit/diffAtomicWriter";
import { hashBytes } from "../../diffEdit/diffPathGuard";
import type { DiffTargetFreshness } from "../../diffEdit/diffEditTypes";

/**
 * v0.0.6 页内编辑的 Host 接线：把 DiffEditingService 与 VS Code 依赖
 * （TextDocument 脏状态、文件系统现状）接在一起。Controller 只负责
 * 生命周期与协议路由，写入/token/草稿/互斥逻辑留在领域服务。
 */

function resolvePath(value: string): string {
  return path.resolve(value);
}

export function createDiffEditingService(): DiffEditingService {
  return new DiffEditingService({
    tokens: new DiffEditTokenRegistry(),
    drafts: new DiffDraftService(),
    writer: new DiffAtomicWriterService(),
    isDocumentDirty: async (targetPath: string): Promise<boolean> => {
      const resolved = resolvePath(targetPath);
      return vscode.workspace.textDocuments.some(
        (document) =>
          !document.isClosed &&
          document.uri.scheme === "file" &&
          resolvePath(document.uri.fsPath) === resolved &&
          document.isDirty,
      );
    },
    freshness: async (targetPath: string): Promise<DiffTargetFreshness> => {
      try {
        const stat = await fs.lstat(targetPath);
        const bytes = await fs.readFile(targetPath);
        const real = await fs.realpath(targetPath);
        return {
          exists: true,
          isRegularFile: stat.isFile(),
          realPath: real,
          rawHash: hashBytes(bytes),
          sizeBytes: bytes.byteLength,
        };
      } catch {
        return {
          exists: false,
          isRegularFile: false,
          realPath: targetPath,
          rawHash: "",
          sizeBytes: 0,
        };
      }
    },
    readBytes: async (targetPath: string) => fs.readFile(targetPath),
  });
}
