import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SvnCommandResult } from "../../src/svn/svnTypes";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import {
  parseCommittedRevision,
  runCommitFlow,
} from "../../src/commit/commitFlow";

const successfulResult = (
  overrides: Partial<SvnCommandResult> = {},
): SvnCommandResult => ({
  command: "svn",
  args: [],
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  ...overrides,
});

async function withPlatform<T>(
  platform: NodeJS.Platform,
  run: () => Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...original, value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", original!);
  }
}

beforeEach(() => {
  runSvnCommand.mockReset();
});

describe.sequential("提交执行链路", () => {
  it("解析英文、本地化和缺失的提交修订号", () => {
    expect(parseCommittedRevision("Committed revision 42.")).toBe("42");
    expect(parseCommittedRevision("提交已完成\n版本 301。\n")).toBe("301");
    expect(parseCommittedRevision("提交结果未知")).toBeUndefined();
    expect(parseCommittedRevision("")).toBeUndefined();
  });

  it("按 add、remove、commit 顺序执行，使用 UTF-8 消息文件并清理临时文件", async () => {
    const cwd = path.join(os.tmpdir(), "svn-workbench-commit-flow");
    let messageFile: string | undefined;
    let messageContent: string | undefined;
    runSvnCommand.mockImplementation(async (_svnPath, args) => {
      if (args[0] === "commit") {
        messageFile = args[args.indexOf("-F") + 1];
        messageContent = await fs.readFile(messageFile!, "utf8");
        return successfulResult({ stdout: "Committed revision 88.\n" });
      }
      return successfulResult();
    });

    const result = await runCommitFlow("svn", {
      cwd,
      addPaths: ["new file.txt"],
      removePaths: ["removed.txt"],
      commitPaths: ["new file.txt", "removed.txt", "changed.ts"],
      message: "feat: 提交说明\r\n第二行\r第三行",
    });

    expect(runSvnCommand.mock.calls.map((call) => call[1])).toEqual([
      ["add", "new file.txt"],
      ["remove", "removed.txt"],
      [
        "commit",
        "new file.txt",
        "removed.txt",
        "changed.ts",
        "-F",
        expect.any(String),
        "--encoding",
        "utf-8",
      ],
    ]);
    expect(messageContent).toBe("feat: 提交说明\n第二行\n第三行");
    expect(result.revision).toBe("88");
    await expect(fs.access(messageFile!)).rejects.toThrow();
  });

  it("add 失败时终止流程，且不会误执行后续 remove 或 commit", async () => {
    runSvnCommand.mockResolvedValue(
      successfulResult({ exitCode: 1, stderr: "add denied" }),
    );

    await expect(
      runCommitFlow("svn", {
        cwd: "/working-copy",
        addPaths: ["blocked.txt"],
        removePaths: ["should-not-run.txt"],
        commitPaths: ["blocked.txt"],
        message: "test: fail",
      }),
    ).rejects.toThrow("add denied");
    expect(runSvnCommand.mock.calls).toHaveLength(1);
    expect(runSvnCommand.mock.calls[0][1]).toEqual(["add", "blocked.txt"]);
  });

  it("Windows 中文路径只在完整安全范围内回退到工作副本根提交", async () => {
    const publicDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "svn-workbench-public-"),
    );
    const previousPublic = process.env.PUBLIC;
    process.env.PUBLIC = publicDir;
    const cwd = path.join(publicDir, "working-copy");
    try {
      await withPlatform("win32", async () => {
        runSvnCommand.mockImplementation(async (_svnPath, args) => {
          if (args[0] === "status") {
            return successfulResult({
              stdout:
                '<status><target path="."><entry path="中文.txt"><wc-status item="modified"/></entry></target></status>',
            });
          }
          return successfulResult({ stdout: "Committed revision 89.\n" });
        });

        const result = await runCommitFlow("svn", {
          cwd,
          addPaths: [],
          removePaths: [],
          commitPaths: [path.join(cwd, "中文.txt")],
          message: "fix: 中文路径",
        });

        expect(runSvnCommand.mock.calls.map((call) => call[1][0])).toEqual([
          "status",
          "commit",
        ]);
        expect(runSvnCommand.mock.calls[1][1]).toEqual([
          "commit",
          path.resolve(cwd),
          "-F",
          expect.stringContaining(path.join("SVNWorkbench", "Temp")),
          "--encoding",
          "utf-8",
        ]);
        expect(result.revision).toBe("89");
      });
    } finally {
      if (previousPublic === undefined) delete process.env.PUBLIC;
      else process.env.PUBLIC = previousPublic;
      await fs.rm(publicDir, { recursive: true, force: true });
    }
  });

  it("Windows 中文路径会拒绝不安全的 add/remove 和范围扩张", async () => {
    const publicDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "svn-workbench-public-"),
    );
    const previousPublic = process.env.PUBLIC;
    process.env.PUBLIC = publicDir;
    const cwd = path.join(publicDir, "working-copy");
    try {
      await withPlatform("win32", async () => {
        await expect(
          runCommitFlow("svn", {
            cwd,
            addPaths: ["新增.txt"],
            removePaths: [],
            commitPaths: [path.join(cwd, "中文.txt")],
            message: "fix: guard",
          }),
        ).rejects.toThrow("无法安全调度新增或删除的中文路径");
        expect(runSvnCommand).not.toHaveBeenCalled();

        runSvnCommand.mockResolvedValue(
          successfulResult({
            stdout:
              '<status><target path="."><entry path="中文.txt"><wc-status item="modified"/></entry><entry path="unselected.txt"><wc-status item="modified"/></entry></target></status>',
          }),
        );
        await expect(
          runCommitFlow("svn", {
            cwd,
            addPaths: [],
            removePaths: [],
            commitPaths: [path.join(cwd, "中文.txt")],
            message: "fix: guard",
          }),
        ).rejects.toThrow("未选中的可提交变更");
        expect(runSvnCommand.mock.calls.map((call) => call[1][0])).toEqual([
          "status",
        ]);

        runSvnCommand.mockReset();
        runSvnCommand.mockResolvedValue(
          successfulResult({
            stdout:
              '<status><target path="."><entry path="中文.txt"><wc-status item="normal" props="modified"/></entry><entry path="ignored.txt"><wc-status item="normal"/></entry></target></status>',
          }),
        );
        await expect(
          runCommitFlow("svn", {
            cwd,
            addPaths: [],
            removePaths: [],
            commitPaths: [
              path.join(cwd, "中文.txt"),
              path.join(cwd, "missing.txt"),
            ],
            message: "fix: guard",
          }),
        ).rejects.toThrow("范围包含未选中的可提交变更。");

        runSvnCommand.mockReset();
        const outsideEntries = Array.from(
          { length: 4 },
          (_, index) =>
            `<entry path="outside-${index + 1}.txt"><wc-status item="modified"/></entry>`,
        ).join("");
        runSvnCommand.mockResolvedValue(
          successfulResult({
            stdout: `<status><target path="."><entry path="中文.txt"><wc-status item="modified"/></entry>${outsideEntries}</target></status>`,
          }),
        );
        await expect(
          runCommitFlow("svn", {
            cwd,
            addPaths: [],
            removePaths: [],
            commitPaths: [path.join(cwd, "中文.txt")],
            message: "fix: guard",
          }),
        ).rejects.toThrow(
          "outside-1.txt、outside-2.txt、outside-3.txt 等 4 项",
        );

        runSvnCommand.mockReset();
        runSvnCommand.mockResolvedValue(successfulResult({ exitCode: 1 }));
        await expect(
          runCommitFlow("svn", {
            cwd,
            addPaths: [],
            removePaths: [],
            commitPaths: [path.join(cwd, "中文.txt")],
            message: "fix: guard",
          }),
        ).rejects.toThrow("无法验证中文路径提交范围。");
      });
    } finally {
      if (previousPublic === undefined) delete process.env.PUBLIC;
      else process.env.PUBLIC = previousPublic;
      await fs.rm(publicDir, { recursive: true, force: true });
    }
  });

  it("Windows 未设置 PUBLIC 时使用标准公共临时目录", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "svn-workbench-default-public-"),
    );
    const originalCwd = process.cwd();
    const previousPublic = process.env.PUBLIC;
    delete process.env.PUBLIC;
    process.chdir(tempRoot);
    const cwd = path.join(tempRoot, "working-copy");
    try {
      await withPlatform("win32", async () => {
        runSvnCommand.mockImplementation(async (_svnPath, args) => {
          if (args[0] === "status") {
            return successfulResult({
              stdout:
                '<status><target path="."><entry path="中文.txt"><wc-status item="modified"/></entry></target></status>',
            });
          }
          return successfulResult();
        });
        await runCommitFlow("svn", {
          cwd,
          addPaths: [],
          removePaths: [],
          commitPaths: [path.join(cwd, "中文.txt")],
          message: "fix: default temp",
        });
      });
      expect(runSvnCommand.mock.calls[1][1]).toEqual(
        expect.arrayContaining([
          "-F",
          expect.stringContaining("C:\\Users\\Public"),
        ]),
      );
    } finally {
      process.chdir(originalCwd);
      if (previousPublic === undefined) delete process.env.PUBLIC;
      else process.env.PUBLIC = previousPublic;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
