import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import {
  collectSvnHistoryRange,
  resolveHeadRevision,
} from "../../src/history/svnHistory";

const root = path.resolve("/repo");
const scope: OperationScope = {
  id: "s",
  repositoryRoot: root,
  source: "workspace",
  roots: [
    {
      absolutePath: path.join(root, "a"),
      relativePath: "a",
      kind: "folder",
    },
  ],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};

function logXml(revisions: string[]): string {
  return `<log>${revisions
    .map(
      (revision) =>
        `<logentry revision="${revision}"><author>a</author><date>2026-01-01</date><msg>m${revision}</msg></logentry>`,
    )
    .join("")}</log>`;
}

beforeEach(() => {
  runSvnCommand.mockReset();
});

describe("V021-R14 发布说明范围分页采集", () => {
  it("目标区间完全早于最近 200 条仍正确（按范围分页，不依赖固定 200 条）", async () => {
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: logXml(["12", "11", "10"]),
      stderr: "",
    });
    const result = await collectSvnHistoryRange(
      "svn",
      scope,
      { fromRevision: "10", toRevision: "12" },
      { pageSize: 200 },
    );
    expect(runSvnCommand.mock.calls[0]?.[1]).toEqual([
      "log",
      "--xml",
      "-v",
      "--limit",
      "200",
      "--revision",
      "12:10",
      path.join(root, "a"),
    ]);
    expect(result.complete).toBe(true);
    expect(result.revisionsRead).toBe(3);
    expect(result.revisions.map((item) => item.revision)).toEqual([
      "12",
      "11",
      "10",
    ]);
  });

  it("超 200 修订按窗口分页并去重计数", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: logXml(["205", "204", "203"]),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: logXml(["202", "201"]),
        stderr: "",
      });
    const seen: number[] = [];
    const result = await collectSvnHistoryRange(
      "svn",
      scope,
      { fromRevision: "1", toRevision: "205" },
      {
        pageSize: 3,
        onPage: (read) => {
          seen.push(read);
        },
      },
    );
    expect(result.pagesRead).toBe(2);
    expect(result.complete).toBe(true);
    // 去重后 5 条，不重复计数。
    expect(result.revisionsRead).toBe(5);
    expect(seen).toEqual([3, 5]);
    expect(runSvnCommand.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["--revision", "202:1"]),
    );
  });

  it("分页失败显式标部分并保留已采集，重试不重复计数", async () => {
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: logXml(["50", "49", "48"]),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "network down",
      });
    const partial = await collectSvnHistoryRange(
      "svn",
      scope,
      { fromRevision: "1", toRevision: "50" },
      { pageSize: 3 },
    );
    expect(partial.complete).toBe(false);
    expect(partial.revisionsRead).toBe(3);
    expect(partial.partialReason).toMatch(/network down/);
    // 重试：全新采集，去重后仍正确计数。
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: logXml(["50", "49", "48"]),
      stderr: "",
    });
    const retried = await collectSvnHistoryRange(
      "svn",
      scope,
      { fromRevision: "48", toRevision: "50" },
      { pageSize: 200 },
    );
    expect(retried.complete).toBe(true);
    expect(retried.revisionsRead).toBe(3);
  });

  it("取消标记 cancelled 部分结果", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await collectSvnHistoryRange(
      "svn",
      scope,
      { fromRevision: "1", toRevision: "10" },
      { signal: controller.signal },
    );
    expect(result.complete).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.revisionsRead).toBe(0);
    expect(runSvnCommand).not.toHaveBeenCalled();
  });

  it("HEAD 在请求开始固定解析，失败不虚构", async () => {
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '<info><entry revision="99"></entry></info>',
      stderr: "",
    });
    await expect(resolveHeadRevision("svn", scope)).resolves.toBe("99");
    runSvnCommand.mockReset();
    runSvnCommand
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "no" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: logXml(["77"]),
        stderr: "",
      });
    await expect(resolveHeadRevision("svn", scope)).resolves.toBe("77");
    runSvnCommand.mockReset();
    runSvnCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "x" });
    await expect(resolveHeadRevision("svn", scope)).resolves.toBeUndefined();
  });
});
