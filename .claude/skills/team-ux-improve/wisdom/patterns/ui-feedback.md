

# UI Feedback Patterns

## Loading States
- Button: set disabled + aria-busy="true", show spinner, restore on complete
- Page: skeleton screens (prefer over spinners for content areas)
- Inline: progress indicator for multi-step operations
- Duration: show loading after 200ms delay (avoid flash for fast operations)

## Error States
- Form: inline validation with aria-invalid + aria-describedby
- API: toast/snackbar for non-blocking, inline for blocking errors
- Error message: specific, actionable (not "Something went wrong")
- Visual: red border on input, error icon, error text below

## Success States
- Form submit: success message + next action guidance
- CRUD: optimistic update with subtle confirmation
- Duration: success message visible 3-5 seconds

## Empty States
- Data list: illustration + message + primary action
- Search: "No results" + suggestions
- First use: onboarding guidance

## Focus Feedback
- :focus-visible only (not bare :focus)
- Ring: 2px solid accent, offset 2px
- Contrast: 3:1 against adjacent colors
- Custom for dark backgrounds: lighter ring color

## Hover Feedback
- Wrap in @media(hover:hover) for touch safety
- Subtle: background opacity change or slight color shift
- Duration: 100-150ms transition
- Cursor: pointer for clickable, not-allowed for disabled

## Active Feedback
- Scale: transform: scale(0.97) for physical feel
- Or: darker background shade
- Duration: instant (< 50ms feel)
