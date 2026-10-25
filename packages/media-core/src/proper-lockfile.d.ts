declare module "proper-lockfile" {
  export interface LockOptions {
    realpath?: boolean;
    lockfilePath?: string;
    stale?: number;
    update?: number;
    retries?: { retries: number; factor: number; minTimeout: number; maxTimeout: number };
    onCompromised?: (error: Error) => void;
  }

  export function lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
}
