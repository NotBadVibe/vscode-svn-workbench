import { describe, expect, it } from "vitest";
import {
  finalizeProjectRoot,
  mostSpecificWorkspaceFolder,
  resolveProjectTarget,
} from "../../src/scope/projectResolver";

const win = { platform: "win32" as const, cwd: "C:\\" };
const posix = { platform: "linux" as const, cwd: "/" };

const emFolders = [
  { name: "EmApi", absolutePath: "/repo/code/EmApi" },
  { name: "EMSystem-front-pro", absolutePath: "/repo/code/EMSystem-front-pro" },
  { name: "EMApi-oauth-bridge", absolutePath: "/repo/code/EMApi-oauth-bridge" },
];

describe("活动项目解析契约（v0.0.7 §5）", () => {
  it("命令携带的明确目标优先，定位到最具体 workspace folder", () => {
    const resolution = resolveProjectTarget(
      {
        explicitTarget: "/repo/code/EmApi/src/index.ts",
        activeEditorTarget: "/repo/code/EMSystem-front-pro/app.ts",
        workspaceFolders: emFolders,
      },
      posix,
    );
    expect(resolution).toEqual({
      kind: "resolved",
      target: "/repo/code/EmApi/src/index.ts",
      projectRoot: "/repo/code/EmApi",
      folder: emFolders[0],
      outsideWorkspace: false,
      source: "explicit",
    });
  });

  it("嵌套 folder 选择路径最长的最具体归属", () => {
    const folders = [
      { name: "outer", absolutePath: "/repo/code" },
      { name: "inner", absolutePath: "/repo/code/inner" },
    ];
    expect(
      mostSpecificWorkspaceFolder(folders, "/repo/code/inner/a.ts", posix),
    ).toEqual(folders[1]);
    // 同前缀兄弟目录不得误判归属。
    expect(
      mostSpecificWorkspaceFolder(
        [{ name: "app", absolutePath: "/repo/code/app" }],
        "/repo/code/app2/a.ts",
        posix,
      ),
    ).toBeUndefined();
  });

  it("明确目标不在任何 workspace folder 时按目标解析并标记提示", () => {
    const resolution = resolveProjectTarget(
      {
        explicitTarget: "/elsewhere/other/file.ts",
        workspaceFolders: emFolders,
      },
      posix,
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      target: "/elsewhere/other/file.ts",
      outsideWorkspace: true,
      source: "explicit",
    });
    expect(
      resolution.kind === "resolved" ? resolution.projectRoot : "x",
    ).toBeUndefined();
  });

  it("无明确目标时使用活动编辑器所属 folder", () => {
    const resolution = resolveProjectTarget(
      {
        activeEditorTarget: "/repo/code/EMSystem-front-pro/src/app.ts",
        workspaceFolders: emFolders,
      },
      posix,
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      projectRoot: "/repo/code/EMSystem-front-pro",
      source: "activeEditor",
      outsideWorkspace: false,
    });
  });

  it("活动编辑器不在工作区时回退到容器保存的项目根", () => {
    const resolution = resolveProjectTarget(
      {
        activeEditorTarget: "/tmp/scratch-notes.md",
        savedProjectRoot: "/repo/code/EmApi",
        workspaceFolders: emFolders,
      },
      posix,
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      target: "/repo/code/EmApi",
      projectRoot: "/repo/code/EmApi",
      source: "savedProject",
    });
  });

  it("保存的项目根已不在任何 folder 内时不得静默使用", () => {
    const resolution = resolveProjectTarget(
      {
        savedProjectRoot: "/stale/removed-project",
        workspaceFolders: emFolders,
      },
      posix,
    );
    expect(resolution.kind).toBe("needsSelection");
  });

  it("单根工作区直接使用该 folder，不打开选择器", () => {
    const resolution = resolveProjectTarget(
      {
        workspaceFolders: [{ name: "only", absolutePath: "/repo/code" }],
      },
      posix,
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      target: "/repo/code",
      projectRoot: "/repo/code",
      source: "singleFolder",
    });
  });

  it("多根且无活动目标时返回可突出的选择器候选，不自动进入", () => {
    const resolution = resolveProjectTarget(
      {
        recentProjectRoot: "/repo/code/EMApi-oauth-bridge",
        workspaceFolders: emFolders,
      },
      posix,
    );
    expect(resolution.kind).toBe("needsSelection");
    if (resolution.kind !== "needsSelection") return;
    expect(resolution.candidates).toHaveLength(3);
    // 最近项目排在最前并标记突出，但仍需用户确认。
    expect(resolution.candidates[0]).toEqual({
      name: "EMApi-oauth-bridge",
      absolutePath: "/repo/code/EMApi-oauth-bridge",
      isRecent: true,
    });
    expect(resolution.candidates[1].isRecent).toBe(false);
  });

  it("无工作区且无目标时不可用", () => {
    expect(resolveProjectTarget({ workspaceFolders: [] }).kind).toBe(
      "unavailable",
    );
  });

  it("Windows 下 folder 归属与最近项目按 identity 比较", () => {
    const folders = [
      { name: "EmApi", absolutePath: "C:\\Code\\EmApi" },
      { name: "EmSystem", absolutePath: "C:\\Code\\EmSystem" },
    ];
    const resolution = resolveProjectTarget(
      {
        explicitTarget: "c:\\code\\emapi\\src\\a.ts",
        workspaceFolders: folders,
      },
      win,
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      projectRoot: "C:\\Code\\EmApi",
      outsideWorkspace: false,
    });

    const selection = resolveProjectTarget(
      { recentProjectRoot: "c:\\code\\emsystem", workspaceFolders: folders },
      win,
    );
    expect(selection.kind).toBe("needsSelection");
    if (selection.kind === "needsSelection") {
      expect(selection.candidates[0].name).toBe("EmSystem");
    }
  });
});

describe("项目根定案（工作副本根确定后）", () => {
  it("候选项目根仍位于工作副本内时采用候选", () => {
    expect(
      finalizeProjectRoot("/repo/code/EmApi", "/repo/code", posix),
    ).toEqual({
      projectRoot: "/repo/code/EmApi",
      projectRootIsFallback: false,
    });
  });

  it("候选缺失或已不在工作副本内时回退工作副本根，不静默猜测", () => {
    expect(finalizeProjectRoot(undefined, "/repo/code", posix)).toEqual({
      projectRoot: "/repo/code",
      projectRootIsFallback: true,
    });
    // symlink、external 或嵌套工作副本归属变化后候选失效。
    expect(finalizeProjectRoot("/other/place", "/repo/code", posix)).toEqual({
      projectRoot: "/repo/code",
      projectRootIsFallback: true,
    });
  });

  it("Windows 下候选归属按 identity 判断", () => {
    expect(finalizeProjectRoot("c:\\code\\emapi", "C:\\Code", win)).toEqual({
      projectRoot: "c:\\code\\emapi",
      projectRootIsFallback: false,
    });
  });
});
