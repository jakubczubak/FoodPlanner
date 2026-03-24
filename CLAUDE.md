# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Planer Posiłków** (Meal Planner) — a Polish-language Progressive Web App (PWA) for weekly meal planning with nutritional tracking. It runs entirely client-side with no build system, no framework, and no backend. All state is persisted in `localStorage`.

## How to Run

Open `index.html` directly in a browser or serve it with any static file server. No build step, no `npm install`, no bundler. The service worker (`service-worker.js`) enables offline use when served over HTTPS.

## Utility Scripts (Node.js)

- `node correct-recipes.js` — Corrects recipe ingredient amounts by parsing the embedded data from `index.html`
- `node verify-recipes.js` — Verifies recipe nutritional values against calculated values from ingredients
- `node update-nutrition.js` — Updates recipe nutrition data
- `node fix-declared-values.js` — Fixes declared nutritional values in recipes

These scripts read/modify `index.html` directly by extracting and manipulating the embedded JavaScript.

## Architecture

Everything lives in a single `index.html` file (~14,600 lines). There is no module system. The file contains inline CSS, HTML structure, and all JavaScript in one `<script>` block.

### Key Data Structures (all inline in index.html)

| Section | Lines (approx) | Description |
|---|---|---|
| CSS styles | 1–2480 | Inline styles + responsive rules |
| HTML body | 2480–2685 | Three views: Planer, Przepisy (Recipes), Zakupy (Shopping) |
| `ingredientsDatabase` | ~2689–3785 | Nutritional data per 100g for all ingredients, with optional `unitWeight` conversions |
| `ingredientSubstitutes` | ~3786–4458 | Substitution map between ingredients with ratios |
| Substitute logic | ~4460–4575 | Functions for calculating substitution ratios and scoring |
| `recipes` | ~4577–10642 | All recipes organized by meal type: `breakfast`, `lunch`, `dinner`. Each recipe has `name`, `category`, `ingredients[]`, `macros`, and `steps[]` |
| Application state | ~10644–10706 | Day names, meal types, categories, TDEE constants, macro defaults |
| Recipe verification | ~10708–10940 | Functions to verify declared vs calculated nutrition |
| Core app logic | ~10942–14598 | All UI rendering, meal planning, optimization, shopping list generation |

### Three UI Views

1. **Planer** — Weekly grid where each person gets per-meal dropdowns. Shows daily/weekly kcal summaries with macro breakdowns. Supports multiple persons with individual TDEE-based targets.
2. **Przepisy** (Recipes) — Browse/search recipes by meal type and category. Recipe modal shows ingredients (with portion scaling), macros, preparation steps, and ingredient optimization.
3. **Zakupy** (Shopping) — Generates aggregated shopping list from the planned meals, filterable by day and meal type.

### Core Concepts

- **Multi-person support**: Each person has weight, height, age, activity level, goal (cut/maintain/bulk), custom macro ratios, and per-meal calorie allocation. Portions auto-scale via TDEE calculation.
- **Macro optimization**: `optimizeIngredients()` adjusts ingredient amounts to hit target macros for a person while preserving recipe structure.
- **Ingredient substitution**: Recipes support ingredient swaps via `ingredientSubstitutes` map with ratio-based conversions.
- **Favorites & eaten tracking**: Stored in `localStorage`, persisted across sessions.

### CSS Architecture

Extracted CSS files exist in `css/` (`variables.css`, `components.css`, `planner.css`, `recipes.css`, `shopping.css`, `modal.css`, `settings.css`, `responsive.css`) but the app currently uses **inline styles in index.html**. The extracted files appear to be a refactoring effort not yet integrated.

## Language

All UI text, comments, variable names for display, and recipe data are in **Polish**. Code-level identifiers (function names, variable names) are in English.
