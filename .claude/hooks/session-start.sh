#!/bin/bash
# SessionStart hook: make the pinned .ai core available, and on the web also
# install the Worker dependencies so checks run without a manual npm ci.
#
# A clone records the .ai/core gitlink but leaves the directory empty until the
# submodule is initialized, so AGENTS.md ends up pointing at files that are not
# there. That is worst in Claude Code on the web, where nobody is around to run
# the init by hand, but it happens in local clones too -- so unlike feedseek's
# hook this one does not gate on CLAUDE_CODE_REMOTE.
#
# Registered in shell form (settings.json passes no "args"). Exec form would
# require .claude/hooks/session-start.sh to be a real executable, which on
# Windows a .sh file is not, and the hook would never spawn at all.
#
# Deliberately never fails the session: a missing core is worth a warning, not a
# dead start. The agent can still work, it just has less context.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" 2>/dev/null || exit 0

# Runs in linked worktrees too, on purpose. The concern was that `submodule
# update` there would repoint the single core.worktree in the common
# .git/modules and detach the main checkout's .ai/core. Measured on git 2.55
# instead of assumed: a linked worktree gets its own submodule gitdir under
# .git/worktrees/<name>/modules/, the main checkout stays clean and functional.
# Guarding this out would cost delegated agents their context for nothing.
#
# `submodule status` reports "-<sha>" when uninitialized and "+<sha>" when the
# checkout does not match the recorded commit. Testing for a file instead would
# make a re-pinned core stick at the old commit forever.
sync_core() {
	status="$(git submodule status .ai/core 2>/dev/null || true)"
	case "$status" in
		-* | +*) ;;
		"")
			echo "==> WARNING: no .ai/core submodule recorded here; skipping" >&2
			return 0
			;;
		*) return 0 ;;
	esac

	echo "==> .ai/core is out of date, syncing the pinned submodule"
	if git submodule update --init .ai/core; then
		echo "==> .ai/core ready"
	else
		echo "==> WARNING: could not sync .ai/core (see .ai/README.md for the manual step)" >&2
	fi
}

sync_core

# Every install root here commits a package-lock.json and its CI installs from
# it, so `npm ci` reproduces exactly what the checks run against. Roots are
# discovered from git instead of listed by hand, so a new Worker is covered the
# day it lands. Installs run in parallel, and a root whose node_modules is
# already newer than its lockfile is skipped: hooks also fire on resume, and a
# second `npm ci` would wipe and rebuild node_modules for nothing.
#
# A failed install is a warning, not a dead session, for the same reason the
# core sync is: the agent can still read code, it just cannot run that project's
# checks. Installs are independent, so one failure must not skip the rest.
install_workers() {
	local failed=""
	local dir pids=() dirs=()

	while IFS= read -r lock; do
		dir="$(dirname "$lock")"
		[ "$dir/node_modules/.package-lock.json" -nt "$lock" ] && continue
		(cd "$dir" && npm ci --no-audit --no-fund --no-update-notifier --loglevel=error >/dev/null) &
		pids+=("$!")
		dirs+=("$dir")
	done < <(git ls-files '*package-lock.json')

	local i
	for i in "${!pids[@]}"; do
		if wait "${pids[$i]}"; then
			echo "==> ${dirs[$i]}: npm ci"
		else
			failed="$failed ${dirs[$i]}"
		fi
	done

	if [ -n "$failed" ]; then
		echo "==> WARNING: npm ci failed for:$failed" >&2
	fi
}

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
	install_workers
	echo "==> dependencies ready"
fi

exit 0
