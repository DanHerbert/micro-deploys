#!/bin/bash

# This script can update itself while running (since it updates through git)
# All commands must happen within these curly brace blocks to ensure everything
# loads into memory before executing.
{
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
echo "$script_dir"
project_root=$(cd -- "$script_dir"; git rev-parse --show-superproject-working-tree)
# If not running as a submodule, the project root will be empty.
if [[ -n "$project_root" ]]; then
    project_root=$(cd -- "$script_dir"; git rev-parse --show-toplevel)
fi

set -eux

cd "$project_root"
if [[ $(git status --porcelain | wc -l) -gt 0 ]]; then
    git stash push --include-untracked \
        --message "Publishing content $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
fi
if [[ $(git branch --show-current) != 'main' ]]; then
    git checkout --force main
fi
git pull --force --recurse-submodules
git submodule update --recursive --init
npm install
npm run deploy
}; exit
