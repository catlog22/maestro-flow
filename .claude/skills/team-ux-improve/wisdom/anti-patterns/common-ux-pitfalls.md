

# Common UX Pitfalls

## Interaction Issues
- Buttons without loading states during async operations
- Missing error handling with user feedback
- State changes without visual updates
- Double-click vulnerabilities (missing debounce)
- No disabled state during processing
- Silent failures without user notification
- Generic error messages without actionable guidance
- Missing confirmation for destructive actions
- No empty state placeholder for data lists
- Input without validation rules or inline feedback

## State Management Issues
- Stale data after mutations (direct array/object mutation)
- Race conditions in async operations (no cancellation)
- Missing rollback for failed optimistic updates
- Stale closure capturing old state value
- Missing loading/error/success state tracking

## Visual Design Anti-Patterns (AI Slop)
- AI Color Palette: cyan-on-dark, purple gradients (zero design intent)
- Gradient text: background-clip: text as emphasis crutch
- Glassmorphism everywhere: backdrop-filter as default aesthetic
- All Buttons Primary: no visual hierarchy, every button filled
- Pure Black/White: #000/#fff without tint (harsh, sterile)
- Generic fonts: Inter, Roboto as defaults (forgettable)
- Identical card grids: all items same visual weight
- Nested cards: cards inside cards creating noise
- Same spacing everywhere: no rhythm variation
- Bounce/elastic easing: dated animation feel
- Everything centered: including body text

## Motion Issues
- Layout animations (width/height/margin/padding triggers)
- No reduced-motion query (@media prefers-reduced-motion)
- CSS will-change set permanently (GPU waste)
- ease/linear as default easing (unnatural)
- Stagger exceeding 500ms total

## Accessibility Issues
- outline: none without :focus-visible replacement
- Missing :focus-visible (using bare :focus)
- Color-only state indication
- Touch targets < 44px
- No skip links
- Placeholder used as label
- Missing aria-describedby for error messages
