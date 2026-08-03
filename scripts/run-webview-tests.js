const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const evidenceDirectory = resolveEvidenceDirectory(root);
fs.mkdirSync(evidenceDirectory, { recursive: true });

process.stdout.write(
  `Webview evidence: ${path.relative(root, evidenceDirectory)}\n`,
);
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "@playwright", "test", "cli.js"),
    "test",
    "--project=webview",
  ],
  {
    cwd: root,
    env: { ...process.env, SVN_WORKBENCH_EVIDENCE_DIR: evidenceDirectory },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
