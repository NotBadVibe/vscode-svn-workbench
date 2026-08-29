import { describe, expect, it } from "vitest";
import {
  buildConflictFileIdentity,
  buildConflictFileModel,
  buildConflictRegionIdentity,
  buildPierreUnresolvedInput,
  hashText,
  parseConflictRegions,
} from "../../src/conflict/conflictDiffModel";
import {
  BOM_SINGLE,
  CRLF_SINGLE,
  DAMAGED_MISSING_END,
  DAMAGED_MISSING_SEPARATOR,
  DAMAGED_NESTED,
  GIT_SINGLE,
  LONG_LINE,
  MULTI_BLOCK,
  NO_BASE,
  NO_TRAILING_NEWLINE,
  PERF_5000,
  SVN_SINGLE,
  SWAP_MINE_THEIRS,
} from "../../src/conflict/fixtures";

describe("conflictDiffModel", () => {
  it("生成稳定 FileIdentity 与 ContentHash（品牌类型，路径归一）", () => {
    const id1 = buildConflictFileIdentity("/repo/root", "src/a.ts");
    const id2 = buildConflictFileIdentity("/repo/root", "src/a.ts");
    expect(id1).toBe(id2);
    const id3 = buildConflictFileIdentity("/repo/root", "src/b.ts");
    expect(id1).not.toBe(id3);
    const h1 = hashText("hello");
    const h2 = hashText("hello");
    expect(h1).toBe(h2);
    expect(hashText("hello")).not.toBe(hashText("world"));
  });

  it("SVN 真实 marker 顺序按位置映射 Mine/Theirs/Base（不凭字面名）", () => {
    const { regions, error } = parseConflictRegions(SVN_SINGLE);
    expect(error).toBeUndefined();
    expect(regions).toHaveLength(1);
    expect(regions[0].mine).toContain("我的修改-本地");
    expect(regions[0].base).toContain("共同基线");
    expect(regions[0].theirs).toContain("对方修改-仓库r128");
    expect(regions[0].hasBase).toBe(true);
    // Git 无 BASE 仍按位置判定
    const git = parseConflictRegions(GIT_SINGLE);
    expect(git.regions[0].mine).toContain("我的-HEAD-中文");
    expect(git.regions[0].theirs).toContain("对方分支-仓库");
    expect(git.regions[0].hasBase).toBe(false);
  });

  it("current/incoming 位置映射由 fixture 证明：交换内容后仍按位置判定", () => {
    const normal = parseConflictRegions(SWAP_MINE_THEIRS.normal);
    const swapped = parseConflictRegions(SWAP_MINE_THEIRS.swapped);
    expect(normal.regions[0].mine).toBe("AAA-mine\n");
    expect(normal.regions[0].theirs).toBe("BBB-theirs\n");
    expect(swapped.regions[0].mine).toBe("BBB-theirs\n");
    expect(swapped.regions[0].theirs).toBe("AAA-mine\n");
    // 若错误地按字面名映射，交换后仍会返回 AAA 为 mine，测试会失败
  });

  it("CRLF、BOM、末尾换行不被静默规范化", () => {
    const crlf = parseConflictRegions(CRLF_SINGLE);
    expect(crlf.error).toBeUndefined();
    expect(crlf.regions[0].mine).toContain("我的修改");
    // 原始文本的 CRLF 仍保留在 rawWorkingText 与 mine 原始切片中
    const modelCRLF = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: CRLF_SINGLE,
      baseText: "base",
      mineText: "mine",
      theirsText: "theirs",
    });
    expect(modelCRLF.rawWorkingText).toBe(CRLF_SINGLE);
    expect(modelCRLF.rawWorkingText.includes("\r\n")).toBe(true);

    const bom = parseConflictRegions(BOM_SINGLE);
    expect(bom.error).toBeUndefined();
    expect(bom.regions[0].mine).toContain("我的修改");
    const modelBOM = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: BOM_SINGLE,
      baseText: "",
      mineText: "",
      theirsText: "",
    });
    expect(modelBOM.rawWorkingText.charCodeAt(0)).toBe(0xfeff);
    expect(modelBOM.workingHash).toBe(hashText(BOM_SINGLE));

    const noEol = parseConflictRegions(NO_TRAILING_NEWLINE);
    expect(noEol.error).toBeUndefined();
    expect(noEol.regions).toHaveLength(1);
    const modelNoEol = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: NO_TRAILING_NEWLINE,
      baseText: "",
      mineText: "",
      theirsText: "",
    });
    expect(modelNoEol.rawWorkingText.endsWith("\n")).toBe(false);
  });

  it("无 BASE marker 正常解析且 hasBase=false", () => {
    const { regions, error } = parseConflictRegions(NO_BASE);
    expect(error).toBeUndefined();
    expect(regions[0].hasBase).toBe(false);
    expect(regions[0].base).toBeUndefined();
    const model = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: NO_BASE,
      baseText: "",
      mineText: "mine",
      theirsText: "theirs",
      theirsRevision: "r88",
    });
    expect(model.hasBase).toBe(false);
    expect(model.display.theirsLabel).toContain("r88");
  });

  it("损坏 marker 返回结构化原因，不猜测、不自动修复", () => {
    const missSep = parseConflictRegions(DAMAGED_MISSING_SEPARATOR);
    expect(missSep.error?.code).toBe("missingSeparator");
    expect(missSep.regions).toHaveLength(0);
    const missEnd = parseConflictRegions(DAMAGED_MISSING_END);
    expect(missEnd.error?.code).toBe("unfinished");
    const nested = parseConflictRegions(DAMAGED_NESTED);
    expect(nested.error?.code).toBe("nested");
    // buildPierreUnresolvedInput 同样返回 error
    const pierre = buildPierreUnresolvedInput(DAMAGED_MISSING_SEPARATOR);
    expect(pierre.error?.code).toBe("missingSeparator");
    expect(pierre.file.contents).toBe(DAMAGED_MISSING_SEPARATOR);
  });

  it("超长行与多块正确解析", () => {
    const long = parseConflictRegions(LONG_LINE);
    expect(long.error).toBeUndefined();
    expect(long.regions[0].mine.length).toBeGreaterThan(5000);
    const multi = parseConflictRegions(MULTI_BLOCK);
    expect(multi.error).toBeUndefined();
    expect(multi.regions).toHaveLength(3);
    expect(multi.regions[0].mine).toContain("块1我的");
    expect(multi.regions[1].mine).toContain("块2我的");
    expect(multi.regions[2].mine).toContain("块3 HEAD");
  });

  it("5000 行级 fixture 仍可解析且性能可接受", () => {
    const start = Date.now();
    const { regions, error } = parseConflictRegions(PERF_5000);
    const elapsed = Date.now() - start;
    expect(error).toBeUndefined();
    expect(regions.length).toBeGreaterThan(40);
    expect(elapsed).toBeLessThan(1000);
  });

  it("显示模型明确四角色中文标签", () => {
    const model = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: SVN_SINGLE,
      baseText: "base",
      mineText: "mine",
      theirsText: "theirs",
      theirsRevision: "r128",
    });
    expect(model.display.mineLabel).toBe("我的修改（本地）");
    expect(model.display.baseLabel).toBe("共同基线（BASE）");
    expect(model.display.theirsLabel).toBe("对方修改（仓库 r128）");
    expect(model.display.mergedLabel).toBe("合并结果");
    // 无 revision 时显示通用标签
    const noRev = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: GIT_SINGLE,
      baseText: "",
      mineText: "",
      theirsText: "",
    });
    expect(noRev.display.theirsLabel).toBe("对方修改（仓库）");
  });

  it("RegionIdentity 稳定且不依赖索引（hash 驱动）", () => {
    const fileId = buildConflictFileIdentity("/repo", "src/a.ts");
    const model1 = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: MULTI_BLOCK,
      baseText: "",
      mineText: "",
      theirsText: "",
    });
    const secondRegionIdBefore = model1.regions[1].identity;
    // 移除首个冲突块后，原第二块的 identity 应保持不变（基于内容 hash，非索引）
    const truncatedWorking = [
      "export const header = 1;",
      "export const middle = 2;",
      "<<<<<<< .mine",
      'const block2Mine = "块2我的-中文测试";',
      "||||||| .r101",
      'const block2Base = "块2基线";',
      "=======",
      'const block2Theirs = "块2对方";',
      ">>>>>>> .r101",
      "export const footer = 3;",
      "<<<<<<< HEAD",
      'const block3Head = "块3 HEAD";',
      "=======",
      'const block3Incoming = "块3 incoming";',
      ">>>>>>> branch3",
    ].join("\n");
    const model2 = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: truncatedWorking,
      baseText: "",
      mineText: "",
      theirsText: "",
    });
    expect(model2.regions[0].mine).toContain("块2我的");
    expect(model2.regions[0].identity).toBe(secondRegionIdBefore);
    // 手动计算的 identity 应一致
    const hash = hashText(
      `${model2.regions[0].mine}\u0000${model2.regions[0].base ?? ""}\u0000${model2.regions[0].theirs}`,
    );
    expect(buildConflictRegionIdentity(fileId, hash)).toBe(
      model2.regions[0].identity,
    );
  });

  it("内容变化导致 hash 失效", () => {
    const base = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: SVN_SINGLE,
      baseText: "base",
      mineText: "mine",
      theirsText: "theirs",
    });
    const changed = buildConflictFileModel({
      repositoryRoot: "/repo",
      relativePath: "src/a.ts",
      workingText: SVN_SINGLE.replace("我的修改-本地", "我的修改-已改"),
      baseText: "base",
      mineText: "mine",
      theirsText: "theirs",
    });
    expect(base.workingHash).not.toBe(changed.workingHash);
    expect(base.regions[0].identity).not.toBe(changed.regions[0].identity);
  });

  it("Pierre 输入构造：成功时透传 Working 文本，失败时返回结构化错误", () => {
    const ok = buildPierreUnresolvedInput(SVN_SINGLE);
    expect(ok.error).toBeUndefined();
    expect(ok.file.contents).toBe(SVN_SINGLE);
    const bad = buildPierreUnresolvedInput(DAMAGED_MISSING_END);
    expect(bad.error?.code).toBe("unfinished");
  });
});
