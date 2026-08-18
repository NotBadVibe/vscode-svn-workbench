import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import {
  collectLimitedCommitDiffs,
  readWorkingCopyRevision,
} from "../../src/commit/commitDiffCollector";
import { hashText } from "../../src/commit/commitDiffEvidence";

const root = path.resolve("/repo/code");
const scope: OperationScope = {
  id: "s",
  repositoryRoot: root,
  source: "explorerFolder",
  roots: [{ absolutePath: root, relativePath: ".", kind: "folder" }],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};

const candidateRefs = (names: string[]) =>
  names.map((name) => ({
    absolutePath: path.join(root, name),
    relativePath: name,
    status: "modified",
    projectRelativePath: `app/${name}`,
  }));

beforeEach(() => {
  runSvnCommand.mockReset();
});

describe("collectLimitedCommitDiffs（受限差异采集 IO 薄层）", () => {
  it("采集正常差异：脱敏、hash、覆盖率与 revision", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "@@ -1,1 +1,2 @@\n 第 1 行\n+新增配置\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "42",
        stderr: "",
      });
    const result = await collectLimitedCommitDiffs({
      svnPath: "svn",
      scope,
      selectedPaths: [path.join(root, "a.ts")],
      candidates: candidateRefs(["a.ts"]),
      perFileBudget: 6000,
      totalBudget: 40000,
    });
    expect(result.fragments).toHaveLength(1);
    const fragment = result.fragments[0];
    expect(fragment.projectRelativePath).toBe("app/a.ts");
    expect(fragment.content).toContain("+新增配置");
    expect(fragment.hunks).toHaveLength(1);
    expect(fragment.hunks[0].header).toBe("@@ -1,1 +1,2 @@");
    expect(fragment.diffHash).toBe(hashText(fragment.content));
    expect(result.coverage[0].state).toBe("analyzed");
    expect(result.revision).toBe("42");
    expect(result.summary.total).toBe(1);
  });

  it("敏感信息在采集后被脱敏", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          "@@ -1,1 +1,1 @@\n+password: hunter2secret\n+key=sk-abcdefghijklmnop123456\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "42",
        stderr: "",
      });
    const result = await collectLimitedCommitDiffs({
      svnPath: "svn",
      scope,
      selectedPaths: [path.join(root, "a.ts")],
      candidates: candidateRefs(["a.ts"]),
      perFileBudget: 6000,
      totalBudget: 40000,
    });
    expect(result.fragments[0].content).not.toContain("hunter2secret");
    expect(result.fragments[0].content).not.toContain(
      "sk-abcdefghijklmnop123456",
    );
    expect(result.fragments[0].content).toContain("[已脱敏]");
  });

  it("二进制与读取失败如实计入 coverage，不外发内容", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "Cannot display: file marked as a binary type.",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        truncated: false,
        stdout: "",
        stderr: "svn diff failed",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "42",
        stderr: "",
      });
    const result = await collectLimitedCommitDiffs({
      svnPath: "svn",
      scope,
      selectedPaths: [path.join(root, "bin.dat"), path.join(root, "broken.ts")],
      candidates: candidateRefs(["bin.dat", "broken.ts"]),
      perFileBudget: 6000,
      totalBudget: 40000,
    });
    expect(result.fragments).toHaveLength(0);
    expect(result.coverage[0].state).toBe("binary");
    expect(result.coverage[1].state).toBe("readFailed");
    expect(result.coverage[1].reason).toContain("svn diff failed");
  });

  it("越界路径与重复路径被排除，截断按单文件预算执行", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: `@@ -1,1 +1,1 @@\n${"x".repeat(200)}`,
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "42",
        stderr: "",
      });
    const result = await collectLimitedCommitDiffs({
      svnPath: "svn",
      scope,
      selectedPaths: [
        path.join(root, "a.ts"),
        path.join(root, "a.ts"),
        path.join(root, "..", "outside.ts"),
      ],
      candidates: candidateRefs(["a.ts", "outside.ts"]),
      perFileBudget: 100,
      totalBudget: 40000,
    });
    // 越界 + 重复 → 只采集 1 个文件，且被截断。
    expect(runSvnCommand).toHaveBeenCalledTimes(2);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].truncated).toBe(true);
    expect(result.coverage[0].state).toBe("truncated");
  });

  it("总预算超限后其余文件标记 budgetExcluded", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "@@ -1,1 +1,1 @@\n+aaaa\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "@@ -1,1 +1,1 @@\n+bbbb\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "42",
        stderr: "",
      });
    const result = await collectLimitedCommitDiffs({
      svnPath: "svn",
      scope,
      selectedPaths: [path.join(root, "a.ts"), path.join(root, "b.ts")],
      candidates: candidateRefs(["a.ts", "b.ts"]),
      perFileBudget: 6000,
      totalBudget: 30,
    });
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].projectRelativePath).toBe("app/a.ts");
    expect(result.coverage[1].state).toBe("budgetExcluded");
    expect(result.summary.budgetExcluded).toBe(1);
    expect(result.excludedCount).toBe(1);
  });

  it("候选缺失时回退相对路径展示且不崩溃", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "@@ -1,1 +1,1 @@\n+新增\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "42",
        stderr: "",
      });
    const result = await collectLimitedCommitDiffs({
      svnPath: "svn",
      scope,
      selectedPaths: [path.join(root, "ghost.ts")],
      candidates: [],
      perFileBudget: 6000,
      totalBudget: 40000,
    });
    expect(result.fragments).toHaveLength(1);
    expect(result.coverage[0].projectRelativePath).toContain("ghost.ts");
  });
});

describe("readWorkingCopyRevision", () => {
  it("读取成功返回 revision；失败返回 undefined", async () => {
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    });
    expect(await readWorkingCopyRevision("svn", scope)).toBe("42");

    runSvnCommand.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "not a working copy",
    });
    expect(await readWorkingCopyRevision("svn", scope)).toBeUndefined();
  });

  it("SVN 调用抛错时返回 undefined（保持页面可用）", async () => {
    runSvnCommand.mockRejectedValueOnce(new Error("svn missing"));
    expect(await readWorkingCopyRevision("svn", scope)).toBeUndefined();
  });
});
