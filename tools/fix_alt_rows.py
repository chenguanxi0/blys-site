#!/usr/bin/env python3
"""把涨停大表所有行统一为 (名称, 代码, ...) 顺序。
通过每行 td[0] 是否为 6 位数字识别当前顺序，统一交换。"""
import re, shutil

SRC = 'assets/review.html'

def is_code(cell_html):
    """判断 td 内容是否为 6 位数字（股票代码）。"""
    txt = re.sub(r'<[^>]+>', '', cell_html).strip()
    return bool(re.match(r'^\d{6}$', txt))

def fix_row(row):
    cells = re.findall(r'<td[^>]*>.*?</td>', row, re.S)
    if len(cells) < 2: return row
    # 期望 (名称, 代码)——名称在前，td[0] 不是纯数字
    if is_code(cells[0]) and not is_code(cells[1]):
        # 当前 (代码, 名称)，交换前两列
        cells = [cells[1], cells[0]] + cells[2:]
    # 已经是 (名称, 代码) 或都不是，跳过
    m = re.match(r'<tr\b[^>]*>', row)
    tr_open = m.group(0) if m else '<tr>'
    return tr_open + ''.join(cells) + '</tr>'

with open(SRC, encoding='utf-8') as f:
    src = f.read()

# 找涨停大表（new_th = 名称|代码|...），处理 tbody
new_th_first = '<th>名称</th><th>代码</th><th>备注</th><th>所属板块</th><th>涨停原因</th>'
i = src.find(new_th_first)
if i < 0:
    print('not found')
else:
    tbl_start = src.rfind('<table', 0, i)
    tbl_end = src.find('</table>', i) + 8
    table = src[tbl_start:tbl_end]
    body_start = table.find('<tbody>')
    body_end = table.find('</tbody>', body_start)
    body = table[body_start:body_end]
    rows = re.findall(r'<tr\b[^>]*>.*?</tr>', body, re.S)
    new_body = body
    fixed = 0
    for old in rows:
        new = fix_row(old)
        if new != old:
            new_body = new_body.replace(old, new, 1)
            fixed += 1
    new_table = table[:body_start] + new_body + table[body_end:]
    src = src.replace(table, new_table, 1)
    print(f'涨停大表: 修复 {fixed} 行（其中 alt 行已统一）')

with open(SRC, 'w', encoding='utf-8') as f:
    f.write(src)
shutil.copy(SRC, 'assets/reviews/2026-08-18.html')
print('done, 同步存档')