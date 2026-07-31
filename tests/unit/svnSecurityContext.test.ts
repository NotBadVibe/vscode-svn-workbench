import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSvnSecurityInvocation,
  clearSvnSecurityContext,
  resolveSvnSecurityContext,
  setSvnSecurityContext,
  normalizeCertificateFailures
} from '../../src/security/svnSecurityContext';

const root = path.resolve('/tmp/svn-security-context');

afterEach(() => clearSvnSecurityContext(root));

describe('SVN security context', () => {
  it('passes passwords through stdin and redacts username from observable args', () => {
    const invocation = buildSvnSecurityInvocation(['info', '.'], {
      authentication: { username: 'alice@example.test', password: 'super-secret' }
    });

    expect(invocation.args).toContain('--password-from-stdin');
    expect(invocation.args).toContain('alice@example.test');
    expect(invocation.args).not.toContain('super-secret');
    expect(invocation.safeArgs).not.toContain('alice@example.test');
    expect(invocation.safeArgs.join(' ')).not.toContain('super-secret');
    expect(invocation.stdin).toBe('super-secret\n');
    expect(invocation.args).toContain('--no-auth-cache');
  });

  it('builds explicit one-time certificate trust without caching auth data', () => {
    const invocation = buildSvnSecurityInvocation(['info', '.'], {
      certificateTrust: {
        host: 'svn.example.test',
        fingerprint: 'AA:BB',
        failures: ['unknown-ca', 'expired'],
        scope: 'once'
      }
    });

    expect(invocation.args).toContain('--trust-server-cert-failures=unknown-ca,expired');
    expect(invocation.args).toContain('--non-interactive');
    expect(invocation.args).toContain('--no-auth-cache');
  });

  it('allows SVN to persist an explicitly approved certificate while disabling password storage', () => {
    const invocation = buildSvnSecurityInvocation(['info', '.'], {
      authentication: { username: 'alice', password: 'secret' },
      certificateTrust: { host: 'svn.example.test', fingerprint: 'AA:BB', failures: ['unknown-ca'], scope: 'permanent' }
    });

    expect(invocation.args).not.toContain('--no-auth-cache');
    expect(invocation.args).toContain('servers:global:store-passwords=no');
    expect(invocation.args).toContain('servers:global:store-plaintext-passwords=no');
  });

  it('resolves the most specific registered repository context', () => {
    setSvnSecurityContext(root, { authentication: { username: 'root', password: 'one' } });
    setSvnSecurityContext(path.join(root, 'external'), { authentication: { username: 'external', password: 'two' } });

    expect(resolveSvnSecurityContext(path.join(root, 'src'))?.authentication?.username).toBe('root');
    expect(resolveSvnSecurityContext(path.join(root, 'external', 'src'))?.authentication?.username).toBe('external');

    clearSvnSecurityContext(path.join(root, 'external'));
  });

  it('覆盖空上下文、已有非交互参数、永久纯证书和非法失败类型', () => {
    expect(buildSvnSecurityInvocation(['status'], undefined)).toEqual({ args: ['status'], safeArgs: ['status'] });
    const auth = buildSvnSecurityInvocation(['status', '--non-interactive'], {
      authentication: { username: 'a', password: 'b' }
    });
    expect(auth.args.filter((item) => item === '--non-interactive')).toHaveLength(1);
    const certificateOnly = buildSvnSecurityInvocation(['info'], {
      certificateTrust: { host: 'h', fingerprint: 'f', failures: [], scope: 'permanent' }
    });
    expect(certificateOnly.args).not.toContain('--no-auth-cache');
    expect(certificateOnly.args).not.toContain('servers:global:store-passwords=no');
    expect(certificateOnly.args).toContain('--trust-server-cert-failures=other');
    expect(normalizeCertificateFailures(['expired', 'expired', 'invalid' as never])).toEqual(['expired']);
  });

  it('删除空上下文并拒绝无 cwd 或范围外的匹配', () => {
    setSvnSecurityContext(root, { authentication: { username: 'a', password: 'b' } });
    expect(resolveSvnSecurityContext(undefined)).toBeUndefined();
    expect(resolveSvnSecurityContext(path.resolve('/outside'))).toBeUndefined();
    setSvnSecurityContext(root, {});
    expect(resolveSvnSecurityContext(root)).toBeUndefined();
    setSvnSecurityContext(root, undefined);
  });
});
