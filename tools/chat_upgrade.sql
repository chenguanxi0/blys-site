-- 聊天室升级 SQL：图片消息 + 引用回复 + 在线人数
-- 在 Supabase SQL Editor 中执行一次即可

-- 1. messages 表增加图片与引用字段
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_nickname TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_image TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;

-- 2. 改造 send_message，支持可选图片与引用参数
DROP FUNCTION IF EXISTS send_message(text, text, text);
DROP FUNCTION IF EXISTS send_message(text, text, text, text);
DROP FUNCTION IF EXISTS send_message(text, text, text, text, uuid);
CREATE OR REPLACE FUNCTION send_message(
  p_token TEXT,
  p_room TEXT,
  p_content TEXT,
  p_image TEXT DEFAULT NULL,
  p_reply_to_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_user RECORD;
  v_reply_id UUID;
  v_reply_nickname TEXT;
  v_reply_content TEXT;
  v_reply_image TEXT;
  v_has_reply BOOLEAN := false;
  v_new_id UUID;
BEGIN
  SELECT email, nickname, vip_expire INTO v_user FROM profiles WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'msg', '请先登录'); END IF;
  IF p_room = 'vip' AND (v_user.vip_expire IS NULL OR v_user.vip_expire <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'msg', 'VIP专属房间');
  END IF;
  IF p_reply_to_id IS NOT NULL THEN
    SELECT m.id, m.user_nickname, m.content, m.image
    INTO v_reply_id, v_reply_nickname, v_reply_content, v_reply_image
    FROM messages m
    WHERE m.id = p_reply_to_id AND m.room = p_room AND m.recalled_at IS NULL;
    v_has_reply := FOUND;
  END IF;
  INSERT INTO messages (room, user_email, user_nickname, content, image, reply_to_id, reply_to_nickname, reply_to_content, reply_to_image, created_at)
  VALUES (
    p_room,
    v_user.email,
    COALESCE(v_user.nickname, split_part(v_user.email,'@',1)),
    NULLIF(trim(p_content), ''),
    NULLIF(trim(p_image), ''),
    CASE WHEN v_has_reply THEN v_reply_id ELSE NULL END,
    CASE WHEN v_has_reply THEN v_reply_nickname ELSE NULL END,
    CASE WHEN v_has_reply THEN v_reply_content ELSE NULL END,
    CASE WHEN v_has_reply THEN v_reply_image ELSE NULL END,
    now()
  )
  RETURNING id INTO v_new_id;
  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 增加撤回时间字段
-- （已在上方统一补充，避免重复执行时报错）

-- 4. 撤回自己的消息：发送后2分钟内允许撤回
DROP FUNCTION IF EXISTS recall_message(text, uuid);
CREATE OR REPLACE FUNCTION recall_message(p_token TEXT, p_message_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_user RECORD;
  v_message RECORD;
BEGIN
  SELECT email INTO v_user FROM profiles WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'msg', '请先登录'); END IF;

  SELECT id, user_email, created_at, recalled_at
  INTO v_message
  FROM messages
  WHERE id = p_message_id;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'msg', '消息不存在'); END IF;
  IF v_message.user_email <> v_user.email THEN
    RETURN jsonb_build_object('ok', false, 'msg', '只能撤回自己的消息');
  END IF;
  IF v_message.recalled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'msg', '消息已经撤回');
  END IF;
  IF v_message.created_at < now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'msg', '消息已超过2分钟，不能撤回');
  END IF;

  UPDATE messages
  SET recalled_at = now(), content = NULL, image = NULL,
      reply_to_id = NULL, reply_to_nickname = NULL,
      reply_to_content = NULL, reply_to_image = NULL
  WHERE id = p_message_id;
  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 改造 list_messages，返回图片与引用字段，并支持增量拉取
DROP FUNCTION IF EXISTS list_messages(text);
DROP FUNCTION IF EXISTS list_messages(text, integer);
CREATE OR REPLACE FUNCTION list_messages(p_room TEXT, p_limit INTEGER DEFAULT 100, p_after TIMESTAMPTZ DEFAULT NULL, p_before TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE(
  id UUID,
  user_email TEXT,
  user_nickname TEXT,
  content TEXT,
  image TEXT,
  reply_to_id UUID,
  reply_to_nickname TEXT,
  reply_to_content TEXT,
  reply_to_image TEXT,
  recalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF p_after IS NOT NULL THEN
    -- 增量：只返回 p_after 之后的新消息（升序），前端直接追加，避免全量重渲染
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname, m.content, m.image,
      m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
      m.recalled_at, m.created_at
    FROM messages m
    WHERE m.room = p_room AND (m.created_at > p_after OR m.recalled_at > p_after)
    ORDER BY m.created_at ASC;
  ELSIF p_before IS NOT NULL THEN
    -- 历史分页：返回早于 p_before 的 p_limit 条（降序），前端插入列表顶部
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname, m.content, m.image,
      m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
      m.recalled_at, m.created_at
    FROM messages m
    WHERE m.room = p_room AND m.created_at < p_before
    ORDER BY m.created_at DESC
    LIMIT p_limit;
  ELSE
    -- 首屏：返回最近 p_limit 条（降序），前端翻转后整列表渲染
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname, m.content, m.image,
      m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
      m.recalled_at, m.created_at
    FROM messages m
    WHERE m.room = p_room
    ORDER BY m.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 在线用户表
CREATE TABLE IF NOT EXISTS online_users (
  session_id TEXT PRIMARY KEY,
  room TEXT,
  last_seen TIMESTAMPTZ DEFAULT now()
);

-- 5. 心跳：更新/插入在线状态，并清理超过3分钟未心跳的会话
CREATE OR REPLACE FUNCTION heartbeat(p_session TEXT, p_room TEXT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
  INSERT INTO online_users (session_id, room, last_seen)
  VALUES (p_session, p_room, now())
  ON CONFLICT (session_id) DO UPDATE SET room = EXCLUDED.room, last_seen = now();
  DELETE FROM online_users WHERE last_seen < now() - interval '3 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 统计在线人数（2分钟内有心跳）
CREATE OR REPLACE FUNCTION online_count(p_room TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM online_users
    WHERE last_seen > now() - interval '2 minutes'
    AND (p_room IS NULL OR room = p_room));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
