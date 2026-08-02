import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Webview Content Security Policy', () => {
  it('allows Vite dynamic import chunks from the Webview resource origin', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/extension/workbench/renderWebviewShell.ts'),
      'utf8'
    );

    expect(source).toContain("script-src 'nonce-${nonce}' ${webview.cspSource}");
  });
});
