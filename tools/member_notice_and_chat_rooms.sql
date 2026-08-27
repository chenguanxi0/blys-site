-- Split the member room into an admin-only notification room and a member chat room.
-- Room rules:
--   public   : normal group, popup targets are non-VIP users + admins.
--   vip      : member notification room, only admins can send, popup targets are VIP users + admins.
--   vip_chat : member chat room, VIP users/admins can send, popup targets are admins only.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.chat_announcements (
  room text PRIMARY KEY,
  content text NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_room_members (
  room text NOT NULL,
  user_email text NOT NULL,
  user_nickname text,
  first_seen timestamptz DEFAULT now(),
  last_seen timestamptz DEFAULT now(),
  PRIMARY KEY (room, user_email)
);

CREATE TABLE IF NOT EXISTS public.online_users (
  session_id text PRIMARY KEY,
  room text,
  last_seen timestamptz DEFAULT now(),
  user_email text,
  user_nickname text
);

ALTER TABLE public.online_users ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.online_users ADD COLUMN IF NOT EXISTS user_nickname text;
ALTER TABLE public.chat_room_members ADD COLUMN IF NOT EXISTS user_nickname text;
ALTER TABLE public.chat_room_members ADD COLUMN IF NOT EXISTS first_seen timestamptz DEFAULT now();
ALTER TABLE public.chat_room_members ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public._blys_is_admin_identity(p_email text, p_is_admin boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(p_is_admin, false)
      OR lower(coalesce(p_email, '')) IN ('491788533@qq.com', '491788533@gmail.com');
$$;

CREATE OR REPLACE FUNCTION public._blys_has_active_vip(p_vip_expire timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_vip_expire IS NOT NULL AND p_vip_expire > now();
$$;

CREATE OR REPLACE FUNCTION public.send_message(
  p_token text,
  p_room text,
  p_content text,
  p_image text DEFAULT NULL,
  p_reply_to_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_is_admin boolean := false;
  v_is_vip boolean := false;
  v_reply_id uuid;
  v_reply_nickname text;
  v_reply_content text;
  v_reply_image text;
  v_has_reply boolean := false;
  v_new_id uuid;
BEGIN
  SELECT email, nickname, vip_expire, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;

  v_is_admin := public._blys_is_admin_identity(v_user.email, v_user.is_admin);
  v_is_vip := public._blys_has_active_vip(v_user.vip_expire);

  IF v_room NOT IN ('public', 'vip', 'vip_chat') THEN
    RETURN jsonb_build_object('ok', false, 'msg', '不支持的群聊');
  END IF;

  IF v_room = 'vip' AND NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'msg', '会员通知群只有管理员可以发布消息');
  END IF;

  IF v_room = 'vip_chat' AND NOT (v_is_admin OR v_is_vip) THEN
    RETURN jsonb_build_object('ok', false, 'msg', 'VIP专属房间');
  END IF;

  IF p_reply_to_id IS NOT NULL THEN
    SELECT m.id, m.user_nickname, m.content, m.image
      INTO v_reply_id, v_reply_nickname, v_reply_content, v_reply_image
      FROM public.messages m
     WHERE m.id = p_reply_to_id
       AND m.room = v_room
       AND m.recalled_at IS NULL
     LIMIT 1;
    v_has_reply := FOUND;
  END IF;

  INSERT INTO public.messages (
    room, user_email, user_nickname, content, image,
    reply_to_id, reply_to_nickname, reply_to_content, reply_to_image, created_at
  )
  VALUES (
    v_room,
    v_user.email,
    coalesce(v_user.nickname, split_part(v_user.email, '@', 1)),
    nullif(btrim(coalesce(p_content, '')), ''),
    nullif(btrim(coalesce(p_image, '')), ''),
    CASE WHEN v_has_reply THEN v_reply_id ELSE NULL END,
    CASE WHEN v_has_reply THEN v_reply_nickname ELSE NULL END,
    CASE WHEN v_has_reply THEN v_reply_content ELSE NULL END,
    CASE WHEN v_has_reply THEN v_reply_image ELSE NULL END,
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_messages(
  p_room text,
  p_limit integer DEFAULT 100,
  p_after timestamptz DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_token text DEFAULT NULL
) RETURNS TABLE(
  id uuid,
  user_email text,
  user_nickname text,
  content text,
  image text,
  reply_to_id uuid,
  reply_to_nickname text,
  reply_to_content text,
  reply_to_image text,
  recalled_at timestamptz,
  created_at timestamptz,
  has_image boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
BEGIN
  IF v_room NOT IN ('public', 'vip', 'vip_chat') THEN
    RETURN;
  END IF;

  IF v_room IN ('vip', 'vip_chat') THEN
    SELECT email, vip_expire, is_admin
      INTO v_user
      FROM public.profiles
     WHERE token = p_token
     LIMIT 1;

    IF NOT FOUND OR (
      NOT public._blys_is_admin_identity(v_user.email, v_user.is_admin)
      AND NOT public._blys_has_active_vip(v_user.vip_expire)
    ) THEN
      RETURN;
    END IF;
  END IF;

  IF p_after IS NOT NULL THEN
    RETURN QUERY
    SELECT q.id, q.user_email, q.user_nickname, q.content, q.image,
           q.reply_to_id, q.reply_to_nickname, q.reply_to_content, q.reply_to_image,
           q.recalled_at, q.created_at, q.has_image
    FROM (
      SELECT
        m.id, m.user_email, m.user_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
        NULL::text AS image,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
        CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::text ELSE NULL::text END AS reply_to_image,
        m.recalled_at,
        m.created_at,
        (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
      FROM public.messages m
      WHERE m.room = v_room AND m.created_at > p_after

      UNION

      SELECT
        m.id, m.user_email, m.user_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
        NULL::text AS image,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
        CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::text ELSE NULL::text END AS reply_to_image,
        m.recalled_at,
        m.created_at,
        (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
      FROM public.messages m
      WHERE m.room = v_room AND m.recalled_at > p_after
    ) q
    ORDER BY q.created_at ASC
    LIMIT v_limit;
  ELSIF p_before IS NOT NULL THEN
    RETURN QUERY
    SELECT
      m.id, m.user_email, m.user_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
      NULL::text AS image,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
      CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::text ELSE NULL::text END AS reply_to_image,
      m.recalled_at,
      m.created_at,
      (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.messages m
    WHERE m.room = v_room AND m.created_at < p_before
    ORDER BY m.created_at DESC
    LIMIT v_limit;
  ELSE
    RETURN QUERY
    SELECT
      m.id, m.user_email, m.user_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
      NULL::text AS image,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
      CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::text ELSE NULL::text END AS reply_to_image,
      m.recalled_at,
      m.created_at,
      (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.messages m
    WHERE m.room = v_room
    ORDER BY m.created_at DESC
    LIMIT v_limit;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_message_image(
  p_token text,
  p_message_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_msg record;
BEGIN
  SELECT email, vip_expire, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;

  SELECT id, room, image, recalled_at
    INTO v_msg
    FROM public.messages
   WHERE id = p_message_id
   LIMIT 1;

  IF NOT FOUND OR v_msg.recalled_at IS NOT NULL OR v_msg.image IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'msg', '图片不存在');
  END IF;

  IF v_msg.room IN ('vip', 'vip_chat')
     AND NOT public._blys_is_admin_identity(v_user.email, v_user.is_admin)
     AND NOT public._blys_has_active_vip(v_user.vip_expire) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '会员专属图片');
  END IF;

  RETURN jsonb_build_object('ok', true, 'image', v_msg.image);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_announcement(p_room text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room text := lower(btrim(coalesce(p_room, '')));
  v_content text;
BEGIN
  IF v_room NOT IN ('public', 'vip') THEN
    RETURN jsonb_build_object('ok', false, 'msg', '不支持的群公告');
  END IF;

  SELECT content
    INTO v_content
    FROM public.chat_announcements
   WHERE room = v_room
   LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'room', v_room,
    'content', coalesce(v_content, CASE
      WHEN v_room = 'vip' THEN '会员通知群仅管理员发布操作与重要提醒。'
      ELSE '普通群文明交流，禁止荐股与广告；重要通知会在这里置顶。'
    END)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_chat_announcement(
  p_token text,
  p_room text,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, '')));
  v_content text := btrim(coalesce(p_content, ''));
BEGIN
  IF v_room NOT IN ('public', 'vip') THEN
    RETURN jsonb_build_object('ok', false, 'msg', '只支持普通群和会员通知群公告');
  END IF;

  SELECT email, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND OR NOT public._blys_is_admin_identity(v_user.email, v_user.is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '只有管理员可以编辑群公告');
  END IF;

  IF length(v_content) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '公告内容不能为空');
  END IF;

  IF length(v_content) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '公告最多 500 个字');
  END IF;

  INSERT INTO public.chat_announcements (room, content, updated_by, created_at, updated_at)
  VALUES (v_room, v_content, v_user.email, now(), now())
  ON CONFLICT (room) DO UPDATE SET
    content = excluded.content,
    updated_by = excluded.updated_by,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'room', v_room, 'content', v_content);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat(p_session text, p_room text DEFAULT NULL, p_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_can_touch_member boolean := true;
BEGIN
  IF p_token IS NOT NULL THEN
    SELECT email, nickname, vip_expire, is_admin
      INTO v_user
      FROM public.profiles
     WHERE token = p_token
     LIMIT 1;
  END IF;

  IF v_room NOT IN ('public', 'vip', 'vip_chat', 'private') THEN
    v_room := 'public';
  END IF;

  IF v_room IN ('vip', 'vip_chat')
     AND v_user.email IS NOT NULL
     AND NOT (
       public._blys_is_admin_identity(v_user.email, v_user.is_admin)
       OR public._blys_has_active_vip(v_user.vip_expire)
     ) THEN
    v_can_touch_member := false;
    DELETE FROM public.chat_room_members
     WHERE room IN ('vip', 'vip_chat')
       AND lower(user_email) = lower(v_user.email);
  END IF;

  INSERT INTO public.online_users (session_id, room, last_seen, user_email, user_nickname)
  VALUES (
    p_session,
    CASE WHEN v_room IN ('vip', 'vip_chat') AND NOT v_can_touch_member THEN 'public' ELSE v_room END,
    now(),
    v_user.email,
    v_user.nickname
  )
  ON CONFLICT (session_id) DO UPDATE
  SET room = excluded.room,
      last_seen = now(),
      user_email = coalesce(excluded.user_email, public.online_users.user_email),
      user_nickname = coalesce(excluded.user_nickname, public.online_users.user_nickname);

  IF v_user.email IS NOT NULL
     AND v_room IS NOT NULL
     AND v_room <> 'private'
     AND v_can_touch_member THEN
    INSERT INTO public.chat_room_members (room, user_email, user_nickname, first_seen, last_seen)
    VALUES (v_room, v_user.email, coalesce(v_user.nickname, split_part(v_user.email, '@', 1)), now(), now())
    ON CONFLICT (room, user_email) DO UPDATE
    SET user_nickname = coalesce(excluded.user_nickname, public.chat_room_members.user_nickname),
        last_seen = now();
  END IF;

  DELETE FROM public.online_users WHERE last_seen < now() - interval '3 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_room_members(p_room text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_total int;
  v_online int;
  v_list jsonb;
BEGIN
  IF v_room IN ('vip', 'vip_chat') THEN
    DELETE FROM public.chat_room_members m
    USING public.profiles p
    WHERE m.room = v_room
      AND lower(p.email) = lower(m.user_email)
      AND NOT (
        public._blys_is_admin_identity(p.email, p.is_admin)
        OR public._blys_has_active_vip(p.vip_expire)
      );
  END IF;

  SELECT count(*) INTO v_total
  FROM public.chat_room_members m
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = v_room
    AND (
      v_room NOT IN ('vip', 'vip_chat')
      OR public._blys_is_admin_identity(p.email, p.is_admin)
      OR public._blys_has_active_vip(p.vip_expire)
    );

  SELECT count(distinct m.user_email) INTO v_online
  FROM public.chat_room_members m
  JOIN public.online_users o ON lower(o.user_email) = lower(m.user_email) AND o.room = v_room
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = v_room
    AND o.last_seen > now() - interval '2 minutes'
    AND (
      v_room NOT IN ('vip', 'vip_chat')
      OR public._blys_is_admin_identity(p.email, p.is_admin)
      OR public._blys_has_active_vip(p.vip_expire)
    );

  SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_list
  FROM (
    SELECT
      m.user_email AS email,
      coalesce(p.nickname, m.user_nickname, split_part(m.user_email, '@', 1)) AS nickname,
      m.last_seen,
      EXISTS (
        SELECT 1 FROM public.online_users o
        WHERE lower(o.user_email) = lower(m.user_email)
          AND o.room = v_room
          AND o.last_seen > now() - interval '2 minutes'
      ) AS online,
      coalesce(p.is_admin, false) AS is_admin
    FROM public.chat_room_members m
    LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
    WHERE m.room = v_room
      AND (
        v_room NOT IN ('vip', 'vip_chat')
        OR public._blys_is_admin_identity(p.email, p.is_admin)
        OR public._blys_has_active_vip(p.vip_expire)
      )
    ORDER BY online DESC, coalesce(p.is_admin, false) DESC, m.last_seen DESC
    LIMIT 60
  ) x;

  RETURN jsonb_build_object('ok', true, 'total', coalesce(v_total, 0), 'online', coalesce(v_online, 0), 'list', v_list);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_room_member_counts(p_room text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_total int;
  v_online int;
BEGIN
  IF v_room IN ('vip', 'vip_chat') THEN
    DELETE FROM public.chat_room_members m
    USING public.profiles p
    WHERE m.room = v_room
      AND lower(p.email) = lower(m.user_email)
      AND NOT (
        public._blys_is_admin_identity(p.email, p.is_admin)
        OR public._blys_has_active_vip(p.vip_expire)
      );
  END IF;

  SELECT count(*) INTO v_total
  FROM public.chat_room_members m
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = v_room
    AND (
      v_room NOT IN ('vip', 'vip_chat')
      OR public._blys_is_admin_identity(p.email, p.is_admin)
      OR public._blys_has_active_vip(p.vip_expire)
    );

  SELECT count(distinct m.user_email) INTO v_online
  FROM public.chat_room_members m
  JOIN public.online_users o ON lower(o.user_email) = lower(m.user_email) AND o.room = v_room
  LEFT JOIN public.profiles p ON lower(p.email) = lower(m.user_email)
  WHERE m.room = v_room
    AND o.last_seen > now() - interval '2 minutes'
    AND (
      v_room NOT IN ('vip', 'vip_chat')
      OR public._blys_is_admin_identity(p.email, p.is_admin)
      OR public._blys_has_active_vip(p.vip_expire)
    );

  RETURN jsonb_build_object('ok', true, 'total', coalesce(v_total, 0), 'online', coalesce(v_online, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_push_targets(
  p_token text,
  p_room text
) RETURNS TABLE(
  endpoint text,
  subscription jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_sender_is_admin boolean := false;
  v_sender_is_vip boolean := false;
BEGIN
  SELECT email, vip_expire, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_sender_is_admin := public._blys_is_admin_identity(v_user.email, v_user.is_admin);
  v_sender_is_vip := public._blys_has_active_vip(v_user.vip_expire);

  IF v_room NOT IN ('public', 'vip', 'vip_chat') THEN
    RETURN;
  END IF;

  IF v_room = 'vip' AND NOT v_sender_is_admin THEN
    RETURN;
  END IF;

  IF v_room = 'vip_chat' AND NOT (v_sender_is_admin OR v_sender_is_vip) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ps.user_token, coalesce(ps.user_agent, '')) ps.endpoint, ps.subscription
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE ps.user_token <> p_token
    AND (
      (v_room = 'public' AND (
        public._blys_is_admin_identity(p.email, p.is_admin)
        OR NOT public._blys_has_active_vip(p.vip_expire)
      ))
      OR (v_room = 'vip' AND (
        public._blys_is_admin_identity(p.email, p.is_admin)
        OR public._blys_has_active_vip(p.vip_expire)
      ))
      OR (v_room = 'vip_chat' AND public._blys_is_admin_identity(p.email, p.is_admin))
    )
  ORDER BY ps.user_token, coalesce(ps.user_agent, ''), ps.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_native_push_targets(
  p_token text,
  p_room text
) RETURNS TABLE(
  device_token text,
  platform text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_room text := lower(btrim(coalesce(p_room, 'public')));
  v_sender_is_admin boolean := false;
  v_sender_is_vip boolean := false;
BEGIN
  SELECT email, vip_expire, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_sender_is_admin := public._blys_is_admin_identity(v_user.email, v_user.is_admin);
  v_sender_is_vip := public._blys_has_active_vip(v_user.vip_expire);

  IF v_room NOT IN ('public', 'vip', 'vip_chat') THEN
    RETURN;
  END IF;

  IF v_room = 'vip' AND NOT v_sender_is_admin THEN
    RETURN;
  END IF;

  IF v_room = 'vip_chat' AND NOT (v_sender_is_admin OR v_sender_is_vip) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (npt.user_token, npt.platform) npt.device_token, npt.platform
  FROM public.native_push_tokens npt
  JOIN public.profiles p ON p.token = npt.user_token
  WHERE npt.user_token <> p_token
    AND (
      (v_room = 'public' AND (
        public._blys_is_admin_identity(p.email, p.is_admin)
        OR NOT public._blys_has_active_vip(p.vip_expire)
      ))
      OR (v_room = 'vip' AND (
        public._blys_is_admin_identity(p.email, p.is_admin)
        OR public._blys_has_active_vip(p.vip_expire)
      ))
      OR (v_room = 'vip_chat' AND public._blys_is_admin_identity(p.email, p.is_admin))
    )
  ORDER BY npt.user_token, npt.platform, npt.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_chat_push_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_token text;
  v_body jsonb;
  v_headers jsonb;
BEGIN
  IF NEW.room NOT IN ('public', 'vip', 'vip_chat') THEN
    RETURN NEW;
  END IF;

  SELECT token
    INTO v_sender_token
    FROM public.profiles
   WHERE lower(email) = lower(NEW.user_email)
   LIMIT 1;

  IF v_sender_token IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := jsonb_build_object(
    'token', v_sender_token,
    'room', NEW.room,
    'content', coalesce(NEW.content, ''),
    'image', NEW.image IS NOT NULL
  );

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', 'sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV',
    'Authorization', 'Bearer sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV'
  );

  PERFORM net.http_post(
    url := 'https://ojioiglffglyuellvcex.supabase.co/functions/v1/notify-chat',
    headers := v_headers,
    body := v_body,
    timeout_milliseconds := 5000
  );

  PERFORM net.http_post(
    url := 'https://ojioiglffglyuellvcex.supabase.co/functions/v1/notify-native-chat',
    headers := v_headers,
    body := v_body,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_push_after_insert ON public.messages;
CREATE TRIGGER trg_chat_push_after_insert
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.trigger_chat_push_after_insert();

GRANT EXECUTE ON FUNCTION public._blys_is_admin_identity(text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._blys_has_active_vip(timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(text, text, text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_messages(text, integer, timestamptz, timestamptz, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_message_image(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_announcement(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_chat_announcement(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_room_members(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_room_member_counts(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_push_targets(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_native_push_targets(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
