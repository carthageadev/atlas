# atlas - agent rules

## Data files are owned by the scraper

`data/roms.json.gz` and `data/meta.json` are written **only** by the
scraper job in `.github/workflows/scrape.yml`. Never hand-edit them.

Rules:

1. **Never `git commit` data changes from a local edit.** If a local
   scraper run rewrites the data, discard it with
   `git checkout -- data/roms.json.gz data/meta.json`.
2. **Never force-push `main`.** A force-push can drop a fresh
   `[skip ci] chore: update index` commit from the weekly scraper and
   silently roll the live index backwards.
3. **Never reset, rebase, or reword commits that touch `data/`.** Leave
   `[skip ci] chore: update index ...` commits exactly as they are.
4. **Always `git fetch origin` and `git pull --rebase` before pushing.**
   Merge if the scraper committed in the meantime.
5. **To ship code changes:** commit only `site/`, `scraper/*.py`,
   `vite.config.ts`, `tsconfig.json`, `package.json`, and workflows.
   Stage by path, never `git add -A`.
6. If a force-push is genuinely required, re-fetch and re-apply
   `origin/main`'s `data/` first, then verify
   `git diff --stat origin/main -- data/` is empty before pushing.

## Commits

Short, vague messages. One feature or fix per commit.

## Structure

```
scraper/  python crawler, writes data/
site/     Vite + React frontend
data/     roms.json.gz + meta.json (scraper-owned)
```

Frontend base path is `/atlas/` to match GitHub Pages.
