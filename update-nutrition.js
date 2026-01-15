// Skrypt do aktualizacji wartosci odzywczych - uruchom: node update-nutrition.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Wczytaj plik HTML
const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');

// Wyekstrahuj sekcje JavaScript
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
    console.error('Nie znaleziono sekcji script');
    process.exit(1);
}

const jsCode = scriptMatch[1];

// Funkcja pomocnicza
function lastIndexInRange(str, search, start, end) {
    const substring = str.substring(start, end);
    const idx = substring.lastIndexOf(search);
    return idx === -1 ? -1 : start + idx;
}

// Wyekstrahuj ingredientsDatabase
const ingredientStart = jsCode.indexOf('const ingredientsDatabase = {');
const recipesMarker = jsCode.indexOf('// BAZA PRZEPISÓW', ingredientStart);
const ingredientEnd = lastIndexInRange(jsCode, '};', ingredientStart, recipesMarker) + 2;
const ingredientCode = jsCode.substring(ingredientStart, ingredientEnd);

// Wyekstrahuj recipes
const recipesStart = jsCode.indexOf('const recipes = {');
const stateMarker = jsCode.indexOf('// STAN', recipesStart);
const recipesEnd = lastIndexInRange(jsCode, '};', recipesStart, stateMarker) + 2;
const recipesCode = jsCode.substring(recipesStart, recipesEnd);

// Stworz kontekst i wykonaj kod
const context = {};
vm.createContext(context);

const ingredientCodeFixed = ingredientCode.replace('const ingredientsDatabase =', 'ingredientsDatabase =');
const recipesCodeFixed = recipesCode.replace('const recipes =', 'recipes =');

vm.runInContext(ingredientCodeFixed, context);
vm.runInContext(recipesCodeFixed, context);

const ingredientsDatabase = context.ingredientsDatabase;
const recipes = context.recipes;

// Funkcje obliczania
function convertToGrams(itemName, amount, unit) {
    if (unit === 'g' || unit === 'ml') return amount;

    const ingredient = ingredientsDatabase[itemName];
    if (ingredient && ingredient.unitWeight && ingredient.unitWeight[unit]) {
        return amount * ingredient.unitWeight[unit];
    }

    const defaultUnits = ingredientsDatabase._defaultUnits;
    if (defaultUnits && defaultUnits[unit]) {
        return amount * defaultUnits[unit];
    }

    const fallbackWeights = {
        'szt': 100, 'kromki': 40, 'kromka': 40, 'lyżka': 15, 'łyżki': 15,
        'łyżeczka': 5, 'łyżeczki': 5, 'ząbek': 5, 'ząbki': 5, 'ząbków': 5,
        'pęczek': 30, 'listków': 0.5, 'łodygi': 40, 'łodyga': 40,
        'szklanka': 250, 'szczypta': 0.3, 'shot': 30, 'arkusze': 3,
        'kostki': 10, 'kolba': 150
    };

    return amount * (fallbackWeights[unit] || 100);
}

function calculateRecipeNutrition(recipe) {
    let kcal = 0, protein = 0, fat = 0, carbs = 0;

    for (const ing of recipe.ingredients) {
        const ingredient = ingredientsDatabase[ing.item];
        if (!ingredient) continue;

        const grams = convertToGrams(ing.item, ing.amount, ing.unit);
        const multiplier = grams / 100;

        kcal += ingredient.kcal * multiplier;
        protein += ingredient.protein * multiplier;
        fat += ingredient.fat * multiplier;
        carbs += ingredient.carbs * multiplier;
    }

    return {
        kcal: Math.round(kcal),
        protein: Math.round(protein),
        fat: Math.round(fat),
        carbs: Math.round(carbs)
    };
}

// Przygotuj aktualizacje
let updates = [];
let updatedCount = 0;

for (const [category, recipeList] of Object.entries(recipes)) {
    for (const recipe of recipeList) {
        const calc = calculateRecipeNutrition(recipe);

        // Sprawdz czy rozni sie od deklarowanych
        const diff = Math.abs(calc.kcal - recipe.kcal) > 5 ||
                     Math.abs(calc.protein - recipe.protein) > 2 ||
                     Math.abs(calc.fat - recipe.fat) > 2 ||
                     Math.abs(calc.carbs - recipe.carbs) > 2;

        if (diff) {
            updates.push({
                id: recipe.id,
                name: recipe.name,
                old: { kcal: recipe.kcal, protein: recipe.protein, fat: recipe.fat, carbs: recipe.carbs },
                new: calc
            });
        }
    }
}

console.log(`Znaleziono ${updates.length} przepisow do aktualizacji\n`);

// Wykonaj aktualizacje w pliku HTML
for (const update of updates) {
    // Szukaj wzorca dla tego przepisu
    const oldPattern = new RegExp(
        `(id:\\s*['"]${update.id}['"][\\s\\S]*?kcal:\\s*)${update.old.kcal}(,\\s*protein:\\s*)${update.old.protein}(,\\s*fat:\\s*)${update.old.fat}(,\\s*carbs:\\s*)${update.old.carbs}`,
        'g'
    );

    const newValues = `$1${update.new.kcal}$2${update.new.protein}$3${update.new.fat}$4${update.new.carbs}`;

    const newHtml = html.replace(oldPattern, newValues);
    if (newHtml !== html) {
        html = newHtml;
        updatedCount++;
        console.log(`✓ ${update.id}: ${update.name}`);
        console.log(`  ${update.old.kcal}/${update.old.protein}/${update.old.fat}/${update.old.carbs} -> ${update.new.kcal}/${update.new.protein}/${update.new.fat}/${update.new.carbs}`);
    } else {
        console.log(`✗ ${update.id}: nie znaleziono wzorca (${update.old.kcal} kcal)`);
    }
}

// Zapisz zaktualizowany plik
fs.writeFileSync(htmlPath, html, 'utf-8');
console.log(`\n========================================`);
console.log(`Zaktualizowano ${updatedCount} z ${updates.length} przepisow`);
console.log(`Plik zapisano: ${htmlPath}`);
