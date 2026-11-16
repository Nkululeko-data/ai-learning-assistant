export interface StatusRecord {
  status: string;
}

/**
 * Filters stashable records to active state for repository default queries.
 */
export function activeRecords<T extends StatusRecord>(
  records: readonly T[],
): T[] {
  return records.filter((record) => record.status === "active");
}
