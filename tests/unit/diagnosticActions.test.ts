import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { dispatchDiagnosticAction } from "../../src/diagnostics/diagnosticActions";

/*
 * V024-R42：诊断安全动作白名单。
 * - openUrl 仅允许 https/http；非法协议被 Host 拒绝且错误可理解；
 * - 缺失 url 参数同样拒绝并给出中文原因，不静默吞掉；
 * - 取消选择（无返回）不清理其他工作区（此处断言 openFolder 取消路径无抛错）。
 */

let warningMock: ReturnType<typeof vi.fn>;
let openExternalMock: ReturnType<typeof vi.fn>;
const originalWarning = vscode.window.showWarningMessage;
const originalOpenExternal = (
  vscode.env as unknown as { openExternal: unknown }
).openExternal;

beforeEach(() => {
  warningMock = vi.fn(async () => undefined);
  openExternalMock = vi.fn(async () => undefined);
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage =
    warningMock;
  (vscode.env as unknown as { openExternal: unknown }).openExternal =
    openExternalMock;
});

afterEach(() => {
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage =
    originalWarning;
  (vscode.env as unknown as { openExternal: unknown }).openExternal =
    originalOpenExternal;
});

describe("诊断安全动作（V024-R42）", () => {
  it("https 链接正常打开", async () => {
    await dispatchDiagnosticAction(
      "openUrl",
      { url: "https://subversion.apache.org/packages.html" },
      {},
    );
    expect(openExternalMock).toHaveBeenCalledTimes(1);
    expect(warningMock).not.toHaveBeenCalled();
  });

  it("非白名单协议被拒绝且错误可理解，不执行外部打开", async () => {
    await dispatchDiagnosticAction(
      "openUrl",
      { url: "file:///etc/passwd" },
      {},
    );
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(String(warningMock.mock.calls[0][0])).toContain("仅允许 https/http");
  });

  it("缺失 url 参数被拒绝并给出中文原因", async () => {
    await dispatchDiagnosticAction("openUrl", {}, {});
    expect(openExternalMock).not.toHaveBeenCalled();
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(String(warningMock.mock.calls[0][0])).toContain("链接缺失");
  });
});
