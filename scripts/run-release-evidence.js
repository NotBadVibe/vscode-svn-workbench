const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  createEvidenceRunId,
  readPackageVersion,
} = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const version = readPackageVersion(root);
const releaseRoot = path.join(root, "docs", "releases", `v${version}`);
const manifestPath = path.join(releaseRoot, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error(
    `Release manifest not found: ${path.relative(root, manifestPath)}`,
  );
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== version) {
  throw new Error(
    `Manifest version ${manifest.version} does not match package version ${version}.`,
  );
}
if (manifest.status === "released") {
  throw new Error(
    `v${version} is released and its evidence directory is immutable.`,
  );
}

let gitCommit = null;
let sourceState = "dirty";
try {
  gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  sourceState = status ? "dirty" : "clean";
} catch {
  // 非 Git 环境仅记录为未知源码状态，仍可运行本地验收。
}

const runId = createEvidenceRunId();
const evidenceDirectory = path.join(releaseRoot, "artifacts", runId);
if (fs.existsSync(evidenceDirectory)) {
  throw new Error(
    `Evidence run already exists: ${path.relative(root, evidenceDirectory)}`,
  );
}
fs.mkdirSync(evidenceDirectory, { recursive: true });

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const environment = {
  ...process.env,
  SVN_WORKBENCH_EVIDENCE_DIR: evidenceDirectory,
};
const commands = ["test:webview", "test:performance"];
let passed = true;

for (const command of commands) {
  const result = spawnSync(npmCommand, ["run", command], {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    passed = false;
    break;
  }
}

fs.writeFileSync(
  path.join(evidenceDirectory, "run.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      version,
      runId,
      generatedAt: new Date().toISOString(),
      gitCommit,
      sourceState,
      commands,
      status: passed ? "passed" : "failed",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `Release evidence: ${path.relative(root, evidenceDirectory)}\n`,
);
if (!passed) process.exitCode = 1;
