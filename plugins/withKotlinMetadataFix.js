const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = 'withKotlinMetadataFix';

// expo-iap (OpenIAP 2.x) pulls kotlin-stdlib 2.2.x while Expo SDK 53 uses Kotlin 2.0.x.
// Apply -Xskip-metadata-version-check to all Kotlin subprojects so :expo and others compile.
const KOTLIN_METADATA_FIX = `
// ${MARKER}: expo-iap OpenIAP vs Expo SDK 52 Kotlin 1.9.x
subprojects { subproject ->
  subproject.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions {
      freeCompilerArgs += ["-Xskip-metadata-version-check"]
    }
  }
}
`;

module.exports = function withKotlinMetadataFix(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      if (!config.modResults.contents.includes(MARKER)) {
        config.modResults.contents += `\n${KOTLIN_METADATA_FIX}`;
      }
    }
    return config;
  });
};
