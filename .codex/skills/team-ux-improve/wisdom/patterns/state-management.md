

# State Management Patterns

## Reactive Update Rules
- NEVER mutate arrays/objects directly
- React: use spread operator, filter/map for new references
- Vue: use ref() for primitives, reactive() for objects, computed() for derived
- Always trigger re-render through proper state API

## Async State Pattern
```
const [data, setData] = useState(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

// Always: loading -> success/error -> cleanup
```

## Race Condition Prevention
- AbortController for fetch cancellation
- Debounce for search/filter inputs (250-500ms)
- Latest-wins pattern for concurrent requests
- Disable trigger during processing

## Optimistic Updates
- Update UI immediately
- Track pending state
- Rollback on failure with error notification
- Never lose user data silently

## Form State
- Controlled inputs (React) / v-model (Vue)
- Validation on blur + on submit
- Error clearing on re-input
- Dirty tracking for unsaved changes warning
