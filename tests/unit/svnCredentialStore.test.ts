import { describe, expect, it } from "vitest";
import type { SecretStorage } from "vscode";
import {
  deleteStoredSvnCredential,
  readStoredSvnCredential,
  storeSvnCredential,
  svnCredentialSecretKey,
} from "../../src/security/svnCredentialStore";

function memorySecrets(): SecretStorage {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key),
    store: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    onDidChange: (() => ({ dispose() {} })) as SecretStorage["onDidChange"],
  };
}

describe("SVN credential SecretStorage", () => {
  it("stores credentials under a hashed repository key and can remove them", async () => {
    const secrets = memorySecrets();
    const identity = "https://svn.example.test/repos/private";
    expect(svnCredentialSecretKey(identity)).not.toContain(identity);

    await storeSvnCredential(secrets, identity, {
      username: "alice",
      password: "secret",
    });
    expect(await readStoredSvnCredential(secrets, identity)).toEqual({
      username: "alice",
      password: "secret",
    });

    await deleteStoredSvnCredential(secrets, identity);
    expect(await readStoredSvnCredential(secrets, identity)).toBeUndefined();
  });

  it("ignores malformed stored values", async () => {
    const secrets = memorySecrets();
    await secrets.store(svnCredentialSecretKey("repo"), "{broken");
    expect(await readStoredSvnCredential(secrets, "repo")).toBeUndefined();
  });
});
