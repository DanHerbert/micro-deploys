#!/bin/bash

# This script can update itself while running (since it updates through git)
# All commands must happen within these curly brace blocks to ensure everything
# loads into memory before executing.
{
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
project_root=$(cd -- "$script_dir"; git rev-parse --show-superproject-working-tree)
# If not running as a submodule, the project root will be empty.
if [[ -z "$project_root" ]]; then
    project_root=$(cd -- "$script_dir"; git rev-parse --show-toplevel)
fi
echo "deploy project_root:"
echo "$project_root"

exec 2>&1
set -eux

cd "$project_root"
OWNER=$(stat -c "%U" "$project_root")
GROUP=$(stat -c "%G" "$project_root")

if [[ $(git status --porcelain | wc -l) -gt 0 ]]; then
    git stash push --include-untracked \
        --message "Publishing content $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
fi
if [[ $(git branch --show-current) != 'main' ]]; then
    git checkout --force main
fi
GIT_SSH_COMMAND="ssh -o BatchMode=yes" git pull --force --recurse-submodules
GIT_SSH_COMMAND="ssh -o BatchMode=yes" git submodule update --recursive --init

# When this update happens through systemd (root), ownership can get wonky.
chown -R "$OWNER":"$GROUP" "$project_root"

if command -v pnpm 2>/dev/null; then
    pnpm install
    pnpm run deploy
else
    npm install
    npm run deploy
fi
}; exit
