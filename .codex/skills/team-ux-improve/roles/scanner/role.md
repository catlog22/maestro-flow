---
role: scanner
prefix: SCAN
inner_loop: false
message_types: [state_update]
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

# UI Scanner

## Phase 2: Context Loading

| Input | Source | Required |
|-------|--------|----------|
| Project path | Task description CONTEXT | Yes |
| Framework | Task description CONTEXT | Yes |
| Scan scope | Task description CONSTRAINTS | Yes |

1. Extract session path and project path from task description
2. Detect framework from project structure:

| Signal | Framework |
|--------|-----------|
| package.json has "react" | React |
| package.json has "vue" | Vue |
| *.tsx files present | React |
| *.vue files present | Vue |

3. Build file pattern list for scanning:
   - React: `**/*.tsx`, `**/*.jsx`, `**/use*.ts`
   - Vue: `**/*.vue`, `**/composables/*.ts`

### Wisdom Input

1. Read `<session>/wisdom/anti-patterns/common-ux-pitfalls.md` if available
2. Use anti-patterns to identify known UX issues during scanning
3. Check `<session>/wisdom/patterns/ui-feedback.md` for expected feedback patterns

### Complex Analysis (use CLI)

For large projects with many components:

```
Bash(`maestro delegate "PURPOSE: Discover all UI components with user interactions
CONTEXT: @<project-path>/**/*.tsx @<project-path>/**/*.vue
EXPECTED: Component list with interaction types (click, submit, input, select)
CONSTRAINTS: Focus on interactive components only" --tool agy --mode analysis`)
```

## Phase 3: Component Scanning

Scan strategy:

| Category | Detection Pattern | Severity |
|----------|-------------------|----------|
| Unresponsive actions | onClick/\@click without async handling or error catching | High |
| Missing loading state | Form submit without isLoading/loading ref | High |
| State not refreshing | Array.splice/push without reactive reassignment | High |
| Missing error feedback | try/catch without error state or user notification | Medium |
| Missing success feedback | API call without success confirmation | Medium |
| No empty state | Data list without empty state placeholder | Low |
| Input without validation | Form input without validation rules | Low |
| Missing file selector | Text input for file/folder path without picker | Medium |

### Visual Design Scanning

In addition to interaction issues, scan for visual design quality problems.
Reference `specs/design-standards.md` and `specs/anti-patterns.md`.

| Category | Detection Pattern | Severity |
|----------|-------------------|----------|
| AI color palette | Cyan (#00d4ff, #06b6d4), purple-blue gradients on dark | High |
| Pure black/white | #000, #fff, rgb(0,0,0), rgb(255,255,255) as primary colors | High |
| Generic font | Inter, Roboto, Open Sans, Arial as primary font-family | Medium |
| All buttons primary | Every button has same fill treatment, no hierarchy | High |
| Nested cards | border/shadow inside border/shadow containers | Medium |
| No focus-visible | Using :focus or outline:none without :focus-visible | High |
| Layout animations | Animating width/height/margin/padding | Medium |
| No reduced-motion | Missing @media(prefers-reduced-motion) | Medium |
| Bounce easing | cubic-bezier with negative values, spring/bounce | Medium |
| Monotonous spacing | >70% same padding/margin value | Low |
| Missing 8 states | Interactive elements with <5 defined states | Medium |
| Glassmorphism overuse | backdrop-filter:blur on >2 components | Medium |
| Generic button labels | "OK", "Submit", "Yes/No", "Cancel" without specific verb+object | Medium |
| Error messages without fix guidance | Error shows "Something went wrong" with no next step | High |
| Empty states without action | Data list shows "No data" without create/import action | Medium |
| Redundant copy | Heading text repeated in first paragraph (>50% word overlap) | Low |

### Heuristic UX Scanning

Apply Nielsen's 10 usability heuristics as a structured scan checklist.
Reference: `specs/heuristics.md`

| Heuristic | What to Check | Severity |
|-----------|---------------|----------|
| Visibility of system status | Loading indicators, progress bars, state feedback, timestamps | High |
| Match between system and real world | Jargon-free labels, familiar metaphors, logical ordering | Medium |
| User control and freedom | Undo/redo, back navigation, cancel actions, escape from modals | High |
| Consistency and standards | Same terms/icons for same actions, platform conventions | Medium |
| Error prevention | Confirmation for destructive actions, input validation, disable invalid options | High |
| Recognition over recall | Visible options, recent items, search suggestions, breadcrumbs | Medium |
| Flexibility and efficiency | Keyboard shortcuts, power-user features, bulk actions | Low |
| Aesthetic and minimalist design | Information density, noise reduction, visual hierarchy | Medium |
| Help users recover from errors | Error messages with fix guidance (what+why+fix), retry options | High |
| Help and documentation | Tooltips, onboarding, contextual help, empty states with guidance | Low |

For each component file:
1. Read file content
2. Scan for interaction patterns using Grep
3. Check for feedback mechanisms (loading, error, success states)
4. Check state update patterns (mutation vs reactive)
5. Record issues with file:line references

## Phase 4: Issue Report Generation

1. Classify issues by severity (High/Medium/Low)
2. Group by category (unresponsive, missing feedback, state issues, input UX, visual design)
3. Generate structured report and write to `<session>/artifacts/scan-report.md`
4. Share state via team_msg:
   ```
   team_msg(operation="log", session_id=<session-id>, from="scanner",
            type="state_update", data={
              total_issues: <count>,
              high: <count>, medium: <count>, low: <count>,
              categories: [<category-list>],
              scanned_files: <count>
            })
   ```

### Wisdom Contribution

If novel UX issues discovered that aren't in anti-patterns:
1. Write findings to `<session>/wisdom/contributions/scanner-issues-<timestamp>.md`
2. Format: Issue description, detection criteria, affected components
