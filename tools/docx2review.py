#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把「A股每日复盘报告_YYYYMMDD.docx」转换成与站点风格一致的 HTML 复盘报告。
- 严格保留原报告 14 章结构、表格表头、段落文案
- 涨跌幅列按中国惯例着色：涨=红(#cc0000) 跌=绿(#009900)
- 表格隔行底纹
- 持仓部分：原基础报告本就不含个人持仓，自然排除
用法：
  python docx2review.py <输入docx> <输出html>
"""
import sys, zipfile, re, html, xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def cell_text(tc):
    return "".join(t.text or "" for t in tc.iter(W + 't'))

def colorize(text):
    """对包含涨跌幅百分比的单元格着色；返回 (safe_html, need_color, color)。"""
    s = text.strip()
    # 去掉 docx 里偶发的 ++ 重复正号
    m = re.match(r'^(\+\+?|-)(\d+\.?\d*)%?$', s)
    if m:
        sign = m.group(1)
        color = '#cc0000' if sign != '-' else '#009900'
        return s, True, color
    return s, False, None

def pct_color_inline(s):
    """段落里的 +x.xx% / -x.xx% 着色（用于盘面/热点等叙述段落）。"""
    def repl(mm):
        m = mm.group(0)
        color = '#cc0000' if not m.startswith('-') else '#009900'
        return f'<span style="color:{color};font-weight:600">{m}</span>'
    return re.sub(r'[+-]\d+\.?\d*%', repl, s)

def parse(path):
    z = zipfile.ZipFile(path)
    xml = z.read('word/document.xml').decode('utf-8')
    root = ET.fromstring(xml)
    body = root.find(W + 'body')
    blocks = []  # list of ('h1',text) ('h2',text) ('p',text) ('table',[[cells]])
    for el in body:
        tag = el.tag.split('}')[1]
        if tag == 'p':
            style = ''
            pPr = el.find(W + 'pPr')
            if pPr is not None:
                ps = pPr.find(W + 'pStyle')
                if ps is not None:
                    style = ps.get(W + 'val') or ''
            t = cell_text(el)
            if style == 'Heading1':
                blocks.append(('h1', t))
            elif 'Heading' in style:
                blocks.append(('h2', t))
            elif t.strip():
                blocks.append(('p', t))
        elif tag == 'tbl':
            rows = []
            for tr in el.findall(W + 'tr'):
                rows.append([cell_text(tc) for tc in tr.findall(W + 'tc')])
            blocks.append(('table', rows))
    return blocks

def render(blocks):
    out = []
    out.append('<article class="rpt" id="rptRoot">')
    seen_chapter = False
    open_section = False
    cover = []
    for b in blocks:
        if b[0] == 'h2':
            if cover:
                out.append('<div class="rpt-cover">')
                for line in cover:
                    out.append(f'<p class="rpt-cover-line">{line}</p>')
                out.append('</div>')
                cover = []
            if open_section:
                out.append('</section>')
                open_section = False
            out.append(f'<section class="rpt-chapter"><h2 class="rpt-h2">{html.escape(b[1])}</h2>')
            seen_chapter = True
            open_section = True
        elif b[0] == 'p':
            if not seen_chapter:
                cover.append(pct_color_inline(html.escape(b[1])))
            else:
                out.append(f'<p>{pct_color_inline(html.escape(b[1]))}</p>')
        elif b[0] == 'table':
            rows = b[1]
            if not rows:
                continue
            out.append('<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>')
            head = rows[0]
            for c in head:
                out.append(f'<th>{html.escape(c)}</th>')
            out.append('</tr></thead><tbody>')
            # 判断哪一列是涨跌幅/跌跌幅（表头含 涨跌幅 或 跌跌幅）
            pct_col = None
            for i, h in enumerate(head):
                if '涨跌幅' in h or '跌跌幅' in h:
                    pct_col = i
                    break
            for ri, row in enumerate(rows[1:]):
                cls = ' class="alt"' if ri % 2 == 1 else ''
                out.append(f'<tr{cls}>')
                for ci, c in enumerate(row):
                    txt, ispct, color = colorize(c)
                    if ispct:
                        out.append(f'<td style="color:{color};font-weight:600">{html.escape(txt)}</td>')
                    elif pct_col is not None and ci == pct_col:
                        # 已去色化的百分比如 "0.85%"
                        cc = '#cc0000' if not txt.lstrip('+').startswith('-') else '#009900'
                        out.append(f'<td style="color:{cc};font-weight:600">{html.escape(txt)}</td>')
                    else:
                        out.append(f'<td>{html.escape(txt)}</td>')
                out.append('</tr>')
            out.append('</tbody></table></div>')
    if cover:
        out.append('<div class="rpt-cover">')
        for line in cover:
            out.append(f'<p class="rpt-cover-line">{line}</p>')
        out.append('</div>')
    if open_section:
        out.append('</section>')
    out.append('</article>')
    return '\n'.join(out)

if __name__ == '__main__':
    src = sys.argv[1]
    dst = sys.argv[2]
    blocks = parse(src)
    html_body = render(blocks)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(html_body)
    print(f'OK: {src} -> {dst}  ({len(html_body)} bytes, {len(blocks)} blocks)')
