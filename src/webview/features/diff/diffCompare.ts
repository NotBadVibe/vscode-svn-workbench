import type {
  DiffCompareKind,
  DiffSnapshot,
} from "@protocol/workbenchProtocol";
import { isDiffCompareView } from "@protocol/workbenchProtocol";
import { diffCompareLabels } from "../../i18n/terminology";

/**
 * V020-R09：Diff 展示身份解析（纯函数，Host/Webview/Mock 语义一致）。
 *
 * - compare 合法时直接采用（targetPath 缺省即无路径操作）；
 * - 旧快照缺省行为保守：language 为 diff 视为 revision-patch（只读、
 *   无路径操作），其余视为 working-copy（沿用 relativePath 真实路径）；
 * - 非法 compare（守卫拒绝）同样 fail-closed 为只读无路径操作。
 */
export interface ResolvedDiffCompare {
  kind: DiffCompareKind;
  /** 标题行主文本：真实单文件路径，或范围比较标题。 */
  heading: string;
  /** 标题行基线文本：如“BASE ↔ 工作副本”、 “r41 → r42（只读）”。 */
  baseline: string;
  /** 真实单文件相对路径；缺省时调用方不得发起任何路径操作。 */
  targetPath?: string;
  /** 历史比较（双侧只读）：隐藏编辑/提交/本地路径操作。 */
  isReadOnly: boolean;
  /** 是否允许本地文件动作（仅 working-copy 且有真实路径时）。 */
  showLocalActions: boolean;
  /** 是否允许复制路径（需真实单文件身份且内容可用）。 */
  showPathCopy: boolean;
}

function isUsableContent(snapshot: DiffSnapshot): boolean {
  return (
    !snapshot.binary && !snapshot.truncated && snapshot.modified.length > 0
  );
}

export function resolveDiffCompare(
  snapshot: DiffSnapshot,
): ResolvedDiffCompare {
  const compare = snapshot.compare;
  if (compare !== undefined && !isDiffCompareView(compare)) {
    // 非法 compare：fail-closed 为只读、无路径操作。
    return {
      kind: "revision-patch",
      heading: snapshot.relativePath,
      baseline: diffCompareLabels.readOnlyBaseline,
      targetPath: undefined,
      isReadOnly: true,
      showLocalActions: false,
      showPathCopy: false,
    };
  }
  if (compare !== undefined && isDiffCompareView(compare)) {
    const usable = isUsableContent(snapshot);
    const hasTarget =
      typeof compare.targetPath === "string" && compare.targetPath.length > 0;
    if (compare.kind === "working-copy") {
      const targetPath =
        compare.targetPath && compare.targetPath.length > 0
          ? compare.targetPath
          : snapshot.relativePath;
      return {
        kind: "working-copy",
        heading: targetPath,
        baseline: diffCompareLabels.workingCopyBaseline(snapshot.language),
        targetPath,
        isReadOnly: false,
        showLocalActions: true,
        showPathCopy: true,
      };
    }
    if (compare.kind === "revision-file") {
      const targetPath =
        hasTarget && usable && compare.targetPath
          ? compare.targetPath
          : undefined;
      return {
        kind: "revision-file",
        heading: compare.title,
        baseline: diffCompareLabels.revisionBaseline(
          compare.leftRevision,
          compare.rightRevision,
        ),
        targetPath,
        isReadOnly: true,
        showLocalActions: false,
        showPathCopy: targetPath !== undefined,
      };
    }
    return {
      kind: "revision-patch",
      heading: compare.title,
      baseline: diffCompareLabels.revisionBaseline(
        compare.leftRevision,
        compare.rightRevision,
      ),
      targetPath: undefined,
      isReadOnly: true,
      showLocalActions: false,
      showPathCopy: false,
    };
  }
  // 无 compare 的旧快照：保守派生。
  if (snapshot.language === "diff") {
    return {
      kind: "revision-patch",
      // 旧 composite 标题仅作展示文本（无 targetPath，不产生路径操作）。
      heading: snapshot.relativePath,
      baseline: diffCompareLabels.readOnlyBaseline,
      targetPath: undefined,
      isReadOnly: true,
      showLocalActions: false,
      showPathCopy: false,
    };
  }
  return {
    kind: "working-copy",
    heading: snapshot.relativePath,
    baseline: diffCompareLabels.workingCopyBaseline(snapshot.language),
    targetPath: snapshot.relativePath,
    isReadOnly: false,
    showLocalActions: true,
    showPathCopy: true,
  };
}
