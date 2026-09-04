-- 管理员私聊图片库：图片采用与现有私聊一致的压缩 data URL，避免公开存储桶泄露。

CREATE TABLE IF NOT EXISTS public.admin_private_image_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL DEFAULT '图片',
  image text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_private_image_library_image_check
    CHECK (image LIKE 'data:image/%')
);

CREATE INDEX IF NOT EXISTS admin_private_image_library_created_idx
  ON public.admin_private_image_library (created_at DESC);

CREATE OR REPLACE FUNCTION public._blys_is_image_library_admin(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT is_admin
    FROM public.profiles
    WHERE token = p_token
    LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.admin_private_image_library_list(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_items jsonb;
BEGIN
  IF NOT public._blys_is_image_library_admin(p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'file_name', file_name,
    'image', image,
    'created_at', created_at
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT id, file_name, image, created_at
    FROM public.admin_private_image_library
    ORDER BY created_at DESC
    LIMIT 80
  ) t;

  RETURN jsonb_build_object('ok', true, 'list', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_private_image_library_add(
  p_token text,
  p_file_name text,
  p_image text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_item public.admin_private_image_library%ROWTYPE;
BEGIN
  IF NOT public._blys_is_image_library_admin(p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;
  IF p_image IS NULL OR p_image !~ '^data:image/' OR length(p_image) > 900000 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '图片格式不正确或文件过大');
  END IF;

  INSERT INTO public.admin_private_image_library(file_name, image)
  VALUES (left(coalesce(nullif(trim(p_file_name), ''), '图片'), 100), p_image)
  RETURNING * INTO v_item;

  RETURN jsonb_build_object('ok', true, 'item', jsonb_build_object(
    'id', v_item.id,
    'file_name', v_item.file_name,
    'image', v_item.image,
    'created_at', v_item.created_at
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_private_image_library_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_private_image_library_add(text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
