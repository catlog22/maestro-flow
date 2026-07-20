---
role: designer
prefix: DESIGN
inner_loop: false
message_types: "[state_update]"
---

# UX Designer

## Phase 2: Context & Pattern Loading

1. Load diagnosis report from `{run_dir}/outputs/diagnosis.md`
2. Load diagnoser state via `team_msg(operation="get_state", session_id=<run-id>, role="diagnoser")`
3. Detect framework from project structure
4. Load framework-specific patterns:

| Framework | State Pattern | Event Pattern |
|-----------|---------------|---------------|
| React | useState, useRef | onClick, onChange |
| Vue | ref, reactive | @click, @change |

### Wisdom Input

1. Read `{run_dir}/work/team/wisdom/patterns/ui-feedback.md` for established feedback design patterns
2. Read `{run_dir}/work/team/wisdom/patterns/state-management.md` for state handling patterns
3. Read `{run_dir}/work/team/wisdom/principles/general-ux.md` for UX design principles
4. Apply patterns when designing solutions for identified issues

### Complex Design (use CLI)

For complex multi-component solutions:

```
Bash(`maestro delegate "PURPOSE: Design comprehensive feedback mechanism for multi-step form
CONTEXT: @<component-files>
EXPECTED: Complete design with state flow diagram and code patterns
CONSTRAINTS: Must support React hooks" --tool agy --mode analysis`)
```

## Phase 3: Solution Design

For each diagnosed issue, design solution:

### Feedback Mechanism Design

| Issue Type | Solution Design |
|------------|-----------------|
| Missing loading | Add loading state + UI indicator (spinner, disabled button) |
| Missing error | Add error state + error message display |
| Missing success | Add success state + confirmation toast/message |
| No empty state | Add conditional rendering for empty data |

### State Management Design

**React Pattern**:
```typescript
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);

const handleSubmit = async (event: React.FormEvent) => {
  event.preventDefault();
  setIsLoading(true);
  setError(null);
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Upload failed');
  } catch (err: any) {
    setError(err.message || 'An error occurred');
  } finally {
    setIsLoading(false);
  }
};
```

**Vue Pattern**:
```typescript
const isLoading = ref(false);
const error = ref<string | null>(null);

const handleSubmit = async () => {
  isLoading.value = true;
  error.value = null;
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('Upload failed');
  } catch (err: any) {
    error.value = err.message || 'An error occurred';
  } finally {
    isLoading.value = false;
  }
};
```

### Input Control Design

| Issue | Solution |
|-------|----------|
| Text input for file path | Add file picker: `<input type="file" />` |
| Text input for folder path | Add directory picker: `<input type="file" webkitdirectory />` |
| No validation | Add validation rules and error messages |

### Visual Design Solutions

Reference `specs/design-standards.md` for target standards.

| Issue | Solution Design |
|-------|-----------------|
| Pure black/white | Define OKLCH neutral scale tinted toward brand hue (chroma 0.005-0.01) |
| Generic fonts | Select from: Instrument Sans, Plus Jakarta Sans, DM Sans, Space Grotesk, Fraunces |
| No modular scale | Choose ratio (1.200 or 1.250), derive all sizes from base 16px |
| Missing fluid sizing | Apply clamp() to display sizes (xl+): `clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)` |
| All buttons primary | Define: primary (filled), secondary (outline/ghost), tertiary (text link) |
| Monotonous spacing | Apply 4pt scale with rhythm: tight (4-8px), comfortable (16-24px), generous (48-96px) |
| Nested cards | Flatten: remove inner card, use spacing + subtle border-bottom divider |
| Layout animations | Replace with transform: translateX/Y/scale + opacity transitions |
| No reduced-motion | Add global `@media (prefers-reduced-motion: reduce)` reset |
| Missing focus-visible | Add `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` |
| Bounce easing | Replace with ease-out-quart: `cubic-bezier(0.25, 1, 0.5, 1)` |
| Missing interaction states | Define all 8 states per component with CSS selectors and ARIA attributes |

### UX Writing Solutions

| Issue | Solution |
|-------|----------|
| Generic button labels | Replace with verb+object: "Save changes", "Create project", "Delete 3 items" |
| Error without guidance | Apply formula: what happened + why + how to fix. Template per error type |
| Empty state without action | Three parts: acknowledge → explain value → provide action button |
| Loading text generic | Be specific: "Saving your draft..." not "Loading..." Show progress for multi-step |
| Confirmation too generic | Title: what will happen. Body: consequences. Buttons: specific actions (not OK/Cancel) |
| Redundant copy | Remove intro paragraph if heading is self-explanatory. Labels ≠ values |

## Phase 4: Design Document Generation

1. Generate implementation guide for each issue and write to `{run_dir}/outputs/design-guide.md`

### Wisdom Contribution

If novel design patterns created:
1. Write new patterns to `{run_dir}/work/team/wisdom/contributions/designer-pattern-<timestamp>.md`
2. Format: Problem context, solution design, implementation hints, trade-offs

3. Share state via team_msg:
   ```
   team_msg(operation="log", session_id=<run-id>, from="designer",
            type="state_update", data={
              designed_solutions: <count>,
              framework: <framework>,
              patterns_used: [<pattern-list>]
            })
   ```
