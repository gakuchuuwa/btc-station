/* ─── btc-charts.js ─── BTC Station Landing Page Logic ─── */

/* ======= SEEDED RNG ======= */
function mkRand(seed){
  let s=seed>>>0;
  return()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296};
}

/* ======= DATA GENERATION ======= */
function genCandles(n=130,seed=42){
  const r=mkRand(seed),candles=[];
  let price=92000;
  const now=Date.now(),iv=4*3600*1000;
  for(let i=n;i>=0;i--){
    const vol=(r()-.47)*(0.015+r()*.012);
    const open=price;
    price=Math.max(75000,Math.min(115000,price*(1+vol)));
    const hi=Math.max(open,price)*(1+r()*.006);
    const lo=Math.min(open,price)*(1-r()*.006);
    candles.push({time:now-i*iv,open,high:hi,low:lo,close:price,
      volume:(r()*400+150)*1e3,up:price>=open});
  }
  return candles;
}
function calcMA(c,p){
  return c.map((_,i)=>{
    if(i<p-1)return null;
    return c.slice(i-p+1,i+1).reduce((a,x)=>a+x.close,0)/p;
  });
}
function genEquity(seed=7){
  const r=mkRand(seed);let v=10000;const pts=[];
  for(let i=0;i<210;i++){v*=(1+(r()-.44)*.038);pts.push(v);}
  const scale=59697/pts[pts.length-1];
  return pts.map(x=>x*scale);
}
function genScatter(seed=99){
  const r=mkRand(seed),data=[];
  for(let s=5;s<=50;s+=5){
    for(let l=50;l<=300;l+=25){
      if(l<=s*2)continue;
      const ratio=l/s;
      // More realistic varied returns: sweet spot around ratio 6-10
      const sweetness=Math.max(0,1-Math.abs(ratio-8)/6);
      const baseRet=20+sweetness*580+(r()-.5)*120;
      const ret=Math.min(720,Math.max(-15,baseRet));
      const baseDd=20+sweetness*-10+r()*48;
      const dd=Math.min(82,Math.max(14,baseDd));
      const trades=Math.floor(30+sweetness*80+r()*90);
      const sharpe=0.3+sweetness*1.6+r()*.8;
      data.push({s,l,ret,dd,trades,sharpe,top:0});
    }
  }
  // mark top 3 by Sharpe-weighted ret/dd
  data.sort((a,b)=>(b.ret/b.dd*b.sharpe)-(a.ret/a.dd*a.sharpe));
  data[0].top=1;data[1].top=2;data[2].top=3;
  return data;
}

/* ======= CANVAS CHART ======= */
let CANDLES=genCandles(130,42);
let SHOW_MA=true,CANDLE_STYLE='candle';

function drawChart(cid,candles,opts={}){
  const canvas=document.getElementById(cid);
  if(!canvas)return;
  const parent=canvas.parentElement;
  const W=parent.clientWidth,H=parent.clientHeight;
  if(W<10||H<10)return;
  const dpr=window.devicePixelRatio||1;
  canvas.width=W*dpr;canvas.height=H*dpr;
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const{markers=[],mini=false}=opts;
  const PAD={t:mini?8:16,r:mini?8:74,b:mini?24:68,l:8};
  const VOL_H=mini?0:Math.round(H*.15);
  const CHART_H=H-PAD.t-PAD.b;
  const PRICE_H=CHART_H-(VOL_H>0?VOL_H+6:0);
  const cW=W-PAD.l-PAD.r;
  const disp=candles.slice(-( mini?60:80));
  const n=disp.length;
  let minP=Infinity,maxP=-Infinity;
  disp.forEach(c=>{if(c.low<minP)minP=c.low;if(c.high>maxP)maxP=c.high;});
  minP*=.9985;maxP*=1.0015;const pRange=maxP-minP;
  const maxV=Math.max(...disp.map(c=>c.volume));
  const toY=p=>PAD.t+PRICE_H*(1-(p-minP)/pRange);
  const spacing=cW/n;
  const cw=Math.max(2,Math.floor(spacing*.7));
  const cx=i=>PAD.l+i*spacing+spacing/2;

  /* BG */
  ctx.fillStyle='#131722';ctx.fillRect(0,0,W,H);

  /* GRID */
  const gridLvl=mini?3:6;
  ctx.strokeStyle='rgba(255,255,255,.04)';ctx.lineWidth=1;
  for(let i=0;i<=gridLvl;i++){
    const y=PAD.t+(PRICE_H*i/gridLvl);
    ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(W-PAD.r,y);ctx.stroke();
    if(!mini){
      const p=maxP-(pRange*i/gridLvl);
      ctx.fillStyle='rgba(120,123,134,.7)';ctx.font=`10px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')||'JetBrains Mono,monospace'}`;
      ctx.textAlign='left';
      ctx.fillText('$'+p.toLocaleString('en',{maximumFractionDigits:0}),W-PAD.r+4,y+4);
    }
  }
  if(!mini){
    for(let i=0;i<n;i+=10){
      ctx.strokeStyle='rgba(255,255,255,.03)';ctx.beginPath();
      ctx.moveTo(cx(i),PAD.t);ctx.lineTo(cx(i),PAD.t+PRICE_H);ctx.stroke();
    }
  }

  /* VOLUME */
  if(VOL_H>0){
    disp.forEach((c,i)=>{
      const vh=VOL_H*(c.volume/maxV);
      const y=H-PAD.b-vh+4;
      ctx.fillStyle=c.up?'rgba(38,166,154,.2)':'rgba(239,83,80,.2)';
      ctx.fillRect(cx(i)-cw/2,y,cw,vh-3);
    });
  }

  /* MA LINES */
  if(SHOW_MA&&!mini){
    const ma20=calcMA(CANDLES,20).slice(-80);
    const ma50=calcMA(CANDLES,50).slice(-80);
    [[ma50,'rgba(247,147,26,.7)'],[ma20,'rgba(0,212,255,.7)']].forEach(([arr,col])=>{
      ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=1.5;let st=false;
      arr.forEach((v,i)=>{
        if(v===null)return;
        const x=cx(i),y=toY(v);
        if(!st){ctx.moveTo(x,y);st=true;}else ctx.lineTo(x,y);
      });ctx.stroke();
    });
    /* MA legend */
    ctx.font='10px JetBrains Mono,monospace';ctx.textAlign='left';
    [[PAD.l+10,'rgba(0,212,255,.9)','MA 20'],[PAD.l+10,'rgba(247,147,26,.9)','MA 50']].forEach(([x,c,lbl],idx)=>{
      const y=PAD.t+16+idx*16;
      ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.beginPath();
      ctx.moveTo(x,y-3);ctx.lineTo(x+14,y-3);ctx.stroke();
      ctx.fillStyle=c;ctx.fillText(lbl,x+18,y);
    });
  }

  /* CANDLES / AREA */
  if(CANDLE_STYLE==='area'){
    ctx.beginPath();
    disp.forEach((c,i)=>{const x=cx(i),y=toY(c.close);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    const lastX=cx(n-1),baseY=PAD.t+PRICE_H;
    ctx.lineTo(lastX,baseY);ctx.lineTo(cx(0),baseY);ctx.closePath();
    const grad=ctx.createLinearGradient(0,PAD.t,0,PAD.t+PRICE_H);
    grad.addColorStop(0,'rgba(0,212,255,.25)');grad.addColorStop(1,'rgba(0,212,255,0)');
    ctx.fillStyle=grad;ctx.fill();
    ctx.beginPath();ctx.strokeStyle='rgba(0,212,255,.8)';ctx.lineWidth=1.5;
    disp.forEach((c,i)=>{const x=cx(i),y=toY(c.close);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.stroke();
  } else {
    disp.forEach((c,i)=>{
      const x=cx(i),oY=toY(c.open),cY=toY(c.close),hY=toY(c.high),lY=toY(c.low);
      const col=c.up?'#26a69a':'#ef5350';
      ctx.strokeStyle=col;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,hY);ctx.lineTo(x,lY);ctx.stroke();
      const bT=Math.min(oY,cY),bH=Math.max(1,Math.abs(cY-oY));
      ctx.fillStyle=col;ctx.fillRect(x-cw/2,bT,cw,bH);
    });
  }

  /* BUY/SELL MARKERS */
  markers.forEach(m=>{
    const idx=disp.findIndex(c=>c.time>=m.time);
    if(idx<0)return;
    const x=cx(idx),y=toY(disp[idx].close);
    const isBuy=m.type==='buy';
    ctx.fillStyle=isBuy?'#26a69a':'#ef5350';
    ctx.beginPath();
    if(isBuy){ctx.moveTo(x,y+14);ctx.lineTo(x-6,y+24);ctx.lineTo(x+6,y+24);}
    else{ctx.moveTo(x,y-14);ctx.lineTo(x-6,y-24);ctx.lineTo(x+6,y-24);}
    ctx.closePath();ctx.fill();
  });

  /* CURRENT PRICE LINE */
  if(!mini){
    const last=disp[n-1];
    const py=toY(last.close);
    ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(0,212,255,.45)';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(PAD.l,py);ctx.lineTo(W-PAD.r,py);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(0,212,255,.9)';
    ctx.fillRect(W-PAD.r,py-9,PAD.r,18);
    ctx.fillStyle='#131722';ctx.font='bold 10px JetBrains Mono,monospace';ctx.textAlign='center';
    ctx.fillText('$'+Math.round(last.close).toLocaleString('en'),W-PAD.r/2,py+4);
  }
}

/* ======= EQUITY SVG ======= */
function drawEquity(){
  const svg=document.getElementById('equity');
  if(!svg)return;
  const data=genEquity();
  const W=700,H=160,PAD={t:8,r:8,b:20,l:44};
  const n=data.length;
  const minV=Math.min(...data)*.96,maxV=Math.max(...data)*1.04;
  const tx=i=>PAD.l+(i/(n-1))*(W-PAD.l-PAD.r);
  const ty=v=>PAD.t+(1-(v-minV)/(maxV-minV))*(H-PAD.t-PAD.b);
  let path=`M${tx(0)},${ty(data[0])}`,area=`M${tx(0)},${H-PAD.b}L${tx(0)},${ty(data[0])}`;
  data.forEach((v,i)=>{if(i===0)return;path+=` L${tx(i)},${ty(v)}`;area+=` L${tx(i)},${ty(v)}`;});
  area+=` L${tx(n-1)},${H-PAD.b}Z`;
  let grids='';
  for(let i=1;i<=3;i++){
    const y=PAD.t+i*(H-PAD.t-PAD.b)/4;
    const v=maxV-(i/4)*(maxV-minV);
    grids+=`<line x1="${PAD.l}" y1="${y}" x2="${W-PAD.r}" y2="${y}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>`;
    grids+=`<text x="${PAD.l-4}" y="${y+4}" text-anchor="end" fill="rgba(120,123,134,.7)" font-size="9" font-family="JetBrains Mono,monospace">$${(v/1000).toFixed(0)}k</text>`;
  }
  const baseY=ty(10000);
  grids+=`<line x1="${PAD.l}" y1="${baseY}" x2="${W-PAD.r}" y2="${baseY}" stroke="rgba(255,255,255,.1)" stroke-width="1" stroke-dasharray="3,3"/>`;
  grids+=`<text x="${PAD.l-4}" y="${baseY-3}" text-anchor="end" fill="rgba(120,123,134,.5)" font-size="8" font-family="JetBrains Mono,monospace">$10k</text>`;
  const totalLen=3500;
  svg.innerHTML=`<defs>
    <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#26a69a" stop-opacity=".35"/>
      <stop offset="100%" stop-color="#26a69a" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="el" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00d4ff"/>
      <stop offset="70%" stop-color="#26a69a"/>
    </linearGradient>
  </defs>
  ${grids}
  <path d="${area}" fill="url(#eg)"/>
  <path d="${path}" fill="none" stroke="url(#el)" stroke-width="1.8"
    stroke-dasharray="${totalLen}" stroke-dashoffset="${totalLen}" id="ePath"/>`;
  setTimeout(()=>{
    const p=document.getElementById('ePath');
    if(p){p.style.transition='stroke-dashoffset 2.2s ease-in-out';p.style.strokeDashoffset='0';}
  },200);
}

/* ======= SCATTER SVG ======= */
function drawScatter(){
  const svg=document.getElementById('scatter');
  if(!svg)return;
  const rect=svg.getBoundingClientRect();
  const W=Math.max(400,rect.width),H=Math.max(300,rect.height);
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const data=genScatter();
  const PAD={t:20,r:20,b:48,l:56};
  const minR=Math.min(...data.map(d=>d.ret)),maxR=Math.max(...data.map(d=>d.ret));
  const minD=Math.min(...data.map(d=>d.dd)),maxD=Math.max(...data.map(d=>d.dd));
  const maxT=Math.max(...data.map(d=>d.trades));
  const tx=r=>PAD.l+(r-minR)/(maxR-minR)*(W-PAD.l-PAD.r);
  const ty=d=>PAD.t+(d-minD)/(maxD-minD)*(H-PAD.t-PAD.b);
  const tr=t=>3+(t/maxT)*13;
  let inner='';
  // grid
  for(let i=0;i<=4;i++){
    const x=PAD.l+i*(W-PAD.l-PAD.r)/4;
    const y=PAD.t+i*(H-PAD.t-PAD.b)/4;
    const rv=(minR+i*(maxR-minR)/4).toFixed(0);
    const dv=(minD+i*(maxD-minD)/4).toFixed(0);
    inner+=`<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${H-PAD.b}" stroke="rgba(255,255,255,.05)" stroke-width="1"/>`;
    inner+=`<text x="${x}" y="${H-PAD.b+14}" text-anchor="middle" fill="rgba(120,123,134,.6)" font-size="9" font-family="JetBrains Mono,monospace">${rv}%</text>`;
    inner+=`<line x1="${PAD.l}" y1="${y}" x2="${W-PAD.r}" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width="1"/>`;
    inner+=`<text x="${PAD.l-4}" y="${y+4}" text-anchor="end" fill="rgba(120,123,134,.6)" font-size="9" font-family="JetBrains Mono,monospace">${dv}%</text>`;
  }
  inner+=`<text x="${W/2}" y="${H-4}" text-anchor="middle" fill="rgba(120,123,134,.6)" font-size="10" font-family="Space Grotesk,sans-serif">收益率 →</text>`;
  inner+=`<text x="12" y="${H/2}" text-anchor="middle" fill="rgba(120,123,134,.6)" font-size="10" font-family="Space Grotesk,sans-serif" transform="rotate(-90 12 ${H/2})">最大回撤 →</text>`;
  // best zone
  const bx=tx(maxR*.55);
  inner+=`<rect x="${bx}" y="${PAD.t}" width="${W-PAD.r-bx}" height="${ty(maxD*.42)-PAD.t}"
    rx="3" fill="rgba(38,166,154,.04)" stroke="rgba(38,166,154,.15)" stroke-width="1" stroke-dasharray="4,3"/>`;
  inner+=`<text x="${bx+8}" y="${PAD.t+14}" fill="rgba(38,166,154,.6)" font-size="9" font-family="JetBrains Mono,monospace">最优区域</text>`;
  // dots
  data.forEach(d=>{
    const x=tx(d.ret),y=ty(d.dd),radius=tr(d.trades);
    const ddPct=(d.dd-minD)/(maxD-minD);
    let fill,stroke;
    if(d.top===1){fill='#fbbf24';stroke='#ffd700';}
    else if(d.top===2){fill='#94a3b8';stroke='#c0cfe0';}
    else if(d.top===3){fill='#cd7f32';stroke='#e09050';}
    else{
      const rr=Math.round(ddPct*100+20),gg=Math.round((1-ddPct)*120+40);
      fill=`rgba(${rr},${gg},180,.5)`;stroke=`rgba(${rr},${gg},220,.7)`;
    }
    inner+=`<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${d.top?2:1}" opacity=".88">
      <title>short=${d.s} long=${d.l} 收益=${d.ret.toFixed(1)}% 回撤=${d.dd.toFixed(1)}%</title>
    </circle>`;
    if(d.top===1){
      inner+=`<text x="${x+radius+4}" y="${y+4}" fill="#fbbf24" font-size="9" font-family="JetBrains Mono,monospace">s=${d.s}/l=${d.l}</text>`;
    }
  });
  svg.innerHTML=`<defs><filter id="gf"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${inner}`;
}

/* ======= PARETO CHART (S5) ======= */
function drawPareto(){
  const svg=document.getElementById('paretoChart');
  if(!svg)return;
  const rect=svg.getBoundingClientRect();
  const W=Math.max(400,rect.width),H=Math.max(280,rect.height);
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const data=genScatter();
  const pareto=data.filter((_,i)=>i<38);
  const rest=data.filter((_,i)=>i>=38&&i<120);
  const PAD={t:20,r:20,b:40,l:52};
  const minR=Math.min(...data.map(d=>d.ret)),maxR=Math.max(...data.map(d=>d.ret));
  const minD=Math.min(...data.map(d=>d.dd)),maxD=Math.max(...data.map(d=>d.dd));
  const tx=r=>PAD.l+(r-minR)/(maxR-minR)*(W-PAD.l-PAD.r);
  const ty=d=>PAD.t+(d-minD)/(maxD-minD)*(H-PAD.t-PAD.b);
  let inner='';
  for(let i=0;i<=4;i++){
    const x=PAD.l+i*(W-PAD.l-PAD.r)/4;
    const y=PAD.t+i*(H-PAD.t-PAD.b)/4;
    inner+=`<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${H-PAD.b}" stroke="rgba(255,255,255,.05)" stroke-width="1"/>`;
    inner+=`<line x1="${PAD.l}" y1="${y}" x2="${W-PAD.r}" y2="${y}" stroke="rgba(255,255,255,.05)" stroke-width="1"/>`;
    inner+=`<text x="${x}" y="${H-PAD.b+12}" text-anchor="middle" fill="rgba(120,123,134,.5)" font-size="8" font-family="JetBrains Mono,monospace">${(minR+i*(maxR-minR)/4).toFixed(0)}%</text>`;
    inner+=`<text x="${PAD.l-4}" y="${y+3}" text-anchor="end" fill="rgba(120,123,134,.5)" font-size="8" font-family="JetBrains Mono,monospace">${(minD+i*(maxD-minD)/4).toFixed(0)}%</text>`;
  }
  inner+=`<text x="${W/2}" y="${H-4}" text-anchor="middle" fill="rgba(120,123,134,.5)" font-size="9" font-family="Space Grotesk,sans-serif">收益率 →</text>`;
  rest.forEach(d=>{
    inner+=`<circle cx="${tx(d.ret)}" cy="${ty(d.dd)}" r="4" fill="rgba(239,83,80,.35)" stroke="rgba(239,83,80,.5)" stroke-width=".8"/>`;
  });
  pareto.forEach((d,i)=>{
    const col=i<3?'#fbbf24':'rgba(38,166,154,.8)';
    const sc=i<3?'#ffd700':'rgba(0,212,255,.8)';
    inner+=`<circle cx="${tx(d.ret)}" cy="${ty(d.dd)}" r="${i<3?7:5}" fill="${col}" stroke="${sc}" stroke-width="${i<3?2:1}"/>`;
  });
  const legend=[['rgba(38,166,154,.8)','帕累托通过'],['rgba(239,83,80,.45)','未通过'],['#fbbf24','Top 3']];
  legend.forEach(([c,l],i)=>{
    const lx=PAD.l+8,ly=PAD.t+12+i*16;
    inner+=`<circle cx="${lx+4}" cy="${ly-3}" r="4" fill="${c}"/>`;
    inner+=`<text x="${lx+14}" y="${ly}" fill="rgba(120,123,134,.8)" font-size="9" font-family="Space Grotesk,sans-serif">${l}</text>`;
  });
  svg.innerHTML=inner;
}

/* ======= TRADES TABLE ======= */
function renderTrades(){
  const r=mkRand(55);
  const tbody=document.getElementById('tradesTbody');
  if(!tbody)return;
  let price=88000;
  const rows=[];
  const months=['01','02','03','04','05','06','07','08','09','10','11','12'];
  for(let i=0;i<12;i++){
    const entry=price*(1+(r()-.5)*.04);
    const pct=(r()-.36)*.14;
    const exit=entry*(1+pct);
    price=exit;
    const mo=months[i%12];
    rows.push({n:i+1,date:`25/${mo}/15`,side:r()>.3?'LONG':'SHORT',
      entry:entry,exit:exit,pnl:pct*100});
  }
  tbody.innerHTML=rows.map(t=>`<tr>
    <td>${t.n}</td><td>${t.date}</td>
    <td style="color:${t.side==='LONG'?'#26a69a':'#ef5350'}">${t.side}</td>
    <td>$${Math.round(t.entry).toLocaleString('en')}</td>
    <td>$${Math.round(t.exit).toLocaleString('en')}</td>
    <td class="${t.pnl>=0?'up':'dn'}">${t.pnl>=0?'+':''}${t.pnl.toFixed(2)}%</td>
  </tr>`).join('');
}

/* ======= TOP 10 ======= */
function renderTop10(containerId='top10list'){
  const el=document.getElementById(containerId);
  if(!el)return;
  const data=genScatter();
  data.sort((a,b)=>b.ret-a.ret);
  const r=mkRand(11);
  el.innerHTML=data.slice(0,10).map((d,i)=>{
    const rc=['r1','r2','r3','rn','rn','rn','rn','rn','rn','rn'][i];
    const rob=58+r()*38;
    return`<div class="t10-row">
      <div class="rank ${rc}">${i+1}</div>
      <div class="p-cell">s=${d.s}/l=${d.l}</div>
      <div class="p-cell" style="color:#26a69a">+${d.ret.toFixed(1)}%</div>
      <div class="p-cell" style="color:#ef5350">-${d.dd.toFixed(1)}%</div>
      <div class="p-cell" style="color:#f0b90b">${d.sharpe.toFixed(2)}</div>
      <div><div style="display:flex;align-items:center;gap:6px">
        <div class="rob-bar" style="flex:1"><div class="rob-fill" style="width:${rob.toFixed(0)}%"></div></div>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text2);min-width:28px">${rob.toFixed(0)}%</span>
      </div></div>
    </div>`;
  }).join('');
}

/* ======= SCORE BREAKDOWN ======= */
function renderScoreBreakdown(){
  const el=document.getElementById('scoreBk');
  if(!el)return;
  const items=[['Calmar',87],['Sortino',82],['盈利因子',91],['Sharpe',78],['净收益',95]];
  el.innerHTML=items.map(([n,v])=>`<div class="score-bk">
    <div class="sb-row"><span class="sb-name">${n}</span><span class="sb-val">${v}/100</span></div>
    <div class="rob-bar"><div class="rob-fill" style="width:${v}%;background:linear-gradient(90deg,#9c6cfe,#00d4ff)"></div></div>
  </div>`).join('');
}

/* ======= CODE EDITOR ======= */
const CODE=[
  '<span class="cm"># MA 双均线交叉策略 — BTC Station</span>',
  '<span class="kw">import</span> pandas <span class="kw">as</span> pd',
  '<span class="kw">import</span> vectorbt <span class="kw">as</span> vbt',
  '',
  '<span class="kw">def</span> <span class="fn">execute</span>(df, parameters):',
  '    <span class="cm">"""</span>',
  '    <span class="cm">Args:</span>',
  '    <span class="cm">  df: DataFrame with OHLCV</span>',
  '    <span class="cm">  parameters: strategy params dict</span>',
  '    <span class="cm">"""</span>',
  '    short_w = parameters[<span class="st">"short_window"</span>]',
  '    long_w  = parameters[<span class="st">"long_window"</span>]',
  '    capital = parameters[<span class="st">"initial_capital"</span>]',
  '',
  '    <span class="cm"># 计算快/慢移动均线</span>',
  '    ma_fast = df[<span class="st">"close"</span>].rolling(short_w).mean()',
  '    ma_slow = df[<span class="st">"close"</span>].rolling(long_w).mean()',
  '',
  '    <span class="cm"># 金叉入场 / 死叉出场</span>',
  '    entries = (ma_fast > ma_slow) & (ma_fast.shift(<span class="nu">1</span>) <= ma_slow.shift(<span class="nu">1</span>))',
  '    exits   = (ma_fast < ma_slow) & (ma_fast.shift(<span class="nu">1</span>) >= ma_slow.shift(<span class="nu">1</span>))',
  '',
  '    portfolio = vbt.Portfolio.from_signals(',
  '        df[<span class="st">"close"</span>], entries, exits,',
  '        init_cash=capital,',
  '        freq=<span class="st">"4h"</span>',
  '    )',
  '    indicators = {',
  '        <span class="st">"MA Fast"</span>: ma_fast,',
  '        <span class="st">"MA Slow"</span>: ma_slow,',
  '    }',
  '    <span class="kw">return</span> portfolio, indicators',
  '<span class="cursor"></span>',
];
function renderEditor(){
  const nums=document.getElementById('edNums');
  const code=document.getElementById('edCode');
  if(!nums||!code)return;
  nums.textContent=CODE.map((_,i)=>i+1).join('\n');
  code.innerHTML=CODE.join('\n');
}

/* ======= COUNTER ANIMATION ======= */
function counter(el,to,dur,fmt){
  if(!el)return;
  const start=performance.now();
  const tick=now=>{
    const t=Math.min(1,(now-start)/dur);
    const e=1-Math.pow(1-t,3);
    el.textContent=fmt(to*e);
    if(t<1)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ======= RUN LOG SIMULATION ======= */
function runSim(){
  const log=document.getElementById('runLog');
  if(!log)return;
  const lines=[
    '<span style="color:var(--cyan)">▶ 加载策略: MA双均线交叉</span>',
    '获取 BTC/USDT 4h K线... 16500 根',
    '初始化 VectorBT 引擎...',
    '计算 MA(12) MA(26)...',
    '生成交叉信号: entries=96, exits=96',
    '<span style="color:var(--bull)">✓ 回测完成 (0.23s)</span>',
    '<span style="color:var(--bull)">净收益: +496.97%  |  最大回撤: -68.74%  |  Sharpe: 0.78</span>',
  ];
  log.innerHTML='';let i=0;
  const interval=setInterval(()=>{
    if(i>=lines.length){clearInterval(interval);return;}
    log.innerHTML+=`<div style="margin-bottom:3px">${lines[i++]}</div>`;
    log.scrollTop=log.scrollHeight;
  },280);
}

/* ======= LIVE PRICE ======= */
let livePrice=103247.8;
function tickPrice(){
  livePrice*=(1+(Math.random()-.49)*.0018);
  const fmt=v=>v.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('navPrice').textContent='$'+fmt(livePrice);
  document.getElementById('s1Price').textContent=fmt(livePrice);
}
setInterval(tickPrice,3200);

/* ======= TWEAKS ======= */
let tweakTheme='tv',tweakCandle='candle';
function closeTweaks(){document.getElementById('tweaksPanel').classList.remove('open');}
function setTheme(t){
  tweakTheme=t;
  document.querySelectorAll('[id^="t-tv"],[id^="t-deep"],[id^="t-navy"]').forEach(b=>b.classList.remove('on'));
  document.getElementById('t-'+t)?.classList.add('on');
  const map={tv:['#131722','#1e222d'],deep:['#080c14','#10161f'],navy:['#0a0e1f','#111827']};
  const[bg,bg2]=map[t]||map.tv;
  document.documentElement.style.setProperty('--bg',bg);
  document.documentElement.style.setProperty('--bg2',bg2);
  redrawAll();
}
function setCandle(s){
  CANDLE_STYLE=s;tweakCandle=s;
  document.getElementById('t-candle').classList.toggle('on',s==='candle');
  document.getElementById('t-area').classList.toggle('on',s==='area');
  redrawAll();
}
function toggleMA(){
  SHOW_MA=!SHOW_MA;
  document.getElementById('t-ma').classList.toggle('on',SHOW_MA);
  document.getElementById('t-ma').textContent=(SHOW_MA?'显示':'隐藏')+' MA';
  redrawAll();
}
function redrawAll(){
  drawChart('c1',CANDLES);
  drawChart('c2',CANDLES,{mini:true});
  drawChart('c3',CANDLES,{markers:genMarkers()});
}

/* ======= MARKERS ======= */
function genMarkers(){
  const r=mkRand(88);
  return CANDLES.filter((_,i)=>i%15===0&&i>10).map((c,i)=>({time:c.time,type:i%2===0?'buy':'sell'}));
}

/* ======= NAV ACTIVE STATE ======= */
function setupNav(){
  const secs=document.querySelectorAll('section');
  const links=document.querySelectorAll('.nav-link');
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        const id=e.target.id;
        links.forEach(l=>{
          l.classList.toggle('active',l.getAttribute('href')==='#'+id);
        });
      }
    });
  },{threshold:.4});
  secs.forEach(s=>obs.observe(s));
}

/* ======= SCROLL ANIMATIONS ======= */
let s3Animated=false,s5Animated=false;
function setupObservers(){
  const obs=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        if(e.target.id==='s3'&&!s3Animated){
          s3Animated=true;
          counter(document.getElementById('b1'),496.97,2200,v=>'+'+v.toFixed(2)+'%');
          counter(document.getElementById('b2'),68.74,2200,v=>'-'+v.toFixed(2)+'%');
          counter(document.getElementById('b3'),37.2,1900,v=>v.toFixed(1)+'%');
          counter(document.getElementById('b4'),.78,1800,v=>v.toFixed(2));
          counter(document.getElementById('b5'),1.12,1800,v=>v.toFixed(2));
          counter(document.getElementById('b6'),1.24,1800,v=>v.toFixed(2));
          counter(document.getElementById('m1r'),496.97,2200,v=>'+'+v.toFixed(1)+'%');
          counter(document.getElementById('m1d'),68.74,2200,v=>'-'+v.toFixed(1)+'%');
          counter(document.getElementById('m1w'),37.2,1900,v=>v.toFixed(1)+'%');
          counter(document.getElementById('m1s'),.78,1800,v=>v.toFixed(2));
          counter(document.getElementById('m1so'),1.12,1800,v=>v.toFixed(2));
          counter(document.getElementById('m1p'),1.24,1800,v=>v.toFixed(2));
          drawEquity();
        }
        if(e.target.id==='s5'&&!s5Animated){
          s5Animated=true;
          counter(document.getElementById('gScore'),89,2000,v=>Math.round(v));
          setTimeout(()=>{
            const c=document.getElementById('gCircle');
            if(c){const cir=2*Math.PI*54;c.style.transition='stroke-dashoffset 2s ease-in-out';c.style.strokeDashoffset=cir*(1-.893);}
          },200);
        }
      }
    });
  },{threshold:.15});
  document.querySelectorAll('section').forEach(s=>obs.observe(s));
}

/* ======= TF BUTTON CLICKS ======= */
function setupTFButtons(){
  document.querySelectorAll('.tf').forEach(btn=>{
    btn.addEventListener('click',function(){
      const group=this.closest('.tb-tfs');
      if(group)group.querySelectorAll('.tf').forEach(b=>b.classList.remove('on'));
      this.classList.add('on');
    });
  });
  document.querySelectorAll('.tool').forEach(btn=>{
    btn.addEventListener('click',function(){
      const group=this.closest('.tv-tools');
      if(group)group.querySelectorAll('.tool').forEach(b=>b.classList.remove('on'));
      this.classList.add('on');
    });
  });
  document.querySelectorAll('.ptab').forEach(tab=>{
    tab.addEventListener('click',function(){
      const group=this.closest('.panel-tabs');
      if(group)group.querySelectorAll('.ptab').forEach(t=>t.classList.remove('on'));
      this.classList.add('on');
    });
  });
  document.querySelectorAll('.tmpl-item').forEach(item=>{
    item.addEventListener('click',function(){
      document.querySelectorAll('.tmpl-item').forEach(i=>i.classList.remove('on'));
      this.classList.add('on');
    });
  });
}

/* ======= TWEAKS HOST PROTOCOL ======= */
function setupTweaks(){
  window.addEventListener('message',e=>{
    if(e.data?.type==='__activate_edit_mode')document.getElementById('tweaksPanel').classList.add('open');
    if(e.data?.type==='__deactivate_edit_mode')document.getElementById('tweaksPanel').classList.remove('open');
  });
  window.parent.postMessage({type:'__edit_mode_available'},'*');
}

/* ======= LIVE CANDLE ANIMATION ======= */
function startLiveCandles(){
  setInterval(()=>{
    const last=CANDLES[CANDLES.length-1];
    const ch=(Math.random()-.49)*.009;
    const nc={
      time:last.time+4*3600*1e3,open:last.close,
      high:Math.max(last.close,last.close*(1+Math.abs(ch)))*((1+Math.random()*.003)),
      low:Math.min(last.close,last.close*(1-Math.abs(ch)))*(1-Math.random()*.003),
      close:last.close*(1+ch),
      volume:(Math.random()*400+150)*1e3,
      up:ch>=0
    };
    CANDLES.push(nc);CANDLES=CANDLES.slice(-140);
    redrawAll();
  },4500);
}

/* ======= RESIZE ======= */
function onResize(){
  redrawAll();drawScatter();drawPareto();
}

/* ======= INIT ======= */
document.addEventListener('DOMContentLoaded',()=>{
  renderEditor();
  renderTrades();
  renderTop10('top10list');
  renderTop10('reportTop10');
  renderScoreBreakdown();
  setupNav();
  setupObservers();
  setupTFButtons();
  setupTweaks();

  // draw all charts
  // slight delay so layout is stable
  setTimeout(()=>{
    redrawAll();
    drawScatter();
    drawPareto();
    startLiveCandles();
  },100);

  window.addEventListener('resize',onResize);
});
