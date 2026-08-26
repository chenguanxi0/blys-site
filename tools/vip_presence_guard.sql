-- 修复会员群成员/在线列表误显示非会员的问题
-- 说明：这只影响会员群“成员统计/在线列表”的展示，不会放开会员群消息权限。

CREATE OR REPLACE FUNCTION public.heartbeat(p_session text, p_room text DEFAULT NULL, p_token text DEFAULT NULL)
RETURNS void AS $$
DECLARE
  v_user record;
  v_can_touch_member boolean := true;
BEGIN
  IF p_token IS NOT NULL THEN
    SELECT email, nickname, vip_expire, is_admin INTO v_user
    FROM public.profiles
    WHERE token = p_token;
  END IF;

  IF p_room = 'vip'
     AND v_user.email IS NOT NULL
     AND NOT (
       COALESCE(v_user.is_admin, false)
       OR (v_user.vip_expire IS NOT NULL AND v_user.vip_expire > now())
     ) THEN
    v_can_touch_member := false;
    DELETE FROM public.chat_room_members
    WHERE room = 'vip' AND lower(user_email) = lower(v_user.email);
  END IF;

  INSERT INTO public.online_users (session_id, room, last_seen, user_email, user_nickname)
  VALUES (
    p_session,
    CASE WHEN p_room = 'vip' AND NOT v_can_touch_member THEN 'public' ELSE p_room END,
    now(),
    v_user.email,
    v_user.nickname
  )
  ON CONFLICT (session_id) DO UPDATE
  SET room = excluded.room,
      last_seen = now(),
      user_email = COALESCE(excluded.user_email, public.online_users.user_email),
      user_nickname = COALESCE(excluded.user_nickname, public.online_users.user_nickname);

  IF v_user.email IS NOT NULL
     AND p_room IS NOT NULL
     AND p_room <> 'private'
     AND v_can_touch_member THEN
    INSERT INTO public.chat_room_members (room, user_email, user_nickname, first_seen, last_seen)
    VALUES (p_room, v_user.email, COALESCE(v_user.nickname, split_part(v_user.email, '@', 1)), now(), now())
    ON CONFLICT (room, user_email) DO UPDATE
    SET user_nickname = COALESCE(excluded.user_nickname, public.chat_room_members.user_nickname),
        last_seen = now();
  END IF;

  DELETE FROM public.online_users WHERE last_seen < now() - interval '3 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_room_members(p_room text)
RETURNS jsonb AS $$
DECLARE
  v_total int;
  v_online int;
  v_list jsonb;
BEGIN
  IF p_room = 'vip' THEN
    DELETE FROM public.chat_room_members m
    USING public.profiles p
    WHERE m.room = 'vip'
      AND lower(p.email) = lower(m.user_email)
      AND NOT (
        COALESCE(p.is_admin, false)
        OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
      );
  END IF;

  SELECT count(*) INTO v_total
  FROM public.chat_room_members m
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = p_room
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    );

  SELECT count(distinct m.user_email) INTO v_online
  FROM public.chat_room_members m
  JOIN public.online_users o ON lower(o.user_email) = lower(m.user_email) AND o.room = p_room
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = p_room
    AND o.last_seen > now() - interval '2 minutes'
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    );

  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_list
  FROM (
    SELECT
      m.user_email AS email,
      COALESCE(p.nickname, m.user_nickname, split_part(m.user_email, '@', 1)) AS nickname,
      m.last_seen,
      EXISTS (
        SELECT 1 FROM public.online_users o
        WHERE lower(o.user_email) = lower(m.user_email)
          AND o.room = p_room
          AND o.last_seen > now() - interval '2 minutes'
      ) AS online,
      COALESCE(p.is_admin, false) AS is_admin
    FROM public.chat_room_members m
    LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
    WHERE m.room = p_room
      AND (
        p_room <> 'vip'
        OR COALESCE(p.is_admin, false)
        OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
      )
    ORDER BY online DESC, COALESCE(p.is_admin, false) DESC, m.last_seen DESC
    LIMIT 60
  ) x;

  RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total, 0), 'online', COALESCE(v_online, 0), 'list', v_list);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_room_member_counts(p_room text)
RETURNS jsonb AS $$
DECLARE
  v_total int;
  v_online int;
BEGIN
  IF p_room = 'vip' THEN
    DELETE FROM public.chat_room_members m
    USING public.profiles p
    WHERE m.room = 'vip'
      AND lower(p.email) = lower(m.user_email)
      AND NOT (
        COALESCE(p.is_admin, false)
        OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
      );
  END IF;

  SELECT count(*) INTO v_total
  FROM public.chat_room_members m
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = p_room
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    );

  SELECT count(distinct m.user_email) INTO v_online
  FROM public.chat_room_members m
  JOIN public.online_users o ON lower(o.user_email) = lower(m.user_email) AND o.room = p_room
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = p_room
    AND o.last_seen > now() - interval '2 minutes'
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    );

  RETURN jsonb_build_object('ok', true, 'total', COALESCE(v_total, 0), 'online', COALESCE(v_online, 0));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DELETE FROM public.chat_room_members m
USING public.profiles p
WHERE m.room = 'vip'
  AND lower(p.email) = lower(m.user_email)
  AND NOT (
    COALESCE(p.is_admin, false)
    OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
  );

GRANT EXECUTE ON FUNCTION public.heartbeat(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_room_members(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_room_member_counts(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
