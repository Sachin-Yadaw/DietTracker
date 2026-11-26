import React, { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n/useTranslation';
import { calculateNutrientsFromBackend, identifyFoodPhoto } from '../config/api';
import { MealCategory } from '../types';

export const AnalyzingScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const colors = useTheme();
  const { t } = useTranslation();
  const { userAllergies } = useApp();
  const { photoUri, photoBase64, mealType }: { photoUri?: string; photoBase64?: string; mealType: MealCategory } = route.params || { mealType: 'Lunch' };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const start = Date.now();
      // Step 1: Identify food items & visible toppings via Qwen3-VL (/api/identify-food)
      const { detected, usedBackend, errorNote } = await identifyFoodPhoto(photoUri || '', mealType, photoBase64);

      // Step 2: Deterministic nutrition lookup from master_nutrition.csv (/api/calculate-nutrients)
      const calc = await calculateNutrientsFromBackend({
        detected_output: detected,
        fallback_grams: 100,
        user_allergies: userAllergies,
      });

      const elapsed = Date.now() - start;
      if (elapsed < 800) {
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
      if (mounted) {
        navigation.replace('ReviewMeal', {
          photoUri,
          mealType,
          detectedOutput: detected,
          initialItems: calc.items,
          usedBackend: usedBackend && calc.usedBackend,
          vlmStatusNote: errorNote || (usedBackend ? 'Live Qwen3-VL' : 'Offline Fallback'),
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, [photoUri, photoBase64, mealType, navigation, userAllergies]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.preview} /> : null}
      <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
      <Text style={[styles.title, { color: colors.text }]}>{t('identifyingFood')}</Text>
      <Text style={{ color: colors.textMuted, marginTop: 6 }}>
        Identifying dishes & matching master nutrition database...
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  preview: { width: 240, height: 240, borderRadius: 20 },
  title: { fontSize: 20, fontWeight: '800', marginTop: 18 },
});
