-- 月度会员统计：后台统一保存，供手机与电脑共用。
CREATE TABLE IF NOT EXISTS public.admin_monthly_member_stats (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_monthly_member_stats (id, stats)
VALUES (true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._blys_monthly_stats_admin(p_admin_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_is_admin boolean;
BEGIN
  SELECT lower(trim(email)), coalesce(is_admin, false)
    INTO v_email, v_is_admin
  FROM public.profiles
  WHERE token = p_admin_token
  LIMIT 1;

  RETURN coalesce(v_is_admin, false)
    OR v_email IN ('491788533@qq.com', '491788533@gmail.com');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_monthly_member_stats(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats jsonb;
BEGIN
  IF NOT public._blys_monthly_stats_admin(p_admin_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT stats INTO v_stats
  FROM public.admin_monthly_member_stats
  WHERE id = true;

  RETURN jsonb_build_object('ok', true, 'stats', coalesce(v_stats, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_monthly_member_stats(
  p_admin_token text,
  p_stats jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT public._blys_monthly_stats_admin(p_admin_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT lower(trim(email)) INTO v_email
  FROM public.profiles
  WHERE token = p_admin_token
  LIMIT 1;

  INSERT INTO public.admin_monthly_member_stats (id, stats, updated_by, updated_at)
  VALUES (true, coalesce(p_stats, '{}'::jsonb), v_email, now())
  ON CONFLICT (id) DO UPDATE
    SET stats = excluded.stats,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_monthly_member_stats(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_monthly_member_stats(text, jsonb) TO anon, authenticated;
