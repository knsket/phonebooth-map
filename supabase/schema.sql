-- ============================================================
-- フォンブースマップ Supabase スキーマ
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行する
-- ============================================================

-- 位置情報拡張(現在地周辺検索に必要)
create extension if not exists postgis;

-- ------------------------------------------------------------
-- booths: フォンブース・マスタ
--  latitude/longitude を入れると location が自動生成される(生成列)
-- ------------------------------------------------------------
create table if not exists public.booths (
  booth_id   text primary key,           -- 元データの id
  brand      text not null,
  company    text,
  name       text not null,
  prefecture text,
  address    text,
  station    text,
  details    text,
  hours      text,
  count      text,
  price      text,
  url        text,
  latitude   double precision not null,
  longitude  double precision not null,
  location   geography(Point, 4326)
             generated always as
             (st_setsrid(st_makepoint(longitude, latitude), 4326)::geography) stored,
  created_at timestamptz not null default now()
);

-- 近傍検索を高速化する空間インデックス
create index if not exists booths_location_idx on public.booths using gist (location);
create index if not exists booths_brand_idx on public.booths (brand);

-- 公開読み取り(anonキーで select 可能、書き込みはサーバー側のみ)
alter table public.booths enable row level security;
drop policy if exists "booths public read" on public.booths;
create policy "booths public read" on public.booths for select using (true);

-- ------------------------------------------------------------
-- 現在地周辺のブースを近い順に返す RPC
--   p_brand が null なら全ブランド。規約非表示ブランドは呼び出し側で除外。
-- ------------------------------------------------------------
create or replace function public.booths_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision default 5000,
  p_limit integer default 100,
  p_brand text default null
)
returns table (
  booth_id text,
  brand text,
  company text,
  name text,
  prefecture text,
  address text,
  station text,
  details text,
  hours text,
  count text,
  price text,
  url text,
  latitude double precision,
  longitude double precision,
  distance_m double precision
)
language sql
stable
as $$
  select
    b.booth_id, b.brand, b.company, b.name, b.prefecture, b.address, b.station,
    b.details, b.hours, b.count, b.price, b.url, b.latitude, b.longitude,
    st_distance(b.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) as distance_m
  from public.booths b
  where st_dwithin(b.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
    and (p_brand is null or b.brand = p_brand)
  order by b.location <-> st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
  limit p_limit;
$$;

-- ============================================================
-- サブスクリプション(ログイン不要・端末単位の匿名IDで管理)
--  receipts/billing ダッシュボード用。書き込みは Edge Function(service_role)で行う想定。
-- ============================================================

-- 端末ごとの匿名ユーザー(アプリ初回起動時にUUIDを生成して保存)
create table if not exists public.app_users (
  app_user_id uuid primary key,          -- 端末で生成した匿名ID
  platform    text,                       -- ios / android / web
  created_at  timestamptz not null default now()
);

-- 現在の購読状態(1ユーザー1行)
create table if not exists public.subscriptions (
  app_user_id text primary key,
  plan        text,                       -- monthly / yearly
  status      text not null default 'inactive', -- active / expired / inactive
  store       text,                       -- app_store / play_store
  product_id  text,
  current_period_end timestamptz,
  updated_at  timestamptz not null default now()
);

-- レシート/イベント履歴(監査・突合用)
create table if not exists public.purchase_events (
  id          bigint generated always as identity primary key,
  app_user_id text,
  store       text,
  product_id  text,
  event_type  text,                       -- purchase / renew / cancel / refund
  raw_receipt jsonb,
  created_at  timestamptz not null default now()
);

-- これらはサーバー(service_role)経由でのみ更新。anonからは触らせない。
alter table public.subscriptions enable row level security;
alter table public.purchase_events enable row level security;
-- (RLSポリシーを作らない = anonは読み書き不可。Edge Functionのservice_roleはRLSをバイパス)
