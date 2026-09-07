import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildUpdatePreviewHonestyNote,
  buildUpdateScopeRemoteLists,
} from "../../src/update/updateFlow";

function candidate(relativePath: string, status = "modified") {
  return {
    absolutePath: path.resolve("/repo", relativePath),
    relativePath,
    status,
    templateGroup: "other",
    fileType: "Text",
    selection: "selected",
  } as never;
}

describe("V021-R15 远端全清单与本地重叠", () => {
  it("无本地重叠仍保留远端全清单", () => {
    const lists = buildUpdateScopeRemoteLists(
      {
        checkedRevision: "42",
        total: 2,
        byRepositoryStatus: { modified: 1, added: 1 },
        items: [
          {
            absolutePath: "/repo/a.ts",
            relativePath: "a.ts",
            repositoryStatus: "modified",
          },
          {
            absolutePath: "/repo/b.ts",
            relativePath: "b.ts",
            repositoryStatus: "added",
          },
        ],
      },
      [candidate("other.ts")],
    );
    expect(lists.remotePaths).toEqual(["a.ts", "b.ts"]);
    expect(lists.overlapPaths).toEqual([]);
    expect(lists.remoteOnlyPaths).toEqual(["a.ts", "b.ts"]);
    expect(lists.remoteItems).toEqual([
      { relativePath: "a.ts", repositoryStatus: "modified" },
      { relativePath: "b.ts", repositoryStatus: "added" },
    ]);
  });

  it("重叠/新增/删除归属准确且去重排序", () => {
    const lists = buildUpdateScopeRemoteLists(
      {
        total: 4,
        byRepositoryStatus: { modified: 2, deleted: 1, added: 1 },
        items: [
          {
            absolutePath: "/repo/z.ts",
            relativePath: "z.ts",
            repositoryStatus: "modified",
          },
          {
            absolutePath: "/repo/z.ts",
            relativePath: "z.ts",
            repositoryStatus: "modified",
          },
          {
            absolutePath: "/repo/gone.ts",
            relativePath: "gone.ts",
            repositoryStatus: "deleted",
          },
          {
            absolutePath: "/repo/new.ts",
            relativePath: "new.ts",
            repositoryStatus: "added",
          },
        ],
      },
      [candidate("z.ts")],
    );
    expect(lists.remotePaths).toEqual(["gone.ts", "new.ts", "z.ts"]);
    expect(lists.overlapPaths).toEqual(["z.ts"]);
    expect(lists.remoteOnlyPaths).toEqual(["gone.ts", "new.ts"]);
  });

  it("远端缺失时返回空清单（调用方按 incomplete 分支渲染，不冒充无变化）", () => {
    const lists = buildUpdateScopeRemoteLists(undefined, [candidate("a.ts")]);
    expect(lists.remotePaths).toEqual([]);
    expect(lists.overlapPaths).toEqual([]);
  });

  it("预览诚实说明含预览时间与 HEAD 可变化", () => {
    const note = buildUpdatePreviewHonestyNote(
      "2026-09-07T00:00:00.000Z",
      "42",
    );
    expect(note).toMatch(/2026-09-07T00:00:00.000Z/);
    expect(note).toMatch(/r42/);
    expect(note).toMatch(/HEAD 可能变化/);
    expect(note).toMatch(/不承诺覆盖/);
  });
});
