-- 管理员私聊图片库：图片采用与现有私聊一致的压缩 data URL，避免公开存储桶泄露。

CREATE TABLE IF NOT EXISTS public.admin_private_image_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL DEFAULT '图片',
  image text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_private_image_library_image_check
    CHECK (image LIKE 'data:image/%')
);

ALTER TABLE public.admin_private_image_library
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_private_image_library WHERE sort_order <> 0) THEN
    WITH ordered AS (
      SELECT id, row_number() OVER (ORDER BY created_at DESC)::integer AS position
      FROM public.admin_private_image_library
    )
    UPDATE public.admin_private_image_library t
       SET sort_order = ordered.position
      FROM ordered
     WHERE t.id = ordered.id;
  END IF;
END;
$$;

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
    'created_at', created_at
  ) ORDER BY sort_order ASC, created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT id, file_name, image, created_at, sort_order
    FROM public.admin_private_image_library
    ORDER BY sort_order ASC, created_at DESC
    LIMIT 80
  ) t;

  RETURN jsonb_build_object('ok', true, 'list', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_private_image_library_get(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_image text;
BEGIN
  IF NOT public._blys_is_image_library_admin(p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;
  SELECT image INTO v_image FROM public.admin_private_image_library WHERE id = p_id;
  IF v_image IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'msg', '图片不存在');
  END IF;
  RETURN jsonb_build_object('ok', true, 'image', v_image);
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
DECLARE
  v_item public.admin_private_image_library%ROWTYPE;
  v_next_sort_order integer;
BEGIN
  IF NOT public._blys_is_image_library_admin(p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;
  IF p_image IS NULL OR p_image !~ '^data:image/' OR length(p_image) > 900000 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '图片格式不正确或文件过大');
  END IF;

  SELECT coalesce(min(sort_order), 1) - 1 INTO v_next_sort_order
  FROM public.admin_private_image_library;

  INSERT INTO public.admin_private_image_library(file_name, image, sort_order)
  VALUES (left(coalesce(nullif(trim(p_file_name), ''), '图片'), 100), p_image, v_next_sort_order)
  RETURNING * INTO v_item;

  RETURN jsonb_build_object('ok', true, 'item', jsonb_build_object(
    'id', v_item.id,
    'file_name', v_item.file_name,
    'image', v_item.image,
    'created_at', v_item.created_at
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_private_image_library_reorder(
  p_token text,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._blys_is_image_library_admin(p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'msg', '排序数据为空');
  END IF;

  UPDATE public.admin_private_image_library t
     SET sort_order = ordered.position::integer
    FROM unnest(p_ids) WITH ORDINALITY AS ordered(id, position)
   WHERE t.id = ordered.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_private_image_library_delete(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._blys_is_image_library_admin(p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  DELETE FROM public.admin_private_image_library WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'msg', '图片不存在或已删除');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_private_image_library_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_private_image_library_get(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_private_image_library_add(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_private_image_library_delete(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_private_image_library_reorder(text, uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
