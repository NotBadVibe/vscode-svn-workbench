import { describe, expect, it } from "vitest";
import {
  hashChangelistPlan,
  isSameChangelistPlan,
  normalizeChangelistPlan,
} from "../../src/changelist/changelistPlan";

/*
 * V020-R08 · 变更集方案指纹（纯逻辑，平台无关：只用字符串归一化与排序，
 * 不做平台路径解析；夹具使用 posix 风格相对路径，任意平台执行结果一致）。
 */
describe("normalizeChangelistPlan", () => {
  it("名称去首尾空白，路径去空白去重排序", () => {
    expect(
      normalizeChangelistPlan({
        name: "  ui  ",
        remove: false,
        paths: ["b.ts", "a.ts", "a.ts", "  "],
      }),
    ).toEqual({ name: "ui", remove: false, paths: ["a.ts", "b.ts"] });
  });

  it("移出方向忽略名称", () => {
    expect(
      normalizeChangelistPlan({
        name: "ui",
        remove: true,
        paths: ["a.ts"],
      }),
    ).toEqual({ name: "", remove: true, paths: ["a.ts"] });
  });
});

describe("hashChangelistPlan", () => {
  it("路径顺序不影响指纹", () => {
    expect(
      hashChangelistPlan({ name: "ui", remove: false, paths: ["b", "a"] }),
    ).toBe(
      hashChangelistPlan({ name: "ui", remove: false, paths: ["a", "b"] }),
    );
  });

  it("名称、路径、方向变化改变指纹", () => {
    const base = hashChangelistPlan({
      name: "ui",
      remove: false,
      paths: ["a"],
    });
    expect(
      hashChangelistPlan({ name: "ui-renamed", remove: false, paths: ["a"] }),
    ).not.toBe(base);
    expect(
      hashChangelistPlan({ name: "ui", remove: false, paths: ["a", "b"] }),
    ).not.toBe(base);
    expect(
      hashChangelistPlan({ name: "ui", remove: true, paths: ["a"] }),
    ).not.toBe(base);
  });

  it("名称首尾空白不改变指纹", () => {
    expect(
      hashChangelistPlan({ name: " ui ", remove: false, paths: ["a"] }),
    ).toBe(hashChangelistPlan({ name: "ui", remove: false, paths: ["a"] }));
  });
});

describe("isSameChangelistPlan", () => {
  it("改名、删路径、改方向均判定不一致", () => {
    const base = { name: "ui", remove: false, paths: ["a", "b"] };
    expect(
      isSameChangelistPlan(base, {
        name: "ui",
        remove: false,
        paths: ["b", "a"],
      }),
    ).toBe(true);
    expect(
      isSameChangelistPlan(base, {
        name: "ui2",
        remove: false,
        paths: ["a", "b"],
      }),
    ).toBe(false);
    expect(
      isSameChangelistPlan(base, { name: "ui", remove: false, paths: ["a"] }),
    ).toBe(false);
    expect(
      isSameChangelistPlan(base, {
        name: "ui",
        remove: true,
        paths: ["a", "b"],
      }),
    ).toBe(false);
  });
});
