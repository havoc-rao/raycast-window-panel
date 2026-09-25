import { performance } from "node:perf_hooks";

/** Console-only timing: fixed stage names, duration and status; no window/app data. */
export async function timed<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let status = "ok";
  try {
    return await operation();
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    console.debug(`[Window Panel timing] ${stage} ${Math.round(performance.now() - started)}ms ${status}`);
  }
}
