import { describe, expect, it } from "vitest";
import {
  buildChangedPathDiffPlan,
  describeChangedPathAction,
  isHistoryRevisionParam,
  mapReposPathToWorkingCopyRelative,
  normalizeReposPath,
  previousHistoryRevision,
} from "../../src/history/historyChangedPath";

/* V021-R17：四类变更内容构建 + 路径映射（纯函数，平台无关断言）。 */

describe("historyChangedPath", () => {
  it("新增构建空→新内容", () => {
    const result = buildChangedPathDiffPlan({
      action: "A",
      revision: "12",
      reposPath: "/trunk/new.ts",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.left).toEqual({ kind: "empty" });
    expect(result.plan.right).toEqual({
      kind: "revision",
      revision: "12",
      reposPath: "/trunk/new.ts",
    });
    expect(result.plan.rightRevision).toBe("r12");
    expect(result.plan.sourceNote).toBeUndefined();
    expect(result.plan.actionLabel).toBe("新增");
  });

  it("删除构建旧内容→空", () => {
    const result = buildChangedPathDiffPlan({
      action: "D",
      revision: "12",
      reposPath: "/trunk/old.ts",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.left).toEqual({
      kind: "revision",
      revision: "11",
      reposPath: "/trunk/old.ts",
    });
    expect(result.plan.right).toEqual({ kind: "empty" });
    expect(result.plan.leftRevision).toBe("r11");
    expect(result.plan.actionLabel).toBe("删除");
  });

  it("修改构建上一修订→本修订", () => {
    const result = buildChangedPathDiffPlan({
      action: "M",
      revision: "42",
      reposPath: "/trunk/a.ts",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.left).toMatchObject({
      kind: "revision",
      revision: "41",
    });
    expect(result.plan.right).toMatchObject({
      kind: "revision",
      revision: "42",
    });
    expect(result.plan.sourceNote).toBeUndefined();
  });

  it("复制显示可解释来源", () => {
    const result = buildChangedPathDiffPlan({
      action: "A",
      revision: "30",
      reposPath: "/branches/feature/b.ts",
      copyFromPath: "/trunk/b.ts",
      copyFromRevision: "28",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.left).toEqual({
      kind: "revision",
      revision: "28",
      reposPath: "/trunk/b.ts",
    });
    expect(result.plan.right).toMatchObject({ revision: "30" });
    expect(result.plan.sourceNote).toBe("复制自 /trunk/b.ts@r28");
  });

  it("替换携带复制信息时同样注明来源", () => {
    const result = buildChangedPathDiffPlan({
      action: "R",
      revision: "30",
      reposPath: "/trunk/c.ts",
      copyFromPath: "/trunk/old-c.ts",
      copyFromRevision: "29",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sourceNote).toBe("复制自 /trunk/old-c.ts@r29");
    expect(result.plan.actionLabel).toBe("替换");
  });

  it("复制信息不完整时退化为普通新增，不虚构来源", () => {
    const result = buildChangedPathDiffPlan({
      action: "A",
      revision: "30",
      reposPath: "/branches/feature/b.ts",
      copyFromPath: "/trunk/b.ts",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.left).toEqual({ kind: "empty" });
    expect(result.plan.sourceNote).toBeUndefined();
  });

  it("非法修订与路径如实拒绝", () => {
    expect(
      buildChangedPathDiffPlan({
        action: "M",
        revision: "HEAD",
        reposPath: "/trunk/a.ts",
      }),
    ).toMatchObject({ ok: false });
    expect(
      buildChangedPathDiffPlan({
        action: "M",
        revision: "12",
        reposPath: "trunk/a.ts",
      }),
    ).toMatchObject({ ok: false });
  });

  it("r1 无上一修订内容时拒绝构建修改/删除差异", () => {
    expect(
      buildChangedPathDiffPlan({
        action: "M",
        revision: "1",
        reposPath: "/trunk/a.ts",
      }),
    ).toMatchObject({ ok: false });
    // r1 新增仍可构建（空→新内容）。
    expect(
      buildChangedPathDiffPlan({
        action: "A",
        revision: "1",
        reposPath: "/trunk/a.ts",
      }).ok,
    ).toBe(true);
  });

  it("上一修订推导正确", () => {
    expect(previousHistoryRevision("12")).toBe("11");
    expect(previousHistoryRevision("1")).toBeUndefined();
    expect(previousHistoryRevision("HEAD")).toBeUndefined();
  });

  it("修订参数校验", () => {
    expect(isHistoryRevisionParam("12")).toBe(true);
    expect(isHistoryRevisionParam("0")).toBe(false);
    expect(isHistoryRevisionParam("HEAD")).toBe(false);
    expect(isHistoryRevisionParam(12)).toBe(false);
  });

  it("仓库路径必须以 / 开头", () => {
    expect(normalizeReposPath("/trunk/a.ts")).toBe("/trunk/a.ts");
    expect(normalizeReposPath("trunk/a.ts")).toBeUndefined();
    expect(normalizeReposPath("/")).toBeUndefined();
  });

  it("动作中文标签", () => {
    expect(describeChangedPathAction("A")).toBe("新增");
    expect(describeChangedPathAction("D")).toBe("删除");
    expect(describeChangedPathAction("M")).toBe("修改");
    expect(describeChangedPathAction("R")).toBe("替换");
  });

  it("工作副本检出子目录时正确剥离前缀", () => {
    expect(
      mapReposPathToWorkingCopyRelative(
        "/trunk/a.ts",
        "https://svn.example.com/repos/proj",
        "https://svn.example.com/repos/proj/trunk",
      ),
    ).toBe("a.ts");
    // 范围外路径如实缺省（不猜测）。
    expect(
      mapReposPathToWorkingCopyRelative(
        "/branches/other/b.ts",
        "https://svn.example.com/repos/proj",
        "https://svn.example.com/repos/proj/trunk",
      ),
    ).toBeUndefined();
    // 检出即仓库根时保持去前导斜线。
    expect(
      mapReposPathToWorkingCopyRelative(
        "/trunk/a.ts",
        "https://svn.example.com/repos/proj",
        "https://svn.example.com/repos/proj",
      ),
    ).toBe("trunk/a.ts");
    // 目标即检出根（目录变更）返回空串，调用方可据此拒绝单文件差异。
    expect(
      mapReposPathToWorkingCopyRelative(
        "/trunk",
        "https://svn.example.com/repos/proj",
        "https://svn.example.com/repos/proj/trunk",
      ),
    ).toBe("");
    // URL 缺失时退化为去前导斜线（仍须经 Host 范围复验）。
    expect(mapReposPathToWorkingCopyRelative("/trunk/a.ts")).toBe("trunk/a.ts");
    // 检出 URL 不在仓库根之下时缺省。
    expect(
      mapReposPathToWorkingCopyRelative(
        "/trunk/a.ts",
        "https://svn.example.com/repos/proj",
        "https://svn.example.com/repos/other",
      ),
    ).toBeUndefined();
  });
});
