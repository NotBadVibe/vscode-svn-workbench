/**
 * V018-F 必修 4/5/6/7 · 外部合并工具 Host 安全测试（平台无关断言）
 * - runExternalMergeTool：stdio ignore、无 shell、二段终止、双清 timer；
 * - resolve：isFile + POSIX X_OK / Windows 降级；
 * - TOCTOU：open 前重验存在性；
 * - select：目录拒绝写入。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  handleSelectMergeToolExecutable,
  isExternalMergeCommandStillValid,
  resolveExternalMergeExecutable,
  runExternalMergeTool,
} from "../../src/extension/workbench/externalMergeToolHost";

const executableStat = () => ({ isFile: () => true, mode: 0o755 });

describe("低危 5：可执行校验 isFile + POSIX X_OK", () => {
  it("POSIX 无执行位拒绝", () => {
    const result = resolveExternalMergeExecutable(["/tools/merge"], {
      platform: "linux",
      pathExists: () => true,
      statSync: () => ({ isFile: () => true, mode: 0o644 }),
    });
    expect(result.found).toBe(false);
  });
  it("POSIX 有执行位放行", () => {
    const result = resolveExternalMergeExecutable(["/tools/merge"], {
      platform: "linux",
      pathExists: () => true,
      statSync: executableStat,
    });
    expect(result.found).toBe(true);
  });
  it("Windows 降级为 isFile（无 X_OK 要求）", () => {
    const result = resolveExternalMergeExecutable(["C:\\tools\\merge.exe"], {
      platform: "win32",
      pathExists: () => true,
      statSync: () => ({ isFile: () => true, mode: 0o644 }),
    });
    expect(result.found).toBe(true);
  });
  it("目录/设备拒绝（isFile=false）", () => {
    const result = resolveExternalMergeExecutable(["/tools/merge"], {
      platform: "linux",
      pathExists: () => true,
      statSync: () => ({ isFile: () => false, mode: 0o755 }),
    });
    expect(result.found).toBe(false);
  });
});

describe("低危 6：TOCTOU open 前重验", () => {
  it("删除后即失效", () => {
    expect(
      isExternalMergeCommandStillValid("/tools/merge", {
        platform: "linux",
        pathExists: () => true,
        statSync: executableStat,
      }),
    ).toBe(true);
    expect(
      isExternalMergeCommandStillValid("/tools/merge", {
        platform: "linux",
        pathExists: () => false,
        statSync: executableStat,
      }),
    ).toBe(false);
  });
  it("NUL/换行直接失效", () => {
    expect(
      isExternalMergeCommandStillValid("a\0b", {
        platform: "linux",
        pathExists: () => true,
        statSync: executableStat,
      }),
    ).toBe(false);
  });
});

describe("低危 7：选择可执行文件 stat.isFile 校验", () => {
  it("目录拒绝写入", async () => {
    let updated = false;
    const result = await handleSelectMergeToolExecutable({
      showOpenDialog: (async () => [{ fsPath: "/tmp/some-dir" }]) as never,
      stat: async () => ({ isFile: () => false }),
      updateConfiguration: async () => {
        updated = true;
      },
      showInformationMessage: () => {},
    });
    expect(result).toBeUndefined();
    expect(updated).toBe(false);
  });
  it("文件正常写入", async () => {
    let updated = "";
    const result = await handleSelectMergeToolExecutable({
      showOpenDialog: (async () => [{ fsPath: "/tools/merge" }]) as never,
      stat: async () => ({ isFile: () => true }),
      updateConfiguration: async (value: string) => {
        updated = value;
      },
      showInformationMessage: () => {},
    });
    expect(result).toBe("/tools/merge");
    expect(updated).toBe("/tools/merge");
  });
});

describe("必修 4：进程管理（stdio ignore + 二段杀 + 双清 timer）", () => {
  function fakeChild(): {
    child: EventEmitter & {
      kill: (signal: string) => boolean;
      kills: string[];
    };
  } {
    const emitter = new EventEmitter() as EventEmitter & {
      kill: (signal: string) => boolean;
      kills: string[];
    };
    emitter.kills = [];
    emitter.kill = (signal: string) => {
      emitter.kills.push(signal);
      return true;
    };
    return { child: emitter };
  }

  it("spawn 选项恒为无 shell + stdio ignore", async () => {
    const { child } = fakeChild();
    let seenOptions: unknown;
    const result = await runExternalMergeTool("meld", ["a"], {
      timeoutMs: 5000,
      spawnFn: ((cmd: string, args: readonly string[], options: never) => {
        seenOptions = options;
        queueMicrotask(() => child.emit("close", 0));
        return child;
      }) as never,
    });
    expect(result.ok).toBe(true);
    expect(seenOptions).toMatchObject({ shell: false, stdio: "ignore" });
  });

  it("启动失败返回 error（不抛异常）", async () => {
    const result = await runExternalMergeTool(
      "/nonexistent-merge-tool-xyz",
      [],
      {
        timeoutMs: 2000,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error ?? "").toMatch(/无法启动/);
  });

  it("超时执行 SIGTERM→宽限→SIGKILL 二段终止", async () => {
    const { child } = fakeChild();
    const result = await runExternalMergeTool("meld", ["a"], {
      timeoutMs: 20,
      killGraceMs: 30,
      spawnFn: (() => child) as never,
    });
    expect(result.timedOut).toBe(true);
    expect(child.kills[0]).toBe("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(child.kills).toContain("SIGKILL");
  });

  it("常驻进程超时后仍被 SIGKILL 兜底（真实子进程）", async () => {
    const result = await runExternalMergeTool(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { timeoutMs: 60, killGraceMs: 40 },
    );
    expect(result.timedOut).toBe(true);
  });

  it("正常退出返回 exitCode（真实子进程）", async () => {
    const result = await runExternalMergeTool(
      process.execPath,
      ["-e", "process.exit(0)"],
      { timeoutMs: 5000 },
    );
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("大量 stdout 不阻塞（stdio ignore）", async () => {
    const result = await runExternalMergeTool(
      process.execPath,
      ["-e", "for(let i=0;i<20000;i++)console.log('x'.repeat(80))"],
      { timeoutMs: 8000 },
    );
    expect(result.ok).toBe(true);
  });
});
