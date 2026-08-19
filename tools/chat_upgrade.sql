-- 聊天室升级 SQL：图片消息 + 在线人数
-- 在 Supabase SQL Editor 中执行一次即可

-- 1. messages 表增加图片字段
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image TEXT;

-- 2. 改造 send_message，支持可选图片参数
DROP FUNCTION IF EXISTS send_message(text, text, text);
DROP FUNCTION IF EXISTS send_message(text, text, text, text);
CREATE OR REPLACE FUNCTION send_message(
  p_token TEXT,
  p_room TEXT,
  p_content TEXT,
  p_image TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_user RECORD;
BEGIN
  SELECT email, nickname, vip_expire INTO v_user FROM profiles WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'msg', '请先登录'); END IF;
  IF p_room = 'vip' AND (v_user.vip_expire IS NULL OR v_user.vip_expire <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'msg', 'VIP专属房间');
  END IF;
  INSERT INTO messages (room, user_email, user_nickname, content, image, created_at)
  VALUES (
    p_room,
    v_user.email,
    COALESCE(v_user.nickname, split_part(v_user.email,'@',1)),
    NULLIF(trim(p_content), ''),
    NULLIF(trim(p_image), ''),
    now()
  );
  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 改造 list_messages，返回图片字段（id 与 messages 表实际类型一致，为 UUID）
DROP FUNCTION IF EXISTS list_messages(text);
DROP FUNCTION IF EXISTS list_messages(text, integer);
CREATE OR REPLACE FUNCTION list_messages(p_room TEXT, p_limit INTEGER DEFAULT 100)
RETURNS TABLE(id UUID, user_email TEXT, user_nickname TEXT, content TEXT, image TEXT, created_at TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY SELECT m.id, m.user_email, m.user_nickname, m.content, m.image, m.created_at
    FROM messages m WHERE m.room = p_room ORDER BY m.created_at DESC LIMIT p_limit;
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
