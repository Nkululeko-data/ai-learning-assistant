import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadConfig } from "../src/config/config";

async function main(): Promise<void> {
  const config = loadConfig({ requireJwtSecrets: false });
  const dataDirectory = resolve(config.dataDir);
  const backupsDirectory = join(dataDirectory, "backups");
  await mkdir(backupsDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotDirectory = join(backupsDirectory, timestamp);
  await mkdir(snapshotDirectory, { recursive: true });

  for (const name of ["json", "sqlite", "uploads"]) {
    const source = join(dataDirectory, name);
    try {
      await stat(source);
      await cp(source, join(snapshotDirectory, name), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    dataDirectory,
    contents: await readdir(snapshotDirectory),
  };
  await writeFile(
    join(snapshotDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  console.log(snapshotDirectory);
  console.log(
    "This snapshot contains local files only; back up Neon and MongoDB separately using their provider-supported tools.",
  );
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "ENOENT";
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backup failed");
  process.exitCode = 1;
});
