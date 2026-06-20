-- ============================================================
-- クーポンコード(12ヶ月無料 / 将来の法人配布向け)
--  Supabase ダッシュボード > SQL Editor に貼り付けて実行する。
--  クーポンの「追加・管理」はダッシュボードの Table Editor から
--  public.coupons に行を追加する運用(= これが管理画面)。
--
--  ※ このファイルはライブDBの実構造に合わせてある(べき等)。再実行しても安全。
--
--  仕様:
--   - 1コードにつき発行枚数(max_redemptions)と有効期限(expires_at)を設定可能
--   - 1端末(app_user_id)につき1回まで利用可能
--   - 適用すると subscriptions が active になり、days 日ぶん無料になる
--     (12ヶ月無料は days = 365 で発行する)
--   - 書き込みは SECURITY DEFINER の redeem_coupon 経由のみ(anon直書き禁止)
-- ============================================================

-- ------------------------------------------------------------
-- coupons: クーポンマスタ(管理者がダッシュボードから行を追加する)
-- ------------------------------------------------------------
create table if not exists public.coupons (
  code             text primary key,                 -- クーポンコード(例: CORP-ACME-2026)
  plan             text not null default 'monthly',  -- 付与プラン(yearly=12ヶ月プラン表記 / monthly)
  days             integer not null default 30,      -- 無料付与する日数(12ヶ月 = 365)
  max_redemptions  integer,                          -- 発行枚数(利用回数上限)。null=無制限
  redeemed_count   integer not null default 0,       -- これまでの利用回数(自動更新)
  active           boolean not null default true,    -- false にすると即時無効化(失効)
  expires_at       timestamptz,                      -- 有効期限(null=無期限)
  note             text,                             -- 管理用メモ(配布先など)
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------
-- coupon_redemptions: 利用履歴(1端末1コードにつき1行 = 二重利用の防止)
-- ------------------------------------------------------------
create table if not exists public.coupon_redemptions (
  id           bigint generated always as identity primary key,
  code         text not null,
  app_user_id  text not null,
  created_at   timestamptz not null default now(),
  unique (code, app_user_id)
);

create index if not exists coupon_redemptions_user_idx
  on public.coupon_redemptions (app_user_id);

-- anon からの直接読み書きは禁止(管理者はダッシュボード/service_role で操作)
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
-- (RLSポリシーを作らない = anonは読み書き不可。RPCのSECURITY DEFINERでのみ操作)

-- ------------------------------------------------------------
-- redeem_coupon: クーポンを適用して購読をactiveにする
--  返り値(jsonb):
--    { success, message, plan?, current_period_end? }
-- ------------------------------------------------------------
create or replace function public.redeem_coupon(
  p_app_user_id text,
  p_code text,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.coupons;
  v_end timestamptz;
begin
  p_code := upper(btrim(coalesce(p_code, '')));
  if p_code = '' then
    return jsonb_build_object('success', false, 'message', 'クーポンコードを入力してください');
  end if;

  select * into c from public.coupons where upper(code) = p_code;
  if not found then
    return jsonb_build_object('success', false, 'message', 'クーポンが見つかりません');
  end if;
  if not c.active then
    return jsonb_build_object('success', false, 'message', 'このクーポンは現在ご利用いただけません');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return jsonb_build_object('success', false, 'message', 'クーポンの有効期限が切れています');
  end if;
  if c.max_redemptions is not null and c.redeemed_count >= c.max_redemptions then
    return jsonb_build_object('success', false, 'message', 'クーポンの利用上限に達しました');
  end if;
  if exists (
    select 1 from public.coupon_redemptions
    where upper(code) = p_code and app_user_id = p_app_user_id
  ) then
    return jsonb_build_object('success', false, 'message', 'このクーポンは既に利用済みです');
  end if;

  v_end := now() + make_interval(days => c.days);

  insert into public.app_users(app_user_id, platform)
  values (p_app_user_id::uuid, p_platform)
  on conflict (app_user_id) do nothing;

  insert into public.subscriptions(app_user_id, plan, status, store, product_id, current_period_end, updated_at)
  values (p_app_user_id, c.plan, 'active', 'coupon', 'coupon:' || c.code, v_end, now())
  on conflict (app_user_id) do update
    set plan = excluded.plan,
        status = 'active',
        store = 'coupon',
        product_id = excluded.product_id,
        -- 既存期限より延びる場合のみ延長(短縮しない)
        current_period_end = greatest(coalesce(public.subscriptions.current_period_end, now()), excluded.current_period_end),
        updated_at = now();

  insert into public.coupon_redemptions(code, app_user_id) values (c.code, p_app_user_id);
  update public.coupons set redeemed_count = redeemed_count + 1 where code = c.code;

  insert into public.purchase_events(app_user_id, store, product_id, event_type, raw_receipt)
  values (p_app_user_id, 'coupon', 'coupon:' || c.code, 'purchase', jsonb_build_object('coupon', c.code));

  return jsonb_build_object(
    'success', true,
    'message', 'クーポンを適用しました',
    'plan', c.plan,
    'current_period_end', v_end
  );
end;
$$;

grant execute on function public.redeem_coupon(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 使い方(管理者向けメモ):
--  12ヶ月無料クーポンを1件追加する例(ダッシュボードのSQL Editor):
--
--    insert into public.coupons (code, plan, days, max_redemptions, expires_at, note)
--    values ('CORP-ACME-2026', 'yearly', 365, 50, '2026-12-31 23:59:59+09', '株式会社ACME 法人配布 50名分');
--
--  - days = 365 で12ヶ月無料(30=1ヶ月など自由に設定可)
--  - plan = 'yearly' にするとアプリ上で「12ヶ月プラン」と表示される
--  - max_redemptions を null にすると無制限 / 指定すると発行枚数(利用上限)
--  - expires_at を null にすると無期限
--  - active を false に更新すると即時失効
--  - 利用状況は redeemed_count 列、誰が使ったかは coupon_redemptions テーブルで確認
-- ------------------------------------------------------------
