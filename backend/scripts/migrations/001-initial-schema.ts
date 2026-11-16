export interface JsonSchemaMigration {
  version: number;
  up: (jsonDirectory: string) => Promise<void>;
}

/**
 * Marks the initial on-disk format; no data transformation is needed for an empty store.
 */
async function applyInitialSchema(_jsonDirectory: string): Promise<void> {}

export const jsonSchemaMigrations: JsonSchemaMigration[] = [
  { version: 1, up: applyInitialSchema },
];
