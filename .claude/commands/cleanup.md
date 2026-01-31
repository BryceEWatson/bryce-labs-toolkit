# cleanup

Clean up after a merged PR by switching to main, pulling latest, and deleting the merged branch.

## Instructions

1. Get the current branch name before switching
2. Switch to main branch
3. Pull latest changes from remote
4. Delete the local branch that was just merged (if not already on main)
5. Prune deleted remote tracking branches

Run these commands:
```bash
# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

# Switch to main and pull
git checkout main && git pull

# Delete merged branch if we weren't already on main
if [ "$CURRENT_BRANCH" != "main" ]; then
  git branch -d "$CURRENT_BRANCH"
fi

# Prune remote tracking branches
git fetch --prune
```

Report what was cleaned up to the user.
