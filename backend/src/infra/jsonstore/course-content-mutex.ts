import { AsyncMutex } from "./async-mutex";
import type { SystemCollections } from "./system-collections";

const locks = new WeakMap<object, AsyncMutex>();

export function withCourseContentMutationLock<T>(
  collections: SystemCollections,
  operation: () => Promise<T>,
): Promise<T> {
  let lock = locks.get(collections);
  if (!lock) {
    lock = new AsyncMutex();
    locks.set(collections, lock);
  }
  return lock.runExclusive(operation);
}
