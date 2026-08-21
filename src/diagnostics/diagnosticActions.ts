import * as vscode from "vscode";
import type { DiagnosticActionId } from "../protocol/workbenchProtocol";

/**
 * 诊断动作执行器（v0.0.15 批次 A）
 * - 仅通过 VS Code 设置/API 修改本地环境，不自动修改系统
 * - 选择 SVN 可执行文件仅写 `svnWorkbench.svn.path`，凭据/私密信息不进入 Webview
 * - 执行后由调用方负责原地重检（重新发送 diagnostics 快照）
 */

export async function handleSelectSvnExecutable(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "选择 SVN 可执行文件",
    title: "选择 SVN 可执行文件（svn / svn.exe）",
    // 不设 filters：macOS/Linux 的 `svn` 无扩展名，设 ["exe",""] 会导致不可选
  });
  if (!picked || picked.length === 0) return undefined;
  const fsPath = picked[0].fsPath;
  // 仅写 VS Code 设置，不触及系统环境
  await vscode.workspace
    .getConfiguration("svnWorkbench")
    .update("svn.path", fsPath, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`已将 SVN 路径设置为：${fsPath}`);
  return fsPath;
}

export async function handleOpenSettings(query?: string): Promise<void> {
  // query 例如 "svnWorkbench.svn.path" 或 "svnWorkbench.ai"
  if (query) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      query,
    );
  } else {
    await vscode.commands.executeCommand("workbench.action.openSettings");
  }
}

export async function handleOpenFolder(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "打开文件夹",
    title: "打开 SVN 工作副本所在文件夹",
  });
  if (!picked || picked.length === 0) return;
  // 由用户点击触发，显式打开文件夹
  await vscode.commands.executeCommand("vscode.openFolder", picked[0], {
    forceNewWindow: false,
  });
}

export async function handleCopyDiagnostics(reportText: string): Promise<void> {
  await vscode.env.clipboard.writeText(reportText);
  vscode.window.showInformationMessage("诊断信息已复制到剪贴板。");
}

export async function handleOpenUrl(url: string): Promise<void> {
  if (!url) return;
  // 安全：仅允许 https/http，且 url 必须来自 Host 侧诊断动作参数，Webview 自由文本不入 openExternal
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      vscode.window.showWarningMessage(
        `不支持的链接协议：${parsed.protocol}，仅允许 https/http。`,
      );
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch {
    vscode.window.showWarningMessage(`无效的链接：${url}`);
  }
}

/**
 * 统一分发（供 WorkbenchController 调用）
 * 返回是否需要原地重检（true 表示调用方应重新发送诊断快照）
 */
export async function dispatchDiagnosticAction(
  id: DiagnosticActionId,
  params: Record<string, unknown> | undefined,
  context: { reportText?: string },
): Promise<boolean> {
  switch (id) {
    case "selectSvnExecutable": {
      await handleSelectSvnExecutable();
      return true;
    }
    case "openSettings": {
      const query = params?.query as string | undefined;
      await handleOpenSettings(query);
      return false;
    }
    case "rerunDiagnostics": {
      return true;
    }
    case "openFolder": {
      await handleOpenFolder();
      return false;
    }
    case "copyDiagnostics": {
      const text = (params?.text as string) ?? context.reportText ?? "";
      await handleCopyDiagnostics(text);
      return false;
    }
    case "openUrl": {
      const url = params?.url as string | undefined;
      if (url) await handleOpenUrl(url);
      return false;
    }
    default:
      return false;
  }
}
