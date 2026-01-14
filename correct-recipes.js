// Skrypt do korekty gramatur przepisow - uruchom: node correct-recipes.js
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

console.log('Zaladowano baze skladnikow:', Object.keys(ingredientsDatabase).length);
console.log('Zaladowano przepisy:', recipes.breakfast.length + recipes.lunch.length + recipes.dinner.length);

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

    for (const ing of recipe.ingredients) {
        const ingredient = ingredientsDatabase[ing.item];
        if (!ingredient) continue;

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
        carbs: Math.round(totalCarbs)
    };
}

function calculateCorrectionFactor(declared, calculated) {
    // Oblicz wspolczynnik korekty na podstawie kcal (najwazniejsze)
    if (calculated.kcal === 0) return 1;

    const kcalFactor = declared.kcal / calculated.kcal;

    // Ograniczenie wspolczynnika do rozsadnych granic (max ±50%)
    return Math.max(0.5, Math.min(1.5, kcalFactor));
}

function roundAmount(amount, unit) {
    // Zaokraglij do sensownych wartosci w zaleznosci od jednostki
    if (unit === 'g' || unit === 'ml') {
        if (amount >= 100) return Math.round(amount / 5) * 5; // do 5g
        if (amount >= 10) return Math.round(amount);
        return Math.round(amount * 10) / 10; // do 0.1g
    }
    if (unit === 'szt' || unit === 'kromki' || unit === 'kromka') {
        return Math.round(amount * 2) / 2; // do 0.5 szt
    }
    if (unit === 'łyżka' || unit === 'łyżki' || unit === 'łyżeczka' || unit === 'łyżeczki') {
        return Math.round(amount * 2) / 2; // do 0.5 lyzki
    }
    return Math.round(amount * 10) / 10;
}

function correctRecipe(recipe) {
    const calculated = calculateRecipeNutrition(recipe);
    const declared = {
        kcal: recipe.kcal,
        protein: recipe.protein,
        fat: recipe.fat,
        carbs: recipe.carbs
    };

    const kcalDiff = Math.abs((calculated.kcal - declared.kcal) / declared.kcal * 100);

    // Jesli roznica <= 5%, nie koryguj
    if (kcalDiff <= 5) {
        return { recipe, corrected: false };
    }

    const factor = calculateCorrectionFactor(declared, calculated);

    // Koryguj gramatury wszystkich skladnikow
    const correctedIngredients = recipe.ingredients.map(ing => ({
        ...ing,
        amount: roundAmount(ing.amount * factor, ing.unit)
    }));

    const correctedRecipe = {
        ...recipe,
        ingredients: correctedIngredients
    };

    // Oblicz nowe wartosci po korekcie
    const newCalculated = calculateRecipeNutrition(correctedRecipe);
    const newKcalDiff = Math.abs((newCalculated.kcal - declared.kcal) / declared.kcal * 100);

    return {
        recipe: correctedRecipe,
        corrected: true,
        factor,
        oldCalculated: calculated,
        newCalculated,
        improvement: kcalDiff - newKcalDiff
    };
}

// Koryguj wszystkie przepisy
const corrections = {
    breakfast: [],
    lunch: [],
    dinner: []
};

let totalCorrected = 0;
let totalImprovement = 0;

for (const [category, recipeList] of Object.entries(recipes)) {
    for (const recipe of recipeList) {
        const result = correctRecipe(recipe);
        corrections[category].push(result.recipe);

        if (result.corrected) {
            totalCorrected++;
            totalImprovement += result.improvement;
            console.log(`Skorygowano ${recipe.id}: ${recipe.name} (wspolczynnik: ${result.factor.toFixed(2)}, poprawa: ${result.improvement.toFixed(1)}%)`);
        }
    }
}

console.log(`\nPodsumowanie: skorygowano ${totalCorrected} przepisow`);
console.log(`Srednia poprawa: ${(totalImprovement / totalCorrected).toFixed(1)}%`);

// Generuj nowy kod przepisow
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
${generateCategoryCode('breakfast', corrections.breakfast)},
${generateCategoryCode('lunch', corrections.lunch)},
${generateCategoryCode('dinner', corrections.dinner)}
        };`;

// Zapisz nowy plik HTML
const newHtml = html.substring(0, html.indexOf(recipesCode, html.indexOf('<script>'))) +
                newRecipesCode +
                html.substring(html.indexOf(recipesCode, html.indexOf('<script>')) + recipesCode.length);

// Backup oryginalnego pliku
const backupPath = path.join(__dirname, 'index.html.backup');
fs.writeFileSync(backupPath, html);
console.log(`\nKopia zapasowa zapisana do: ${backupPath}`);

// Zapisz skorygowany plik
fs.writeFileSync(htmlPath, newHtml);
console.log(`Skorygowany plik zapisany do: ${htmlPath}`);

// Uruchom weryfikacje po korekcie
console.log('\n========================================');
console.log('WERYFIKACJA PO KOREKCIE');
console.log('========================================\n');

// Przelicz wartosc po korekcie
let okCount = 0;
let failCount = 0;
const stillFailing = [];

for (const [category, recipeList] of Object.entries(corrections)) {
    for (const recipe of recipeList) {
        const calculated = calculateRecipeNutrition(recipe);
        const kcalDiff = Math.abs((calculated.kcal - recipe.kcal) / recipe.kcal * 100);
        const proteinDiff = Math.abs((calculated.protein - recipe.protein) / recipe.protein * 100);
        const fatDiff = Math.abs((calculated.fat - recipe.fat) / recipe.fat * 100);
        const carbsDiff = Math.abs((calculated.carbs - recipe.carbs) / recipe.carbs * 100);

        if (kcalDiff <= 5 && proteinDiff <= 5 && fatDiff <= 5 && carbsDiff <= 5) {
            okCount++;
        } else {
            failCount++;
            stillFailing.push({
                id: recipe.id,
                name: recipe.name,
                declared: { kcal: recipe.kcal, protein: recipe.protein, fat: recipe.fat, carbs: recipe.carbs },
                calculated,
                diffs: { kcal: kcalDiff, protein: proteinDiff, fat: fatDiff, carbs: carbsDiff }
            });
        }
    }
}

console.log(`OK (w tolerancji ±5%): ${okCount}`);
console.log(`Nadal poza tolerancja: ${failCount}`);

if (stillFailing.length > 0 && stillFailing.length <= 20) {
    console.log('\nPrzepisy nadal poza tolerancja:');
    for (const r of stillFailing) {
        console.log(`  ${r.id}: ${r.name}`);
        console.log(`    Dekl: ${r.declared.kcal} kcal, ${r.declared.protein}B, ${r.declared.fat}T, ${r.declared.carbs}W`);
        console.log(`    Obl:  ${r.calculated.kcal} kcal, ${r.calculated.protein}B, ${r.calculated.fat}T, ${r.calculated.carbs}W`);
        console.log(`    Rozn: ${r.diffs.kcal.toFixed(1)}% kcal, ${r.diffs.protein.toFixed(1)}% B, ${r.diffs.fat.toFixed(1)}% T, ${r.diffs.carbs.toFixed(1)}% W`);
    }
}
