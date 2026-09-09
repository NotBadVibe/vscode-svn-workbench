import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import { RepositoryWorkbenchActions } from "../../src/extension/workbench/repositoryWorkbenchActions";

const root = path.resolve("/repo");
const wcInfoXml =
  '<info><entry kind="dir" path="." revision="40"><url>https://svn.example/r/trunk</url><repository><root>https://svn.example/r</root></repository></entry></info>';

function scopeFor() {
  return {
    repositoryRoot: root,
    roots: [
      { absolutePath: path.join(root, "a"), relativePath: "a", kind: "folder" },
    ],
  };
}

function makeHost() {
  return {
    context: {},
    post: vi.fn(async () => undefined),
    sendError: vi.fn(async () => undefined),
    collectScopeCandidates: vi.fn(async () => []),
    buildRepositorySnapshot: vi.fn(async () => ({ kind: "repository" })),
    ensureAdvancedRepositoryState: (session: {
      repositoryState?: { advanced?: Record<string, unknown> };
    }) => {
      session.repositoryState ??= {};
      session.repositoryState.advanced ??= {};
      return session.repositoryState.advanced as never;
    },
    createLocalShelf: vi.fn(),
    sendRepositorySnapshot: vi.fn(async () => undefined),
  };
}

function makeSession(candidates: unknown[] = []) {
  return {
    svnPath: "svn",
    scope: scopeFor(),
    scopeHash: "scope-1",
    repositoryUuid: "repo-1",
    repositoryState: { advanced: {} },
    __candidates: candidates,
  };
}

/** 默认 SVN 桩：工作副本信息 + HEAD=42 + 源可读 + 目标不存在。 */
function stubDefault() {
  runSvnCommand.mockImplementation(async (_svn: string, args: string[]) => {
    if (args[0] === "info" && args.includes("-r") && args.includes("HEAD")) {
      return { exitCode: 0, stdout: 'revision="42"', stderr: "" };
    }
    if (
      args[0] === "info" &&
      args.includes("-r") &&
      args.at(-1) === "https://svn.example/r/trunk"
    ) {
      return { exitCode: 0, stdout: "<info/>", stderr: "" };
    }
    if (args[0] === "info" && args.at(-1) === "https://svn.example/r/tags/v1") {
      return { exitCode: 1, stdout: "", stderr: "Not found" };
    }
    if (args[0] === "info") {
      return { exitCode: 0, stdout: wcInfoXml, stderr: "" };
    }
    if (args[0] === "copy") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}

describe("V026-R44 主机：分支/标签源修订版本冻结", () => {
  beforeEach(() => {
    runSvnCommand.mockReset();
  });

  it("HEAD 预览解析为固定 r42，命令带 -r 且详情含来源与未提交事实", async () => {
    stubDefault();
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    await actions.previewAdvancedRepositoryOperation(
      session as never,
      {
        operation: "tag",
        sourceUrl: "https://svn.example/r/trunk",
        targetUrl: "https://svn.example/r/tags/v1",
        source: {
          url: "https://svn.example/r/trunk",
          origin: "manual",
          revision: "HEAD",
        },
        sourceRevision: "HEAD",
        sourceRevisionMode: "HEAD",
        message: "release v1",
      },
      "req-1",
    );
    const preview = (
      session.repositoryState as {
        advanced: { preview: Record<string, unknown> };
      }
    ).advanced.preview;
    expect(preview.issues).toEqual([]);
    expect(preview.sourceResolvedRevision).toBe("42");
    expect(preview.sourceRevision).toBe("HEAD");
    expect(preview.sourceRevisionMode).toBe("HEAD");
    expect(preview.commands[0] as string).toContain("-r 42");
    const details = preview.details as string[];
    expect(details.join("\n")).toContain("https://svn.example/r/trunk@r42");
    expect(details.join("\n")).toContain("HEAD 已固定");
    expect(details.join("\n")).toContain("远端 copy 仍只复制源");
    expect(host.sendRepositorySnapshot).toHaveBeenCalledOnce();
  });

  it("指定 rN 预览使用固定版本，不跟随 HEAD", async () => {
    stubDefault();
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    // 指定 r41：桩按 -r 参数回显可读。
    runSvnCommand.mockImplementation(async (_svn: string, args: string[]) => {
      if (args[0] === "info" && args.includes("-r") && args.includes("HEAD")) {
        return { exitCode: 0, stdout: 'revision="99"', stderr: "" };
      }
      if (args[0] === "info" && args.includes("-r") && args.includes("41")) {
        return { exitCode: 0, stdout: "<info/>", stderr: "" };
      }
      if (
        args[0] === "info" &&
        args.at(-1) === "https://svn.example/r/tags/v1"
      ) {
        return { exitCode: 1, stdout: "", stderr: "Not found" };
      }
      if (args[0] === "info") {
        return { exitCode: 0, stdout: wcInfoXml, stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await actions.previewAdvancedRepositoryOperation(
      session as never,
      {
        operation: "branch",
        sourceUrl: "https://svn.example/r/trunk",
        targetUrl: "https://svn.example/r/tags/v1",
        sourceRevision: "r41",
        sourceRevisionMode: "revision",
        message: "branch from r41",
      },
      "req-1",
    );
    const preview = (
      session.repositoryState as {
        advanced: { preview: Record<string, unknown> };
      }
    ).advanced.preview;
    expect(preview.issues).toEqual([]);
    expect(preview.sourceResolvedRevision).toBe("41");
    expect(preview.sourceRevision).toBe("41");
    expect(preview.commands[0] as string).toContain("-r 41");
    expect(preview.commands[0] as string).not.toContain("-r 99");
  });

  it("非法修订版本给出中文恢复指引且不可执行", async () => {
    stubDefault();
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    await actions.previewAdvancedRepositoryOperation(
      session as never,
      {
        operation: "tag",
        sourceUrl: "https://svn.example/r/trunk",
        targetUrl: "https://svn.example/r/tags/v1",
        sourceRevision: "abc",
        sourceRevisionMode: "revision",
        message: "x",
      },
      "req-1",
    );
    const preview = (
      session.repositoryState as {
        advanced: { preview: Record<string, unknown> };
      }
    ).advanced.preview;
    expect((preview.issues as string[]).join("")).toContain("源修订版本");
    expect(preview.sourceResolvedRevision).toBeUndefined();
  });

  it("执行复验：源失效或目标已存在被拒绝；成功按固定版本执行", async () => {
    stubDefault();
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    await actions.previewAdvancedRepositoryOperation(
      session as never,
      {
        operation: "tag",
        sourceUrl: "https://svn.example/r/trunk",
        targetUrl: "https://svn.example/r/tags/v1",
        sourceRevision: "HEAD",
        sourceRevisionMode: "HEAD",
        message: "release v1",
      },
      "req-1",
    );
    const preview = (
      session.repositoryState as {
        advanced: { preview: Record<string, unknown> };
      }
    ).advanced.preview;
    const token = preview.token as string;

    // 目标已存在 → 拒绝。
    runSvnCommand.mockImplementation(async (_svn: string, args: string[]) => {
      if (args[0] === "info" && args.includes("-r")) {
        return { exitCode: 0, stdout: "<info/>", stderr: "" };
      }
      if (args[0] === "info") {
        return { exitCode: 0, stdout: "<info/>", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      token,
      "req-2",
    );
    expect(host.sendError).toHaveBeenCalledWith(
      "repository",
      "目标已存在",
      expect.stringContaining("已存在"),
      true,
      "req-2",
    );

    // 旧 token → 拒绝。
    host.sendError.mockClear();
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      "stale-token",
      "req-3",
    );
    expect(host.sendError).toHaveBeenCalledWith(
      "repository",
      "高级操作预览已失效",
      expect.anything(),
      true,
      "req-3",
    );
  });

  it("执行成功时 svn copy 携带固定 -r，不漂移到新 HEAD", async () => {
    stubDefault();
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    await actions.previewAdvancedRepositoryOperation(
      session as never,
      {
        operation: "tag",
        sourceUrl: "https://svn.example/r/trunk",
        targetUrl: "https://svn.example/r/tags/v1",
        sourceRevision: "HEAD",
        sourceRevisionMode: "HEAD",
        message: "release v1",
      },
      "req-1",
    );
    const preview = (
      session.repositoryState as {
        advanced: { preview: Record<string, unknown> };
      }
    ).advanced.preview;
    const token = preview.token as string;
    runSvnCommand.mockClear();
    // 执行阶段 HEAD 已前进到 99，但复验与执行仍用冻结的 42。
    runSvnCommand.mockImplementation(async (_svn: string, args: string[]) => {
      if (args[0] === "info" && args.includes("-r") && args.includes("HEAD")) {
        return { exitCode: 0, stdout: 'revision="99"', stderr: "" };
      }
      if (args[0] === "info" && args.includes("-r") && args.includes("42")) {
        return { exitCode: 0, stdout: "<info/>", stderr: "" };
      }
      if (
        args[0] === "info" &&
        args.at(-1) === "https://svn.example/r/tags/v1"
      ) {
        return { exitCode: 1, stdout: "", stderr: "Not found" };
      }
      if (args[0] === "copy") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      token,
      "req-9",
    );
    const copyCall = runSvnCommand.mock.calls.find(
      (call) => (call[1] as string[])[0] === "copy",
    );
    expect(copyCall).toBeDefined();
    const copyArgs = copyCall![1] as string[];
    expect(copyArgs).toContain("-r");
    expect(copyArgs).toContain("42");
    expect(copyArgs).not.toContain("99");
    expect(host.sendError).not.toHaveBeenCalled();
  });
});
