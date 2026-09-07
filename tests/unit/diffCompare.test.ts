import { describe, expect, it } from "vitest";
import {
  isDiffCompareView,
  isDiffSnapshot,
  type DiffSnapshot,
} from "../../src/protocol/workbenchProtocol";
import { resolveDiffCompare } from "../../src/webview/features/diff/diffCompare";

function baseSnapshot(overrides: Partial<DiffSnapshot> = {}): DiffSnapshot {
  return {
    kind: "diff",
    relativePath: "src/extension.ts",
    original: "const a = 1;\n",
    modified: "const a = 2;\n",
    language: "typescript",
    truncated: false,
    binary: false,
    ...overrides,
  };
}

describe("V020-R09 Diff 比较种类协议守卫", () => {
  it("接受三类合法 compare", () => {
    expect(
      isDiffCompareView({
        kind: "working-copy",
        title: "src/a.ts",
        targetPath: "src/a.ts",
        leftRevision: "BASE",
        rightRevision: "工作副本",
      }),
    ).toBe(true);
    expect(
      isDiffCompareView({
        kind: "revision-file",
        title: "r41 → r42 · src/a.ts",
        targetPath: "src/a.ts",
        leftRevision: "41",
        rightRevision: "42",
      }),
    ).toBe(true);
    expect(
      isDiffCompareView({
        kind: "revision-patch",
        title: "修订比较 r41 → r42 · 2 个路径",
        leftRevision: "41",
        rightRevision: "42",
        pathCount: 2,
      }),
    ).toBe(true);
  });

  it("拒绝未知种类、空标题与空 targetPath", () => {
    expect(isDiffCompareView({ kind: "invented", title: "x" })).toBe(false);
    expect(isDiffCompareView({ kind: "working-copy", title: "" })).toBe(false);
    expect(
      isDiffCompareView({
        kind: "revision-file",
        title: "t",
        targetPath: "",
      }),
    ).toBe(false);
  });

  it("拒绝 revision-patch 携带 targetPath（防虚构路径）", () => {
    expect(
      isDiffCompareView({
        kind: "revision-patch",
        title: "修订比较 r41 → r42 · 1 个路径",
        targetPath: "src/a.ts",
      }),
    ).toBe(false);
  });

  it("isDiffSnapshot 接受无 compare 的旧快照，拒绝非法 compare", () => {
    expect(isDiffSnapshot(baseSnapshot())).toBe(true);
    expect(
      isDiffSnapshot(
        baseSnapshot({
          compare: {
            kind: "revision-patch",
            title: "修订比较 r41 → r42 · 1 个路径",
            leftRevision: "41",
            rightRevision: "42",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isDiffSnapshot(
        baseSnapshot({
          compare: { kind: "invented", title: "x" } as never,
        }),
      ),
    ).toBe(false);
    expect(isDiffSnapshot({ ...baseSnapshot(), relativePath: 42 })).toBe(false);
  });
});

describe("V020-R09 resolveDiffCompare", () => {
  it("本地比较显示真实路径与 BASE 基线并允许本地动作", () => {
    const resolved = resolveDiffCompare(
      baseSnapshot({
        compare: {
          kind: "working-copy",
          title: "src/a.ts",
          targetPath: "src/a.ts",
          leftRevision: "BASE",
          rightRevision: "工作副本",
        },
      }),
    );
    expect(resolved.kind).toBe("working-copy");
    expect(resolved.heading).toBe("src/a.ts");
    expect(resolved.baseline).toBe("BASE ↔ 工作副本 · typescript");
    expect(resolved.isReadOnly).toBe(false);
    expect(resolved.showLocalActions).toBe(true);
    expect(resolved.showPathCopy).toBe(true);
    expect(resolved.targetPath).toBe("src/a.ts");
  });

  it("单文件历史比较双侧只读且保留真实路径复制", () => {
    const resolved = resolveDiffCompare(
      baseSnapshot({
        relativePath: "src/a.ts",
        language: "diff",
        original: "",
        modified: "Index: src/a.ts\n",
        compare: {
          kind: "revision-file",
          title: "r41 → r42 · src/a.ts",
          targetPath: "src/a.ts",
          leftRevision: "41",
          rightRevision: "42",
        },
      }),
    );
    expect(resolved.kind).toBe("revision-file");
    expect(resolved.heading).toBe("r41 → r42 · src/a.ts");
    expect(resolved.baseline).toBe("r41 → r42（只读）");
    expect(resolved.isReadOnly).toBe(true);
    expect(resolved.showLocalActions).toBe(false);
    expect(resolved.showPathCopy).toBe(true);
  });

  it("范围 Patch 无单文件身份且不提供路径操作", () => {
    const resolved = resolveDiffCompare(
      baseSnapshot({
        relativePath: ". · r41 → r42",
        language: "diff",
        original: "",
        modified: "Index: src/a.ts\n",
        compare: {
          kind: "revision-patch",
          title: "修订比较 r41 → r42 · 2 个路径",
          leftRevision: "41",
          rightRevision: "42",
          pathCount: 2,
        },
      }),
    );
    expect(resolved.kind).toBe("revision-patch");
    expect(resolved.heading).toBe("修订比较 r41 → r42 · 2 个路径");
    expect(resolved.targetPath).toBeUndefined();
    expect(resolved.isReadOnly).toBe(true);
    expect(resolved.showLocalActions).toBe(false);
    expect(resolved.showPathCopy).toBe(false);
  });

  it("空/二进制/截断的历史比较不提供路径复制", () => {
    const empty = resolveDiffCompare(
      baseSnapshot({
        language: "diff",
        original: "",
        modified: "",
        compare: {
          kind: "revision-file",
          title: "r41 → r42 · src/a.ts",
          targetPath: "src/a.ts",
          leftRevision: "41",
          rightRevision: "42",
        },
      }),
    );
    expect(empty.showPathCopy).toBe(false);
    expect(empty.targetPath).toBeUndefined();

    const binary = resolveDiffCompare(
      baseSnapshot({
        binary: true,
        original: "",
        modified: "",
        compare: {
          kind: "revision-file",
          title: "r41 → r42 · src/a.ts",
          targetPath: "src/a.ts",
          leftRevision: "41",
          rightRevision: "42",
        },
      }),
    );
    expect(binary.showPathCopy).toBe(false);

    const truncated = resolveDiffCompare(
      baseSnapshot({
        truncated: true,
        compare: {
          kind: "revision-file",
          title: "r41 → r42 · src/a.ts",
          targetPath: "src/a.ts",
          leftRevision: "41",
          rightRevision: "42",
        },
      }),
    );
    expect(truncated.showPathCopy).toBe(false);
  });

  it("旧快照缺省行为保守：patch 只读无路径操作", () => {
    const legacyPatch = resolveDiffCompare(
      baseSnapshot({
        relativePath: ". · r41 → r42",
        language: "diff",
        original: "",
        modified: "Index: src/a.ts\n",
        message: "修订比较 r41 → r42",
      }),
    );
    expect(legacyPatch.kind).toBe("revision-patch");
    expect(legacyPatch.isReadOnly).toBe(true);
    expect(legacyPatch.showLocalActions).toBe(false);
    expect(legacyPatch.showPathCopy).toBe(false);
    expect(legacyPatch.targetPath).toBeUndefined();
  });

  it("旧快照缺省行为保守：非 patch 沿用本地比较", () => {
    const legacyWorking = resolveDiffCompare(baseSnapshot());
    expect(legacyWorking.kind).toBe("working-copy");
    expect(legacyWorking.heading).toBe("src/extension.ts");
    expect(legacyWorking.showLocalActions).toBe(true);
  });

  it("非法 compare 按只读无路径操作 fail-closed", () => {
    const resolved = resolveDiffCompare(
      baseSnapshot({
        compare: { kind: "invented", title: "x" } as never,
      }),
    );
    expect(resolved.isReadOnly).toBe(true);
    expect(resolved.showLocalActions).toBe(false);
    expect(resolved.showPathCopy).toBe(false);
    expect(resolved.targetPath).toBeUndefined();
  });
});
