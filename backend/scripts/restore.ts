import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config/config";

async function main(): Promise<void> {
  const snapshot = process.argv[2];
  if (!snapshot) throw new Error("Usage: npm run restore -- <snapshot-directory> --yes");
  if (!process.argv.includes("--yes")) {
    throw new Error("Restore requires the explicit --yes flag");
  }

  const snapshotDirectory = resolve(snapshot);
  for (const name of ["json", "sqlite", "uploads"]) {
    await stat(join(snapshotDirectory, name));
  }
  await stat(join(snapshotDirectory, "manifest.json"));

  const config = loadConfig({ requireJwtSecrets: false });
  const dataDirectory = resolve(config.dataDir);
  if (isUnsafeTarget(dataDirectory)) {
    throw new Error("Refusing to restore into a filesystem root or home directory");
  }
  await mkdir(dataDirectory, { recursive: true });

  for (const name of ["json", "sqlite", "uploads"]) {
    await rm(join(dataDirectory, name), { recursive: true, force: true });
    await cp(
      join(snapshotDirectory, name),
      join(dataDirectory, name),
      { recursive: true, force: true },
    );
  }

  console.log(`Restored ${snapshotDirectory} to ${dataDirectory}`);
}

function isUnsafeTarget(path: string): boolean {
  const normalized = path.toLowerCase().replace(/[\\/]+$/, "");
  if (normalized === process.env.SystemDrive?.toLowerCase() + "\\") return true;
  if (normalized === "/" || normalized === "\\") return true;
  if (normalized === process.env.USERPROFILE?.toLowerCase()) return true;
  return false;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Restore failed");
  process.exitCode = 1;
});
