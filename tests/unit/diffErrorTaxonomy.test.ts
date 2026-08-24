import { describe, expect, it } from "vitest";
import {
  DiffStageError,
  classifyDiffRenderError,
  diffErrorInfo,
  type DiffErrorKind,
} from "../../src/webview/features/diff/diffErrorTaxonomy";

describe("diffErrorTaxonomy（v0.1.0 V010-E 结构化错误分类）", () => {
  it("每种错误类型都具备发生了什么/可能原因/现在能做什么三要素", () => {
    const kinds: DiffErrorKind[] = [
      "pierre-mount-failed",
      "patch-parse-empty",
      "highlight-load-failed",
      "csp-style-failed",
      "editor-attach-failed",
      "content-binary",
      "content-truncated",
      "no-base",
      "invalid-encoding",
      "target-stale",
    ];
    for (const kind of kinds) {
      const info = diffErrorInfo(kind);
      expect(info.kind).toBe(kind);
      expect(info.what.length).toBeGreaterThan(0);
      expect(info.cause.length).toBeGreaterThan(0);
      expect(info.recovery.length).toBeGreaterThan(0);
    }
  });

  it("DiffStageError 按标记阶段精确分类", () => {
    expect(
      classifyDiffRenderError(new DiffStageError("patch-parse", "空 patch"))
        .kind,
    ).toBe("patch-parse-empty");
    expect(
      classifyDiffRenderError(new DiffStageError("mount", "挂载失败")).kind,
    ).toBe("pierre-mount-failed");
    expect(
      classifyDiffRenderError(new DiffStageError("editor-attach", "附加失败"))
        .kind,
    ).toBe("editor-attach-failed");
  });

  it("未标记异常按信息启发式分类，默认归为挂载失败", () => {
    expect(
      classifyDiffRenderError(new Error("CSP blocked inline style")).kind,
    ).toBe("csp-style-failed");
    expect(classifyDiffRenderError(new Error("未知异常")).kind).toBe(
      "pierre-mount-failed",
    );
    expect(classifyDiffRenderError("字符串异常").kind).toBe(
      "pierre-mount-failed",
    );
  });

  it("DiffStageError 保留原始原因供诊断", () => {
    const cause = new Error("底层异常");
    const error = new DiffStageError("mount", "挂载失败", { cause });
    expect(error.cause).toBe(cause);
    expect(error.stage).toBe("mount");
    expect(error.name).toBe("DiffStageError");
  });
});
