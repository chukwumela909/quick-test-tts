# Code Audit — Reference Checklists

Detailed patterns and anti-patterns to check during each audit phase.

## Logic & Correctness

### Conditional & Boolean Logic

| Pattern | What to check |
|---------|---------------|
| `if (a && b)` | Should it be `\|\|`? Are both conditions necessary? |
| `if (!a)` | Is the negation correct? Double-negatives? |
| `x === undefined` | Should it also check `null`? Use `x == null` for both? |
| `array.length` | Falsy when 0 — is that the intended behavior? |
| `if (obj.status === 'active')` | Are all other statuses handled? Missing `else`/`default`? |
| Ternary chains | Deeply nested ternaries hiding missed branches |
| `switch` without `default` | What happens for unexpected values? |

### Async & Concurrency

| Pattern | What to check |
|---------|---------------|
| Missing `await` | Function returns Promise but caller doesn't await |
| `Promise.all` with side effects | If one fails, others still execute — should it be `allSettled`? |
| Race conditions in state | Two async operations updating the same state |
| `useEffect` with async | Cleanup function won't cancel in-flight requests |
| Stale closures | `useEffect`/`useCallback` missing dependencies |
| `setTimeout`/`setInterval` | Not cleared on unmount |
| Event listeners | Not removed on cleanup |

### Data & Type Issues

| Pattern | What to check |
|---------|---------------|
| `as any` / `as unknown as X` | Type assertion hiding real type mismatch |
| Optional chaining `?.` chains | What value flows through when something is undefined? |
| Array index access `arr[0]` | Could array be empty? |
| Object spread `{...a, ...b}` | Does `b` accidentally overwrite important `a` properties? |
| `parseInt` without radix | Always pass radix: `parseInt(x, 10)` |
| Floating point math | `0.1 + 0.2 !== 0.3` — use integer cents for money |
| String comparison for numbers | `"10" < "9"` is `true` (lexicographic) |
| Date manipulation | Timezone issues, month 0-indexing, DST edge cases |

### React-Specific

| Pattern | What to check |
|---------|---------------|
| `useEffect` missing deps | State referenced but not in dependency array |
| `useEffect` running twice | Strict mode double-invocation — is it resilient? |
| Inline objects in JSX props | `style={{}}` creates new ref every render |
| Key prop issues | Using array index as key with dynamic lists |
| State updates in render | Direct mutations or side effects during render phase |
| Conditional hooks | Hooks called inside conditions violate rules of hooks |
| `useMemo`/`useCallback` | Missing deps, or premature optimization with no benefit |

---

## Security

### Authentication & Authorization

- [ ] Are API routes protected with auth middleware?
- [ ] Is authorization checked (not just authentication) — can user A access user B's data?
- [ ] Are JWTs validated properly (signature, expiry, issuer)?
- [ ] Is session invalidation handled on logout?
- [ ] Are admin routes protected on both client AND server?

### Input Validation

- [ ] Is all user input validated/sanitized before processing?
- [ ] Are file uploads restricted by type and size?
- [ ] Are URL parameters validated before use in queries?
- [ ] Are request bodies validated against expected schemas?
- [ ] Is `dangerouslySetInnerHTML` used with sanitized content?

### Data Exposure

- [ ] Are API responses filtered to exclude sensitive fields?
- [ ] Are error messages generic (not exposing stack traces or internals)?
- [ ] Are environment variables properly separated (server vs client)?
- [ ] Are source maps disabled in production?
- [ ] Is sensitive data excluded from logs?

### Common Vulnerabilities

- [ ] **XSS**: User content rendered without escaping?
- [ ] **CSRF**: State-changing requests without CSRF tokens?
- [ ] **IDOR**: Direct object references without ownership checks?
- [ ] **Open redirect**: Redirect URLs taken from user input without validation?
- [ ] **Prototype pollution**: Deep merge of user-controlled objects?
- [ ] **ReDoS**: Complex regex patterns on user input?

---

## Performance & Resource Leaks

### Data Fetching

- [ ] N+1 queries — loop with individual fetches instead of batch
- [ ] Unbounded queries — missing `LIMIT` or pagination
- [ ] Refetching data already available in cache/context
- [ ] Waterfalls — sequential fetches that could be parallel
- [ ] Missing error boundaries around data-dependent components

### Memory & Subscriptions

- [ ] WebSocket connections not closed on unmount
- [ ] Event listeners not removed
- [ ] Intervals/timeouts not cleared
- [ ] Large data structures held in state beyond their lifecycle
- [ ] Observers (IntersectionObserver, etc.) not disconnected

### Rendering

- [ ] Components re-rendering on every parent render (missing memo)
- [ ] Inline arrow functions in JSX causing child re-renders
- [ ] Large lists without virtualization
- [ ] Images without width/height (layout shift)
- [ ] Missing `loading="lazy"` on below-fold images

### Bundle Size

- [ ] Full library imported when only one function is needed
- [ ] Dynamic import (`next/dynamic`, `React.lazy`) for heavy components
- [ ] SVGs inlined vs referenced — large SVGs should be external
- [ ] Vendor chunks not split — one large bundle

---

## Architecture & Maintainability

### Coupling & Cohesion

- [ ] Component directly calls multiple unrelated APIs (should use a service/hook)
- [ ] Shared global state used for local concerns
- [ ] Circular dependencies between modules
- [ ] UI components contain business logic (validation, calculations, formatting)
- [ ] Utility functions with side effects (should be pure)

### Consistency

- [ ] Similar features implemented differently (e.g., different data fetching patterns)
- [ ] Mixed naming conventions (camelCase vs snake_case vs PascalCase)
- [ ] Inconsistent error handling across API calls
- [ ] Some forms use a form library, others are manual
- [ ] Inconsistent file/folder naming across features

### Code Smells

- [ ] Functions longer than 50 lines
- [ ] Components longer than 300 lines
- [ ] More than 5 props (prop drilling signal)
- [ ] Deeply nested callbacks (>3 levels)
- [ ] Magic numbers or strings without constants
- [ ] Copy-pasted blocks with minor variations

---

## Error Handling & Edge Cases

### API & Network

- [ ] What happens when the API returns 500?
- [ ] What happens when the API returns an unexpected shape?
- [ ] What happens on network timeout?
- [ ] Is there retry logic for transient failures?
- [ ] Is there a global error boundary?

### User Input

- [ ] Empty form submission
- [ ] Extremely long input values
- [ ] Special characters (quotes, angle brackets, unicode)
- [ ] Negative numbers where only positive expected
- [ ] Concurrent form submissions (double-click)

### State Edge Cases

- [ ] Empty state (no data yet)
- [ ] Loading state (data in transit)
- [ ] Error state (fetch failed)
- [ ] Stale state (data changed server-side)
- [ ] Partial state (some fields missing)
- [ ] First-time user (no history, no preferences)
- [ ] Token expiry during active session
