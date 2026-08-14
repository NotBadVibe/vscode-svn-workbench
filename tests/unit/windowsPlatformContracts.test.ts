import { describe, expect, it, vi } from "vitest";
import {
  comparePathIdentity,
  isSameOrDescendantPath,
  isSamePathIdentity,
  normalizePathIdentity,
} from "../../src/scope/pathIdentity";
import { writeAndSyncTempFile } from "../../src/diffEdit/diffAtomicWriter";
import { removeTestTempDirectory } from "../../src/test/suite/testTempDirectory";

const windowsOptions = {
  platform: "win32" as const,
  cwd: "C:\\workspace",
};

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("Windows 路径身份契约（可在任意开发平台执行）", () => {
  it("统一盘符、分隔符和大小写，但不改写展示路径", () => {
    const original = "C:\\Repo\\Src\\File.ts";
    expect(normalizePathIdentity(original, windowsOptions)).toBe(
      "c:\\repo\\src\\file.ts",
    );
    expect(
      isSamePathIdentity(original, "c:/repo/src/FILE.ts", windowsOptions),
    ).toBe(true);
    expect(original).toBe("C:\\Repo\\Src\\File.ts");
  });

  it("统一 UNC 路径并正确消解父目录片段", () => {
    expect(
      normalizePathIdentity(
        "\\\\Server\\Share\\Folder\\..\\File.txt",
        windowsOptions,
      ),
    ).toBe("\\\\server\\share\\file.txt");
  });

  it("只接受同一路径或真正子项，不把同前缀兄弟误判为子项", () => {
    expect(
      isSameOrDescendantPath("c:/REPO/src/file.ts", "C:\\repo", windowsOptions),
    ).toBe(true);
    expect(
      isSameOrDescendantPath(
        "C:\\repo\\..cache\\file.ts",
        "C:\\repo",
        windowsOptions,
      ),
    ).toBe(true);
    expect(
      isSameOrDescendantPath(
        "C:\\repository\\file.ts",
        "C:\\repo",
        windowsOptions,
      ),
    ).toBe(false);
    expect(
      isSameOrDescendantPath("C:\\outside", "C:\\repo", windowsOptions),
    ).toBe(false);
  });

  it("POSIX 路径保持大小写敏感", () => {
    const options = { platform: "linux" as const, cwd: "/workspace" };
    expect(isSamePathIdentity("/Repo/File", "/repo/file", options)).toBe(false);
    expect(comparePathIdentity("/repo/a", "/repo/a", options)).toBe(0);
  });
});

describe("Windows 原子写入句柄契约（可注入）", () => {
  it("必须以写句柄打开，并按 write → sync → close 顺序落盘", async () => {
    const calls: string[] = [];
    const openFile = vi.fn(async () => ({
      writeFile: async (data: Uint8Array) => {
        calls.push(`write:${Buffer.from(data).toString("utf8")}`);
      },
      sync: async () => {
        calls.push("sync");
      },
      close: async () => {
        calls.push("close");
      },
    }));

    await writeAndSyncTempFile(
      "C:\\repo\\.temp",
      Buffer.from("内容"),
      0o640,
      openFile,
    );

    expect(openFile).toHaveBeenCalledWith("C:\\repo\\.temp", "w", 0o640);
    expect(calls).toEqual(["write:内容", "sync", "close"]);
  });

  it("fsync 返回 EACCES 时仍关闭句柄并保留原始错误", async () => {
    const close = vi.fn(async () => undefined);
    const accessDenied = errorWithCode("EACCES");
    const openFile = vi.fn(async () => ({
      writeFile: async () => undefined,
      sync: async () => {
        throw accessDenied;
      },
      close,
    }));

    await expect(
      writeAndSyncTempFile(
        "C:\\repo\\.temp",
        Buffer.from("x"),
        0o600,
        openFile,
      ),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("Windows 真实 SVN 临时目录清理契约（可注入）", () => {
  it.each(["EPERM", "EBUSY", "ENOTEMPTY"])(
    "%s 在有限重试后只延迟 Runner 回收",
    (code) => {
      const removeDirectory = vi.fn(() => {
        throw errorWithCode(code);
      });
      const warn = vi.fn();

      expect(
        removeTestTempDirectory("C:\\runner-temp", {
          platform: "win32",
          removeDirectory,
          warn,
        }),
      ).toBe("deferred");
      expect(removeDirectory).toHaveBeenCalledWith("C:\\runner-temp", {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(code));
    },
  );

  it("非 Windows 或非文件锁错误继续抛出", () => {
    expect(() =>
      removeTestTempDirectory("/tmp/runner", {
        platform: "linux",
        removeDirectory: () => {
          throw errorWithCode("EBUSY");
        },
      }),
    ).toThrow("EBUSY");
    expect(() =>
      removeTestTempDirectory("C:\\runner-temp", {
        platform: "win32",
        removeDirectory: () => {
          throw errorWithCode("EIO");
        },
      }),
    ).toThrow("EIO");
  });

  it("正常清理返回 removed", () => {
    expect(
      removeTestTempDirectory("C:\\runner-temp", {
        platform: "win32",
        removeDirectory: vi.fn(),
      }),
    ).toBe("removed");
  });
});
