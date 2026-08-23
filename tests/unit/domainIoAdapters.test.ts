import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import {
  applySvnChangelist,
  collectSvnChangelists,
} from "../../src/changelist/svnChangelists";
import {
  collectSvnHistory,
  collectSvnHistoryPage,
  normalizeSvnHistoryQuery,
} from "../../src/history/svnHistory";
import {
  collectSvnProperties,
  parseSvnExternalsTargetNames,
  parseSvnPropertiesXml,
  validatePropertyEdit,
} from "../../src/properties/svnProperties";
import {
  buildResolveConflictPreview,
  isResolveSuccessful,
  resolveConflictUsingWorking,
} from "../../src/conflict/conflictResolver";
import {
  collectCommitDiffSummaries,
  parseSvnUnifiedDiffSummary,
} from "../../src/commit/commitDiffSummary";
import { parseInfoXml } from "../../src/svn/parsers/infoXmlParser";
import {
  parseFileExternalFlag,
  parseStatusXml,
} from "../../src/svn/parsers/statusXmlParser";

const root = path.resolve("/repo");
const inRepository = (...segments: string[]) => path.join(root, ...segments);
const outside = path.resolve(root, "..", "outside");
const scope: OperationScope = {
  id: "s",
  repositoryRoot: root,
  source: "workspace",
  roots: [
    { absolutePath: inRepository("a"), relativePath: "a", kind: "folder" },
  ],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};

beforeEach(() => {
  runSvnCommand.mockReset();
});

describe("领域 SVN I/O 适配器", () => {
  it("采集并应用或移除 Changelist，同时拒绝空集和越界路径", async () => {
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        '<status><target path="a"><changelist name="work"><entry path="x.ts"/></changelist></target></status>',
      stderr: "",
    });
    expect(await collectSvnChangelists("svn", scope)).toEqual([
      { name: "work", paths: ["x.ts"] },
    ]);
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    await applySvnChangelist("svn", scope, "work", ["a/x.ts"]);
    expect(runSvnCommand.mock.calls.at(-1)?.[1]).toEqual([
      "changelist",
      "work",
      inRepository("a", "x.ts"),
    ]);
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    await applySvnChangelist("svn", scope, undefined, ["a/x.ts"]);
    expect(runSvnCommand.mock.calls.at(-1)?.[1]).toEqual([
      "changelist",
      "--remove",
      inRepository("a", "x.ts"),
    ]);
    await expect(applySvnChangelist("svn", scope, "x", [])).rejects.toThrow(
      "至少一个文件",
    );
    await expect(
      applySvnChangelist("svn", scope, "x", ["../outside"]),
    ).rejects.toThrow("范围外");
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "denied",
    });
    await expect(collectSvnChangelists("svn", scope)).rejects.toThrow("denied");
  });

  it("合并多个历史根的相同修订并保留唯一 Changed Paths", async () => {
    const multi = {
      ...scope,
      roots: [
        scope.roots[0],
        {
          absolutePath: inRepository("b"),
          relativePath: "b",
          kind: "folder" as const,
        },
      ],
    };
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout:
          '<log><logentry revision="2"><author>a</author><date>2026-01-01</date><msg>m</msg><paths><path action="M">/a/x</path></paths></logentry></log>',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: "",
        stdout:
          '<log><logentry revision="2"><author>a</author><date>2026-01-01</date><msg>m</msg><paths><path action="M">/a/x</path><path action="A">/b/y</path></paths></logentry><logentry revision="3"><msg>n</msg></logentry></log>',
      });
    const revisions = await collectSvnHistory("svn", multi, 5);
    expect(revisions.map((item) => item.revision)).toEqual(["3", "2"]);
    expect(revisions[1].changedPaths).toHaveLength(2);
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    await expect(collectSvnHistory("svn", scope)).rejects.toThrow("无法读取 a");
  });

  it("校验历史加载条件，并将安全的修订范围传给 svn log", async () => {
    expect(
      normalizeSvnHistoryQuery({
        revisionFrom: "20",
        revisionTo: "10",
        dateFrom: "2026-02-30",
        author: "x".repeat(121),
      }).issues,
    ).toEqual([
      "作者筛选不能超过 120 个字符。",
      "开始日期必须是有效的 YYYY-MM-DD 日期。",
      "较早修订号不能大于较晚修订号。",
    ]);
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout:
        '<log><logentry revision="12"><author>Alice</author><date>2026-07-30T08:00:00Z</date><msg>m</msg></logentry><logentry revision="11"><author>bob</author><date>2026-07-01T08:00:00Z</date><msg>n</msg></logentry></log>',
    });

    const page = await collectSvnHistoryPage("svn", scope, 2, {
      revisionFrom: "10",
      revisionTo: "12",
      author: "alice",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    });

    expect(runSvnCommand.mock.calls[0]?.[1]).toEqual([
      "log",
      "--xml",
      "-v",
      "--limit",
      "2",
      "--revision",
      "12:10",
      inRepository("a"),
    ]);
    expect(page).toMatchObject({
      hasMore: true,
      revisions: [{ revision: "12", author: "Alice" }],
    });
  });

  it("解析属性 XML、实体、校验边界并表达读取失败", async () => {
    const xml =
      '<properties><target><property name="svn:ignore">a&amp;b&#10;c&#x21;&quot;&apos;&lt;&gt;</property></target></properties>';
    expect(parseSvnPropertiesXml(xml)).toEqual([
      { name: "svn:ignore", value: "a&b\nc!\"'<> ".trim() },
    ]);
    expect(validatePropertyEdit("", "", false, [])).toHaveLength(1);
    expect(validatePropertyEdit("bad name", "", false, [])).toHaveLength(1);
    expect(
      validatePropertyEdit("svn:ignore", "x".repeat(70_000), false, []),
    ).toContain("属性值超过 64 KB，请使用 SVN CLI 和属性文件处理。");
    expect(validatePropertyEdit("svn:ignore", "", true, [])).toContain(
      "该属性当前不存在，无法删除。",
    );
    expect(
      validatePropertyEdit("svn:ignore", "", true, [
        { name: "svn:ignore", value: "" },
      ]),
    ).toEqual([]);
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 1,
      stderr: "",
      stdout: "",
    });
    expect(await collectSvnProperties("svn", ".", root)).toEqual({
      items: [],
      error: "SVN 属性读取失败。",
    });
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stderr: "",
      stdout: xml,
    });
    expect((await collectSvnProperties("svn", ".", root)).items).toHaveLength(
      1,
    );
  });

  it("解析 SVN info/status XML 的完整与空值分支", () => {
    expect(
      parseInfoXml(
        '<info><entry kind="dir" path="." revision="7"><url>https://e/r&amp;x</url><repository><root>https://e</root></repository><wc-info><wcroot-abspath>/repo</wcroot-abspath></wc-info></entry></info>',
        "/fallback",
      ),
    ).toEqual({
      revision: "7",
      url: "https://e/r&x",
      repositoryRoot: "https://e",
      workingCopyRoot: "/repo",
    });
    expect(parseInfoXml("<info/>", "/fallback")).toEqual({
      workingCopyRoot: "/fallback",
      url: undefined,
      repositoryRoot: undefined,
      revision: undefined,
    });
    const statuses = [
      "normal",
      "modified",
      "added",
      "deleted",
      "missing",
      "unversioned",
      "conflicted",
      "ignored",
      "external",
      "obstructed",
      "replaced",
      "incomplete",
      "invented",
    ];
    const xml = `<status><target>${statuses.map((status, index) => `<entry path="p${index}&amp;x"><wc-status item="${status}"${index === 0 ? ' props="modified"' : ""}/></entry>`).join("")}<entry path="skip"></entry></target></status>`;
    const entries = parseStatusXml(xml, root);
    expect(entries.map((item) => item.status)).toEqual([
      ...statuses.slice(0, -1),
      "unknown",
    ]);
    expect(entries[0]).toEqual(
      expect.objectContaining({ relativePath: "p0&x", propStatus: "modified" }),
    );
  });

  it("parseSvnExternalsTargetNames 解析新旧语法并忽略注释与空行", () => {
    expect(
      parseSvnExternalsTargetNames(
        "^/trunk/ext-src ext\n^/trunk/a.txt@2 a.txt\n# 注释\n\n-r 7 ^/trunk/old.txt old.txt\n",
      ),
    ).toEqual(["ext", "a.txt", "old.txt"]);
    expect(parseSvnExternalsTargetNames("")).toEqual([]);
  });

  it("parseFileExternalFlag 只认目标自身 wc-status 的 file-external 属性", () => {
    const external = `<status><target path="f"><entry path="f"><wc-status item="normal" revision="1" file-external="true" props="none"/></entry></target></status>`;
    expect(parseFileExternalFlag(external)).toBe(true);
    const normal = `<status><target path="f"><entry path="f"><wc-status item="modified" revision="1" props="none"/></entry></target></status>`;
    expect(parseFileExternalFlag(normal)).toBe(false);
    expect(parseFileExternalFlag("<status/>")).toBe(false);
    // 属性值不同或出现在无关位置不得误判。
    expect(
      parseFileExternalFlag(
        `<status><target path="f"><entry path="f"><wc-status item="normal" file-external="false"/></entry></target></status>`,
      ),
    ).toBe(false);
  });

  it("生成冲突解决预览、阻止越界并校验真实 resolve 结果", async () => {
    expect(
      buildResolveConflictPreview(scope, path.join(outside, "x")).canResolve,
    ).toBe(false);
    const preview = buildResolveConflictPreview(
      scope,
      inRepository("a", 'with"quote.ts'),
    );
    expect(preview.canResolve).toBe(true);
    expect(preview.commands[0]).toContain('with\\"quote.ts');
    await expect(
      resolveConflictUsingWorking("svn", scope, path.join(outside, "x")),
    ).rejects.toThrow("范围内");
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "Resolved conflicted state of 'a'",
      stderr: "",
    });
    expect(
      (await resolveConflictUsingWorking("svn", scope, inRepository("a", "x")))
        .resolved,
    ).toBe(true);
    runSvnCommand.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "not resolved",
      stderr: "",
    });
    expect(
      (await resolveConflictUsingWorking("svn", scope, inRepository("a", "x")))
        .resolved,
    ).toBe(false);
    expect(isResolveSuccessful("RESOLVED x")).toBe(true);
    expect(isResolveSuccessful("unchanged")).toBe(false);
  });

  it("汇总文本、二进制、截断和失败 Diff，并去重及排除越界路径", async () => {
    const parsed = parseSvnUnifiedDiffSummary(
      "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\nCannot display: binary type\r\n",
      inRepository("a", "x"),
      root,
    );
    expect(parsed).toEqual(
      expect.objectContaining({
        addedLines: 1,
        deletedLines: 1,
        hunks: 1,
        binary: true,
        truncated: false,
      }),
    );
    expect(
      parseSvnUnifiedDiffSummary("abcdef", inRepository("a", "x"), root, 3)
        .truncated,
    ).toBe(true);
    runSvnCommand
      .mockResolvedValueOnce({
        exitCode: 1,
        truncated: false,
        stderr: "diff failed",
        stdout: "",
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        truncated: true,
        stderr: "",
        stdout: "+partial",
      });
    const summaries = await collectCommitDiffSummaries("svn", scope, [
      inRepository("a", "b"),
      inRepository("a", "b"),
      outside,
      inRepository("a", "a"),
    ]);
    expect(summaries).toEqual([
      expect.objectContaining({
        relativePath: "a/a",
        addedLines: 1,
        truncated: true,
      }),
      expect.objectContaining({ relativePath: "a/b", error: "diff failed" }),
    ]);
  });
});
