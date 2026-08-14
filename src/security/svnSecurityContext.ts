import {
  isSameOrDescendantPath,
  normalizePathIdentity,
} from "../scope/pathIdentity";

export type SvnCertificateFailure =
  "unknown-ca" | "cn-mismatch" | "expired" | "not-yet-valid" | "other";

export interface SvnAuthenticationContext {
  username: string;
  password: string;
}

export interface SvnCertificateTrustContext {
  host: string;
  fingerprint: string;
  failures: SvnCertificateFailure[];
  scope: "once" | "permanent";
}

export interface SvnSecurityContext {
  authentication?: SvnAuthenticationContext;
  certificateTrust?: SvnCertificateTrustContext;
}

export interface SvnSecurityInvocation {
  args: string[];
  safeArgs: string[];
  stdin?: string;
}

const contexts = new Map<string, SvnSecurityContext>();

/** 仓库根路径归一化（跨平台大小写）键；供注册表与控制器比较用。 */
export function normalizeSvnRepositoryRoot(value: string): string {
  return normalizePathIdentity(value);
}

/** 测试辅助：清空模块级上下文，避免用例之间互相污染。 */
export function resetSvnSecurityContextForTesting(): void {
  contexts.clear();
}

export function setSvnSecurityContext(
  repositoryRoot: string,
  context: SvnSecurityContext | undefined,
): void {
  const key = normalizePathIdentity(repositoryRoot);
  if (!context || (!context.authentication && !context.certificateTrust)) {
    contexts.delete(key);
    return;
  }
  contexts.set(key, cloneContext(context));
}

export function clearSvnSecurityContext(repositoryRoot: string): void {
  contexts.delete(normalizePathIdentity(repositoryRoot));
}

export function resolveSvnSecurityContext(
  cwd: string | undefined,
): SvnSecurityContext | undefined {
  if (!cwd) return undefined;
  const candidate = normalizePathIdentity(cwd);
  let matched: [string, SvnSecurityContext] | undefined;
  for (const entry of contexts.entries()) {
    if (isSameOrDescendantPath(candidate, entry[0])) {
      if (!matched || entry[0].length > matched[0].length) matched = entry;
    }
  }
  return matched ? cloneContext(matched[1]) : undefined;
}

export function buildSvnSecurityInvocation(
  args: string[],
  context: SvnSecurityContext | undefined,
): SvnSecurityInvocation {
  if (!context?.authentication && !context?.certificateTrust) {
    return { args: [...args], safeArgs: [...args] };
  }

  const actual = [...args];
  const safe = [...args];
  let stdin: string | undefined;

  if (!actual.includes("--non-interactive")) {
    actual.push("--non-interactive");
    safe.push("--non-interactive");
  }

  if (context.authentication) {
    actual.push(
      "--username",
      context.authentication.username,
      "--password-from-stdin",
    );
    safe.push("--username", "<redacted-username>", "--password-from-stdin");
    stdin = `${context.authentication.password}\n`;
  }

  if (context.certificateTrust) {
    const failures = normalizeCertificateFailures(
      context.certificateTrust.failures,
    );
    actual.push(`--trust-server-cert-failures=${failures.join(",")}`);
    safe.push(`--trust-server-cert-failures=${failures.join(",")}`);
  }

  if (context.certificateTrust?.scope !== "permanent") {
    actual.push("--no-auth-cache");
    safe.push("--no-auth-cache");
  } else if (context.authentication) {
    // 永久证书信任需要 SVN 写入证书缓存，但不得顺带缓存密码。
    actual.push(
      "--config-option",
      "servers:global:store-passwords=no",
      "--config-option",
      "servers:global:store-plaintext-passwords=no",
    );
    safe.push(
      "--config-option",
      "servers:global:store-passwords=no",
      "--config-option",
      "servers:global:store-plaintext-passwords=no",
    );
  }

  return { args: actual, safeArgs: safe, stdin };
}

export function normalizeCertificateFailures(
  values: readonly SvnCertificateFailure[],
): SvnCertificateFailure[] {
  const allowed = new Set<SvnCertificateFailure>([
    "unknown-ca",
    "cn-mismatch",
    "expired",
    "not-yet-valid",
    "other",
  ]);
  const unique = [...new Set(values.filter((value) => allowed.has(value)))];
  return unique.length > 0 ? unique : ["other"];
}

function cloneContext(context: SvnSecurityContext): SvnSecurityContext {
  return {
    authentication: context.authentication
      ? { ...context.authentication }
      : undefined,
    certificateTrust: context.certificateTrust
      ? {
          ...context.certificateTrust,
          failures: [...context.certificateTrust.failures],
        }
      : undefined,
  };
}
