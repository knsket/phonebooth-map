// Google Maps の「モバイル用」APIキーは bundle ID / package + SHA で制限された公開キーであり、
// アプリバイナリに必ず埋め込まれる前提のもの(秘匿情報ではない)。
// 以前 EAS の env 変数注入が効かずキー未注入で iOS が起動時クラッシュ(GMSServices)したため、
// 確実性最優先でリテラルを既定値にし、env があれば上書きする方式に変更。
const GOOGLE_MAPS_IOS_API_KEY_DEFAULT = 'AIzaSyCNvMNAo1f1PVzlseT9af2ztQBlntBbC3M';
const GOOGLE_MAPS_ANDROID_API_KEY_DEFAULT = 'AIzaSyBNRcTLJfjUe2_JOyGlnM7U801fQ9wqUQk';

const googleMapsIosApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY || GOOGLE_MAPS_IOS_API_KEY_DEFAULT;
const googleMapsAndroidApiKey =
  process.env.GOOGLE_MAPS_ANDROID_API_KEY || GOOGLE_MAPS_ANDROID_API_KEY_DEFAULT;

// 念のため: 何らかの理由でキーが空ならビルドを止める(無キーのままストア提出を防ぐ)
if (!googleMapsIosApiKey || !googleMapsAndroidApiKey) {
  throw new Error('[app.config] Google Maps API key is empty. Refusing to build.');
}

const PRIVACY_POLICY_URL =
  'https://www.oneofthem.jp/%E3%83%97%E3%83%A9%E3%82%A4%E3%83%90%E3%82%B7%E3%83%BC%E3%83%9D%E3%83%AA%E3%82%B7%E3%83%BC';

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: 'フォンブース',
  slug: 'phonebooth-map',
  version: '1.0.1',
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
    './plugins/withKotlinMetadataFix',
    [
      'expo-build-properties',
      {
        android: {
          kotlinVersion: '1.9.25',
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          minSdkVersion: 24,
        },
        ios: {
          deploymentTarget: '15.1',
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
      CFBundleDisplayName: 'フォンブース',
      ITSAppUsesNonExemptEncryption: false,
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
