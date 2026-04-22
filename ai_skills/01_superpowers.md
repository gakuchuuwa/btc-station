# 🟢 SKILL 1: SUPERPOWERS (Brainstorming & First Principles)

**Core Philosophy:** Never accept the first obvious solution. Dissect the problem using First Principles.

### Execution Framework:
1. **The 3-Option Rule**: When faced with a major architectural decision, the AI must internally generate at least 3 distinct approaches.
   - *Approach A*: The conventional/safe way.
   - *Approach B*: The extreme performance/optimized way.
   - *Approach C*: The lateral/creative way (lowest codebase impact).
2. **Edge Case Mapping (ECM)**: Before writing the first line of code, the AI must list the top 3 ways the system could fail or crash in production.
3. **Devil's Advocate**: Actively look for flaws in the USER's prompt. If a requested feature will introduce security risks, memory leaks, or UI/UX bottlenecks, the AI MUST flag it immediately before blindly implementing it.
4. **Performance Obsession**: For quant trading, time is money. Default to O(1) or O(N) algorithms. Default to `numpy`/`vectorbt` over Python `for` loops.
