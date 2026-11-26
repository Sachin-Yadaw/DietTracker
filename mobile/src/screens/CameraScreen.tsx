import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { PrimaryButton } from '../components/CommonUI';
import { useTranslation } from '../i18n/useTranslation';
import { MealCategory } from '../types';
import { getDefaultMealTypeByTime } from '../utils/units';

export const CameraScreen: React.FC<{ route: any; navigation: any }> = ({ route, navigation }) => {
  const colors = useTheme();
  const { t } = useTranslation();
  const mealType: MealCategory = route.params?.mealType || getDefaultMealTypeByTime();
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const camRef = useRef<any>(null);

  const pickGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, base64: true });
    if (!res.canceled && res.assets[0]?.uri) {
      navigation.replace('Analyzing', { photoUri: res.assets[0].uri, photoBase64: res.assets[0].base64, mealType });
    }
  };

  const capturePhoto = async () => {
    if (!camRef.current) return;
    try {
      const photo = await camRef.current.takePictureAsync({ quality: 0.85 });
      // Section 2: Compress photo to max 1280px on long side, JPEG quality ~85
      const compressed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 768 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      navigation.replace('Analyzing', { photoUri: compressed.uri, photoBase64: compressed.base64, mealType });
    } catch {
      navigation.replace('Analyzing', { photoUri: undefined, mealType });
    }
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  // Section 12 & 14: Camera permission denied -> explain why & offer gallery/manual search
  if (!permission.granted) {
    return (
      <View style={[styles.permBox, { backgroundColor: colors.background }]}>
        <Ionicons name="camera-outline" size={64} color={colors.primary} />
        <Text style={[styles.permTitle, { color: colors.text }]}>Camera Permission Needed</Text>
        <Text style={[styles.permBody, { color: colors.textMuted }]}>
          We use your camera only when you snap a meal so AI can identify foods and calories. You can also upload from your gallery or search manually.
        </Text>
        <PrimaryButton title="Allow Camera" onPress={requestPermission} style={{ width: '100%', marginBottom: 10 }} />
        <PrimaryButton title="Upload from Gallery" variant="outline" onPress={pickGallery} style={{ width: '100%', marginBottom: 10 }} />
        <PrimaryButton
          title="Search Food Manually"
          variant="outline"
          onPress={() => navigation.replace('ManualSearch', { mealType })}
          style={{ width: '100%' }}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView ref={camRef} style={styles.cam} facing="back" flash={flash}>
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Ionicons name="close" size={28} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.hintPill}>
            <Text style={styles.hintText}>{t('plateHint')}</Text>
          </View>
          <TouchableOpacity onPress={() => setFlash(flash === 'off' ? 'on' : 'off')} style={styles.iconBtn}>
            <Ionicons name={flash === 'on' ? 'flash' : 'flash-off'} size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Plate Frame Guide */}
        <View style={styles.frameWrap}>
          <View style={styles.frameGuide} />
        </View>

        <View style={styles.bottomRow}>
          <TouchableOpacity onPress={pickGallery} style={styles.iconBtn}>
            <Ionicons name="images-outline" size={28} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={capturePhoto} style={styles.shutterOuter}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.replace('ManualSearch', { mealType })}
            style={styles.iconBtn}
          >
            <Ionicons name="search-outline" size={28} color="#FFF" />
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  cam: { flex: 1, justifyContent: 'space-between', paddingTop: 48, paddingBottom: 34, paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  hintPill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  hintText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  frameWrap: { alignItems: 'center', justifyContent: 'center' },
  frameGuide: { width: 270, height: 270, borderRadius: 135, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)', borderStyle: 'dashed' },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFF' },
  permBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 26 },
  permTitle: { fontSize: 22, fontWeight: '800', marginTop: 14, marginBottom: 8 },
  permBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 22 },
});
