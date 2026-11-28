import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n/useTranslation';
import { Card, PrimaryButton } from '../components/CommonUI';
import { MealCategory } from '../types';
import { getDefaultMealTypeByTime } from '../utils/units';

const CATS: MealCategory[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export const FoodScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const colors = useTheme();
  const { t } = useTranslation();
  const { addWater, favourites, addMeal, pendingPhotos, removePendingPhoto } = useApp();
  const [mealType, setMealType] = useState<MealCategory>(getDefaultMealTypeByTime());
  const [customWater, setCustomWater] = useState('');

  const pickFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      base64: true,
    });
    if (!res.canceled && res.assets[0]?.uri) {
      navigation.navigate('Analyzing', { photoUri: res.assets[0].uri, photoBase64: res.assets[0].base64, mealType });
    }
  };

  const quickRelogFavourite = (title: string, items: any[]) => {
    addMeal({
      meal_type: mealType,
      eaten_at: new Date().toISOString(),
      items,
      total_calories: Math.round(items.reduce((s, i) => s + i.calories, 0)),
      total_protein: Math.round(items.reduce((s, i) => s + i.protein, 0) * 10) / 10,
      total_carbs: Math.round(items.reduce((s, i) => s + i.carbs, 0) * 10) / 10,
      total_fat: Math.round(items.reduce((s, i) => s + i.fat, 0) * 10) / 10,
      source: 'manual',
    });
    Alert.alert('Meal Logged', `${title} added to ${mealType}.`);
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.heading, { color: colors.text }]}>{t('logYourFood')}</Text>

      {/* Meal Type Selector */}
      <View style={styles.catRow}>
        {CATS.map((c) => {
          const active = mealType === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => setMealType(c)}
              style={[
                styles.catChip,
                { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border },
              ]}
            >
              <Text style={{ color: active ? '#FFF' : colors.text, fontWeight: '700', fontSize: 13 }}>{c}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Main Camera Hero Card */}
      <TouchableOpacity
        onPress={() => navigation.navigate('Camera', { mealType })}
        style={[styles.cameraHero, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
      >
        <Ionicons name="camera" size={44} color="#FFFFFF" />
        <Text style={styles.heroTitle}>{t('takePhoto')}</Text>
        <Text style={styles.heroSub}>Model detects Indian & global dishes in seconds</Text>
      </TouchableOpacity>

      <View style={{ gap: 10, marginBottom: 16 }}>
        <PrimaryButton title={t('uploadGallery')} variant="outline" onPress={pickFromGallery} />
        <PrimaryButton
          title={t('searchManually')}
          variant="outline"
          onPress={() => navigation.navigate('ManualSearch', { mealType })}
        />
      </View>

      {/* Pending Offline Photos Queue (Section 4 #19) */}
      {pendingPhotos.length > 0 && (
        <Card>
          <Text style={[styles.secTitle, { color: colors.warning }]}>Queued Offline Photos ({pendingPhotos.length})</Text>
          {pendingPhotos.map((job) => (
            <View key={job.id} style={styles.queueRow}>
              <Text style={{ color: colors.text, flex: 1 }}>{job.meal_type} photo saved offline</Text>
              <TouchableOpacity
                onPress={() => {
                  removePendingPhoto(job.id);
                  navigation.navigate('Analyzing', { photoUri: job.photo_uri, mealType: job.meal_type });
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Analyze Now</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      )}

      {/* Recent & Favourites */}
      <Card>
        <Text style={[styles.secTitle, { color: colors.text }]}>{t('recentFavourites')}</Text>
        {favourites.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            Star a meal on the Review screen to re-log it here in one tap.
          </Text>
        ) : (
          <View style={styles.favWrap}>
            {favourites.map((fav) => (
              <TouchableOpacity
                key={fav.id}
                onPress={() => quickRelogFavourite(fav.title, fav.items)}
                style={[styles.favChip, { backgroundColor: colors.accent }]}
              >
                <Text style={{ color: colors.primaryDark, fontWeight: '700' }}>★ {fav.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Card>

      {/* Quick Water Logging at bottom of Food tab (Blueprint Section 7.5) */}
      <Card>
        <Text style={[styles.secTitle, { color: colors.text }]}>{t('water')} Quick Add</Text>
        <View style={styles.waterRow}>
          {[200, 250, 500].map((ml) => (
            <TouchableOpacity
              key={ml}
              onPress={() => {
                addWater(ml);
                Alert.alert('Water Logged', `+${ml} ml added!`);
              }}
              style={[styles.waterBtn, { backgroundColor: colors.water }]}
            >
              <Text style={{ color: '#FFF', fontWeight: '700' }}>+{ml} ml</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.customWaterRow}>
          <TextInput
            placeholder="Custom ml (e.g. 350)"
            placeholderTextColor={colors.textMuted}
            value={customWater}
            onChangeText={setCustomWater}
            keyboardType="number-pad"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
          />
          <TouchableOpacity
            onPress={() => {
              const v = Number(customWater);
              if (v > 0) {
                addWater(v);
                setCustomWater('');
                Alert.alert('Water Logged', `+${v} ml added!`);
              }
            }}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={{ color: '#FFF', fontWeight: '700' }}>Add</Text>
          </TouchableOpacity>
        </View>
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16, paddingTop: 50, paddingBottom: 100 },
  heading: { fontSize: 24, fontWeight: '800', marginBottom: 14 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  catChip: { minHeight: 42, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, justifyContent: 'center' },
  cameraHero: { borderRadius: 18, padding: 26, alignItems: 'center', marginBottom: 14 },
  heroTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', marginTop: 10 },
  heroSub: { color: '#E8F5E9', fontSize: 13, marginTop: 4, textAlign: 'center' },
  secTitle: { fontSize: 16, fontWeight: '800', marginBottom: 10 },
  queueRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  favWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  favChip: { paddingHorizontal: 14, minHeight: 40, borderRadius: 12, justifyContent: 'center' },
  waterRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  waterBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  customWaterRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  addBtn: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, justifyContent: 'center' },
});
