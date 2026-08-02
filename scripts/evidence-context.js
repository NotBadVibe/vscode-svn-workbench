const fs = require('node:fs');
const path = require('node:path');

function readPackageVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function createEvidenceRunId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${timestamp}-${suffix}`;
}

function resolveEvidenceDirectory(root, environment = process.env) {
  if (environment.SVN_WORKBENCH_EVIDENCE_DIR) {
    const evidenceDirectory = path.resolve(environment.SVN_WORKBENCH_EVIDENCE_DIR);
    const relativePath = path.relative(path.join(root, 'docs', 'releases'), evidenceDirectory);
    const versionDirectory = relativePath.split(path.sep)[0];
    if (/^v\d+\.\d+\.\d+$/.test(versionDirectory)) {
      const manifestPath = path.join(root, 'docs', 'releases', versionDirectory, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.status === 'released') {
          throw new Error(`${versionDirectory} is released and its evidence directory is immutable.`);
        }
      }
    }
    return evidenceDirectory;
  }
  const version = readPackageVersion(root);
  return path.join(root, '.validation', 'evidence', `v${version}`, createEvidenceRunId());
}

module.exports = {
  createEvidenceRunId,
  readPackageVersion,
  resolveEvidenceDirectory
};
