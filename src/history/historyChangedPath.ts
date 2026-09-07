/*
 * V021-R17 历史变更路径直达该次修改（纯函数，Host/Webview/单测语义一致）。
 *
 * - SVN changed path 为仓库根相对路径（如 `/trunk/a.ts`），工作副本可能只
 *   检出子目录；到工作副本相对路径的映射只能经“仓库根 URL + 工作副本根
 *   检出 URL”推导，禁止把路径标签当作本地路径；
 * - 四类变更分别建模左右内容来源：新增（空 → 新内容）、删除（旧内容 → 空）、
 *   修改（上一修订 → 本修订）、复制（复制来源 @ 来源修订 → 本修订，可解释来源）；
 * - 本模块不接触文件系统与平台路径 API，断言平台无关；范围复验仍由 Host
 *   经 validatePathsInScope 完成。
 */

export interface ChangedPathSide {
  /** 空侧不读取任何内容；修订侧经仓库 URL 以 peg revision 只读读取。 */
  kind: "empty" | "revision";
  /** 修订侧的 peg revision（如 "11"）。 */
  revision?: string;
  /** 修订侧的仓库根相对路径（如 "/trunk/a.ts"）。 */
  reposPath?: string;
}

export interface ChangedPathDiffPlan {
  left: ChangedPathSide;
  right: ChangedPathSide;
  /** 左基线展示（如 "r11"、"（空）"、"复制来源 r9"）。 */
  leftRevision?: string;
  /** 右基线展示（如 "r12"、"（空）"）。 */
  rightRevision?: string;
  /** 复制来源说明（如 "复制自 /trunk/a.ts@r9"），缺省表示非复制。 */
  sourceNote?: string;
  /** 变更动作中文标签（新增/删除/修改/替换）。 */
  actionLabel: string;
}

const REVISION_PATTERN = /^[1-9]\d*$/;

export function isHistoryRevisionParam(value: unknown): value is string {
  return typeof value === "string" && REVISION_PATTERN.test(value);
}

/** 上一修订；初始修订（r1）无上一版本，返回 undefined（调用方如实拒绝）。 */
export function previousHistoryRevision(revision: string): string | undefined {
  if (!REVISION_PATTERN.test(revision)) return undefined;
  const previous = BigInt(revision) - 1n;
  return previous >= 1n ? String(previous) : undefined;
}

export function normalizeReposPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.length < 2) return undefined;
  return trimmed;
}

export function describeChangedPathAction(action: string): string {
  switch (action) {
    case "A":
      return "新增";
    case "D":
      return "删除";
    case "R":
      return "替换";
    case "M":
      return "修改";
    default:
      return "修改";
  }
}

function normalizeCopySource(
  copyFromPath: unknown,
  copyFromRevision: unknown,
): { reposPath: string; revision: string } | undefined {
  const reposPath = normalizeReposPath(copyFromPath);
  if (!reposPath) return undefined;
  if (!isHistoryRevisionParam(copyFromRevision)) return undefined;
  return { reposPath, revision: copyFromRevision };
}

/**
 * 四类变更内容规划（以 SVN 真实 changed path 记录为输入，Webview 不可信）：
 * - A（无复制信息）：空 → 本修订；
 * - A（有复制来源）：复制来源 @ 来源修订 → 本修订，并给出可解释来源；
 * - D：上一修订 → 空；
 * - M/R/其他：上一修订 → 本修订（R 携带复制信息时同样注明来源）。
 * 输入非法时返回中文原因，调用方 fail-closed（不猜测、不读取）。
 */
export function buildChangedPathDiffPlan(input: {
  action: string;
  revision: string;
  reposPath: string;
  copyFromPath?: string;
  copyFromRevision?: string;
}): { ok: true; plan: ChangedPathDiffPlan } | { ok: false; message: string } {
  if (!isHistoryRevisionParam(input.revision)) {
    return { ok: false, message: "修订号非法，请刷新历史后重试。" };
  }
  const reposPath = normalizeReposPath(input.reposPath);
  if (!reposPath) {
    return { ok: false, message: "变更路径非法，请刷新历史后重试。" };
  }
  const actionLabel = describeChangedPathAction(input.action);
  const copySource = normalizeCopySource(
    input.copyFromPath,
    input.copyFromRevision,
  );
  if (input.action === "A") {
    if (copySource) {
      return {
        ok: true,
        plan: {
          left: {
            kind: "revision",
            revision: copySource.revision,
            reposPath: copySource.reposPath,
          },
          right: { kind: "revision", revision: input.revision, reposPath },
          leftRevision: `复制来源 r${copySource.revision}`,
          rightRevision: `r${input.revision}`,
          sourceNote: `复制自 ${copySource.reposPath}@r${copySource.revision}`,
          actionLabel,
        },
      };
    }
    return {
      ok: true,
      plan: {
        left: { kind: "empty" },
        right: { kind: "revision", revision: input.revision, reposPath },
        leftRevision: "（空）",
        rightRevision: `r${input.revision}`,
        actionLabel,
      },
    };
  }
  const previous = previousHistoryRevision(input.revision);
  if (!previous) {
    return {
      ok: false,
      message: `r${input.revision}没有上一修订内容，无法构建该次修改的差异。`,
    };
  }
  if (input.action === "D") {
    return {
      ok: true,
      plan: {
        left: { kind: "revision", revision: previous, reposPath },
        right: { kind: "empty" },
        leftRevision: `r${previous}`,
        rightRevision: "（空）",
        actionLabel,
      },
    };
  }
  return {
    ok: true,
    plan: {
      left: { kind: "revision", revision: previous, reposPath },
      right: { kind: "revision", revision: input.revision, reposPath },
      leftRevision: `r${previous}`,
      rightRevision: `r${input.revision}`,
      sourceNote: copySource
        ? `复制自 ${copySource.reposPath}@r${copySource.revision}`
        : undefined,
      actionLabel,
    },
  };
}

/**
 * 仓库根相对路径 → 工作副本相对路径（纯字符串推导，平台无关）。
 * 工作副本根检出 URL 必须位于仓库根 URL 之下，否则返回 undefined
 * （如实缺省，不猜测）；URL 缺失时退化为去前导 "/"（仍须经 Host 范围复验）。
 * 映射结果为空串表示变更目标即工作副本根目录（目录变更，无单文件内容）。
 */
export function mapReposPathToWorkingCopyRelative(
  reposPath: string,
  repositoryRootUrl?: string,
  workingCopyUrl?: string,
): string | undefined {
  const normalized = normalizeReposPath(reposPath);
  if (!normalized) return undefined;
  const stripped = normalized.slice(1);
  if (!repositoryRootUrl || !workingCopyUrl) return stripped;
  const root = repositoryRootUrl.replace(/\/+$/, "");
  const wcUrl = workingCopyUrl.replace(/\/+$/, "");
  let wcPart: string;
  if (wcUrl === root) {
    wcPart = "";
  } else if (wcUrl.startsWith(`${root}/`)) {
    try {
      wcPart = decodeURIComponent(wcUrl.slice(root.length + 1));
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }
  if (wcPart === "") return stripped;
  if (stripped === wcPart) return "";
  if (stripped.startsWith(`${wcPart}/`)) {
    return stripped.slice(wcPart.length + 1);
  }
  return undefined;
}
