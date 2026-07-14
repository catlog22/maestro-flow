

# Motion Token Schema

Animation token system for consistent motion design. Derived from Impeccable design principles.

## Easing Functions

| Token | Value | Use Case |
|-------|-------|----------|
| ease-out | `cubic-bezier(0.16, 1, 0.3, 1)` | Emphasis exit, deceleration. Elements entering view. |
| ease-in-out | `cubic-bezier(0.65, 0, 0.35, 1)` | Smooth symmetrical. State changes, toggles. |
| ease-spring | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Overshoot bounce. Playful interactions, notifications. |

**Usage guidelines**:
- `ease-out` is the default for most animations (content reveals, transitions)
- `ease-in-out` for reversible state changes (expand/collapse, toggle)
- `ease-spring` sparingly for emphasis (new item added, attention-grabbing)
- Never use `ease-in` alone (feels sluggish for UI)

## Duration Scale

| Token | Value | Use Case |
|-------|-------|----------|
| fast | `0.15s` | Micro-interactions: button press, toggle, checkbox |
| base | `0.3s` | Standard transitions: hover, focus, dropdown |
| slow | `0.6s` | Content reveals: card entry, panel slide, accordion |
| slower | `0.8s` | Page transitions: route change, large element moves |
| slowest | `1.2s` | Hero animations: splash screen, onboarding, first load |

**Guidelines**:
- Faster for small elements, slower for large elements
- Faster for frequent interactions, slower for infrequent
- Never exceed 1.2s for any single animation
- Total page animation sequence should complete within 2s

## Stagger Formula

```
delay = base_delay + (index * stagger_increment)
```

| Parameter | Typical Value | Range |
|-----------|---------------|-------|
| base_delay | `0s` | 0-0.1s |
| stagger_increment | `0.05s` | 0.03-0.1s |
| max visible stagger | 8 items | -- |

**Guidelines**:
- Max 8 items in a stagger sequence (avoid >0.8s total delay)
- For >8 items: batch into groups of 4-6 with group-level stagger
- Stagger increment scales with duration: fast animations use smaller increments
- First item always has 0 delay (no waiting)

## CSS Custom Property Format

```css
:root {
  /* Easing functions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Duration scale */
  --duration-fast: 0.15s;
  --duration-base: 0.3s;
  --duration-slow: 0.6s;
  --duration-slower: 0.8s;
  --duration-slowest: 1.2s;

  /* Stagger */
  --stagger-increment: 0.05s;
}
```

## Token Consumption Pattern

```css
/* Correct: consume tokens via custom properties */
.card-enter {
  animation: fade-up var(--duration-slow) var(--ease-out) both;
}

/* Correct: stagger via inline style or calc */
.card-enter:nth-child(n) {
  animation-delay: calc(var(--stagger-increment) * var(--stagger-index, 0));
}

/* WRONG: hardcoded values */
.card-enter {
  animation: fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; /* BAD */
}
```

## JSON Token Format

```json
{
  "easing": {
    "ease-out": {
      "value": "cubic-bezier(0.16, 1, 0.3, 1)",
      "use": "exit emphasis, deceleration",
      "css_property": "--ease-out"
    },
    "ease-in-out": {
      "value": "cubic-bezier(0.65, 0, 0.35, 1)",
      "use": "smooth symmetrical",
      "css_property": "--ease-in-out"
    },
    "ease-spring": {
      "value": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      "use": "overshoot bounce",
      "css_property": "--ease-spring"
    }
  },
  "duration": {
    "fast": { "value": "0.15s", "use": "micro-interactions", "css_property": "--duration-fast" },
    "base": { "value": "0.3s", "use": "standard transitions", "css_property": "--duration-base" },
    "slow": { "value": "0.6s", "use": "content reveals", "css_property": "--duration-slow" },
    "slower": { "value": "0.8s", "use": "page transitions", "css_property": "--duration-slower" },
    "slowest": { "value": "1.2s", "use": "hero animations", "css_property": "--duration-slowest" }
  },
  "stagger": {
    "base_delay": "0s",
    "increment": "0.05s",
    "max_items": 8,
    "css_property": "--stagger-increment"
  }
}
```
