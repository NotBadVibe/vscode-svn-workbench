import { describe, expect, it } from "vitest";
import {
  COMMIT_MESSAGE_MAX_LENGTH,
  diffDraftAgainstSuggestion,
  insertSuggestionBlankFields,
  replaceDraftWithSuggestion,
} from "../../src/commit/commitMessageSuggestion";

/*
 * v0.0.9 §4 提交说明建议草稿纯逻辑：
 * - 插入空白字段只补充、不删除、不改写用户已填内容；
 * - 替换前校验（空 / 相同 / 超限）并返回中文原因；
 * - 差异对比为行级多重集比较，供建议区展示。
 */

describe("insertSuggestionBlankFields", () => {
  it("当前草稿为空时以建议作为可编辑草稿（唯一不触发覆盖的入口语义）", () => {
    const suggestion = "范围: \n影响: ";
    const outcome = insertSuggestionBlankFields("", suggestion);
    expect(outcome.message).toBe(suggestion);
    expect(outcome.inserted).toEqual([]);
  });

  it("只插入建议中用户尚未填写的空白字段，保留已填内容", () => {
    const outcome = insertSuggestionBlankFields(
      "需求: 修复登录超时\n范围: 全部",
      "需求: \n范围: \n影响: \n风险: ",
    );
    expect(outcome.message).toBe(
      "需求: 修复登录超时\n范围: 全部\n影响: \n风险: ",
    );
    expect(outcome.inserted).toEqual(["影响: ", "风险: "]);
  });

  it("支持全角冒号与缩进标签", () => {
    const outcome = insertSuggestionBlankFields(
      "需求：修复登录超时",
      "需求：\n  原因：\n  风险：",
    );
    expect(outcome.message).toBe("需求：修复登录超时\n  原因：\n  风险：");
    expect(outcome.inserted).toEqual(["  原因：", "  风险："]);
  });

  it("重复插入幂等：第二次不再重复插入已存在字段", () => {
    const suggestion = "影响: \n风险: ";
    const once = insertSuggestionBlankFields("影响: 已评估", suggestion);
    expect(once.message).toBe("影响: 已评估\n风险: ");
    expect(once.inserted).toEqual(["风险: "]);
    const twice = insertSuggestionBlankFields(once.message, suggestion);
    expect(twice.message).toBe(once.message);
    expect(twice.inserted).toEqual([]);
  });

  it("建议中没有新的空白字段时草稿保持不变", () => {
    const outcome = insertSuggestionBlankFields(
      "范围: 全部\n影响: 已评估",
      "范围: 全部\n影响: 已评估\n风险: 低",
    );
    expect(outcome.message).toBe("范围: 全部\n影响: 已评估");
    expect(outcome.inserted).toEqual([]);
  });

  it("不把已填值行当作空白字段（值为空才插入）", () => {
    const outcome = insertSuggestionBlankFields(
      "需求: 已有需求",
      "需求: 已有需求\n原因: 新原因",
    );
    expect(outcome.message).toBe("需求: 已有需求");
    expect(outcome.inserted).toEqual([]);
  });
});

describe("replaceDraftWithSuggestion", () => {
  it("合法替换返回修剪后的建议正文", () => {
    const outcome = replaceDraftWithSuggestion("旧草稿", "  范围: 全部  \n");
    expect(outcome).toEqual({ ok: true, message: "范围: 全部" });
  });

  it("建议内容为空时拒绝并给出中文原因", () => {
    const outcome = replaceDraftWithSuggestion("旧草稿", "  \n ");
    expect(outcome).toEqual({
      ok: false,
      reason: "建议内容为空，未替换当前草稿。",
    });
  });

  it("建议与当前草稿相同时拒绝，避免无意义替换", () => {
    const outcome = replaceDraftWithSuggestion("范围: 全部", "范围: 全部");
    expect(outcome).toEqual({
      ok: false,
      reason: "建议内容与当前草稿相同，未重复替换。",
    });
  });

  it("超过字符上限时拒绝并说明限制", () => {
    const outcome = replaceDraftWithSuggestion(
      "旧草稿",
      `x${"长".repeat(COMMIT_MESSAGE_MAX_LENGTH)}`,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain("2000");
    }
  });
});

describe("diffDraftAgainstSuggestion", () => {
  it("完全相同时无新增、无移除", () => {
    const diff = diffDraftAgainstSuggestion("范围: 全部", "范围: 全部");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(1);
  });

  it("新增行进入 added，当前草稿独有行进入 removed", () => {
    const diff = diffDraftAgainstSuggestion(
      "需求: 修复登录超时\n风险: 高",
      "需求: 修复登录超时\n影响: 涉及登录模块",
    );
    expect(diff.added).toEqual(["影响: 涉及登录模块"]);
    expect(diff.removed).toEqual(["风险: 高"]);
    expect(diff.unchanged).toBe(1);
  });

  it("相同行的多重集计数：重复行只抵消一次", () => {
    const diff = diffDraftAgainstSuggestion(
      "范围: 全部\n范围: 全部",
      "范围: 全部\n影响: 新增",
    );
    expect(diff.added).toEqual(["影响: 新增"]);
    expect(diff.removed).toEqual(["范围: 全部"]);
    expect(diff.unchanged).toBe(1);
  });

  it("不修改入参（输入不变异）", () => {
    const current = "范围: 全部";
    const suggestion = "范围: 全部\n影响: 新增";
    const currentCopy = current;
    const suggestionCopy = suggestion;
    diffDraftAgainstSuggestion(current, suggestion);
    expect(current).toBe(currentCopy);
    expect(suggestion).toBe(suggestionCopy);
  });
});
