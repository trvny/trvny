import type { QuipEnv } from './quip.ts';

export interface CompanionEnv extends QuipEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG: string;
  GITHUB_PRIVATE_KEY: string;
  GPTOMEK_APP_ID?: string;
  GPTOMEK_INSTALLATION_ID?: string;
  GPTOMEK_PRIVATE_KEY?: string;
  KANAREK_NO_CI_REPOS?: string;
  KANAREK_QUIP_KV?: KVNamespace;
  KANAREK_REQUIRE_CI?: string;
  KANAREK_REPOSITORIES?: string;
  KANAREK_UPDATE_BRANCH?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  ENGRAM_API_KEY?: string;
}

export interface CompanionTarget {
  delivery: string;
  installationId: number;
  pullRequestNumber: number;
  repository: string;
  sourceEvent: string;
}

export interface CompanionResult {
  changed: boolean;
  commentId: number | null;
  quipSource: 'ai' | 'pool' | 'preset';
  state: string;
}

export interface QuipEntry {
  k: string;
  q: string;
}

export interface PullRequest {
  additions: number;
  auto_merge?: { merge_method?: string | null } | null;
  base: { ref: string; sha: string };
  body?: string | null;
  changed_files: number;
  deletions: number;
  draft: boolean;
  head: {
    ref?: string;
    repo?: { full_name?: string | null } | null;
    sha: string;
  };
  labels?: Array<{ name?: string | null }>;
  mergeable: boolean | null;
  mergeable_state: string;
  merged: boolean;
  number: number;
  state: string;
  title?: string | null;
  user?: { login?: string | null } | null;
}

export interface CheckRun {
  conclusion?: string | null;
  status: string;
}

export interface CommitStatus {
  state: string;
}

export interface Review {
  state: string;
  user?: { login?: string | null } | null;
}

export interface IssueComment {
  body?: string | null;
  id: number;
  updated_at?: string | null;
  user?: { login?: string | null; type?: string | null } | null;
}

export interface CiState {
  failed: Array<CheckRun | CommitStatus>;
  passed: Array<CheckRun | CommitStatus>;
  pending: Array<CheckRun | CommitStatus>;
  total: number;
}

export interface ReviewState {
  approvals: number;
  changes: number;
}

export interface BranchState {
  behind: number | null;
}

export interface StatusState {
  blockers: string[];
  key: string;
  title: string;
}
