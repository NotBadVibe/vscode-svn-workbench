/**
 * 提交选择规则变化后的 Host 侧失效处理（v0.0.3 阶段 2，阶段 4 补充）。
 *
 * 规则来源（VS Code 配置 / .svn-workbench.json / 仓库集合）变化时，旧的提交
 * 预览与 AI 选择结果基于旧规则得出，必须清除；用户已手动确认的提交篮选择
 * （selectedPaths）不被动静（规划 7.4：不能静默重置用户已手动确认的提交篮）。
 * 阶段 4 补充：提交页给出“规则已更新，可应用本地规则重新计算”的一次性反馈；
 * 基于旧分类的 AI 拆分建议（Changelist 建议缓存）同步失效，避免模块快照继续
 * 展示旧分类结果。本模块是不依赖 VS Code 的纯逻辑，便于单元测试；快照重建由
 * WorkbenchController 在调用本函数后负责。
 */

import * as path from "node:path";
import type { WorkbenchSession } from "./workbenchSession";

/**
 * 若失效事件适用于当前会话仓库，则清除旧提交预览与 AI 选择结果缓存。
 * 返回是否命中当前会话（命中时调用方应重建当前模块快照）。
 */
export function applyCommitSelectionRulesInvalidation(
  session: WorkbenchSession,
  invalidatedRepositoryRoot?: string,
): boolean {
  if (
    invalidatedRepositoryRoot &&
    normalizeRootKey(invalidatedRepositoryRoot) !==
      normalizeRootKey(session.scope.repositoryRoot)
  ) {
    return false;
  }
  if (session.commitState) {
    session.commitState.preview = undefined;
    session.commitState.ai = undefined;
    session.commitState.feedback = {
      tone: "warning",
      message:
        "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
    };
  }
  if (session.changelistState) {
    session.changelistState.suggestions = [];
    session.changelistState.preview = undefined;
    session.changelistState.feedback =
      "提交选择规则已更新，基于旧分类的拆分建议已失效，请重新获取拆分建议。";
  }
  return true;
}

function normalizeRootKey(repositoryRoot: string): string {
  const resolved = path.resolve(repositoryRoot);
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}
