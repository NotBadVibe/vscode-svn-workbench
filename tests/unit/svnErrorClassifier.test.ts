import { describe, expect, it } from "vitest";
import {
  classifySvnFailure,
  extractSvnCertificateDetails,
} from "../../src/svn/svnErrorClassifier";

describe("classifySvnFailure", () => {
  it.each([
    ["svn: E170001: Authentication failed", "authentication"],
    ["svn: E230001: Server SSL certificate verification failed", "certificate"],
    ["svn: E670002: Could not resolve hostname", "network"],
    ["svn: E155004: Working copy locked; run cleanup", "working-copy-locked"],
    ["svn: E155037: Previous operation has not finished", "interrupted"],
    ["spawn svn ENOENT", "cli-missing"],
  ])("classifies %s", (message, category) => {
    expect(classifySvnFailure(message).category).toBe(category);
  });

  it("extracts the certificate identity and exact trust failures", () => {
    const details = extractSvnCertificateDetails(`
Error validating server certificate for 'https://svn.example.test:8443':
 - The certificate is not issued by a trusted authority.
 - The certificate hostname does not match.
Certificate information:
 - Hostname: svn.internal.example.test
 - Valid: from Jul 01 00:00:00 2026 GMT until Jul 01 00:00:00 2027 GMT
 - Issuer: Example Internal CA
 - Fingerprint: AA:BB:CC:DD
`);

    expect(details).toEqual({
      host: "svn.example.test:8443",
      fingerprint: "AA:BB:CC:DD",
      issuer: "Example Internal CA",
      validFrom: "Jul 01 00:00:00 2026 GMT",
      validUntil: "Jul 01 00:00:00 2027 GMT",
      failures: ["unknown-ca", "cn-mismatch"],
    });
  });

  it.each([
    ["Could not resolve hostname svn.example.test", "dns"],
    ["Could not connect through proxy proxy.example.test", "proxy"],
    ["Network is unreachable", "offline"],
    ["Connection timed out", "timeout"],
    ["Connection refused", "connection-refused"],
  ])("distinguishes network failure: %s", (message, kind) => {
    expect(classifySvnFailure(message)).toEqual(
      expect.objectContaining({ category: "network", networkKind: kind }),
    );
  });

  it.each([
    ["svn: E170013: Unable to connect to a repository", "unknown"],
    ["getaddrinfo ENOTFOUND svn.example.test", "dns"],
    ["connect ETIMEDOUT 203.0.113.1:443", "timeout"],
    ["connect ECONNREFUSED 203.0.113.1:443", "connection-refused"],
    ["connect ENETUNREACH 203.0.113.1:443", "offline"],
  ])("recognizes platform-native network errors: %s", (message, kind) => {
    expect(classifySvnFailure(message)).toEqual(
      expect.objectContaining({ category: "network", networkKind: kind }),
    );
  });

  it("routes locked and interrupted working copies to the recovery module", () => {
    expect(classifySvnFailure("working copy is locked")).toEqual(
      expect.objectContaining({ recoveryModule: "repository" }),
    );
    expect(classifySvnFailure("previous operation has not finished")).toEqual(
      expect.objectContaining({ recoveryModule: "repository" }),
    );
  });
});
