#!/usr/bin/env python3
"""批量检查复盘文件封面与表格数据一致性"""
import os, re, glob

REPO = r"c:\Users\49178\WorkBuddy\2026-08-15-10-18-14\web\assets\reviews"
REVIEW = r"c:\Users\49178\WorkBuddy\2026-08-15-10-18-14\web\assets\review.html"

def check_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    
    # 提取封面收盘
    cover_match = re.search(r'报([\d.]+)点', text)
    if not cover_match:
        return None
    cover_close = float(cover_match.group(1))
    
    # 提取表格第一行收盘（上证指数）
    table_match = re.search(r'<td>上证指数</td>\s*<td>\d+</td>\s*<td>[\d.]+</td>\s*<td>([\d.]+)</td>', text)
    if not table_match:
        return None
    table_close = float(table_match.group(1))
    
    # 提取日期
    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(path))
    date = date_match.group(1) if date_match else os.path.basename(path)
    
    return {
        'file': os.path.basename(path),
        'date': date,
        'cover_close': cover_close,
        'table_close': table_close,
        'match': abs(cover_close - table_close) < 0.1
    }

results = []
# 检查 review.html
r = check_file(REVIEW)
if r:
    r['file'] = 'review.html (最新)'
    results.append(r)

# 检查所有历史复盘
for f in sorted(glob.glob(os.path.join(REPO, '*.html'))):
    r = check_file(f)
    if r:
        results.append(r)

print(f"{'文件':<20} {'日期':<12} {'封面收盘':<10} {'表格收盘':<10} {'状态':<6}")
print("-" * 65)
for r in results:
    status = "✓" if r['match'] else "✗ MISMATCH"
    print(f"{r['file']:<20} {r['date']:<12} {r['cover_close']:<10.2f} {r['table_close']:<10.2f} {status}")

mismatches = [r for r in results if not r['match']]
if mismatches:
    print(f"\n发现 {len(mismatches)} 个不一致！")
else:
    print(f"\n所有复盘文件封面与表格数据一致。")
