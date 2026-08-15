#!/bin/bash
# SessionStart hook: make the pinned .ai core available.
#
# A clone records the .ai/core gitlink but leaves the directory empty until the
# submodule is initialized, so AGENTS.md ends up pointing at files that are not
# there. That is worst in Claude Code on the web, where nobody is around to run
# the init by hand, but it happens in local clones too -- so unlike feedseek's
# hook this one does not gate on CLAUDE_CODE_REMOTE.
#
# Deliberately never fails the session: a missing core is worth a warning, not a
# dead start. The agent can still work, it just has less context.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" 2>/dev/null || exit 0

# AGENTS.md is the file the pointer in the repository root actually promises.
if [ -f .ai/core/AGENTS.md ]; then
	exit 0
fi

echo "==> .ai/core is empty, initializing the pinned submodule"
if git submodule update --init .ai/core; then
	echo "==> .ai/core ready"
else
	echo "==> WARNING: could not initialize .ai/core (see .ai/README.md for the manual step)" >&2
fi

exit 0
