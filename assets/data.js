// ============================================================
//  实盘日记数据源（每日账户快照，由持仓截图自动识别整理）
//  字段：date 日期 / day 第几天 / total 总资产(元)
//        dayPnl 当日盈亏% / pos 仓位% / floatPnl 浮动盈亏(元)
//        cash 可用资金(元) / holdings 当日持仓明细 / note 备注
//  注意：部分日期截图可能涉及不同券商账户，请以实盘为准。
// ============================================================

const DAILY_LOG = [
  {
    "date": "2026-07-27",
    "day": 1,
    "total": 500488.29,
    "dayPnl": 0.11,
    "pos": 76.7,
    "floatPnl": 488.29,
    "cash": 116393.29,
    "holdings": [
      {
        "name": "江波龙",
        "shares": 500,
        "mv": 186950.0,
        "pnlPct": 0.283,
        "cost": 372.845,
        "cur": 373.9,
        "code": "301308"
      },
      {
        "name": "雅克科技",
        "shares": 600,
        "mv": 101610.0,
        "pnlPct": -0.02,
        "cost": 169.384,
        "cur": 169.35,
        "code": "002409"
      },
      {
        "name": "金安国纪",
        "shares": 1500,
        "mv": 95535.0,
        "pnlPct": -0.02,
        "cost": 63.703,
        "cur": 63.69,
        "code": "002636"
      }
    ],
    "note": "建仓前/预备日，持仓3只（江波龙、雅克科技、金安国纪），仓位76.7%。总资产数值部分被遮挡，根据可用资金+持仓市值估算。",
    "valid": true,
    "trades": []
  },
  {
    "date": "2026-07-28",
    "day": 2,
    "total": 490578.05,
    "dayPnl": -1.92,
    "pos": 19.4,
    "floatPnl": -9421.95,
    "cash": 395560.05,
    "holdings": [
      {
        "name": "风华高科",
        "shares": 2200,
        "mv": 95018.0,
        "pnlPct": -2.415,
        "cost": 44.259,
        "cur": 43.19,
        "code": "000636"
      },
      {
        "name": "金安国纪",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": -3.29,
        "cost": 63.703,
        "cur": 57.32,
        "code": "002636"
      },
      {
        "name": "江波龙",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": -3.714,
        "cost": 372.845,
        "cur": 330.0,
        "code": "301308"
      },
      {
        "name": "雅克科技",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 2.948,
        "cost": 169.384,
        "cur": 166.43,
        "code": "002409"
      }
    ],
    "note": "实盘第1天，大幅减仓至19.4%，仅风华高科持有中(2200股)，其余3只已清仓但保留盈亏记录。当日亏损-1.92%。另含国泰海通证券账户截图（非平安证券主账户）。",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "风华高科",
        "code": "000636",
        "shares": 2200,
        "open": true,
        "close": false
      },
      {
        "action": "sell",
        "name": "金安国纪",
        "code": "002636",
        "shares": 1500,
        "close": true
      },
      {
        "action": "sell",
        "name": "江波龙",
        "code": "301308",
        "shares": 500,
        "close": true
      },
      {
        "action": "sell",
        "name": "雅克科技",
        "code": "002409",
        "shares": 600,
        "close": true
      }
    ]
  },
  {
    "date": "2026-07-29",
    "day": 3,
    "total": 507716.52,
    "dayPnl": 3.51,
    "pos": 85.0,
    "floatPnl": 14787.0,
    "cash": 76358.62,
    "holdings": [
      {
        "name": "通信ETF富国",
        "shares": 152700,
        "mv": 227064.9,
        "pnlPct": 2.673,
        "cost": 1.448,
        "cur": 1.487,
        "code": "159583"
      },
      {
        "name": "风华高科",
        "shares": 4300,
        "mv": 204293.0,
        "pnlPct": 4.542,
        "cost": 45.446,
        "cur": 47.51,
        "code": "000636"
      }
    ],
    "note": "加仓至85%仓位！新买入通信ETF富国152700股+加仓风华高科至4300股(可用2200股)。当日大赚+3.51%。另含国泰海通证券账户截图。",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "通信ETF富国",
        "code": "159583",
        "shares": 152700,
        "open": true,
        "close": false
      },
      {
        "action": "buy",
        "name": "风华高科",
        "code": "000636",
        "shares": 2100,
        "open": false,
        "close": false
      }
    ]
  },
  {
    "date": "2026-07-30",
    "day": 4,
    "total": 514591.41,
    "dayPnl": 1.4,
    "pos": 40.6,
    "floatPnl": 21661.89,
    "cash": 305551.41,
    "holdings": [
      {
        "name": "风华高科",
        "shares": 4000,
        "mv": 209040.0,
        "pnlPct": 13.275,
        "cost": 46.135,
        "cur": 52.26,
        "code": "000636"
      },
      {
        "name": "通信ETF富国",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": -1.283,
        "cost": 1.448,
        "cur": 1.411,
        "code": "159583"
      }
    ],
    "note": "减仓至40.6%！风华高科涨停(+10%)继续持有4000股，通信ETF已清仓。风华高科累计盈利+13.28%。",
    "valid": true,
    "trades": [
      {
        "action": "sell",
        "name": "风华高科",
        "code": "000636",
        "shares": 300,
        "close": false
      },
      {
        "action": "sell",
        "name": "通信ETF富国",
        "code": "159583",
        "shares": 152700,
        "close": true
      }
    ]
  },
  {
    "date": "2026-07-31",
    "day": 5,
    "total": 511985.74,
    "dayPnl": 1.46,
    "pos": 40.6,
    "floatPnl": 21892.71,
    "cash": 303901.74,
    "holdings": [
      {
        "name": "贤丰控股",
        "shares": 20000,
        "mv": 112400.0,
        "pnlPct": 2.722,
        "cost": 5.471,
        "cur": 5.62,
        "code": "002141"
      },
      {
        "name": "恒尚节能",
        "shares": 3800,
        "mv": 95684.0,
        "pnlPct": -11.2,
        "cost": 28.356,
        "cur": 25.18,
        "code": "603137"
      },
      {
        "name": "风华高科",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 13.832,
        "cost": 46.135,
        "cur": 49.33,
        "code": "000636"
      },
      {
        "name": "科创半导体设备ETF",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 4.595,
        "cost": 2.868,
        "cur": 2.855,
        "code": "588710"
      }
    ],
    "note": "调仓换股！新买入贤丰控股20000股和恒尚节能3800股，风华高科和科创半导体ETF已清仓。恒尚节能亏损-11.2%需关注。文件夹含多张小红书评论截图（非持仓数据）。另含国泰海通证券账户截图。",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "贤丰控股",
        "code": "002141",
        "shares": 20000,
        "open": true,
        "close": false
      },
      {
        "action": "buy",
        "name": "恒尚节能",
        "code": "603137",
        "shares": 3800,
        "open": true,
        "close": false
      },
      {
        "action": "sell",
        "name": "风华高科",
        "code": "000636",
        "shares": 4000,
        "close": true
      }
    ]
  },
  {
    "date": "2026-08-03",
    "day": 6,
    "total": 852512.5,
    "dayPnl": 0.57,
    "pos": 41.8,
    "floatPnl": 154745.06,
    "cash": 496270.5,
    "holdings": [
      {
        "name": "长电科技",
        "shares": 4800,
        "mv": 84869.07,
        "pnlPct": 47.391,
        "cost": 37.309,
        "cur": 54.99,
        "code": "600584"
      },
      {
        "name": "紫光股份",
        "shares": 2800,
        "mv": 69875.99,
        "pnlPct": 306.42,
        "cost": 8.144,
        "cur": 33.1,
        "code": "000938"
      }
    ],
    "note": "主账户持仓截图；另有第二账户(**5362)截图：总资产约50.9万，浮亏-11599.29，当日盈亏-1238(-0.24%)，持仓中国卫星/贤丰控股(已清仓)/恒大新能(已清仓)",
    "valid": true,
    "trades": []
  },
  {
    "date": "2026-08-04",
    "day": 7,
    "total": 856416.5,
    "dayPnl": 0.41,
    "pos": 42.0,
    "floatPnl": 158209.06,
    "cash": 496270.5,
    "holdings": [
      {
        "name": "长电科技",
        "shares": 4800,
        "mv": 84917.07,
        "pnlPct": 47.418,
        "cost": 37.309,
        "cur": 55.0,
        "code": "600584"
      },
      {
        "name": "紫光股份",
        "shares": 2800,
        "mv": 73291.99,
        "pnlPct": 321.4,
        "cost": 8.144,
        "cur": 34.32,
        "code": "000938"
      }
    ],
    "note": "主账户持仓截图；另有第二账户截图：总资产516721.96，浮盈+9581.57，当日盈亏+7245(+1.42%)，仓位41.9%，仅持中国卫星3500股；含1张聊天截图(已跳过)",
    "valid": true,
    "trades": []
  },
  {
    "date": "2026-08-05",
    "day": 8,
    "total": 861125.92,
    "dayPnl": 0.64,
    "pos": 63.97,
    "floatPnl": 162968.48,
    "cash": 310133.92,
    "holdings": [
      {
        "name": "紫光股份",
        "shares": 10800,
        "mv": 398952.0,
        "pnlPct": 25.196,
        "cost": 29.506,
        "cur": 36.94,
        "code": "000938"
      },
      {
        "name": "长鑫科技",
        "shares": 2800,
        "mv": 152040.0,
        "pnlPct": 119.201,
        "cost": 24.772,
        "cur": 54.3,
        "code": "688825"
      }
    ],
    "note": "主账户(**3538)持仓截图；另有第二账户(**5362)截图：总资产524598.03，浮盈+17457.64，当日盈亏+7915(+1.53%)，可用105564.03，持仓中国卫星3500股/行云科技2700股/风华高科1700股",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "紫光股份",
        "code": "000938",
        "shares": 8000,
        "open": false,
        "close": false
      },
      {
        "action": "buy",
        "name": "长鑫科技",
        "code": "688825",
        "shares": 2800,
        "open": true,
        "close": false
      },
      {
        "action": "sell",
        "name": "长电科技",
        "code": "600584",
        "shares": 4800,
        "close": true
      }
    ]
  },
  {
    "date": "2026-08-06",
    "day": 9,
    "total": 865291.74,
    "dayPnl": 0.51,
    "pos": 25.4,
    "floatPnl": 167080.3,
    "cash": 645185.74,
    "holdings": [
      {
        "name": "紫光股份",
        "shares": 5800,
        "mv": 220252.0,
        "pnlPct": 66.967,
        "cost": 22.723,
        "cur": 37.94,
        "code": "000938"
      },
      {
        "name": "长电科技",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 21.092,
        "cost": 24.772,
        "cur": 51.96,
        "code": "600584"
      }
    ],
    "note": "主账户持仓截图(长电科技已清仓)；另有第二账户(**5362)截图：全部清仓(仓位0%)，总资产约53万，浮盈+21965.66，当日盈亏+4807(+0.92%)；含3张非持仓图(聊天截图x2+局部截图x1，已跳过)",
    "valid": true,
    "trades": [
      {
        "action": "sell",
        "name": "紫光股份",
        "code": "000938",
        "shares": 5000,
        "close": false
      },
      {
        "action": "sell",
        "name": "长鑫科技",
        "code": "688825",
        "shares": 2800,
        "close": true
      }
    ]
  },
  {
    "date": "2026-08-07",
    "day": 10,
    "total": 884811.98,
    "dayPnl": 2.26,
    "pos": 50.6,
    "floatPnl": 107732.71,
    "cash": 436761.98,
    "holdings": [
      {
        "name": "联瑞新材",
        "shares": 1500,
        "mv": 227550.0,
        "pnlPct": 9.177,
        "cost": 138.949,
        "cur": 151.7,
        "code": "688300"
      },
      {
        "name": "紫光股份",
        "shares": 5800,
        "mv": 220400.0,
        "pnlPct": 67.231,
        "cost": 22.723,
        "cur": 38.0,
        "code": "000938"
      }
    ],
    "note": "主账户(**3538)持仓截图(新增联瑞新材)；另有第二账户(**5362)截图：满仓99.7%，总资产约53.7万，浮盈+8284.46，当日盈亏+8392(+1.59%)，持仓云路诸业2100股/景嘉微2200股/风华高科2000股；含同花顺日历收益图和两张日历截图(辅助参考)",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "联瑞新材",
        "code": "688300",
        "shares": 1500,
        "open": true,
        "close": false
      }
    ]
  },
  {
    "date": "2026-08-10",
    "day": 11,
    "total": 552976.43,
    "dayPnl": 2.99,
    "pos": 99.98,
    "floatPnl": 23870.38,
    "cash": 98.03,
    "holdings": [
      {
        "name": "国瓷材料",
        "shares": 3000,
        "mv": 228330.0,
        "pnlPct": 3.026,
        "cost": 73.875,
        "cur": 76.11,
        "code": "300285"
      },
      {
        "name": "科创半导体ETF华夏",
        "shares": 211600,
        "mv": 221968.4,
        "pnlPct": 1.467,
        "cost": 1.034,
        "cur": 1.049,
        "code": "588170"
      },
      {
        "name": "云南锗业",
        "shares": 1000,
        "mv": 102580.0,
        "pnlPct": 11.117,
        "cost": 92.317,
        "cur": 102.58,
        "code": "002428"
      },
      {
        "name": "风华高科",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 0.229,
        "cost": 56.331,
        "cur": 61.7,
        "code": "000636"
      },
      {
        "name": "景旺电子",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 1.644,
        "cost": 94.97,
        "cur": 96.0,
        "code": "603228"
      }
    ],
    "note": "含资产分析页（当日+2.99%）与持仓页。风华高科、景旺电子持仓为0，显示历史盈亏。仓位按总市值/总资产推算。",
    "valid": true,
    "trades": []
  },
  {
    "date": "2026-08-11",
    "day": 12,
    "total": 551038.04,
    "dayPnl": -0.29,
    "pos": 37.0,
    "floatPnl": 18238.38,
    "cash": 346974.04,
    "holdings": [
      {
        "name": "国瓷材料",
        "shares": 2800,
        "mv": 204064.0,
        "pnlPct": 4.992,
        "cost": 69.415,
        "cur": 72.88,
        "code": "300285"
      },
      {
        "name": "云南锗业",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 3.846,
        "cost": 92.317,
        "cur": 100.28,
        "code": "002428"
      },
      {
        "name": "科创半导体ETF华夏",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 0.285,
        "cost": 1.034,
        "cur": 1.018,
        "code": "588170"
      }
    ],
    "note": "总资产、总市值数字被隐私码遮挡，已按持仓市值加总与可用资金反推。截图显示当日参考盈亏-1,609.20/-0.29%，资产分析页同日为-0.35%。",
    "valid": true,
    "trades": [
      {
        "action": "sell",
        "name": "国瓷材料",
        "code": "300285",
        "shares": 200,
        "close": false
      },
      {
        "action": "sell",
        "name": "云南锗业",
        "code": "002428",
        "shares": 1000,
        "close": true
      },
      {
        "action": "sell",
        "name": "科创半导体ETF华夏",
        "code": "588170",
        "shares": 211600,
        "close": true
      }
    ]
  },
  {
    "date": "2026-08-12",
    "day": 13,
    "total": 558354.92,
    "dayPnl": 1.34,
    "pos": 99.8,
    "floatPnl": 17019.66,
    "cash": 1314.92,
    "holdings": [
      {
        "name": "国瓷材料",
        "shares": 2800,
        "mv": 207200.0,
        "pnlPct": 6.606,
        "cost": 69.415,
        "cur": 74.0,
        "code": "300285"
      },
      {
        "name": "东山精密",
        "shares": 1000,
        "mv": 200190.0,
        "pnlPct": 1.091,
        "cost": 198.03,
        "cur": 200.19,
        "code": "002384"
      },
      {
        "name": "行云科技",
        "shares": 4100,
        "mv": 149650.0,
        "pnlPct": 1.369,
        "cost": 36.007,
        "cur": 36.5,
        "code": "300209"
      }
    ],
    "note": "总资产、总市值数字被隐私码遮挡，已按持仓市值加总与可用资金反推。",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "东山精密",
        "code": "002384",
        "shares": 1000,
        "open": true,
        "close": false
      },
      {
        "action": "buy",
        "name": "行云科技",
        "code": "300209",
        "shares": 4100,
        "open": true,
        "close": false
      }
    ]
  },
  {
    "date": "2026-08-13",
    "day": 14,
    "total": 564895.65,
    "dayPnl": 1.25,
    "pos": 25.0,
    "floatPnl": 23560.39,
    "cash": 423535.65,
    "holdings": [
      {
        "name": "利欧股份",
        "shares": 15000,
        "mv": 83400.0,
        "pnlPct": -2.304,
        "cost": 5.691,
        "cur": 5.56,
        "code": "002131"
      },
      {
        "name": "恒尚节能",
        "shares": 2000,
        "mv": 57960.0,
        "pnlPct": -10.019,
        "cost": 32.207,
        "cur": 28.98,
        "code": "603137"
      },
      {
        "name": "国瓷材料",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 4.535,
        "cost": 64.282,
        "cur": 70.66,
        "code": "300285"
      },
      {
        "name": "东山精密",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 5.183,
        "cost": 198.03,
        "cur": 202.11,
        "code": "002384"
      },
      {
        "name": "行云科技",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": 7.903,
        "cost": 36.007,
        "cur": 35.35,
        "code": "300209"
      }
    ],
    "note": "总资产、总市值数字被隐私码遮挡，已按持仓市值加总与可用资金反推。国瓷材料、东山精密、行云科技持仓为0，显示历史盈亏。",
    "valid": true,
    "trades": [
      {
        "action": "buy",
        "name": "利欧股份",
        "code": "002131",
        "shares": 15000,
        "open": true,
        "close": false
      },
      {
        "action": "buy",
        "name": "恒尚节能",
        "code": "603137",
        "shares": 2000,
        "open": true,
        "close": false
      },
      {
        "action": "sell",
        "name": "国瓷材料",
        "code": "300285",
        "shares": 2800,
        "close": true
      },
      {
        "action": "sell",
        "name": "东山精密",
        "code": "002384",
        "shares": 1000,
        "close": true
      },
      {
        "action": "sell",
        "name": "行云科技",
        "code": "300209",
        "shares": 4100,
        "close": true
      }
    ]
  },
  {
    "date": "2026-08-14",
    "day": 15,
    "total": 558520.54,
    "dayPnl": -1.11,
    "pos": 0.0,
    "floatPnl": -14795.7,
    "cash": 558520.54,
    "holdings": [
      {
        "name": "恒尚节能",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": -14.706,
        "cost": 32.207,
        "cur": 26.08,
        "code": "603137"
      },
      {
        "name": "利欧股份",
        "shares": 0,
        "mv": 0.0,
        "pnlPct": -6.236,
        "cost": 5.691,
        "cur": 5.33,
        "code": "002131"
      }
    ],
    "note": "含持仓页（仓位0%，已全部清仓）与资产分析页（当日-1.11%）。",
    "valid": true,
    "trades": [
      {
        "action": "sell",
        "name": "恒尚节能",
        "code": "603137",
        "shares": 2000,
        "close": true
      },
      {
        "action": "sell",
        "name": "利欧股份",
        "code": "002131",
        "shares": 15000,
        "close": true
      }
    ]
  }
];
