

# UX Writing Standards

Guidelines for all text content in UI components. From Impeccable's UX writing reference.

---

## Button Labels

- **NEVER**: "OK", "Submit", "Yes", "No", "Cancel" (generic)
- **ALWAYS**: verb + object — "Save changes", "Create account", "Delete message"
- Destructive actions: name the destruction + show count — "Delete 5 items" not "Delete selected"
- Primary CTA: specific benefit — "Start free trial" not "Get started"

## Error Messages

Formula: (1) What happened + (2) Why + (3) How to fix

| Type | Template |
|------|----------|
| Format | "{Field} must be {format}. Example: {example}" |
| Required | "{Field} is required to {reason}" |
| Permission | "You don't have access to {resource}. Contact {who} for access" |
| Network | "Couldn't reach the server. Check your connection and try again" |
| Server | "Something went wrong on our end. Try again in a few minutes" |

- Never blame user: "Please enter..." not "You entered..."
- Never use codes alone: "Error 404" → "Page not found"
- Be specific: "Password must be 8+ characters with a number" not "Invalid password"

## Empty States

Three components: (1) Acknowledge + (2) Explain value + (3) Provide action

| Context | Example |
|---------|---------|
| First use | "No projects yet. Create your first project to get started. [Create project]" |
| Search | "No results for '{query}'. Try a different search term or [browse all]" |
| Filtered | "No items match these filters. [Clear filters]" |
| Error | "Couldn't load items. [Try again]" |

## Loading States

- Be specific: "Saving your draft..." not "Loading..."
- Multi-step: show progress — "Uploading (2 of 5 files)..."
- Duration hint: "This usually takes about 30 seconds"

## Confirmation Dialogs

- Use sparingly — prefer undo over confirm
- Title: what will happen — "Delete this project?"
- Body: consequences — "This will permanently delete 12 files. This can't be undone."
- Buttons: specific — "Delete project" / "Keep project" (not OK/Cancel)

## Voice & Tone

- **Voice**: consistent brand personality (professional/friendly/technical — choose one)
- **Tone**: adapts to moment — cheerful for success, empathetic for errors, neutral for routine
- Keep consistent: same word for same concept everywhere (delete/remove/trash → pick one)

## Form Instructions

- Show format with placeholder: `placeholder="john@example.com"`
- Explain non-obvious fields with helper text below label
- Mark optional fields (not required ones) — most fields should be required
- Group related fields with clear section headers

## Translation Planning

| Language | Length vs English |
|----------|------------------|
| German | +30% |
| French | +20% |
| Finnish | +30-40% |
| Chinese | -30% |
| Japanese | -10-20% |

- Design for longest language (German)
- Never truncate translated text — allow wrapping
- Avoid idioms and cultural references in source text

## Redundant Copy Detection

- Don't repeat visible information (heading ≠ first paragraph)
- Labels describe the field, not restate the value
- Tooltips add information, not repeat the label
- If heading says it all, skip the intro paragraph
