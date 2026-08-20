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

// 由股票代码直接查询（供星标"查看行情"调用）
function loadQuoteByCode(code){
  if(!code) return;
  document.getElementById('quoteInput').value = code;
  // 切换到行情 Tab
  document.querySelectorAll('.tool-tab').forEach(b=> b.classList.toggle('active', b.dataset.tab === 'quote'));
  document.querySelectorAll('.tool-panel').forEach(p=> p.style.display = (p.id === 'panel-quote') ? '' : 'none');
  loadQuote();
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

// ============ 市场工具：非交易时段判断 + 数值防御 + 星标 ============
function isMarketOpen(){
  const d = new Date();
  const day = d.getDay();
  if(day === 0 || day === 6) return false;          // 周末休市
  const t = d.getHours()*60 + d.getMinutes();
  const morning   = t >= 9*60+15 && t <= 11*60+30;  // 9:15-11:30
  const afternoon = t >= 13*60    && t <= 15*60;     // 13:00-15:00
  return morning || afternoon;
}
const MARKET_HINT = '<div class="zt-bar" style="background:#f1f5f9;border-color:#e2e8f0;color:#475569">📴 当前为非交易时段，交易日 9:15–15:00 开盘后自动更新行情</div>';
let marketStats = {};  // 累计各函数统计，分别更新；空对象=未加载→显示占位符

// 东方财富 clist 字段：f2=最新价, f3=涨跌幅%, f6=成交额(元), f62=主力净流入, f184=换手%, f107=连板天数
function pickPrice(it){ return parseFloat(it.f2); }
function pickAmount(it){ return parseFloat(it.f6) || parseFloat(it.f21) || 0; }  // 成交额兜底
function fmtYi(v){ if(!v || isNaN(v)) return '—'; return (v/1e8).toFixed(2) + '亿'; }

// ============ 重点观察（星标，存 localStorage） ============
const WATCH_KEY = 'blys_watchlist';
function getWatch(){ try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); } catch(e){ return []; } }
function isWatched(code){ return getWatch().some(s => s.code === code); }
function toggleWatch(code, name){
  let list = getWatch();
  const i = list.findIndex(s => s.code === code);
  const nowOn = i < 0;
  if(nowOn) list.push({ code, name: name || '' }); else list.splice(i, 1);
  localStorage.setItem(WATCH_KEY, JSON.stringify(list));
  document.querySelectorAll('.star-btn[data-code="'+code+'"]').forEach(b=>{
    b.classList.toggle('on', nowOn);
    b.textContent = nowOn ? '★' : '☆';
  });
  return nowOn;
}
function starHtml(code, name){
  const on = isWatched(code);
  const nm = (name||'').replace(/'/g, "\\'");
  return `<span class="star-btn ${on?'on':''}" data-code="${code}" data-name="${nm}" onclick="toggleWatch('${code}','${nm}')" title="加入重点观察">${on?'★':'☆'}</span>`;
}
function renderWatch(){
  const el = document.getElementById('watchList'); if(!el) return;
  const list = getWatch();
  if(!list.length){ el.innerHTML = '<div class="result">还没有星标股票，点击行情列表里的 ☆ 即可加入重点观察</div>'; return; }
  el.innerHTML = list.map(s=>{
    const nm = (s.name||'').replace(/'/g, "\\'");
    return `<div class="rank-row watch-item">
      <span class="star-btn on" data-code="${s.code}" data-name="${nm}" onclick="toggleWatch('${s.code}','${nm}')">★</span>
      <span class="name">${s.name||'—'} <small class="stock-code">${s.code}</small></span>
      <span class="sub"><a href="javascript:void(0)" onclick="loadQuoteByCode('${s.code}')">查看行情</a></span>
    </div>`;
  }).join('');
}

// ============ 市场总览统计卡 ============
function renderMarketStats(stats){
  const el = document.getElementById('marketStats'); if(!el) return;
  const loaded = stats && Object.keys(stats).length > 0;
  if(!loaded){
    el.innerHTML = ['今日涨停','最高连板','上涨板块','非ST涨停'].map(t=>
      `<div class="stat-card"><b>—</b><label>${t}</label></div>`).join('');
    return;
  }
  el.innerHTML = `
    <div class="stat-card"><b>${stats.zt||0}</b><label>今日涨停(家)</label></div>
    <div class="stat-card"><b>${stats.maxBoard||0}</b><label>最高连板</label></div>
    <div class="stat-card"><b>${stats.upSector||0}</b><label>上涨板块</label></div>
    <div class="stat-card"><b>${stats.strong||0}</b><label>非ST涨停</label></div>`;
}

// ============ 板块涨幅榜（点击展开个股排名） ============
function loadSectors(){
  const hy = document.getElementById('sectorHy');
  const gn = document.getElementById('sectorGn');
  if(!isMarketOpen()){
    hy.innerHTML = MARKET_HINT; gn.innerHTML = MARKET_HINT;
    return;
  }
  hy.innerHTML = '<div class="result">加载中…</div>'; gn.innerHTML = '<div class="result">加载中…</div>';
  const mk = (fs, el)=>{
    // 获取板块列表，f104=板块代码(如BK0426)，f105=板块类型
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14,f3,f62,f104,f105,f184&ut=fa5fd1943c7b386f172d6893b`;
    jsonp(url).then(r=>{
      const list = (r && r.data && r.data.diff) || [];
      if(!list.length){ el.innerHTML = '<div class="result">暂无数据</div>'; return; }
      // 统计上涨板块数（行业+概念分别统计后累加）
      const up = list.filter(it => parseFloat(it.f3) > 0).length;
      marketStats.upSector = (marketStats.upSector || 0) + up;
      renderMarketStats(marketStats);
      el.innerHTML = list.map(it=>{
        const p = parseFloat(it.f3), net = parseFloat(it.f62), hs = parseFloat(it.f184);
        const bkCode = (it.f104 || '').trim();  // 板块代码，如 BK0426
        const name = it.f14 || '';
        // 只有有板块代码的才可点击展开
        const clickable = !!bkCode;
        const hint = clickable ? '点击展开个股 ▸' : '暂无成分股';
        return `<div class="rank-row sector-row ${clickable?'':'sector-disabled'}" data-bk="${bkCode}" data-name="${name}" ${clickable?'onclick="loadSectorStocks(this)"':''}>
          <span class="name">${name} <small class="sector-hint">${hint}</small></span>
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
  if(!bkCode){ return; }
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
    if(!list.length){
      // 备用方案：用板块名搜索相关个股
      stocksEl.innerHTML = '<div class="result sector-empty">该板块暂无成分股数据（可能接口更新中）</div>';
      return;
    }
    stocksEl.innerHTML = `<div class="sector-stocks-head">${bkName} · 成分股 Top15（按涨幅）</div>` +
      list.map(it=>{
        const p = parseFloat(it.f3), net = parseFloat(it.f62);
        const name = it.f14 || '', code = it.f12 || '';
        const price = parseFloat(it.f6);
        const mv = parseFloat(it.f20);
        const turnover = parseFloat(it.f184);
        const mvYi = isNaN(mv) ? '\u2014' : (mv / 1e8).toFixed(0) + '\u4ebf';
        const hsTxt = isNaN(turnover) ? '\u2014' : turnover.toFixed(2) + '%';
        return `<div class="rank-row stock-in-sector">
          ${starHtml(code, name)}
          <span class="name">${name} <small class="stock-code">${code}</small></span>
          <span class="sub">${isNaN(price)?'\u2014':price.toFixed(2)}</span>
          <span class="val ${cls(p)}">${isNaN(p)?'\u2014':sign(p)+p.toFixed(2)+'%'}</span>
          <span class="extra">${mvYi}  ${hsTxt}</span>
        </div>`;
      }).join('');
  }).catch((err)=>{
    console.error('板块成分股加载失败:', err);
    stocksEl.innerHTML = '<div class="result">个股加载失败（请稍后重试）</div>';
  });
}

// ============ 涨停（东方财富涨停板标签池 m:0+t:81+s:2048，精准只含涨停股） ============
function loadZT(){
  const sum = document.getElementById('ztSummary');
  const list = document.getElementById('ztList');
  if(!isMarketOpen()){
    sum.innerHTML = MARKET_HINT;
    list.innerHTML = '<div class="result">📴 非交易时段不展示涨停数据</div>';
    return;
  }
  sum.innerHTML = '<div class="result">加载中…</div>'; list.innerHTML = '';
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=600&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:81+s:2048&fields=f12,f14,f3,f6,f62,f184,f107&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(url).then(r=>{
    const diff = (r && r.data && r.data.diff) || [];
    if(!diff.length){ sum.innerHTML = '<div class="zt-bar">今日涨停数据为空（可能未开盘或已收盘）</div>'; return; }
    const ztList = diff.map(it=>({
      code: it.f12||'', name: it.f14||'',
      p: parseFloat(it.f3), price: pickPrice(it), amt: pickAmount(it),
      hs: parseFloat(it.f184), boards: parseInt(it.f107,10) || 1
    })).filter(s=> !isNaN(s.p));
    const strong = ztList.filter(s=> !/ST|退/.test(s.name)).length;
    marketStats.zt = ztList.length;
    marketStats.strong = strong;
    renderMarketStats(marketStats);

    const render = (filter)=>{
      const arr = filter==='all' ? ztList
        : filter==='first' ? ztList.filter(s=> s.boards<=1)
        : ztList.filter(s=> s.boards >= parseInt(filter,10));
      if(!arr.length){ list.innerHTML = '<div class="result">无符合条件的涨停股</div>'; return; }
      list.innerHTML = arr.map(s=>`<div class="rank-row">
        ${starHtml(s.code, s.name)}
        <span class="name">${s.name} <small class="stock-code">${s.code}</small></span>
        <span class="sub">${isNaN(s.price)?'—':s.price.toFixed(2)}</span>
        <span class="val ${cls(s.p)}">${sign(s.p)+s.p.toFixed(2)}%</span>
        <span class="extra">${fmtYi(s.amt)}  ${isNaN(s.hs)?'—':s.hs.toFixed(2)+'%换'}</span>
      </div>`).join('');
    };
    sum.innerHTML = `<div class="zt-bar">今日涨停 <b>${ztList.length}</b> 家（非ST <b>${strong}</b> 家） ｜ 更新于 ${new Date().toLocaleTimeString('zh-CN')}
      <select class="zt-filter" onchange="window.__ztFilter=this.value;window.__ztRender()">
        <option value="all">全部连板</option>
        <option value="3">≥3连板</option>
        <option value="2">≥2连板</option>
        <option value="first">仅首板</option>
      </select></div>`;
    window.__ztFilter = 'all';
    window.__ztRender = ()=> render(window.__ztFilter);
    window.__ztRender();
  }).catch(()=>{ sum.innerHTML = '<div class="result">涨停数据加载失败</div>'; });
}

// ============ 连板梯队（按连板天数从高到低：9连板→…→首板） ============
function loadLadder(){
  const el = document.getElementById('ladderInfo');
  if(!isMarketOpen()){
    el.innerHTML = MARKET_HINT;
    return;
  }
  el.innerHTML = '<div class="result">加载中…</div>';
  // 东方财富涨停板标签池，f107=连板天数，f2=最新价，f6=成交额
  const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=600&po=1&np=1&fltt=2&invt=2&fid=f107&fs=m:0+t:81+s:2048&fields=f12,f14,f3,f6,f62,f184,f107&ut=fa5fd1943c7b386f172d6893b`;
  jsonp(url).then(r=>{
    const diff = (r && r.data && r.data.diff) || [];
    if(!diff.length){
      el.innerHTML = '<div class="ladder-empty">今日暂无涨停股，无法生成连板梯队</div>';
      return;
    }
    const tiers = {};
    let maxBoard = 1;
    diff.forEach(it=>{
      const boards = parseInt(it.f107, 10) || 1;
      const p = parseFloat(it.f3);
      if(isNaN(p)) return;
      if(boards > maxBoard) maxBoard = boards;
      const key = boards >= 2 ? boards + '连板' : '首板';
      (tiers[key] = tiers[key] || []).push({
        code: it.f12||'', name: it.f14||'',
        p, price: pickPrice(it), amt: pickAmount(it)
      });
    });
    marketStats.maxBoard = maxBoard;
    renderMarketStats(marketStats);

    // 排序：连板天数从高到低（9连板→...→首板）
    const sortedKeys = Object.keys(tiers).sort((a,b)=>{
      const na = parseInt(a,10)||1, nb = parseInt(b,10)||1;
      return nb - na;
    });

    const renderTier = (key, stocks)=>{
      const count = stocks.length;
      let titleClass = 'tier-up';
      if(key === '首板') titleClass = 'tier-near';
      else if(count <= 3) titleClass = 'tier-hot';
      return `<div class="ladder-tier">
        <div class="ladder-tier-title ${titleClass}">${key} <span class="ladder-count">${count}只</span></div>
        ${stocks.map(s=>`<div class="rank-row ladder-stock">
          ${starHtml(s.code, s.name)}
          <span class="name">${s.name} <small class="stock-code">${s.code}</small></span>
          <span class="sub">${isNaN(s.price)?'—':s.price.toFixed(2)}</span>
          <span class="val ${cls(s.p)}">${s.p.toFixed(2)}%</span>
          <span class="extra">${fmtYi(s.amt)}</span>
        </div>`).join('')}
      </div>`;
    };

    const totalTier = Object.values(tiers).reduce((a,b)=> a+b.length, 0);
    el.innerHTML = `
      <div class="ladder-header">今日涨停共 <b>${totalTier}</b> 只 ｜ 最高 <b>${maxBoard}</b> 连板 ｜ ${new Date().toLocaleTimeString('zh-CN')}</div>
      ${sortedKeys.map(key => renderTier(key, tiers[key])).join('')}
      <div class="ladder-note">注：数据来自东方财富公开接口，按连板天数分组（9连板→首板）。交易时段自动更新。</div>
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
  if (!listEl || !statsEl) return; // 非日记页不渲染
  const logs = (typeof DAILY_LOG !== "undefined" ? DAILY_LOG : []).slice().sort((a,b)=> a.date.localeCompare(b.date));

  const wan = (v)=> (v/10000).toFixed(2) + "万";
  const yuan = (v)=> (v>=0?"+":"-") + "¥" + Math.abs(v).toLocaleString("zh-CN",{maximumFractionDigits:0});
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
      </div>
      <div class="diary-meta">
        <span>总资产 <b>${wan(l.total||0)}</b></span>
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
    const open = false;                      // 默认全部折叠
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
      if(t === "watch"){ renderWatch(); }
      if(t === "quote" && window.__chart) window.__chart.resize();
    });
  });
}

// ============ 用户体系 v3（邮箱验证码注册/登录 + 会员 + 评论 + 管理后台） ============
// 全部逻辑走 Supabase RPC（安全写在数据库函数里，前端不持有密钥）
const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";     // 你的 Supabase 项目地址
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";  // publishable key（前端公开，安全靠 RLS + RPC）
const USE_SUPABASE = /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON.length > 0;

const USER_TOKEN_KEY = "blys_user_token";
const ADMIN_TOKEN_KEY = "blys_admin_token";

// 调用 Supabase RPC
async function sbRpc(fn, params){
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON },
      body: JSON.stringify(params || {})
    });
  } catch (e) {
    // 网络层失败（DNS/TLS/被墙/跨域未配置）：透出真实错误，便于定位
    const err = new Error("网络请求失败：" + (e && e.message ? e.message : String(e)));
    err._status = 0;
    throw err;
  }
  const text = await r.text();
  let d;
  try { d = text ? JSON.parse(text) : {}; } catch (e) { d = { _raw: text }; }
  if (!r.ok) {
    d._status = r.status;
    d._ok = false;
  }
  return d;
}

// 调用 Supabase Edge Function（发邮件走这里，数据库出站被挡，改用 Edge Function）
async function callEdge(fn, body){
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON },
    body: JSON.stringify(body || {})
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
  if (!token){ __user = { loggedIn: false }; renderUserStatus(); lockVipZones(); initReview(); initTutorialGate(); emitUserChange(); return; }
  try {
    const d = await sbRpc("get_profile", { p_token: token });
    if (d && d.ok){
      const isVip = !!(d.vip_expire && new Date(d.vip_expire) > new Date());
      __user = { loggedIn: true, token, isVip, isAdmin: d.is_admin, nickname: d.nickname, email: d.email, vipExpire: d.vip_expire };
    } else {
      localStorage.removeItem(USER_TOKEN_KEY);
      __user = { loggedIn: false };
    }
  } catch(e){ __user = { loggedIn: false }; }
  renderUserStatus();
  lockVipZones();
  initReview();
  initTutorialGate();
  emitUserChange();
}

function emitUserChange(){
  try { window.dispatchEvent(new CustomEvent('blys:user:change', { detail: __user })); } catch(e){}
}

function isVIP(){ return __user.loggedIn && __user.isVip; }
function isAdmin(){ return __user.loggedIn && __user.isAdmin; }

function logoutUser(){
  localStorage.removeItem(USER_TOKEN_KEY);
  __user = { loggedIn: false };
  renderUserStatus();
  lockVipZones();
  emitUserChange();
}

function toggleUserMenu(event){
  if (event) event.stopPropagation();
  const menu = document.getElementById("userMenuDropdown");
  const trigger = document.getElementById("userMenuTrigger");
  if (!menu || !trigger) return;
  const open = menu.classList.toggle("open");
  trigger.setAttribute("aria-expanded", String(open));
}

function closeUserMenu(){
  const menu = document.getElementById("userMenuDropdown");
  const trigger = document.getElementById("userMenuTrigger");
  if (!menu || !trigger) return;
  menu.classList.remove("open");
  trigger.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", (event)=>{
  if (!event.target.closest(".user-menu")) closeUserMenu();
});

// 渲染右上角用户状态
function renderUserStatus(){
  const el = document.getElementById("vipStatus");
  if (!el) return;
  if (__user.loggedIn){
    const tag = __user.isVip ? `⭐ 会员至 ${fmtDateStr(new Date(__user.vipExpire))}` : "普通用户";
    let html = `<button class="vip-open checkin-btn" id="checkinBtn" onclick="doCheckin()" title="每日签到领积分">📅 签到</button>
    <div class="user-menu">
      <button class="user-menu-trigger" id="userMenuTrigger" type="button" onclick="toggleUserMenu(event)" aria-expanded="false" aria-haspopup="true">
        <span class="user-menu-name">${esc(__user.nickname || __user.email || "用户")}</span><span class="user-menu-chevron" aria-hidden="true"></span>
      </button>
      <div class="user-menu-dropdown" id="userMenuDropdown">
        <div class="user-menu-status">${tag}</div>
        <span class="vip-badge points-badge" id="userPointsBadge" title="当前积分，可兑换会员专享内容">🪙 <b id="userPointsNum">0</b> 分</span>
        ${__user.isAdmin ? `<button class="vip-open" onclick="location.href='admin.html'">后台</button>` : ''}
        <button class="vip-open logout-btn" onclick="logoutUser()">退出登录</button>
      </div>
    </div>`;
    el.innerHTML = html;
    refreshPointsUI();
  } else {
    el.innerHTML = `<button class="vip-open" onclick="openAuthModal()">登录/注册</button>`;
  }
}

// ---- 积分体系（签到 / 评论奖励 / 兑换解锁） ----
async function refreshPointsUI(){
  const num = document.getElementById("userPointsNum");
  const btn = document.getElementById("checkinBtn");
  if (!num) return;
  if (!__user.loggedIn || !__user.token){
    num.textContent = "0";
    return;
  }
  try {
    const d = await sbRpc("get_points", { p_token: __user.token });
    if (!d || !d.ok){ num.textContent = "0"; return; }
    num.textContent = (d.points == null ? 0 : d.points);
    __user.points = d.points || 0;
    __user.todayChecked = !!d.today_checked;
    if (btn){
      if (__user.todayChecked){
        btn.textContent = "✅ 已签到";
        btn.disabled = true;
      } else {
        btn.textContent = "📅 签到";
        btn.disabled = false;
      }
    }
  } catch(e){ num.textContent = "0"; }
}
async function doCheckin(){
  if (!__user.loggedIn){ openAuthModal(); return; }
  const btn = document.getElementById("checkinBtn");
  if (btn && btn.disabled) return;
  try {
    const d = await sbRpc("checkin", { p_token: __user.token });
    if (!d || !d.ok){ alert((d && d.msg) || "签到失败"); refreshPointsUI(); return; }
    alert(`✅ 签到成功！${d.streak ? "连续 " + d.streak + " 天，" : ""}当前积分 ${d.points}`);
    refreshPointsUI();
    emitUserChange();
  } catch(e){ alert("网络错误"); }
}
// 积分兑换专享内容：p_page 是 vipzone 卡片 data-page 标识，p_cost 是所需积分
async function redeemContent(page, cost){
  if (!__user.loggedIn){ openAuthModal(); return; }
  const ok = confirm(`使用 ${cost} 积分兑换「${page}」？`);
  if (!ok) return;
  try {
    const d = await sbRpc("redeem_content", { p_token: __user.token, p_page: page, p_points: cost });
    if (!d || !d.ok){
      alert((d && d.msg) || "兑换失败");
      return;
    }
    alert(`✅ 兑换成功！已解锁「${page}」`);
    refreshPointsUI();
    renderVipLocks();
    emitUserChange();
  } catch(e){ alert("网络错误"); }
}
// 根据已解锁内容刷新 vipzone 卡片状态
async function renderVipLocks(){
  const cards = document.querySelectorAll("[data-page]");
  if (!cards.length) return;
  let locks = [];
  if (typeof __user !== 'undefined' && __user && __user.loggedIn && __user.token){
    try {
      const d = await sbRpc("get_locks", { p_token: __user.token });
      if (d && d.ok && Array.isArray(d.list)) locks = d.list;
    } catch(e){}
    __user.locks = locks;
  } else if (typeof __user !== 'undefined') {
    __user.locks = [];
  }
  cards.forEach(card => {
    const page = card.dataset.page;
    const cost = Number(card.dataset.cost || 0);
    const unlocked = locks.indexOf(page) >= 0;
    card.classList.toggle("points-locked", !unlocked && cost > 0);
    // VIP 用户直接解锁全部（不再显示兑换按钮）
    const isVipUser = typeof __user !== 'undefined' && __user && __user.isVip;
    const finalUnlocked = unlocked || isVipUser;
    const btn = card.querySelector(".points-redeem-btn");
    if (btn) btn.remove();
    if (cost > 0 && !finalUnlocked){
      const b = document.createElement("button");
      b.className = "btn btn-primary btn-block points-redeem-btn";
      b.textContent = `🪙 ${cost} 积分解锁`;
      b.onclick = () => redeemContent(page, cost);
      card.appendChild(b);
    }
  });
}

// 根据会员状态锁定 / 解锁会员专属区块
function lockVipZones(){
  document.querySelectorAll(".vip-zone").forEach(z=>{
    const isLoginGate = z.id === "vip";   // 会员课程：登录即可
    // 积分兑换区：登录用户即可看到卡片（未解锁卡片带兑换按钮）；VIP 直接全部解锁
    const isPointsZone = !!z.querySelector("[data-page][data-cost]");
    const unlocked = isPointsZone
      ? (isVIP() || __user.loggedIn)
      : (isLoginGate ? __user.loggedIn : isVIP());
    z.classList.toggle("unlocked", unlocked);
    z.classList.toggle("is-locked", !unlocked);
  });
  document.querySelectorAll("[data-vip-course]").forEach(c=>{
    // VIP 或已积分解锁该卡片的用户无需锁定
    const page = c.dataset.page;
    const locks = (typeof __user !== 'undefined' && __user) ? (__user.locks || []) : [];
    const hasLock = locks.indexOf(page) >= 0;
    c.classList.toggle("is-locked", !isVIP() && !hasLock);
  });
  renderVipLocks();
}

// 若页面未包含 authModal（如 daily / diary / tutorials），动态注入
function ensureAuthModal(){
  if (document.getElementById("authModal")) return;
  const div = document.createElement("div");
  div.innerHTML = `<div class="modal-mask" id="authModal" style="display:none">
    <div class="modal">
      <button class="modal-close" onclick="closeAuthModal()" aria-label="关闭">×</button>
      <div class="auth-tabs">
        <button class="auth-tab active" data-mode="login" onclick="switchAuth('login')">登录</button>
        <button class="auth-tab" data-mode="register" onclick="switchAuth('register')">注册</button>
      </div>
      <div id="authLogin">
        <div class="form-row"><label>邮箱</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="username" /></div>
        <div class="form-row"><label>密码</label><input id="authPwd" type="password" placeholder="你的密码" autocomplete="current-password" /></div>
        <div id="authMsg" class="result"></div>
        <button class="btn btn-primary btn-block" onclick="userLogin()">登录</button>
        <p class="muted auth-switch">还没有账号？<a onclick="switchAuth('register')">去注册</a> ｜ <a onclick="switchAuth('forgot')">忘记密码</a></p>
      </div>
      <div id="authRegister" style="display:none">
        <p class="muted">用邮箱注册，首次需邮箱验证码（演示模式页面直接显示）。</p>
        <div class="form-row"><label>邮箱</label><input id="regEmail" type="email" placeholder="you@example.com" autocomplete="username" /></div>
        <div class="form-row"><label>密码</label><input id="regPwd" type="password" placeholder="至少 6 位" autocomplete="new-password" /></div>
        <div class="form-row"><label>昵称</label><input id="regNick" type="text" placeholder="怎么称呼你（选填）" /></div>
        <div class="form-row" id="regCodeRow" style="display:none"><label>验证码</label><input id="regCode" type="text" placeholder="6 位验证码" /></div>
        <div id="regMsg" class="result"></div>
        <button class="btn btn-primary btn-block" id="regSendBtn" onclick="regSend()">获取验证码</button>
        <button class="btn btn-primary btn-block" id="regSubmitBtn" style="display:none" onclick="regSubmit()">验证并注册</button>
        <p class="muted auth-switch"><a onclick="switchAuth('login')">已有账号？去登录</a></p>
      </div>
      <div id="authForgot" style="display:none">
        <p class="muted">输入注册邮箱，获取验证码后重置密码。</p>
        <div class="form-row"><label>邮箱</label><input id="fgEmail" type="email" placeholder="you@example.com" autocomplete="username" /></div>
        <div class="form-row" id="fgCodeRow" style="display:none"><label>验证码</label><input id="fgCode" type="text" placeholder="6 位验证码" /></div>
        <div class="form-row" id="fgPwdRow" style="display:none"><label>新密码</label><input id="fgPwd" type="password" placeholder="至少 6 位" autocomplete="new-password" /></div>
        <div id="fgMsg" class="result"></div>
        <button class="btn btn-primary btn-block" id="fgSendBtn" onclick="fgSend()">获取验证码</button>
        <button class="btn btn-primary btn-block" id="fgSubmitBtn" style="display:none" onclick="fgSubmit()">重置密码</button>
        <p class="muted auth-switch"><a onclick="switchAuth('login')">返回登录</a></p>
      </div>
    </div>
  </div>`;
  const modal = div.firstElementChild;
  document.body.appendChild(modal);
  // 点击遮罩关闭
  modal.addEventListener("click", (e)=>{ if(e.target === modal) closeAuthModal(); });
}

// ---- 登录 / 注册弹窗 ----
function openAuthModal(){ ensureAuthModal(); const m = document.getElementById("authModal"); if (m){ m.classList.add("open"); m.style.display=""; } switchAuth("login"); }
function closeAuthModal(){ const m = document.getElementById("authModal"); if (m){ m.classList.remove("open"); m.style.display="none"; } }
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
    const d = await callEdge("send-otp", { email: email, purpose: "register" });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "发送失败"; return; }
    msg.className = "result";
    msg.innerHTML = "✅ 验证码已发送，请查收邮箱（若未收到请检查垃圾箱）";
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
    const d = await callEdge("send-otp", { email: email, purpose: "reset" });
    if (!d || !d.ok){ msg.textContent = (d && d.msg) || "发送失败"; return; }
    msg.className = "result";
    msg.innerHTML = "✅ 验证码已发送，请查收邮箱（若未收到请检查垃圾箱）";
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

const __yearEl = document.getElementById("year");
if (__yearEl) __yearEl.textContent = new Date().getFullYear();
const __navToggle = document.getElementById("navToggle");
if (__navToggle && !__navToggle.dataset.navReady) __navToggle.addEventListener("click", ()=> {
  const __navLinks = document.getElementById("navLinks");
  if (!__navLinks) return;
  const isOpen = __navLinks.classList.toggle("open");
  __navToggle.setAttribute("aria-expanded", String(isOpen));
});
const __navLinksEl = document.getElementById("navLinks");
if (__navLinksEl) __navLinksEl.addEventListener("click", (e)=> {
  if (e.target.closest("a") && window.innerWidth <= 980) {
    __navLinksEl.classList.remove("open");
    if (__navToggle) __navToggle.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("click", (e)=> {
  if (window.innerWidth > 980 || !__navLinksEl || !__navToggle) return;
  if (!e.target.closest(".nav-inner")) {
    __navLinksEl.classList.remove("open");
    __navToggle.setAttribute("aria-expanded", "false");
  }
});
initToolTabs();
renderDiary();
fetchUser();
loadHeroSnapshot();

// ============ 每日复盘模块（情绪温度计 + 一句话结论 + 板块Top + 主入口） ============
// 首页 Hero 数据快照（指数 + 涨停家数 + 跌停家数 + 情绪）
function loadHeroSnapshot(){
  const box = document.getElementById('heroSnapshot');
  if(!box) return;
  box.innerHTML = '<div class="snapshot-loading">加载今日盘面…</div>';

  const emUrl = (secid)=> `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f104,f105,f6,f170,f171&fltt=2&invt=2&ut=fa5fd1943c7b386f172d6893b`;
  const poolUrl = (tag)=> `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=400&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:81+s:${tag}&fields=f12,f14,f3,f107&ut=fa5fd1943c7b386f172d6893b`;

  Promise.all([
    jsonp(emUrl('1.000001')),  // 上证
    jsonp(emUrl('0.399001')),  // 深成
    jsonp(poolUrl('2048')),    // 涨停池
    jsonp(poolUrl('2049'))     // 跌停池
  ]).then(([sh, sz, zt, dt])=>{
    const sd = sh && sh.data, zd = sz && sz.data;
    const ztd = zt && zt.data, dtd = dt && dt.data;
    const fmtPct = (v)=> v==null||v==='' ? '—' : (parseFloat(v) >= 0 ? '+' : '') + (parseFloat(v)).toFixed(2) + '%';
    const clsPct = (v)=> parseFloat(v) >= 0 ? 'up' : 'down';
    const fmtAmt = (v)=> { const n = parseFloat(v)||0; return (n/1e12).toFixed(2); };

    const idx = [
      { name: '上证指数', code: '000001', now: sd && sd.f43, pct: sd && sd.f170 },
      { name: '深证成指', code: '399001', now: zd && zd.f43, pct: zd && zd.f170 },
    ].map(it => {
      const v = parseFloat(it.now)||0;
      const p = parseFloat(it.pct);
      return { name: it.name, code: it.code, now: v ? v.toFixed(2) : '—', pct: fmtPct(p), cls: clsPct(p) };
    });

    const ztList = (ztd && ztd.diff) || [];
    const dtList = (dtd && dtd.diff) || [];
    let maxBoard = 1;
    ztList.forEach(it=>{ const b = parseInt(it.f107,10)||1; if(b>maxBoard) maxBoard = b; });
    const amt = (parseFloat(sd && sd.f6)||0) + (parseFloat(zd && zd.f6)||0);
    const up = (parseFloat(sd && sd.f104)||0) + (parseFloat(zd && zd.f104)||0);
    const down = (parseFloat(sd && sd.f105)||0) + (parseFloat(zd && zd.f105)||0);

    box.innerHTML = `
      <div class="snapshot-card">
        <div class="snap-label">上证</div>
        <div class="snap-num">${idx[0].now}</div>
        <div class="snap-pct ${idx[0].cls}">${idx[0].pct}</div>
      </div>
      <div class="snapshot-card">
        <div class="snap-label">深成</div>
        <div class="snap-num">${idx[1].now}</div>
        <div class="snap-pct ${idx[1].cls}">${idx[1].pct}</div>
      </div>
      <div class="snapshot-card">
        <div class="snap-label">涨停</div>
        <div class="snap-num up">${ztList.length}</div>
        <div class="snap-sub">家</div>
      </div>
      <div class="snapshot-card">
        <div class="snap-label">跌停</div>
        <div class="snap-num ${dtList.length>0?'down':'up'}">${dtList.length}</div>
        <div class="snap-sub">家</div>
      </div>
      <div class="snapshot-card">
        <div class="snap-label">最高连板</div>
        <div class="snap-num">${maxBoard}</div>
        <div class="snap-sub">板</div>
      </div>
      <div class="snapshot-card">
        <div class="snap-label">两市成交</div>
        <div class="snap-num">${fmtAmt(amt)}</div>
        <div class="snap-sub">万亿</div>
      </div>`;
  }).catch(()=>{
    box.innerHTML = '<div class="snapshot-loading">盘面数据暂不可用，请<a href="daily.html">查看今日完整复盘 →</a></div>';
  });
}

// 情绪数据：涨跌家数(沪+深指数 f104/f105) + 涨停/跌停池 + 量能(沪+深指数 f6)
function loadEmotion(){
  const box = document.getElementById('emotionBox');
  const con = document.getElementById('conclusionBox');
  if(!box || !con) return;
  box.innerHTML = '<div class="result">加载市场情绪…</div>';

  const emUrl = (secid)=> `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f57,f58,f104,f105,f6&fltt=2&invt=2&ut=fa5fd1943c7b386f172d6893b`;
  const poolUrl = (tag)=> `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=600&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:81+s:${tag}&fields=f12,f14,f3,f107&ut=fa5fd1943c7b386f172d6893b`;

  Promise.all([
    jsonp(emUrl('1.000001')),   // 上证指数
    jsonp(emUrl('0.399001')),   // 深证成指
    jsonp(poolUrl('2048')),     // 涨停池
    jsonp(poolUrl('2049'))      // 跌停池
  ]).then(([sh, sz, zt, dt])=>{
    const shd = sh && sh.data; const szd = sz && sz.data;
    const ztd = zt && zt.data; const dtd = dt && dt.data;
    const up = (parseFloat(shd && shd.f104)||0) + (parseFloat(szd && szd.f104)||0);
    const down = (parseFloat(shd && shd.f105)||0) + (parseFloat(szd && szd.f105)||0);
    const amt = (parseFloat(shd && shd.f6)||0) + (parseFloat(szd && szd.f6)||0);
    const ztList = (ztd && ztd.diff) || [];
    const dtList = (dtd && dtd.diff) || [];
    const ztCount = ztList.length;
    const dtCount = dtList.length;
    let maxBoard = 1;
    ztList.forEach(it=>{ const b = parseInt(it.f107,10)||1; if(b>maxBoard) maxBoard = b; });

    // 情绪分 0-100（基准 50）
    let score = 50;
    if(up>0 && down>0){
      const ratio = up/down;
      if(ratio>=2) score+=25; else if(ratio>=1.5) score+=18; else if(ratio>=1.2) score+=10; else if(ratio>=1) score+=4;
      else if(ratio>=0.8) score-=8; else if(ratio>=0.5) score-=16; else score-=26;
    } else if(up>0 && down===0) score+=25; else if(up===0 && down>0) score-=26;
    const zd = ztCount - dtCount;
    if(zd>=30) score+=15; else if(zd>=15) score+=10; else if(zd>=5) score+=5; else if(zd>0) score+=2;
    else if(zd>-5) score-=4; else if(zd>-15) score-=10; else score-=18;
    if(maxBoard>=7) score+=10; else if(maxBoard>=5) score+=7; else if(maxBoard>=3) score+=4;
    score = Math.max(0, Math.min(100, Math.round(score)));

    renderEmotion(box, { score, up, down, ztCount, dtCount, amt });
    genConclusion(con, { score, up, down, ztCount, dtCount, amt, maxBoard });
  }).catch(()=>{
    box.innerHTML = '<div class="result">市场情绪加载失败，请刷新重试</div>';
    con.innerHTML = '<div class="review-conclusion"><p>结论暂时加载失败，请稍后刷新。</p></div>';
  });
}

function renderEmotion(box, d){
  let level, lvlClass;
  if(d.score<30){ level='冰点·极弱'; lvlClass='lv-cold'; }
  else if(d.score<45){ level='偏弱'; lvlClass='lv-weak'; }
  else if(d.score<55){ level='中性'; lvlClass='lv-mid'; }
  else if(d.score<70){ level='偏强'; lvlClass='lv-warm'; }
  else { level='亢奋'; lvlClass='lv-hot'; }
  const upStr = d.up>0 ? d.up.toLocaleString('zh-CN') : '—';
  const downStr = d.down>0 ? d.down.toLocaleString('zh-CN') : '—';
  const amtStr = d.amt>0 ? (d.amt/1e12).toFixed(2)+'万亿' : '—';
  box.innerHTML = `
    <div class="emotion-head">
      <div class="emotion-score ${lvlClass}">${d.score}<small>分</small></div>
      <div class="emotion-meta">
        <div class="emotion-level ${lvlClass}">市场情绪：${level}</div>
        <div class="emotion-detail">
          <span>上涨 <b class="up">${upStr}</b></span>
          <span>下跌 <b class="down">${downStr}</b></span>
          <span>涨停 <b class="up">${d.ztCount}</b></span>
          <span>跌停 <b class="down">${d.dtCount}</b></span>
          <span>两市成交 <b>${amtStr}</b></span>
        </div>
      </div>
    </div>
    <div class="emotion-bar"><div class="emotion-bar-fill ${lvlClass}" style="width:${d.score}%"></div></div>`;
}

function genConclusion(con, d){
  let head;
  if(d.score<30) head='市场情绪冰点，亏钱效应明显——管住手、控仓位，多看少动。';
  else if(d.score<45) head='市场偏弱、资金观望——只在确定性方向小仓试错，不追高。';
  else if(d.score<55) head='多空拉锯、板块轮动快——轻仓做 T、不追涨杀跌。';
  else if(d.score<70) head='市场偏强、赚钱效应回暖——可积极跟随主线。';
  else head='情绪亢奋、主线明确——重仓顺势，但谨防高潮后回落。';

  const points = [];
  if(d.up>0 && d.down>0){
    const r = d.up/d.down;
    points.push(r>=1.5 ? `涨跌家数比 ${r.toFixed(2)}:1，多方占优` : (r>=1 ? `涨跌家数基本持平（${d.up}:${d.down}），结构性行情` : `跌多涨少（${d.up}:${d.down}），人气偏弱`));
  } else { points.push('涨跌家数数据暂缺，参考下方涨停/跌停数量'); }
  points.push(d.ztCount - d.dtCount >= 15 ? `涨停 ${d.ztCount} 家、跌停 ${d.dtCount} 家，打板赚钱效应强` : (d.dtCount > d.ztCount ? `跌停 ${d.dtCount} 家多于涨停 ${d.ztCount} 家，注意风险` : `涨停 ${d.ztCount} 家、跌停 ${d.dtCount} 家`));
  points.push(d.amt>0 ? `两市成交 ${(d.amt/1e12).toFixed(2)} 万亿，${ d.amt>=1.2e12?'量能充沛':(d.amt>=0.8e12?'量能温和':'量能偏低、资金偏谨慎') }` : '量能数据暂缺');
  points.push(d.maxBoard>=5 ? `连板高度打到 ${d.maxBoard} 板，短线空间打开` : (d.maxBoard>=3 ? `最高 ${d.maxBoard} 连板，题材有一定持续性` : `连板高度偏低，题材多一日游`));

  con.innerHTML = `
    <div class="conclusion-head">💡 ${head}</div>
    <ul class="conclusion-points">${points.map(p=>`<li>${p}</li>`).join('')}</ul>`;
}

function loadTopSectors(){
  const el = document.getElementById('topSectors'); if(!el) return;
  el.innerHTML = '<div class="result">加载最强板块…</div>';
  const mk = (fs)=> new Promise(res=>{
    jsonp(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f12,f14,f3,f62,f104,f105,f184&ut=fa5fd1943c7b386f172d6893b`)
      .then(r=> res((r&&r.data&&r.data.diff)||[])).catch(()=> res([]));
  });
  Promise.all([mk('m:90+t:2'), mk('m:90+t:3')]).then(([hy, gn])=>{
    const rows = [...hy, ...gn].sort((a,b)=> parseFloat(b.f3)-parseFloat(a.f3)).slice(0,5);
    if(!rows.length){ el.innerHTML = '<div class="result">暂无板块数据</div>'; return; }
    el.innerHTML = rows.map(it=>{
      const p = parseFloat(it.f3), net = parseFloat(it.f62), bk = (it.f104||'').trim();
      const nm = it.f14||'';
      const clickable = !!bk;
      return `<div class="rank-row top-sector ${clickable?'':'sector-disabled'}" data-bk="${bk}" data-name="${nm}" ${clickable?'onclick="loadSectorStocks(this)"':''}>
        <span class="name">${nm} <small class="sector-hint">${clickable?'点击展开个股 ▸':'—'}</small></span>
        <span class="sub ${cls(net)}">主力 ${isNaN(net)?'—':sign(net)+(net/1e8).toFixed(2)+'亿'}</span>
        <span class="val ${cls(p)}">${isNaN(p)?'—':sign(p)+p.toFixed(2)+'%'}</span>
      </div><div class="sector-stocks" id="stocks-${bk}"></div>`;
    }).join('');
  });
}

function loadReview(){
  if(!isMarketOpen()){
    ['conclusionBox','emotionBox'].forEach(id=>{ const e=document.getElementById(id); if(e) e.innerHTML = MARKET_HINT; });
    const ts = document.getElementById('topSectors'); if(ts) ts.innerHTML = '<div class="result">📴 非交易时段不更新，开盘后自动加载</div>';
    const li = document.getElementById('ladderInfo'); if(li) li.innerHTML = MARKET_HINT;
    const zs = document.getElementById('ztSummary'); if(zs) zs.innerHTML = MARKET_HINT;
    const zl = document.getElementById('ztList'); if(zl) zl.innerHTML = '<div class="result">📴 非交易时段不展示涨停数据</div>';
    return;
  }
  loadEmotion();
  loadTopSectors();
  loadLadder();
  loadZT();
}

// ============ 完整复盘报告（加载训练好的自动化任务生成的 assets/review.html） ============
function initFoldableTables(root){
  if(!root) return;
  root.querySelectorAll('.rpt-tbl').forEach(tbl => {
    tbl.querySelectorAll('tbody').forEach(tb => {
      const rows = Array.from(tb.querySelectorAll('tr'));
      if(rows.length <= 10) return;
      const hidden = document.createElement('tbody');
      hidden.className = 'rpt-tbody-collapsed';
      rows.slice(10).forEach(tr => hidden.appendChild(tr));
      tbl.appendChild(hidden);
      const wrap = tbl.parentNode;
      const btn = document.createElement('button');
      btn.className = 'rpt-fold-btn';
      btn.type = 'button';
      btn.innerHTML = `展开更多 ${rows.length - 10} 条 ↓`;
      btn.addEventListener('click', () => {
        const open = hidden.classList.contains('is-open');
        hidden.classList.toggle('is-open');
        btn.innerHTML = open ? `展开更多 ${rows.length - 10} 条 ↓` : '收起 ↑';
      });
      if(wrap && wrap.classList.contains('rpt-tbl-wrap')){
        // 按钮放到 wrap 外面（章节卡片内、wrap 之后），避免受 wrap 横向滚动/钉住列 z-index 影响
        wrap.parentNode.insertBefore(btn, wrap.nextSibling);
      }
    });
  });
}

// 名称列钉住：横向滑动时，只钉住「排名 + 名称」两列（代码列不钉，跟着滑动）
function pinNameColumn(root){
  if(!root) return;
  root.querySelectorAll('.rpt-tbl').forEach(tbl => {
    const head = tbl.querySelector('thead');
    if(!head) return;
    const ths = Array.from(head.querySelectorAll('th'));
    if(!ths.length) return;
    // 定位：nameIdx=含"名称"的列；rankIdx=含"排名"的列；codeIdx=含"代码"的列
    let nameIdx = -1, rankIdx = -1, codeIdx = -1;
    ths.forEach((th,i)=>{
      const t = (th.textContent||'').trim();
      if(t === '名称') nameIdx = i;
      else if(t === '排名') rankIdx = i;
      else if(t === '代码') codeIdx = i;
    });
    // 没有名称列：钉住第 1 列（兼容连板天梯等）
    if(nameIdx < 0) nameIdx = 0;
    // 钉住集合 = [排名 (若在名称左侧), 名称]，排除代码列
    const pinIdxs = [];
    if(rankIdx >= 0 && rankIdx < nameIdx) pinIdxs.push(rankIdx);
    pinIdxs.push(nameIdx);
    // 给排名列打标，CSS 单独设窄宽度
    if(rankIdx >= 0){
      const rcells = tbl.querySelectorAll(`th:nth-child(${rankIdx+1}), td:nth-child(${rankIdx+1})`);
      rcells.forEach(c => c.classList.add('rpt-rank'));
    }
    // 计算每个钉住列的 left 偏移（按表头实际宽度累加，包含不钉的列以保证 offset 正确）
    let acc = 0;
    for(let i = 0; i <= nameIdx; i++){
      const th = ths[i];
      const w = (th && th.offsetWidth) || 80;
      const shouldPin = pinIdxs.includes(i);
      if(shouldPin){
        const cells = tbl.querySelectorAll(`th:nth-child(${i+1}), td:nth-child(${i+1})`);
        cells.forEach(cell => {
          cell.classList.add('rpt-pin');
          cell.style.left = acc + 'px';
        });
      }
      acc += w;   // 所有列（含不钉的代码列）都累加宽度，保证后续 sticky 列的 left 准确
    }
  });
}

// ========== 内容预览 + 登录解锁 ==========
function injectGateMask(container, title, desc){
  container.classList.add("gate-content");
  if (container.querySelector(".gate-mask")) return; // 已存在
  const mask = document.createElement("div");
  mask.className = "gate-mask";
  mask.innerHTML = `<div class="gate-mask-inner">
    <h4>${title}</h4>
    <p>${desc}</p>
    <button class="btn btn-primary" onclick="openAuthModal()">注册 / 登录</button>
  </div>`;
  container.appendChild(mask);
}

function removeGateMask(container){
  container.classList.remove("gate-content","is-gated");
  const mask = container.querySelector(".gate-mask");
  if (mask) mask.remove();
  container.querySelectorAll(".gate-hidden").forEach(el => el.classList.remove("gate-hidden"));
}

// 复盘报告 gate：保留封面 + 第一章，其余隐藏
function initReviewGate(box){
  if (!box) return;
  const chapters = Array.from(box.querySelectorAll(".rpt-chapter"));
  if (__user.loggedIn) {
    removeGateMask(box);
    return;
  }
  chapters.forEach((ch, i)=>{ if (i >= 1) ch.classList.add("gate-hidden"); });
  box.classList.add("is-gated");
  injectGateMask(box, "登录查看完整复盘", "你已阅读封面概览与第一章核心指数。登录后即可解锁全部 13 章深度复盘内容，包含涨停池、连板天梯、资金流向与明日策略。");
}

// 教程文章 gate：保留前两个 section，其余隐藏
function initTutorialGate(){
  const tut = document.querySelector(".tutorial.gate-content, main.tutorial");
  if (!tut) return;
  const sections = Array.from(tut.querySelectorAll(".tut-section"));
  if (__user.loggedIn) {
    removeGateMask(tut);
    return;
  }
  sections.forEach((sec, i)=>{ if (i >= 2) sec.classList.add("gate-hidden"); });
  tut.classList.add("gate-content", "is-gated");
  injectGateMask(tut, "登录查看完整课程", "你已阅读课程预览部分。登录后即可解锁全部章节、实战案例与评论区互动。");
}

// 从 index.json 取出最新日期（按 date 字符串倒序，取首条非空 date）
async function pickLatestReviewDate(){
  try {
    const r = await fetch(`assets/reviews/index.json?t=${Date.now()}`, { cache: 'no-store' });
    if(!r.ok) return null;
    const list = await r.json();
    if(!Array.isArray(list) || !list.length) return null;
    const sorted = list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted[0] && sorted[0].date ? sorted[0].date : null;
  } catch(e){ return null; }
}

async function loadFullReport(){
  const box = document.getElementById('fullReport');
  if(!box) return;
  const ts = Date.now();
  const params = new URLSearchParams(location.search);
  const date = params.get('date');          // 形如 2026-08-18
  let url = null;
  let fallbackUsed = false;
  let resolvedDate = date;
  if (date) {
    url = `assets/reviews/${date}.html?t=${ts}`;  // 历史某日存档
  } else {
    // 默认：自动从 index.json 选最新一期（无需 ?date= 也能拿到当天报告）
    const latest = await pickLatestReviewDate();
    if (latest) { url = `assets/reviews/${latest}.html?t=${ts}`; resolvedDate = latest; }
    else { url = `assets/review.html?t=${ts}`; fallbackUsed = true; }
  }
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if(!r.ok) throw new Error('报告文件不存在');
    box.innerHTML = await r.text();
    initFoldableTables(box);
    pinNameColumn(box);
    initReviewGate(box);
    injectReviewMeta(box, resolvedDate || 'latest');
  } catch(e){
    // 自动选的最新文件失败时，再回退 review.html
    if(!date && !fallbackUsed){
      try {
        const r2 = await fetch(`assets/review.html?t=${ts}`, { cache: 'no-store' });
        if(r2.ok){ box.innerHTML = await r2.text(); initFoldableTables(box); pinNameColumn(box); initReviewGate(box); injectReviewMeta(box, resolvedDate || 'latest'); return; }
      } catch(_){}
    }
    box.innerHTML = date
      ? `<div class="rpt-loading">未找到 ${date} 的复盘记录。<a href="daily.html">返回最新一期 →</a></div>`
      : '<div class="rpt-loading">完整复盘报告暂未生成，每天 15:00 收盘后自动更新。</div>';
  }
}

// ============ 复盘互动区：点赞 + 评论（按 review date 维度，本机 localStorage 统计） ============
function _rKey(date){ return 'blys_review_meta_' + date; }
function _rGetMeta(date){
  try {
    const raw = localStorage.getItem(_rKey(date));
    if(!raw) return { likes: 0, liked: false, comments: [], views: 0 };
    const m = JSON.parse(raw);
    return {
      likes: Number(m.likes) || 0,
      liked: !!m.liked,
      comments: Array.isArray(m.comments) ? m.comments : [],
      views: Number(m.views) || 0
    };
  } catch(e){ return { likes: 0, liked: false, comments: [], views: 0 }; }
}
function _rSetMeta(date, meta){
  try { localStorage.setItem(_rKey(date), JSON.stringify(meta)); } catch(e){}
}
function _rName(){
  try { return (localStorage.getItem('blys_chat_name') || '').trim(); } catch(e){ return ''; }
}
function _rSetName(n){
  try { localStorage.setItem('blys_chat_name', n || ''); } catch(e){}
}
function _escHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _fmtRelTime(ts){
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + '分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + '天前';
  const dt = new Date(ts);
  return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
}

function injectReviewMeta(box, date){
  if(!box) return;
  if(box.querySelector('.rpt-meta')) return; // 防止重复注入
  const meta = _rGetMeta(date);

  // 未登录用户：评论区整段隐藏（顶部显示登录提示）
  const loggedIn = !!(typeof __user !== 'undefined' && __user && __user.loggedIn);
  const displayName = (loggedIn && (__user.nickname || (__user.email||'').split('@')[0])) || '用户';

  const section = document.createElement('section');
  section.className = 'rpt-chapter rpt-meta';
  section.dataset.rptMetaDate = date;
  section.innerHTML = `
    <h2 class="rpt-h2">📮 浏览 · 点赞与评论</h2>
    <p class="rpt-meta-note">浏览量实时统计；评论服务端存储（发表 +2 积分）；点赞凭据仅存当前浏览器。</p>
    <div class="rpt-view-count" id="rptViewCount_${date}">👁 浏览 ${meta.views > 0 ? '<b>'+meta.views+'</b>' : '…'} 次</div>
    ${loggedIn ? `
    <div class="rpt-meta-bar">
      <button class="rpt-like-btn${meta.liked ? ' liked' : ''}" id="rptLikeBtn_${date}" type="button" aria-pressed="${meta.liked}">
        <span class="rpt-like-icon">${meta.liked ? '❤️' : '🤍'}</span>
        <span class="rpt-like-count" id="rptLikeCount_${date}">${meta.likes}</span>
        <span class="rpt-like-label">点赞</span>
      </button>
      <span class="rpt-comment-stat" id="rptCommentStat_${date}">💬 加载评论…</span>
      <span class="rpt-meta-author">以 <b>${_escHtml(displayName)}</b> 身份</span>
    </div>
    <div class="rpt-comment-form">
      <textarea class="rpt-comment-text" id="rptCommentText_${date}" maxlength="500" placeholder="说点什么…（最多 500 字，Ctrl/⌘+Enter 提交）"></textarea>
      <button class="rpt-comment-submit" id="rptCommentSubmit_${date}" type="button">发表评论</button>
    </div>
    <ul class="rpt-comment-list" id="rptCommentList_${date}"></ul>
    ` : `
    <div class="rpt-meta-login">
      🔒 点赞与评论仅对注册用户开放。<a class="rpt-meta-login-btn" href="javascript:void(0)" onclick="(window.openAuthModal&&openAuthModal())||(location.href='daily.html?login=1')">登录 / 注册</a> 后即可参与。
    </div>
    `}
  `;
  box.appendChild(section);

  // 浏览量：会话内仅统计一次（服务端）
  const lastRecorded = sessionStorage.getItem('blys_viewed_review_' + date) || '';
  if(lastRecorded !== '1'){
    sessionStorage.setItem('blys_viewed_review_' + date, '1');
    recordReviewView(date);
  }
  loadReviewViews(section, date);

  if(!loggedIn) return; // 未登录：不绑定任何交互

  const likeBtn = section.querySelector('.rpt-like-btn');
  const likeCount = section.querySelector('.rpt-like-count');
  const cmtText = section.querySelector('.rpt-comment-text');
  const cmtSubmit = section.querySelector('.rpt-comment-submit');
  const cmtList = section.querySelector('.rpt-comment-list');
  const cmtStat = section.querySelector('.rpt-comment-stat');

  function renderComments(){
    cmtList.innerHTML = '<li class="rpt-comment-empty">加载中…</li>';
    sbRpc('list_comments', { p_article: 'review:' + date }).then(d => {
      const list = (d && d.ok && Array.isArray(d.list)) ? d.list : [];
      if(!list.length){
        cmtList.innerHTML = '<li class="rpt-comment-empty">还没有评论，来抢沙发～</li>';
      } else {
        // 倒序（最新在前）
        cmtList.innerHTML = list.slice().reverse().map(c =>
          `<li class="rpt-comment-item">
            <div class="rpt-comment-head">
              <span class="rpt-comment-name-text">${_escHtml(c.nickname || c.email || '用户')}</span>
              <span class="rpt-comment-time">${_fmtRelTime(new Date(c.created_at).getTime())}</span>
            </div>
            <div class="rpt-comment-body">${_escHtml(c.content || '').replace(/\n/g, '<br>')}</div>
           </li>`
          ).join('');
      }
      cmtStat.textContent = '💬 ' + list.length + ' 条评论';
    }).catch(() => {
      cmtList.innerHTML = '<li class="rpt-comment-empty">评论加载失败</li>';
    });
  }

  likeBtn.addEventListener('click', () => {
    const m = _rGetMeta(date);
    if (m.liked) {
      m.liked = false;
      m.likes = Math.max(0, m.likes - 1);
    } else {
      m.liked = true;
      m.likes = m.likes + 1;
    }
    _rSetMeta(date, m);
    likeBtn.classList.toggle('liked', m.liked);
    likeBtn.setAttribute('aria-pressed', String(m.liked));
    likeBtn.querySelector('.rpt-like-icon').textContent = m.liked ? '❤️' : '🤍';
    likeCount.textContent = m.likes;
  });

  cmtSubmit.addEventListener('click', () => {
    const text = (cmtText.value || '').trim();
    if(!text){
      cmtText.focus();
      cmtText.classList.add('shake');
      setTimeout(() => cmtText.classList.remove('shake'), 400);
      return;
    }
    if(text.length > 500){
      alert('评论过长，最多 500 字');
      return;
    }
    const oldLabel = cmtSubmit.textContent;
    cmtSubmit.textContent = '发送中…';
    cmtSubmit.disabled = true;
    sbRpc('add_comment', { p_token: __user.token, p_article: 'review:' + date, p_content: text.slice(0, 500) }).then(d => {
      cmtSubmit.disabled = false;
      if(!d || !d.ok){
        cmtSubmit.textContent = oldLabel;
        alert((d && d.msg) || '发送失败');
        return;
      }
      cmtText.value = '';
      renderComments();
      cmtSubmit.textContent = '已发送 ✓';
      refreshPointsUI();
      setTimeout(()=>{ cmtSubmit.textContent = oldLabel; }, 1500);
      const first = cmtList.querySelector('.rpt-comment-item');
      if(first) first.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // 滚动到新评论
    }).catch(() => {
      cmtSubmit.disabled = false;
      cmtSubmit.textContent = oldLabel;
      alert('网络错误');
    });
  });

  cmtText.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
      e.preventDefault();
      cmtSubmit.click();
    }
  });

  renderComments();
}

// 浏览量：服务端 RPC（Tongdaxin 无关，纯统计）
async function recordReviewView(date){
  try {
    const key = __userIdKey();
    await sbRpc('record_view', { p_page_type: 'review', p_ref_id: date, p_viewer_key: key });
  } catch(e){}
}
async function loadReviewViews(section, date){
  try {
    const d = await sbRpc('get_views', { p_page_type: 'review', p_ref_id: date });
    const el = section.querySelector('#rptViewCount_' + date);
    if(el && d && d.ok){
      const n = Number(d.views) || 0;
      el.innerHTML = '👁 浏览 <b>' + n + '</b> 次';
    }
  } catch(e){}
}
// 匿名设备标识：登录用邮箱，游客用 localStorage 随机 id
function __userIdKey(){
  if (typeof __user !== 'undefined' && __user && __user.loggedIn && __user.email) return 'u:' + __user.email;
  let k = '';
  try { k = localStorage.getItem('blys_visitor_id') || ''; } catch(e){}
  if(!k){
    k = 'v:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('blys_visitor_id', k); } catch(e){}
  }
  return k;
}
// 文章/复盘通用浏览量（教程页调用）
async function recordPageView(pageType, refId){
  try { await sbRpc('record_view', { p_page_type: pageType, p_ref_id: refId, p_viewer_key: __userIdKey() }); } catch(e){}
}
async function getPageViews(pageType, refId){
  try {
    const d = await sbRpc('get_views', { p_page_type: pageType, p_ref_id: refId });
    return (d && d.ok) ? (Number(d.views) || 0) : 0;
  } catch(e){ return 0; }
}

// 监听登录态变化：用户从「未登录」登录后，自动把评论区从「登录提示」替换为可评论表单
window.addEventListener('blys:user:change', () => {
  const box = document.getElementById('fullReport');
  if(!box) return;
  const existing = box.querySelector('.rpt-meta');
  if(!existing) return;
  const date = existing.dataset.rptMetaDate || (new URLSearchParams(location.search).get('date')) || 'latest';
  const wasLoggedIn = !existing.querySelector('.rpt-comment-form');
  const isLoggedIn = !!(typeof __user !== 'undefined' && __user && __user.loggedIn);
  // 仅当从「未登录」变「已登录」时重渲染
  if(!wasLoggedIn && isLoggedIn){
    existing.remove();
    injectReviewMeta(box, date);
  }
});

// 历史复盘下拉（读取 assets/reviews/index.json）
async function renderHistoryBar(){
  const bar = document.getElementById('historyBar');
  if(!bar) return;
  try {
    const r = await fetch(`assets/reviews/index.json?t=${Date.now()}`, { cache: 'no-store' });
    if(!r.ok) return;
    const list = await r.json();
    if(!Array.isArray(list) || !list.length) return;

    const params = new URLSearchParams(location.search);
    const cur = params.get('date') || '';

    const label = document.createElement('span');
    label.className = 'muted';
    label.style.fontSize = '13px';
    label.textContent = '查看历史：';

    const sel = document.createElement('select');
    sel.id = 'historySelect';
    sel.className = 'zt-filter';

    const optLatest = document.createElement('option');
    optLatest.value = '';
    optLatest.textContent = '最新一期';
    sel.appendChild(optLatest);

    // 最新的排在前面
    list.slice().reverse().forEach(it => {
      const o = document.createElement('option');
      o.value = it.date;
      o.textContent = it.title || it.date;
      sel.appendChild(o);
    });
    sel.value = cur;

    sel.addEventListener('change', () => {
      const v = sel.value;
      const newUrl = location.pathname + (v ? `?date=${v}` : '');
      history.pushState({}, '', newUrl);
      loadFullReport();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    bar.appendChild(label);
    bar.appendChild(sel);
  } catch(e){ /* 无历史索引时不展示选择器 */ }
}

function initReview(){
  if(!document.getElementById('reviewRoot')) return;
  loadFullReport();
  renderHistoryBar();
}

// 浏览器前进/后退时同步切换历史复盘
window.addEventListener('popstate', () => {
  if(document.getElementById('reviewRoot')) loadFullReport();
});
