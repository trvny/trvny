'use strict';

// PR gate + existing Pages deployment. Run trusted code from main only.
const OWNER = 'trvny';
const REPO = 'trvny';
const REQUIRED = ['TRAVNY Pages', 'MegaLinter'];
const SOURCE = /^pages\/astro\/src\/content\/digests\/(\d{4}-\d{2}-\d{2})\.md$/;
const HEAD = /^content\/coczydziennik-(\d{4}-\d{2}-\d{2})$/;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digestTarget(pr, files) {
  if (pr.state !== 'open' || pr.draft || pr.base?.ref !== 'main') return null;
  if (pr.user?.login !== OWNER || pr.head?.repo?.full_name !== `${OWNER}/${REPO}`) return null;
  const branch = HEAD.exec(pr.head?.ref || '');
  if (!branch || files.length !== 1 || files[0]?.status === 'renamed' || files[0]?.previous_filename) return null;
  const path = SOURCE.exec(files[0]?.filename || '');
  return path && branch[1] === path[1] ? { date: path[1], path: files[0].filename } : null;
}

function workflowGate(runs, sha) {
  for (const name of REQUIRED) {
    const matches = runs.filter((run) => run.name === name && run.head_sha === sha && run.event === 'pull_request');
    matches.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    const current = matches[0];
    if (!current) return { ready: false, pending: true, reason: `${name}: no run for final head` };
    if (current.status !== 'completed') return { ready: false, pending: true, reason: `${name}: ${current.status}` };
    if (current.conclusion !== 'success') return { ready: false, pending: false, reason: `${name}: ${current.conclusion}` };
  }
  return { ready: true };
}

async function reviewGate(github, number) {
  let cursor;
  const unresolved = [];
  do {
    const data = await github.graphql(`query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
      repository(owner:$owner,name:$repo){pullRequest(number:$number){
        reviewThreads(first:100,after:$cursor){nodes{id,isResolved,isOutdated}
        pageInfo{hasNextPage,endCursor}}
      }}
    }`, { owner: OWNER, repo: REPO, number, cursor: cursor || null });
    const threads = data.repository.pullRequest.reviewThreads;
    unresolved.push(...threads.nodes.filter((item) => !item.isResolved && !item.isOutdated));
    cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (cursor);

  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    owner: OWNER, repo: REPO, pull_number: number, per_page: 100,
  });
  const latest = new Map();
  for (const review of reviews) {
    const author = review.user?.login;
    if (author && ['CHANGES_REQUESTED', 'APPROVED', 'DISMISSED'].includes(review.state)) latest.set(author, review.state);
  }
  const changesRequested = [...latest].filter(([, state]) => state === 'CHANGES_REQUESTED').map(([author]) => author);
  return { unresolved, changesRequested };
}

function resolveNumber(context) {
  const event = context.payload;
  if (event.pull_request) return event.pull_request.number;
  return null;
}

async function checkSource(github, pr, target) {
  const { data } = await github.rest.repos.getContent({
    owner: OWNER, repo: REPO, path: target.path, ref: pr.head.sha,
  });
  if (Array.isArray(data) || typeof data.content !== 'string') throw Error('Digest source unavailable');
  const raw = Buffer.from(data.content, 'base64').toString('utf8');
  const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!front) throw Error('Digest frontmatter missing');
  const yaml = front[1];
  const field = (name) => {
    const line = yaml.split('\n').find((item) => item.startsWith(name + ':'));
    if (!line) return null;
    return line.slice(name.length + 1).replace(/\s+#.*$/, '').trim().replaceAll('"', '').replaceAll("'", '').trim();
  };
  const draft = field('draft');
  const meaningful = (item) => item && item !== 'null' && item !== '~';
  if (field('date') !== target.date || !meaningful(field('title')) ||
      !meaningful(field('description')) || (draft !== null && draft !== 'false')) {
    throw Error('Digest title, description, date or public draft frontmatter invalid');
  }
  const updated = field('updated');
  if (updated && !Number.isFinite(Date.parse(updated))) throw Error('Invalid digest updated timestamp');
  return updated || null;
}

async function commitGate(github, pr) {
  const commits = await github.paginate(github.rest.pulls.listCommits, {
    owner: OWNER, repo: REPO, pull_number: pr.number, per_page: 100,
  });
  if (!commits.length || commits.some((commit) => commit.author?.login !== 'gptomek[bot]')) {
    throw Error('Digest commits must be authored by gptomek[bot]. Repair/adopt the branch before merging.');
  }
}

async function waitForReady(github, pr, core) {
  // Workflow waits six minutes before invoking this gate.
  const deadline = Date.now() + 2 * 60_000;
  while (true) {
    const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
      owner: OWNER, repo: REPO, head_sha: pr.head.sha, event: 'pull_request', per_page: 100,
    });
    const ci = workflowGate(runs, pr.head.sha);
    if (ci.ready) break;
    if (!ci.pending) throw Error('CI blocked: ' + ci.reason);
    if (Date.now() >= deadline) throw Error('CI still pending: ' + ci.reason);
    core.info('Waiting for CI: ' + ci.reason);
    await pause(30_000);
  }

  const { data: fresh } = await github.rest.pulls.get({ owner: OWNER, repo: REPO, pull_number: pr.number });
  if (fresh.state !== 'open' || fresh.draft || fresh.base?.ref !== 'main' || fresh.head.sha !== pr.head.sha) {
    throw Error('PR changed or closed; publication stopped');
  }
  const reviews = await reviewGate(github, pr.number);
  if (reviews.unresolved.length || reviews.changesRequested.length) {
    throw Error('Review blocked: ' + reviews.unresolved.length + ' current unresolved thread(s); changes requested by ' +
      (reviews.changesRequested.join(', ') || 'none') + '. Fix feedback and retry with digest-publish-retry.');
  }
  return true;
}
async function confirmPublication(core, date, commit, updated, maxMs = 9 * 60_000) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw Error('Cloudflare deployment verification secrets unavailable');
  const deploymentUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/travny/deployments?per_page=25`;
  const url = `https://travny.pages.dev/przeglad/${date}/`;
  const until = Date.now() + maxMs;
  let reason = 'deployment not found';
  while (Date.now() < until) {
    try {
      const r = await fetch(deploymentUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, until - Date.now()))) });
      if (!r.ok) throw Error(`Cloudflare API HTTP ${r.status}`);
      const x = await r.json();
      if (!x.success) throw Error(`Cloudflare API: ${JSON.stringify(x.errors)}`);
      const deployment = (x.result || []).find((d) => d.environment === 'production' &&
        d.deployment_trigger?.metadata?.commit_hash === commit);
      if (deployment?.latest_stage?.status === 'failure' || deployment?.latest_stage?.status === 'canceled') {
        throw Error(`Production deployment failed (${deployment.id})`);
      }
      if (deployment?.latest_stage?.status === 'success') {
        const pages = [url, 'https://travny.pages.dev/teksty/', 'https://travny.pages.dev/teksty/feed.xml'];
        const freshness = `?publish_commit=${commit.slice(0, 12)}`;
        const response = await Promise.all(pages.map(async (page) => {
          const r = await fetch(page + freshness, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, until - Date.now()))) });
          return { page, ok: r.ok, body: r.ok ? await r.text() : '' };
        }));
        const feed = response[2].body;
        const entries = feed.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/g) || [];
        const dates = entries.map((item) => item.split('<updated>')[1]?.split('</updated>')[0]).filter(Boolean);
        const outsideFeedWindow = entries.length >= 100 && dates.length === entries.length &&
          Date.parse(updated || (date + 'T00:00:00Z')) < Math.min(...dates.map((item) => Date.parse(item)));
        if (response.every((v) => v.ok) && response[0].body.includes('CoCzyDziennik') &&
            response[1].body.includes(`/przeglad/${date}/`) &&
            (feed.includes(`/przeglad/${date}/`) || outsideFeedWindow)) {
          core.info(`Published: ${url}; deployment ${deployment.id}`);
          return url;
        }
        reason = 'deployment succeeded, permalink/directory/Atom not visible yet';
      } else reason = `deployment ${deployment?.latest_stage?.status || 'pending'}`;
    } catch (error) {
      if (/Production deployment failed/.test(String(error))) throw error;
      reason = String(error);
    }
    core.info(`Waiting for public site: ${reason}`);
    await pause(20_000);
  }
  throw Error(`Deployment verification timed out: ${reason}`);
}

async function run({ github, context, core }) {
  const number = resolveNumber(context);
  if (!number) return core.info('Not a matching CoCzyDziennik PR event.');
  const { data: pr } = await github.rest.pulls.get({ owner: OWNER, repo: REPO, pull_number: number });
  if (pr.state !== 'open') {
    const date = HEAD.exec(pr.head?.ref || '')?.[1];
    if (pr.merged && date && pr.merge_commit_sha && context.payload.action === 'labeled' &&
        context.payload.label?.name === 'digest-publish-retry') {
      const source = { date, path: `pages/astro/src/content/digests/${date}.md` };
      const updated = await checkSource(github, { head: { sha: pr.merge_commit_sha } }, source);
      const url = await confirmPublication(core, date, pr.merge_commit_sha, updated);
      return core.info(`Publication reverified: ${url}`);
    }
    return core.info(`PR #${number} already closed.`);
  }
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner: OWNER, repo: REPO, pull_number: number, per_page: 100,
  });
  const target = digestTarget(pr, files);
  if (!target) return core.info(`PR #${number} does not meet digest-only publication contract.`);

  core.info(`Digest ${target.date}: PR #${number}, commit ${pr.head.sha}.`);
  const effectiveUpdated = await checkSource(github, pr, target);
  await commitGate(github, pr);
  if (!(await waitForReady(github, pr, core))) return;

  // Recheck head and review state immediately before the guarded rebase merge.
  const { data: live } = await github.rest.pulls.get({ owner: OWNER, repo: REPO, pull_number: number });
  if (live.head.sha !== pr.head.sha || live.state !== 'open' || live.base?.ref !== 'main') throw Error('PR changed before merge');
  const reviews = await reviewGate(github, number);
  if (reviews.unresolved.length || reviews.changesRequested.length) throw Error('New review blocker before merge');
  if (live.mergeable === false) throw Error('PR is not mergeable');
  const { data: checks } = await github.rest.actions.listWorkflowRunsForRepo({
    owner: OWNER, repo: REPO, head_sha: pr.head.sha, event: 'pull_request', per_page: 100,
  });
  const finalCI = workflowGate(checks.workflow_runs || [], pr.head.sha);
  if (!finalCI.ready) throw Error('Final CI not green: ' + finalCI.reason);
  const { data: combined } = await github.rest.repos.getCombinedStatusForRef({
    owner: OWNER, repo: REPO, ref: pr.head.sha,
  });
  if (combined.statuses?.some((item) => ['failure', 'error', 'pending'].includes(item.state))) {
    throw Error('External status is not green');
  }

  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw Error('Cloudflare verification credentials unavailable');
  }
  const { data: merged } = await github.rest.pulls.merge({
    owner: OWNER, repo: REPO, pull_number: number, sha: pr.head.sha, merge_method: 'rebase',
  });
  if (!merged.merged || !merged.sha) throw Error('GitHub did not confirm rebase merge');
  core.info(`Merged PR #${number} as ${merged.sha}`);
  const url = await confirmPublication(core, target.date, merged.sha, effectiveUpdated);
  const marker = `<!-- coczydziennik-published:${target.date} -->`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: OWNER, repo: REPO, issue_number: number, per_page: 100,
  });
  if (!comments.some((comment) => comment.body?.includes(marker))) {
    await github.rest.issues.createComment({ owner: OWNER, repo: REPO, issue_number: number,
      body: `Published and verified: ${url}\n\nChecks, review threads, Cloudflare Pages production deployment, /teksty/ and Atom confirmed.\n${marker}` });
  }
  await core.summary.addHeading('CoCzyDziennik published').addLink(url, url).write();
}

module.exports = { run, digestTarget, workflowGate, resolveNumber };
