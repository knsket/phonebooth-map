const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Xcode 26 / 新しい Apple clang で、React Native 0.79 同梱の fmt(11.x) が
 * consteval 非互換でコンパイルできない問題を回避する。
 *
 * pod install 後(= fmt ヘッダ生成後)に走る Podfile の post_install フック内で
 * `Pods/fmt/include/fmt/base.h` の `FMT_USE_CONSTEVAL 1` を `0` に書き換える。
 * Expo 生成 Podfile には既存の post_install ブロックがあるため、そこへ追記する。
 *
 * 注: EAS クラウド(Xcode 26.2)では不要だが、gsub 対象が無ければ何もしないため無害。
 */
const FMT_FIX_RUBY = `    # fmt-consteval-fix: Xcode 26 / clang の consteval 非互換回避
    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      fmt_text = File.read(fmt_base)
      fmt_patched = fmt_text.gsub('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0')
      File.write(fmt_base, fmt_patched) if fmt_text != fmt_patched
    end
`;

const withFmtConstevalFix = (config) => {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return cfg;

      let podfile = fs.readFileSync(podfilePath, 'utf8');
      if (podfile.includes('fmt-consteval-fix')) return cfg;

      const anchor = 'post_install do |installer|\n';
      if (podfile.includes(anchor)) {
        podfile = podfile.replace(anchor, anchor + FMT_FIX_RUBY);
        fs.writeFileSync(podfilePath, podfile);
      }
      return cfg;
    },
  ]);
};

module.exports = withFmtConstevalFix;
