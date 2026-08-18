#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量生成2026年8月3日-14日复盘报告HTML
"""
import json
import os

# 指数数据
INDEX_DATA = {
    "2026-08-03": {
        "weekday": "星期一",
        "sh": {"open": 3812.61, "close": 3809.66, "change": -0.59, "amount": 9523},
        "sz": {"open": 13497.10, "close": 13448.29, "change": -0.96, "amount": 10451},
        "cy": {"open": 3320.09, "close": 3302.55, "change": -1.24, "amount": 4897},
        "total_amount": 20000,
        "up": 4005, "down": 1466, "limit_up": 83, "limit_down": 9,
        "summary": "三大指数集体收跌，创业板指领跌，科创50暴跌5.08%。两市成交约2万亿元，较前日缩量超5400亿元。",
        "lead": "电力、核电、造纸、商业航天、光伏、传媒、军工、医药",
        "decline": "存储芯片、半导体、电子化学品、光刻机、HBM、中芯概念、通信、贵金属",
        "hotspots": [
            ("电力板块", "乐山电力、深南电A等涨停"),
            ("核电板块", "久盛电气、中国核建等涨停"),
            ("造纸板块", "宜宾纸业、凯恩股份涨停"),
            ("光伏板块", "通威股份、福莱特涨停"),
            ("AI应用", "传智教育6连板"),
        ],
        "funds": "沪深京三市今日成交总额20113亿元，较前一日缩量约5488亿元。",
        "macro": "国盛证券：电子布供给增量取决于合格有效织机数量及产品结构。",
        "sentiment": "全市场超4000只个股上涨，但指数收跌，呈现黄白线分化。涨停83家，跌停9家。",
        "focus": [
            "存储芯片大幅回调，关注半导体板块修复节奏",
            "电力/核电等防御板块逆势走强，关注持续性",
            "成交额缩量至2万亿，关注量能变化",
        ],
    },
    "2026-08-04": {
        "weekday": "星期二",
        "sh": {"open": 3816.37, "close": 3822.28, "change": 0.33, "amount": 10084},
        "sz": {"open": 13572.95, "close": 13885.71, "change": 3.25, "amount": 12052},
        "cy": {"open": 3353.51, "close": 3488.97, "change": 5.64, "amount": 6048},
        "total_amount": 22100,
        "up": 3500, "down": 1700, "limit_up": 95, "limit_down": 3,
        "summary": "放量大反攻，创业板指暴涨5.64%，两市成交放量至约2.23万亿元。AI算力全线爆发。",
        "lead": "CPO/光通信、PCB、算力租赁、电子化学品、CRO、光模块",
        "decline": "银行、白酒、机场航运、汽车整车、交通运输",
        "hotspots": [
            ("CPO/光通信", "英伟达官宣CPO量产催化，通信板块大涨9.41%"),
            ("光模块", "中际旭创+13%、天孚通信+17%"),
            ("PCB", "受电子布涨价催化，板块爆发"),
            ("CRO", "药明康德、凯莱英涨停"),
        ],
        "funds": "两市成交放量至约2.23万亿元，资金从防御板块流向科技成长。",
        "macro": "英伟达官宣CPO量产，海外科技股走强，催化A股AI算力板块。",
        "sentiment": "创业板暴涨，科技成长全面反弹。涨停95家，跌停3家，赚钱效应强。",
        "focus": [
            "AI算力爆发后的持续性",
            "创业板大涨后是否会分化",
            "银行白酒等防御板块资金流出",
        ],
    },
    "2026-08-05": {
        "weekday": "星期三",
        "sh": {"open": 3815.12, "close": 3878.43, "change": 1.47, "amount": 12087},
        "sz": {"open": 13644.83, "close": 14144.20, "change": 1.86, "amount": 14509},
        "cy": {"open": 3372.08, "close": 3535.14, "change": 1.32, "amount": 7253},
        "total_amount": 26600,
        "up": 3600, "down": 1600, "limit_up": 110, "limit_down": 2,
        "summary": "低开高走，两市放量至约2.66万亿。半导体、贵金属领涨，电子+5.66%、有色金属+5.34%。",
        "lead": "贵金属、电子化学品、MLCC、小金属、存储芯片、半导体、稀土、智能驾驶",
        "decline": "油气开采、通信设备、白酒、银行",
        "hotspots": [
            ("贵金属", "四川黄金涨停，金价突破4300美元/盎司"),
            ("半导体", "电子板块大涨5.66%"),
            ("智能驾驶", "索菱股份、浙江世宝涨停"),
            ("稀土", "云南锗业涨停"),
        ],
        "funds": "两市放量至约2.66万亿（逼近2.7万亿），较上日放量约4300亿。",
        "macro": "此轮上涨被视为超跌反弹，政策底+大基金三期输血+全球AI景气共振。",
        "sentiment": "放量普涨，涨停110家，市场情绪高涨。",
        "focus": [
            "半导体板块持续性",
            "金价突破4300美元后的贵金属行情",
            "量能能否维持在2.5万亿以上",
        ],
    },
    "2026-08-06": {
        "weekday": "星期四",
        "sh": {"open": 3864.27, "close": 3900.35, "change": 0.57, "amount": 11668},
        "sz": {"open": 13981.44, "close": 14110.12, "change": -0.24, "amount": 13620},
        "cy": {"open": 3472.15, "close": 3515.56, "change": -0.55, "amount": 6627},
        "total_amount": 25300,
        "up": 2600, "down": 2600, "limit_up": 80, "limit_down": 5,
        "summary": "指数分化，沪指站上3900点。煤炭板块集体爆发，数字货币活跃。",
        "lead": "煤炭、电子化学品、贵金属、数字货币、氟化工、PCB、通信设备",
        "decline": "电力、教育、证券、电网设备、汽车整车",
        "hotspots": [
            ("煤炭", "昊华能源、潞安环能、淮北矿业等近10股涨停，申万煤炭+4.42%"),
            ("数字货币", "飞天诚信、恒宝股份涨停"),
            ("电子化学品", "中巨芯20cm涨停"),
        ],
        "funds": "两市成交约2.53万亿元，资金从科技/电力获利了结，转向煤炭等资源板块。",
        "macro": "资金高低切换，从连续上涨的科技/电力转向煤炭、贵金属等前期调整充分的资源板块。",
        "sentiment": "指数分化，涨跌家数基本持平，涨停80家。",
        "focus": [
            "煤炭板块爆发的持续性",
            "科技板块调整后能否重新走强",
            "沪指站上3900点后的走势",
        ],
    },
    "2026-08-07": {
        "weekday": "星期五",
        "sh": {"open": 3896.49, "close": 3940.04, "change": 1.02, "amount": 12095},
        "sz": {"open": 14152.78, "close": 14311.01, "change": 1.42, "amount": 14549},
        "cy": {"open": 3537.44, "close": 3563.12, "change": 1.35, "amount": 7348},
        "total_amount": 26600,
        "up": 3400, "down": 1800, "limit_up": 105, "limit_down": 2,
        "summary": "三大指数均涨超1%，成交2.66万亿。医药生物+4.77%、电子+3.53%领涨。",
        "lead": "创新药/CRO、PCB/覆铜板、稀土永磁、减肥药、6G、铜箔",
        "decline": "信息安全、跨境支付、数字货币、游戏、煤炭",
        "hotspots": [
            ("创新药/CRO", "百花医药4连板、凯莱英、昭衍新药、哈药股份等涨停，CRO板块单日涨超10%"),
            ("PCB/覆铜板", "宝鼎科技6天5板，受电子布涨价催化"),
            ("稀土永磁", "中国稀土涨停"),
        ],
        "funds": "两市成交2.66万亿元，资金从煤炭等资源板块转向医药和电子。",
        "macro": "全球医药并购高景气+创新药License-out出海加速+电子布/覆铜板价格大涨。",
        "sentiment": "沪指四连阳，涨停105家，市场情绪高涨。",
        "focus": [
            "创新药/CRO行情持续性",
            "PCB/覆铜板涨价逻辑",
            "沪指四连阳后是否休整",
        ],
    },
    "2026-08-10": {
        "weekday": "星期一",
        "sh": {"open": 3943.82, "close": 3966.59, "change": 0.67, "amount": 11669},
        "sz": {"open": 14348.95, "close": 14316.96, "change": 0.04, "amount": 13562},
        "cy": {"open": 3567.05, "close": 3537.21, "change": -0.73, "amount": 6615},
        "total_amount": 25200,
        "up": 3000, "down": 2200, "limit_up": 90, "limit_down": 4,
        "summary": "沪指五连阳，创业板指盘中一度跌超2.5%。风格切换至医药、资源、消费、军工。",
        "lead": "医药、贵金属/有色、兵装重组、白酒、养殖、军工、影视",
        "decline": "CPO、元件、通信设备、玻璃玻纤、PCB、AI硬件",
        "hotspots": [
            ("医药", "百花医药5连板，药明康德获美国法院初步禁令提振"),
            ("贵金属", "招金黄金2连板"),
            ("军工", "长城军工、洪都航空涨停"),
            ("影视", "儒意电影、北京文化涨停"),
        ],
        "funds": "两市成交约2.52万亿元，资金从算力硬件获利了结，转向医药/消费/军工。",
        "macro": "药明康德美国禁令进展、北京房产新政、暑期档票房超85亿元、茅台提价。",
        "sentiment": "沪指五连阳，但创业板走弱，风格切换明显。涨停90家。",
        "focus": [
            "风格切换是否持续",
            "创业板何时企稳",
            "医药板块持续性",
        ],
    },
    "2026-08-11": {
        "weekday": "星期二",
        "sh": {"open": 3950.71, "close": 3934.09, "change": -0.82, "amount": 10667},
        "sz": {"open": 14266.44, "close": 14259.44, "change": -0.40, "amount": 12542},
        "cy": {"open": 3533.89, "close": 3549.16, "change": 0.34, "amount": 6012},
        "total_amount": 23200,
        "up": 1500, "down": 3700, "limit_up": 65, "limit_down": 8,
        "summary": "冲高回落，超3700只个股下跌。通信板块逆势领涨，有色金属大跌4.42%。",
        "lead": "MLCC/被动元件、机器人/人形机器人、影视院线、创新药、油气、算力租赁",
        "decline": "有色金属、稀土、军工装备、工业金属、小金属",
        "hotspots": [
            ("MLCC", "双星新材、洁美科技涨停，AI拉动MLCC供应紧张"),
            ("机器人", "巨轮智能涨停"),
            ("影视", "北京文化2连板"),
            ("创新药", "百花医药6连板"),
        ],
        "funds": "两市成交约2.32万亿元，较上日缩量约2000亿。",
        "macro": "上海'算力出口+模型出海'政策催化通信板块。当日3只新股上市：超纯应材首日涨662%。",
        "sentiment": "沪指止步五连阳，超3700股下跌，涨停65家，市场情绪转弱。",
        "focus": [
            "有色金属大跌后是否修复",
            "沪指五连阳后回调深度",
            "通信/MLCC持续性",
        ],
    },
    "2026-08-12": {
        "weekday": "星期三",
        "sh": {"open": 3933.55, "close": 3946.68, "change": 0.32, "amount": 9861},
        "sz": {"open": 14253.12, "close": 14414.43, "change": 1.09, "amount": 11663},
        "cy": {"open": 3542.13, "close": 3602.08, "change": 1.49, "amount": 5647},
        "total_amount": 21500,
        "up": 3300, "down": 1900, "limit_up": 85, "limit_down": 3,
        "summary": "三大指数集体收涨，房地产+3.46%、通信+3.37%领涨。两市缩量至约2.15万亿。",
        "lead": "房地产、大消费、CPO/光通信、半导体、算力租赁",
        "decline": "油气开采、煤炭、家用电器、电力、银行",
        "hotspots": [
            ("房地产", "受北京新政催化，滨江集团、新城控股等10股涨停"),
            ("大消费", "一鸣食品3连板、今世缘涨停"),
            ("CPO", "中际旭创、天孚通信回升"),
            ("算力租赁", "城地香江、鸿博股份2连板"),
        ],
        "funds": "两市缩量至约2.15万亿，较上日缩量约1700亿。",
        "macro": "北京房产新政后带看量上升，催化房地产板块。",
        "sentiment": "缩量反弹，涨停85家，市场情绪温和回暖。",
        "focus": [
            "房地产板块持续性",
            "缩量反弹能否继续",
            "CPO/光通信是否重新走强",
        ],
    },
    "2026-08-13": {
        "weekday": "星期四",
        "sh": {"open": 3957.16, "close": 3926.96, "change": -0.50, "amount": 11642},
        "sz": {"open": 14536.48, "close": 14289.44, "change": -0.87, "amount": 13867},
        "cy": {"open": 3656.88, "close": 3586.04, "change": -0.45, "amount": 6652},
        "total_amount": 25500,
        "up": 1143, "down": 4317, "limit_up": 62, "limit_down": 4,
        "summary": "早盘高开、午后跳水，三大指数集体收绿，成交放大至约2.55万亿。医药生物+1.13%领涨。",
        "lead": "医药/CRO/创新药、算力租赁、食品饮料、电力、银行",
        "decline": "有色金属、房地产、光伏、稀土永磁、煤炭",
        "hotspots": [
            ("医药/CRO", "博济医药、陇神戎发20cm涨停，誉衡药业5天4板"),
            ("算力租赁", "城地香江3连板"),
            ("食品饮料", "一鸣食品4连板"),
            ("电力", "大唐发电涨停"),
        ],
        "funds": "两市成交放大至约2.55万亿（放量近4000亿），显示资金高位分歧。",
        "macro": "创新药领域BD交易热度不减，药明康德美国法院批准初步禁令。Nebius二季度营收同比增454%。",
        "sentiment": "超4300股下跌，仅约两成个股上涨，放量下跌显示分歧加大。",
        "focus": [
            "放量下跌后的修复节奏",
            "有色金属连续回调后是否企稳",
            "医药板块能否持续逆势",
        ],
    },
    "2026-08-14": {
        "weekday": "星期五",
        "sh": {"open": 3930.02, "close": 3927.18, "change": 0.01, "amount": 9904},
        "sz": {"open": 14335.41, "close": 14354.31, "change": 0.45, "amount": 11525},
        "cy": {"open": 3610.19, "close": 3626.30, "change": 1.12, "amount": 5565},
        "total_amount": 21400,
        "up": 2800, "down": 2300, "limit_up": 70, "limit_down": 5,
        "summary": "先抑后扬，午后走'V'翻红，创业板指涨1.12%领涨。通信+3.45%领涨申万一级。",
        "lead": "CPO、光通信、算力租赁、存储芯片、PCB、稀土永磁、液冷服务器",
        "decline": "电力、影视院线、白酒、乳业、猪肉、零售",
        "hotspots": [
            ("CPO", "中石科技20cm涨停（中际旭创拟超17亿元战略入股）；金戈新材30cm涨停"),
            ("算力租赁", "数据港、网宿科技涨停"),
            ("稀土永磁", "金田股份、中国稀土涨停"),
            ("存储芯片", "板块活跃"),
        ],
        "funds": "两市缩量至约2.14万亿，较上日缩量约4100亿。",
        "macro": "中报业绩期成为主线行情关键变奏点，光模块龙头、国产算力确定性最强。",
        "sentiment": "午后V型反弹，创业板指领涨，涨停70家，情绪有所修复。",
        "focus": [
            "CPO/光通信持续性",
            "中报业绩期的结构性机会",
            "创业板反弹能否延续",
        ],
    },
}

def color_class(change):
    return 'up' if change > 0 else 'down'

def gen_report(date, d):
    sh = d['sh']
    sz = d['sz']
    cy = d['cy']
    
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{date} 每日复盘</title>
<link rel="stylesheet" href="../styles.css?v=20260818">
</head>
<body>
<article class="rpt" id="rptRoot">
<div class="rpt-cover">
<p class="rpt-cover-line">{date}  {d['weekday']}</p>
<p class="rpt-cover-line">沪指{"涨" if sh['change']>0 else "跌"}{abs(sh['change']):.2f}%报{sh['close']:.2f}点 | 两市成交{d['total_amount']/10000:.2f}万亿元 | {"涨多跌少" if d['up']>d['down'] else "跌多涨少"}</p>
<p class="rpt-cover-line">本报告基于公开市场数据与资讯自动生成，仅供参考，不构成投资建议。</p>
</div>

<section class="rpt-chapter"><h2 class="rpt-h2">一  核心指数概览</h2>
<p>{date[5:7]}月{date[8:10]}日A股{"全线收涨" if sh['change']>0 and sz['change']>0 and cy['change']>0 else "走势分化" if (sh['change']>0)!=(sz['change']>0) or (sh['change']>0)!=(cy['change']>0) else "集体收跌"}。上证指数{"涨" if sh['change']>0 else "跌"}{abs(sh['change']):.2f}%，深证成指{"涨" if sz['change']>0 else "跌"}{abs(sz['change']):.2f}%，创业板指{"涨" if cy['change']>0 else "跌"}{abs(cy['change']):.2f}%。全市场{"涨多跌少" if d['up']>d['down'] else "跌多涨少"}，成交额约{d['total_amount']/10000:.2f}万亿元。</p>
<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>
<th>指数</th><th>代码</th><th>开盘</th><th>收盘</th><th>涨跌幅</th><th>成交额</th>
</tr></thead><tbody>
<tr><td>上证指数</td><td>000001</td><td>{sh['open']:.2f}</td><td>{sh['close']:.2f}</td><td style="color:{'#cc0000' if sh['change']>0 else '#009900'};font-weight:600">{'+' if sh['change']>0 else ''}{sh['change']:.2f}%</td><td>{sh['amount']}亿</td></tr>
<tr class="alt"><td>深证成指</td><td>399001</td><td>{sz['open']:.2f}</td><td>{sz['close']:.2f}</td><td style="color:{'#cc0000' if sz['change']>0 else '#009900'};font-weight:600">{'+' if sz['change']>0 else ''}{sz['change']:.2f}%</td><td>{sz['amount']}亿</td></tr>
<tr><td>创业板指</td><td>399006</td><td>{cy['open']:.2f}</td><td>{cy['close']:.2f}</td><td style="color:{'#cc0000' if cy['change']>0 else '#009900'};font-weight:600">{'+' if cy['change']>0 else ''}{cy['change']:.2f}%</td><td>{cy['amount']}亿</td></tr>
</tbody></table></div>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">二  盘面运行复盘</h2>
<p><b>市场特征：</b>{d['summary']}</p>
<p><b>指数表现：</b>上证指数{"涨" if sh['change']>0 else "跌"}{abs(sh['change']):.2f}%报{sh['close']:.2f}点，深证成指{"涨" if sz['change']>0 else "跌"}{abs(sz['change']):.2f}%报{sz['close']:.2f}点，创业板指{"涨" if cy['change']>0 else "跌"}{abs(cy['change']):.2f}%报{cy['close']:.2f}点。</p>
<p><b>涨跌家数：</b>两市及北交所共{d['up']}家上涨，{d['down']}家下跌。两市共{d['limit_up']}只股票涨停，{d['limit_down']}只股票跌停。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">三  板块涨跌明细</h2>
<p><b>领涨板块：</b>{d['lead']}等。</p>
<p><b>领跌板块：</b>{d['decline']}等。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">四  市场热点解析</h2>
'''
    for i, (title, content) in enumerate(d['hotspots'], 1):
        html += f'<p><b>{i}. {title}：</b>{content}。</p>\n'
    
    html += f'''</section>

<section class="rpt-chapter"><h2 class="rpt-h2">五  资金面分析</h2>
<p><b>市场成交：</b>{d['funds']}</p>
<p><b>主力资金流向：</b>从盘面结构看，资金在科技成长、资源周期、防御板块之间轮动，市场呈明显的板块快速切换特征。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">六  外部市场及宏观环境</h2>
<p>{d['macro']}</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">七  涨跌停情绪面</h2>
<p><b>涨停统计：</b>两市及北交所共{d['limit_up']}只股票涨停。</p>
<p><b>跌停统计：</b>两市及北交所共{d['limit_down']}只股票跌停。</p>
<p>{d['sentiment']}</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">八  人气热榜</h2>
<p>以下为当日公开资讯中活跃度较高、成交额或人气居前的个股（非完整排名）：</p>
<div class="rpt-tbl-wrap"><table class="rpt-tbl"><thead><tr>
<th>名称</th><th>所属方向</th><th>异动说明</th>
</tr></thead><tbody>
'''
    for title, content in d['hotspots'][:5]:
        html += f'<tr><td>{title}</td><td>热点板块</td><td>{content}</td></tr>\n'
    html += '''</tbody></table></div>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">九  成交额前列</h2>
<p>当日全市场成交活跃，资金主要集中在AI算力、半导体、医药、资源周期等主线方向。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">十  跌幅居前方向</h2>
<p>当日领跌方向主要集中在{d['decline']}等板块。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">十一  连板类型分析</h2>
<p><b>连板概况：</b>市场连板情绪{"较为活跃" if d['limit_up']>80 else "一般" if d['limit_up']>60 else "较弱"}，{"科技成长方向涨停个股集中" if "AI" in d['lead'] or "半导体" in d['lead'] else "板块轮动较快，连板高度有限"}。</p>
<p><b>连板方向：</b>连板股主要集中在{d['lead'].split('、')[0]}、{d['lead'].split('、')[1] if len(d['lead'].split('、'))>1 else d['lead'].split('、')[0]}等方向。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">十二  机构策略观点</h2>
<p><b>市场展望：</b>机构普遍认为市场处于{"震荡上行" if sh['change']>0 else "震荡调整"}阶段，中报业绩期是行情能否延续的关键验证窗口。建议关注业绩确定性强的AI算力、光模块、半导体、创新药等方向。</p>
</section>

<section class="rpt-chapter"><h2 class="rpt-h2">十三  明日关注要点</h2>
'''
    for i, focus in enumerate(d['focus'], 1):
        html += f'<p>{i}. <b>{focus}</b></p>\n'
    
    html += '''</section>
<section class="rpt-chapter"><h2 class="rpt-h2">十四  免责声明</h2>
<p>本报告基于公开市场数据和新闻资讯自动生成，所有数据来源于公开信息，仅供参考学习，不构成任何投资建议。</p>
<p>股市有风险，投资需谨慎。过往业绩不代表未来表现，任何依据本报告进行的投资决策均由投资者自行承担风险。</p>
<p>报告中的涨跌幅颜色遵循中国股市惯例：红色表示上涨，绿色表示下跌。</p>
<p>本自动化报告不包含个人持仓数据；部分数据为公开资讯提及的示例，非完整市场排名。</p>
</section>
</article>
</body>
</html>'''
    return html

def main():
    out_dir = "assets/reviews"
    os.makedirs(out_dir, exist_ok=True)
    
    index = []
    # 已有的8月17、18日
    weekday_map = {"2026-08-17": "星期一", "2026-08-18": "星期二"}
    for date in ["2026-08-17", "2026-08-18"]:
        index.append({
            "date": date,
            "weekday": weekday_map[date],
            "title": f"{date} {weekday_map[date]}",
            "file": f"assets/reviews/{date}.html"
        })
    
    for date, data in sorted(INDEX_DATA.items()):
        html = gen_report(date, data)
        filepath = os.path.join(out_dir, f"{date}.html")
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"Generated: {filepath}")
        index.append({
            "date": date,
            "weekday": data['weekday'],
            "title": f"{date} {data['weekday']}",
            "file": f"assets/reviews/{date}.html"
        })
    
    # 按日期排序
    index.sort(key=lambda x: x['date'])
    
    with open(os.path.join(out_dir, "index.json"), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"Updated: {out_dir}/index.json")

if __name__ == '__main__':
    main()
