import { createHash } from "node:crypto";
import type * as vscode from "vscode";
import type { SvnAuthenticationContext } from "./svnSecurityContext";

const SECRET_PREFIX = "svnWorkbench.svnCredential.v1";

interface StoredCredential {
  version: 1;
  username: string;
  password: string;
}

export async function readStoredSvnCredential(
  secrets: vscode.SecretStorage,
  repositoryIdentity: string,
): Promise<SvnAuthenticationContext | undefined> {
  const value = await secrets.get(secretKey(repositoryIdentity));
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredCredential>;
    if (
      parsed.version !== 1 ||
      typeof parsed.username !== "string" ||
      !parsed.username.trim() ||
      typeof parsed.password !== "string" ||
      !parsed.password
    ) {
      return undefined;
    }
    return { username: parsed.username, password: parsed.password };
  } catch {
    return undefined;
  }
}

export async function storeSvnCredential(
  secrets: vscode.SecretStorage,
  repositoryIdentity: string,
  credential: SvnAuthenticationContext,
): Promise<void> {
  const stored: StoredCredential = {
    version: 1,
    username: credential.username,
    password: credential.password,
  };
  await secrets.store(secretKey(repositoryIdentity), JSON.stringify(stored));
}

export async function deleteStoredSvnCredential(
  secrets: vscode.SecretStorage,
  repositoryIdentity: string,
): Promise<void> {
  await secrets.delete(secretKey(repositoryIdentity));
}

export function svnCredentialSecretKey(repositoryIdentity: string): string {
  return secretKey(repositoryIdentity);
}

function secretKey(repositoryIdentity: string): string {
  const digest = createHash("sha256").update(repositoryIdentity).digest("hex");
  return `${SECRET_PREFIX}.${digest}`;
}
