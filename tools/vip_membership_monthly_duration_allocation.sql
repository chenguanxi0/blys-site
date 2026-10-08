-- 将开通、续费都按购买时长分配到连续月份：约 31/62/93 天分别计入 1/2/3 次。
-- 每个计次对应 ¥500；例如 9 月购买 93 天，会在 9、10、11 月各计 1 次。
-- 中断仅按“会员到期后没有下一笔续费”的会员人数统计，不参与金额。

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
  ), duration_events AS (
    SELECT e.*,
           greatest(1, ceil(coalesce(e.days, 31)::numeric / 31)::integer) AS billing_units
    FROM real_events e
    WHERE e.event_type IN ('new', 'renew')
      AND e.occurred_at >= timestamptz '2026-08-01 00:00:00+08'
  ), monthly AS (
    -- 新开、续费均按天数拆分：31 天 1 次，62 天 2 次，93 天 3 次。
    SELECT to_char(
             date_trunc('month', e.occurred_at AT TIME ZONE 'Asia/Shanghai')
             + make_interval(months => offsets.month_offset),
             'YYYY-MM'
           ) AS month_key,
           count(*) FILTER (WHERE e.event_type = 'new')::integer AS new_count,
           count(*) FILTER (WHERE e.event_type = 'renew')::integer AS renew_count,
           0::integer AS lapsed_count
    FROM duration_events e
    CROSS JOIN LATERAL generate_series(0, e.billing_units - 1) AS offsets(month_offset)
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
