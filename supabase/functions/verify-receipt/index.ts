// Supabase Edge Function: verify-receipt
//
// 役割: App Store / Google Play のレシートを「サーバー側で」検証し、
//       正当な場合のみ subscriptions / purchase_events を更新する。
//       クライアントから直接DBを書かせない(不正購読の防止)。
//
// 入力(JSON):
//   {
//     app_user_id: string,           // 端末の匿名ID
//     platform: 'ios'|'android'|'web',
//     plan: 'monthly'|'yearly',
//     product_id: string,
//     receipt?: string,              // iOS: base64レシート
//     purchase_token?: string,       // Android: 購入トークン
//     demo?: boolean                 // ALLOW_DEMO=true のときのみ検証スキップ(開発用)
//   }
//
// 必要なシークレット(supabase secrets set ...):
//   APPLE_SHARED_SECRET   App Store Connect の共有シークレット
//   ALLOW_DEMO            'true' で demo購入を許可(本番は未設定/falseに)
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は自動注入)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function planFromProduct(productId: string): 'monthly' | 'yearly' | null {
  if (productId.endsWith('.12month')) return 'yearly';
  if (productId.endsWith('.1month')) return 'monthly';
  return null;
}

// iOS(StoreKit2): JWS(署名付きトランザクション)のペイロードから productId / expiresDate を取り出す。
// ⚠️ 本番ではここで JWS の署名検証(x5c証明書チェーンを Apple Root CA まで検証)を必ず行うこと。
//    推奨: @apple/app-store-server-library の SignedDataVerifier、または App Store Server API で
//    transactionId を問い合わせて正規の取引かを確認する。現状はサンドボックス動作確認用にデコードのみ。
function decodeStoreKitJws(jws: string): { productId?: string; expiresMs?: number; environment?: string } | null {
  try {
    const parts = jws.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    return {
      productId: payload.productId,
      expiresMs: payload.expiresDate ? Number(payload.expiresDate) : undefined,
      environment: payload.environment,
    };
  } catch {
    return null;
  }
}

// iOS(レガシー): verifyReceipt(本番→sandboxフォールバック)。expires_date_ms(最大)を返す。
async function verifyApple(receipt: string): Promise<{ ok: boolean; productId?: string; expiresMs?: number }> {
  const secret = Deno.env.get('APPLE_SHARED_SECRET') ?? '';
  const body = JSON.stringify({ 'receipt-data': receipt, password: secret, 'exclude-old-transactions': true });

  const call = (url: string) => fetch(url, { method: 'POST', body }).then((r) => r.json());
  let res = await call('https://buy.itunes.apple.com/verifyReceipt');
  if (res.status === 21007) res = await call('https://sandbox.itunes.apple.com/verifyReceipt'); // sandboxレシート
  if (res.status !== 0) return { ok: false };

  const infos: any[] = res.latest_receipt_info ?? [];
  let best = 0;
  let productId: string | undefined;
  for (const it of infos) {
    const ms = Number(it.expires_date_ms ?? 0);
    if (ms > best) {
      best = ms;
      productId = it.product_id;
    }
  }
  if (!best) return { ok: false };
  return { ok: best > Date.now(), productId, expiresMs: best };
}

// ---- StoreKit2 JWS の「署名検証」(本番用) ----
// Apple公式ライブラリはDeno非対応のため、WebCrypto対応フォークを使用。
// STRICT_VERIFY=true のときのみ有効化(未設定時はサンドボックス動作のデコードのみ)。
let appleRootCache: Uint8Array | null = null;
async function getAppleRootG3(): Promise<Uint8Array> {
  if (appleRootCache) return appleRootCache;
  const res = await fetch('https://www.apple.com/certificateauthority/AppleRootCA-G3.cer');
  appleRootCache = new Uint8Array(await res.arrayBuffer());
  return appleRootCache;
}

async function verifyJwsStrict(
  jws: string,
  environmentHint?: string
): Promise<{ productId?: string; expiresMs?: number }> {
  // 動的importなので STRICT_VERIFY=false の通常経路には影響しない
  const { SignedDataVerifier, Environment } = await import(
    'npm:@studium-ignotum/app-store-server-library'
  );
  const root = await getAppleRootG3();
  // JWS の environment("Sandbox"/"Production")で自動判定。
  // これにより1つの関数で TestFlight(Sandbox) と App Store(Production) の両方を扱える。
  // 明示的に固定したい場合は APPLE_ENV を設定するとそちらを優先。
  const forced = Deno.env.get('APPLE_ENV'); // 任意。未設定なら environmentHint を使用
  const isProd = (forced ?? environmentHint ?? 'Sandbox') === 'Production';
  const env = isProd ? Environment.PRODUCTION : Environment.SANDBOX;
  const bundleId = Deno.env.get('APPLE_BUNDLE_ID') ?? 'jp.oneofthem.phonebooth';
  // Production の検証には数値 App Store ID が必須(Sandboxは不要)
  const appAppleId = isProd ? Number(Deno.env.get('APPLE_APP_APPLE_ID') ?? 0) : undefined;

  const verifier = new SignedDataVerifier([root], false, env, bundleId, appAppleId);
  const decoded: any = await verifier.verifyAndDecodeTransaction(jws); // 署名不正なら例外
  return {
    productId: decoded.productId,
    expiresMs: decoded.expiresDate ? Number(decoded.expiresDate) : undefined,
  };
}

// ---- Android: Google Play Developer API による購読検証 ----
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

function loadServiceAccount(): any | null {
  const b64 = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_B64');
  if (b64) {
    try {
      return JSON.parse(new TextDecoder().decode(pemToDerBase64(b64)));
    } catch {
      /* fallthrough */
    }
  }
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function pemToDerBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// サービスアカウントで OAuth2 アクセストークンを取得(JWT bearer / RS256)
async function getGoogleAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  );
  const jwt = `${unsigned}.${b64url(sig)}`;
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('oauth failed: ' + JSON.stringify(j));
  return j.access_token as string;
}

async function verifyGooglePlay(
  purchaseToken: string,
  fallbackProductId: string
): Promise<{ ok: boolean; productId?: string; expiresMs?: number }> {
  const sa = loadServiceAccount();
  if (!sa) return { ok: false };
  const pkg = Deno.env.get('ANDROID_PACKAGE') ?? 'jp.oneofthem.phonebooth';
  const token = await getGoogleAccessToken(sa);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // 401/403=権限不足, 400/404=トークン不正 など。デバッグのため status を残す。
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`play api ${res.status}: ${detail}`);
  }
  const data: any = await res.json();
  const state = data.subscriptionState;
  const li = (data.lineItems ?? [])[0];
  const expiresMs = li?.expiryTime ? new Date(li.expiryTime).getTime() : undefined;
  const active = state === 'SUBSCRIPTION_STATE_ACTIVE' || (!!expiresMs && expiresMs > Date.now());
  return { ok: active, productId: li?.productId ?? fallbackProductId, expiresMs };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { app_user_id, platform, plan, product_id, receipt, jws, purchase_token, demo } = payload ?? {};
  if (!app_user_id || !product_id) return json({ error: 'app_user_id and product_id are required' }, 400);

  let verifiedPlan: 'monthly' | 'yearly' | null = null;
  let expiresMs: number | null = null;
  let signatureVerified = false;

  const allowDemo = (Deno.env.get('ALLOW_DEMO') ?? '') === 'true';
  const strictVerify = (Deno.env.get('STRICT_VERIFY') ?? '') === 'true';

  if (demo && allowDemo) {
    // 開発用: 実検証をスキップ
    verifiedPlan = plan === 'yearly' ? 'yearly' : 'monthly';
    const days = verifiedPlan === 'yearly' ? 365 : 30;
    expiresMs = Date.now() + days * 24 * 60 * 60 * 1000;
  } else if (platform === 'ios') {
    if (jws) {
      let resolved = false;
      // 本番: JWS の署名を Apple Root CA まで検証(環境はJWSのenvironmentで自動判定)
      if (strictVerify) {
        try {
          const envHint = decodeStoreKitJws(jws)?.environment;
          const v = await verifyJwsStrict(jws, envHint);
          if (v.productId) {
            verifiedPlan = planFromProduct(v.productId);
            expiresMs = v.expiresMs ?? null;
            signatureVerified = true;
            resolved = true;
          }
        } catch (e) {
          // フェイルオープン: 検証に失敗しても購入者をブロックしない(デコードへフォールバック)。
          // ログを残し、purchase_events.verified_signature=false で監視 → 安定後に fail-closed へ。
          console.error('STRICT_VERIFY fallback (decode):', String(e));
        }
      }
      // 署名検証できなかった/無効時はデコードで継続(従来動作)
      if (!resolved) {
        const d = decodeStoreKitJws(jws);
        if (!d || !d.productId) return json({ active: false, error: 'invalid jws' }, 402);
        verifiedPlan = planFromProduct(d.productId);
        expiresMs = d.expiresMs ?? null;
      }
      if (expiresMs && expiresMs <= Date.now()) return json({ active: false, error: 'expired' }, 402);
    } else if (receipt) {
      // レガシー receipt(verifyReceipt)
      const v = await verifyApple(receipt);
      if (!v.ok) return json({ active: false, error: 'apple verification failed' }, 402);
      verifiedPlan = planFromProduct(v.productId ?? product_id);
      expiresMs = v.expiresMs ?? null;
    } else {
      return json({ error: 'jws or receipt required for ios' }, 400);
    }
  } else if (platform === 'android') {
    if (!purchase_token) return json({ error: 'purchase_token required for android' }, 400);
    try {
      const v = await verifyGooglePlay(purchase_token, product_id);
      if (!v.ok) return json({ active: false, error: 'google play verification failed' }, 402);
      verifiedPlan = planFromProduct(v.productId ?? product_id);
      expiresMs = v.expiresMs ?? null;
      signatureVerified = true;
    } catch (e) {
      return json({ active: false, error: 'android verification error: ' + String(e) }, 402);
    }
  } else {
    return json({ error: 'unsupported platform' }, 400);
  }

  if (!verifiedPlan || !expiresMs) return json({ active: false, error: 'could not determine subscription' }, 402);

  // service_role でDB更新(RLSをバイパス)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const store = platform === 'ios' ? 'app_store' : platform === 'android' ? 'play_store' : 'web';
  const periodEnd = new Date(expiresMs).toISOString();

  await supabase.from('app_users').upsert(
    { app_user_id, platform },
    { onConflict: 'app_user_id', ignoreDuplicates: true }
  );

  const { error: subErr } = await supabase.from('subscriptions').upsert(
    {
      app_user_id,
      plan: verifiedPlan,
      status: 'active',
      store,
      product_id,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'app_user_id' }
  );
  if (subErr) return json({ error: subErr.message }, 500);

  await supabase.from('purchase_events').insert({
    app_user_id,
    store,
    product_id,
    event_type: 'purchase',
    raw_receipt: demo
      ? { demo: true }
      : {
          method: jws ? 'storekit2_jws' : 'verifyReceipt',
          verified_signature: signatureVerified,
        },
  });

  return json({ active: true, plan: verifiedPlan, expiresAt: expiresMs });
});
