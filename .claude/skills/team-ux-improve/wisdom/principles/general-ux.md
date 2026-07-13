

# General UX Principles

## Feedback & Responsiveness
- Every user action must have immediate visual feedback (< 100ms perceived)
- Loading states for operations > 200ms: use skeleton/spinner, set aria-busy="true"
- Success/error states clearly communicated with both visual and ARIA cues
- Feedback duration: 100-150ms for hover/active/focus transitions
- State change transitions: 200-300ms
- Layout changes: 300-500ms

## Interaction States (8 Required)
Every interactive element must define all 8 states:
1. Default — base appearance
2. Hover — subtle bg/opacity change, wrap in @media(hover:hover)
3. Focus — :focus-visible with 2px solid accent, offset 2px, 3:1 contrast ratio
4. Active — scale(0.97) or darker background
5. Disabled — opacity 0.5, cursor: not-allowed, aria-disabled="true"
6. Loading — spinner/skeleton, disable interaction, aria-busy="true"
7. Error — red border, error message below, aria-invalid="true"
8. Success — green check, success message

## State Management
- UI state must reflect underlying data state immediately
- Optimistic updates must have rollback mechanisms
- State changes must be atomic and predictable
- No direct array/object mutation (use spread/filter/map for reactive frameworks)
- Race conditions: use request cancellation or debounce

## Visual Design Quality
- Color: OKLCH-based, tinted neutrals (never pure gray/black/white), 60-30-10 rule
- Typography: distinctive fonts (not Inter/Roboto), modular scale, fluid clamp()
- Spacing: 4pt base scale with varied rhythm (tight/comfortable/generous)
- Motion: transform+opacity only, ease-out-quart easing, reduced-motion query required
- Hierarchy: squint test, single primary CTA per viewport

## Accessibility
- All interactive elements keyboard accessible (tab + enter/space)
- Color must NOT be the only indicator of state
- Focus states must use :focus-visible (not bare :focus)
- Focus ring: 3:1 contrast against adjacent colors
- Touch targets: minimum 44x44px, 8px gap between adjacent
- Visible labels on all form inputs (placeholder is not a label)
- Skip links for keyboard navigation
