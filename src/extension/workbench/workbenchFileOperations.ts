import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { collectCommitCandidates } from "../../commit/commitCandidateCollector";
import type {
  ChangesSnapshot,
  RepositorySnapshot,
  WorkbenchFileView,
} from "../../protocol/workbenchProtocol";
import type { OperationScope } from "../../scope/operationScope";
import { validatePathsInScope } from "../../scope/pathBoundaryGuard";
import { isSameOrDescendantPath } from "../../scope/pathIdentity";
import { nativePathSemantics } from "../../scope/nativePathSemantics";
import { createScopedFileKey } from "../../scope/projectIdentity";
import { appendOutput } from "../../diagnostics/outputChannel";
import { projectRelativePath } from "../../scope/projectIdentity";
import { toDisplayPath } from "../../scope/pathBrands";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { quoteRelative } from "./workbenchPresentation";

export type FileOperation = NonNullable<
  ChangesSnapshot["operationPreview"]
>["operation"];

export type AdvancedRepositoryOperation = NonNullable<
  RepositorySnapshot["advanced"]["preview"]
>["operation"];

export function asAdvancedRepositoryOperation(
  value: unknown,
): AdvancedRepositoryOperation | undefined {
  return value === "branch" ||
    value === "tag" ||
    value === "switch" ||
    value === "relocate" ||
    value === "merge" ||
    value === "apply-patch" ||
    value === "shelf"
    ? value
    : undefined;
}

export function stripUrlSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function repositoryParentUrl(
  value: string,
  repositoryRoot?: string,
): string | undefined {
  const current = stripUrlSlash(value);
  const root = repositoryRoot ? stripUrlSlash(repositoryRoot) : undefined;
  if (!current || current === root) return undefined;
  const slash = current.lastIndexOf("/");
  const parent =
    slash > current.indexOf("://") + 2 ? current.slice(0, slash) : undefined;
  if (!parent || (root && !parent.startsWith(root))) return undefined;
  return parent;
}

export function asFileOperation(value: unknown): FileOperation | undefined {
  return value === "add" ||
    value === "remove" ||
    value === "revert" ||
    value === "lock" ||
    value === "unlock" ||
    value === "ignore"
    ? value
    : undefined;
}

export function validateFileOperation(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  operation: FileOperation,
  relativePaths: string[],
  scope: OperationScope,
  ignoreMode: "directory" | "repository" = "directory",
): string[] {
  const issues: string[] = [];
  const byPath = new Map(candidates.map((item) => [item.relativePath, item]));
  if (relativePaths.length === 0) issues.push("请选择至少一个文件。");
  const absolutePaths = relativePaths.map((item) =>
    path.resolve(scope.repositoryRoot, item),
  );
  if (
    validatePathsInScope(scope, absolutePaths, nativePathSemantics)
      .outOfScopeItems.length > 0
  ) {
    issues.push("选择中包含当前右键范围外路径。");
  }
  for (const relativePath of relativePaths) {
    const candidate = byPath.get(relativePath);
    if (!candidate) {
      issues.push(`${relativePath} 状态已变化或不属于当前候选。`);
      continue;
    }
    const allowed =
      operation === "add" || operation === "ignore"
        ? candidate.status === "unversioned"
        : operation === "revert"
          ? ["modified", "added", "deleted", "missing", "replaced"].includes(
              candidate.status,
            )
          : operation === "remove"
            ? ["modified", "added", "replaced"].includes(candidate.status)
            : ![
                "unversioned",
                "added",
                "deleted",
                "missing",
                "conflicted",
              ].includes(candidate.status);
    if (!allowed) {
      issues.push(
        `${relativePath} 的 ${candidate.status} 状态不支持 ${operation}。`,
      );
    }
  }
  if (operation === "ignore") {
    if (ignoreMode === "repository") {
      const rootIsExplicitlySelected = scope.roots.some(
        (root) =>
          root.kind === "folder" &&
          path.resolve(root.absolutePath) ===
            path.resolve(scope.repositoryRoot),
      );
      if (!rootIsExplicitlySelected) {
        issues.push(
          "仓库继承忽略会修改根目录 svn:global-ignores；请从仓库根目录右键进入后再选择。",
        );
      }
    } else {
      const parents = absolutePaths.map((item) => path.dirname(item));
      if (
        validatePathsInScope(scope, parents, nativePathSemantics)
          .outOfScopeItems.length > 0
      ) {
        issues.push(
          "目录忽略会修改父目录 svn:ignore，但父目录不在当前操作范围内。请从父目录右键进入。",
        );
      }
    }
  }
  return [...new Set(issues)];
}

export function buildFileOperationArgs(
  operation: Exclude<FileOperation, "ignore">,
  absolutePaths: string[],
): string[] {
  if (operation === "add") return ["add", ...absolutePaths];
  if (operation === "remove") return ["delete", "--force", ...absolutePaths];
  if (operation === "revert") {
    return ["revert", "--depth", "empty", ...absolutePaths];
  }
  if (operation === "lock") return ["lock", ...absolutePaths];
  return ["unlock", ...absolutePaths];
}

export function formatFileOperationCommand(
  operation: FileOperation,
  relativePaths: string[],
  ignoreMode?: "directory" | "repository",
): string {
  const paths = relativePaths.map(quoteRelative).join(" ");
  if (operation === "ignore") {
    return ignoreMode === "repository"
      ? `svn propset svn:global-ignores <preserved-patterns+names> <repository-root>  # ${paths}`
      : `svn propset svn:ignore <preserved-rules+names> <parent-directories>  # ${paths}`;
  }
  return `svn ${buildFileOperationArgs(operation, []).join(" ")} ${paths}`
    .replace(/\s+/g, " ")
    .trim();
}

export function fileOperationConsequences(
  operation: FileOperation,
  ignoreMode?: "directory" | "repository",
): string[] {
  const values: Record<FileOperation, string[]> = {
    add: ["把未版本化文件加入 SVN 调度；不会自动提交。"],
    remove: ["删除工作副本中的文件并调度 SVN Delete；提交后仓库才会生效。"],
    revert: ["丢弃尚未提交的本地变更；此操作通常无法从 SVN 恢复。"],
    lock: ["向仓库申请文件锁；可能需要网络与认证。"],
    unlock: ["释放仓库文件锁；其他成员随后可以获得锁。"],
    ignore:
      ignoreMode === "repository"
        ? [
            "保留根目录现有 svn:global-ignores，并追加所选文件名；规则会由子目录继承，可能影响仓库内同名文件。",
          ]
        : ["保留父目录现有 svn:ignore，并追加所选文件名；只影响对应目录。"],
  };
  return values[operation];
}

export function fileOperationRecoverability(operation: FileOperation): string {
  if (operation === "revert") {
    return "还原会直接丢弃未提交内容；SVN 无法恢复，执行前请自行导出补丁。";
  }
  if (operation === "remove") {
    return "提交前可以通过 SVN 还原恢复调度和文件；提交后需通过历史修订恢复。";
  }
  if (operation === "ignore") return "可以再次编辑对应 SVN 属性移除规则。";
  if (operation === "add") return "提交前可以还原调度，文件内容仍保留在本地。";
  return operation === "lock"
    ? "可以解锁文件来释放锁。"
    : "可以重新锁定文件，但锁可能已被其他成员获取。";
}

export async function buildWorkbenchFileViews(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  currentRepositoryName: string,
  scope: OperationScope,
): Promise<WorkbenchFileView[]> {
  const views = await Promise.all(
    candidates.map(async (candidate) => {
      let ownership: "current" | "external" | "nested" =
        candidate.status === "external" ? "external" : "current";
      if (
        candidate.status === "obstructed" ||
        candidate.fileType === "Folder"
      ) {
        try {
          if (
            (
              await fs.stat(path.join(candidate.absolutePath, ".svn"))
            ).isDirectory()
          ) {
            ownership = "nested";
          }
        } catch {
          // Ordinary files and directories remain owned by the current working copy.
        }
      }
      // v0.0.8：选择身份由 Host 在权威 working-copy + 路径归属上生成；
      // 无法建立身份是数据完整性异常，fail-closed 丢弃并记录。
      const selectionKey = createScopedFileKey(
        scope.repositoryRoot,
        candidate.absolutePath,
        nativePathSemantics,
      );
      if (selectionKey === undefined) {
        appendOutput(
          `无法为 ${candidate.relativePath} 建立选择身份，已从文件视图排除。`,
        );
        return undefined;
      }
      const view: WorkbenchFileView = {
        relativePath: candidate.relativePath,
        selectionKey,
        status: candidate.status,
        propStatus: candidate.propStatus,
        repositoryName:
          ownership === "current"
            ? currentRepositoryName
            : path.basename(candidate.absolutePath),
        ownership,
        fileType: candidate.fileType,
        selection: ownership === "current" ? candidate.selection : "blocked",
        reason:
          ownership === "nested"
            ? "嵌套工作副本：必须在其独立 SCM 仓库模型中操作。"
            : candidate.reason,
      };
      return withProjectFileView(view, candidate.absolutePath, scope);
    }),
  );
  return views.filter((view) => view !== undefined);
}

/**
 * v0.0.7：文件主路径默认显示项目内路径；仅当 scope 为用户明确建立的
 * 跨项目选择时附加项目徽标，单项目列表不逐行重复项目名。显示路径不
 * 得作为 Host 写操作身份（身份仍使用 relativePath + 工作副本身份）。
 */
export function withProjectFileView(
  view: WorkbenchFileView,
  absolutePath: string,
  scope: OperationScope,
): WorkbenchFileView {
  const projects = scope.projects;
  const multiProject = projects !== undefined && projects.length > 1;
  const owner = multiProject
    ? (projects.find((project) =>
        isSameOrDescendantPath(
          absolutePath,
          project.projectRoot,
          nativePathSemantics,
        ),
      ) ?? scope.project)
    : scope.project;
  if (!owner) return view;
  const display = projectRelativePath(
    owner.projectRoot,
    absolutePath,
    nativePathSemantics,
  );
  return {
    ...view,
    // 展示边界显式转换：协议展示字段不接受 identity 键。
    projectRelativePath:
      display === undefined || display === "."
        ? undefined
        : toDisplayPath(display),
    projectName: multiProject ? owner.projectName : undefined,
  };
}

export function fileOperationSuccess(
  operation: FileOperation,
  count: number,
): string {
  const labels: Record<FileOperation, string> = {
    add: "加入版本控制",
    remove: "调度删除",
    revert: "还原",
    lock: "加锁",
    unlock: "解锁",
    ignore: "加入忽略规则",
  };
  return `${count} 个文件已${labels[operation]}。请刷新并确认最新 SVN 状态。`;
}

export async function applyIgnoreOperation(
  svnPath: string,
  scope: OperationScope,
  relativePaths: string[],
  ignoreMode: "directory" | "repository",
) {
  const byParent = new Map<string, string[]>();
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(scope.repositoryRoot, relativePath);
    const parent =
      ignoreMode === "repository"
        ? scope.repositoryRoot
        : path.dirname(absolutePath);
    byParent.set(parent, [
      ...(byParent.get(parent) ?? []),
      path.basename(absolutePath),
    ]);
  }
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "svn-workbench-ignore-"),
  );
  let finalResult: Awaited<ReturnType<typeof runSvnCommand>> | undefined;
  try {
    let index = 0;
    for (const [parent, names] of byParent) {
      const propertyName =
        ignoreMode === "repository" ? "svn:global-ignores" : "svn:ignore";
      const existing = await runSvnCommand(
        svnPath,
        ["propget", propertyName, parent],
        scope.repositoryRoot,
      );
      const rules = existing.stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      const next = [...new Set([...rules, ...names])].join("\n") + "\n";
      const rulesFile = path.join(tempDirectory, `rules-${index++}.txt`);
      await fs.writeFile(rulesFile, next, { encoding: "utf8", mode: 0o600 });
      finalResult = await runSvnCommand(
        svnPath,
        ["propset", propertyName, "--file", rulesFile, parent],
        scope.repositoryRoot,
      );
      if (finalResult.exitCode !== 0) return finalResult;
    }
    if (!finalResult) throw new Error("没有可应用的忽略规则。");
    return finalResult;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}
