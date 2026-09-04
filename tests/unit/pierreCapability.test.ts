import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * v0.1.0（V010-B）@pierre/diffs 能力矩阵的静态契约测试。
 *
 * 版本计划要求锁定安装版本 @pierre/diffs@1.3.4 并核对公共 API：
 * 已验证/受限/不可用/需后续实测逐项标记，未导出的能力不得写进生产计划，
 * 禁止按名称类推（VirtualizedUnresolvedFile 当前包不存在）。
 * 本测试以 dist 类型声明为权威来源，防止静默升级改变能力面而不被发现。
 */

const packageRoot = join(__dirname, "../../node_modules/@pierre/diffs");
const rootDts = readFileSync(join(packageRoot, "dist/index.d.ts"), "utf8");
const editDts = readFileSync(join(packageRoot, "dist/edit/index.d.ts"), "utf8");
const editorDts = readFileSync(
  join(packageRoot, "dist/editor/editor.d.ts"),
  "utf8",
);
const unresolvedDts = readFileSync(
  join(packageRoot, "dist/components/UnresolvedFile.d.ts"),
  "utf8",
);
const manifest = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as { version: string };
const projectManifest = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf8"),
) as { dependencies: Record<string, string> };

/** 根导出行（单行 re-export 列表）便于精确断言。 */
const rootExportNames = new Set(
  rootDts
    .split("\n")
    .find((line) => line.startsWith("export {"))
    ?.replace(/^export \{/, "")
    .replace(/ \};?$/, "")
    .split(",")
    .map((entry) => entry.trim().replace(/^type /, "")) ?? [],
);

describe("PierreCapabilityDecision（v0.1.0 V010-B）", () => {
  it("安装版本锁定为 1.3.4 且依赖声明不带范围符", () => {
    expect(manifest.version).toBe("1.3.4");
    expect(projectManifest.dependencies["@pierre/diffs"]).toBe("1.3.4");
  });

  it("已验证：生产在用的 FileDiff 与 Editor 公共 API 完整", () => {
    expect(rootExportNames.has("FileDiff")).toBe(true);
    expect(rootExportNames.has("parsePatchFiles")).toBe(true);
    expect(rootExportNames.has("preloadHighlighter")).toBe(true);
    expect(editDts).toContain("Editor");
    // Editor attach/cleanup、undo/redo、applyEdits、focus、状态持久化。
    expect(editorDts).toContain("edit<T extends DiffsEditableComponent");
    expect(editorDts).toContain("cleanUp(recycle?: boolean): void");
    expect(editorDts).toContain("undo(): void");
    expect(editorDts).toContain("redo(): void");
    expect(editorDts).toContain("applyEdits(edits: TextEdit[]");
    expect(editorDts).toContain("focus(options?: EditorFocusOptions): void");
    expect(editorDts).toContain("getState(): EditorState");
    expect(editorDts).toContain("persistState?: boolean");
  });

  it("已验证：UnresolvedFile 冲突编辑 API 存在（供 v0.1.1 spike）", () => {
    expect(rootExportNames.has("UnresolvedFile")).toBe(true);
    expect(unresolvedDts).toContain("mergeConflictActionsType?");
    expect(unresolvedDts).toContain("onMergeConflictAction?");
    expect(unresolvedDts).toContain("onMergeConflictResolve?");
    expect(unresolvedDts).toContain("resolveConflict(conflictIndex: number");
  });

  it("受限：VirtualizedFileDiff/ScrollSyncManager/CodeViewCoordinator 已导出，V018-B 只读 spike 实测后 no-go", () => {
    expect(rootExportNames.has("VirtualizedFileDiff")).toBe(true);
    expect(rootExportNames.has("ScrollSyncManager")).toBe(true);
    expect(rootExportNames.has("CodeViewCoordinator")).toBe(true);
    // V018-B 结论（diffPerformancePolicy.ts）：虚拟化自动切换 no-go
    // （同条件首屏 5000 行 +59%、10000 行 +64%），默认保持 FileDiff。
    expect(rootExportNames.has("Virtualizer")).toBe(true);
  });

  it("V018-B：编辑态虚拟化风险有代码证据（专属布局失效 API 存在）", () => {
    const virtualizedDts = readFileSync(
      join(packageRoot, "dist/components/VirtualizedFileDiff.d.ts"),
      "utf8",
    );
    // 官方承认编辑态虚拟化有布局失效面：有不兼容证据即不启用编辑态虚拟化。
    expect(virtualizedDts).toContain("invalidateEditSessionLayout");
    // 构造器需自供 virtualizer（+可选 metrics/workerManager），非零成本接入。
    expect(virtualizedDts).toMatch(/constructor\([^)]*virtualizer/);
  });

  it("V018-B：Worker 需自供 workerFactory（包内无默认，启用即改 CSP）", () => {
    const workerTypesDts = readFileSync(
      join(packageRoot, "dist/worker/types.d.ts"),
      "utf8",
    );
    expect(workerTypesDts).toContain("workerFactory");
  });

  it("不可用：VirtualizedUnresolvedFile 不存在，WorkerPoolManager 未从包根导出", () => {
    expect(rootExportNames.has("VirtualizedUnresolvedFile")).toBe(false);
    expect(rootExportNames.has("WorkerPoolManager")).toBe(false);
  });
});
