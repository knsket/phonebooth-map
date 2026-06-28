const { withAppDelegate } = require('@expo/config-plugins');

/**
 * iOS Spotlight(端末内検索)にアプリ自身をインデックスする config plugin。
 *
 * 設計方針(絶対にクラッシュさせない):
 * - JS ブリッジを経由しないネイティブ実装にし、RCTFatal で致命化する経路を排除する。
 * - 起動直後の繊細な時間帯(マップ/ネイティブ初期化と競合)を避け、数秒遅延 + 低優先度の
 *   バックグラウンドキューで実行する。
 * - CSSearchableIndex.indexSearchableItems は失敗を completion handler で返す設計のため例外を投げない。
 * - 強制アンラップ(!)を一切使わない。
 */

const IMPORT_ANCHOR = 'import ReactAppDependencyProvider';
const IMPORT_BLOCK = `import ReactAppDependencyProvider
import CoreSpotlight
import UniformTypeIdentifiers`;

const MARKER = '// [phonebooth-spotlight]';
const RETURN_ANCHOR =
  'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

const INDEX_BLOCK = `    ${MARKER} アプリ自身を端末内検索(Spotlight)へインデックス。
    // CSSearchableIndex は completion handler でエラーを返す設計のため例外で落ちない。
    // 起動直後の負荷集中を避け、数秒遅延 + バックグラウンドで実行する。
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 4) {
      let attributeSet = CSSearchableItemAttributeSet(contentType: UTType.content)
      attributeSet.title = "フォンブース"
      attributeSet.contentDescription = "全国のフォンブース・テレワークブースを地図で検索"
      attributeSet.keywords = [
        "phone", "booth", "phonebooth", "telework", "telecube", "cocodesk",
        "chatbox", "teams", "meet", "zoom", "map",
        "フォンブース", "ブース", "テレワーク", "地図", "テレキューブ"
      ]
      let item = CSSearchableItem(
        uniqueIdentifier: "phoneboothmap://app",
        domainIdentifier: "jp.oneofthem.phonebooth",
        attributeSet: attributeSet
      )
      CSSearchableIndex.default().indexSearchableItems([item]) { _ in }
    }
    ${RETURN_ANCHOR}`;

const withSpotlightIndexing = (config) => {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      return cfg;
    }
    let contents = cfg.modResults.contents;

    // 既に適用済みなら何もしない(冪等)
    if (contents.includes(MARKER)) {
      return cfg;
    }

    if (!contents.includes('import CoreSpotlight')) {
      contents = contents.replace(IMPORT_ANCHOR, IMPORT_BLOCK);
    }

    if (contents.includes(RETURN_ANCHOR)) {
      contents = contents.replace(RETURN_ANCHOR, INDEX_BLOCK);
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
};

module.exports = withSpotlightIndexing;
