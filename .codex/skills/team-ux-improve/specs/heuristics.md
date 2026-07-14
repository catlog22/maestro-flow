

# Nielsen's 10 Usability Heuristics

Structured evaluation framework for UX scanning. Score each 0-4.

## 1. Visibility of System Status
The system should always keep users informed about what is going on.
- Loading indicators for async operations (> 200ms)
- Progress bars for multi-step processes
- State feedback (saved, syncing, error)
- Timestamps on data ("Updated 5 minutes ago")
- Active state indicators (selected tab, current page)

## 2. Match Between System and Real World
Speak the user's language, not technical jargon.
- Labels use familiar words (not internal terms)
- Icons match real-world metaphors
- Information appears in natural/logical order
- Dates, numbers, currencies in locale format

## 3. User Control and Freedom
Users need a clearly marked "emergency exit."
- Undo/redo for destructive or complex actions
- Back/cancel navigation always available
- Escape key closes modals/popovers
- Clear way to deselect, clear filters, reset

## 4. Consistency and Standards
Same words and actions should mean the same thing.
- One term per concept (delete/remove/trash → pick one)
- Same icon for same action across pages
- Follow platform conventions (links underlined, × means close)
- Consistent placement of actions (save always top-right, etc.)

## 5. Error Prevention
Better to prevent errors than show good error messages.
- Confirmation for destructive actions (with undo preferred)
- Input validation on blur (not just submit)
- Disable invalid options (gray out, not hide)
- Type-ahead/autocomplete for known-value fields
- Character counts for limited fields

## 6. Recognition Rather Than Recall
Minimize user memory load.
- Show options visibly (don't require memorization)
- Recent items, favorites, search suggestions
- Breadcrumbs for navigation context
- Inline help/tooltips for non-obvious fields
- Persistent important info (don't hide behind clicks)

## 7. Flexibility and Efficiency of Use
Accelerators for power users without confusing beginners.
- Keyboard shortcuts for frequent actions
- Bulk actions (select all, batch edit)
- Customizable views/layouts
- Search/filter as primary navigation for large datasets

## 8. Aesthetic and Minimalist Design
Every extra unit of information competes with relevant units.
- Remove decorative elements that don't aid comprehension
- Progressive disclosure (summary → detail on demand)
- Visual hierarchy: clear primary, secondary, tertiary
- Information density appropriate for use case

## 9. Help Users Recognize, Diagnose, and Recover from Errors
Error messages should be expressed in plain language.
- Formula: what happened + why + how to fix
- No error codes without explanation
- Suggest specific corrective action
- Preserve user input on error (don't clear forms)
- Retry option for network/server errors

## 10. Help and Documentation
Easy to search, focused on user's task.
- Contextual help (tooltips, info icons)
- Onboarding for first-time users
- Empty states with guidance and action
- Keyboard shortcut reference
- FAQ/search for complex features

## Severity Scale

| Rating | Description |
|--------|-------------|
| 0 | Not a usability problem |
| 1 | Cosmetic — fix if time permits |
| 2 | Minor — low priority fix |
| 3 | Major — important to fix, high priority |
| 4 | Catastrophe — must fix before release |
