# Tailwind Migration Guide

## Design Token Mapping

### Colors
- Brand: `bg-brand`, `text-brand`, `border-brand`
- Status: `bg-success`, `text-danger`, etc.
- Surface: `bg-surface`, `bg-surface-secondary`, `bg-surface-card`
- Text: `text-text-primary`, `text-text-secondary`, `text-text-muted`
- Borders: `border-border`, `border-border-strong`

### Spacing
- Sewara scale: `p-1` through `p-12` map to `--space-*`
- Use default Tailwind scale for values not in custom scale.

### Typography
- Font family: `font-sans`, `font-display`
- Use default Tailwind font sizes and weights.

### Borders and Shadows
- Radius: `rounded-sm`, `rounded`, `rounded-md`, `rounded-lg`, `rounded-xl`
- Shadows: `shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`

## Migration Strategy

1. New components: Use Tailwind from start.
2. Existing components: Migrate incrementally.
3. Keep existing `.rp-*` classes working.
4. No breaking changes to URLs or behavior.

## Coexistence

- Tailwind preflight disabled; existing reset stays active.
- CSS variables preserved and used by Tailwind utilities.
- Existing classes still work.
- Gradual migration, no big bang.
