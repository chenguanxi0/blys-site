-- 将续费按购买时长分配到连续月份：31/62/93 天分别计入 1/2/3 个月。
-- 此函数读取流水动态计算，执行后历史与刚完成的 93 天续费都会立即反映在后台月度统计中。

CREATE OR REPLACE FUNCTION public.get_admin_vip_monthly_activity(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_stats jsonb;
BEGIN
  IF NOT public._blys_monthly_stats_admin(p_admin_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  WITH real_events AS (
    SELECT DISTINCT ON (lower(e.user_email), e.event_type, e.occurred_at) e.*
    FROM public.vip_membership_events e
    JOIN public.profiles p ON lower(p.email) = lower(e.user_email)
    WHERE NOT coalesce(p.is_admin, false)
      AND NOT coalesce(p.is_demo_account, false)
      AND NOT coalesce(p.exclude_from_stats, false)
    ORDER BY lower(e.user_email), e.event_type, e.occurred_at,
             CASE WHEN e.source = 'historical_backfill' THEN 1 ELSE 0 END,
             e.id DESC
  ), monthly AS (
    SELECT to_char(date_trunc('month', occurred_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM') AS month_key,
           count(*)::integer AS new_count, 0::integer AS renew_count, 0::integer AS lapsed_count
    FROM real_events
    WHERE event_type = 'new'
      AND occurred_at >= timestamptz '2026-08-01 00:00:00+08'
    GROUP BY 1
    UNION ALL
    SELECT to_char(
             date_trunc('month', e.occurred_at AT TIME ZONE 'Asia/Shanghai')
             + make_interval(months => offsets.month_offset),
             'YYYY-MM'
           ) AS month_key,
           0::integer, count(*)::integer, 0::integer
    FROM real_events e
    CROSS JOIN LATERAL generate_series(0, greatest(0, ceil(e.days::numeric / 31)::integer - 1)) AS offsets(month_offset)
    WHERE e.event_type = 'renew'
      AND e.occurred_at >= timestamptz '2026-08-01 00:00:00+08'
    GROUP BY 1
    UNION ALL
    SELECT to_char(date_trunc('month', e.expire_after AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM') AS month_key,
           0::integer, 0::integer, count(DISTINCT lower(e.user_email))::integer
    FROM real_events e
    WHERE e.expire_after >= timestamptz '2026-08-01 00:00:00+08'
      AND e.expire_after <= now()
      AND NOT EXISTS (
        SELECT 1 FROM real_events next_event
        WHERE lower(next_event.user_email) = lower(e.user_email)
          AND next_event.occurred_at > e.occurred_at
          AND next_event.occurred_at <= e.expire_after
      )
    GROUP BY 1
  ), monthly_totals AS (
    SELECT month_key, sum(new_count)::integer AS new_count, sum(renew_count)::integer AS renew_count,
           sum(lapsed_count)::integer AS lapsed_count
    FROM monthly GROUP BY month_key
  )
  SELECT coalesce(jsonb_object_agg(month_key, jsonb_build_object(
    'new', new_count, 'renew', renew_count, 'lapsed', lapsed_count
  )), '{}'::jsonb)
  INTO v_stats
  FROM monthly_totals;

  RETURN jsonb_build_object('ok', true, 'stats', coalesce(v_stats, '{}'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_vip_monthly_activity(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
