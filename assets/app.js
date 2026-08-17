// ============ 通用：JSONP 调取东方财富公开接口（前端直连，绕开跨域） ============
function jsonp(url, cbName){
  return new Promise((resolve, reject)=>{
    const name = 'jp_' + Math.random().toString(36).slice(2);
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    let done = false;
    const cleanup = ()=>{ done = true; try{ delete window[name]; }catch(e){} if (script.parentNode) script.remove(); clearTimeout(timer); };
    const timer = setTimeout(()=>{ if(!done){ cleanup(); reject(new Error('请求超时')); } }, 12000);
    const script = document.createElement('script');
    window[name] = (d)=>{ if(done) return; cleanup(); resolve(d); };
    script.onerror = ()=>{ if(done) return; cleanup(); reject(new Error('接口加载失败')); };
    script.src = url + sep + (cbName || 'cb') + '=' + name;
    document.body.appendChild(script);
  });
}

// 股票代码 -> secid（沪市 1.x，深/北 0.x）
function toSecid(input){
  input = (input || '').trim();
  const m = input.match(/^(sh|sz|bj)?(\d{6})$/i);
  if(!m) return null;
  const num = m[2];
  const pre = (m[1] || '').toLowerCase();
  let mk;
  if(pre === 'sh') mk = 1;
  else if(pre === 'sz' || pre === 'bj') mk = 0;
  else mk = (num[0] === '6') ? 1 : 0;
  return mk + '.' + num;
}

const fmtNum = (v)=> (v == null || v === '' || isNaN(parseFloat(v))) ? '—' : Number(v).toLocaleString('zh-CN', {maximumFractionDigits:2});
const cls = (v)=> (parseFloat(v) >= 0) ? 'up' : 'down';
const sign = (v)=> (parseFloat(v) >= 0) ? '+' : '';
const fmtDateStr = (d)=> d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
// 生成最近 N 个交易日的日期列表（跳过周六周日）
function recentTradingDays(n){
  const out = [], today = new Date();
  for (let i = 0; i < 60 && out.length < n; i++){
    const d = new Date(today); d.setDate(today.getDate() - i);
    const day = d.getDay();
    if (day !== 0 && day !== 6) out.push(d);
  }
  return out;
}

// 股票代码 -> 腾讯代码（sh/sz/bj + 6位）
function toTencent(secid){
  const [mk, num] = secid.split('.');
  const pre = (mk === '1') ? 'sh' : (mk === '0' ? 'sz' : 'bj');
  return pre + num;
}

// ============ 行情 + K线 + 分时 ============
let __currentSecid = null;  // 记住当前查询的股票，供分时切换用

function loadQuote(){
  const secid = toSecid(document.getElementById('quoteInput').value);
  if(!secid){ document.getElementById('quoteInfo').innerHTML = '<div class="result">请输入 6 位股票代码，如 600519、000001、300750</div>'; return; }
  __currentSecid = secid;
  loadQuoteInfo(secid);
  // 根据当前选中的图表类型加载
  const mode = document.querySelector('.chart-tab.active')?.dataset.chart || 'kline';
  if(mode === 'trends'){ loadTrends(secid); } else { loadKline(toTencent(secid)); }
}

// 切换 日K / 分时
function switchChart(mode){
  document.querySelectorAll('.chart-tab').forEach(b=> b.classList.toggle('active', b.dataset.chart === mode));
  const chartEl = document.getElementById('klineChart');
  if(!__currentSecid){ chartEl.innerHTML = '<div class="result">请先输入股票代码查询</div>'; return; }
  if(mode === 'trends'){
    loadTrends(__currentSecid);
  } else {
    loadKline(toTencent(__currentSecid));
  }
}

// 行情（东方财富，JSONP）
function loadQuoteInfo(secid){
  const infoEl = document.getElementById('quoteInfo');
  infoEl.innerHTML = '<div class="result">加载中…</div>';
  const qUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f116,f117,f169,f170,f171&fltt=2&invt=2&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(qUrl).then(q=> renderQuote(q, secid)).catch(e=>{
    infoEl.innerHTML = '<div class="result">行情加载失败：' + e.message + '（非交易时段可能无实时数据）</div>';
  });
}

// K线（腾讯财经 K线 接口，支持 _callback JSONP）
function loadKline(tc){
  const chartEl = document.getElementById('klineChart');
  chartEl.innerHTML = '<div class="result">加载中…</div>';
  const kUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tc},day,,,320,qfq`;
  jsonp(kUrl, '_callback').then(k=> renderKline(k, tc)).catch(()=>{
    chartEl.innerHTML = '<div class="result">K线加载失败，请稍后重试</div>';
  });
}

// 分时图（东方财富 trends2 接口，支持 cb JSONP）
function loadTrends(secid){
  const chartEl = document.getElementById('klineChart');
  chartEl.innerHTML = '<div class="result">加载中…</div>';
  // trends2 返回当日分时走势（241 个分钟点），格式: "时间,开盘,最新,最高,最低,成交量,成交额,均价"
  const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(url).then(r=> renderTrends(r, secid)).catch(()=>{
    chartEl.innerHTML = '<div class="result">分时数据加载失败（仅交易日有数据）</div>';
  });
}

function renderQuote(q, secid){
  const d = q && q.data;
  const el = document.getElementById('quoteInfo');
  if(!d){ el.innerHTML = '<div class="result">未获取到数据</div>'; return; }
  const name = d.f58 || '';
  const code = d.f57 || secid.split('.')[1];
  const price = parseFloat(d.f43), pct = parseFloat(d.f170), chg = parseFloat(d.f171);
  const high = parseFloat(d.f44), low = parseFloat(d.f45), open = parseFloat(d.f46), pre = parseFloat(d.f60);
  const hsl = parseFloat(d.f59), pe = parseFloat(d.f169), mv = parseFloat(d.f116), fmv = parseFloat(d.f117);
  const c = isNaN(pct) ? '' : cls(pct);
  const y = (v)=> isNaN(v) ? '—' : v;
  el.innerHTML = `
    <div class="quote-card ${c}">
      <div class="qc-head">
        <span class="qc-name">${name}</span><span class="qc-code">${code}</span>
        <span class="qc-price ${c}">${y(price)}</span>
        <span class="qc-chg ${c}">${isNaN(pct)?'':sign(pct)+pct.toFixed(2)+'%'}</span>
      </div>
      <div class="qc-grid">
        <span>今开 <b>${y(open)}</b></span>
        <span>最高 <b>${y(high)}</b></span>
        <span>最低 <b>${y(low)}</b></span>
        <span>昨收 <b>${y(pre)}</b></span>
        <span>换手 <b>${isNaN(hsl)?'—':hsl.toFixed(2)+'%'}</b></span>
        <span>市盈率 <b>${isNaN(pe)?'—':pe.toFixed(2)}</b></span>
        <span>总市值 <b>${isNaN(mv)?'—':(mv/1e8).toFixed(2)+'亿'}</b></span>
        <span>流通市值 <b>${isNaN(fmv)?'—':(fmv/1e8).toFixed(2)+'亿'}</b></span>
      </div>
    </div>`;
}

function renderKline(k, tc){
  const el = document.getElementById('klineChart');
  const node = k && k.data && k.data[tc];
  const arr = node && (node.qfqday || node.day || node.bfqday);
  if(!arr || !arr.length){ el.innerHTML = '<div class="result">暂无 K 线数据</div>'; return; }
  const dates = [], ohlc = [];
  arr.forEach(row=>{
    dates.push(row[0]);
    ohlc.push([ +row[1], +row[2], +row[4], row[3] ]);
  });
  if(window.__chart){ try{ window.__chart.dispose(); }catch(e){} }
  const chart = echarts.init(el);
  window.__chart = chart;
  chart.setOption({
    grid: { left: 52, right: 14, top: 16, bottom: 48 },
    xAxis: { type:'category', data: dates, axisLabel:{ color:'#9ca3af', fontSize:11 }, axisLine:{ lineStyle:{color:'#e5e7eb'} } },
    yAxis: { scale:true, axisLabel:{ color:'#9ca3af', fontSize:11 }, splitLine:{ lineStyle:{color:'#f3f4f6'} } },
    tooltip: {
      trigger:'axis', axisPointer:{ type:'cross' },
      formatter: function(params){
        const p = params[0];
        return `<b>${p.axisValue}</b><br/>开盘：${p.data[0]}<br/>收盘：${p.data[1]}<br/>最低：${p.data[2]}<br/>最高：${p.data[3]}`;
      }
    },
    dataZoom: [{ type:'inside' }, { type:'slider', height:16, bottom:8 }],
    series: [{
      type:'candlestick', data: ohlc,
      itemStyle:{ color:'#e23b3b', color0:'#16a34a', borderColor:'#e23b3b', borderColor0:'#16a34a' }
    }]
  });
}

// 渲染分时图（东方财富 trends2 数据）
function renderTrends(r, secid){
  const el = document.getElementById('klineChart');
  const d = r && r.data;
  if(!d || !d.trends || !d.trends.length){
    // 尝试用腾讯行情里的分时数据（kline 接口附带 qt 字段）
    const tc = toTencent(secid);
    // 如果 trends2 没数据，用最近一根日K的均价画一条平线示意
    el.innerHTML = '<div class="result">暂无分时数据（非交易时段或已收盘，可查看日K线）</div>';
    return;
  }
  const name = d.name || '';
  const preClose = d.preClose || 0;
  const times = [], prices = [], avgPrices = [], vols = [];
  d.trends.forEach(line=>{
    const p = line.split(',');
    times.push(p[0].split(' ')[1] || p[0]);  // 取 "HH:MM" 部分
    const price = parseFloat(p[2]);           // 最新价 ≈ 收盘价
    const avg = parseFloat(p[7]);            // 均价
    const vol = parseFloat(p[5]);            // 成交量(手)
    prices.push(price);
    avgPrices.push(avg);
    vols.push(vol);
  });
  if(window.__chart){ try{ window.__chart.dispose(); }catch(e){} }
  const chart = echarts.init(el);
  window.__chart = chart;
  // 计算涨跌颜色
  const lastPrice = prices[prices.length - 1];
  const isUp = lastPrice >= preClose;
  const mainColor = isUp ? '#e23b3b' : '#16a34a';
  chart.setOption({
    grid: { left: 52, right: 14, top: 20, bottom: 48 },
    xAxis: {
      type:'category', data: times,
      axisLabel:{ color:'#9ca3af', fontSize:10, interval: 29 },
      axisLine:{ lineStyle:{color:'#e5e7eb'} }
    },
    yAxis: [
      { scale:false, position:'left', axisLabel:{ color:'#9ca3af', fontSize:11, formatter:(v)=> v.toFixed(2) }, splitLine:{ lineStyle:{color:'#f3f4f6'} } },
      { scale:false, position:'right', axisLabel:{ color:'#9ca3af', fontSize:11 }, splitLine:{ show:false } }
    ],
    tooltip: {
      trigger:'axis',
      formatter: function(params){
        const idx = params[0].dataIndex;
        return `<b>${times[idx]}</b><br/>价格：${prices[idx].toFixed(2)}<br/>均价：${avgPrices[idx].toFixed(2)}<br/>成交量：${vols[idx]} 手`;
      }
    },
    series: [
      {
        name:'价格', type:'line', data: prices,
        lineStyle:{ width:1.5, color:mainColor },
        itemStyle:{ color:mainColor },
        showSymbol:false,
        areaStyle:{ color: { type:'linear', x:0,y:0,x:0,y:1, colorStops:[{offset:0,color: isUp?'rgba(225,59,59,0.15)':'rgba(22,52,74,0.15)'},{offset:1,color:'transparent'}] } }
      },
      {
        name:'均价', type:'line', data: avgPrices,
        lineStyle:{ width:1, color:'#f59e0b', type:'dashed' },
        itemStyle:{ color:'#f59e0b' },
        showSymbol:false
      }
    ]
  });
}

// ============ 板块涨幅榜（点击展开个股排名） ============
function loadSectors(){
  const hy = document.getElementById('sectorHy');
  const gn = document.getElementById('sectorGn');
  hy.innerHTML = '<div class="result">加载中…</div>'; gn.innerHTML = '<div class="result">加载中…</div>';
  const mk = (fs, el)=>{
    // 获取板块列表，含板块代码 f104
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14,f3,f62,f104,f184&ut=fa5fd1943c7b386f172d6893b`;
    jsonp(url).then(r=>{
      const list = (r && r.data && r.data.diff) || [];
      if(!list.length){ el.innerHTML = '<div class="result">暂无数据</div>'; return; }
      el.innerHTML = list.map(it=>{
        const p = parseFloat(it.f3), net = parseFloat(it.f62), hs = parseFloat(it.f184);
        const bkCode = it.f104 || '';  // 板块代码，用于查成分股
        const name = it.f14 || '';
        return `<div class="rank-row sector-row" data-bk="${bkCode}" data-name="${name}" onclick="loadSectorStocks(this)">
          <span class="name">${name} <small class="muted sector-hint">点击展开个股 ▸</small></span>
          <span class="sub ${cls(net)}">主力 ${isNaN(net)?'—':sign(net)+(net/1e8).toFixed(2)+'亿'}</span>
          <span class="val ${cls(p)}">${isNaN(p)?'—':sign(p)+p.toFixed(2)+'%'}</span>
        </div>
        <div class="sector-stocks" id="stocks-${bkCode}"></div>`;
      }).join('');
    }).catch(()=>{ el.innerHTML = '<div class="result">板块加载失败</div>'; });
  };
  mk('m:90+t:2', hy);   // 行业板块
  mk('m:90+t:3', gn);   // 概念板块
}

// 点击板块 → 展开该板块内个股排名（按涨幅排序）
function loadSectorStocks(rowEl){
  const bkCode = rowEl.dataset.bk;
  const bkName = rowEl.dataset.name;
  const stocksEl = document.getElementById('stocks-' + bkCode);
  if(!stocksEl) return;
  // 已展开则收起
  if(stocksEl.classList.contains('open')){
    stocksEl.classList.remove('open');
    stocksEl.innerHTML = '';
    rowEl.querySelector('.sector-hint').textContent = '点击展开个股 ▸';
    return;
  }
  stocksEl.innerHTML = '<div class="result">加载个股中…</div>';
  stocksEl.classList.add('open');
  rowEl.querySelector('.sector-hint').textContent = '点击收起 ▾';
  // 用板块代码查成分股，按涨幅排序，取前15
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&fltt=2&invt=2&fid=f3&fs=bk:${bkCode}&fields=f12,f14,f3,f6,f16,f17,f20,f62,f184,f15&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(url).then(r=>{
    const list = (r && r.data && r.data.diff) || [];
    if(!list.length){ stocksEl.innerHTML = '<div class="result sector-empty">暂无成分股数据</div>'; return; }
    stocksEl.innerHTML = `<div class="sector-stocks-head">${bkName} · 成分股 Top15（按涨幅）</div>` +
      list.map(it=>{
        const p = parseFloat(it.f3), net = parseFloat(it.f62);
        const name = it.f14 || '', code = it.f12 || '';
        const price = parseFloat(it.f6);  // 最新价
        const mv = parseFloat(it.f20);     // 总市值(万)
        const turnover = parseFloat(it.f184); // 换手%
        const mvYi = isNaN(mv) ? '\u2014' : (mv / 1e8).toFixed(0) + '\u4ebf';
        const hsTxt = isNaN(turnover) ? '\u2014' : turnover.toFixed(2) + '%\u6362\u624b';
        return `<div class="rank-row stock-in-sector">
          <span class="name">${name} <small class="stock-code">${code}</small></span>
          <span class="sub">${isNaN(price)?'\u2014':price.toFixed(2)}</span>
          <span class="val ${cls(p)}">${isNaN(p)?'\u2014':sign(p)+p.toFixed(2)+'%'}</span>
          <span class="extra">${mvYi}  ${hsTxt}</span>
        </div>`;
      }).join('');
  }).catch(()=>{
    stocksEl.innerHTML = '<div class="result">个股加载失败</div>';
  });
}

// ============ 涨停（只显示真正涨停的股票，涨幅≥9.5%） ============
function loadZT(){
  const sum = document.getElementById('ztSummary');
  const list = document.getElementById('ztList');
  sum.innerHTML = '<div class="result">加载中…</div>'; list.innerHTML = '';
  // 实时涨幅池，客户端过滤涨停（涨幅>=9.5%）
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:80&fields=f12,f14,f3,f6,f62,f184,f2&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(url).then(r=>{
    const data = r && r.data;
    const diff = (data && data.diff) || [];
    if(!data || !diff.length){
      sum.innerHTML = '<div class="zt-bar">非交易时段暂无数据，交易日开盘后自动更新</div>';
      return;
    }
    // 过滤：只保留真正涨停的（主板≥9.5%，创业板/科创板≥19.5%）
    const ztList = diff.filter(it => {
      const p = parseFloat(it.f3);
      return p >= 9.5;  // 涨停阈值
    });
    if(!ztList.length){
      sum.innerHTML = '<div class="zt-bar">今日暂无涨停股（可能未开盘或已收盘）</div>';
      return;
    }
    sum.innerHTML = `<div class="zt-bar">今日涨停 <b>${ztList.length}</b> 家 ｜ 更新于 ${new Date().toLocaleTimeString('zh-CN')}</div>`;
    list.innerHTML = ztList.map(it=>{
      const name = it.f14 || '', code = it.f12 || '';
      const p = parseFloat(it.f3), price = parseFloat(it.f6);
      const net = parseFloat(it.f62), hs = parseFloat(it.f184);
      const amount = parseFloat(it.f2);  // 成交额
      const amtTxt = isNaN(amount) ? '\u2014' : (amount / 1e8).toFixed(2) + '\u4ebf';
      const hsTxt2 = isNaN(hs) ? '\u2014' : hs.toFixed(2) + '%\u6362\u624b';
      return `<div class="rank-row">
        <span class="name">${name} <small class="stock-code">${code}</small></span>
        <span class="sub">${isNaN(price)?'\u2014':price.toFixed(2)}</span>
        <span class="val ${cls(p)}">${isNaN(p)?'\u2014':sign(p)+p.toFixed(2)+'%'}</span>
        <span class="extra">${amtTxt}  ${hsTxt2}</span>
      </div>`;
    }).join('');
  }).catch(()=>{ sum.innerHTML = '<div class="result">涨停数据加载失败</div>'; });
}

// ============ 连板梯队（按连板高度分组展示） ============
function loadLadder(){
  const el = document.getElementById('ladderInfo');
  el.innerHTML = '<div class="result">加载中…</div>';
  // 取全部涨幅池，用于构建连板梯队
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=300&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:80&fields=f12,f14,f3,f6,f62,f184,f2&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(url).then(r=>{
    const diff = (r && r.data && r.data.diff) || [];
    if(!diff.length){
      el.innerHTML = '<div class="result">非交易时段暂无数据</div>';
      return;
    }
    // 筛选涨停股（涨幅>=9.5%）
    const ztStocks = diff.filter(it => parseFloat(it.f3) >= 9.5);
    if(!ztStocks.length){
      el.innerHTML = '<div class="ladder-empty">今日暂无涨停股，无法生成连板梯队</div>';
      return;
    }
    // 按涨幅分组模拟连板梯队
    const tier20cm = [], tier10cm = [], tierNear = [];
    ztStocks.forEach(it=>{
      const p = parseFloat(it.f3);
      if(p >= 19.8) tier20cm.push(it);       // 20cm涨停（创业板/科创板）
      else if(p >= 9.9) tier10cm.push(it);    // 10%涨停（主板封死）
      else tierNear.push(it);                  // 接近涨停
    });

    const renderTier = (title, stocks, colorClass)=>{
      if(!stocks.length) return '';
      return `<div class="ladder-tier">
        <div class="ladder-tier-title ${colorClass}">${title} <span class="ladder-count">${stocks.length}只</span></div>
        ${stocks.slice(0, 30).map(it=>{
          const name = it.f14||'', code = it.f12||'', p = parseFloat(it.f3);
          const price = parseFloat(it.f6), amt = parseFloat(it.f2);
          const amtTxt3 = isNaN(amt) ? '\u2014' : (amt / 1e8).toFixed(2) + '\u4ebf';
          return `<div class="rank-row ladder-stock">
            <span class="name">${name} <small class="stock-code">${code}</small></span>
            <span class="sub">${isNaN(price)?'\u2014':price.toFixed(2)}</span>
            <span class="val ${cls(p)}">${p.toFixed(2)}%</span>
            <span class="extra">${amtTxt3}</span>
          </div>`;
        }).join('')}
      </div>`;
    };

    el.innerHTML = `
      <div class="ladder-header">今日涨停共 <b>${ztStocks.length}</b> 只 ｜ ${new Date().toLocaleTimeString('zh-CN')}</div>
      ${renderTier('🔥 20cm 涨停（创业板/科创板）', tier20cm, 'tier-hot')}
      ${renderTier('📈 10cm 涨停（主板封死）', tier10cm, 'tier-up')}
      ${renderTier('⚡ 接近涨停（9.5%~9.9%）', tierNear, 'tier-near')}
      <div class="ladder-note">注：按涨幅区间分组近似连板高度，精确连板天数需专用数据源。交易时段自动更新。</div>
    `;
  }).catch(()=>{ el.innerHTML = '<div class="result">连板梯队加载失败</div>'; });
}

// ============ 实盘日记渲染（按周/月分组 + 折叠 + 倒序） ============
function fmtMD(d){ return (d.getMonth()+1).toString().padStart(2,"0") + "/" + d.getDate().toString().padStart(2,"0"); }

function groupLogs(logs, mode){
  const map = new Map();
  logs.forEach(l=>{
    const d = new Date(l.date + "T00:00:00");
    let key, label;
    if (mode === "month"){
      key = d.getFullYear() + "-" + d.getMonth();
      label = (d.getMonth()+1) + "月";
    } else if (mode === "week"){
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1 - day);
      const mon = new Date(d); mon.setDate(d.getDate() + diff);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      key = mon.toISOString().slice(0,10);
      label = "周 " + fmtMD(mon) + "–" + fmtMD(sun);
    } else {
      key = "all"; label = "全部";
    }
    if (!map.has(key)) map.set(key, { key, label, logs: [] });
    map.get(key).logs.push(l);
  });
  let arr = [...map.values()];
  if (mode !== "all") arr.sort((a,b)=> a.logs[0].date.localeCompare(b.logs[0].date));
  arr.forEach(g=>{
    const sumPct = g.logs.reduce((s,l)=> s + (l.dayPnl||0), 0);
    const c = sumPct >= 0 ? "up" : "down";
    g.rangeText = `区间 <span class="${c}">${sumPct>=0?"+":""}${sumPct.toFixed(2)}%</span>`;
  });
  if (mode !== "all") arr.reverse(); // 最新组在前
  return arr;
}

function renderDiary(){
  const listEl = document.getElementById("diaryList");
  const statsEl = document.getElementById("diaryStats");
  const logs = (typeof DAILY_LOG !== "undefined" ? DAILY_LOG : []).slice().sort((a,b)=> a.date.localeCompare(b.date));

  const wan = (v)=> (v/10000).toFixed(2) + "万";
  const yuan = (v)=> (v>=0?"+":"") + "¥" + Math.abs(v).toLocaleString("zh-CN",{maximumFractionDigits:0});
  const pct = (v)=> (v>=0?"+":"") + v.toFixed(2) + "%";
  const clsD = (v)=> v>=0 ? "up" : "down";
  const dayAmt = (l)=> (!l.total || !l.dayPnl) ? 0 : l.total * l.dayPnl/100/(1 + l.dayPnl/100);

  const days = logs.length;
  const latest = logs[days-1] || {};
  const best = logs.reduce((m,l)=> l.dayPnl>m.dayPnl?l:m, logs[0]||{dayPnl:0});
  const worst = logs.reduce((m,l)=> l.dayPnl<m.dayPnl?l:m, logs[0]||{dayPnl:0});
  statsEl.innerHTML = `
    <div class="stat"><div class="num">${days}</div><div class="lbl">记录天数</div></div>
    <div class="stat"><div class="num">${wan(latest.total||0)}</div><div class="lbl">最新总资产</div></div>
    <div class="stat"><div class="num ${clsD(best.dayPnl)}">${pct(best.dayPnl||0)}</div><div class="lbl">最佳单日</div></div>
    <div class="stat"><div class="num ${clsD(worst.dayPnl)}">${pct(worst.dayPnl||0)}</div><div class="lbl">最差单日</div></div>
  `;

  const prevSharesMap = {};
  for (let i = 0; i < logs.length; i++) {
    const d = logs[i];
    const m = {};
    (d.holdings||[]).forEach(h => { if (h.shares > 0) m[h.name] = h.shares; });
    prevSharesMap[d.date] = m;
  }

  const nameCode = (h)=> `${h.name}${h.code? '<span class="stock-code">('+h.code+')</span>' : ''}`;
  const cardHTML = (l)=>{
    const tradeMap = {};
    (l.trades||[]).forEach(t=>{ if (!tradeMap[t.name]) tradeMap[t.name] = []; tradeMap[t.name].push(t); });

    const holdRows = (l.holdings||[]).map(h=>{
      let amt = 0;
      if (h.shares && h.shares > 0 && h.cur && h.cost) {
        amt = h.shares * (h.cur - h.cost);
      } else if (h.mv && h.pnlPct) {
        amt = h.mv * h.pnlPct / 100;
      } else if (h.cur && h.cost) {
        const idx = logs.findIndex(d => d.date === l.date);
        if (idx > 0) {
          const prevDate = logs[idx - 1].date;
          const prevSh = (prevSharesMap[prevDate] || {})[h.name];
          if (prevSh > 0) { amt = prevSh * (h.cur - h.cost); }
        }
      }
      const tags = (tradeMap[h.name]||[]).map(t=>{
        const isBuy = t.action==="buy";
        const tag = isBuy ? (t.open?"新买":"加仓") : (t.close?"清仓":"减仓");
        const sh = t.shares ? t.shares.toLocaleString("zh-CN")+"股" : "";
        return `<span class="trade-inline ${isBuy?'ti-buy':'ti-sell'}">${tag}${sh}</span>`;
      }).join("");
      return `<tr>
        <td class="hold-name">${nameCode(h)}${tags ? " "+tags : ""}</td>
        <td data-label="股数">${h.shares? h.shares.toLocaleString("zh-CN") : "<span class=\"muted\">已清</span>"}</td>
        <td data-label="市值">${h.mv? "¥"+h.mv.toLocaleString("zh-CN",{maximumFractionDigits:0}) : "—"}</td>
        <td class="pnl-amt ${clsD(amt)}" data-label="盈亏金额">${yuan(amt)}</td>
        <td class="${clsD(h.pnlPct)}" data-label="盈亏%">${pct(h.pnlPct||0)}</td>
      </tr>`}).join("");

    const dAmt = dayAmt(l);
    return `<div class="diary-card">
      <div class="diary-head">
        <span class="diary-date">${l.date}</span>
        <span class="day-badge">第${l.day}天</span>
      </div>
      <div class="diary-meta">
        <span>总资产 <b>${wan(l.total||0)}</b></span>
        <span>仓位 <b>${l.pos}%</b></span>
        <span>当日盈亏 <b class="${clsD(dAmt)}">${yuan(dAmt)}</b></span>
      </div>
      ${holdRows? `<div class="diary-hold"><table class="hold-table">
        <thead><tr><th>持仓(代码)</th><th>股数</th><th>市值</th><th>盈亏金额</th><th>盈亏%</th></tr></thead>
        <tbody>${holdRows}</tbody></table></div>` : ""}
      ${l.note? `<div class="diary-note">${l.note}</div>` : ""}
    </div>`;
  };

  const mode = (window.__diaryMode || "week");
  const groups = groupLogs(logs, mode);
  let html = `<div class="diary-tabs">
      <button class="diary-tab ${mode==='week'?'active':''}" data-mode="week">按周</button>
      <button class="diary-tab ${mode==='month'?'active':''}" data-mode="month">按月</button>
      <button class="diary-tab ${mode==='all'?'active':''}" data-mode="all">全部</button>
    </div><div class="diary-groups">`;
  groups.forEach((g,i)=>{
    const open = (i === 0);
    html += `<div class="diary-group ${open?'open':''}">
      <button class="diary-group-head" type="button">
        <span class="dg-title">${g.label}</span>
        <span class="dg-meta">${g.logs.length}天 · ${g.rangeText}</span>
        <span class="dg-arrow">▾</span>
      </button>
      <div class="diary-group-body">${g.logs.slice().reverse().map(cardHTML).join("")}</div>
    </div>`;
  });
  html += `</div>`;
  listEl.innerHTML = html;

  listEl.querySelectorAll(".diary-tab").forEach(btn=>{
    btn.addEventListener("click", ()=> { window.__diaryMode = btn.dataset.mode; renderDiary(); history.replaceState(null, "", "#diary"); });
  });
  listEl.querySelectorAll(".diary-group-head").forEach(head=>{
    head.addEventListener("click", ()=> head.parentElement.classList.toggle("open"));
  });
}

// ============ 工具箱 Tab 切换（懒加载） ============
function initToolTabs(){
  document.querySelectorAll(".tool-tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tool-tab").forEach(b=> b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tool-panel").forEach(p=> p.style.display = "none");
      const panel = document.getElementById("panel-" + btn.dataset.tab);
      if(panel) panel.style.display = "";
      const t = btn.dataset.tab;
      if(t === "sector" && !window.__loadedSector){ loadSectors(); window.__loadedSector = true; }
      if(t === "zt" && !window.__loadedZT){ loadZT(); window.__loadedZT = true; }
      if(t === "ladder" && !window.__loadedLadder){ loadLadder(); window.__loadedLadder = true; }
      if(t === "calc" && !window.__initedCalc){ initCalc(); window.__initedCalc = true; }
      if(t === "quote" && window.__chart) window.__chart.resize();
    });
  });
}

// ============ 投资计算器（纯前端） ============
function initCalc(){
  document.querySelectorAll(".calc-tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".calc-tab").forEach(b=> b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".calc-panel").forEach(p=> p.style.display = "none");
      const p = document.getElementById("calc-" + btn.dataset.calc);
      if(p) p.style.display = "";
    });
  });
}
function num(id){ const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? NaN : v; }
function showCalc(elId, html){ const el = document.getElementById(elId); el.innerHTML = html; el.classList.add("show"); }
function fmtMoney(n){ return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }

function calcCompound(){
  const P = num("cpPrincipal"), r = num("cpRate"), y = num("cpYears"), m = num("cpFreq");
  if([P,r,y,m].some(isNaN) || P<=0 || y<=0 || m<=0){ showCalc("cpResult","请填写正确的正数参数"); return; }
  const rate = r/100/m;
  const total = m*y;
  const F = P * Math.pow(1+rate, total);
  const profit = F - P;
  const totalRate = (F/P - 1)*100;
  showCalc("cpResult",
    `期末总额：<b>¥${fmtMoney(F)}</b><br/>` +
    `累计收益：<span class="hl-up">+¥${fmtMoney(profit)}</span>（<span class="hl-up">+${totalRate.toFixed(1)}%</span>）<br/>` +
    `<span class="muted" style="font-size:13px">本金 ¥${fmtMoney(P)} · 年化 ${r}% · ${y}年 · 每年复利 ${m} 次</span>`);
}
function calcPosition(){
  const total = num("psTotal"), riskPct = num("psRisk"), buy = num("psBuy"), stop = num("psStop");
  if([total,riskPct,buy,stop].some(isNaN) || total<=0 || buy<=0){ showCalc("psResult","请填写正确的正数参数"); return; }
  if(stop >= buy){ showCalc("psResult","止损价必须低于买入价"); return; }
  const riskAmt = total * (riskPct/100);            // 愿意亏的钱
  const perShare = buy - stop;                       // 每股风险
  const invest = riskAmt / perShare * buy;           // 可投入金额
  let qty = Math.floor(invest / buy / 100) * 100;    // 向下取整到百股
  if(qty < 100) qty = 0;
  const actualInvest = qty * buy;
  showCalc("psResult",
    `单笔最大亏损额：<span class="hl-down">¥${fmtMoney(riskAmt)}</span><br/>` +
    `建议买入：<b>${qty} 股</b>（约 ¥${fmtMoney(actualInvest)}）<br/>` +
    `<span class="muted" style="font-size:13px">每股风险 ¥${perShare.toFixed(2)} · 占账户 ${(actualInvest/total*100).toFixed(1)}%</span>`);
}
function calcTP(){
  const buy = num("tpBuy"), up = num("tpUp"), down = num("tpDown"), lot = num("tpLot");
  if([buy,up,down,lot].some(isNaN) || buy<=0 || lot<=0){ showCalc("tpResult","请填写正确的正数参数"); return; }
  const tp = buy * (1 + up/100);
  const sl = buy * (1 - down/100);
  showCalc("tpResult",
    `止盈价：<span class="hl-up">¥${tp.toFixed(2)}</span>（每股 +¥${(tp-buy).toFixed(2)} / 每手 +¥${((tp-buy)*lot).toFixed(2)}）<br/>` +
    `止损价：<span class="hl-down">¥${sl.toFixed(2)}</span>（每股 -¥${(buy-sl).toFixed(2)} / 每手 -¥${((buy-sl)*lot).toFixed(2)}）<br/>` +
    `<span class="muted" style="font-size:13px">盈亏比 ${(up/down).toFixed(2)} : 1</span>`);
}
function calcPnL(){
  const buy = num("pnBuy"), sell = num("pnSell"), qty = num("pnQty"), fee = num("pnFee");
  if([buy,sell,qty,fee].some(isNaN) || buy<=0 || qty<=0){ showCalc("pnResult","请填写正确的正数参数"); return; }
  const cost = buy*qty;
  const proceeds = sell*qty;
  const feeAmt = (cost+proceeds) * (fee/1000);   // 双边手续费
  const pnl = proceeds - cost - feeAmt;
  const rate = pnl/cost*100;
  const cls = pnl>=0 ? "hl-up" : "hl-down";
  const sign = pnl>=0 ? "+" : "";
  showCalc("pnResult",
    `盈亏金额：<span class="${cls}">${sign}¥${fmtMoney(pnl)}</span><br/>` +
    `收益率：<span class="${cls}">${sign}${rate.toFixed(2)}%</span><br/>` +
    `<span class="muted" style="font-size:13px">手续费约 ¥${fmtMoney(feeAmt)}（单边 ${fee}‰）</span>`);
}

// ============ 用户体系 v2（邮箱验证码注册/登录 + 会员 + 评论 + 管理后台） ============
// 全部逻辑走 Supabase RPC（安全写在数据库函数里，前端不持有密钥）
const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";     // 你的 Supabase 项目地址
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";  // publishable key（前端公开，安全靠 RLS + RPC）
const USE_SUPABASE = /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON.length > 0;

const USER_TOKEN_KEY = "blys_user_token";
const ADMIN_TOKEN_KEY = "blys_admin_token";

// 调用 Supabase RPC
async function sbRpc(fn, params){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON },
    body: JSON.stringify(params || {})
  });
  return r.json();
}

// 简单 HTML 转义，防 XSS
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c])); }
function fmtDateTime(dt){
  const d = (typeof dt === "string") ? new Date(dt) : dt;
  if (!(d instanceof Date) || isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 当前登录用户
let __user = { loggedIn: false };

async function fetchUser(){
  const token = localStorage.getItem(USER_TOKEN_KEY);
  if (!token){ __user = { loggedIn: false }; renderUserStatus(); lockVipZones(); return; }
  try {
    const d = await sbRpc("get_profile", { p_token: token });
    if (d && d.ok){
      __user = { loggedIn: true, token, isVip: d.is_vip, isAdmin: d.is_admin, nickname: d.nickname, email: d.email, vipExpire: d.vip_expire };
    } else {
      localStorage.removeItem(USER_TOKEN_KEY);
      __user = { loggedIn: false };
    }
  } catch(e){ __user = { loggedIn: false }; }
  renderUserStatus();
  lockVipZones();
}

function isVIP(){ return __user.loggedIn && __user.isVip; }
function isAdmin(){ return __user.loggedIn && __user.isAdmin; }

function logoutUser(){
  localStorage.removeItem(USER_TOKEN_KEY);
  __user = { loggedIn: false };
  renderUserStatus();
  lockVipZones();
}

// 渲染右上角用户状态
function renderUserStatus(){
  const el = document.getElementById("vipStatus");
  if (!el) return;
  if (__user.loggedIn){
    const tag = __user.isVip ? `⭐ 会员至 ${fmtDateStr(new Date(__user.vipExpire))}` : "普通用户";
    let html = `<span class="vip-badge">${esc(__user.nickname || __user.email || "用户")} · ${tag}</span>`;
    if (__user.isAdmin) html += `<button class="vip-open" onclick="location.href='admin.html'">后台</button>`;
    html += `<button class="vip-logout" onclick="logoutUser()">退出</button>`;
    el.innerHTML = html;
  } else {
    el.innerHTML = `<button class="vip-open" onclick="openAuthModal()">登录/注册</button>`;
  }
}

// 根据会员状态锁定 / 解锁会员专属区块
function lockVipZones(){
  const member = isVIP();
  document.querySelectorAll(".vip-zone").forEach(z=>{
    z.classList.toggle("unlocked", member);
    z.classList.toggle("is-locked", !member);
  });
  document.querySelectorAll("[data-vip-course]").forEach(c=>{
    c.classList.toggle("is-locked", !member);
  });
}

// ---- 登录 / 注册弹窗 ----
function openAuthModal(){ const m = document.getElementById("authModal"); if (m) m.classList.add("open"); switchAuth("login"); }
function closeAuthModal(){ const m = document.getElementById("authModal"); if (m) m.classList.remove("open"); }
document.addEventListener("click", (e)=>{
  const m = document.getElementById("authModal");
  if (m && m.classList.contains("open") && e.target === m) closeAuthModal();
});

// 切换登录 / 注册 / 找回密码 三个视图
function switchAuth(mode){
  const tabs = { login: "authLogin", register: "authRegister", forgot: "authForgot" };
  Object.values(tabs).forEach(id=>{ const el = document.getElementById(id); if (el) el.style.display = "none"; });
  if (tabs[mode]){ const el = document.getElementById(tabs[mode]); if (el) el.style.display = "block"; }
  document.querySelectorAll(".auth-tab").forEach(b=> b.classList.toggle("active", b.dataset.mode === mode));
  // 清空各视图提示
  ["authMsg","regMsg","fgMsg"].forEach(id=>{ const m = document.getElementById(id); if (m){ m.textContent = ""; m.className = "result"; } });
}

// ---- 登录（邮箱 + 密码，无需验证码） ----
async function userLogin(){
  const email = (document.getElementById("authEmail").value || "").trim();
  const pwd   = (document.getElementById("authPwd").value || "");
  const msg = document.getElementById("authMsg");
  if (!email || !pwd){ msg.textContent = "请填写邮箱和密码"; return; }
  msg.textContent = "登录中…";
  try {
    const d = await sbRpc("user_login", { p_email: email, p_password: pwd });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "登录失败"; return; }
    localStorage.setItem(USER_TOKEN_KEY, d.token);
    msg.className = "result"; msg.innerHTML = "✅ 登录成功！";
    await fetchUser();
    setTimeout(closeAuthModal, 700);
  } catch(e){ msg.textContent = "网络错误，请重试"; }
}

// ---- 注册：第一步发验证码（仅注册需要） ----
async function regSend(){
  const email = (document.getElementById("regEmail").value || "").trim();
  const pwd   = (document.getElementById("regPwd").value || "");
  const msg = document.getElementById("regMsg");
  if (!email){ msg.textContent = "请填写邮箱"; return; }
  if (pwd.length < 6){ msg.textContent = "密码至少 6 位"; return; }
  msg.textContent = "发送中…";
  try {
    const d = await sbRpc("send_otp", { p_email: email, p_purpose: "register" });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "发送失败"; return; }
    msg.className = "result";
    msg.innerHTML = d.demo_code
      ? `✅ 验证码已发送（演示模式）：<b>${d.demo_code}</b>`
      : "✅ 验证码已发送，请查收邮箱";
    document.getElementById("regCodeRow").style.display = "block";
    document.getElementById("regSubmitBtn").style.display = "inline-block";
    document.getElementById("regSendBtn").style.display = "none";
  } catch(e){ msg.textContent = "网络错误，请重试"; }
}

// ---- 注册：第二步验证并创建账户 ----
async function regSubmit(){
  const email = (document.getElementById("regEmail").value || "").trim();
  const pwd   = (document.getElementById("regPwd").value || "");
  const nick  = (document.getElementById("regNick").value || "").trim();
  const code  = (document.getElementById("regCode").value || "").trim();
  const msg = document.getElementById("regMsg");
  if (!code){ msg.textContent = "请填写验证码"; return; }
  msg.textContent = "注册中…";
  try {
    const d = await sbRpc("register_user", { p_email: email, p_code: code, p_password: pwd, p_nickname: nick });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "注册失败"; return; }
    localStorage.setItem(USER_TOKEN_KEY, d.token);
    msg.className = "result"; msg.innerHTML = "✅ 注册成功，已自动登录！";
    await fetchUser();
    setTimeout(closeAuthModal, 800);
  } catch(e){ msg.textContent = "网络错误，请重试"; }
}

// ---- 找回密码：第一步发验证码 ----
async function fgSend(){
  const email = (document.getElementById("fgEmail").value || "").trim();
  const msg = document.getElementById("fgMsg");
  if (!email){ msg.textContent = "请填写邮箱"; return; }
  msg.textContent = "发送中…";
  try {
    const d = await sbRpc("send_otp", { p_email: email, p_purpose: "reset" });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "发送失败"; return; }
    msg.className = "result";
    msg.innerHTML = d.demo_code
      ? `✅ 验证码已发送（演示模式）：<b>${d.demo_code}</b>`
      : "✅ 验证码已发送，请查收邮箱";
    document.getElementById("fgCodeRow").style.display = "block";
    document.getElementById("fgPwdRow").style.display = "block";
    document.getElementById("fgSubmitBtn").style.display = "inline-block";
    document.getElementById("fgSendBtn").style.display = "none";
  } catch(e){ msg.textContent = "网络错误，请重试"; }
}

// ---- 找回密码：第二步重置 ----
async function fgSubmit(){
  const email = (document.getElementById("fgEmail").value || "").trim();
  const code  = (document.getElementById("fgCode").value || "").trim();
  const pwd   = (document.getElementById("fgPwd").value || "");
  const msg = document.getElementById("fgMsg");
  if (!code){ msg.textContent = "请填写验证码"; return; }
  if (pwd.length < 6){ msg.textContent = "新密码至少 6 位"; return; }
  msg.textContent = "重置中…";
  try {
    const d = await sbRpc("reset_password", { p_email: email, p_code: code, p_new_password: pwd });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "重置失败"; return; }
    msg.className = "result"; msg.innerHTML = "✅ 密码已重置，请用新密码登录";
    setTimeout(()=> switchAuth("login"), 1200);
  } catch(e){ msg.textContent = "网络错误，请重试"; }
}

// ---- 激活码兑换（已登录用户） ----
function openRedeemModal(){
  if (!__user.loggedIn){ openAuthModal(); return; }
  const m = document.getElementById("redeemModal"); if (m) m.classList.add("open");
}
function closeRedeemModal(){
  const m = document.getElementById("redeemModal"); if (m) m.classList.remove("open");
}
document.addEventListener("click", (e)=>{
  const m = document.getElementById("redeemModal");
  if (m && m.classList.contains("open") && e.target === m) closeRedeemModal();
});
async function doRedeem(){
  const code = (document.getElementById("redeemCode").value || "").trim().toUpperCase();
  const msg = document.getElementById("redeemMsg");
  if (!code){ msg.textContent = "请填写激活码"; return; }
  msg.textContent = "兑换中…";
  try {
    const d = await sbRpc("redeem_code", { p_token: __user.token, p_code: code });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "兑换失败"; return; }
    msg.className = "result";
    msg.innerHTML = `✅ 激活成功！会员至 ${fmtDateStr(new Date(d.vip_expire))}`;
    await fetchUser();
    setTimeout(closeRedeemModal, 1200);
  } catch(e){ msg.textContent = "网络错误"; }
}

// 会员专属内容点击门：会员放行，否则引导登录/兑换
function vipGate(label){
  if (isVIP()){ alert("会员已解锁：" + label); }
  else if (__user.loggedIn){ openRedeemModal(); }
  else { openAuthModal(); }
}

// ---- 评论系统（教程页调用） ----
async function loadComments(article){
  const box = document.getElementById("commentList");
  if (!box) return;
  box.innerHTML = '<p class="muted">加载评论…</p>';
  try {
    const d = await sbRpc("list_comments", { p_article: article });
    if (d && d.ok && Array.isArray(d.list)){
      if (d.list.length === 0){ box.innerHTML = '<p class="muted">还没有评论，来抢沙发～</p>'; return; }
      box.innerHTML = d.list.map(c => `<div class="comment-item">
        <div class="comment-head"><b>${esc(c.nickname || "匿名")}</b><span class="comment-time">${fmtDateTime(c.created_at)}</span></div>
        <div class="comment-body">${esc(c.content)}</div></div>`).join("");
    } else { box.innerHTML = '<p class="muted">评论加载失败</p>'; }
  } catch(e){ box.innerHTML = '<p class="muted">评论加载失败</p>'; }
}
async function submitComment(article){
  if (!__user.loggedIn){ openAuthModal(); return; }
  const ta = document.getElementById("commentInput");
  const content = (ta.value || "").trim();
  if (!content){ alert("写点什么再发吧"); return; }
  const btn = document.getElementById("commentBtn");
  try {
    const d = await sbRpc("add_comment", { p_token: __user.token, p_article: article, p_content: content });
    if (!d || !d.ok){ alert((d && d.msg) || "发送失败"); return; }
    ta.value = "";
    if (btn) btn.textContent = "已发送 ✓";
    loadComments(article);
    setTimeout(()=>{ if (btn) btn.textContent = "发表评论"; }, 1500);
  } catch(e){ alert("网络错误"); }
}

// ============ 在线人数（前端模拟，基于时段+随机波动） ============
(function(){
  const el = document.getElementById("onlineCounter");
  if (!el) return;
  const numEl = document.getElementById("onlineNum");
  // 基础人数：工作日白天高、夜间/周末低
  const h = new Date().getHours();
  const wd = [0,6].indexOf(new Date().getDay()) === -1; // 工作日
  let base = wd ? (h >= 9 && h <= 21 ? 45 : 18) : (h >= 10 && h <= 22 ? 28 : 12);
  // 从 localStorage 取偏移量（同设备稳定）
  const key = "blys_visit_seed";
  let seed = parseFloat(localStorage.getItem(key) || "0");
  if (seed === 0){ seed = Math.random() * 20 - 10; localStorage.setItem(key, seed.toFixed(2)); }
  base = Math.round(base + seed);
  base = Math.max(3, base);

  function show(n){
    if (numEl) numEl.textContent = n;
  }
  show(base);
  // 每 12~20 秒微调 ±1~3，模拟真实波动
  setInterval(()=>{
    base += Math.floor(Math.random() * 5) - 2; // -2 ~ +2
    base = Math.max(3, base);
    show(base);
  }, 12000 + Math.random() * 8000);
})();

// ============ 导航 & 初始化 ============
// 滚动时给导航加阴影
(function(){
  const nav = document.querySelector(".nav");
  if (!nav) return;
  const onScroll = () => { nav.classList.toggle("scrolled", window.scrollY > 20); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("navToggle").addEventListener("click", ()=> {
  document.getElementById("navLinks").classList.toggle("open");
});
initToolTabs();
renderDiary();
fetchUser();
