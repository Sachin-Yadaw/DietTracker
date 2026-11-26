import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n/useTranslation';
import { Card, PrimaryButton } from '../components/CommonUI';
import { MealCategory, MealFoodEntry } from '../types';
import { calculateNutrientsFromBackend } from '../config/api';

const CATS: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export const ReviewMealScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const colors = useTheme();
  const { t, lang } = useTranslation();
  const { addMeal, updateMeal, toggleFavourite, userAllergies } = useApp();

  const {
    photoUri,
    mealType: initMealType = 'Lunch',
    initialItems = [],
    editMealId,
    vlmStatusNote,
  }: { photoUri?: string; mealType: MealCategory; initialItems: MealFoodEntry[]; editMealId?: string; vlmStatusNote?: string } =
    route.params || {};

  const [mealType, setMealType] = useState<MealCategory>(initMealType);
  const [items, setItems] = useState<MealFoodEntry[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [rematching, setRematching] = useState(false);
  const [saveAsFav, setSaveAsFav] = useState(false);

  const totals = useMemo(() => {
    return {
      calories: Math.round(items.reduce((s, i) => s + i.calories, 0)),
      protein: Math.round(items.reduce((s, i) => s + i.protein, 0) * 10) / 10,
      carbs: Math.round(items.reduce((s, i) => s + i.carbs, 0) * 10) / 10,
      fat: Math.round(items.reduce((s, i) => s + i.fat, 0) * 10) / 10,
    };
  }, [items]);

  const allergyMatches = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => (it.allergy_alerts || []).forEach((a) => set.add(a)));
    return Array.from(set);
  }, [items]);

  const rescaleItem = (it: MealFoodEntry, newGrams: number, unitType: 'grams' | 'unit', qtyVal: number): MealFoodEntry => {
    const safeGrams = Math.max(1, newGrams);
    const ratio = safeGrams / Math.max(1, it.grams);
    const unitName = it.default_unit_name || 'serving / bowl';
    return {
      ...it,
      grams: Math.round(safeGrams * 10) / 10,
      unit_type: unitType,
      quantity_value: qtyVal,
      weight_label: unitType === 'unit' ? `${qtyVal} x ${unitName} (${Math.round(safeGrams)}g)` : `${Math.round(safeGrams)}g`,
      calories: Math.round(it.calories * ratio),
      protein: Math.round(it.protein * ratio * 10) / 10,
      carbs: Math.round(it.carbs * ratio * 10) / 10,
      fat: Math.round(it.fat * ratio * 10) / 10,
      was_edited_by_user: true,
    };
  };

  const toggleUnitMode = (id: string, targetMode: 'grams' | 'unit') => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const unitGrams = it.default_unit_grams || 150;
        if (targetMode === 'unit') {
          const defaultQty = 1;
          return rescaleItem(it, defaultQty * unitGrams, 'unit', defaultQty);
        }
        return rescaleItem(it, it.grams, 'grams', Math.round(it.grams));
      })
    );
  };

  const stepQuantity = (id: string, delta: number) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const mode = it.unit_type || 'grams';
        if (mode === 'unit') {
          const curQty = it.quantity_value ?? 1;
          const nextQty = Math.max(0.5, Math.round((curQty + delta) * 2) / 2);
          const unitGrams = it.default_unit_grams || 150;
          return rescaleItem(it, nextQty * unitGrams, 'unit', nextQty);
        }
        const nextGrams = Math.max(10, Math.round(it.grams + delta));
        return rescaleItem(it, nextGrams, 'grams', nextGrams);
      })
    );
  };

  const applyRenameAndRematch = async (itemId: string) => {
    const newName = renameText.trim();
    if (!newName) return;
    setRematching(true);
    try {
      const target = items.find((x) => x.id === itemId);
      const calc = await calculateNutrientsFromBackend({
        detected_output: {
          image_scope: 'single_item',
          items: [{ name: newName, confidence: 'high', visible_toppings: [] }],
        },
        user_quantities: target
          ? {
              [newName]: {
                quantity: target.unit_type === 'unit' ? target.quantity_value || 1 : target.grams,
                unit_type: target.unit_type === 'unit' ? 'piece' : 'grams',
              },
            }
          : undefined,
        user_allergies: userAllergies,
      });
      if (calc.items[0]) {
        const updated = { ...calc.items[0], id: itemId, was_edited_by_user: true };
        setItems((prev) => prev.map((it) => (it.id === itemId ? updated : it)));
      }
    } finally {
      setRematching(false);
      setEditingId(null);
      setRenameText('');
    }
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const saveMeal = () => {
    if (items.length === 0) {
      Alert.alert('No items', 'Add at least one food item or retake the photo.');
      return;
    }
    const doSave = () => {
      if (editMealId) {
        updateMeal(editMealId, mealType, items);
      } else {
        addMeal({
          meal_type: mealType,
          eaten_at: new Date().toISOString(),
          photo_uri: photoUri,
          items,
          total_calories: totals.calories,
          total_protein: totals.protein,
          total_carbs: totals.carbs,
          total_fat: totals.fat,
          source: photoUri ? 'photo' : 'manual',
        });
      }
      if (saveAsFav) {
        const title = items.map((i) => i.name_en.split(' ')[0]).slice(0, 2).join(' + ');
        toggleFavourite(title, items);
      }
      Alert.alert('Saved!', `${mealType} (${totals.calories} kcal) saved to your log.`);
      navigation.navigate('MainTabs');
    };

    if (totals.calories > 1600) {
      Alert.alert(
        'High Calorie Entry',
        `This meal totals ${totals.calories} kcal. Would you like to double-check portions or save as is?`,
        [
          { text: 'Check Portions', style: 'cancel' },
          { text: 'Save Anyway', onPress: doSave },
        ]
      );
    } else {
      doSave();
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.heading, { color: colors.text }]}>{t('reviewMeal')}</Text>
      {vlmStatusNote ? (
        <Text style={{ color: vlmStatusNote.includes('Live') ? colors.primary : colors.warning, fontWeight: '700', fontSize: 12, marginBottom: 8 }}>
          Mode: {vlmStatusNote}
        </Text>
      ) : null}

      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
      ) : null}

      {/* Red Allergy Warning Banner */}
      {allergyMatches.length > 0 && (
        <View style={[styles.allergyBanner, { backgroundColor: colors.danger }]}>
          <Ionicons name="warning" size={22} color="#FFF" />
          <Text style={styles.allergyText}>
            {t('allergyWarning')}: Detected item may contain {allergyMatches.join(', ')}!
          </Text>
        </View>
      )}

      {/* Meal Type Switcher */}
      <View style={styles.catRow}>
        {CATS.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setMealType(c)}
            style={[
              styles.catBtn,
              { backgroundColor: mealType === c ? colors.primary : colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={{ color: mealType === c ? '#FFF' : colors.text, fontWeight: '700', fontSize: 12 }}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Detected Food Items & Visible Toppings */}
      {items.map((item) => {
        const mode = item.unit_type || 'grams';
        const unitLabel = item.default_unit_name || 'piece';
        const isEditing = editingId === item.id;
        return (
          <Card
            key={item.id}
            style={
              item.status === 'unmatched' || item.is_low_confidence
                ? { borderColor: colors.warning, borderWidth: 1.5 }
                : undefined
            }
          >
            <View style={styles.itemTop}>
              <View style={{ flex: 1 }}>
                <View style={styles.badgeRow}>
                  {item.is_topping && (
                    <Text style={[styles.badge, { backgroundColor: colors.accent, color: colors.primaryDark }]}>
                      Topping
                    </Text>
                  )}
                  {item.status === 'unmatched' && (
                    <Text style={[styles.badge, { backgroundColor: colors.warning, color: '#FFF' }]}>
                      Unmatched — tap Rename
                    </Text>
                  )}
                  {item.confidence_label === 'low' && (
                    <Text style={[styles.badge, { backgroundColor: colors.warning, color: '#FFF' }]}>
                      {t('notSure')}
                    </Text>
                  )}
                </View>

                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                  {lang === 'hi' && item.name_hi ? item.name_hi : item.name_en}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {item.weight_label || `${item.grams}g`} • {item.calories} kcal (P {item.protein}g • C {item.carbs}g • F {item.fat}g)
                </Text>
                {item.source_db ? (
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                    Source: {item.source_db} • 1 {unitLabel} = {item.default_unit_grams || 150}g
                  </Text>
                ) : null}
              </View>

              <View style={styles.itemIcons}>
                <TouchableOpacity
                  onPress={() => {
                    setEditingId(isEditing ? null : item.id);
                    setRenameText(item.input_name || item.name_en);
                  }}
                  style={styles.iconTouch}
                  accessibilityLabel="Rename item"
                >
                  <Ionicons name="create-outline" size={22} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.iconTouch} accessibilityLabel="Delete item">
                  <Ionicons name="close-circle-outline" size={24} color={colors.danger} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Inline Rename & Re-match Box */}
            {isEditing && (
              <View style={styles.renameBox}>
                <TextInput
                  placeholder="Enter dish name (e.g. Chana Masala, Poori)"
                  placeholderTextColor={colors.textMuted}
                  value={renameText}
                  onChangeText={setRenameText}
                  style={[styles.renameInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.background }]}
                />
                <TouchableOpacity
                  onPress={() => applyRenameAndRematch(item.id)}
                  disabled={rematching}
                  style={[styles.rematchBtn, { backgroundColor: colors.primary }]}
                >
                  {rematching ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 13 }}>Match</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Unit Mode Toggle: Grams vs Default Unit / Piece */}
            <View style={styles.unitToggleRow}>
              <TouchableOpacity
                onPress={() => toggleUnitMode(item.id, 'grams')}
                style={[
                  styles.unitBtn,
                  { backgroundColor: mode === 'grams' ? colors.primary : colors.background, borderColor: colors.border },
                ]}
              >
                <Text style={{ color: mode === 'grams' ? '#FFF' : colors.text, fontWeight: '700', fontSize: 12 }}>
                  Grams ({Math.round(item.grams)}g)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => toggleUnitMode(item.id, 'unit')}
                style={[
                  styles.unitBtn,
                  { backgroundColor: mode === 'unit' ? colors.primary : colors.background, borderColor: colors.border },
                ]}
              >
                <Text style={{ color: mode === 'unit' ? '#FFF' : colors.text, fontWeight: '700', fontSize: 12 }}>
                  {mode === 'unit' ? `${item.quantity_value ?? 1} × ${unitLabel}` : `By ${unitLabel}`}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Quantity +/- Controls */}
            <View style={styles.qtyRow}>
              <TouchableOpacity
                onPress={() => stepQuantity(item.id, mode === 'unit' ? -0.5 : -25)}
                style={[styles.qtyBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  {mode === 'unit' ? '-0.5' : '-25 g'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => stepQuantity(item.id, mode === 'unit' ? 0.5 : 25)}
                style={[styles.qtyBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  {mode === 'unit' ? '+0.5' : '+25 g'}
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        );
      })}

      <PrimaryButton
        title={t('addMissingItem')}
        variant="outline"
        onPress={() =>
          navigation.navigate('ManualSearch', {
            mealType,
            onPickFood: (entry: MealFoodEntry) => setItems((prev) => [...prev, entry]),
          })
        }
        style={{ marginBottom: 14 }}
      />

      {/* Live Totals Card */}
      <Card style={{ backgroundColor: colors.accent }}>
        <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: 18 }}>
          TOTAL: {totals.calories} kcal
        </Text>
        <Text style={{ color: colors.primaryDark, fontWeight: '600', marginTop: 4 }}>
          Protein {totals.protein} g  •  Carbs {totals.carbs} g  •  Fat {totals.fat} g
        </Text>
        <TouchableOpacity onPress={() => setSaveAsFav(!saveAsFav)} style={styles.favToggle}>
          <Ionicons name={saveAsFav ? 'star' : 'star-outline'} size={20} color={colors.primaryDark} />
          <Text style={{ color: colors.primaryDark, fontWeight: '700', marginLeft: 6 }}>Save to Favourites</Text>
        </TouchableOpacity>
      </Card>

      <View style={styles.actionRow}>
        <PrimaryButton title={t('retake')} variant="outline" onPress={() => navigation.replace('Camera', { mealType })} style={{ flex: 1 }} />
        <PrimaryButton title={t('confirm')} onPress={saveMeal} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16, paddingTop: 48, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  photo: { width: '100%', height: 210, borderRadius: 16, marginBottom: 14 },
  allergyBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, marginBottom: 12 },
  allergyText: { color: '#FFF', fontWeight: '800', flex: 1, fontSize: 13 },
  catRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  catBtn: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start' },
  badgeRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  badge: { fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  itemIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconTouch: { padding: 4 },
  renameBox: { flexDirection: 'row', gap: 8, marginTop: 10 },
  renameInput: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 14 },
  rematchBtn: { minHeight: 42, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  unitToggleRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  unitBtn: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qtyRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  qtyBtn: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  favToggle: { flexDirection: 'row', alignItems: 'center', marginTop: 10, minHeight: 36 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
});
