export interface CommitIdentity {
  sha: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
}

export const GRANDFATHERED_COMMITS: readonly string[];

export function isTestIdentity(name: string, email: string): boolean;

export function collectCommits(args: string[], cwd?: string): CommitIdentity[];

export function identityViolations(commits: CommitIdentity[]): CommitIdentity[];

export function pushCommits(
  input: string,
  remote?: string,
  cwd?: string,
): CommitIdentity[];

export function selfTest(): number;

export function main(argv?: string[]): number;
