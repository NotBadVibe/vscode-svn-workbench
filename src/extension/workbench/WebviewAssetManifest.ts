import * as vscode from "vscode";

interface ViteManifestEntry {
  file: string;
  css?: string[];
  isEntry?: boolean;
}

type ViteManifest = Record<string, ViteManifestEntry>;

export interface WebviewAssets {
  scriptUri: vscode.Uri;
  styleUris: vscode.Uri[];
  localResourceRoot: vscode.Uri;
}

export async function readWebviewAssets(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): Promise<WebviewAssets> {
  const localResourceRoot = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "webview",
  );
  const manifestUri = vscode.Uri.joinPath(
    localResourceRoot,
    ".vite",
    "manifest.json",
  );
  let manifest: ViteManifest;

  try {
    const contents = await vscode.workspace.fs.readFile(manifestUri);
    manifest = JSON.parse(
      Buffer.from(contents).toString("utf8"),
    ) as ViteManifest;
  } catch (error) {
    throw new Error(
      `Svelte Webview 构建产物不存在或无法读取。请运行 npm run build:webview。${
        error instanceof Error ? ` ${error.message}` : ""
      }`,
      { cause: error },
    );
  }

  const entry =
    manifest["index.html"] ??
    Object.values(manifest).find((item) => item.isEntry);
  if (!entry?.file) {
    throw new Error("Svelte Webview manifest 中没有找到 index.html 入口。");
  }

  return {
    scriptUri: webview.asWebviewUri(
      vscode.Uri.joinPath(localResourceRoot, entry.file),
    ),
    styleUris: (entry.css ?? []).map((file) =>
      webview.asWebviewUri(vscode.Uri.joinPath(localResourceRoot, file)),
    ),
    localResourceRoot,
  };
}
