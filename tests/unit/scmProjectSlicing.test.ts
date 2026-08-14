import { describe, expect, it } from "vitest";
import {
  findOwningProject,
  groupProjectsByWorkingCopy,
  resolveSourceControlTitles,
  scmProjectKey,
  sliceCandidatesForProject,
} from "../../src/scm/projectSlicing";

const win = { platform: "win32" as const, cwd: "C:\\" };

describe("SCM 项目切片（v0.0.7 §6.2）", () => {
  it("provider 标题为“SVN · 项目名”", () => {
    expect(
      resolveSourceControlTitles([
        { name: "EmApi", absolutePath: "/repo/code/EmApi" },
        {
          name: "EMSystem-front-pro",
          absolutePath: "/repo/code/EMSystem-front-pro",
        },
      ]),
    ).toEqual(["SVN · EmApi", "SVN · EMSystem-front-pro"]);
  });

  it("同名项目补充可辨识父路径", () => {
    const titles = resolveSourceControlTitles([
      { name: "app", absolutePath: "/repo/one/app" },
      { name: "app", absolutePath: "/repo/two/app" },
      { name: "web", absolutePath: "/repo/web" },
    ]);
    expect(titles).toEqual(["SVN · one/app", "SVN · two/app", "SVN · web"]);
  });

  it("同一工作副本的项目归为一组共享采集", () => {
    const groups = groupProjectsByWorkingCopy([
      {
        name: "a",
        absolutePath: "/repo/code/a",
        workingCopyRoot: "/repo/code",
      },
      {
        name: "b",
        absolutePath: "/repo/code/b",
        workingCopyRoot: "/repo/code",
      },
      { name: "c", absolutePath: "/other/c", workingCopyRoot: "/other" },
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get("/repo/code")?.map((item) => item.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("Windows 下分组与 identity 键按大小写归一", () => {
    const groups = groupProjectsByWorkingCopy(
      [
        { name: "a", absolutePath: "C:\\Code\\A", workingCopyRoot: "C:\\Code" },
        { name: "b", absolutePath: "c:\\code\\B", workingCopyRoot: "c:\\code" },
      ],
      win,
    );
    expect(groups.size).toBe(1);
    expect(scmProjectKey("C:\\Code\\A", win)).toBe("c:\\code\\a");
  });

  it("切片只保留项目根内候选，未加载兄弟目录不进入项目", () => {
    const candidates = [
      { absolutePath: "/repo/code/EmApi/a.ts" },
      { absolutePath: "/repo/code/EmSystem/b.ts" },
      { absolutePath: "/repo/code/sibling/c.ts" },
    ];
    expect(sliceCandidatesForProject(candidates, "/repo/code/EmApi")).toEqual([
      { absolutePath: "/repo/code/EmApi/a.ts" },
    ]);
  });

  it("同前缀兄弟目录不被误切入项目", () => {
    const candidates = [{ absolutePath: "/repo/code/app2/x.ts" }];
    expect(sliceCandidatesForProject(candidates, "/repo/code/app")).toEqual([]);
  });

  it("findOwningProject 返回最具体项目归属", () => {
    const projects = [
      { absolutePath: "/repo/code" },
      { absolutePath: "/repo/code/app" },
    ];
    expect(findOwningProject(projects, "/repo/code/app/x.ts")).toEqual(
      projects[1],
    );
    expect(findOwningProject(projects, "/repo/code/other/x.ts")).toEqual(
      projects[0],
    );
    expect(findOwningProject(projects, "/elsewhere/x.ts")).toBeUndefined();
  });
});
