-- ============================================================
-- 本番ロックダウン(go-live前に実行)
--  クライアント(anon)から直接購読を書けないようにし、
--  購読の付与は Edge Function(service_role)経由に一本化する。
-- ============================================================

-- record_subscription は現在クライアントから呼んでいない(購入記録は verify-receipt が
-- service_role で直接書き込む)。anon から実行できないようにする。
revoke execute on function public.record_subscription(text, text, text, text, timestamptz, text, jsonb) from anon;

-- ※ get_subscription / cancel_subscription / redeem_coupon は引き続きクライアントから使うため
--   anon の実行権限は維持する。

-- 併せて手動で実施すること(SQLではない):
--   1) Edge Function のデモ検証を無効化:
--        npx supabase secrets unset ALLOW_DEMO --project-ref <ref>
--   2) JWS 署名検証を有効化:
--        npx supabase secrets set STRICT_VERIFY=true --project-ref <ref>
--        # 本番リリース時: APPLE_ENV=Production / APPLE_APP_APPLE_ID=<数値AppID> も設定
--   3) サンプルクーポンの削除(任意):
--        delete from public.coupons where code='WELCOME30';
