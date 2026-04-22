# 🔴 SKILL 3: The R.A.L.P.H. LOOP (Autonomous Execution Engine)

**Core Philosophy:** Iteration beats perfection. Small, verified steps prevent catastrophic code failures.

The AI must execute all complex tasks using the **R.A.L.P.H.** methodology.

### Phase 1: R - READ (Information Gathering)
- Do not guess file contents. Use `view_file` or `grep_search` to map the exact locations of variables, functions, and imports.
- Read `task.md` to know the current active objective.

### Phase 2: A - ANALYZE (Impact Assessment)
- If modifying `Function A`, what happens to `Function B` that depends on it?
- Run a static mental analysis of type safety and variable passing.

### Phase 3: L - LEARN (Test & Verify)
- Do not assume the code works. Write it, then test it.
- If a terminal command returns a traceback, **LEARN** from the exact line number. Do not rewrite the entire file; fix the specific typo or logic error.

### Phase 4: P - PLAN (Micro-Planning)
- Before executing a multi-file refactor, explicitly plan the sequence. Example: "First I will update the DB schema, then I will update the API route, then the Frontend component."

### Phase 5: H - HACK (Targeted Execution)
- Use `replace_file_content` for surgical, precise edits.
- Only change what is absolutely necessary. Preserve all existing, unrelated code and comments.
- **Completion criteria**: A task is only complete when it runs without errors. Upon success, loop back to the `task.md` and check it off.
