import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { collectCommitCandidates } from "../../src/commit/commitCandidateCollector";
import { SvnSourceControlManager } from "../../src/scm/svnSourceControlManager";

/*
 * v0.0.7 §6.2 SCM 重构回归：项目级 provider、同一工作副本共享一次采集
 * 并按项目根切片、未加载兄弟目录不进入项目、嵌套工作副本保留独立
 * provider、单工作副本失败不影响其他工作副本恢复。
 */

type Candidates = Awaited<ReturnType<typeof collectCommitCandidates>>;

let tempRoot: string;
let manager: SvnSourceControlManager | undefined;

const candidate = (absolutePath: string, status: string): Candidates[number] =>
  ({
    absolutePath,
    relativePath: path.basename(absolutePath),
    status,
  }) as Candidates[number];

async function makeWorkingCopyWithProjects(
  projects: string[],
): Promise<{ wcRoot: string; folders: string[] }> {
  const wcRoot = path.join(
    tempRoot,
    `wc-${projects.length}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await fs.mkdir(path.join(wcRoot, ".svn"), { recursive: true });
  const folders: string[] = [];
  for (const project of projects) {
    const folder = path.join(wcRoot, project);
    await fs.mkdir(folder, { recursive: true });
    folders.push(folder);
  }
  return { wcRoot, folders };
}

function setWorkspaceFolders(folders: string[]): void {
  (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders =
    folders.map((folder, index) => ({
      uri: { fsPath: folder },
      name: path.basename(folder),
      index,
    }));
}

function createManager(
  collect: typeof SvnSourceControlManager.prototype extends never
    ? never
    : (
        svnPath: string,
        scope: unknown,
        options?: unknown,
      ) => Promise<Candidates>,
): SvnSourceControlManager {
  return new SvnSourceControlManager(
    async () => "svn",
    undefined,
    collect as never,
  );
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "svn-scm-test-"));
  vscode.__resetSourceControls();
});

afterEach(async () => {
  manager?.dispose();
  manager = undefined;
  (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders =
    undefined;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("SCM 项目级 provider（v0.0.7）", () => {
  it("同一工作副本的两个项目各自建立 provider 且只采集一次", async () => {
    const { wcRoot, folders } = await makeWorkingCopyWithProjects([
      "EmApi",
      "EMSystem-front-pro",
    ]);
    setWorkspaceFolders(folders);
    const collect = vi.fn(async () => [
      candidate(path.join(folders[0], "a.ts"), "modified"),
      candidate(path.join(folders[1], "b.ts"), "added"),
      candidate(path.join(wcRoot, "sibling", "c.ts"), "modified"),
    ]);
    manager = createManager(collect);
    await manager.initialize();

    expect(vscode.__sourceControls.map((item) => item.label)).toEqual([
      "SVN · EmApi",
      "SVN · EMSystem-front-pro",
    ]);
    // 同一工作副本只采集一次状态。
    expect(collect).toHaveBeenCalledTimes(1);
    const [emApi, emSystem] = vscode.__sourceControls;
    // 项目切片：各自只含项目内候选，未加载兄弟目录不进入任何项目。
    expect(emApi.count).toBe(1);
    expect(emApi.groups.get("changes")?.resourceStates).toHaveLength(1);
    expect(emSystem.count).toBe(1);
    expect(emSystem.groups.get("changes")?.resourceStates).toHaveLength(1);
    // 冲突与未版本化分组正确拆分。
    expect(emApi.groups.get("conflicts")?.resourceStates).toHaveLength(0);
    expect(emSystem.groups.get("unversioned")?.resourceStates).toHaveLength(0);
  });

  it("项目级命令携带明确项目目标（folder URI）", async () => {
    const { folders } = await makeWorkingCopyWithProjects(["EmApi"]);
    setWorkspaceFolders(folders);
    manager = createManager(async () => []);
    await manager.initialize();

    const control = vscode.__sourceControls[0];
    expect(control.rootUri?.fsPath).toBe(folders[0]);
    const accept = control.acceptInputCommand as {
      command: string;
      arguments: unknown[];
    };
    expect(accept.command).toBe("svnWorkbench.commitFolder");
    expect((accept.arguments[0] as { fsPath: string }).fsPath).toBe(folders[0]);
  });

  it("非 SVN folder 不建立 provider", async () => {
    const plain = path.join(tempRoot, "plain");
    await fs.mkdir(plain, { recursive: true });
    setWorkspaceFolders([plain]);
    manager = createManager(async () => []);
    await manager.initialize();
    expect(vscode.__sourceControls).toHaveLength(0);
  });

  it("嵌套工作副本保留独立 provider 且不混入外层项目", async () => {
    const { folders } = await makeWorkingCopyWithProjects(["EmApi"]);
    const nested = path.join(folders[0], "vendor", "lib");
    await fs.mkdir(path.join(nested, ".svn"), { recursive: true });
    setWorkspaceFolders(folders);
    // findFiles 第一次（项目扫描）返回嵌套 wc.db。
    vscode.__findFilesResults.push([
      { fsPath: path.join(nested, ".svn", "wc.db") },
    ]);
    const collect = vi.fn(async (_svn: string, scope: unknown) => {
      const root = (scope as { repositoryRoot: string }).repositoryRoot;
      return root === nested
        ? [candidate(path.join(nested, "n.ts"), "modified")]
        : [candidate(path.join(folders[0], "a.ts"), "modified")];
    });
    manager = createManager(collect);
    await manager.initialize();

    expect(vscode.__sourceControls.map((item) => item.label)).toEqual([
      "SVN · EmApi",
      "SVN · lib",
    ]);
    // 外层项目与嵌套工作副本各自采集一次。
    expect(collect).toHaveBeenCalledTimes(2);
    const [project, nestedControl] = vscode.__sourceControls;
    expect(project.count).toBe(1);
    expect(nestedControl.count).toBe(1);
  });

  it("同名项目加入/移除时 provider 标签动态消歧与恢复", async () => {
    // 两个不同父目录下的同名 folder 分属两个工作副本。
    const first = await makeWorkingCopyWithProjects(["app"]);
    const collect = vi.fn(async () => []);
    setWorkspaceFolders([first.folders[0]]);
    manager = createManager(collect);
    await manager.initialize();
    expect(vscode.__sourceControls.map((item) => item.label)).toEqual([
      "SVN · app",
    ]);

    // 加入另一父目录的同名项目：两者都以父路径消歧（重建 provider）。
    const second = await makeWorkingCopyWithProjects(["app"]);
    setWorkspaceFolders([first.folders[0], second.folders[0]]);
    await manager.discoverRepositories();
    const disambiguated = vscode.__sourceControls.filter(
      (item) => !item.disposed && item.label.includes("/app"),
    );
    expect(disambiguated).toHaveLength(2);
    expect(
      vscode.__sourceControls.filter(
        (item) => !item.disposed && item.label === "SVN · app",
      ),
    ).toHaveLength(0);
    // 命令目标保持各自 folder URI。
    const commands = disambiguated.map(
      (item) =>
        (
          (item.acceptInputCommand as { arguments: unknown[] })
            .arguments[0] as { fsPath: string }
        ).fsPath,
    );
    expect(commands.sort()).toEqual(
      [first.folders[0], second.folders[0]].sort(),
    );

    // 移除后恢复简短标题。
    setWorkspaceFolders([first.folders[0]]);
    await manager.discoverRepositories();
    const active = vscode.__sourceControls.filter((item) => !item.disposed);
    expect(active.map((item) => item.label)).toEqual(["SVN · app"]);
  });

  it("单个工作副本采集失败不影响其他工作副本刷新恢复", async () => {
    const first = await makeWorkingCopyWithProjects(["Alpha"]);
    const second = await makeWorkingCopyWithProjects(["Beta"]);
    setWorkspaceFolders([first.folders[0], second.folders[0]]);
    let failFirst = true;
    const collect = vi.fn(async (_svn: string, scope: unknown) => {
      const root = (scope as { repositoryRoot: string }).repositoryRoot;
      if (root === first.wcRoot && failFirst) {
        throw new Error("svn: E155004 工作副本已锁定");
      }
      const folder =
        root === first.wcRoot ? first.folders[0] : second.folders[0];
      return [candidate(path.join(folder, "x.ts"), "modified")];
    });
    manager = createManager(collect);
    await manager.initialize();

    const [alpha, beta] = vscode.__sourceControls;
    // 失败的工作副本保留旧状态（空），其他工作副本正常刷新。
    expect(alpha.count).toBe(0);
    expect(beta.count).toBe(1);

    // 恢复后再次刷新成功。
    failFirst = false;
    await manager.refreshAll();
    expect(alpha.count).toBe(1);
    expect(beta.count).toBe(1);
  });
});
