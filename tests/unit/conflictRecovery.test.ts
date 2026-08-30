/**
 * V013-F 冲突恢复纯领域模型单元测试（中文注释）
 * 覆盖：isNonTextKind / getNonTextInfo / RECOVERY_CATALOG / deriveRecoveryItems / hasMarkerRemaining / 非文本禁用 take-both 判定
 */
import { describe, expect, it } from "vitest";
import {
  RECOVERY_CATALOG,
  deriveRecoveryItems,
  getNonTextInfo,
  hasMarkerRemaining,
  isNonTextKind,
} from "../../src/conflict/conflictRecovery";

// 辅助：12 个恢复目录 key，与源码一一对应
const EXPECTED_KEYS = [
  "tokenExpired",
  "diskChanged",
  "documentDirty",
  "targetMoved",
  "writeFailed",
  "markerRemaining",
  "previewExpired",
  "svnStatusChanged",
  "resolveFailed",
  "resolveCancelled",
  "updateOriginClosed",
  "reacquireFailed",
] as const;

// 中文字符检测：至少包含一个中文字符
function containsChinese(s: string): boolean {
  return /[\u4e00-\u9fa5]/.test(s);
}

describe("isNonTextKind：非文本类型判定", () => {
  it("tree/property/binary 为 true", () => {
    expect(isNonTextKind("tree")).toBe(true);
    expect(isNonTextKind("property")).toBe(true);
    expect(isNonTextKind("binary")).toBe(true);
  });

  it("text 为 false", () => {
    expect(isNonTextKind("text")).toBe(false);
  });

  it("undefined/空字符串/未知类型为 false", () => {
    expect(isNonTextKind(undefined)).toBe(false);
    expect(isNonTextKind("")).toBe(false);
    expect(isNonTextKind("unknown")).toBe(false);
  });
});

describe("getNonTextInfo：非文本冲突中文说明与 resolveHint", () => {
  it("tree 返回树冲突说明且包含 svn resolve --accept 选项", () => {
    const info = getNonTextInfo("tree");
    expect(info.kind).toBe("tree");
    expect(info.label).toBe("树冲突");
    expect(info.description).toContain("树冲突");
    expect(containsChinese(info.description)).toBe(true);
    expect(info.resolveHint).toContain("svn resolve");
    expect(info.resolveHint).toContain("--accept");
    // 中文注释：树冲突不可按文本合并
    expect(info.description).toContain("无法按文本合并处理");
  });

  it("property 返回属性冲突说明且包含 svn resolve --accept 选项", () => {
    const info = getNonTextInfo("property");
    expect(info.kind).toBe("property");
    expect(info.label).toBe("属性冲突");
    expect(info.description).toContain("属性冲突");
    expect(containsChinese(info.description)).toBe(true);
    expect(info.resolveHint).toContain("svn resolve");
    expect(info.resolveHint).toContain("--accept");
  });

  it("binary 返回二进制冲突说明且包含 svn resolve --accept 选项", () => {
    const info = getNonTextInfo("binary");
    expect(info.kind).toBe("binary");
    expect(info.label).toBe("二进制冲突");
    expect(info.description).toContain("二进制冲突");
    expect(containsChinese(info.description)).toBe(true);
    expect(info.resolveHint).toContain("svn resolve");
    expect(info.resolveHint).toContain("--accept");
  });

  it("text/未知返回通用非文本兜底（空/不支持分支）", () => {
    // 源码对非 tree/property/binary 走 default 分支，返回通用说明
    const textInfo = getNonTextInfo("text");
    expect(textInfo.label).toBe("非文本冲突");
    expect(containsChinese(textInfo.description)).toBe(true);
    expect(textInfo.description).toContain("无法按文本合并处理");
    expect(textInfo.resolveHint).toContain("svn resolve");

    const undefInfo = getNonTextInfo(undefined);
    expect(undefInfo.label).toBe("非文本冲突");
    expect(containsChinese(undefInfo.description)).toBe(true);

    const unknownInfo = getNonTextInfo("unknown" as unknown as string);
    expect(unknownInfo.label).toBe("非文本冲突");
  });

  it("三类非文本的 resolveHint 均包含 mine-full/theirs-full 选项说明", () => {
    for (const k of ["tree", "property", "binary"] as const) {
      const hint = getNonTextInfo(k).resolveHint;
      expect(hint).toContain("mine-full");
      expect(hint).toContain("theirs-full");
    }
  });
});

describe("RECOVERY_CATALOG：12 项恢复目录完整性", () => {
  it("包含全部 12 个 key", () => {
    expect(Object.keys(RECOVERY_CATALOG)).toHaveLength(12);
    for (const k of EXPECTED_KEYS) {
      expect(RECOVERY_CATALOG[k]).toBeDefined();
    }
  });

  it("每项 id 与 key 一致且 testId 非空", () => {
    for (const k of EXPECTED_KEYS) {
      const item = RECOVERY_CATALOG[k];
      expect(item.id).toBe(k);
      expect(item.testId.length).toBeGreaterThan(0);
      expect(item.testId).toContain("recovery-");
    }
  });

  it("每项都包含「发生了什么/可能原因/恢复动作」三段中文", () => {
    for (const k of EXPECTED_KEYS) {
      const item = RECOVERY_CATALOG[k];
      // 发生了什么
      expect(item.what).toContain("发生了什么");
      expect(containsChinese(item.what)).toBe(true);
      // 可能原因
      expect(item.cause).toContain("可能原因");
      expect(containsChinese(item.cause)).toBe(true);
      // 恢复动作
      expect(item.recovery).toContain("恢复动作");
      expect(containsChinese(item.recovery)).toBe(true);
      // 三段均为中文非空
      expect(item.what.length).toBeGreaterThan(5);
      expect(item.cause.length).toBeGreaterThan(5);
      expect(item.recovery.length).toBeGreaterThan(5);
    }
  });

  it("每项至少有一个恢复出口 actions", () => {
    for (const k of EXPECTED_KEYS) {
      const item = RECOVERY_CATALOG[k];
      expect(item.actions.length).toBeGreaterThanOrEqual(1);
      // 动作均为合法 RecoveryActionId
      for (const a of item.actions) {
        expect([
          "retry",
          "copyDraft",
          "exportDraft",
          "repreview",
          "refresh",
          "viewDetail",
          "openInEditor",
          "openExternal",
          "close",
        ]).toContain(a);
      }
    }
  });

  it("各项 actions 符合预期语义（抽检）", () => {
    // 保存类 5 项均支持草稿保留
    expect(RECOVERY_CATALOG.tokenExpired.actions).toEqual(
      expect.arrayContaining(["retry", "copyDraft", "exportDraft"]),
    );
    expect(RECOVERY_CATALOG.diskChanged.actions).toEqual(
      expect.arrayContaining(["retry", "copyDraft", "exportDraft"]),
    );
    expect(RECOVERY_CATALOG.markerRemaining.actions).toEqual(["retry"]);
    expect(RECOVERY_CATALOG.previewExpired.actions).toEqual(
      expect.arrayContaining(["repreview"]),
    );
    expect(RECOVERY_CATALOG.svnStatusChanged.actions).toEqual(
      expect.arrayContaining(["refresh", "viewDetail"]),
    );
    expect(RECOVERY_CATALOG.resolveFailed.actions).toEqual(
      expect.arrayContaining(["retry", "viewDetail"]),
    );
    expect(RECOVERY_CATALOG.resolveCancelled.actions).toEqual(
      expect.arrayContaining(["repreview", "close"]),
    );
  });
});

describe("hasMarkerRemaining：冲突标记残留检测", () => {
  it("含全部三类 marker 则为 true", () => {
    const text =
      "before\n<<<<<<< .mine\nmine content\n=======\ntheirs content\n>>>>>>> .r10\nafter";
    expect(hasMarkerRemaining(text)).toBe(true);
  });

  it("干净文本为 false", () => {
    expect(hasMarkerRemaining("干净文本，无冲突标记")).toBe(false);
    expect(hasMarkerRemaining("hello world\n")).toBe(false);
    expect(hasMarkerRemaining("")).toBe(false);
  });

  it("仅含部分 marker 为 false（需三者齐全）", () => {
    expect(hasMarkerRemaining("<<<<<<< .mine\nonly one")).toBe(false);
    expect(hasMarkerRemaining("<<<<<<< .mine\n=======\nonly two")).toBe(false);
    expect(hasMarkerRemaining("=======\n>>>>>>> .r1")).toBe(false);
    expect(hasMarkerRemaining("<<< 和 >>> 但缺少分隔符")).toBe(false);
  });

  it("空字符串/undefined 兼容为 false", () => {
    // 源码对 !text 直接返回 false
    expect(hasMarkerRemaining("")).toBe(false);
    expect(hasMarkerRemaining(undefined as unknown as string)).toBe(false);
  });
});

describe("deriveRecoveryItems：给定错误状态推导恢复项", () => {
  it("tokenExpired：feedback 含令牌+过期", () => {
    const items = deriveRecoveryItems({ feedback: "保存失败，编辑令牌已过期" });
    expect(items.some((i) => i.id === "tokenExpired")).toBe(true);
    expect(items.find((i) => i.id === "tokenExpired")?.what).toContain(
      "令牌已过期",
    );
  });

  it("diskChanged：feedback 含磁盘+变化", () => {
    const items = deriveRecoveryItems({ feedback: "磁盘内容已变化" });
    expect(items.some((i) => i.id === "diskChanged")).toBe(true);
  });

  it("documentDirty：feedback 含未保存内容", () => {
    const a = deriveRecoveryItems({ feedback: "存在未保存内容，拒绝覆盖" });
    expect(a.some((i) => i.id === "documentDirty")).toBe(true);
    const b = deriveRecoveryItems({ feedback: "编辑器中存在未保存" });
    expect(b.some((i) => i.id === "documentDirty")).toBe(true);
  });

  it("targetMoved：feedback 含已移动/不存在/已删除", () => {
    expect(
      deriveRecoveryItems({ feedback: "目标文件已移动" }).some(
        (i) => i.id === "targetMoved",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "路径不存在" }).some(
        (i) => i.id === "targetMoved",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "文件已删除" }).some(
        (i) => i.id === "targetMoved",
      ),
    ).toBe(true);
  });

  it("writeFailed：feedback 含写入失败/写失败", () => {
    expect(
      deriveRecoveryItems({ feedback: "写入失败" }).some(
        (i) => i.id === "writeFailed",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "写失败，权限不足" }).some(
        (i) => i.id === "writeFailed",
      ),
    ).toBe(true);
  });

  it("markerRemaining：workingText 含三标记则命中", () => {
    const workingText =
      "a\n<<<<<<< .mine\nmine\n=======\ntheirs\n>>>>>>> .r1\n";
    const items = deriveRecoveryItems({ workingText });
    expect(items.some((i) => i.id === "markerRemaining")).toBe(true);
  });

  it("markerRemaining：feedback 含冲突标记也命中", () => {
    const items = deriveRecoveryItems({ feedback: "仍检测到冲突标记" });
    expect(items.some((i) => i.id === "markerRemaining")).toBe(true);
  });

  it("previewExpired：hasPreviewExpired 或 feedback 含预览已过期", () => {
    expect(
      deriveRecoveryItems({ hasPreviewExpired: true }).some(
        (i) => i.id === "previewExpired",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "预览已过期" }).some(
        (i) => i.id === "previewExpired",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "预览令牌失效" }).some(
        (i) => i.id === "previewExpired",
      ),
    ).toBe(true);
  });

  it("svnStatusChanged：标志或 feedback 命中", () => {
    expect(
      deriveRecoveryItems({ svnStatusChanged: true }).some(
        (i) => i.id === "svnStatusChanged",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "不是冲突状态" }).some(
        (i) => i.id === "svnStatusChanged",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "SVN 状态已被外部改变" }).some(
        (i) => i.id === "svnStatusChanged",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "svn 状态已变化" }).some(
        (i) => i.id === "svnStatusChanged",
      ),
    ).toBe(true);
  });

  it("resolveFailed：hasResolveError 或 feedback 含标记解决失败", () => {
    expect(
      deriveRecoveryItems({ hasResolveError: true }).some(
        (i) => i.id === "resolveFailed",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "标记解决失败" }).some(
        (i) => i.id === "resolveFailed",
      ),
    ).toBe(true);
  });

  it("resolveCancelled：hasResolveCancelled 或 feedback 含已取消", () => {
    expect(
      deriveRecoveryItems({ hasResolveCancelled: true }).some(
        (i) => i.id === "resolveCancelled",
      ),
    ).toBe(true);
    expect(
      deriveRecoveryItems({ feedback: "操作已取消" }).some(
        (i) => i.id === "resolveCancelled",
      ),
    ).toBe(true);
  });

  it("updateOriginClosed：标志位直接命中", () => {
    const items = deriveRecoveryItems({ updateOriginClosed: true });
    expect(items.some((i) => i.id === "updateOriginClosed")).toBe(true);
  });

  it("reacquireFailed：标志位直接命中", () => {
    const items = deriveRecoveryItems({ reacquireFailed: true });
    expect(items.some((i) => i.id === "reacquireFailed")).toBe(true);
  });

  it("issues 数组也会参与匹配（feedback + issues 合并）", () => {
    const items = deriveRecoveryItems({ issues: ["令牌已过期"] });
    expect(items.some((i) => i.id === "tokenExpired")).toBe(true);
  });

  it("多项并发时全部列出", () => {
    const workingText = "<<<<<<< .mine\nmine\n=======\ntheirs\n>>>>>>> .r1";
    const items = deriveRecoveryItems({
      feedback: "令牌已过期，仍检测到冲突标记，标记解决失败",
      workingText,
      hasResolveError: true,
      hasPreviewExpired: true,
      svnStatusChanged: true,
      updateOriginClosed: true,
      reacquireFailed: true,
      hasResolveCancelled: true,
    });
    const ids = items.map((i) => i.id);
    // 至少包含这些并发项
    expect(ids).toEqual(expect.arrayContaining(["tokenExpired"]));
    expect(ids).toEqual(expect.arrayContaining(["markerRemaining"]));
    expect(ids).toEqual(expect.arrayContaining(["previewExpired"]));
    expect(ids).toEqual(expect.arrayContaining(["svnStatusChanged"]));
    expect(ids).toEqual(expect.arrayContaining(["resolveFailed"]));
    expect(ids).toEqual(expect.arrayContaining(["resolveCancelled"]));
    expect(ids).toEqual(expect.arrayContaining(["updateOriginClosed"]));
    expect(ids).toEqual(expect.arrayContaining(["reacquireFailed"]));
    // 数量应 >= 并发数，去重后不少于 8
    expect(new Set(ids).size).toBeGreaterThanOrEqual(8);
  });

  it("无错误时返回空数组", () => {
    expect(deriveRecoveryItems({})).toEqual([]);
    expect(
      deriveRecoveryItems({ feedback: "一切正常", workingText: "clean" }),
    ).toEqual([]);
    expect(
      deriveRecoveryItems({ feedback: "", issues: [], workingText: "" }),
    ).toEqual([]);
  });

  it("markerRemaining 不重复添加（workingText 与 feedback 同时命中只计一次）", () => {
    const workingText = "<<<<<<< .mine\nx\n=======\ny\n>>>>>>> .r1";
    const items = deriveRecoveryItems({
      feedback: "仍包含冲突标记",
      workingText,
    });
    const count = items.filter((i) => i.id === "markerRemaining").length;
    expect(count).toBe(1);
  });
});

describe("非文本分支：禁用 take-both 判定", () => {
  it("非文本分支 isNonTextKind 为 true，提示需禁用 take-both", () => {
    // 源码中 Webview 通过 isNonTextKind 控制 disableTakeBoth = isNonTextBranch
    // 此处验证该判定：非文本应禁用 take-both，文本不应禁用
    const disableTakeBoth = (kind: string | undefined) => isNonTextKind(kind);
    expect(disableTakeBoth("tree")).toBe(true);
    expect(disableTakeBoth("property")).toBe(true);
    expect(disableTakeBoth("binary")).toBe(true);
    expect(disableTakeBoth("text")).toBe(false);
    expect(disableTakeBoth(undefined)).toBe(false);
  });

  it("非文本分支 getNonTextInfo 提示不提供文本合并，仅提供 svn resolve", () => {
    for (const k of ["tree", "property", "binary"] as const) {
      const info = getNonTextInfo(k);
      // 中文注释：本页面不提供文本合并或需在外部工具处理
      expect(
        info.resolveHint.includes("不提供文本合并") ||
          info.resolveHint.includes("外部工具") ||
          info.resolveHint.includes("属性视图"),
      ).toBe(true);
      // resolveHint 必须包含 svn resolve 选项，但不应误导为文本合并
      expect(info.resolveHint).toContain("svn resolve");
    }
  });

  it("deriveRecoveryItems 在非文本分支下 marker 检查仍生效（不与文本混用）", () => {
    // 非文本标记残留仍应提示继续编辑，与 Webview 逻辑 isNonTextBranch 分离一致
    const items = deriveRecoveryItems({
      workingText: "<<<<<<< .mine\nmine\n=======\ntheirs\n>>>>>>> .r1",
      conflictKind: "tree",
    });
    expect(items.some((i) => i.id === "markerRemaining")).toBe(true);
  });
});
