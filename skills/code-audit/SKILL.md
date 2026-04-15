---
name: code-audit
description: Deep-audit a codebase or specific files for bugs, false logic, race conditions, security holes, performance issues, and architectural smells. Use when user asks to review code for bugs, find issues, check for logic errors, audit quality, spot improvements, or stress-test correctness.
---

# Code Audit

## Quick Start

When triggered, ask the user for scope:

1. **Full codebase** — run all checklist sections across the project
2. **Feature/module** — audit a specific feature, folder, or set of files
3. **Single file/PR** — focused review of specific changes

Then run the relevant sections from the workflow below. Present findings grouped by severity.

## Workflow

### 1. Scope & Context

- [ ] Identify target files/folders/features to audit
- [ ] Read related configs, types, and models to understand data shapes
- [ ] Trace the primary user flows through the target code

### 2. Logic & Correctness (see [REFERENCE.md](REFERENCE.md#logic--correctness))

- [ ] Check conditionals for off-by-one, inverted logic, missing branches
- [ ] Verify null/undefined handling — especially optional chaining chains
- [ ] Audit state transitions for impossible or skipped states
- [ ] Check async flows for race conditions, missing awaits, unhandled rejections
- [ ] Verify array/object mutations vs immutable expectations
- [ ] Look for stale closures in React hooks (missing deps)
- [ ] Check for silent failures — catch blocks that swallow errors

### 3. Security (see [REFERENCE.md](REFERENCE.md#security))

- [ ] Check for exposed secrets, API keys, or tokens in code/configs
- [ ] Audit auth checks — missing middleware, client-only guards
- [ ] Check for injection vectors (SQL, XSS, command injection)
- [ ] Verify input validation at system boundaries
- [ ] Check CORS, CSP, and header configurations
- [ ] Audit sensitive data exposure in logs, responses, or client bundles

### 4. Performance & Resource Leaks (see [REFERENCE.md](REFERENCE.md#performance--resource-leaks))

- [ ] Identify N+1 queries or unbounded data fetches
- [ ] Check for missing cleanup in effects, subscriptions, WebSockets
- [ ] Look for unnecessary re-renders (inline objects/functions in JSX)
- [ ] Audit bundle size — large imports that should be lazy/dynamic
- [ ] Check for missing pagination or limits on list endpoints

### 5. Architecture & Maintainability (see [REFERENCE.md](REFERENCE.md#architecture--maintainability))

- [ ] Flag tight coupling between modules that should be independent
- [ ] Identify duplicated logic that should be extracted
- [ ] Check for prop drilling that signals missing context/state
- [ ] Look for business logic in UI components (should be in hooks/services)
- [ ] Identify inconsistent patterns across similar features
- [ ] Flag dead code, unused exports, and orphaned files

### 6. Error Handling & Edge Cases (see [REFERENCE.md](REFERENCE.md#error-handling--edge-cases))

- [ ] Check API calls for missing error/loading states
- [ ] Audit form validation — empty, malformed, and boundary inputs
- [ ] Verify timeout and retry behavior for network calls
- [ ] Check for empty state handling (no data, first-time user)
- [ ] Look for unhandled Promise rejections or uncaught exceptions

## Output Format

```markdown
## Audit Summary
| Severity | Count |
|----------|-------|
| Critical | X     |
| Warning  | X     |
| Info     | X     |

## Critical Issues
### [C1] Title — file(s)
**What**: Description of the bug or vulnerability
**Why**: Impact if not fixed
**Fix**: Concrete code change or approach

## Warnings
### [W1] Title — file(s)
**What**: ...
**Why**: ...
**Fix**: ...

## Improvements
### [I1] Title — file(s)
**What**: ...
**Benefit**: ...
**Suggestion**: ...
```

## Tips

- Grep for known smell patterns: `catch {}`, `any`, `TODO`, `eslint-disable`, `as unknown`
- Read types/models first — most logic bugs stem from wrong assumptions about data shapes
- Trace one happy path AND one error path per feature
- Check what happens when APIs return unexpected shapes or empty data
- Compare similar features — inconsistencies often hide bugs
