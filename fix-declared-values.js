// Skrypt do korekty zadeklarowanych wartości w przepisach - uruchom: node fix-declared-values.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Wczytaj plik HTML (oryginalny backup)
const backupPath = path.join(__dirname, 'index.html.backup');
const htmlPath = path.join(__dirname, 'index.html');

// Sprawdź czy istnieje backup, jeśli tak użyj go
let html;
if (fs.existsSync(backupPath)) {
    html = fs.readFileSync(backupPath, 'utf-8');
    console.log('Używam kopii zapasowej: index.html.backup');
} else {
    html = fs.readFileSync(htmlPath, 'utf-8');
    console.log('Używam: index.html');
}

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

console.log('Załadowano bazę składników:', Object.keys(ingredientsDatabase).length);
console.log('Załadowano przepisy:', recipes.breakfast.length + recipes.lunch.length + recipes.dinner.length);

// Funkcje obliczeniowe
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
        'szt': 100, 'kromki': 40, 'kromka': 40, 'łyżka': 15, 'łyżki': 15,
        'łyżeczka': 5, 'łyżeczki': 5, 'ząbek': 5, 'ząbki': 5, 'ząbków': 5,
        'pęczek': 30, 'listków': 0.5, 'łodygi': 40, 'łodyga': 40,
        'szklanka': 250, 'szczypta': 0.3, 'shot': 30, 'arkusze': 3,
        'kostki': 10, 'kolba': 150
    };

    return amount * (fallbackWeights[unit] || 100);
}

function calculateRecipeNutrition(recipe) {
    let totalKcal = 0, totalProtein = 0, totalFat = 0, totalCarbs = 0;
    const missing = [];

    for (const ing of recipe.ingredients) {
        const ingredient = ingredientsDatabase[ing.item];
        if (!ingredient) {
            missing.push(ing.item);
            continue;
        }

        const grams = convertToGrams(ing.item, ing.amount, ing.unit);
        const multiplier = grams / 100;

        totalKcal += ingredient.kcal * multiplier;
        totalProtein += ingredient.protein * multiplier;
        totalFat += ingredient.fat * multiplier;
        totalCarbs += ingredient.carbs * multiplier;
    }

    return {
        kcal: Math.round(totalKcal),
        protein: Math.round(totalProtein),
        fat: Math.round(totalFat),
        carbs: Math.round(totalCarbs),
        missing
    };
}

// Zaktualizuj wartości zadeklarowane w każdym przepisie
const updatedRecipes = {
    breakfast: [],
    lunch: [],
    dinner: []
};

let updateCount = 0;

for (const [category, recipeList] of Object.entries(recipes)) {
    for (const recipe of recipeList) {
        const calculated = calculateRecipeNutrition(recipe);

        if (calculated.missing.length > 0) {
            console.log(`UWAGA: ${recipe.id} - brakujące składniki: ${calculated.missing.join(', ')}`);
        }

        // Aktualizuj wartości zadeklarowane
        const updatedRecipe = {
            ...recipe,
            kcal: calculated.kcal,
            protein: calculated.protein,
            fat: calculated.fat,
            carbs: calculated.carbs
        };

        updatedRecipes[category].push(updatedRecipe);

        // Sprawdź czy wartości się zmieniły
        if (recipe.kcal !== calculated.kcal ||
            recipe.protein !== calculated.protein ||
            recipe.fat !== calculated.fat ||
            recipe.carbs !== calculated.carbs) {
            updateCount++;
            console.log(`${recipe.id}: ${recipe.kcal}/${recipe.protein}/${recipe.fat}/${recipe.carbs} -> ${calculated.kcal}/${calculated.protein}/${calculated.fat}/${calculated.carbs}`);
        }
    }
}

console.log(`\nZaktualizowano ${updateCount} przepisów`);

// Generuj nowy kod przepisów
function generateIngredientsCode(ingredients) {
    return ingredients.map(ing => {
        const amount = ing.amount % 1 === 0 ? ing.amount : ing.amount.toFixed(1);
        return `                        { item: "${ing.item}", amount: ${amount}, unit: "${ing.unit}" }`;
    }).join(',\n');
}

function generateRecipeCode(recipe) {
    const ingredientsCode = generateIngredientsCode(recipe.ingredients);
    const stepsCode = recipe.steps.map(s => `                        "${s.replace(/"/g, '\\"')}"`).join(',\n');

    return `                {
                    id: '${recipe.id}',
                    name: "${recipe.name}",
                    category: "${recipe.category}",
                    kcal: ${recipe.kcal},
                    protein: ${recipe.protein},
                    fat: ${recipe.fat},
                    carbs: ${recipe.carbs},
                    ingredients: [
${ingredientsCode}
                    ],
                    steps: [
${stepsCode}
                    ]
                }`;
}

function generateCategoryCode(categoryName, recipeList) {
    const recipesCode = recipeList.map(r => generateRecipeCode(r)).join(',\n');
    return `            ${categoryName}: [\n${recipesCode}\n            ]`;
}

const newRecipesCode = `const recipes = {
${generateCategoryCode('breakfast', updatedRecipes.breakfast)},
${generateCategoryCode('lunch', updatedRecipes.lunch)},
${generateCategoryCode('dinner', updatedRecipes.dinner)}
        };`;

// Znajdź pozycję starego kodu recipes w HTML
const htmlScriptStart = html.indexOf('<script>') + 8;
const htmlScriptEnd = html.indexOf('</script>');
const htmlJsCode = html.substring(htmlScriptStart, htmlScriptEnd);

const htmlRecipesStart = htmlJsCode.indexOf('const recipes = {');
const htmlStateMarker = htmlJsCode.indexOf('// STAN', htmlRecipesStart);
const htmlRecipesEnd = lastIndexInRange(htmlJsCode, '};', htmlRecipesStart, htmlStateMarker) + 2;
const htmlRecipesCode = htmlJsCode.substring(htmlRecipesStart, htmlRecipesEnd);

// Zamień stary kod na nowy
const newHtml = html.substring(0, htmlScriptStart + htmlRecipesStart) +
                newRecipesCode +
                html.substring(htmlScriptStart + htmlRecipesEnd);

// Zapisz nowy plik
fs.writeFileSync(htmlPath, newHtml);
console.log(`\nZapisano zaktualizowany plik: ${htmlPath}`);

// Weryfikacja
console.log('\n========================================');
console.log('WERYFIKACJA PO AKTUALIZACJI');
console.log('========================================\n');

let okCount = 0;
let failCount = 0;

for (const [category, recipeList] of Object.entries(updatedRecipes)) {
    for (const recipe of recipeList) {
        const calculated = calculateRecipeNutrition(recipe);

        if (calculated.kcal === recipe.kcal &&
            calculated.protein === recipe.protein &&
            calculated.fat === recipe.fat &&
            calculated.carbs === recipe.carbs) {
            okCount++;
        } else {
            failCount++;
            console.log(`FAIL: ${recipe.id} - obliczone: ${calculated.kcal}/${calculated.protein}/${calculated.fat}/${calculated.carbs}, zadeklarowane: ${recipe.kcal}/${recipe.protein}/${recipe.fat}/${recipe.carbs}`);
        }
    }
}

console.log(`\nOK: ${okCount}`);
console.log(`Błędne: ${failCount}`);
