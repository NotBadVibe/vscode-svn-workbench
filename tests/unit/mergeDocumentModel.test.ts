import { describe, expect, it } from "vitest";
import {
  BOM_SINGLE,
  CRLF_SINGLE,
  GIT_SINGLE,
  MULTI_BLOCK,
  NO_BASE,
  NO_TRAILING_NEWLINE,
  SVN_SINGLE,
} from "../../src/conflict/fixtures";
import {
  hashText,
  parseConflictRegions,
} from "../../src/conflict/conflictDiffModel";
import {
  acceptAuthoritativeAck,
  applyMergeAction,
  applyMergeEdit,
  applyTextEdits,
  createMergeDocument,
  isRegionManuallyModified,
  remapRegionsAfterEdit,
  updateEditorState,
  verifyExpectedContent,
  type MergeDocumentState,
} from "../../src/conflict/mergeDocumentModel";

const REPO = "/repo/svn-workbench";
const PATH = "src/order.ts";
const SCOPE = "scope-hash-v012a";
const REV = "r128";

function createState(
  contents: string = SVN_SINGLE,
  overrides: Partial<{ scopeHash: string; rev: string }> = {},
): MergeDocumentState {
  const result = createMergeDocument({
    repositoryRoot: REPO,
    relativePath: PATH,
    authoritativeContents: contents,
    baseContents: "const base = 1;\n",
    scopeHash: overrides.scopeHash ?? SCOPE,
    workingCopyRevision: overrides.rev ?? REV,
  });
  if (!result.ok)
    throw new Error(`createMergeDocument 失败: ${result.message}`);
  return result.state;
}

function expectedOf(state: MergeDocumentState) {
  return {
    scopeHash: state.scopeHash,
    workingCopyRevision: state.workingCopyRevision,
    expectedAuthoritativeContents: state.authoritativeContents,
  };
}

function firstBlockId(state: MergeDocumentState) {
  const id = state.regions[0]?.baseIdentity;
  if (!id) throw new Error("无冲突块");
  return id;
}

describe("V012-A 合并文档模型 · 状态创建与身份", () => {
  it("创建：draft=authoritative、revision=0、hash 与 region 绑定", () => {
    const state = createState();
    expect(state.draftContents).toBe(SVN_SINGLE);
    expect(state.authoritativeContents).toBe(SVN_SINGLE);
    expect(state.draftRevision).toBe(0);
    expect(state.workingContentHash).toBe(hashText(SVN_SINGLE));
    expect(state.draftContentHash).toBe(hashText(SVN_SINGLE));
    expect(state.regions.length).toBe(1);
    expect(state.regions[0]!.baseIdentity).toBeDefined();
    expect(Object.keys(state.originalRegions).length).toBe(1);
    expect(state.editorState.activeRegionBaseIdentity).toBe(
      state.regions[0]!.baseIdentity,
    );
  });

  it("多块：每个 region 携带 baseIdentity 快照", () => {
    const state = createState(MULTI_BLOCK);
    expect(state.regions.length).toBe(3);
    for (const region of state.regions) {
      expect(region.baseIdentity).toBeDefined();
      expect(state.originalRegions[region.baseIdentity!]!.anchorText).toContain(
        "<<<<<<<",
      );
    }
  });

  it("损坏 marker 的草稿恢复场景 fail-closed", () => {
    const damaged = "<<<<<<< .mine\n仅一侧\n";
    const result = createMergeDocument({
      repositoryRoot: REPO,
      relativePath: PATH,
      authoritativeContents: damaged,
      baseContents: "",
      scopeHash: SCOPE,
      workingCopyRevision: REV,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("parse-error");
  });
});

describe("V012-A · 程序化动作：mine/theirs/both 两顺序", () => {
  it("take-mine：替换为 mine 段，revision 递增", () => {
    const state = createState();
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: expectedOf(state),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.draftContents).toContain("我的修改-本地");
    expect(result.state.draftContents).not.toContain("对方修改-仓库r128");
    expect(result.state.draftContents).not.toContain("<<<<<<<");
    expect(result.state.draftRevision).toBe(1);
    expect(result.edits.length).toBe(1);
  });

  it("take-theirs：替换为 theirs 段", () => {
    const state = createState();
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-theirs",
      expected: expectedOf(state),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.draftContents).toContain("对方修改-仓库r128");
    expect(result.state.draftContents).not.toContain("我的修改-本地");
  });

  it("both 两顺序：mine-first 与 theirs-first 结果正确且不同", () => {
    const state = createState();
    const mineFirst = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-both",
      order: "mine-first",
      expected: expectedOf(state),
    });
    const theirsFirst = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-both",
      order: "theirs-first",
      expected: expectedOf(state),
    });
    expect(mineFirst.ok).toBe(true);
    expect(theirsFirst.ok).toBe(true);
    if (!mineFirst.ok || !theirsFirst.ok) return;
    expect(mineFirst.state.draftContents).not.toBe(
      theirsFirst.state.draftContents,
    );
    const mineText = mineFirst.state.draftContents;
    const theirsText = theirsFirst.state.draftContents;
    expect(mineText.indexOf("我的修改-本地")).toBeLessThan(
      mineText.indexOf("对方修改-仓库r128"),
    );
    /* theirs-first 为对称实现：先对方后我的，不是 mine-first 的字符串反转 */
    expect(theirsText.indexOf("对方修改-仓库r128")).toBeLessThan(
      theirsText.indexOf("我的修改-本地"),
    );
    /* 两侧内容都完整保留（对称拼接各自的原始段文本） */
    expect(theirsText).toContain("console.log(mineValue)");
    expect(theirsText).toContain("console.log(theirsValue)");
  });

  it("both 缺省顺序为 mine-first（沿用 git 冲突标记 mine 段在前的语义）", () => {
    const state = createState();
    const implicit = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-both",
      expected: expectedOf(state),
    });
    const explicit = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-both",
      order: "mine-first",
      expected: expectedOf(state),
    });
    if (!implicit.ok || !explicit.ok) throw new Error("both 应用失败");
    expect(implicit.state.draftContents).toBe(explicit.state.draftContents);
  });

  it("最小编辑：动作只覆盖 region 区间，块外文本不动", () => {
    const state = createState(MULTI_BLOCK);
    const before = state.regions[0]!;
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: before.baseIdentity,
      expected: expectedOf(state),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edits.length).toBe(1);
    expect(result.edits[0]!.start).toBe(before.start);
    expect(result.edits[0]!.end).toBe(before.end);
    expect(result.state.draftContents).toContain("块1我的");
    /* 其余块保持 marker 完整 */
    expect(result.state.draftContents).toContain("块2我的-中文测试");
    expect(result.state.draftContents).toContain("块3 HEAD");
    expect(result.state.regions.length).toBe(2);
  });
});

describe("V012-A · BOM/EOL/末尾换行保留", () => {
  it("BOM：动作后 \uFEFF 仍在文首", () => {
    const state = createState(BOM_SINGLE);
    expect(state.draftContents.startsWith("\uFEFF")).toBe(true);
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-both",
      order: "theirs-first",
      expected: expectedOf(state),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.draftContents.startsWith("\uFEFF")).toBe(true);
  });

  it("CRLF：region 内外行尾 \r\n 均保留，不被规范化为 \n", () => {
    const state = createState(CRLF_SINGLE);
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: expectedOf(state),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.draftContents).toContain("\r\n");
    expect(result.state.draftContents).toContain(
      '    const mineValue = "我的修改-本地";\r\n',
    );
    /* 块外 CRLF 行保持 */
    expect(result.state.draftContents).toContain("  }\r\n}");
  });

  it("CRLF + both：两侧段保留各自 \r\n", () => {
    const state = createState(CRLF_SINGLE);
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-both",
      order: "theirs-first",
      expected: expectedOf(state),
    });
    if (!result.ok) throw new Error(result.message);
    const text = result.state.draftContents;
    expect(text).toContain("\r\n");
    /* 两侧段内容按 \r\n 原样拼接，未被规范化为纯 \n 行 */
    expect(text).toContain('theirsValue = "对方修改-仓库r128";\r\n');
    expect(text).toContain('mineValue = "我的修改-本地";\r\n');
  });

  it("无末尾换行：动作不引入新的末尾换行", () => {
    const state = createState(NO_TRAILING_NEWLINE);
    expect(state.draftContents.endsWith("\n")).toBe(false);
    /* 文末块：mine 段带 \n，但文档无末尾换行 → 替换后仍不得引入末尾换行 */
    const lastRegion = state.regions[0]!;
    expect(lastRegion.end).toBe(state.draftContents.length);
    expect(lastRegion.mine.endsWith("\n")).toBe(true);
    const result = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: lastRegion.baseIdentity,
      expected: expectedOf(state),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.draftContents.endsWith("\n")).toBe(false);
    expect(result.state.draftContents).toContain("无末尾换行");
    /* 动作只作用于文末块，前文不动 */
    expect(result.state.draftContents.startsWith("const a = 1;\n")).toBe(true);
  });

  it("Git 无 BASE 与 NO_BASE fixture：两顺序均正确", () => {
    for (const fixture of [GIT_SINGLE, NO_BASE]) {
      const state = createState(fixture);
      for (const order of ["mine-first", "theirs-first"] as const) {
        const result = applyMergeAction(state, {
          expectedRevision: 0,
          action: "take-both",
          order,
          expected: expectedOf(state),
        });
        expect(result.ok).toBe(true);
      }
    }
  });
});

describe("V012-A · region 漂移重映射与失效", () => {
  it("前序编辑移动后续块：重映射后偏移正确且可对移动后的块继续动作", () => {
    const state = createState(MULTI_BLOCK);
    const first = state.regions[0]!;
    const second = state.regions[1]!;
    const third = state.regions[2]!;
    /* 对第一块 take-mine：第一块整段（含 base/theirs）被压缩为 1 行 mine，后续块左移 */
    const step1 = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(state),
    });
    if (!step1.ok) throw new Error(step1.message);
    const remappedSecond = step1.state.regions.find(
      (r) => r.baseIdentity === second.baseIdentity,
    );
    const remappedThird = step1.state.regions.find(
      (r) => r.baseIdentity === third.baseIdentity,
    );
    expect(remappedSecond).toBeDefined();
    expect(remappedThird).toBeDefined();
    expect(remappedSecond!.start).toBeLessThan(second.start);
    /* 对漂移后的第二块继续动作，作用于新位置而非旧行号 */
    const step2 = applyMergeAction(step1.state, {
      expectedRevision: 1,
      action: "take-theirs",
      regionBaseIdentity: second.baseIdentity,
      expected: expectedOf(step1.state),
    });
    if (!step2.ok) throw new Error(step2.message);
    expect(step2.state.draftContents).toContain("块2对方");
    expect(step2.state.draftContents).toContain("块3 HEAD");
    expect(step2.state.draftContents).not.toContain("块2我的-中文测试");
    /* 第三块仍未被误伤 */
    const finalThird = step2.state.regions.find(
      (r) => r.baseIdentity === third.baseIdentity,
    );
    expect(finalThird).toBeDefined();
  });

  it("remapRegionsAfterEdit：返回 baseIdentity 映射，失效块映射为 undefined", () => {
    const state = createState(MULTI_BLOCK);
    const first = state.regions[0]!;
    const step1 = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(state),
    });
    if (!step1.ok) throw new Error(step1.message);
    const remap = remapRegionsAfterEdit(step1.state, step1.state.draftContents);
    expect(remap.ok).toBe(true);
    if (!remap.ok) return;
    /* 已解决的第一块明确失效（映射为 undefined），而非沿用旧行号 */
    expect(remap.mapping[first.baseIdentity!]).toBeUndefined();
    const stillThere = Object.values(remap.mapping).filter(Boolean);
    expect(stillThere.length).toBe(2);
  });

  it("remapRegionsAfterEdit：基准文本与当前草稿不一致时拒绝", () => {
    const state = createState();
    const remap = remapRegionsAfterEdit(
      state,
      state.draftContents + "\n// 篡改",
    );
    expect(remap.ok).toBe(false);
    if (!remap.ok) expect(remap.code).toBe("expected-content-mismatch");
  });

  it("对已解决的块再次动作：region-invalidated，不按旧行号写入", () => {
    const state = createState(MULTI_BLOCK);
    const first = state.regions[0]!;
    const step1 = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(state),
    });
    if (!step1.ok) throw new Error(step1.message);
    const textBefore = step1.state.draftContents;
    const again = applyMergeAction(step1.state, {
      expectedRevision: 1,
      action: "take-theirs",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(step1.state),
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("region-invalidated");
    /* 状态未被修改 */
    expect(step1.state.draftContents).toBe(textBefore);
  });
});

describe("V012-A · 预期旧文本复核（呼应 VS Code Issue #159189）", () => {
  it("verifyExpectedContent：区间文本一致才通过", () => {
    const text = "abcdef";
    expect(
      verifyExpectedContent(text, { start: 1, end: 3, newText: "X" }, "bc"),
    ).toBe(true);
    expect(
      verifyExpectedContent(text, { start: 1, end: 3, newText: "X" }, "bX"),
    ).toBe(false);
  });

  it("applyTextEdits：多编辑降序应用互不干扰", () => {
    const text = "aaa bbb ccc";
    const next = applyTextEdits(text, [
      { start: 0, end: 3, newText: "AA" },
      { start: 8, end: 11, newText: "CCCC" },
    ]);
    expect(next).toBe("AA bbb CCCC");
  });

  it("Host 回执内容与当前草稿不一致时拒绝接管（不盲目覆盖）", () => {
    const state = createState();
    const result = acceptAuthoritativeAck(state, {
      scopeHash: SCOPE,
      workingCopyRevision: REV,
      acceptedDraftRevision: 0,
      authoritativeContents: SVN_SINGLE + "\n// 被外部改动",
      baseContents: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("expected-content-mismatch");
  });
});

describe("V012-A · draftRevision 单调递增与乱序拒绝", () => {
  it("连续动作/编辑 revision 严格递增", () => {
    let state = createState(MULTI_BLOCK);
    const ids = state.regions.map((r) => r.baseIdentity!);
    for (let i = 0; i < ids.length; i += 1) {
      const result = applyMergeAction(state, {
        expectedRevision: i,
        action: "take-mine",
        regionBaseIdentity: ids[i],
        expected: expectedOf(state),
      });
      if (!result.ok) throw new Error(result.message);
      expect(result.state.draftRevision).toBe(i + 1);
      state = result.state;
    }
    expect(state.regions.length).toBe(0);
  });

  it("旧 revision 重放被拒绝（fail-closed）", () => {
    const state = createState();
    const step1 = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: expectedOf(state),
    });
    if (!step1.ok) throw new Error(step1.message);
    const replay = applyMergeAction(step1.state, {
      expectedRevision: 0,
      action: "take-theirs",
      regionBaseIdentity: firstBlockId(createState()),
      expected: expectedOf(step1.state),
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("stale-revision");
  });

  it("乱序（超前）revision 被拒绝", () => {
    const state = createState();
    const future = applyMergeAction(state, {
      expectedRevision: 5,
      action: "take-mine",
      expected: expectedOf(state),
    });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.code).toBe("stale-revision");
  });

  it("手工编辑同样推进 revision 并拒绝乱序", () => {
    const state = createState();
    const edit = applyMergeEdit(state, {
      expectedRevision: 0,
      edit: { start: 0, end: 0, newText: "// 头部注释\n" },
    });
    if (!edit.ok) throw new Error(edit.message);
    expect(edit.state.draftRevision).toBe(1);
    expect(edit.state.draftContents.startsWith("// 头部注释\n")).toBe(true);
    const stale = applyMergeEdit(edit.state, {
      expectedRevision: 0,
      edit: { start: 0, end: 0, newText: "x" },
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("stale-revision");
  });

  it("非法编辑区间被拒绝", () => {
    const state = createState();
    const bad = applyMergeEdit(state, {
      expectedRevision: 0,
      edit: { start: -1, end: 2, newText: "x" },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid-action");
  });

  it("Host 身份过期：scope/revision/authoritative 变化后旧动作失效", () => {
    const state = createState();
    const staleScope = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: { ...expectedOf(state), scopeHash: "other-scope" },
    });
    expect(staleScope.ok).toBe(false);
    const staleRev = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: { ...expectedOf(state), workingCopyRevision: "r129" },
    });
    expect(staleRev.ok).toBe(false);
    const staleContent = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: {
        ...expectedOf(state),
        expectedAuthoritativeContents: "changed",
      },
    });
    expect(staleContent.ok).toBe(false);
    if (!staleContent.ok) expect(staleContent.code).toBe("stale-identity");
  });

  it("Host 回执只接管匹配的 draft revision；旧回执不覆盖后续输入", () => {
    const state = createState();
    const step1 = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: expectedOf(state),
    });
    if (!step1.ok) throw new Error(step1.message);
    /* 迟到回执（rev 0）不得覆盖 rev 1 的草稿 */
    const lateAck = acceptAuthoritativeAck(step1.state, {
      scopeHash: SCOPE,
      workingCopyRevision: REV,
      acceptedDraftRevision: 0,
      authoritativeContents: SVN_SINGLE,
      baseContents: "",
    });
    expect(lateAck.ok).toBe(false);
    if (!lateAck.ok) expect(lateAck.code).toBe("stale-revision");
    /* 匹配回执正常接管 */
    const ack = acceptAuthoritativeAck(step1.state, {
      scopeHash: SCOPE,
      workingCopyRevision: REV,
      acceptedDraftRevision: 1,
      authoritativeContents: step1.state.draftContents,
      baseContents: "const base = 2;\n",
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    expect(ack.state.authoritativeContents).toBe(step1.state.draftContents);
    expect(ack.state.workingContentHash).toBe(
      hashText(step1.state.draftContents),
    );
    expect(ack.state.baseContentHash).toBe(hashText("const base = 2;\n"));
  });
});

describe("V012-A · 手工修改判定（不盲目再次采用）", () => {
  it("未修改时不报手工修改，动作正常", () => {
    const state = createState();
    const id = firstBlockId(state);
    expect(isRegionManuallyModified(state, id)).toBe(false);
  });

  it("手工改写块内文本后判定为已手工修改，采用动作被拒绝", () => {
    const state = createState();
    const region = state.regions[0]!;
    /* 在 mine 段内插入用户文本（保持 marker 完整） */
    const mineStart = state.draftContents.indexOf("const mineValue");
    const edit = applyMergeEdit(state, {
      expectedRevision: 0,
      edit: {
        start: mineStart,
        end: mineStart,
        newText: "// 用户手工调整\n    ",
      },
    });
    if (!edit.ok) throw new Error(edit.message);
    const id = region.baseIdentity!;
    /* 手工插入改变 mine 段内容 → region 内容 hash 变化 → 旧块失效且可判定为手工修改 */
    expect(isRegionManuallyModified(edit.state, id)).toBe(true);
    const blocked = applyMergeAction(edit.state, {
      expectedRevision: 1,
      action: "take-theirs",
      regionBaseIdentity: id,
      expected: expectedOf(edit.state),
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("region-manually-modified");
    /* 恢复回打开时状态后可再次正常采用 */
    const restored = applyMergeAction(edit.state, {
      expectedRevision: 1,
      action: "restore-original",
      regionBaseIdentity: id,
      expected: expectedOf(edit.state),
    });
    if (!restored.ok) throw new Error(restored.message);
    const adopted = applyMergeAction(restored.state, {
      expectedRevision: 2,
      action: "take-theirs",
      regionBaseIdentity: id,
      expected: expectedOf(restored.state),
    });
    expect(adopted.ok).toBe(true);
  });

  it("手工编辑破坏 marker 后：regions 明确失效，程序化动作拒绝", () => {
    const state = createState();
    const markerIndex = state.draftContents.indexOf("<<<<<<<");
    const edit = applyMergeEdit(state, {
      expectedRevision: 0,
      edit: { start: markerIndex, end: markerIndex + 7, newText: "XXXXXXX" },
    });
    if (!edit.ok) throw new Error(edit.message);
    expect(edit.state.regions.length).toBe(0);
    const blocked = applyMergeAction(edit.state, {
      expectedRevision: 1,
      action: "take-mine",
      expected: expectedOf(edit.state),
    });
    expect(blocked.ok).toBe(false);
    /* 打开时快照仍在但当前文本中已不存在该块 → 判定为手工修改，fail-closed */
    if (!blocked.ok) expect(blocked.code).toBe("region-manually-modified");
  });
});

describe("V012-A · 恢复当前冲突块到打开时状态", () => {
  it("采用后可恢复回原始 marker 块", () => {
    const state = createState(MULTI_BLOCK);
    const first = state.regions[0]!;
    const step1 = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(state),
    });
    if (!step1.ok) throw new Error(step1.message);
    expect(step1.state.draftContents).not.toContain("块1基线");
    const restored = applyMergeAction(step1.state, {
      expectedRevision: 1,
      action: "restore-original",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(step1.state),
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.state.draftContents).toBe(MULTI_BLOCK);
    expect(restored.state.draftRevision).toBe(2);
    expect(restored.region?.mine).toContain("块1我的");
    /* 恢复后其他块不受影响 */
    expect(restored.state.regions.length).toBe(3);
  });

  it("手工改写后可恢复回打开时状态", () => {
    const state = createState();
    const region = state.regions[0]!;
    const mineStart = state.draftContents.indexOf("const mineValue");
    const edit = applyMergeEdit(state, {
      expectedRevision: 0,
      edit: { start: mineStart, end: mineStart + 5, newText: "REWRITTEN" },
    });
    if (!edit.ok) throw new Error(edit.message);
    const restored = applyMergeAction(edit.state, {
      expectedRevision: 1,
      action: "restore-original",
      regionBaseIdentity: region.baseIdentity,
      expected: expectedOf(edit.state),
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.state.draftContents).toBe(SVN_SINGLE);
  });

  it("锚点不唯一时拒绝恢复（不盲目替换第一处）", () => {
    /* 两个完全相同的冲突块 */
    const duplicated = [
      "<<<<<<< .mine",
      "same-mine",
      "=======",
      "same-theirs",
      ">>>>>>> .r1",
      "const mid = 0;",
      "<<<<<<< .mine",
      "same-mine",
      "=======",
      "same-theirs",
      ">>>>>>> .r1",
    ].join("\n");
    const state = createState(duplicated);
    const parsed = parseConflictRegions(duplicated);
    expect(parsed.regions.length).toBe(2);
    const first = state.regions[0]!;
    /* 内容相同的块共享同一 baseIdentity */
    expect(state.regions[1]!.baseIdentity).toBe(first.baseIdentity);
    /* 打开时锚点即不唯一（duplicateCount=2）：直接恢复被拒绝 */
    const restore = applyMergeAction(state, {
      expectedRevision: 0,
      action: "restore-original",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(state),
    });
    expect(restore.ok).toBe(false);
    if (!restore.ok) expect(restore.code).toBe("anchor-not-unique");
    /* 采用动作按 region 区间定位而非锚点，不受影响 */
    const adopt = applyMergeAction(state, {
      expectedRevision: 0,
      action: "take-mine",
      regionBaseIdentity: first.baseIdentity,
      expected: expectedOf(state),
    });
    expect(adopt.ok).toBe(true);
  });

  it("原始块文本被删除后拒绝恢复", () => {
    const state = createState();
    const region = state.regions[0]!;
    /* 手工删除整块 */
    const edit = applyMergeEdit(state, {
      expectedRevision: 0,
      edit: { start: region.start, end: region.end, newText: "" },
    });
    if (!edit.ok) throw new Error(edit.message);
    const restore = applyMergeAction(edit.state, {
      expectedRevision: 1,
      action: "restore-original",
      regionBaseIdentity: region.baseIdentity,
      expected: expectedOf(edit.state),
    });
    expect(restore.ok).toBe(false);
    if (!restore.ok) expect(restore.code).toBe("region-invalidated");
  });
});

describe("V012-A · editorState 仅界面状态", () => {
  it("updateEditorState 不推进 revision、不影响写入身份 hash", () => {
    const state = createState();
    const next = updateEditorState(state, {
      selection: { start: 10, end: 20 },
      viewport: { top: 100, left: 0 },
    });
    expect(next.draftRevision).toBe(0);
    expect(next.draftContentHash).toBe(state.draftContentHash);
    expect(next.workingContentHash).toBe(state.workingContentHash);
    expect(next.editorState.selection).toEqual({ start: 10, end: 20 });
    expect(next.editorState.viewport.top).toBe(100);
  });
});
