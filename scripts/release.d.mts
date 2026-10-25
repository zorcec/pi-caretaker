export const RELEASE_REPO: string;

export function repoRoot(): string;

export function readPackageVersion(root?: string): string;

export function extractReleaseNotes(
  changelogText: string,
  version: string,
): string;

export function main(argv?: string[]): number;
