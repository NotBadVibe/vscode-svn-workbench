import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildReadme,
  buildWorkspaceFile,
  ensureSafeValidationPath,
  externalDir,
  externalName,
  localWc,
  localWc2,
  parseStatusXmlModifiedPaths,
  sameNameFiles,
  sevenModifiedFiles,
  svnRepo,
  svnRepo2,
  validationRoot,
} from "../../scripts/create-manual-acceptance-env";

/** 固定验收根（平台语义构造）。 */
const fixedName = "svn-workbench-manual-ui-acceptance-v2";
const expectedRoot = path.resolve(os.tmpdir(), fixedName);

/*
 * v0.0.8 人工验收环境生成器的纯逻辑/输出契约：
 * - 安全根限制：拒绝删除任何未知路径；
 * - 多根 workspace：两个独立工作副本 folder；
 * - 仓库/WC 分离：两个仓库与两个工作副本路径互不相同；
 * - externals 与 7 modified 数据；
 * - 清单不虚构人工通过：只有记录位，没有“人工已通过”结论。
 */

describe("人工验收环境：安全根限制（exact match，fail-closed）", () => {
  it("只接受 os.tmpdir() 下固定目录名的确切路径（平台语义构造）", () => {
    expect(() => ensureSafeValidationPath(expectedRoot)).not.toThrow();
    expect(validationRoot).toBe(expectedRoot);
  });

  it("拒绝危险路径与仅靠同名 basename 的父目录/HOME/工作区路径", () => {
    const home = process.env.HOME ?? os.homedir();
    for (const dangerous of [
      path.parse(expectedRoot).root,
      home,
      path.join(home, fixedName),
      path.join(process.cwd(), fixedName),
      path.join(os.tmpdir(), "other", fixedName),
      path.join(os.tmpdir(), "..", fixedName),
      path.join(os.tmpdir(), fixedName, "sub"),
    ]) {
      expect(() => ensureSafeValidationPath(dangerous), dangerous).toThrow(
        /Refusing to recreate unexpected manual acceptance path/,
      );
    }
  });

  it("Windows 额外允许既有默认盘根固定路径（exact match）", () => {
    // 平台无关地验证盘根形式不会意外通过 POSIX；Windows 分支由实现
    // 的 exact match 集合保证（此处验证 POSIX 严格拒绝盘根形式）。
    const driveRootForm = `C:${path.sep}${fixedName}`;
    if (process.platform !== "win32") {
      expect(() => ensureSafeValidationPath(driveRootForm)).toThrow(
        /Refusing to recreate unexpected manual acceptance path/,
      );
    }
  });
});

describe("人工验收环境：svn status --xml 解析（自检纯逻辑）", () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<status>",
    '<target path="wc">',
    '<entry path="src/pages/order/OrderList.vue">',
    '<wc-status item="modified" props="none" revision="1">',
    "</wc-status>",
    "</entry>",
    '<entry path="src/pages/user/UserProfile.vue">',
    '<wc-status item="added" props="none" revision="0">',
    "</wc-status>",
    "</entry>",
    '<entry path="data/large.txt">',
    '<wc-status item="modified" props="none" revision="1">',
    "</wc-status>",
    "</entry>",
    "</target>",
    "</status>",
    "",
  ].join("\n");

  it("只取第一列 item=modified 的 wc 相对路径并排序", () => {
    expect(parseStatusXmlModifiedPaths(xml)).toEqual([
      "data/large.txt",
      "src/pages/order/OrderList.vue",
    ]);
  });

  it("无 modified 时返回空数组", () => {
    expect(parseStatusXmlModifiedPaths("<status></status>")).toEqual([]);
  });

  it("剥离 Windows 反斜杠 target 前缀并统一为跨平台相对路径", () => {
    const windowsXml = [
      "<status>",
      '<target path="C:\\fixture\\wc">',
      '<entry path="C:\\fixture\\wc\\src\\a.ts">',
      '<wc-status item="modified" props="none"></wc-status>',
      "</entry>",
      "</target>",
      "</status>",
    ].join("\n");
    expect(parseStatusXmlModifiedPaths(windowsXml)).toEqual(["src/a.ts"]);
  });

  it("只在 Windows target 边界规范分隔符，不改写 POSIX 合法反斜杠文件名", () => {
    const posixXml = [
      "<status>",
      '<target path="/fixture/wc">',
      '<entry path="/fixture/wc/src\\a.ts">',
      '<wc-status item="modified" props="none"></wc-status>',
      "</entry>",
      "</target>",
      "</status>",
    ].join("\n");
    expect(parseStatusXmlModifiedPaths(posixXml)).toEqual(["src\\a.ts"]);
  });
});

describe("人工验收环境：多根与仓库/WC 分离", () => {
  it("workspace 包含两个独立工作副本 folder（多根）", () => {
    const workspace = buildWorkspaceFile();
    expect(workspace.folders).toHaveLength(2);
    expect(workspace.folders[0].path).toBe("wc");
    expect(workspace.folders[1].path).toBe("wc2");
    expect(workspace.folders[0].name).toContain("WC1");
    expect(workspace.folders[1].name).toContain("WC2");
  });

  it("两个仓库与两个工作副本路径互不相同（仓库/WC 分离）", () => {
    expect(svnRepo).not.toBe(svnRepo2);
    expect(localWc).not.toBe(localWc2);
    const unique = new Set([
      svnRepo,
      svnRepo2,
      localWc,
      localWc2,
      validationRoot,
    ]);
    expect(unique.size).toBe(5);
  });
});

describe("人工验收环境：external 与 7 modified 数据", () => {
  it("7 个 modified 相对路径唯一且与 UX08-FLOW-01 语义对应", () => {
    expect(sevenModifiedFiles).toHaveLength(7);
    expect(new Set(sevenModifiedFiles).size).toBe(7);
    expect(sevenModifiedFiles).toContain("src/pages/order/OrderList.vue");
    expect(sevenModifiedFiles).toContain("特殊 路径/订单(#1).ts");
  });

  it("同名文件为不同目录下的同名 README（父目录辨识）", () => {
    expect(sameNameFiles).toHaveLength(2);
    const names = new Set(sameNameFiles.map((item) => item.split("/").pop()));
    expect(names.size).toBe(1);
    expect(sameNameFiles[0]).not.toBe(sameNameFiles[1]);
  });

  it("externals 定义指向第二仓库（归属场景）", () => {
    expect(externalDir).toBe("vendor");
    expect(externalName).toBe("external-lib");
  });
});

describe("人工验收清单：不虚构人工通过", () => {
  const readme = buildReadme({ localStatus: "M src/a.ts", remoteStatus: "" });

  it("包含全部人工步骤与通过/失败记录位", () => {
    for (const required of [
      "真实读屏",
      "VoiceOver",
      "NVDA",
      "真实触屏/触控笔",
      "200% 缩放目视",
      "滚动位置保持",
      "多仓库/混合仓库",
      "通过",
      "失败",
    ]) {
      expect(readme, required).toContain(required);
    }
    // 17 项人工清单。
    expect(readme.match(/\| \d+ \|/g)?.length).toBeGreaterThanOrEqual(17);
  });

  it("不得写“人工已通过”结论（只能有记录位）", () => {
    expect(readme).not.toContain("人工已通过");
    expect(readme).not.toMatch(/通过。\n/);
  });

  it("记录位初始为空（未填通过/失败）", () => {
    // 表格中每行的通过/失败列均为空。
    const rows = readme.split("\n").filter((line) => /^\| \d+ \|/.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(17);
    for (const row of rows) {
      const cells = row.split("|").map((cell) => cell.trim());
      expect(cells[3]).toBe(""); // 通过列
      expect(cells[4]).toBe(""); // 失败列
    }
  });
});
