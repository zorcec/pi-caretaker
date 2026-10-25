/**
 * Shared return shape for guard CLIs exercised in-process.
 *
 * Guard scripts are run as child processes by check-*.test.ts (exit codes
 * and stderr), and imported here for coverage of the same logic. The CLI
 * layer stays thin: print the result, exit non-zero on failure.
 */
export interface GuardCheckResult {
  ok: boolean;
  problems: string[];
}

/** ADR gate result: the report plus how many decision files were scanned. */
export interface AdrCheckResult extends GuardCheckResult {
  adrCount: number;
}

export function runCheck(root: string): AdrCheckResult;

/** CLI entry: print the report and return the process exit code. */
export function main(): number;
