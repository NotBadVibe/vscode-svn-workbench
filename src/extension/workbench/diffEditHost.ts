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
    // token 绑定真实 TextDocument.version；无打开文档时为 -1。
    getDocumentVersion: async (targetPath: string): Promise<number> => {
      const resolved = resolvePath(targetPath);
      const document = vscode.workspace.textDocuments.find(
        (candidate) =>
          !candidate.isClosed &&
          candidate.uri.scheme === "file" &&
          resolvePath(candidate.uri.fsPath) === resolved,
      );
      return document ? document.version : -1;
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

/**
 * 文档与磁盘变化监听：任何相关变化立即使对应目标的 editToken 失效
 * （v0.0.6 写入安全契约 §5.4）。保存路径仍有磁盘 hash 复验作为最终防线，
 * 监听负责“立即失效”一侧。返回的 Disposable 随控制器释放。
 */
export function watchDiffEditTargets(
  service: DiffEditingService,
): vscode.Disposable {
  const revokeUri = (uri: vscode.Uri): void => {
    if (uri.scheme !== "file") return;
    service.revokeForPath(resolvePath(uri.fsPath));
  };
  const disposables: vscode.Disposable[] = [
    // TextDocument 内容变化（含变脏）、保存、重命名、删除。
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0) revokeUri(event.document.uri);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      revokeUri(document.uri);
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      for (const file of event.files) {
        revokeUri(file.oldUri);
        revokeUri(file.newUri);
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) revokeUri(uri);
    }),
  ];
  // 外部（非 VS Code）磁盘变化：工作区内文件 watcher。
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  disposables.push(
    watcher,
    watcher.onDidChange(revokeUri),
    watcher.onDidCreate(revokeUri),
    watcher.onDidDelete(revokeUri),
  );
  return vscode.Disposable.from(...disposables);
}
