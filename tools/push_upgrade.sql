-- Web Push 通知升级 SQL
-- 用途：保存浏览器 Push Subscription，供 Supabase Edge Function notify-chat 读取并推送
-- 执行位置：Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_token TEXT NOT NULL REFERENCES public.profiles(token) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_token
  ON public.push_subscriptions(user_token);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 不开放直读，前端只通过 SECURITY DEFINER RPC 保存/删除自己的订阅。
DROP POLICY IF EXISTS push_subscriptions_no_direct_read ON public.push_subscriptions;
CREATE POLICY push_subscriptions_no_direct_read
  ON public.push_subscriptions
  FOR SELECT
  USING (false);

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_token TEXT,
  p_subscription JSONB,
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_endpoint TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE token = p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;

  v_endpoint := p_subscription->>'endpoint';
  IF v_endpoint IS NULL OR length(v_endpoint) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '订阅信息无效');
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_token = p_token
    AND COALESCE(user_agent, '') = COALESCE(p_user_agent, '')
    AND endpoint <> v_endpoint;

  INSERT INTO public.push_subscriptions(endpoint, user_token, subscription, user_agent, created_at, updated_at, last_seen_at)
  VALUES (v_endpoint, p_token, p_subscription, p_user_agent, now(), now(), now())
  ON CONFLICT (endpoint) DO UPDATE SET
    user_token = EXCLUDED.user_token,
    subscription = EXCLUDED.subscription,
    user_agent = EXCLUDED.user_agent,
    updated_at = now(),
    last_seen_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(
  p_token TEXT,
  p_endpoint TEXT
) RETURNS JSONB AS $$
BEGIN
  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint AND user_token = p_token;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_chat_push_targets(
  p_token TEXT,
  p_room TEXT
) RETURNS TABLE(
  endpoint TEXT,
  subscription JSONB
) AS $$
DECLARE
  v_user public.profiles%rowtype;
  v_sender_is_admin boolean := false;
BEGIN
  SELECT * INTO v_user FROM public.profiles WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_sender_is_admin := COALESCE(v_user.is_admin, false)
    OR lower(COALESCE(v_user.email, '')) IN ('491788533@qq.com', '491788533@gmail.com');

  IF p_room = 'vip' AND NOT (
    v_sender_is_admin
    OR (v_user.vip_expire IS NOT NULL AND v_user.vip_expire > now())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ps.user_token, COALESCE(ps.user_agent, '')) ps.endpoint, ps.subscription
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE (v_sender_is_admin OR ps.user_token <> p_token)
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR lower(COALESCE(p.email, '')) IN ('491788533@qq.com', '491788533@gmail.com')
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    )
  ORDER BY ps.user_token, COALESCE(ps.user_agent, ''), ps.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_push_subscriptions_for_user(
  p_token TEXT
) RETURNS JSONB AS $$
BEGIN
  DELETE FROM public.push_subscriptions
  WHERE user_token = p_token;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_push_subscription_by_endpoint(
  p_endpoint TEXT
) RETURNS JSONB AS $$
BEGIN
  DELETE FROM public.push_subscriptions
  WHERE endpoint = p_endpoint;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
