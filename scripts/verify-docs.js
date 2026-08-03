const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const docsRoot = path.join(root, "docs");
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .toUpperCase();
}

function hashTree(directory) {
  const hash = crypto.createHash("sha256");
  for (const filePath of walk(directory).sort()) {
    const relativePath = path
      .relative(directory, filePath)
      .split(path.sep)
      .join("/");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(sha256File(filePath));
    hash.update("\n");
  }
  return hash.digest("hex").toUpperCase();
}

function checkLinks(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const targets = [];
  if (filePath.endsWith(".md")) {
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g))
      targets.push(match[1]);
  } else if (filePath.endsWith(".html")) {
    for (const match of content.matchAll(/(?:href|src)=["']([^"']+)["']/gi))
      targets.push(match[1]);
  }
  for (let target of targets) {
    target = target
      .trim()
      .replace(/^<|>$/g, "")
      .split(/\s+["']/)[0];
    if (!target || /^(?:#|https?:|mailto:|data:|javascript:)/i.test(target))
      continue;
    target = target.split("#")[0].split("?")[0];
    if (!target) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      // 保留无法解码的原始链接，以便后续存在性校验报告它。
    }
    const resolved = path.resolve(path.dirname(filePath), target);
    if (!fs.existsSync(resolved)) {
      failures.push(`${path.relative(root, filePath)}: missing link ${target}`);
    }
  }
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
if (
  packageLock.version !== packageJson.version ||
  packageLock.packages?.[""]?.version !== packageJson.version
) {
  failures.push("package.json and package-lock.json versions do not match.");
}

const releasesRoot = path.join(docsRoot, "releases");
for (const entry of fs.readdirSync(releasesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^v\d+\.\d+\.\d+$/.test(entry.name)) continue;
  const releaseDirectory = path.join(releasesRoot, entry.name);
  const manifestPath = path.join(releaseDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    failures.push(
      `${path.relative(root, releaseDirectory)} is missing manifest.json.`,
    );
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const required = [
    "schemaVersion",
    "version",
    "status",
    "baseVersion",
    "releaseDate",
    "gitTag",
    "gitCommit",
    "sourceState",
    "vsix",
    "tests",
    "acceptedEvidenceRun",
    "evidencePath",
  ];
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(manifest, field))
      failures.push(
        `${path.relative(root, manifestPath)} is missing ${field}.`,
      );
  }
  if (`v${manifest.version}` !== entry.name)
    failures.push(
      `${entry.name} does not match manifest version ${manifest.version}.`,
    );
  if (!["draft", "candidate", "released"].includes(manifest.status))
    failures.push(`${entry.name} has invalid status ${manifest.status}.`);

  if (manifest.status === "released") {
    if (
      !manifest.gitTag ||
      !/^[0-9a-f]{40}$/i.test(manifest.gitCommit || "") ||
      manifest.sourceState !== "clean" ||
      !manifest.vsix ||
      !manifest.evidencePath
    ) {
      failures.push(`${entry.name} released manifest is incomplete.`);
    } else {
      try {
        const taggedCommit = execFileSync(
          "git",
          ["rev-parse", `${manifest.gitTag}^{}`],
          { cwd: root, encoding: "utf8" },
        ).trim();
        if (taggedCommit !== manifest.gitCommit)
          failures.push(
            `${entry.name} tag does not resolve to manifest commit.`,
          );
      } catch {
        failures.push(
          `${entry.name} tag ${manifest.gitTag} cannot be resolved.`,
        );
      }
      const evidenceDirectory = path.join(
        releaseDirectory,
        manifest.evidencePath,
      );
      if (!fs.existsSync(evidenceDirectory)) {
        failures.push(`${entry.name} evidence path does not exist.`);
      } else if (
        !manifest.evidenceTreeSha256 ||
        hashTree(evidenceDirectory) !== manifest.evidenceTreeSha256
      ) {
        failures.push(
          `${entry.name} evidence tree fingerprint does not match.`,
        );
      }
      const installEvidence = walk(releaseDirectory).find(
        (filePath) => path.basename(filePath) === "vsix-install.json",
      );
      if (!installEvidence) {
        failures.push(`${entry.name} is missing VSIX install evidence.`);
      } else {
        const evidence = JSON.parse(fs.readFileSync(installEvidence, "utf8"));
        if (
          evidence.vsixSha256 !== manifest.vsix.sha256 ||
          evidence.vsixSizeBytes !== manifest.vsix.sizeBytes
        ) {
          failures.push(
            `${entry.name} VSIX fingerprint does not match install evidence.`,
          );
        }
      }
    }
  }
}

const currentManifestPath = path.join(
  releasesRoot,
  `v${packageJson.version}`,
  "manifest.json",
);
if (!fs.existsSync(currentManifestPath))
  failures.push(
    `Current version v${packageJson.version} has no release manifest.`,
  );

for (const filePath of walk(docsRoot).filter((item) =>
  /\.(?:md|html)$/i.test(item),
))
  checkLinks(filePath);

for (const filePath of walk(docsRoot).filter((item) =>
  /\.(?:md|html)$/i.test(item),
)) {
  const relativePath = path.relative(docsRoot, filePath);
  if (relativePath.startsWith(`archive${path.sep}`)) continue;
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("SVN工作台原型v3"))
    failures.push(
      `${path.relative(root, filePath)} references the removed legacy directory.`,
    );
  if (/docs\/releases\/artifacts\/2026-|\.\/artifacts\/2026-/.test(content))
    failures.push(
      `${path.relative(root, filePath)} uses a dated legacy artifact path.`,
    );
}

if (failures.length) {
  process.stderr.write(
    `Documentation verification failed (${failures.length}):\n- ${failures.join("\n- ")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Documentation, version manifests and evidence links are valid.\n",
  );
}

module.exports = { hashTree };
