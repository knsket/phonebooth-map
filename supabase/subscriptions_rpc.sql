-- ============================================================
-- ログイン不要の購読管理RPC(端末の匿名ID app_user_id で識別)
--  subscriptions / purchase_events は RLS でanon直書き禁止のため、
--  SECURITY DEFINER 関数経由でのみ書き込み/読み取りできるようにする。
--  ※本番はレシート検証(Edge Function / service_role)を挟むのが理想。
--    ここでは購読「状態の記録」を担う最小実装。
-- ============================================================

-- 購入を記録(購読をactiveにし、イベント履歴を残す)
create or replace function public.record_subscription(
  p_app_user_id text,
  p_plan text,
  p_product_id text,
  p_store text,
  p_period_end timestamptz,
  p_platform text default null,
  p_receipt jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users(app_user_id, platform)
  values (p_app_user_id::uuid, p_platform)
  on conflict (app_user_id) do nothing;

  insert into public.subscriptions(app_user_id, plan, status, store, product_id, current_period_end, updated_at)
  values (p_app_user_id, p_plan, 'active', p_store, p_product_id, p_period_end, now())
  on conflict (app_user_id) do update
    set plan = excluded.plan,
        status = 'active',
        store = excluded.store,
        product_id = excluded.product_id,
        current_period_end = excluded.current_period_end,
        updated_at = now();

  insert into public.purchase_events(app_user_id, store, product_id, event_type, raw_receipt)
  values (p_app_user_id, p_store, p_product_id, 'purchase', p_receipt);
end;
$$;

-- 現在の購読状態を取得
create or replace function public.get_subscription(p_app_user_id text)
returns table (
  plan text,
  status text,
  product_id text,
  store text,
  current_period_end timestamptz
)
language sql
security definer
set search_path = public
as $$
  select plan, status, product_id, store, current_period_end
  from public.subscriptions
  where app_user_id = p_app_user_id
  limit 1;
$$;

-- 解約(デモ/将来のキャンセルWebhook用)
create or replace function public.cancel_subscription(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
    set status = 'inactive', updated_at = now()
    where app_user_id = p_app_user_id;
  insert into public.purchase_events(app_user_id, event_type)
  values (p_app_user_id, 'cancel');
end;
$$;

grant execute on function public.record_subscription(text, text, text, text, timestamptz, text, jsonb) to anon, authenticated;
grant execute on function public.get_subscription(text) to anon, authenticated;
grant execute on function public.cancel_subscription(text) to anon, authenticated;
