const googleMapsIosApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY ?? '';
const googleMapsAndroidApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '';

const PRIVACY_POLICY_URL =
  'https://www.oneofthem.jp/%E3%83%97%E3%83%A9%E3%82%A4%E3%83%90%E3%82%B7%E3%83%BC%E3%83%9D%E3%83%AA%E3%82%B7%E3%83%BC';

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: 'フォンブースマップ',
  slug: 'phonebooth-map',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'phoneboothmap',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#E8F4FD',
  },
  plugins: [
    [
      'expo-build-properties',
      {
        android: {
          kotlinVersion: '1.9.25',
        },
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#E8F4FD',
        image: './assets/splash.png',
        resizeMode: 'contain',
        ios: {
          backgroundColor: '#E8F4FD',
          enableFullScreenImage_legacy: true,
          image: './assets/splash.png',
          tabletImage: './assets/splash-ipad-2048x2732.png',
        },
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          '近くのフォンブースを表示するために、使用中のみ現在地情報を利用します。',
      },
    ],
    'expo-iap',
  ],
  ios: {
    bundleIdentifier: 'jp.oneofthem.phonebooth',
    buildNumber: '1',
    icon: './assets/icon.png',
    supportsTablet: true,
    config: {
      googleMapsApiKey: googleMapsIosApiKey,
    },
    infoPlist: {
      CFBundleDisplayName: 'フォンブースマップ',
    },
    splash: {
      image: './assets/splash.png',
      tabletImage: './assets/splash-ipad-2048x2732.png',
      resizeMode: 'contain',
      backgroundColor: '#E8F4FD',
    },
  },
  android: {
    package: 'jp.oneofthem.phonebooth',
    versionCode: 1,
    icon: './assets/icon.png',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#E8F4FD',
    },
    backgroundColor: '#E8F4FD',
    config: {
      googleMaps: {
        apiKey: googleMapsAndroidApiKey,
      },
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  web: {
    favicon: './assets/icon.png',
  },
  extra: {
    privacyPolicyUrl: PRIVACY_POLICY_URL,
    publisherName: '(THE)ONE of THEM, Inc.',
    eas: {
      projectId: '80a6adb4-514e-4332-9d27-7ddfdf653f05',
    },
  },
};
