---
name: deploy-prod-from-main
description: Pushes the current work on main to production by updating the prod branch—commit and push main, then applies every commit that exists on main but not on prod onto prod as one squashed commit and pushes prod (triggers GitHub Pages). Use when the user asks to deploy to prod, ship to production, release main to the live site, or run this repo’s prod deploy workflow.
---

# Deploy working `main` to production (`prod`)

Production is the **`prod`** branch. Pushing **`prod`** to **`origin`** runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) and deploys to GitHub Pages.

## Preconditions

- **`main`** is the integration branch; **`prod`** tracks what is live.
- Prefer a **clean** working tree on `main` before pushing (or explicitly include WIP in the commit the user wants).

## Workflow (agent)

### 1. Land work on `main`

1. `git status` — confirm what will ship.
2. If there are changes to commit: stage, commit with a clear message, then `git push origin main`.
3. If already pushed and clean: continue.

### 2. Sync `prod` with `main` (squashed cherry-pick)

Goal: **one new commit on `prod`** that contains **all changes reachable from `main` but not from `prod`**, without preserving per-commit history on `prod`.

1. `git fetch origin`
2. `git checkout prod`
3. `git pull origin prod`
4. Apply all `main`-only commits as **one** commit (no per-commit cherry-pick noise on `prod`):

   **Git Bash / sh (recommended on Windows):**

   ```bash
   commits=$(git rev-list --reverse prod..main)
   if [ -z "$commits" ]; then
     echo "prod already includes main; nothing to cherry-pick."
   else
     git cherry-pick -n $commits
     git commit -m "Deploy: sync main to prod ($(date -u +%Y-%m-%d))"
   fi
   ```

   **`git cherry-pick -n`** applies the patch series **without** committing after each step; the final **`git commit`** is the squash.

5. `git push origin prod`

### 3. Verify

- Confirm the workflow run for **`prod`** on GitHub Actions (Pages deploy).
- If **`prod..main`** was empty in step 2, **do not** create an empty commit; **`prod`** is already aligned with **`main`** for deployed content.

## Conflicts

If **`git cherry-pick -n`** stops with conflicts:

1. Resolve files, **`git add`** resolved paths.
2. **`git cherry-pick --continue`** if Git still considers the cherry-pick in progress; otherwise complete the single commit manually.
3. **`git push origin prod`** when the branch is consistent.

## Alternative (equivalent squash, not cherry-pick)

If a linear history allows it and the user accepts merge semantics:

- On **`prod`**: **`git merge --squash main`** then one commit and **`git push origin prod`**.

Prefer the **cherry-pick -n** path when matching the team’s “cherry-pick then squash” wording.

## Do not

- Deploy from **`main`** directly for this project—**Pages listens to **`prod`**** per workflow.
- Squash **`main`**’s history when only **`prod`** should get a single deploy commit (keep **`main`**’s normal commit history unless the user asks otherwise).
