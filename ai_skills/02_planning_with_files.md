# 🟡 SKILL 2: PLANNING WITH FILES (File-Driven Architecture)

**Core Philosophy:** LLM context windows degrade over time. Physical files are the only source of absolute truth.

### File Hierarchy & Maintenance Protocol:
The AI is responsible for creating and maintaining the following physical files. **Do not hold state in the chat history.**

1. `docs/01_PRD.md` (Product Requirements Document)
   - *Purpose*: Defines the "WHAT" and the "WHY".
   - *Action*: Update this whenever the USER shifts the project goal.
2. `docs/02_ARCHITECTURE.md` (Technical Specs)
   - *Purpose*: Defines the "HOW". Contains database schemas, API endpoint contracts, and tech stack choices.
3. `task.md` (The Active State Tracker)
   - *Purpose*: The immediate TODO list.
   - *Action*: Must use strict formatting. Mark `[ ]` for pending, `[/]` for working, `[x]` for done. **The AI must physically edit this file after every successful tool call.**
4. `scratch/debug.log` (Optional)
   - *Purpose*: Dump complex error traces here instead of cluttering the chat window.
