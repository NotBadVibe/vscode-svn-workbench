import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/diagnostics/outputChannel', () => ({
  appendOutput: vi.fn(),
  sanitizeDiagnostic: (value: string) => value
}));

import { runSvnCommand } from '../../src/svn/svnCommandRunner';
import { clearSvnSecurityContext, setSvnSecurityContext } from '../../src/security/svnSecurityContext';

describe('runSvnCommand', () => {
  it('uses stable English command messages without replacing the character locale', async () => {
    const result = await runSvnCommand(process.execPath, [
      '-e',
      'console.log(JSON.stringify({lcMessages:process.env.LC_MESSAGES,language:process.env.LANGUAGE,lang:process.env.LANG}))'
    ]);

    expect(JSON.parse(result.stdout)).toEqual({
      lcMessages: 'C',
      language: 'en',
      ...(process.env.LANG === undefined ? {} : { lang: process.env.LANG })
    });
  });

  it('terminates a running process when the operation is cancelled', async () => {
    const controller = new AbortController();
    const resultPromise = runSvnCommand(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10_000)'],
      undefined,
      { signal: controller.signal }
    );

    controller.abort();
    const result = await resultPromise;

    expect(result.cancelled).toBe(true);
    expect(result.stderr).toBe('操作已取消。');
    expect(result.durationMs).toBeLessThan(5_000);
  });

  it('caps command output and terminates the producer at the configured limit', async () => {
    const result = await runSvnCommand(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(200000))'],
      undefined,
      { maxOutputBytes: 1024 }
    );
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1024);
    expect(result.stderr).toContain('输出超过安全上限');
  });

  it('writes credentials to stdin while keeping observable command arguments redacted', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'svn-runner-security-'));
    const script = path.join(cwd, 'read-stdin.js');
    await fs.writeFile(script, `let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>value+=c);process.stdin.on('end',()=>console.log(JSON.stringify({length:value.trim().length,args:process.argv.slice(2)})));`, 'utf8');
    setSvnSecurityContext(cwd, { authentication: { username: 'alice@example.test', password: 'secret-value' } });
    try {
      const result = await runSvnCommand(process.execPath, [script], cwd);
      expect(result.exitCode).toBe(0);
      expect(result.args.join(' ')).not.toContain('alice@example.test');
      expect(result.args.join(' ')).not.toContain('secret-value');
      expect(result.stdout).not.toContain('secret-value');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({ length: 12 }));
    } finally {
      clearSvnSecurityContext(cwd);
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
