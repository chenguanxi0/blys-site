#!/usr/bin/env python3
"""把 review.html 里 3 张表的列顺序调整为「代码在名称之后」。最终版。
按 src_th 找到原表头后，按 new_th 重排表头和 tbody 行。"""
import re

SRC = 'assets/review.html'

with open(SRC, encoding='utf-8') as f:
    src = f.read()

# (src_th, new_th)
RULES = [
    {
        'name': '涨停大表',
        'src_th': ['代码', '名称', '备注', '所属板块', '涨停原因'],
        'new_th': ['名称', '代码', '备注', '所属板块', '涨停原因'],
    },
    {
        'name': '成交额表',
        'src_th': ['排名', '代码', '名称', '涨跌幅', '成交额（亿元）', '所属方向'],
        'new_th': ['排名', '名称', '代码', '涨跌幅', '成交额（亿元）', '所属方向'],
    },
    {
        'name': '跌幅表',
        'src_th': ['排名', '代码', '名称', '所属方向', '跌幅', '原因'],
        'new_th': ['排名', '名称', '代码', '所属方向', '跌幅', '原因'],
    },
]

def find_table(html, src_th):
    pos = 0
    while True:
        i = html.find('<th>'+src_th[0]+'</th>', pos)
        if i < 0: return None
        tbl_start = html.rfind('<table', 0, i)
        if tbl_start < 0: pos = i+1; continue
        tbl_end = html.find('</table>', i) + 8
        if tbl_end < 0: return None
        thead_start = html.find('<thead>', tbl_start)
        thead_end = html.find('</thead>', thead_start)
        if thead_end < 0 or thead_end > tbl_end:
            pos = i+1; continue
        ths = [m.group(1).strip() for m in re.finditer(r'<th\b[^>]*>(.*?)</th>', html[thead_start:thead_end], re.S)]
        if ths[:len(src_th)] == src_th:
            return (tbl_start, tbl_end)
        pos = i + 1

def reorder_row(row_html, order):
    cells = re.findall(r'<td[^>]*>.*?</td>', row_html, re.S)
    if len(cells) != len(order): return None
    new_cells = [cells[i] for i in order]
    return '<tr>' + ''.join(new_cells) + '</tr>'

def process(html, rule):
    found = find_table(html, rule['src_th'])
    if not found: return html, 0
    s, e = found
    table = html[s:e]
    thead_start = table.find('<thead>')
    thead_end_marker = table.find('</thead>')  # 不含闭合
    head = table[thead_start:thead_end_marker]
    new_head = '<thead><tr>' + ''.join(f'<th>{t}</th>' for t in rule['new_th']) + '</tr>'
    table = table[:thead_start] + new_head + table[thead_end_marker:]
    # tbody 行
    order = [rule['new_th'].index(rule['src_th'][i]) for i in range(len(rule['src_th']))]
    body_start = table.find('<tbody>')
    body_end_marker = table.find('</tbody>', body_start)
    body = table[body_start:body_end_marker]
    rows = re.findall(r'<tr>.*?</tr>', body, re.S)
    new_body = body
    cnt = 0
    for old in rows:
        new_row = reorder_row(old, order)
        if new_row is None: continue
        new_body = new_body.replace(old, new_row, 1)
        cnt += 1
    table = table[:body_start] + new_body + table[body_end_marker:]
    return html.replace(html[s:e], table, 1), cnt

total = 0
for rule in RULES:
    src, n = process(src, rule)
    total += n
    print(f"{rule['name']}: 重排行 {n}")

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(src)

# 同步存档
import shutil
shutil.copy(SRC, 'assets/reviews/2026-08-18.html')
print('done total:', total, '已同步存档')