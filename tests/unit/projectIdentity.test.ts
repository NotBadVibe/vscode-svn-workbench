import { describe, expect, it } from "vitest";
import {
  createProjectIdentity,
  createScopedFileKey,
  createWorkingCopyIdentity,
  isSameProject,
  projectRelativePath,
} from "../../src/scope/projectIdentity";

const win = { platform: "win32" as const, cwd: "C:\\" };
const posix = { platform: "linux" as const, cwd: "/" };

describe("项目与工作副本身份（v0.0.7）", () => {
  it("工作副本身份使用不透明 identity 键并保留原始路径", () => {
    const identity = createWorkingCopyIdentity("/repo/code", posix);
    expect(identity.workingCopyRoot).toBe("/repo/code");
    expect(identity.workingCopyId).toBe("/repo/code");

    const winIdentity = createWorkingCopyIdentity("C:\\Repo\\Code", win);
    expect(winIdentity.workingCopyId).toBe("c:\\repo\\code");
    // 原始路径必须保留，identity 键不得用于展示。
    expect(winIdentity.workingCopyRoot).toBe("C:\\Repo\\Code");
  });

  it("项目根与工作副本根重合时标记重合且相对路径为空", () => {
    const project = createProjectIdentity({
      projectRoot: "/repo/code",
      workingCopyRoot: "/repo/code",
      options: posix,
    });
    expect(project.projectName).toBe("code");
    expect(project.rootIsWorkingCopyRoot).toBe(true);
    expect(project.workingCopyRelativePath).toBe("");
  });

  it("上层工作副本中的子目录项目保留工作副本内相对路径", () => {
    const project = createProjectIdentity({
      projectRoot: "/repo/code/2024Project/bchd-front-Dev3.0",
      workingCopyRoot: "/repo/code",
      options: posix,
    });
    expect(project.projectName).toBe("bchd-front-Dev3.0");
    expect(project.rootIsWorkingCopyRoot).toBe(false);
    expect(project.workingCopyRelativePath).toBe(
      "2024Project/bchd-front-Dev3.0",
    );
  });

  it("Windows 项目身份按盘符、分隔符与大小写归一", () => {
    const project = createProjectIdentity({
      projectRoot: "C:\\Code\\2024Project\\BCHD-Front",
      workingCopyRoot: "c:\\code",
      options: win,
    });
    expect(project.projectId).toBe("c:\\code\\2024project\\bchd-front");
    expect(project.rootIsWorkingCopyRoot).toBe(false);
    expect(project.workingCopyRelativePath).toBe("2024Project/BCHD-Front");
    expect(project.projectName).toBe("BCHD-Front");
  });

  it("isSameProject 只比较不透明 identity", () => {
    const left = createProjectIdentity({
      projectRoot: "C:\\Code\\App",
      workingCopyRoot: "C:\\Code",
      options: win,
    });
    const right = createProjectIdentity({
      projectRoot: "c:\\code\\app",
      workingCopyRoot: "c:\\code",
      options: win,
    });
    expect(isSameProject(left, right)).toBe(true);
    expect(
      isSameProject(
        left,
        createProjectIdentity({
          projectRoot: "C:\\Code\\App2",
          workingCopyRoot: "C:\\Code",
          options: win,
        }),
      ),
    ).toBe(false);
  });

  it("projectRelativePath 只服务项目内路径，项目外返回 undefined", () => {
    const root = "/repo/code/app";
    expect(projectRelativePath(root, root, posix)).toBe(".");
    expect(
      projectRelativePath(root, "/repo/code/app/src/index.ts", posix),
    ).toBe("src/index.ts");
    // 同前缀兄弟目录不得被误判为项目内路径。
    expect(
      projectRelativePath(root, "/repo/code/app2/src/index.ts", posix),
    ).toBeUndefined();
    expect(projectRelativePath(root, "/repo/code", posix)).toBeUndefined();
  });

  it("Host 文件 key 组合工作副本身份与规范化工作副本内路径", () => {
    const key = createScopedFileKey(
      "C:\\Code",
      "c:\\code\\App\\Src\\Index.ts",
      win,
    );
    expect(key).toBe("c:\\code::app/src/index.ts");
    // 工作副本外目标不能生成文件 key。
    expect(
      createScopedFileKey("C:\\Code", "C:\\Other\\a.ts", win),
    ).toBeUndefined();
    // 只使用项目内相对路径会在同工作副本多项目间碰撞。
    const projectA = createScopedFileKey(
      "/repo/code",
      "/repo/code/a/x.ts",
      posix,
    );
    const projectB = createScopedFileKey(
      "/repo/code",
      "/repo/code/b/x.ts",
      posix,
    );
    expect(projectA).not.toBe(projectB);
  });
});
