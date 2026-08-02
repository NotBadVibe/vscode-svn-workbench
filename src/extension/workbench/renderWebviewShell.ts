import * as vscode from 'vscode';
import { WebviewAssets } from './WebviewAssetManifest';

export function renderWebviewShell(webview: vscode.Webview, assets: WebviewAssets): string {
  const nonce = createNonce();
  const styles = assets.styleUris
    .map((uri) => `<link rel="stylesheet" href="${escapeAttribute(uri.toString())}">`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src 'none';">
    ${styles}
    <title>SVN 工作台</title>
  </head>
  <body>
    <div id="app" role="application" aria-label="SVN 工作台"></div>
    <script type="module" nonce="${nonce}" src="${escapeAttribute(assets.scriptUri.toString())}"></script>
  </body>
</html>`;
}

export function renderWebviewBuildError(message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SVN 工作台</title></head>
  <body><main><h1>SVN 工作台无法加载</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
