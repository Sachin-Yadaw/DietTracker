import { FoodItem, MealCategory, MealFoodEntry, VlmIdentifyResponse } from '../types';
import { OFFLINE_FOODS } from '../utils/nutritionDb';

/**
 * Set this to your PC's local Wi-Fi IPv4 address (e.g., 'http://192.168.1.15:8000')
 * so Expo Go on your Android phone can reach FastAPI (/api/identify-food & /api/calculate-nutrients).
 */
export const API_BASE_URL = 'http://10.85.97.33:8000';

function confidenceLabelToNum(label?: string): number {
  const l = (label || 'high').toLowerCase();
  if (l === 'low') return 0.35;
  if (l === 'medium') return 0.68;
  return 0.92;
}

/**
 * Step 1: Send meal photo to POST /api/identify-food (Qwen3-VL-8B-Instruct).
 * Returns strict JSON: { image_scope, items: [{ name, confidence, visible_toppings }] }
 */
export async function identifyFoodPhoto(
  photoUri: string,
  mealType: MealCategory,
  photoBase64?: string
): Promise<{ detected: VlmIdentifyResponse; usedBackend: boolean; errorNote?: string }> {
  let errorNote: string | undefined;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let res: Response;
    if (photoBase64) {
      res = await fetch(`${API_BASE_URL}/api/identify-food-b64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: photoBase64, meal_type: mealType }),
      });
    } else {
      const formData = new FormData();
      formData.append('meal_type', mealType);
      formData.append('photo', {
        uri: photoUri,
        name: 'meal.jpg',
        type: 'image/jpeg',
      } as any);
      res = await fetch(`${API_BASE_URL}/api/identify-food`, {
        method: 'POST',
        body: formData,
      });
    }
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return { detected: data, usedBackend: true };
    }
    errorNote = `Backend HTTP ${res.status}`;
  } catch (err: any) {
    errorNote = err?.message || 'Network request failed';
    console.warn('[identifyFoodPhoto] fallback:', errorNote);
  }

  // Offline fallback matching the exact Qwen3-VL JSON schema
  const fallbackPresets: Record<MealCategory, VlmIdentifyResponse> = {
    Breakfast: {
      image_scope: 'multi_item',
      items: [
        { name: 'Poha', confidence: 'high', visible_toppings: ['roasted peanuts', 'onion'] },
        { name: 'Banana', confidence: 'high', visible_toppings: [] },
      ],
    },
    Lunch: {
      image_scope: 'multi_item',
      items: [
        { name: 'Steamed White Rice', confidence: 'high', visible_toppings: [] },
        { name: 'Yellow Dal Tadka', confidence: 'high', visible_toppings: [] },
        { name: 'Whole Wheat Roti', confidence: 'high', visible_toppings: [] },
        { name: 'Mixed Vegetable Sabzi', confidence: 'low', visible_toppings: [] },
      ],
    },
    Dinner: {
      image_scope: 'multi_item',
      items: [
        { name: 'Whole Wheat Roti', confidence: 'high', visible_toppings: [] },
        { name: 'Paneer Bhurji', confidence: 'high', visible_toppings: [] },
        { name: 'Fresh Garden Salad', confidence: 'high', visible_toppings: [] },
      ],
    },
    Snacks: {
      image_scope: 'multi_item',
      items: [
        { name: 'Apple', confidence: 'high', visible_toppings: [] },
        { name: 'Roasted Almonds', confidence: 'high', visible_toppings: [] },
      ],
    },
  };

  return {
    detected: fallbackPresets[mealType] || fallbackPresets.Lunch,
    usedBackend: false,
    errorNote,
  };
}

/**
 * Step 2: Send detected items + user edits (delete, rename, add, grams or piece/unit quantities)
 * to POST /api/calculate-nutrients backed by data/master_nutrition.csv.
 */
export async function calculateNutrientsFromBackend(params: {
  detected_output: VlmIdentifyResponse;
  delete_names?: string[];
  rename_map?: Record<string, string>;
  add_items?: Array<{ name: string; quantity?: number; unit_type?: 'grams' | 'piece' | 'unit' }>;
  user_quantities?: Record<string, { quantity: number; unit_type: 'grams' | 'piece' | 'unit' }>;
  fallback_grams?: number;
  user_allergies?: string[];
}): Promise<{ items: MealFoodEntry[]; usedBackend: boolean }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${API_BASE_URL}/api/calculate-nutrients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const mapped: MealFoodEntry[] = (data.items || []).map((it: any, idx: number) => {
        const confLbl = (it.confidence || 'high') as 'high' | 'medium' | 'low';
        const isMatched = it.status === 'matched';
        return {
          id: `${Date.now()}_${idx}`,
          food_id: it.food_id,
          input_name: it.input_name,
          name_en: isMatched ? it.matched_name : it.input_name,
          grams: isMatched ? Number(it.grams_used || 100) : 100,
          unit_type: 'grams',
          quantity_value: isMatched ? Number(it.grams_used || 100) : 100,
          default_unit_name: it.default_unit_name || 'serving / bowl',
          default_unit_grams: Number(it.default_unit_grams || 150),
          weight_label: it.weight_label,
          calories: Number(it.energy_kcal || 0),
          protein: Number(it.protein_g || 0),
          carbs: Number(it.carbs_g || 0),
          fat: Number(it.fat_g || 0),
          fiber_g: Number(it.fiber_g || 0),
          micronutrients: {
            calcium_mg: Number(it.calcium_mg || 0),
            iron_mg: Number(it.iron_mg || 0),
            vit_c_mg: Number(it.vit_c_mg || 0),
          },
          confidence: confidenceLabelToNum(confLbl),
          confidence_label: confLbl,
          is_low_confidence: confLbl === 'low' || !isMatched,
          is_topping: Boolean(it.is_topping),
          status: isMatched ? 'matched' : 'unmatched',
          match_method: it.match_method,
          source_db: it.source,
          allergy_alerts: it.allergy_alerts || [],
        };
      });
      return { items: mapped, usedBackend: true };
    }
  } catch {
    // Fallback to local OFFLINE_FOODS matcher
  }

  // Offline deterministic fallback
  const lowerAllergies = (params.user_allergies || []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const items: MealFoodEntry[] = [];
  let idx = 0;
  for (const det of params.detected_output.items || []) {
    const names = [det.name, ...(det.visible_toppings || [])];
    names.forEach((raw, nIdx) => {
      const low = raw.toLowerCase();
      const match = OFFLINE_FOODS.find(
        (f) => f.name_en.toLowerCase().includes(low) || low.includes(f.yolo_class || '___')
      );
      const grams = nIdx > 0 ? 15 : params.fallback_grams || 100;
      const factor = grams / 100;
      const alerts = lowerAllergies.filter(
        (a) =>
          low.includes(a) ||
          (match?.allergen_tags || []).some((t) => t.toLowerCase().includes(a))
      );
      items.push({
        id: `${Date.now()}_${idx++}`,
        food_id: match?.id,
        input_name: raw,
        name_en: match ? match.name_en : raw,
        name_hi: match?.name_hi,
        grams,
        unit_type: 'grams',
        quantity_value: grams,
        default_unit_name: match?.serving_sizes[0]?.label || 'serving / bowl',
        default_unit_grams: match?.serving_sizes[0]?.grams || 150,
        calories: match ? Math.round(match.calories_per_100g * factor) : 0,
        protein: match ? Math.round(match.protein_per_100g * factor * 10) / 10 : 0,
        carbs: match ? Math.round(match.carbs_per_100g * factor * 10) / 10 : 0,
        fat: match ? Math.round(match.fat_per_100g * factor * 10) / 10 : 0,
        micronutrients: {},
        confidence: confidenceLabelToNum(det.confidence),
        confidence_label: det.confidence,
        is_low_confidence: det.confidence === 'low' || !match,
        is_topping: nIdx > 0,
        status: match ? 'matched' : 'unmatched',
        source_db: match?.source || 'Offline',
        allergy_alerts: alerts,
      });
    });
  }

  return { items, usedBackend: false };
}

/**
 * Search across all 1,224 rows of data/master_nutrition.csv via GET /api/foods/search,
 * falling back to OFFLINE_FOODS if backend is unreachable.
 */
export async function searchMasterFoods(query: string): Promise<FoodItem[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `${API_BASE_URL}/api/foods/search?q=${encodeURIComponent(query)}&limit=30`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (res.ok) {
      const rows = await res.json();
      return rows.map((r: any) => ({
        id: r.food_id,
        name_en: r.canonical_name,
        name_hi: '',
        category: r.source || 'Master DB',
        cuisine: String(r.source || '').includes('INDB') ? 'Indian' : 'Global',
        calories_per_100g: Number(r.energy_kcal || 0),
        protein_per_100g: Number(r.protein_g || 0),
        carbs_per_100g: Number(r.carbs_g || 0),
        fat_per_100g: Number(r.fat_g || 0),
        fibre_per_100g: Number(r.fiber_g || 0),
        micronutrients: {
          calcium_mg: Number(r.calcium_mg || 0),
          iron_mg: Number(r.iron_mg || 0),
          vit_c_mg: Number(r.vit_c_mg || 0),
        },
        serving_sizes: [
          {
            label: r.default_unit_name || 'serving / bowl',
            grams: Number(r.default_unit_grams || 150),
          },
        ],
        default_unit_name: r.default_unit_name || 'serving / bowl',
        default_unit_grams: Number(r.default_unit_grams || 150),
        diet_tags: [],
        allergen_tags: [],
        source: r.source || 'master_nutrition.csv',
      }));
    }
  } catch {
    // Fallback to offline list
  }

  const q = query.trim().toLowerCase();
  if (!q) return OFFLINE_FOODS;
  return OFFLINE_FOODS.filter(
    (f) =>
      f.name_en.toLowerCase().includes(q) ||
      f.name_hi.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q)
  );
}
