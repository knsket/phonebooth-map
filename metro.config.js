// Expo + Metro 設定
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @supabase/supabase-js v2 は optional な @opentelemetry/api を動的importしており、
// Metroが静的解決に失敗してバンドルが壊れる。テレメトリは任意機能(try/catch内)なので
// 空モジュールに解決して無効化する。
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@opentelemetry/api') {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
