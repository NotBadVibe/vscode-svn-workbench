import { describe, expect, it } from "vitest";
import {
  isSameOrDescendantPath,
  isSamePathIdentity,
  normalizePathIdentity,
  type PathSemantics,
} from "../../src/scope/pathIdentity";
import { toDisplayPath } from "../../src/scope/pathBrands";
import {
  createProjectIdentity,
  createScopedFileKey,
  createWorkingCopyIdentity,
  projectRelativePath,
} from "../../src/scope/projectIdentity";
import {
  groupProjectsByWorkingCopy,
  resolveSourceControlTitles,
  scmProjectKey,
  sliceCandidatesForProject,
} from "../../src/scm/projectSlicing";

/*
 * v0.0.8 双平台路径契约（可注入，任意开发平台执行）：
 * 所有用例显式注入 win32/posix 语义，不依赖运行机器 process.platform。
 * 覆盖：大小写保留与 identity 等价、盘符、UNC、斜杠、中文、同前缀兄弟
 * 目录、项目相对路径、SCM 同名标题与切片。
 */

const win: PathSemantics = { platform: "win32", cwd: "C:\\workspace" };
const posix: PathSemantics = { platform: "linux", cwd: "/workspace" };

describe("大小写保留与 identity 等价", () => {
  it("win32：identity 统一小写，但原始展示路径大小写原样保留", () => {
    const original = "C:\\Repo\\Src\\File.ts";
    expect(normalizePathIdentity(original, win)).toBe("c:\\repo\\src\\file.ts");
    // 展示边界转换不改写字符串内容。
    expect(toDisplayPath(original)).toBe(original);
    // 大小写不同的路径是同一 identity。
    expect(isSamePathIdentity(original, "c:/repo/src/FILE.ts", win)).toBe(true);
    expect(normalizePathIdentity("c:/repo/src/file.ts", win)).toBe(
      normalizePathIdentity("C:\\Repo\\Src\\File.ts", win),
    );
  });

  it("posix：identity 大小写敏感，不同大小写不是同一 identity", () => {
    expect(isSamePathIdentity("/Repo/File", "/repo/file", posix)).toBe(false);
    expect(normalizePathIdentity("/Repo/File", posix)).toBe("/Repo/File");
    expect(toDisplayPath("/Repo/File")).toBe("/Repo/File");
  });
});

describe("盘符", () => {
  it("win32：盘符参与 identity，不同盘符不是同一路径", () => {
    expect(isSamePathIdentity("C:\\repo\\a.ts", "D:\\repo\\a.ts", win)).toBe(
      false,
    );
    expect(isSamePathIdentity("C:\\repo\\a.ts", "c:/repo/a.ts", win)).toBe(
      true,
    );
    expect(isSameOrDescendantPath("D:\\repo\\a.ts", "C:\\repo", win)).toBe(
      false,
    );
  });

  it("win32：盘符相对解析使用注入的 cwd", () => {
    expect(normalizePathIdentity("repo\\a.ts", win)).toBe(
      "c:\\workspace\\repo\\a.ts",
    );
    // 盘符绝对路径不受 cwd 影响。
    expect(normalizePathIdentity("E:\\Repo\\A.ts", win)).toBe("e:\\repo\\a.ts");
  });
});

describe("UNC", () => {
  it("win32：UNC 统一大小写并正确消解父目录片段", () => {
    expect(
      normalizePathIdentity("\\\\Server\\Share\\Folder\\..\\File.txt", win),
    ).toBe("\\\\server\\share\\file.txt");
    expect(
      isSamePathIdentity(
        "\\\\SERVER\\SHARE\\file.txt",
        "\\\\server\\share",
        win,
      ),
    ).toBe(false); // 目录与文件不同 identity。
    expect(
      isSameOrDescendantPath(
        "\\\\SERVER\\Share\\Sub\\a.txt",
        "\\\\server\\share",
        win,
      ),
    ).toBe(true);
    expect(
      isSameOrDescendantPath(
        "\\\\Server\\Other\\a.txt",
        "\\\\server\\share",
        win,
      ),
    ).toBe(false);
  });
});

describe("斜杠", () => {
  it("win32：正反斜杠混用解析为同一 identity", () => {
    expect(normalizePathIdentity("C:\\Repo/src\\File.ts", win)).toBe(
      "c:\\repo\\src\\file.ts",
    );
    expect(normalizePathIdentity("C:/Repo\\src/File.ts", win)).toBe(
      "c:\\repo\\src\\file.ts",
    );
    expect(
      isSamePathIdentity("C:\\Repo/src\\File.ts", "c:/repo/src/file.ts", win),
    ).toBe(true);
  });

  it("posix：反斜杠是普通字符，不被当作分隔符", () => {
    expect(normalizePathIdentity("/repo/a\\b", posix)).toBe("/repo/a\\b");
    expect(normalizePathIdentity("/repo/a/b", posix)).toBe("/repo/a/b");
    expect(isSamePathIdentity("/repo/a\\b", "/repo/a/b", posix)).toBe(false);
  });

  it("win32：identity 相对比较把反斜杠视为分隔符", () => {
    expect(isSameOrDescendantPath("c:\\repo\\src\\a.ts", "C:/repo", win)).toBe(
      true,
    );
  });
});

describe("中文路径", () => {
  it("win32：中文段展示保留、identity 归一且大小写折叠不影响中文", () => {
    const original = "C:\\代码\\仓库\\文件.ts";
    expect(normalizePathIdentity(original, win)).toBe(
      "c:\\代码\\仓库\\文件.ts",
    );
    expect(toDisplayPath(original)).toBe(original);
    expect(
      isSamePathIdentity(
        "C:\\代码\\仓库\\文件.ts",
        "c:/代码/仓库/文件.ts",
        win,
      ),
    ).toBe(true);
    expect(
      isSameOrDescendantPath("C:\\代码\\仓库\\子\\a.ts", "C:\\代码\\仓库", win),
    ).toBe(true);
    expect(
      isSameOrDescendantPath("C:\\代码\\仓库外\\a.ts", "C:\\代码\\仓库", win),
    ).toBe(false);
  });

  it("posix：中文路径大小写敏感且边界正确", () => {
    expect(
      isSameOrDescendantPath("/代码/仓库/子/a.ts", "/代码/仓库", posix),
    ).toBe(true);
    expect(
      isSameOrDescendantPath("/代码/仓库外/a.ts", "/代码/仓库", posix),
    ).toBe(false);
  });
});

describe("同前缀兄弟目录", () => {
  it("两个平台都不把同前缀兄弟误判为子项", () => {
    for (const options of [win, posix]) {
      expect(
        isSameOrDescendantPath(
          options === win ? "C:\\repo\\app2\\a.ts" : "/repo/app2/a.ts",
          options === win ? "C:\\repo\\app" : "/repo/app",
          options,
        ),
      ).toBe(false);
      expect(
        isSameOrDescendantPath(
          options === win ? "C:\\repo\\app\\a.ts" : "/repo/app/a.ts",
          options === win ? "C:\\repo\\app" : "/repo/app",
          options,
        ),
      ).toBe(true);
      // 名为 ..cache 的合法子目录不得被误拒绝。
      expect(
        isSameOrDescendantPath(
          options === win ? "C:\\repo\\..cache\\a.ts" : "/repo/..cache/a.ts",
          options === win ? "C:\\repo" : "/repo",
          options,
        ),
      ).toBe(true);
    }
  });
});

describe("项目相对路径：identity 归一、展示保留大小写", () => {
  it("win32：projectRelativePath 保留原大小写，identity 键小写", () => {
    const root = "C:\\Repo\\Code\\BCHD-Front";
    expect(projectRelativePath(root, `${root}\\Src\\Index.ts`, win)).toBe(
      "Src/Index.ts",
    );
    // 边界判断不受大小写影响。
    expect(
      projectRelativePath(
        "c:\\repo\\code\\bchd-front",
        "C:\\REPO\\CODE\\BCHD-FRONT\\src\\index.ts",
        win,
      ),
    ).toBe("src/index.ts");
    // 同前缀兄弟目录在项目外。
    expect(
      projectRelativePath(root, "C:\\Repo\\Code\\BCHD-Front2\\a.ts", win),
    ).toBeUndefined();
  });

  it("win32：项目身份 projectId 小写、工作副本内相对路径展示保留大小写", () => {
    const project = createProjectIdentity({
      projectRoot: "C:\\Repo\\Code\\BCHD-Front",
      workingCopyRoot: "C:\\Repo\\Code",
      options: win,
    });
    expect(project.projectId).toBe("c:\\repo\\code\\bchd-front");
    expect(project.projectName).toBe("BCHD-Front");
    expect(project.workingCopyRelativePath).toBe("BCHD-Front");
    const wc = createWorkingCopyIdentity("C:\\Repo\\Code", win);
    expect(wc.workingCopyId).toBe("c:\\repo\\code");
    expect(wc.workingCopyRoot).toBe("C:\\Repo\\Code");
    expect(
      createScopedFileKey(
        "C:\\Repo\\Code",
        "C:\\REPO\\CODE\\BCHD-Front\\a.ts",
        win,
      ),
    ).toBe("c:\\repo\\code::bchd-front/a.ts");
  });

  it("posix：大小写敏感语义下兄弟目录与项目边界保持", () => {
    expect(
      projectRelativePath("/repo/code/app", "/repo/code/app2/a.ts", posix),
    ).toBeUndefined();
    expect(
      projectRelativePath("/repo/code/app", "/repo/code/app/a.ts", posix),
    ).toBe("a.ts");
    expect(
      projectRelativePath("/repo/code/App", "/repo/code/app/a.ts", posix),
    ).toBeUndefined();
  });
});

describe("SCM 同名标题与切片", () => {
  it("win32：同名（大小写折叠）项目补充可辨识父路径，标题展示保留原名", () => {
    const titles = resolveSourceControlTitles(
      [
        { name: "App", absolutePath: "C:\\Repo\\one\\App" },
        { name: "app", absolutePath: "C:\\Repo\\two\\app" },
        { name: "Web", absolutePath: "C:\\Repo\\web" },
      ],
      win,
    );
    expect(titles).toEqual(["SVN · one/App", "SVN · two/app", "SVN · Web"]);
  });

  it("posix：大小写不同的项目名不冲突，各自独立标题", () => {
    const titles = resolveSourceControlTitles(
      [
        { name: "App", absolutePath: "/repo/one/App" },
        { name: "app", absolutePath: "/repo/two/app" },
      ],
      posix,
    );
    expect(titles).toEqual(["SVN · App", "SVN · app"]);
  });

  it("win32：切片与分组按 identity 大小写折叠", () => {
    const candidates = [
      { absolutePath: "C:\\Repo\\Code\\APP\\a.ts" },
      { absolutePath: "C:\\Repo\\Code\\app2\\b.ts" },
    ];
    expect(
      sliceCandidatesForProject(candidates, "c:\\repo\\code\\app", win).map(
        (item) => item.absolutePath,
      ),
    ).toEqual(["C:\\Repo\\Code\\APP\\a.ts"]);
    expect(scmProjectKey("C:\\Repo\\Code\\App", win)).toBe(
      "c:\\repo\\code\\app",
    );
    const groups = groupProjectsByWorkingCopy(
      [
        { name: "a", absolutePath: "C:\\Repo\\A", workingCopyRoot: "C:\\Repo" },
        { name: "b", absolutePath: "c:\\repo\\B", workingCopyRoot: "c:\\repo" },
      ],
      win,
    );
    expect(groups.size).toBe(1);
  });

  it("win32：同前缀兄弟目录不进入项目切片", () => {
    const candidates = [{ absolutePath: "C:\\Repo\\app2\\x.ts" }];
    expect(sliceCandidatesForProject(candidates, "C:\\Repo\\app", win)).toEqual(
      [],
    );
  });
});

describe("身份键不得流入展示边界（类型边界对应运行时事实）", () => {
  it("toDisplayPath 只做标记，不改写字符串；identity 键与展示值不同时必须保留原值", () => {
    const original = "C:\\Repo\\Src\\File.ts";
    const key = normalizePathIdentity(original, win);
    expect(key).not.toBe(original); // 小写身份键与展示路径不同。
    expect(toDisplayPath(original)).toBe(original);
    // 身份键本身不得作为展示路径出现（小写化会被用户看到）。
    expect(original).toContain("Repo");
    expect(key).not.toContain("Repo");
  });
});
