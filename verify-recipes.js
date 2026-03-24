// Skrypt do weryfikacji przepisow - uruchom: node verify-recipes.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Wczytaj plik HTML
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

// Wyekstrahuj sekcje JavaScript
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
    console.error('Nie znaleziono sekcji script');
    process.exit(1);
}

const jsCode = scriptMatch[1];

// Funkcja pomocnicza do znajdowania ostatniego wystapienia w zakresie
function lastIndexInRange(str, search, start, end) {
    const substring = str.substring(start, end);
    const idx = substring.lastIndexOf(search);
    return idx === -1 ? -1 : start + idx;
}

// Wyekstrahuj ingredientsDatabase - szukaj markera konca przed recipes
const ingredientStart = jsCode.indexOf('const ingredientsDatabase = {');
const substitutesMarker = jsCode.indexOf('const ingredientSubstitutes', ingredientStart);
const ingredientEnd = lastIndexInRange(jsCode, '};', ingredientStart, substitutesMarker) + 2;
const ingredientCode = jsCode.substring(ingredientStart, ingredientEnd);

console.log('Ingredient DB start:', ingredientStart);
console.log('Substitutes marker:', substitutesMarker);
console.log('Ingredient DB end:', ingredientEnd);
console.log('Ingredient code length:', ingredientCode.length);

// Wyekstrahuj recipes - od "const recipes = {" do zamkniecia przed STAN
const recipesStart = jsCode.indexOf('const recipes = {');
const stateMarker = jsCode.indexOf('// STAN', recipesStart);

// Szukamy }; przed STAN, ale po recipesStart
const recipesEnd = lastIndexInRange(jsCode, '};', recipesStart, stateMarker) + 2;
const recipesCode = jsCode.substring(recipesStart, recipesEnd);

console.log('Recipes start index:', recipesStart);
console.log('State marker:', stateMarker);
console.log('Recipes end index:', recipesEnd);
console.log('Recipes code length:', recipesCode.length);

// Stworz kontekst i wykonaj kod
const context = {};
vm.createContext(context);

// Zamien const na przypisanie do zmiennej globalnej (this)
const ingredientCodeFixed = ingredientCode.replace('const ingredientsDatabase =', 'ingredientsDatabase =');
const recipesCodeFixed = recipesCode.replace('const recipes =', 'recipes =');

console.log('Ingredient code sample start:', ingredientCodeFixed.substring(0, 200));
console.log('Ingredient code sample end:', ingredientCodeFixed.substring(ingredientCodeFixed.length - 200));

try {
    vm.runInContext(ingredientCodeFixed, context);
    console.log('ingredientsDatabase loaded, keys:', Object.keys(context.ingredientsDatabase || {}).length);
    if (!context.ingredientsDatabase) {
        console.log('ingredientsDatabase is undefined after runInContext');
    }
} catch (e) {
    console.error('Blad parsowania ingredientsDatabase:', e.message);
    console.error('Stack:', e.stack);
}

try {
    vm.runInContext(recipesCodeFixed, context);
    console.log('recipes loaded:', context.recipes ? 'yes' : 'no');
    if (context.recipes) {
        console.log('breakfast recipes:', context.recipes.breakfast?.length || 0);
        console.log('lunch recipes:', context.recipes.lunch?.length || 0);
        console.log('dinner recipes:', context.recipes.dinner?.length || 0);
    }
} catch (e) {
    console.error('Blad parsowania recipes:', e.message);
    console.error('Recipes code sample:', recipesCodeFixed.substring(recipesCodeFixed.length - 500));
    process.exit(1);
}

const ingredientsDatabase = context.ingredientsDatabase;
const recipes = context.recipes;

if (!recipes) {
    console.error('Recipes nie zostaly zaladowane');
    process.exit(1);
}

// Funkcje weryfikacji
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

function calculateIngredientNutrition(item, amount, unit) {
    const ingredient = ingredientsDatabase[item];
    if (!ingredient) {
        return { missing: true, item, amount, unit };
    }

    const grams = convertToGrams(item, amount, unit);
    const multiplier = grams / 100;

    return {
        missing: false,
        item,
        grams,
        kcal: ingredient.kcal * multiplier,
        protein: ingredient.protein * multiplier,
        fat: ingredient.fat * multiplier,
        carbs: ingredient.carbs * multiplier
    };
}

function calculateRecipeNutrition(recipe) {
    const result = {
        id: recipe.id,
        name: recipe.name,
        declared: { kcal: recipe.kcal, protein: recipe.protein, fat: recipe.fat, carbs: recipe.carbs },
        calculated: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
        ingredients: [],
        missingIngredients: []
    };

    for (const ing of recipe.ingredients) {
        const nutrition = calculateIngredientNutrition(ing.item, ing.amount, ing.unit);

        if (nutrition.missing) {
            result.missingIngredients.push(nutrition);
        } else {
            result.calculated.kcal += nutrition.kcal;
            result.calculated.protein += nutrition.protein;
            result.calculated.fat += nutrition.fat;
            result.calculated.carbs += nutrition.carbs;
            result.ingredients.push(nutrition);
        }
    }

    result.calculated.kcal = Math.round(result.calculated.kcal);
    result.calculated.protein = Math.round(result.calculated.protein);
    result.calculated.fat = Math.round(result.calculated.fat);
    result.calculated.carbs = Math.round(result.calculated.carbs);

    return result;
}

function calculateDiscrepancy(declared, calculated) {
    if (declared === 0) return calculated === 0 ? 0 : 100;
    return ((calculated - declared) / declared) * 100;
}

function verifyRecipe(recipe, tolerance = 5) {
    const nutrition = calculateRecipeNutrition(recipe);

    const discrepancies = {
        kcal: calculateDiscrepancy(nutrition.declared.kcal, nutrition.calculated.kcal),
        protein: calculateDiscrepancy(nutrition.declared.protein, nutrition.calculated.protein),
        fat: calculateDiscrepancy(nutrition.declared.fat, nutrition.calculated.fat),
        carbs: calculateDiscrepancy(nutrition.declared.carbs, nutrition.calculated.carbs)
    };

    const withinTolerance =
        Math.abs(discrepancies.kcal) <= tolerance &&
        Math.abs(discrepancies.protein) <= tolerance &&
        Math.abs(discrepancies.fat) <= tolerance &&
        Math.abs(discrepancies.carbs) <= tolerance;

    return {
        ...nutrition,
        discrepancies,
        withinTolerance,
        hasMissingIngredients: nutrition.missingIngredients.length > 0
    };
}

// Uruchom weryfikacje
console.log('========================================');
console.log('RAPORT WERYFIKACJI WARTOSCI ODZYWCZYCH');
console.log('========================================');
console.log(`Data: ${new Date().toISOString()}`);
console.log(`Tolerancja: ±5%`);
console.log('');

const report = {
    summary: { total: 0, ok: 0, discrepancies: 0, missingIngredients: 0 },
    details: { breakfast: [], lunch: [], dinner: [] },
    allMissingIngredients: new Set()
};

for (const [category, recipeList] of Object.entries(recipes)) {
    for (const recipe of recipeList) {
        const verification = verifyRecipe(recipe, 5);
        report.details[category].push(verification);
        report.summary.total++;

        if (verification.withinTolerance && !verification.hasMissingIngredients) {
            report.summary.ok++;
        } else {
            report.summary.discrepancies++;
        }

        if (verification.hasMissingIngredients) {
            report.summary.missingIngredients++;
            verification.missingIngredients.forEach(m => report.allMissingIngredients.add(m.item));
        }
    }
}

report.allMissingIngredients = Array.from(report.allMissingIngredients).sort();

console.log('PODSUMOWANIE:');
console.log(`  Wszystkie przepisy: ${report.summary.total}`);
console.log(`  OK (w tolerancji): ${report.summary.ok}`);
console.log(`  Z rozbieznosciami: ${report.summary.discrepancies}`);
console.log(`  Brakujace skladniki: ${report.summary.missingIngredients}`);
console.log('');

// Wyswietl przepisy z rozbieznosciami
const categories = [
    { key: 'breakfast', name: 'SNIADANIA' },
    { key: 'lunch', name: 'OBIADY' },
    { key: 'dinner', name: 'KOLACJE' }
];

for (const cat of categories) {
    const issues = report.details[cat.key].filter(r => !r.withinTolerance || r.hasMissingIngredients);
    if (issues.length > 0) {
        console.log(`\n${cat.name} z rozbieznosciami (${issues.length}):`);
        for (const r of issues) {
            console.log(`\n  ${r.id}: ${r.name}`);
            console.log(`    Deklarowane: ${r.declared.kcal} kcal, ${r.declared.protein}g B, ${r.declared.fat}g T, ${r.declared.carbs}g W`);
            console.log(`    Obliczone:   ${r.calculated.kcal} kcal, ${r.calculated.protein}g B, ${r.calculated.fat}g T, ${r.calculated.carbs}g W`);
            console.log(`    Roznice:     ${r.discrepancies.kcal.toFixed(1)}% kcal, ${r.discrepancies.protein.toFixed(1)}% B, ${r.discrepancies.fat.toFixed(1)}% T, ${r.discrepancies.carbs.toFixed(1)}% W`);
            if (r.missingIngredients.length > 0) {
                console.log(`    Brakujace:   ${r.missingIngredients.map(m => m.item).join(', ')}`);
            }
        }
    }
}

if (report.allMissingIngredients.length > 0) {
    console.log('\n\nBRAKUJACE SKLADNIKI W BAZIE:');
    report.allMissingIngredients.forEach(item => console.log(`  - ${item}`));
}

// Zapisz raport do pliku JSON
const reportPath = path.join(__dirname, 'verification-report.json');
const jsonReport = {
    ...report,
    allMissingIngredients: report.allMissingIngredients
};
fs.writeFileSync(reportPath, JSON.stringify(jsonReport, null, 2));
console.log(`\n\nRaport zapisano do: ${reportPath}`);
