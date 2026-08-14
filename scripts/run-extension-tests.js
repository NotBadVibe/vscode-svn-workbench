const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
// 与 create-manual-acceptance-env.js 的安全根一致：os.tmpdir() 下固定目录名。
const validationRoot = path.join(
  require("node:os").tmpdir(),
  "svn-workbench-manual-ui-acceptance-v2",
);
const testTempRoot = path.join(validationRoot, "test-temp");
const prepare = spawnSync(
  process.execPath,
  [path.join(__dirname, "create-manual-acceptance-env.js")],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, SVN_WORKBENCH_MANUAL_ENV: validationRoot },
  },
);
if (prepare.status !== 0) {
  process.stderr.write(
    prepare.stderr ||
      prepare.stdout ||
      "无法创建 Extension Host SVN 验收夹具。\n",
  );
  process.exit(prepare.status || 1);
}
require("node:fs").mkdirSync(testTempRoot, { recursive: true });

const testEnvironment = {
  ...process.env,
  SVN_WORKBENCH_TEST_WORKSPACE: path.join(validationRoot, "wc"),
  ...(process.platform === "win32"
    ? { TEMP: testTempRoot, TMP: testTempRoot }
    : {}),
};

const result = spawnSync(
  process.execPath,
  [path.join(projectRoot, "out", "test", "runTest.js")],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: testEnvironment,
  },
);
process.exit(result.status ?? 1);
