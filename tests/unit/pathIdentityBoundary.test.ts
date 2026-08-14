import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * v0.0.8 路径身份边界静态契约：
 * identity 键（PathIdentityKey）只能用于比较/Map/Set/缓存/范围判断，
 * 不得进入协议展示字段；展示字段必须是 DisplayPath 品牌；纯路径 API
 * 要求显式 PathSemantics（platform + cwd 必填），领域代码不得自行读取
 * process.platform/process.cwd()。扫描是源码层提醒，核心约束由 tsc /
 * svelte-check 的类型契约（pathBrands.ts 的 Assert 与 DisplayPathSource）
 * 在 npm run check 中强制。
 */

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const protocolSource = read("src/protocol/workbenchProtocol.ts");
const brandsSource = read("src/scope/pathBrands.ts");
const pathIdentitySource = read("src/scope/pathIdentity.ts");
const nativeSource = read("src/scope/nativePathSemantics.ts");

describe("协议展示字段必须使用 DisplayPath 品牌", () => {
  it("WorkbenchScopeView 的展示路径字段声明为 DisplayPath", () => {
    expect(protocolSource).toContain(
      "projectWorkingCopyRelativePath?: DisplayPath",
    );
    expect(protocolSource).toMatch(
      /roots: Array<\{\s+kind: "file" \| "folder";\s+relativePath: DisplayPath;/,
    );
  });

  it("WorkbenchFileView 与 file/path-detail-result 的展示路径字段声明为 DisplayPath", () => {
    expect(protocolSource).toContain("projectRelativePath?: DisplayPath");
    expect(protocolSource).toContain("workingCopyRelativePath: DisplayPath;");
    expect(protocolSource).toContain("repositoryRelativePath?: DisplayPath;");
    expect(protocolSource).toContain("absolutePath: DisplayPath;");
  });

  it("协议不直接依赖 node:path 的 pathIdentity 模块", () => {
    // pathIdentity.ts 依赖 node:path，绝不能进入 Webview 包；
    // 品牌类型经零依赖 src/scope/pathBrands.ts 引入。
    expect(protocolSource).not.toContain('from "../scope/pathIdentity"');
    expect(protocolSource).not.toContain('from "./pathIdentity"');
  });
});

describe("pathBrands 必须是零依赖的浏览器安全模块", () => {
  it("不导入 node:*、process 或任何 src 模块", () => {
    expect(brandsSource).not.toMatch(/from ["']node:/);
    expect(brandsSource).not.toMatch(/\bprocess\./);
    expect(brandsSource).not.toMatch(/^import .* from/m);
  });

  it("品牌互斥与 toDisplayPath 拒绝 identity 键的类型契约存在", () => {
    // 真正的约束是 npm run check（tsc + svelte-check）：
    // PathIdentityNotDisplayPath / DisplayPathNotPathIdentity 必须满足
    // Assert<T extends true>；DisplayPathRejectsIdentityKey 要求
    // DisplayPathSource<PathIdentityKey> 折叠为 never。品牌一旦可互相
    // 赋值或参数约束被放宽，编译失败。
    expect(brandsSource).toMatch(/type Assert<T extends true> = T;/);
    expect(brandsSource).toContain("PathIdentityNotDisplayPath");
    expect(brandsSource).toContain("DisplayPathNotPathIdentity");
    expect(brandsSource).toContain("DisplayPathRejectsIdentityKey");
    expect(brandsSource).toContain("DisplayPathSource<T>");
  });
});

const webviewRuntimeDirs = [
  "src/webview/app",
  "src/webview/components",
  "src/webview/features",
  "src/webview/bridge",
  "src/webview/styles",
];

function webviewRuntimeFiles(): string[] {
  const files: string[] = [];
  for (const dir of webviewRuntimeDirs) {
    try {
      for (const name of readdirSync(path.join(root, dir), {
        recursive: true,
      })) {
        if (
          typeof name === "string" &&
          /\.(ts|svelte|svelte\.ts)$/.test(name)
        ) {
          files.push(path.join(root, dir, name));
        }
      }
    } catch {
      // 目录不存在时跳过。
    }
  }
  return files;
}

/** 精确匹配 import 语句中的模块路径（避免全仓模糊 contains 误报）。 */
function importStatementsOf(source: string, moduleName: string): string[] {
  const pattern = new RegExp(
    `(?:import\\s*(?:type)?\\s*\\{[^}]*\\}\\s*from\\s*|import\\s+)["']([^"']*${moduleName})["']`,
    "g",
  );
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

describe("Webview 运行时不得构造或转换身份键", () => {
  it("运行时目录不导入 pathIdentity / pathBrands / nativePathSemantics", () => {
    for (const file of webviewRuntimeFiles()) {
      const source = readFileSync(file, "utf8");
      const imports = importStatementsOf(source, "pathIdentity");
      expect(
        imports,
        `${path.relative(root, file)} 不得导入 pathIdentity`,
      ).toEqual([]);
      expect(
        importStatementsOf(source, "pathBrands"),
        `${path.relative(root, file)} 不得导入 pathBrands`,
      ).toEqual([]);
      expect(
        importStatementsOf(source, "nativePathSemantics"),
        `${path.relative(root, file)} 不得导入 nativePathSemantics`,
      ).toEqual([]);
    }
  });

  it("webview mock 只允许使用 pathBrands，不允许导入 pathIdentity", () => {
    const mockSource = read("src/webview/mocks/mockWorkbench.ts");
    expect(mockSource).toContain('from "../../scope/pathBrands"');
    expect(importStatementsOf(mockSource, "pathIdentity")).toEqual([]);
    expect(importStatementsOf(mockSource, "nativePathSemantics")).toEqual([]);
  });
});

describe("正式测试夹具禁止引用 native 语义边界", () => {
  it("tests/ 递归扫描（排除 spike 与 mocks）不得导入 nativePathSemantics", () => {
    // 合成路径夹具必须显式 posix/win32；真实路径夹具在文件内显式构造
    // 宿主集成语义对象。直接 import 生产 native 单例会破坏测试语义隔离。
    for (const dir of ["tests/unit", "tests/components", "tests/webview-e2e"]) {
      for (const name of readdirSync(path.join(root, dir), {
        recursive: true,
      })) {
        if (
          typeof name === "string" &&
          /\.(ts|svelte|svelte\.ts)$/.test(name)
        ) {
          const file = path.join(root, dir, name);
          const source = readFileSync(file, "utf8");
          const imports = importStatementsOf(source, "nativePathSemantics");
          expect(
            imports,
            `${path.relative(root, file)} 不得导入 nativePathSemantics`,
          ).toEqual([]);
        }
      }
    }
  });
});

describe("纯路径 API 要求显式 PathSemantics（编译期必填）", () => {
  it("pathIdentity 函数签名不再提供默认语义回退", () => {
    expect(pathIdentitySource).not.toContain("PathIdentityOptions");
    expect(pathIdentitySource).not.toMatch(
      /options:\s*PathSemantics\s*=\s*\{\}/,
    );
    expect(pathIdentitySource).toContain(
      "platform: NodeJS.Platform;\n  /** 相对路径解析基准。 */\n  cwd: string;",
    );
    expect(pathIdentitySource).toContain(
      "normalizePathIdentity(\n  value: string,\n  options: PathSemantics,\n)",
    );
  });

  it("领域纯函数签名全部要求 PathSemantics，不再回退 process", () => {
    for (const file of [
      "src/scope/projectIdentity.ts",
      "src/scope/projectResolver.ts",
      "src/scope/workingCopyClassification.ts",
      "src/scm/projectSlicing.ts",
      "src/scope/pathBoundaryGuard.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain("PathIdentityOptions");
      expect(source, file).not.toMatch(/options: PathSemantics = \{\}/);
      expect(source, file).not.toMatch(/\bprocess\.platform\b/);
      expect(source, file).not.toMatch(/\bprocess\.cwd\b/);
    }
  });

  it("唯一 native 语义边界集中读取 process，且不被测试夹具引用", () => {
    expect(nativeSource).toContain("platform: process.platform");
    expect(nativeSource).toContain("cwd: process.cwd()");
    // 领域模块不得在代码中读取 process（nativePathSemantics 是唯一出口）；
    // 注释提及不算代码使用。
    const codeLines = (file: string) =>
      read(file)
        .split(/\r?\n/)
        .filter(
          (line) =>
            !line.trim().startsWith("//") &&
            !line.trim().startsWith("*") &&
            !line.trim().startsWith("/*"),
        )
        .join("\n");
    for (const file of [
      "src/scope/pathIdentity.ts",
      "src/scope/projectIdentity.ts",
      "src/scope/projectResolver.ts",
      "src/scope/workingCopyClassification.ts",
      "src/scm/projectSlicing.ts",
      "src/scope/pathBoundaryGuard.ts",
    ]) {
      const code = codeLines(file);
      expect(code, file).not.toMatch(/\bprocess\.platform\b/);
      expect(code, file).not.toMatch(/\bprocess\.cwd\b/);
    }
  });
});

describe("身份 API 的返回类型契约（源码声明）", () => {
  it("normalizePathIdentity 声明返回 PathIdentityKey", () => {
    expect(pathIdentitySource).toMatch(/\): PathIdentityKey \{/);
  });

  it("workingCopyId/projectId/createScopedFileKey/scmProjectKey 声明为 PathIdentityKey", () => {
    const projectIdentitySource = read("src/scope/projectIdentity.ts");
    const slicingSource = read("src/scm/projectSlicing.ts");
    expect(projectIdentitySource).toContain("workingCopyId: PathIdentityKey;");
    expect(projectIdentitySource).toContain("projectId: PathIdentityKey;");
    expect(projectIdentitySource).toContain("): PathIdentityKey | undefined {");
    expect(slicingSource).toContain("): PathIdentityKey {");
  });

  it("identity wrapper 不得抹掉品牌：normalizeSvnRepositoryRoot 返回 PathIdentityKey", () => {
    const securitySource = read("src/security/svnSecurityContext.ts");
    expect(securitySource).toContain(
      "normalizeSvnRepositoryRoot(value: string): PathIdentityKey {",
    );
    // 安全注册表的引用计数、失效监听与广播必须携带品牌。
    const registrySource = read("src/security/svnSecurityContextRegistry.ts");
    expect(registrySource).toContain("Map<PathIdentityKey, number>");
    expect(registrySource).toContain(
      "(repositoryRoot: PathIdentityKey) => void",
    );
    // 控制器存储与广播的归一化键同样携带品牌。
    const controllerSource = read(
      "src/extension/workbench/WorkbenchController.ts",
    );
    expect(controllerSource).toContain(
      "private securityReferenceRoot: PathIdentityKey | undefined;",
    );
    expect(controllerSource).toContain(
      "handleSecurityInvalidated(repositoryRoot: PathIdentityKey): void",
    );
  });

  it("src 内不得有显式 string 返回的裸 identity wrapper（组合业务键除外）", () => {
    // 扫描 src 中“返回类型标注为 string、函数体直接 return normalizePath*”
    // 的包装函数；projectDraftKey 是组合业务键（模板字符串拼接），除外。
    const files: string[] = [];
    for (const dir of readdirSync(path.join(root, "src"), {
      recursive: true,
    })) {
      if (typeof dir === "string" && /\.(ts|svelte|svelte\.ts)$/.test(dir)) {
        files.push(path.join(root, "src", dir));
      }
    }
    const wrapperPattern =
      /\): string \{[^}]*?return (?:normalizePathIdentity|normalizePathKey|normalizeRootKey|normalizeRepositoryRootKey|normalizeTestPath)\(/g;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const matches = [...source.matchAll(wrapperPattern)];
      expect(
        matches.map((match) => match[0].slice(0, 60)),
        `${path.relative(root, file)} 存在把 identity 键 widen 为 string 的 wrapper`,
      ).toEqual([]);
    }
  });

  it("Host 展示边界构建处显式调用 toDisplayPath", () => {
    const presentation = read(
      "src/extension/workbench/workbenchPresentation.ts",
    );
    const fileOperations = read(
      "src/extension/workbench/workbenchFileOperations.ts",
    );
    const controller = read("src/extension/workbench/WorkbenchController.ts");
    expect(presentation).toContain("toDisplayPath(");
    expect(fileOperations).toContain("toDisplayPath(");
    expect(controller).toContain("toDisplayPath(");
  });
});
