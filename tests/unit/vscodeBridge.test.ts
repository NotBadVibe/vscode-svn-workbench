import { describe, expect, it, vi } from "vitest";
import { workbenchBridge } from "../../src/webview/bridge/vscodeBridge";

/*
 * v0.1.0（V010-E）bridge 消息边界过滤：@pierre/diffs 编辑器的后台
 * tokenizer 通过 globalThis.postMessage 自调度（{type:"tokenize"}），
 * 不得被当作 Host 消息进入 workbenchState（否则误触发“协议版本不兼容”）。
 */
describe("vscodeBridge window 消息过滤（v0.1.0）", () => {
  it("放行具备工作台信封结构的消息", () => {
    const listener = vi.fn();
    const dispose = workbenchBridge.subscribe(listener);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          protocolVersion: 2,
          type: "operation/result",
          moduleId: "diff",
          payload: {},
        },
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
    dispose();
  });

  it("拦截没有工作台信封结构的第三方消息（如 pierre tokenize）", () => {
    const listener = vi.fn();
    const dispose = workbenchBridge.subscribe(listener);
    const foreign = [
      { type: "tokenize", tokenizerId: 1, jobId: 1 },
      { type: "success", id: 1, requestType: "diff" },
      "字符串消息",
      null,
      42,
    ];
    for (const data of foreign) {
      window.dispatchEvent(new MessageEvent("message", { data }));
    }
    expect(listener).not.toHaveBeenCalled();
    dispose();
  });

  it("带 protocolVersion 的版本不匹配消息仍放行（走既有协议错误页）", () => {
    const listener = vi.fn();
    const dispose = workbenchBridge.subscribe(listener);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { protocolVersion: 999, type: "app/initialize" },
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
    dispose();
  });
});
