#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成「白鹿原上」每日 A 股复盘报告（统一 13 章格式）。

数据来源（与 2026-08-18 复盘完全一致）：
  1) 指数数据：Tongdaxin 行情连接器 tdx_kline（period=4 日线）拉取真实收盘
  2) 板块/个股/情绪/机构：财联社收评（WebSearch/WebFetch "财联社 YYYY年M月D日 收评 A股收盘"）
  3) 将数据整理为 JSON（见 review_YYYY-MM-DD.json），本脚本只负责渲染成 HTML。

输出：
  assets/reviews/YYYY-MM-DD.html  （13 章，结构与 08-18 完全一致）
  assets/reviews/index.json        （自动追加并排序）

章节顺序（固定，禁止改动）：
  一 核心指数概览 / 二 盘面运行复盘 / 三 板块涨跌明细 / 四 市场热点解析
  五 涨跌停情绪面 / 六 人气热榜 / 七 成交额前列 / 八 跌幅Top20
  九 资金面分析 / 十 外部市场及宏观环境 / 十一 机构策略观点
  十二 明日关注要点 / 十三 免责声明
"""
import json
import os
import sys

# ---------- 渲染辅助 ----------
def altcls(i):
    return ' class="alt"' if i % 2 else ''

def color(change):
    """A股惯例：红涨绿跌"""
    if change > 0:
        return "#cc0000", "+"
    return "#009900", ""

def chg_cell(change):
    c, s = color(change)
    return '<td style="color:%s;font-weight:600">%s%.2f%%</td>' % (c, s, change)

def chg_text(change):
    c, s = color(change)
    return '<span style="color:%s;font-weight:600">%s%.2f%%</span>' % (c, s, change)


# ---------- 各章节 ----------
def sec_core_index(d):
    idx = d["indices"]
    rows = "\n".join(
        '<tr%s><td>%s</td><td>%s</td><td>%.2f</td><td>%.2f</td>%s<td>%d亿</td></tr>'
        % (altcls(i), x["name"], x["code"], x["open"], x["close"], chg_cell(x["change"]), x["amount"])
        for i, x in enumerate(idx)
    )
    trend = "涨" if idx[0]["change"] > 0 else "跌"
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">一  核心指数概览</h2>\n'
        '<p>%s月%s日A股集体收%s，主要指数全线下跌。上证指数%s%.2f%%，深证成指%s%.2f%%，创业板指%s%.2f%%。全市场%s，成交额约%.2f万亿元。</p>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>\n'
        '<th>指数</th><th>代码</th><th>开盘</th><th>收盘</th><th>涨跌幅</th><th>成交额</th>\n'
        '</tr></thead><tbody>\n%s\n</tbody></table></div>\n'
        '<p>%s</p>\n</section>'
        % (d["date"][5:7], d["date"][8:10], trend,
           trend, abs(idx[0]["change"]), trend, abs(idx[1]["change"]), trend, abs(idx[2]["change"]),
           ("涨多跌少" if d.get("up", 0) > d.get("down", 0) else "跌多跌少"),
           d["total_amount"] / 10000, rows, d["index_note"])
    )


def sec_panmian(d):
    p = d["panmian"]
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">二  盘面运行复盘</h2>\n'
        '<p><b>市场特征：</b>%s</p>\n<p><b>指数表现：</b>%s</p>\n<p><b>资金面与广度：</b>%s</p>\n</section>'
        % (p["feature"], p["index_perf"], p["breadth"])
    )


def sec_sectors(d):
    s = d["sectors"]
    lead = "\n".join(
        '<tr%s><td>%s</td><td>%s</td><td>%s</td></tr>' % (altcls(i), x["name"], x["stocks"], x["logic"])
        for i, x in enumerate(s["lead"])
    )
    decline = "\n".join(
        '<tr%s><td>%s</td><td>%s</td><td>%s</td></tr>' % (altcls(i), x["name"], x["stocks"], x["reason"])
        for i, x in enumerate(s["decline"])
    )
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">三  板块涨跌明细</h2>\n'
        '<p>以下为主要板块当日表现（领涨/领跌个股及驱动逻辑）。板块涨跌幅以公开资讯披露的领涨/领跌结构整理，精确数值以行情终端为准。</p>\n'
        '<h3 class="rpt-h3">领涨板块（事件/低位驱动为主）</h3>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>\n'
        '<th>板块名称</th><th>领涨/活跃个股</th><th>驱动逻辑</th>\n'
        '</tr></thead><tbody>\n%s\n</tbody></table></div>\n'
        '<h3 class="rpt-h3">领跌板块</h3>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>\n'
        '<th>板块名称</th><th>领跌/承压个股</th><th>回调原因</th>\n'
        '</tr></thead><tbody>\n%s\n</tbody></table></div>\n</section>'
        % (lead, decline)
    )


def sec_hotspots(d):
    items = "\n".join(
        '<p><b>%d. %s：</b>%s。</p>' % (i, t, c) for i, (t, c) in enumerate(d["hotspots"], 1)
    )
    return '<section class="rpt-chapter"><h2 class="rpt-h2">四  市场热点解析</h2>\n%s\n</section>' % items


def sec_emotion(d):
    e = d["emotion"]
    ladder_rows = ""
    for i, lv in enumerate(e["ladder"]):
        cells = "".join("<td>%s</td>" % s for s in lv["stocks"])
        empty = "".join("<td></td>" for _ in range(max(0, 8 - len(lv["stocks"]))))
        ladder_rows += '<tr%s><td><b>%s</b></td>%s%s</tr>\n' % (altcls(i), lv["height"], cells, empty)
    lu = "\n".join(
        '<tr%s><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
        % (altcls(i), x["name"], x["code"], x["note"], x["sector"], x["reason"])
        for i, x in enumerate(e["limitup_list"])
    )
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">五  涨跌停情绪面</h2>\n'
        '<p><b>涨停统计：</b>当日两市及北交所共 <b>%d</b> 只个股涨停（含20%%、30%%涨停），涨停家数处于近期%s，资金集中于%s。</p>\n'
        '<p><b>跌停统计：</b>当日两市及北交所共 <b>%d</b> 只个股跌停，市场抛压%s，亏钱效应%s。</p>\n'
        '<p><b>连板梯队：</b>%s</p>\n<p><b>连板天梯：</b></p>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl rpt-ladder"><thead><tr>\n'
        '<th>连板高度</th><th colspan="8">个股简称</th>\n'
        '</tr></thead><tbody>\n%s</tbody></table></div>\n'
        '<p><b>按板块列出当日涨停个股（共%d只，按行业归类）：</b></p>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr><th>名称</th><th>代码</th><th>备注</th><th>所属板块</th><th>涨停原因</th></tr></thead><tbody>\n%s\n</tbody></table></div>\n</section>'
        % (e["limit_up"], "高位" if e["limit_up"] > 60 else "低位", e["up_focus"],
           e["limit_down"], "较轻" if e["limit_down"] < 30 else "较重", "分散" if e["limit_down"] < 30 else "集中蔓延",
           e.get("ladder_intro", ""), ladder_rows, e["limit_up"], lu)
    )


def sec_hot(d):
    intro = d.get("hot_intro", "")
    rows = "\n".join(
        '<tr%s><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
        % (altcls(i), x["rank"], x["name"], x["code"], x["price"], chg_text(x["change"]), x["note"])
        for i, x in enumerate(d["hot_list"])
    )
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">六  人气热榜</h2>\n<p>%s</p>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>\n'
        '<th>排名</th><th>名称</th><th>代码</th><th>现价</th><th>涨跌幅</th><th>异动说明</th>\n'
        '</tr></thead><tbody>\n%s\n</tbody></table></div></section>' % (intro, rows)
    )


def sec_amount(d):
    intro = d.get("amount_intro", "")
    rows = "\n".join(
        '<tr%s><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
        % (altcls(i), x["rank"], x["name"], x["code"], chg_text(x["change"]), x["amount"], x["sector"])
        for i, x in enumerate(d["amount_top"])
    )
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">七  成交额前列</h2>\n<p>%s</p>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr><th>排名</th><th>名称</th><th>代码</th><th>涨跌幅</th><th>成交额（亿元）</th><th>所属方向</th></tr></thead><tbody>\n%s\n</tbody></table></div>\n</section>'
        % (intro, rows)
    )


def sec_drop(d):
    intro = d.get("drop_intro", "")
    rows = "\n".join(
        '<tr%s><td>%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>'
        % (altcls(i), x["rank"], x["name"], x["code"], x["sector"], chg_text(x["drop"]), x["reason"])
        for i, x in enumerate(d["drop_top20"])
    )
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">八  跌幅Top20</h2>\n<p>%s</p>\n'
        '<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr><th>排名</th><th>名称</th><th>代码</th><th>所属方向</th><th>跌幅</th><th>原因</th></tr></thead><tbody>\n%s\n</tbody></table></div>\n</section>'
        % (intro, rows)
    )


def sec_funds(d):
    f = d["funds"]
    north = f.get("north", "当日北向资金流向未在公开资讯中详细披露，市场以内资调仓主导。")
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">九  资金面分析</h2>\n'
        '<p><b>市场成交：</b>%s</p>\n<p><b>主力资金流向：</b>%s</p>\n<p><b>北向资金：</b>%s</p>\n</section>'
        % (f["market"], f["main"], north)
    )


def sec_macro(d):
    m = d["macro"]
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">十  外部市场及宏观环境</h2>\n'
        '<p><b>全球视角：</b>%s</p>\n<p><b>国内政策与产业：</b>%s</p>\n<p><b>海外映射：</b>%s</p>\n</section>'
        % (m["global"], m["domestic"], m["overseas"])
    )


def sec_institutions(d):
    items = "\n".join('<p><b>%s：</b>%s</p>' % (x["name"], x["view"]) for x in d["institutions"])
    return '<section class="rpt-chapter"><h2 class="rpt-h2">十一  机构策略观点</h2>\n%s\n</section>' % items


def sec_focus(d):
    items = "\n".join('<p>%d. <b>%s</b></p>' % (i, x) for i, x in enumerate(d["focus"], 1))
    return '<section class="rpt-chapter"><h2 class="rpt-h2">十二  明日关注要点</h2>\n%s\n</section>' % items


def sec_disclaimer(d):
    return (
        '<section class="rpt-chapter"><h2 class="rpt-h2">十三  免责声明</h2>\n'
        '<p>本报告基于公开市场数据和新闻资讯自动生成，所有数据来源于公开信息，仅供参考学习，不构成任何投资建议。</p>\n'
        '<p>股市有风险，投资需谨慎。过往业绩不代表未来表现，任何依据本报告进行的投资决策均由投资者自行承担风险。</p>\n'
        '<p>报告中的涨跌幅颜色遵循中国股市惯例：红色表示上涨，绿色表示下跌。</p>\n'
        '<p>本自动化报告不包含个人持仓数据；部分数据为公开资讯提及的示例，非完整市场排名。连板统计与涨停明细以当日行情终端为准。</p>\n</section>'
    )


def gen_report(d):
    html = (
        '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
        '<title>%s 每日复盘</title>\n<link rel="stylesheet" href="../styles.css?v=20260818">\n'
        '</head>\n<body>\n<article class="rpt" id="rptRoot">\n'
        '<div class="rpt-cover">\n<p class="rpt-cover-line">%s  %s</p>\n'
        '<p class="rpt-cover-line">沪指%s%.2f%%报%.2f点 | 两市成交%.2f万亿元 | %s</p>\n'
        '<p class="rpt-cover-line">本报告基于公开市场数据与资讯自动生成，仅供参考，不构成投资建议。</p>\n</div>\n'
        % (d["date"], d["date"], d["weekday"], ("涨" if d["indices"][0]["change"] > 0 else "跌"), abs(d["indices"][0]["change"]), d["indices"][0]["close"],
           d["total_amount"] / 10000, ("涨多跌少" if d.get("up", 0) > d.get("down", 0) else "跌多跌少"))
    )
    html += sec_core_index(d)
    html += sec_panmian(d)
    html += sec_sectors(d)
    html += sec_hotspots(d)
    html += sec_emotion(d)
    html += sec_hot(d)
    html += sec_amount(d)
    html += sec_drop(d)
    html += sec_funds(d)
    html += sec_macro(d)
    html += sec_institutions(d)
    html += sec_focus(d)
    html += sec_disclaimer(d)
    html += '</article>\n</body>\n</html>'
    return html


def update_index(date, weekday, out_dir):
    idx_path = os.path.join(out_dir, "index.json")
    if os.path.exists(idx_path):
        with open(idx_path, encoding="utf-8") as f:
            index = json.load(f)
    else:
        index = []
    entry = {"date": date, "weekday": weekday, "title": "%s %s" % (date, weekday), "file": "assets/reviews/%s.html" % date}
    index = [e for e in index if e["date"] != date]
    index.append(entry)
    index.sort(key=lambda x: x["date"])
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print("Updated: %s" % idx_path)


def sync_latest_review(html_path, out_dir):
    """把最新一期同步覆盖 assets/review.html（站点默认最新展示兜底用）。
    仅当 index.json 中最新日期 == 当前生成日期时才覆盖，避免历史回填污染 latest。"""
    idx_path = os.path.join(out_dir, "index.json")
    with open(html_path, encoding="utf-8") as f:
        html = f.read()
    # review.html 位于 assets/ 下，与 assets/reviews/ 同级
    parent_dir = os.path.dirname(out_dir.rstrip("\\/")) or "."
    latest_path = os.path.join(parent_dir, "review.html")
    try:
        with open(idx_path, encoding="utf-8") as f:
            index = json.load(f)
        if index:
            top = sorted(index, key=lambda x: x.get("date", ""))[-1]
            cur_date = os.path.basename(html_path).replace(".html", "")
            if top.get("date") != cur_date:
                print("Skip review.html sync: %s is not latest (top=%s)" % (cur_date, top.get("date")))
                return
    except Exception as e:
        print("review.html sync skipped (index read failed): %s" % e)
        return
    with open(latest_path, "w", encoding="utf-8") as f:
        f.write(html)
    print("Synced latest: %s" % latest_path)


def main():
    if len(sys.argv) < 2:
        print("用法: python gen_review_0818.py <review_YYYY-MM-DD.json>")
        sys.exit(1)
    data_path = sys.argv[1]
    with open(data_path, encoding="utf-8") as f:
        d = json.load(f)
    out_dir = "assets/reviews"
    os.makedirs(out_dir, exist_ok=True)
    html = gen_report(d)
    out_file = os.path.join(out_dir, "%s.html" % d["date"])
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(html)
    print("Generated: %s" % out_file)
    update_index(d["date"], d["weekday"], out_dir)
    sync_latest_review(out_file, out_dir)


if __name__ == "__main__":
    main()
