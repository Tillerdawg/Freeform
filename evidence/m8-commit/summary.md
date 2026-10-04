# M8 final commit evidence

Base HEAD (before): 3df1916315c43e7b4617bd037b62f76a3d0edc9a
New commit HEAD (after): 4131f0ee7c59d22ff3866ac71d087a3d3dc4c36b
origin/main before: 3df1916315c43e7b4617bd037b62f76a3d0edc9a
origin/main after:  3df1916315c43e7b4617bd037b62f76a3d0edc9a  (unchanged — no push performed)

Single commit created on top of 3df1916, plain commit (no amend/rebase):
  4131f0e M8: PDF export (director PDFs, performer packets, overlap warnings, export UI, README)

Pre-commit checks (dirty tree, before staging):
  git status --short --untracked-files=all -> see before-status.txt
  git branch --show-current -> main
  git rev-parse HEAD -> 3df1916315c43e7b4617bd037b62f76a3d0edc9a
  git diff --check -> exit 0 (clean; untracked files not covered by plain `git diff`)
  File-set review: confirmed src/document/export-snapshot-validation.ts and
  src/document/uri.ts (new) plus the src/persistence/freeform-file.ts edit are
  genuine M8 dependencies, not stray files: pdf-export.ts imports
  validateExportSnapshot from export-snapshot-validation.ts, which imports the
  new shared isAjvUri from document/uri.ts; freeform-file.ts was refactored to
  consume that same shared validator instead of an inline regex. No
  unexplained files, no second writer.

Post-commit checks:
  git status --short -> clean (only this evidence/m8-commit/ dir pending add)
  git log --oneline -3 -> see after-log.txt
  git rev-parse HEAD -> 4131f0ee7c59d22ff3866ac71d087a3d3dc4c36b
  git diff --check (worktree vs HEAD) -> exit 0
  git rev-parse origin/main -> 3df1916315c43e7b4617bd037b62f76a3d0edc9a (unchanged)
  git remote -v -> origin https://github.com/Tillerdawg/Freeform.git (fetch/push, untouched)

Gate re-run at new committed HEAD 4131f0e (see gate-log.txt for full output):
  npm test        -> exit 0, 31 test files passed (31), 270 tests passed (270)
  npm run test:docs -> exit 0
  npm run build     -> exit 0

No GitHub push, PR, or remote operation of any kind was performed.
