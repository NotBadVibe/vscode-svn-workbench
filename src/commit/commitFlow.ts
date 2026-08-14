import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { parseStatusXml } from "../svn/parsers/statusXmlParser";
import { SvnCommandResult, SvnStatusItem } from "../svn/svnTypes";

export interface CommitFlowPlan {
  cwd: string;
  commitPaths: string[];
  addPaths: string[];
  removePaths: string[];
  message: string;
}

export interface CommitFlowResult {
  addResults: SvnCommandResult[];
  removeResults: SvnCommandResult[];
  commitResult: SvnCommandResult;
  revision?: string;
}

export async function runCommitFlow(
  svnPath: string,
  plan: CommitFlowPlan,
  options: { signal?: AbortSignal } = {},
): Promise<CommitFlowResult> {
  const addResults: SvnCommandResult[] = [];
  const removeResults: SvnCommandResult[] = [];
  const messageDir = await getCommitMessageTempDir();
  const messageFile = path.join(
    messageDir,
    `svn-workbench-commit-${randomUUID()}.txt`,
  );
  const requiresWindowsUnicodeFallback =
    process.platform === "win32" && plan.commitPaths.some(containsNonAscii);

  try {
    if (
      requiresWindowsUnicodeFallback &&
      [...plan.addPaths, ...plan.removePaths].some(containsNonAscii)
    ) {
      throw new Error(
        "当前 Windows SVN CLI 无法安全调度新增或删除的中文路径；请先使用支持 Unicode 参数的 SVN 客户端完成 add/remove。",
      );
    }

    for (const addPath of plan.addPaths) {
      const result = await runSvnCommand(
        svnPath,
        ["add", addPath],
        plan.cwd,
        options,
      );
      addResults.push(result);
      throwIfFailed(result, `svn add failed for ${addPath}`);
    }

    for (const removePath of plan.removePaths) {
      const result = await runSvnCommand(
        svnPath,
        ["remove", removePath],
        plan.cwd,
        options,
      );
      removeResults.push(result);
      throwIfFailed(result, `svn remove failed for ${removePath}`);
    }

    const commitPaths = requiresWindowsUnicodeFallback
      ? await resolveSafeWindowsUnicodeCommitTargets(svnPath, plan, options)
      : plan.commitPaths;
    await fs.writeFile(
      messageFile,
      normalizeCommitMessage(plan.message),
      "utf8",
    );
    const commitResult = await runSvnCommand(
      svnPath,
      ["commit", ...commitPaths, "-F", messageFile, "--encoding", "utf-8"],
      plan.cwd,
      options,
    );
    return {
      addResults,
      removeResults,
      commitResult,
      revision: parseCommittedRevision(commitResult.stdout),
    };
  } finally {
    await fs.rm(messageFile, { force: true });
  }
}

export function parseCommittedRevision(output: string): string | undefined {
  const englishRevision = /Committed revision\s+(\d+)/i.exec(output)?.[1];
  if (englishRevision) {
    return englishRevision;
  }

  // Some Windows SVN distributions ignore locale overrides and write their
  // localized summary using the native code page. The final summary line still
  // keeps the decimal revision in ASCII, even if surrounding text is garbled
  // when captured as UTF-8.
  const finalLine = output.trimEnd().split(/\r?\n/).at(-1);
  return finalLine ? /(?:^|\D)(\d+)\D*$/.exec(finalLine)?.[1] : undefined;
}

async function resolveSafeWindowsUnicodeCommitTargets(
  svnPath: string,
  plan: CommitFlowPlan,
  options: { signal?: AbortSignal },
): Promise<string[]> {
  const statusResult = await runSvnCommand(
    svnPath,
    ["status", "--xml", plan.cwd],
    plan.cwd,
    options,
  );
  throwIfFailed(statusResult, "无法验证中文路径提交范围。");

  const selectedPaths = new Set(
    plan.commitPaths.map((filePath) => normalizePathKey(filePath)),
  );
  const relevantItems = parseStatusXml(statusResult.stdout, plan.cwd).filter(
    isRootCommitRelevant,
  );
  const relevantPaths = new Set(
    relevantItems.map((item) => normalizePathKey(item.absolutePath)),
  );
  const outsideSelection = relevantItems.filter(
    (item) => !selectedPaths.has(normalizePathKey(item.absolutePath)),
  );
  const missingSelection = plan.commitPaths.filter(
    (item) => !relevantPaths.has(normalizePathKey(item)),
  );

  if (outsideSelection.length > 0 || missingSelection.length > 0) {
    const outsideSummary = outsideSelection
      .slice(0, 3)
      .map((item) => item.relativePath)
      .join("、");
    const suffix =
      outsideSelection.length > 3 ? ` 等 ${outsideSelection.length} 项` : "";
    throw new Error(
      `当前 Windows SVN CLI 不能直接传递中文路径，且工作副本根范围包含未选中的可提交变更${outsideSummary ? `：${outsideSummary}${suffix}` : ""}。` +
        "为避免误提交，请选择当前工作副本的全部可提交变更，或配置支持 Unicode 参数的 SVN CLI。",
    );
  }

  return [path.resolve(plan.cwd)];
}

function isRootCommitRelevant(item: SvnStatusItem): boolean {
  const relevant = new Set([
    "modified",
    "added",
    "deleted",
    "missing",
    "conflicted",
    "replaced",
  ]);
  return (
    relevant.has(item.status) ||
    (item.propStatus !== undefined && relevant.has(item.propStatus))
  );
}

function containsNonAscii(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) > 0x7f);
}

function throwIfFailed(
  result: SvnCommandResult,
  fallbackMessage: string,
): void {
  if (result.exitCode === 0) {
    return;
  }

  throw new Error(result.stderr || fallbackMessage);
}

function normalizeCommitMessage(message: string): string {
  return message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function getCommitMessageTempDir(): Promise<string> {
  if (process.platform !== "win32") {
    return os.tmpdir();
  }

  // SlikSVN can fail to read -F files under non-ASCII user temp paths.
  const publicDir = process.env.PUBLIC || "C:\\Users\\Public";
  const messageDir = path.join(publicDir, "SVNWorkbench", "Temp");
  await fs.mkdir(messageDir, { recursive: true });
  return messageDir;
}
