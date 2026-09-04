/**
 * V018-F · 外部合并工具单元测试（安全敏感）
 * - 参数数组无 shell 注入（空格/引号/分号路径保持单元素）；
 * - 未配置降级（fail-closed，不猜测执行）；
 * - 路径范围校验 fail-closed；
 * - 确认展示完整（四角色标签 + 外部修改警告）。
 */
import { describe, expect, it } from "vitest";
import {
  areExternalMergePathsInScope,
  buildExternalMergeArgs,
  buildExternalMergeCandidates,
  buildExternalMergeConfirmSummary,
  collectExternalMergeRolePaths,
  describeExternalMergeTool,
  EXTERNAL_MERGE_TOOL_TIMEOUT_MS,
  formatExternalMergeCommandPreview,
  knownExternalMergeToolBasenames,
  validateExternalMergeCommand,
  WINDOWS_TORTOISE_MERGE_ABSOLUTE,
  WORKSPACE_MERGE_TOOL_WARNING,
} from "../../src/conflict/externalMergeTool";
import {
  isWorkspaceMergeToolConfig,
  resolveExternalMergeExecutable,
} from "../../src/extension/workbench/externalMergeToolHost";
import {
  isExternalMergeView,
  webviewActions,
} from "../../src/protocol/workbenchProtocol";

describe("外部合并工具候选（配置优先，白名单探测）", () => {
  it("用户显式配置直接采用，不再探测", () => {
    expect(
      buildExternalMergeCandidates("/usr/bin/meld", "darwin", () => true),
    ).toEqual(["/usr/bin/meld"]);
    expect(
      buildExternalMergeCandidates("  meld  ", "linux", () => false),
    ).toEqual(["meld"]);
  });
  it("Windows 可识别 TortoiseMerge 绝对路径（存在才附加）", () => {
    const withTortoise = buildExternalMergeCandidates(
      null,
      "win32",
      (candidate) => candidate === WINDOWS_TORTOISE_MERGE_ABSOLUTE,
    );
    expect(withTortoise[0]).toBe(WINDOWS_TORTOISE_MERGE_ABSOLUTE);
    expect(withTortoise).toContain("TortoiseMerge.exe");
    const withoutTortoise = buildExternalMergeCandidates(
      null,
      "win32",
      () => false,
    );
    expect(withoutTortoise).not.toContain(WINDOWS_TORTOISE_MERGE_ABSOLUTE);
    expect(withoutTortoise).toContain("TortoiseMerge.exe");
  });
  it("macOS/Linux 不自造绝对路径，不承诺 Windows 产品", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const candidates = buildExternalMergeCandidates(
        null,
        platform,
        () => true,
      );
      expect(candidates.every((item) => !item.includes("/"))).toBe(true);
      expect(candidates).not.toContain("TortoiseMerge.exe");
      expect(knownExternalMergeToolBasenames(platform)).not.toContain(
        "TortoiseMerge.exe",
      );
    }
  });
});

describe("外部合并工具命令校验（fail-closed）", () => {
  it("空配置拒绝并给出三出口指引", () => {
    for (const value of [null, undefined, "", "   "]) {
      const result = validateExternalMergeCommand(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.join("")).toMatch(/选择可执行文件|设置中配置/);
      }
    }
  });
  it("NUL/换行/超长拒绝", () => {
    expect(validateExternalMergeCommand("a\0b").ok).toBe(false);
    expect(validateExternalMergeCommand("a\nb").ok).toBe(false);
    expect(validateExternalMergeCommand(`x${"y".repeat(600)}`).ok).toBe(false);
  });
  it("合法路径通过（存在性由 Host 用 fs 复验）", () => {
    expect(validateExternalMergeCommand("/usr/bin/meld").ok).toBe(true);
    expect(
      validateExternalMergeCommand(
        "C:\\Program Files\\TortoiseSVN\\bin\\TortoiseMerge.exe",
      ).ok,
    ).toBe(true);
  });
});

describe("外部合并工具参数数组（无 shell 注入）", () => {
  const files = {
    mine: "/wc/我的 修改/mine.ts",
    theirs: "/wc/对方;rm -rf/theirs.ts",
    base: '/wc/base "quoted".ts',
    result: "/wc/result.ts",
  };
  it("默认顺序为基线/我的/对方/结果，缺失角色跳过", () => {
    expect(buildExternalMergeArgs([], files)).toEqual([
      files.base,
      files.mine,
      files.theirs,
      files.result,
    ]);
    expect(
      buildExternalMergeArgs(undefined, { result: "/wc/result.ts" }),
    ).toEqual(["/wc/result.ts"]);
  });
  it("空格/引号/分号路径保持单个数组元素（不拼接转义）", () => {
    const args = buildExternalMergeArgs([], files);
    expect(args).toHaveLength(4);
    expect(args).toContain("/wc/对方;rm -rf/theirs.ts");
    expect(args).toContain('/wc/base "quoted".ts');
    // 数组逐项传递：元素个数即参数个数，shell 元字符无特殊含义。
    expect(args.join("\x00").split("\x00")).toHaveLength(4);
  });
  it("模板占位符逐项替换：纯占位符置空丢弃，前缀项保留显式空值", () => {
    const args = buildExternalMergeArgs(
      ["/base:{base}", "/mine:{mine}", "--flag", "{theirs}", "{base}"],
      { ...files, base: undefined, theirs: undefined },
    );
    expect(args).toContain(`/mine:${files.mine}`);
    expect(args).toContain("--flag");
    // 纯占位符项替换为空后整项丢弃，不传空串。
    expect(args).not.toContain("");
    expect(args.filter((item) => item === "{theirs}")).toHaveLength(0);
    // 带前缀项保留显式空值（仍为单个数组元素，由工具自行解释）。
    expect(args).toContain("/base:");
    expect(args.every((item) => typeof item === "string")).toBe(true);
  });
  it("未知标记不解释、原样透传为单个元素（无 shell 展开）", () => {
    const args = buildExternalMergeArgs(["--opt={unknown}", "{result}"], {
      result: "/wc/a;b.ts",
    });
    expect(args).toContain("--opt={unknown}");
    expect(args).toContain("/wc/a;b.ts");
  });
  it("展示预览仅用于显示（执行仍走数组）", () => {
    const preview = formatExternalMergeCommandPreview("meld", [
      "/wc/a b.ts",
      "/wc/c.ts",
    ]);
    expect(preview).toBe('meld "/wc/a b.ts" /wc/c.ts');
  });
});

describe("外部合并工具路径范围校验（fail-closed）", () => {
  const root = "/wc/project";
  it("范围内路径通过", () => {
    expect(
      areExternalMergePathsInScope(
        [`${root}/src/a.ts`, `${root}/mine.ts`],
        root,
      ),
    ).toBe(true);
  });
  it("范围外/越界/空值一律拒绝整组", () => {
    expect(areExternalMergePathsInScope([], root)).toBe(false);
    expect(areExternalMergePathsInScope(["/other/a.ts"], root)).toBe(false);
    expect(areExternalMergePathsInScope([`${root}/../escape.ts`], root)).toBe(
      false,
    );
    expect(areExternalMergePathsInScope([`${root}/a.ts`, ""], root)).toBe(
      false,
    );
    expect(areExternalMergePathsInScope([`${root}/a\0.ts`], root)).toBe(false);
  });
});

describe("外部合并工具探测解析（PATH 白名单，isFile + POSIX X_OK）", () => {
  const executable = (candidate: string) =>
    candidate === "/usr/bin/meld" ||
    candidate === "C:\\Program Files\\TortoiseSVN\\bin\\TortoiseMerge.exe";
  const executableStat = () => ({
    isFile: () => true,
    mode: 0o755,
  });
  it("命中 PATH 即采用绝对路径", () => {
    const found = resolveExternalMergeExecutable(["meld", "kdiff3"], {
      platform: "linux",
      pathEnv: "/usr/bin:/bin",
      delimiter: ":",
      pathExists: executable,
      statSync: executableStat,
    });
    expect(found.found).toBe(true);
    expect(found.command).toBe("/usr/bin/meld");
  });
  it("PATH 无命中即未找到（不猜测执行，走三出口）", () => {
    const missing = resolveExternalMergeExecutable(["meld"], {
      platform: "linux",
      pathEnv: "/bin",
      delimiter: ":",
      pathExists: () => false,
      statSync: executableStat,
    });
    expect(missing.found).toBe(false);
  });
  it("配置的绝对路径存在才采用", () => {
    const ok = resolveExternalMergeExecutable(
      ["C:\\Program Files\\TortoiseSVN\\bin\\TortoiseMerge.exe"],
      { platform: "win32", pathExists: executable, statSync: executableStat },
    );
    expect(ok.found).toBe(true);
    const bad = resolveExternalMergeExecutable(["C:\\tools\\merge.exe"], {
      platform: "win32",
      pathEnv: "C:\\Windows",
      delimiter: ";",
      pathExists: executable,
      statSync: executableStat,
    });
    expect(bad.found).toBe(false);
  });
});

describe("外部合并工具确认展示与平台文案", () => {
  it("确认摘要含工具名、文件角色与外部修改警告", () => {
    const summary = buildExternalMergeConfirmSummary("src/a.ts", "meld");
    expect(summary).toMatch(/meld/);
    expect(summary).toMatch(/src\/a\.ts/);
    expect(summary).toMatch(/我的修改|对方修改|共同基线|合并结果/);
    expect(summary).toMatch(/外部工具可能修改工作副本/);
    expect(summary).toMatch(/不会自动标记解决/);
  });
  it("未配置文案平台无关：macOS/Linux 不显示 Windows 专属承诺", () => {
    expect(describeExternalMergeTool(null, "darwin")).toMatch(
      /通用外部合并工具/,
    );
    expect(describeExternalMergeTool(null, "darwin")).not.toMatch(
      /TortoiseMerge/,
    );
    expect(describeExternalMergeTool(null, "linux")).not.toMatch(
      /TortoiseMerge/,
    );
    expect(describeExternalMergeTool(null, "win32")).toMatch(/TortoiseMerge/);
    expect(describeExternalMergeTool("/usr/bin/meld", "darwin")).toBe("meld");
  });
  it("超时上限存在且为 15 分钟", () => {
    expect(EXTERNAL_MERGE_TOOL_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});

describe("外部合并工具协议（Host/Webview/Mock/守卫全链）", () => {
  const valid = {
    available: true,
    toolLabel: "meld",
    fileRoles: [
      {
        role: "mine",
        label: "我的修改（本地）",
        relativePath: "src/a.ts",
      },
    ],
    preview: {
      token: "tok",
      commandPreview: "meld src/a.ts",
      canOpen: true,
      issues: [],
    },
  };
  it("接受合法视图（含 needsConfig/feedback/stale 可选字段）", () => {
    expect(isExternalMergeView(valid)).toBe(true);
    expect(
      isExternalMergeView({
        available: false,
        needsConfig: true,
        toolLabel: "未配置（通用外部合并工具）",
        fileRoles: [],
        feedback: "请选择可执行文件。",
      }),
    ).toBe(true);
    expect(
      isExternalMergeView({
        ...valid,
        preview: { ...valid.preview, stale: true, canOpen: false },
      }),
    ).toBe(true);
  });
  it("非法角色/缺失字段/坏预览一律拒绝", () => {
    expect(isExternalMergeView(null)).toBe(false);
    expect(isExternalMergeView({})).toBe(false);
    expect(
      isExternalMergeView({ ...valid, fileRoles: [{ role: "bogus" }] }),
    ).toBe(false);
    expect(isExternalMergeView({ ...valid, preview: { token: 1 } })).toBe(
      false,
    );
    expect(isExternalMergeView({ ...valid, available: "yes" })).toBe(false);
  });
  it("三动作已注册到 WebviewAction 运行时清单", () => {
    expect(webviewActions).toContain("conflict/preview-external-merge");
    expect(webviewActions).toContain("conflict/open-external-merge");
    expect(webviewActions).toContain("conflict/select-merge-tool");
  });
});

describe("必修 2：symlink 越界按 PathSemantics 比对（平台无关注入）", () => {
  const posix = { platform: "linux" as const, cwd: "/" };
  const win32 = { platform: "win32" as const, cwd: "C:\\" };
  it("realpath 解析后越界拒绝：链接内路径真身在外", () => {
    // Host 先 realpath：/wc/project/link/a.ts 真身为 /outside/a.ts。
    expect(
      areExternalMergePathsInScope(["/outside/a.ts"], "/wc/project", posix),
    ).toBe(false);
    expect(
      areExternalMergePathsInScope(
        ["/wc/project/link/a.ts"],
        "/wc/project",
        posix,
      ),
    ).toBe(true);
  });
  it(".. 越界经 resolve 归一后拒绝", () => {
    expect(
      areExternalMergePathsInScope(
        ["/wc/project/../escape.ts"],
        "/wc/project",
        posix,
      ),
    ).toBe(false);
    expect(
      areExternalMergePathsInScope(
        ["/wc/project/sub/../a.ts"],
        "/wc/project",
        posix,
      ),
    ).toBe(true);
  });
  it("大小写按平台：win32 折叠、POSIX 敏感", () => {
    expect(
      areExternalMergePathsInScope(
        ["C:\\WC\\PROJECT\\a.ts"],
        "c:\\wc\\project",
        win32,
      ),
    ).toBe(true);
    expect(
      areExternalMergePathsInScope(["/WC/project/a.ts"], "/wc/project", posix),
    ).toBe(false);
  });
  it("同前缀兄弟目录不误判为子孙", () => {
    expect(
      areExternalMergePathsInScope(
        ["/wc/project-evil/a.ts"],
        "/wc/project",
        posix,
      ),
    ).toBe(false);
  });
});

describe("必修 3：前缀模板绕过必须被冻结 roleFiles 全量复验拦截", () => {
  const posix = { platform: "linux" as const, cwd: "/" };
  const root = "/wc/project";
  it("--output={result} 隐藏的范围外 result 经 roleFiles 复验拒绝", () => {
    const roleFiles = {
      mine: `${root}/mine.ts`,
      result: "/outside/secret.ts",
    };
    const frozen = collectExternalMergeRolePaths(roleFiles);
    expect(frozen).toContain("/outside/secret.ts");
    expect(areExternalMergePathsInScope(frozen as string[], root, posix)).toBe(
      false,
    );
    // 旧逻辑：toolArgs 经 isAbsolute 过滤后只剩 mine，误放行。
    const legacyArgs = ["--output=/outside/secret.ts", `${root}/mine.ts`];
    const legacyFiltered = legacyArgs.filter((item) => item.startsWith("/"));
    expect(legacyFiltered).toEqual([`${root}/mine.ts`]);
    expect(areExternalMergePathsInScope(legacyFiltered, root, posix)).toBe(
      true,
    );
  });
  it("缺少 result 的冻结集合无效（fail-closed）", () => {
    expect(collectExternalMergeRolePaths(undefined)).toBeUndefined();
    expect(
      collectExternalMergeRolePaths({ mine: `${root}/mine.ts` }),
    ).toBeUndefined();
  });
});

describe("必修 1 + 低危 7：工作区来源与模板非法字符", () => {
  it("inspect 残留工作区值即判定 workspace 来源", () => {
    expect(
      isWorkspaceMergeToolConfig({ workspaceValue: "/evil/meld" }, undefined),
    ).toBe(true);
    expect(
      isWorkspaceMergeToolConfig(undefined, {
        workspaceFolderValue: ["--evil"],
      }),
    ).toBe(true);
    expect(
      isWorkspaceMergeToolConfig({ globalValue: "/usr/bin/meld" }, undefined),
    ).toBe(false);
    expect(isWorkspaceMergeToolConfig(undefined, undefined)).toBe(false);
  });
  it("工作区警告文明示核对完整命令", () => {
    expect(WORKSPACE_MERGE_TOOL_WARNING).toMatch(/来自工作区.*核对完整命令/);
  });
  it("模板参数同样拒绝 NUL/换行/超长", () => {
    expect(
      validateExternalMergeCommand("/usr/bin/meld", ["--ok", "a\0b"]).ok,
    ).toBe(false);
    expect(validateExternalMergeCommand("/usr/bin/meld", ["a\nb"]).ok).toBe(
      false,
    );
    expect(
      validateExternalMergeCommand("/usr/bin/meld", [`x${"y".repeat(600)}`]).ok,
    ).toBe(false);
    expect(validateExternalMergeCommand("/usr/bin/meld", ["--ok"]).ok).toBe(
      true,
    );
  });
});
