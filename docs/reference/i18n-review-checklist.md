# i18n Review Checklist

Use this thin index only when UI work touches internationalization,
localization, translated copy, locale-aware formatting, RTL layout, or localized
theme assets. Keep review evidence tied to changed UI surfaces and avoid broad
translation quality audits.

## Trigger Signals

- Locale resources: `locales/`, `i18n/`, `lang/`, `messages/`, translation
  `.json`, `.po`, `.yaml`, or equivalent resource files.
- Translation APIs: `t(`, `useTranslation`, `Trans`, `formatMessage`,
  `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.ListFormat`,
  `Intl.PluralRules`, or project-specific formatter wrappers.
- UI text risks: hardcoded user-facing strings, string concatenation around
  translated copy, pluralization, date/number/currency display, text expansion,
  truncation, wrapping, or language-specific asset variants.
- Directionality risks: RTL, right-to-left, `dir`, logical CSS properties,
  mirrored icons, and directional alignment.

## Core Checks

1. **Hardcoded user-facing text**
   - Flag visible UI strings added directly in components, templates, metadata,
     buttons, labels, toasts, modals, empty states, validation messages, and
     page titles when the project has an i18n system.
   - Accept technical constants only when they are not rendered to users.

2. **Interpolation, not concatenation**
   - Flag translated copy assembled with `+`, template fragments, or adjacent
     translation calls when word order can vary by locale.
   - Prefer one translation key with named interpolation values, plural-aware
     variants, or ICU-style messages.

3. **Locale-aware formatting**
   - Dates, times, relative times, numbers, percentages, currencies, lists, and
     plural forms must use locale-aware formatters.
   - Avoid fixed separators, fixed currency symbols, and English-only plural
     suffixes such as `"s"`.

4. **Text expansion and overflow**
   - Check long words, longer translations, short CJK labels, and mixed-script
     text in dense controls.
   - Review wrapping, truncation, min/max width, button sizing, table cells,
     sidebars, nav items, breadcrumbs, and mobile breakpoints.

5. **RTL layout and mirrors**
   - Check `dir` propagation, logical properties (`inline-start`,
     `margin-inline`, etc.), flex/grid alignment, text alignment, and keyboard
     navigation order.
   - Directional icons, progress indicators, carousels, side panels, and arrows
     need explicit mirror decisions.

6. **Theme and localized assets**
   - Localized images, SVGs, banners, screenshots, and icons must load safely in
     light and dark themes.
   - Check contrast and legibility for CJK, RTL, accented text, and small text
     weights on dark backgrounds.
   - Missing locale/theme assets need fallback behavior rather than broken
     images or invisible text.

## false-positive Exclusions

Do not report these as i18n defects unless they are rendered directly to users:

- logs, debug messages, stack traces, and `console.*` strings
- analytics event names, experiment ids, metric keys, and telemetry dimensions
- API field names, enum values, route names, CSS class names, test ids, and
  data attributes
- unit test names, fixture text, mock payloads, snapshots, and storybook-only
  scaffolding
- internal constants, feature flags, permissions, role ids, and storage keys
- brand names, product names, legal names, and externally mandated copy that is
  intentionally not translated

## Severity

- **P0**: A supported locale cannot complete a critical flow because text,
  direction, formatting, or missing localized assets break the UI.
- **P1**: A visible i18n issue corrupts meaning, hides required information, or
  blocks important non-critical user action in a supported locale.
- **P2**: A likely locale, RTL, formatting, or text-expansion issue degrades a
  normal flow but has a bounded workaround.
- **P3**: Low-risk polish, future locale hardening, or checklist cleanup that
  does not affect current supported locales.

## Evidence Expectations

Every finding should include:

- changed file or UI area
- affected locale, script, formatter, or directionality condition
- proof from code, screenshot, rendered UI, or test output
- proposed fix or deferral reason
- severity with the user impact in one sentence

## Acceptance Checklist

- User-facing text uses translation resources where the project has i18n.
- Dynamic values use interpolation or plural-aware messages.
- Dates, times, numbers, currencies, lists, and plurals use locale-aware
  formatters.
- Layout tolerates long translations and compact CJK labels on mobile and
  desktop.
- RTL direction, alignment, and directional icons have explicit behavior.
- Localized assets work in light and dark themes with safe fallbacks.
- Contrast remains legible for translated text across supported themes.
- Reported hardcoded strings exclude technical literals and fixture-only text.
- Findings include concrete proof and P0-P3 severity.
- Deep semantic translation review is routed to human or specialist review.
