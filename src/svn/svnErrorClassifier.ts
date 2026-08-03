export type SvnErrorCategory =
  | "authentication"
  | "certificate"
  | "network"
  | "working-copy-locked"
  | "interrupted"
  | "cli-missing"
  | "generic";

export interface SvnFailureClassification {
  category: SvnErrorCategory;
  label: string;
  guidance: string[];
  networkKind?:
    "dns" | "proxy" | "offline" | "timeout" | "connection-refused" | "unknown";
  recoveryModule?: "repository";
}

export interface SvnCertificateDetails {
  host?: string;
  fingerprint?: string;
  issuer?: string;
  validFrom?: string;
  validUntil?: string;
  failures: Array<
    "unknown-ca" | "cn-mismatch" | "expired" | "not-yet-valid" | "other"
  >;
}

export function classifySvnFailure(message: string): SvnFailureClassification {
  const value = message.toLowerCase();
  if (
    /e170001|e215004|authorization failed|authentication failed|could not authenticate|username.*password/.test(
      value,
    )
  ) {
    return {
      category: "authentication",
      label: "认证失败",
      guidance: [
        "使用“配置认证”通过 VS Code 安全输入凭据后重试。",
        "密码只通过标准输入交给 SVN，不进入命令参数、settings、Webview 快照或日志。",
      ],
    };
  }
  if (
    /e230001|certificate verification failed|server certificate verification failed|ssl certificate/.test(
      value,
    )
  ) {
    return {
      category: "certificate",
      label: "证书校验失败",
      guidance: [
        "核对下方服务器主机、证书指纹、有效期和失败原因。",
        "只有确认指纹可信后，才能选择仅本次信任或由 SVN 永久缓存。",
      ],
    };
  }
  if (
    /e170013|e670002|could not resolve hostname|name or service not known|getaddrinfo|connection timed out|\btimeout\b|etimedout|connection refused|econnrefused|network is unreachable|no route to host|enetunreach|\boffline\b|proxy/.test(
      value,
    )
  ) {
    const networkKind = classifyNetworkFailureKind(value);
    const labels = {
      dns: "DNS 解析失败",
      proxy: "SVN 代理异常",
      offline: "网络不可达或离线",
      timeout: "网络连接超时",
      "connection-refused": "服务器拒绝连接",
      unknown: "网络连接异常",
    } as const;
    return {
      category: "network",
      label: labels[networkKind],
      networkKind,
      guidance: networkGuidance(networkKind),
    };
  }
  if (
    /e155004|e200033|working copy.*locked|database is locked|run.*cleanup/.test(
      value,
    )
  ) {
    return {
      category: "working-copy-locked",
      label: "工作副本被锁定",
      guidance: [
        "确认没有其他 SVN 进程正在操作该工作副本。",
        "在仓库恢复区检查范围后执行 svn cleanup；不会自动删除未版本化文件。",
      ],
      recoveryModule: "repository",
    };
  }
  if (
    /e155037|previous operation has not finished|operation.*interrupted|operation.*unfinished/.test(
      value,
    )
  ) {
    return {
      category: "interrupted",
      label: "检测到未完成操作",
      guidance: [
        "先检查工作副本状态和冲突，再决定 cleanup、revert 或继续处理。",
        "不要复用之前生成的提交或更新预览。",
      ],
      recoveryModule: "repository",
    };
  }
  if (
    /enoent|command not found|not recognized.*command|spawn.*svn/.test(value)
  ) {
    return {
      category: "cli-missing",
      label: "找不到 SVN CLI",
      guidance: [
        "在设置中配置 svnWorkbench.svn.path，或将 svn 加入 PATH。",
        "诊断模块仍可打开，所有写操作保持禁用。",
      ],
    };
  }
  return {
    category: "generic",
    label: "SVN 操作失败",
    guidance: ["打开诊断与输出查看脱敏详情，修复后重新加载当前模块。"],
  };
}

function classifyNetworkFailureKind(
  value: string,
): NonNullable<SvnFailureClassification["networkKind"]> {
  if (/proxy/.test(value)) return "proxy";
  if (
    /e670002|could not resolve hostname|name or service not known|getaddrinfo/.test(
      value,
    )
  )
    return "dns";
  if (/network is unreachable|no route to host|offline|enetunreach/.test(value))
    return "offline";
  if (/timed out|timeout|etimedout/.test(value)) return "timeout";
  if (/connection refused|econnrefused/.test(value))
    return "connection-refused";
  return "unknown";
}

function networkGuidance(
  kind: NonNullable<SvnFailureClassification["networkKind"]>,
): string[] {
  const specific = {
    dns: "检查 DNS、VPN 和仓库主机名是否可以解析。",
    proxy: "检查 SVN servers 配置中的代理主机、端口与认证信息。",
    offline: "恢复网络或 VPN 后重试；离线状态不会被当作“没有远端更新”。",
    timeout: "检查网络质量、防火墙和服务器状态后重试。",
    "connection-refused": "确认 SVN 服务地址、端口和服务器进程是否正确。",
    unknown: "检查网络、VPN、DNS、代理和 SVN 服务状态后重试。",
  } as const;
  return [
    specific[kind],
    "远端检查失败不会被当作“没有更新”，旧预览也不能继续执行。",
  ];
}

export function extractSvnCertificateDetails(
  message: string,
): SvnCertificateDetails {
  const hostFromUrl = matchFirst(
    message,
    /(?:certificate\s+for|certificate\s+from|validating server certificate for)\s+['"](https?:\/\/[^'"\s]+)['"]/i,
  );
  const explicitHost = matchFirst(message, /^\s*-?\s*Hostname:\s*(.+)$/im);
  const validRange = message.match(
    /^\s*-?\s*Valid:\s*from\s+(.+?)\s+until\s+(.+)$/im,
  );
  const value = message.toLowerCase();
  const failures: SvnCertificateDetails["failures"] = [];
  if (
    /unknown-ca|not issued by a trusted authority|unknown certificate issuer|unable to get local issuer/.test(
      value,
    )
  )
    failures.push("unknown-ca");
  if (
    /cn-mismatch|hostname mismatch|hostname does not match|does not match certificate/.test(
      value,
    )
  )
    failures.push("cn-mismatch");
  if (/not-yet-valid|not yet valid/.test(value)) failures.push("not-yet-valid");
  if (/\bexpired\b|has expired/.test(value)) failures.push("expired");
  if (failures.length === 0) failures.push("other");

  return {
    host: normalizeCertificateHost(hostFromUrl, explicitHost),
    fingerprint: matchFirst(
      message,
      /^\s*-?\s*(?:SHA-?256\s+)?Fingerprint:\s*([A-Fa-f0-9: -]+)$/im,
    )
      ?.replace(/[ -]/g, ":")
      .replace(/:{2,}/g, ":")
      .toUpperCase(),
    issuer: matchFirst(message, /^\s*-?\s*Issuer:\s*(.+)$/im),
    validFrom:
      validRange?.[1]?.trim() ||
      matchFirst(message, /^\s*-?\s*Valid from:\s*(.+)$/im),
    validUntil:
      validRange?.[2]?.trim() ||
      matchFirst(message, /^\s*-?\s*Valid until:\s*(.+)$/im),
    failures: [...new Set(failures)],
  };
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1]?.trim();
}

function normalizeCertificateHost(
  urlValue: string | undefined,
  explicitHost: string | undefined,
): string | undefined {
  if (urlValue) {
    try {
      const url = new URL(urlValue);
      return url.port ? `${url.hostname}:${url.port}` : url.hostname;
    } catch {
      // Fall through to the explicitly printed hostname.
    }
  }
  return explicitHost?.trim();
}
