import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  defaultWorkbenchTask,
  type WorkbenchModuleId,
  type WorkbenchTaskId,
} from "../../protocol/workbenchProtocol";
import type { OperationScope } from "../../scope/operationScope";
import type {
  OpenWorkbenchRequest,
  RevisionCompareRequest,
} from "./workbenchSession";

/**
 * 0.0.5 统一模块窗口路由纯逻辑（不依赖 vscode API，可单测）。
 *
 * 路由语义：
 * - 每个 WorkbenchController 只服务一个模块（servedModule）；
 * - 收到其他模块的打开或动作请求时，经窗口管理器路由到目标模块窗口（跨模块）；
 * - 未注入管理器回调时保持面板内切换模块的旧行为（单测与未接线环境兼容）；
 * - 独立 Diff 窗口只处理 diff 模块会话；同目标重复打开只 reveal。
 */

/**
 * 目标模块不属于当前控制器服务模块且已注入跨窗口路由回调时，转发给窗口管理器。
 */
export function shouldOpenInOtherWindow(
  moduleId: WorkbenchModuleId,
  servedModule: WorkbenchModuleId,
  onOpenInOtherWindow: unknown,
): boolean {
  return moduleId !== servedModule && typeof onOpenInOtherWindow === "function";
}

/** 控制器防御：收到非本模块会话请求且无管理器回调时拒绝。 */
export function assertServedModuleRequest(
  request: OpenWorkbenchRequest,
  servedModule: WorkbenchModuleId,
): void {
  if (request.moduleId !== servedModule) {
    throw new Error(
      `SVN 工作台 ${servedModule} 模块窗口仅处理 ${servedModule} 模块会话，请从对应模块入口打开其他模块。`,
    );
  }
}

/** 跨模块窗口会话请求：保留源窗口的模块、任务、范围与所选路径。 */
export function buildCrossModuleWindowRequest(input: {
  moduleId: WorkbenchModuleId;
  taskId: WorkbenchTaskId;
  svnPath: string;
  scope: OperationScope;
  selectedPaths?: string[];
}): OpenWorkbenchRequest {
  return {
    moduleId: input.moduleId,
    taskId: input.taskId,
    svnPath: input.svnPath,
    scope: input.scope,
    selectedPaths: input.selectedPaths,
  };
}

/** 转发给独立 Diff 窗口的会话请求（工作副本差异或修订比较）。 */
export function buildDiffWindowRequest(input: {
  svnPath: string;
  scope: OperationScope;
  targetFile?: string;
  revisionCompare?: RevisionCompareRequest;
}): OpenWorkbenchRequest {
  return {
    moduleId: "diff",
    taskId: defaultWorkbenchTask("diff"),
    svnPath: input.svnPath,
    scope: input.scope,
    targetFile: input.targetFile,
    revisionCompare: input.revisionCompare,
  };
}

export type DiffOpenMode = "sameGroup" | "beside";

/** 非法或缺失配置必须安全回退到默认同组模式。 */
export function normalizeDiffOpenMode(value: unknown): DiffOpenMode {
  return value === "beside" ? "beside" : "sameGroup";
}

/**
 * 面板 reveal 目标：非 Diff 模块保持原有第一栏行为；Diff 按配置在当前组或旁组打开。
 * 这些入口均由用户显式触发，因此目标标签需要激活；后台模块刷新不会调用 reveal。
 */
export function workbenchRevealTarget(
  isDiffWindow: boolean,
  diffOpenMode: DiffOpenMode = "sameGroup",
): {
  viewColumn: "one" | "active" | "beside";
  preserveFocus: boolean;
} {
  if (!isDiffWindow) return { viewColumn: "one", preserveFocus: false };
  return {
    viewColumn: diffOpenMode === "beside" ? "beside" : "active",
    preserveFocus: false,
  };
}

/**
 * Diff 目标只在 Host 内判等；摘要不进入 Webview、URI 或日志。
 * 同目标再次显式打开时仅 reveal，避免重新初始化破坏阅读位置。
 */
export function buildDiffTargetKey(request: OpenWorkbenchRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        repositoryRoot: path.resolve(request.scope.repositoryRoot),
        roots: request.scope.roots
          .map((root) => path.resolve(root.absolutePath))
          .sort((left, right) => left.localeCompare(right)),
        targetFile: request.targetFile
          ? path.resolve(request.targetFile)
          : undefined,
        revisions: request.revisionCompare?.revisions,
      }),
    )
    .digest("hex");
}

/** 修订比较统一按升序排列，保证“旧修订 → 新修订”的展示语义。 */
export function orderRevisionPair(
  revisions: readonly string[],
): [string, string] {
  const [first = "", second = ""] = [...revisions].sort(
    (left, right) => Number(left) - Number(right),
  );
  return [first, second];
}
