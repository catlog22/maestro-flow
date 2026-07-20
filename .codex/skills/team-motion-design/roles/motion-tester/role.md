---
role: motion-tester
prefix: MTEST
inner_loop: false
message_types: "[state_update]"
---

# Motion Performance Tester

## Phase 2: Context & Artifact Loading

| Input | Source | Required |
|-------|--------|----------|
| Animation files | {run_dir}/outputs/animations/keyframes/*.css | Yes |
| JS orchestrators | {run_dir}/outputs/animations/orchestrators/*.js | Yes |
| Motion tokens | {run_dir}/outputs/choreography/motion-tokens.json | Yes |
| Choreography sequences | {run_dir}/outputs/choreography/sequences/*.md | Yes (component/page) |
| GPU constraints | specs/gpu-constraints.md | Yes |
| Reduced motion spec | specs/reduced-motion.md | Yes |
| .msg/meta.json | {run_dir}/work/team/wisdom/.msg/meta.json | Yes |

1. Extract session path from task description
2. Read all animation CSS files from animations/keyframes/
3. Read all JS orchestrator files from animations/orchestrators/
4. Read motion tokens for reference values
5. Read choreography sequences for expected behavior
6. Read GPU constraints and reduced motion specs for validation rules

## Phase 3: Test Execution

### Test 1: Compositor-Only Verification

Scan all CSS @keyframes and transition properties for unsafe values:

**SAFE** (compositor thread, no repaint):
- `transform` (translate, scale, rotate, skew)
- `opacity`
- `filter` (blur, brightness, contrast)
- `backdrop-filter`

**UNSAFE** (trigger layout/paint):
- `width`, `height`, `top`, `left`, `right`, `bottom`
- `margin`, `padding`, `border`
- `font-size`, `color`, `background-color`
- `box-shadow` (partial -- expensive paint)

For each animation file:
1. Parse @keyframes blocks, extract animated properties
2. Parse transition declarations, extract properties
3. Flag any UNSAFE property with file:line reference
4. Score: `safe_percentage = safe_count / total_count * 100`

### Test 2: Frame Rate Analysis

**If Chrome DevTools MCP available**:
1. `mcp__chrome-devtools__performance_start_trace()` -- start recording
2. `mcp__chrome-devtools__evaluate_script({ expression: "/* trigger animations */" })` -- trigger
3. `mcp__chrome-devtools__performance_stop_trace()` -- stop recording
4. `mcp__chrome-devtools__performance_analyze_insight()` -- analyze
5. Extract: average FPS, minimum FPS, frame drops, long frames (>16.67ms)
6. Target: average >= 60fps, minimum >= 45fps, no consecutive drops

**If Chrome DevTools unavailable** (static analysis fallback):
1. Count total animated properties per frame (concurrent animations)
2. Estimate frame budget: < 5ms style+layout, < 5ms paint+composite
3. Flag: >10 concurrent animations, nested animations, forced synchronous layouts
4. Mark `_source: "static-analysis"` and note limitations

### Test 3: Layout Thrashing Detection

Scan JS orchestrators for read-write-read patterns:

**Thrashing patterns** (DOM read -> write -> read in same frame):
- `offsetHeight` / `offsetWidth` read followed by style write followed by read
- `getBoundingClientRect()` interleaved with style mutations
- `getComputedStyle()` followed by DOM writes

For each JS file:
1. Parse for DOM read APIs: `offsetHeight`, `offsetWidth`, `clientHeight`, `getBoundingClientRect`, `getComputedStyle`, `scrollTop`, `scrollHeight`
2. Check if style writes (`.style.*`, `.classList.*`, `.setAttribute`) occur between reads
3. Flag thrashing sequences with file:line references

### Test 4: will-change Audit

1. Count elements with `will-change` in CSS
2. Flag if count > 4 (memory cost)
3. Check for `will-change: auto` on collections (anti-pattern)
4. Verify will-change is removed after animation completes (in JS orchestrators)
5. Check for missing will-change on heavily animated elements

### Test 5: Reduced Motion Compliance

1. Verify `@media (prefers-reduced-motion: reduce)` block exists
2. Check all animation-duration and transition-duration are overridden
3. Verify scroll-behavior set to auto
4. Check JS for `matchMedia('(prefers-reduced-motion: reduce)')` detection
5. Verify parallax effects disabled in reduced motion
6. Verify no auto-playing or infinite loop animations in reduced motion

### Perceived Performance Checks
| Check | Pass Criteria |
|-------|---------------|
| Preemptive animation start | Hover/click animations start on pointerdown, not click |
| No height/width animation | Grid-template-rows trick used instead of height transitions |
| Ease-in for progress | Progress indicators use ease-in (compresses perceived wait) |
| Ease-out for entrances | Content entrances use ease-out (natural settle) |

**Scoring**:

| Check | Weight | Criteria |
|-------|--------|----------|
| Compositor-only | 30% | 100% safe = 10, each unsafe -2 |
| Frame rate | 25% | >= 60fps = 10, 50-59 = 7, 40-49 = 4, < 40 = 1 |
| Layout thrashing | 20% | 0 instances = 10, each instance -3 |
| will-change budget | 10% | <= 4 = 10, 5-6 = 7, 7+ = 3 |
| Reduced motion | 15% | All 5 checks pass = 10, each miss -2 |

**Overall score**: `round(compositor*0.30 + fps*0.25 + thrashing*0.20 + willchange*0.10 + reducedmotion*0.15)`

**Signal determination**:

| Condition | Signal |
|-----------|--------|
| Score >= 8 AND no layout thrashing AND FPS >= 60 | `perf_passed` (GATE PASSED) |
| Score >= 6 AND no critical issues | `perf_warning` (REVISION SUGGESTED) |
| Score < 6 OR layout thrashing OR FPS < 60 | `fix_required` (CRITICAL FIX NEEDED) |

## Phase 4: Report & Output

1. Write performance report to `{run_dir}/outputs/testing/reports/perf-report-{NNN}.md`:
   ```markdown
   # Performance Report {NNN}

   ## Summary
   - Overall Score: X/10
   - Signal: perf_passed|perf_warning|fix_required
   - Source: chrome-devtools|static-analysis

   ## Compositor-Only Verification
   - Safe: X/Y properties (Z%)
   - Unsafe properties found:
     - [file:line] property: suggestion

   ## Frame Rate
   - Average FPS: X
   - Minimum FPS: X
   - Frame drops: X
   - Long frames (>16.67ms): X

   ## Layout Thrashing
   - Instances found: X
   - Details:
     - [file:line] pattern: description

   ## will-change Audit
   - Elements with will-change: X
   - Budget status: OK|OVER
   - Issues:
     - [file:line] issue: description

   ## Reduced Motion Compliance
   - @media query present: yes|no
   - Duration override: yes|no
   - JS detection: yes|no
   - Parallax disabled: yes|no|N/A
   - No infinite loops: yes|no

   ## Recommendations
   1. [Priority] Description
   ```

2. Update `{run_dir}/work/team/wisdom/.msg/meta.json` under `motion-tester` namespace:
   - Read existing -> merge `{ "motion-tester": { report_id, score, signal, fps_average, safe_percentage, thrashing_count, will_change_count, reduced_motion_complete } }` -> write back
