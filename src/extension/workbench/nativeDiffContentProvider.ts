import * as vscode from "vscode";

export const SVN_BASE_DOCUMENT_SCHEME = "svn-workbench-base";

/**
 * 只读 BASE 虚拟文档仓库。URI 只包含随机句柄；文件路径、仓库 URL 与凭据
 * 均保留在 Extension Host 的当前会话中，不进入 URI 或 Webview 消息。
 */
export class NativeDiffContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly documents = new Map<string, string>();
  private readonly sessionTokens = new Map<string, string>();

  createBaseUri(sessionId: string, content: string): vscode.Uri {
    this.releaseSession(sessionId);
    const token = globalThis.crypto.randomUUID();
    this.documents.set(token, content);
    this.sessionTokens.set(sessionId, token);
    return vscode.Uri.from({
      scheme: SVN_BASE_DOCUMENT_SCHEME,
      path: `/${token}`,
    });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const token = uri.path.slice(1);
    const content = this.documents.get(token);
    if (content === undefined) {
      throw new Error("BASE 对比文档已过期，请从 SVN Diff 窗口重新打开。");
    }
    return content;
  }

  releaseSession(sessionId: string): void {
    const token = this.sessionTokens.get(sessionId);
    if (!token) return;
    this.sessionTokens.delete(sessionId);
    this.documents.delete(token);
  }

  dispose(): void {
    this.documents.clear();
    this.sessionTokens.clear();
  }
}
