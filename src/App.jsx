import { useState, useMemo, useReducer, useCallback } from "react";

// ═══════════════════════════════════════════════════════
// § 1. 법정 기준 데이터 (서울시 기준)
// ═══════════════════════════════════════════════════════

const INIT_ZONE_STDS = {
  "제1종전용주거": { maxBcr: 50, maxFar: 100 },
  "제2종전용주거": { maxBcr: 40, maxFar: 150 },
  "제1종일반주거": { maxBcr: 60, maxFar: 200 },
  "제2종일반주거": { maxBcr: 60, maxFar: 250 },
  "제3종일반주거": { maxBcr: 50, maxFar: 300 },
  "준주거":        { maxBcr: 60, maxFar: 500 },
  "중심상업":      { maxBcr: 90, maxFar: 1500 },
  "일반상업":      { maxBcr: 80, maxFar: 1300 },
  "근린상업":      { maxBcr: 70, maxFar: 900 },
  "유통상업":      { maxBcr: 80, maxFar: 1100 },
  "전용공업":      { maxBcr: 70, maxFar: 300 },
  "일반공업":      { maxBcr: 70, maxFar: 350 },
  "준공업":        { maxBcr: 70, maxFar: 400 },
  "보전녹지":      { maxBcr: 20, maxFar: 80 },
  "생산녹지":      { maxBcr: 20, maxFar: 100 },
  "자연녹지":      { maxBcr: 20, maxFar: 100 },
  "계획관리":      { maxBcr: 40, maxFar: 100 },
  "생산관리":      { maxBcr: 20, maxFar: 80 },
  "보전관리":      { maxBcr: 20, maxFar: 80 },
  "농림":          { maxBcr: 20, maxFar: 80 },
  "자연환경보전":  { maxBcr: 20, maxFar: 80 },
};

// 서울시 주차장 설치 및 관리 조례 [별표1] 부설주차장 설치기준
const INIT_PARK_STDS = {
  office: { label: "업무시설",     basis: "area", rate: 150,  unit: "㎡/대", note: "서울시 주차장조례 별표1 — 시설면적 150㎡당 1대" },
  retail: { label: "판매·상업시설", basis: "area", rate: 150,  unit: "㎡/대", note: "서울시 주차장조례 별표1 — 시설면적 150㎡당 1대" },
  resi:   { label: "공동주택",     basis: "unit", rate: 1.0,  unit: "대/세대", note: "서울시 주차장조례 별표1 — 세대당 1.0대 (전용 85㎡ 이하 기준)" },
  hotel:  { label: "숙박시설",     basis: "area", rate: 200,  unit: "㎡/대", note: "서울시 주차장조례 별표1 — 시설면적 200㎡당 1대" },
  mixed:  { label: "복합시설",     basis: "area", rate: 150,  unit: "㎡/대", note: "서울시 주차장조례 별표1 — 주용도 기준 적용" },
};

// 제부담금 항목 (법적 근거 포함)
const CHARGE_ITEMS = [
  { key: "waterSupply", label: "상수도원인자부담금",    law: "수도법 제71조",                         hint: "건축비×0.1~0.5% 수준. 구경별 단가×공급량(㎥/일)" },
  { key: "sewer",       label: "하수도원인자부담금",    law: "하수도법 제61조·서울시 하수도조례 §29",  hint: "건축비×0.5~1.5% 수준. 단위금액×오수발생량(㎥/일)" },
  { key: "distHeat",    label: "지역난방시설부담금",    law: "집단에너지사업법",                      hint: "지상연면적×20,000~30,000원/㎡ (지구별 상이)" },
  { key: "gas",         label: "도시가스시설분담금",    law: "도시가스사업법",                        hint: "세대당 또는 호당 분담금 (사업자별 상이)" },
  { key: "transport",   label: "광역교통시설부담금",    law: "대도시권광역교통관리특별법 §11의3",      hint: "표준개발비×부과율×면적×용적률보정. 수도권 과밀억제권역 해당 시" },
  { key: "school",      label: "학교용지부담금",        law: "학교용지확보에관한특례법",               hint: "분양 공동주택 포함 시 해당. 공급면적합계×표준지가×부과율(0.8%)" },
  { key: "overcrowd",   label: "과밀부담금",            law: "수도권정비계획법 §12",                  hint: "업무용 건축물 연면적 25,000㎡ 초과 시 (초과 연면적×기준건축비×10%)" },
  { key: "develop",     label: "개발부담금",            law: "개발이익환수에관한법률",                hint: "개발 완료 후 지가상승분의 25%. 해당 시 직접입력" },
];

// 취득세율 기준 (지방세법)
const ACQUI_TAX_RATE = 4.6; // 취득세 4% + 농특세 0.2% + 지방교육세 0.4%

// 재산세 산정기준
const PROP_TAX = {
  bldgEffR: 0.1225,  // 건물: 건축비×잔존가치50%×공정가액70%×세율0.25%×교육세1.2 ≈ 0.1225% / 실질 적용률
  landEffR: 0.252,   // 토지: 별도합산, 공정가액70%×0.3%×교육세1.2 ≈ 0.252%
  urbanR:   0.14,    // 도시지역분: 과세표준×0.14%
  note: "지방세법 §110~§122. 시가표준액 기반 산정이며 시뮬레이터는 건축비/토지비 기준 근사값 제공"
};

// ═══════════════════════════════════════════════════════
// § 2. 건물 유형 정의
// ═══════════════════════════════════════════════════════
const BT = {
  office: { label:"업무시설",  short:"업무", color:"#1d4ed8", bg:"#dbeafe", emoji:"🏢", exclCol:"임대전용" },
  retail: { label:"상업시설",  short:"상업", color:"#b45309", bg:"#fef3c7", emoji:"🏪", exclCol:"점포전용" },
  resi:   { label:"공동주택",  short:"주거", color:"#047857", bg:"#d1fae5", emoji:"🏠", exclCol:"세대전용" },
  hotel:  { label:"숙박시설",  short:"숙박", color:"#6d28d9", bg:"#ede9fe", emoji:"🏨", exclCol:"객실전용" },
  mixed:  { label:"복합시설",  short:"복합", color:"#be185d", bg:"#fce7f3", emoji:"🏙️", exclCol:"전용면적" },
};

// ═══════════════════════════════════════════════════════
// § 3. 유틸리티
// ═══════════════════════════════════════════════════════
const n  = v => parseFloat(String(v??"").replace(/,/g,""))||0;
const fmt= (v,d=2)=>{ const x=n(v); return(!isFinite(x)||x===0)?"—":x.toLocaleString("ko-KR",{minimumFractionDigits:d,maximumFractionDigits:d}); };
const fP = (v,d=1)=>{ const x=n(v); return !isFinite(x)?"—":x.toLocaleString("ko-KR",{minimumFractionDigits:d,maximumFractionDigits:d}); };
const fM = v=>{ const x=n(v); if(!isFinite(x)||x===0)return"—"; const s=x<0?"△":""; const a=Math.abs(x); if(a>=1e8)return s+(a/1e8).toFixed(1)+"억"; if(a>=1e4)return s+Math.round(a/1e4)+"만"; return s+a.toLocaleString("ko-KR"); };
let _uid=0;
const uid=()=>++_uid;
const mkFloor = lbl=>({id:uid(),label:lbl,excl:""});
const mkRevItem=(label)=>({id:uid(),label,exclArea:"",rentUnit:"",depositUnit:""});
const DEFAULT_REV_ITEMS={
  office:[mkRevItem("업무시설")],
  retail:[mkRevItem("상업시설"),mkRevItem("근린생활시설")],
  resi:  [mkRevItem("공동주택(임대)")],
  hotel: [mkRevItem("숙박(객실임대)")],
  mixed: [mkRevItem("지식산업센터"),mkRevItem("근린생활시설"),mkRevItem("업무시설")],
};
const mkBldg=(id,name="건물 1",type="office")=>({
  id, name, type,
  ownSiteArea:"", ownZoning:"", zoneType:"일반상업", bldgArea:"",
  par:{ exclR:"70", mechR:"0.5", units:"0", pArea:"30", pMult:"1.0", legalP:"" },
  aF:[mkFloor("1F"),mkFloor("2F"),mkFloor("3F")],
  bF:[mkFloor("B1")],
  // 사업비
  cost:{
    landUnit:"", constrAbove:"", constrBelow:"",
    designR:"3.0", supervR:"1.5", reserveR:"5.0",
    ltvR:"60", loanR:"5.0", loanPeriod:"24",
    charges:{ waterSupply:"0",sewer:"0",distHeat:"0",gas:"0",transport:"0",school:"0",overcrowd:"0",develop:"0" },
    acquiTaxOverride:"", // 빈값이면 자동계산
  },
  // 임대수입 (공통 파라미터)
  rev:{ convR:"4.0", vacancyR:"5.0", opexR:"15.0", rentEscR:"3.0", rentEscPeriod:"2",
        propTaxBldgOverride:"", propTaxLandOverride:"" },
  revItems:[...(DEFAULT_REV_ITEMS[type]||DEFAULT_REV_ITEMS.office).map(x=>({...x,id:uid()}))],
});

// ═══════════════════════════════════════════════════════
// § 4. 계산 함수
// ═══════════════════════════════════════════════════════
function calcNPV(cfs,r){ return cfs.reduce((s,c,t)=>s+c/(1+r)**t,0); }
function calcIRR(cfs){
  if(cfs.every(c=>c>=0)||cfs.every(c=>c<=0))return null;
  let r=0.1;
  for(let i=0;i<2000;i++){
    const f=cfs.reduce((s,c,t)=>s+c/(1+r)**t,0);
    const df=cfs.reduce((s,c,t)=>s-t*c/(1+r)**(t+1),0);
    if(Math.abs(df)<1e-12)break;
    const r1=r-f/df; if(Math.abs(r1-r)<1e-9){r=r1;break;} r=Math.max(-0.999,r1);
  }
  return(r>-1&&r<10)?r:null;
}

function calcArea(bldg, siteArea, parkRefs){
  const er=n(bldg.par.exclR)/100;
  const mr=n(bldg.par.mechR)/100;
  const pStd=parkRefs[bldg.type]||parkRefs.office;

  const enrich=floors=>floors.map(f=>{ const ex=n(f.excl); const com=er>0?ex/er:0; return{...f,ex,co:com-ex,com}; });
  const af=enrich(bldg.aF), bf=enrich(bldg.bF);
  const allCom=[...af,...bf].reduce((s,f)=>s+f.com,0);
  const mchTot=allCom*mr;

  // 법정주차대수 자동 계산
  let autoLegal=0;
  if(pStd.basis==="area"){
    const refArea=[...af].reduce((s,f)=>s+f.com,0); // 지상 전용+공용 기준
    autoLegal=pStd.rate>0?Math.ceil(refArea/pStd.rate):0;
  } else { // unit
    autoLegal=Math.ceil(n(bldg.par.units)*pStd.rate);
  }
  const legalP=n(bldg.par.legalP)||autoLegal;
  const pkTot=legalP*n(bldg.par.pMult)*n(bldg.par.pArea);

  const dist=floors=>floors.map(f=>{
    const mech=allCom>0?f.com/allCom*mchTot:0;
    const park=allCom>0?f.com/allCom*pkTot:0;
    return{...f,mech,park,tot:f.com+mech+park};
  });
  const afd=dist(af),bfd=dist(bf);
  const sum=fs=>fs.reduce((s,f)=>({ex:s.ex+f.ex,co:s.co+f.co,com:s.com+f.com,mech:s.mech+f.mech,park:s.park+f.park,tot:s.tot+f.tot}),{ex:0,co:0,com:0,mech:0,park:0,tot:0});
  const sa=sum(afd),sb=sum(bfd);
  const sN=n(siteArea),bN=n(bldg.bldgArea);
  return{
    afd,bfd,sa,sb,allCom,mchTot,pkTot,legalP:autoLegal,
    gfaA:sa.tot,gfaB:sb.tot,gfaT:sa.tot+sb.tot,
    gfaFar:sa.com,
    bcr:sN>0?bN/sN*100:0,
    far:sN>0?sa.com/sN*100:0,
    siteN:sN,
  };
}

function calcCost(bldg,area){
  const c=bldg.cost;
  const land  =area.siteN*n(c.landUnit);
  const cA    =area.gfaA*n(c.constrAbove);
  const cB    =area.gfaB*n(c.constrBelow);
  const constr=cA+cB;
  const design=constr*n(c.designR)/100;
  const superv=constr*n(c.supervR)/100;
  const reserve=constr*n(c.reserveR)/100;
  // 취득세 (자동/수동)
  const acquiTax=c.acquiTaxOverride?n(c.acquiTaxOverride):land*ACQUI_TAX_RATE/100;
  // 제부담금 합계
  const chgTotal=Object.values(c.charges).reduce((s,v)=>s+n(v),0);
  const indirect=design+superv+reserve+acquiTax+chgTotal;
  const base    =land+constr+indirect;
  const loan    =base*n(c.ltvR)/100;
  const finance =loan*n(c.loanR)/100*n(c.loanPeriod)/12;
  const tdc     =base+finance;
  return{land,cA,cB,constr,design,superv,reserve,acquiTax,chgTotal,indirect,base,loan,finance,tdc,equity:tdc-loan};
}

function calcRev(bldg,area,cost){
  const r=bldg.rev;
  // 용도별 임대수입 합산
  let annual=0,deposit=0;
  const itemCalcs=bldg.revItems.map(item=>{
    const ea=n(item.exclArea);
    const mon =ea*n(item.rentUnit);
    const ann =mon*12;
    const dep =ea*n(item.depositUnit);
    annual+=ann; deposit+=dep;
    return{...item,ea,mon,ann,dep};
  });
  const depInc  =deposit*n(r.convR)/100;
  const gi      =annual+depInc;
  const vacancy =gi*n(r.vacancyR)/100;
  const egi     =gi-vacancy;
  const opex    =egi*n(r.opexR)/100;
  // 재산세 (자동/수동)
  const propTaxBldg=r.propTaxBldgOverride?n(r.propTaxBldgOverride):cost.constr*0.5*PROP_TAX.bldgEffR/100;
  const propTaxLand=r.propTaxLandOverride?n(r.propTaxLandOverride):cost.land*PROP_TAX.landEffR/100;
  const propTax =propTaxBldg+propTaxLand;
  const noi     =egi-opex-propTax;
  return{annual,deposit,depInc,gi,vacancy,egi,opex,propTaxBldg,propTaxLand,propTax,noi,itemCalcs};
}

function calcAnalysis(tdc,equity,loan,noi,annual,anlys){
  const dr      =n(anlys.discountR)/100;
  const exitCap =n(anlys.exitCapR)/100;
  const mortR   =n(anlys.mortgageR)/100;
  const years   =Math.max(1,Math.round(n(anlys.holdYears)));
  const escR    =n(anlys.rentEscR)/100;
  const escPer  =Math.max(1,Math.round(n(anlys.rentEscPeriod)));
  const debtSvc =loan*mortR;
  const tv      =exitCap>0?noi/exitCap:0;
  const exitNet =tv-loan;
  // 연도별 NOI (임대료 상승 반영)
  const yearNOIs=Array.from({length:years},(_,i)=>{
    const periods=Math.floor(i/escPer);
    return noi*(1+escR)**periods;
  });
  const cfs=[-equity,...yearNOIs.map((yn,i)=>(yn-debtSvc)+(i===years-1?exitNet:0))];
  const NPV=calcNPV(cfs,dr);
  const IRR=calcIRR(cfs);
  const capRate=tdc>0?noi/tdc*100:0;
  const coc=equity>0?(yearNOIs[0]-debtSvc)/equity*100:0;
  const grossY=tdc>0?annual/tdc*100:0;

  let payback=null,cum=cfs[0];
  for(let y=1;y<cfs.length;y++){ const prev=cum; cum+=cfs[y]; if(cum>=0&&prev<0){payback=y-1+Math.abs(prev)/cfs[y];break;} }

  const bcYrs=Math.max(1,Math.round(n(anlys.bcYears)));
  let tb=0; for(let y=1;y<=bcYrs;y++) tb+=yearNOIs[Math.min(y-1,years-1)]/(1+dr)**y;
  tb+=exitCap>0?tv/(1+dr)**bcYrs:0;
  const bc=equity>0?tb/equity:0;

  const sens=[-20,-10,0,10,20].map(dp=>{
    const nAdj=noi*(1+dp/100);
    const cfAdj=nAdj-debtSvc;
    const tvAdj=exitCap>0?nAdj/exitCap:0;
    const cfsA=[-equity,...Array.from({length:years},(_,i)=>cfAdj+(i===years-1?tvAdj-loan:0))];
    return{dp,noi:nAdj,cf:cfAdj,npv:calcNPV(cfsA,dr),irr:calcIRR(cfsA)};
  });
  return{NPV,IRR:IRR!==null?IRR*100:null,capRate,coc,grossY,payback,bc,tv,cfs,yearNOIs,sens,dr,years,debtSvc};
}

// ═══════════════════════════════════════════════════════
// § 5. 상태 관리
// ═══════════════════════════════════════════════════════
const initState={
  refs:{ region:"서울특별시", zones:{...INIT_ZONE_STDS}, parking:{...INIT_PARK_STDS} },
  siteMode:"single",
  site:{ area:"", zoneType:"일반상업" },
  buildings:[mkBldg(1,"건물 1","office")],
  activeBldgId:1,
  activeTab:"area",
  analysisScope:"all",
  anlys:{ holdYears:"10", discountR:"8.0", exitCapR:"5.0", mortgageR:"5.0", bcYears:"20", rentEscR:"3.0", rentEscPeriod:"2" },
};

function reducer(state,{type,p}){
  const upB=(id,fn)=>({...state,buildings:state.buildings.map(b=>b.id===id?fn(b):b)});
  switch(type){
    case"SITE_MODE": return{...state,siteMode:p};
    case"SITE":      return{...state,site:{...state.site,...p}};
    case"ADD_BLDG":{ const id=Date.now(),cnt=state.buildings.length+1; return{...state,buildings:[...state.buildings,mkBldg(id,`건물 ${cnt}`,p||"office")],activeBldgId:id}; }
    case"DEL_BLDG":{ if(state.buildings.length<=1)return state; const rem=state.buildings.filter(b=>b.id!==p); return{...state,buildings:rem,activeBldgId:state.activeBldgId===p?rem[0].id:state.activeBldgId}; }
    case"ACT_BLDG": return{...state,activeBldgId:p};
    case"BF":   return upB(p.id,b=>({...b,[p.k]:p.v}));
    case"PAR":  return upB(p.id,b=>({...b,par:{...b.par,[p.k]:p.v}}));
    case"CST":  return upB(p.id,b=>({...b,cost:{...b.cost,[p.k]:p.v}}));
    case"CHG":  return upB(p.id,b=>({...b,cost:{...b.cost,charges:{...b.cost.charges,[p.k]:p.v}}}));
    case"REV":  return upB(p.id,b=>({...b,rev:{...b.rev,[p.k]:p.v}}));
    case"ADD_RI": return upB(p.id,b=>({...b,revItems:[...b.revItems,mkRevItem("신규 용도")]}));
    case"DEL_RI": return upB(p.id,b=>({...b,revItems:b.revItems.filter(r=>r.id!==p.rid)}));
    case"RI":     return upB(p.id,b=>({...b,revItems:b.revItems.map(r=>r.id===p.rid?{...r,[p.k]:p.v}:r)}));
    case"ADD_FL": return upB(p.id,b=>p.ft==="a"?{...b,aF:[...b.aF,mkFloor(`${b.aF.length+1}F`)]}:{...b,bF:[...b.bF,mkFloor(`B${b.bF.length+1}`)]});
    case"DEL_FL": return upB(p.id,b=>p.ft==="a"&&b.aF.length>1?{...b,aF:b.aF.slice(0,-1)}:p.ft==="b"&&b.bF.length>0?{...b,bF:b.bF.slice(0,-1)}:b);
    case"FL":     return upB(p.id,b=>{ const arr=p.ft==="a"?b.aF:b.bF; const nxt=arr.map(f=>f.id===p.fid?{...f,[p.k]:p.v}:f); return p.ft==="a"?{...b,aF:nxt}:{...b,bF:nxt}; });
    case"TAB":    return{...state,activeTab:p};
    case"SCOPE":  return{...state,analysisScope:p};
    case"ANLYS":  return{...state,anlys:{...state.anlys,[p.k]:p.v}};
    case"REFS":   return{...state,refs:{...state.refs,...p}};
    case"ZONE_STD": return{...state,refs:{...state.refs,zones:{...state.refs.zones,[p.zone]:{...state.refs.zones[p.zone],[p.k]:p.v}}}};
    case"PARK_STD": return{...state,refs:{...state.refs,parking:{...state.refs.parking,[p.type]:{...state.refs.parking[p.type],[p.k]:p.v}}}};
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════
// § 6. 디자인 토큰
// ═══════════════════════════════════════════════════════
const C={
  bg:"#f1f5f9",card:"#ffffff",cardAlt:"#f8fafc",
  border:"#e2e8f0",borderDk:"#cbd5e1",
  text:"#0f172a",mid:"#334155",muted:"#64748b",faint:"#e2e8f0",
  accent:"#2563eb",accentBg:"#dbeafe",
  green:"#047857",greenBg:"#dcfce7",
  red:"#b91c1c",redBg:"#fee2e2",
  amber:"#92400e",amberBg:"#fef3c7",
  purple:"#6d28d9",purpleBg:"#ede9fe",
  hdr:"#0f172a",hdrText:"#f1f5f9",
  shadow:"0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:"0 4px 8px rgba(0,0,0,0.07)",
  mono:"ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace",
  sans:"-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif",
};

// ═══════════════════════════════════════════════════════
// § 7. 원자 컴포넌트
// ═══════════════════════════════════════════════════════
function TInput({label,value,onChange,unit,placeholder="",readOnly=false,mono=true,small,lawNote}){
  const [focus,setFocus]=useState(false);
  return(
    <div>
      {label&&<div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600,letterSpacing:"0.03em",display:"flex",alignItems:"center",gap:"5px"}}>
        {label}
        {lawNote&&<span style={{fontSize:"9px",color:C.purple,background:C.purpleBg,padding:"1px 5px",borderRadius:"3px",fontWeight:500}}>{lawNote}</span>}
      </div>}
      <div style={{position:"relative"}}>
        <input value={value} readOnly={readOnly} placeholder={placeholder}
          onChange={onChange?e=>onChange(e.target.value):undefined}
          onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
          style={{width:"100%",boxSizing:"border-box",background:readOnly?C.cardAlt:"#fff",border:`1.5px solid ${focus?C.accent:C.border}`,borderRadius:"7px",color:readOnly?C.muted:C.text,padding:unit?(small?"5px 32px 5px 9px":"7px 34px 7px 10px"):(small?"5px 9px":"7px 10px"),fontSize:small?"11px":"13px",fontFamily:mono?C.mono:C.sans,outline:"none",boxShadow:focus?`0 0 0 3px ${C.accentBg}`:C.shadow,transition:"all 0.15s"}}
        />
        {unit&&<span style={{position:"absolute",right:"9px",top:"50%",transform:"translateY(-50%)",fontSize:"9px",color:C.muted,pointerEvents:"none",fontFamily:C.sans}}>{unit}</span>}
      </div>
    </div>
  );
}

function KpiCard({label,value,unit="㎡",sub,hi,warn,ok2,accent2,large}){
  const fg=hi?C.accent:warn?C.red:ok2?C.green:accent2?accent2:C.text;
  const bg=hi?C.accentBg:warn?C.redBg:ok2?C.greenBg:"#fff";
  const bd=hi?`${C.accent}50`:warn?`${C.red}30`:ok2?`${C.green}30`:C.border;
  return(
    <div style={{background:bg,border:`1.5px solid ${bd}`,borderRadius:"9px",padding:"9px 13px",boxShadow:C.shadow}}>
      <div style={{fontSize:"9px",color:hi?C.accent:ok2?C.green:warn?C.red:C.muted,fontWeight:700,letterSpacing:"0.04em",marginBottom:"4px"}}>{label}</div>
      <div style={{fontFamily:C.mono,fontSize:large?"22px":"14px",color:fg,fontWeight:700,lineHeight:1.1}}>
        {value}<span style={{fontSize:"9px",color:C.muted,marginLeft:"3px",fontWeight:400}}>{unit}</span>
      </div>
      {sub&&<div style={{fontSize:"9px",color:C.muted,marginTop:"3px"}}>{sub}</div>}
    </div>
  );
}

function Card({title,tag,children,accentBar,collapsible}){
  const[open,setOpen]=useState(true);
  return(
    <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:"12px",marginBottom:"14px",boxShadow:C.shadow,overflow:"hidden"}}>
      <div onClick={collapsible?()=>setOpen(o=>!o):undefined} style={{padding:"10px 15px",borderBottom:open?`1px solid ${C.border}`:"none",display:"flex",alignItems:"center",gap:"9px",background:C.cardAlt,borderLeft:accentBar?`4px solid ${accentBar}`:"none",cursor:collapsible?"pointer":"default"}}>
        <span style={{fontSize:"12px",fontWeight:700,color:C.text,flex:1}}>{title}</span>
        {tag&&<span style={{fontSize:"9px",color:C.muted,letterSpacing:"0.08em",fontWeight:600,background:C.faint,padding:"2px 6px",borderRadius:"4px"}}>{tag}</span>}
        {collapsible&&<span style={{fontSize:"12px",color:C.muted,transition:"transform 0.2s",transform:open?"rotate(0deg)":"rotate(-90deg)"}}>{open?"▾":"▾"}</span>}
      </div>
      {open&&<div style={{padding:"13px 15px"}}>{children}</div>}
    </div>
  );
}

function Btn({children,onClick,variant="default",sm}){
  const[h,sH]=useState(false);
  const vs={primary:{bg:h?"#1d4ed8":C.accent,color:"#fff",bd:C.accent},ghost:{bg:h?C.accentBg:"transparent",color:C.accent,bd:`${C.accent}60`},default:{bg:h?C.cardAlt:"#fff",color:C.mid,bd:C.border},danger:{bg:h?C.redBg:"#fff",color:C.red,bd:`${C.red}40`},purple:{bg:h?C.purpleBg:"#fff",color:C.purple,bd:`${C.purple}40`}};
  const s=vs[variant]||vs.default;
  return(<button onClick={onClick} onMouseEnter={()=>sH(true)} onMouseLeave={()=>sH(false)} style={{padding:sm?"5px 11px":"7px 15px",borderRadius:"7px",fontSize:sm?"10px":"12px",fontFamily:C.sans,cursor:"pointer",fontWeight:600,background:s.bg,color:s.color,border:`1.5px solid ${s.bd}`,transition:"all 0.15s",boxShadow:C.shadow}}>{children}</button>);
}

const G=({cols,gap="9px",mt,children})=><div style={{display:"grid",gridTemplateColumns:cols||"repeat(auto-fit,minmax(130px,1fr))",gap,marginTop:mt}}>{children}</div>;

// 컴플라이언스 배지
function CompBadge({label,actual,max,unit="%"}){
  if(!max)return null;
  const ok=actual<=max;
  return(
    <div style={{display:"inline-flex",alignItems:"center",gap:"5px",padding:"4px 9px",borderRadius:"6px",background:ok?C.greenBg:C.redBg,border:`1px solid ${ok?C.green+"40":C.red+"40"}`,fontSize:"11px",color:ok?C.green:C.red,fontWeight:600}}>
      <span style={{fontFamily:C.mono}}>{fP(actual)}{unit}</span>
      <span style={{fontWeight:400,opacity:0.7}}>/ {max}{unit}</span>
      <span>{ok?"✓ 적합":"✗ 초과"}</span>
      <span style={{fontSize:"9px",opacity:0.6}}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 8. 기준 탭 (RefsTab)
// ═══════════════════════════════════════════════════════
function RefsTab({state,dispatch}){
  const D=(type,p)=>dispatch({type,p});
  const{refs}=state;
  const[editZone,setEditZone]=useState(null);
  const thS={padding:"8px 10px",fontSize:"10px",color:C.muted,fontWeight:700,letterSpacing:"0.04em",borderBottom:`1px solid ${C.border}`,textAlign:"left",background:C.cardAlt};
  const tdS={padding:"6px 10px",fontSize:"12px",borderBottom:`1px solid ${C.faint}`,fontFamily:C.mono};

  return(
    <div>
      <div style={{padding:"10px 14px",background:C.purpleBg,border:`1.5px solid ${C.purple}30`,borderRadius:"10px",marginBottom:"14px",fontSize:"11px",color:C.purple,lineHeight:1.7}}>
        <strong>기준 탭 안내:</strong> 이 탭의 값을 수정하면 모든 건물 계산에 즉시 반영됩니다. 서울시 이외 지역 적용 시 해당 지자체 조례값으로 변경해 주세요. 적용 지역: <strong>{refs.region}</strong>
      </div>

      {/* 용도지역 건폐율/용적률 */}
      <Card title="용도지역별 건폐율·용적률 기준" tag="서울시 도시계획 조례 §55" accentBar={C.accent}>
        <div style={{marginBottom:"10px",fontSize:"11px",color:C.muted}}>
          법적 근거: 서울특별시 도시계획 조례 제55조(건폐율), 제56조(용적률). 지구단위계획 등 별도 기준 적용 시 직접 수정하세요.
        </div>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"400px"}}>
            <thead><tr><th style={thS}>용도지역</th><th style={{...thS,textAlign:"right"}}>건폐율 최대(%)</th><th style={{...thS,textAlign:"right"}}>용적률 최대(%)</th><th style={{...thS,textAlign:"center"}}>수정</th></tr></thead>
            <tbody>
              {Object.entries(refs.zones).map(([zone,std])=>(
                <tr key={zone} style={{background:editZone===zone?C.accentBg:"transparent"}}>
                  <td style={tdS}>{zone}</td>
                  <td style={{...tdS,textAlign:"right"}}>
                    {editZone===zone
                      ?<input value={std.maxBcr} onChange={e=>D("ZONE_STD",{zone,k:"maxBcr",v:parseFloat(e.target.value)||0})} style={{width:"60px",border:`1px solid ${C.accent}`,borderRadius:"4px",padding:"2px 6px",fontFamily:C.mono,textAlign:"right"}}/>
                      :<span style={{fontWeight:600}}>{std.maxBcr}</span>}
                  </td>
                  <td style={{...tdS,textAlign:"right"}}>
                    {editZone===zone
                      ?<input value={std.maxFar} onChange={e=>D("ZONE_STD",{zone,k:"maxFar",v:parseFloat(e.target.value)||0})} style={{width:"70px",border:`1px solid ${C.accent}`,borderRadius:"4px",padding:"2px 6px",fontFamily:C.mono,textAlign:"right"}}/>
                      :<span style={{fontWeight:600}}>{std.maxFar}</span>}
                  </td>
                  <td style={{...tdS,textAlign:"center"}}>
                    <button onClick={()=>setEditZone(editZone===zone?null:zone)} style={{fontSize:"10px",padding:"2px 7px",borderRadius:"4px",border:`1px solid ${C.border}`,background:editZone===zone?C.accent:"#fff",color:editZone===zone?"#fff":C.mid,cursor:"pointer",fontFamily:C.sans}}>
                      {editZone===zone?"저장":"수정"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 주차장 기준 */}
      <Card title="용도별 법정 주차대수 기준" tag="서울시 주차장 조례 [별표1]" accentBar={C.green}>
        <div style={{marginBottom:"10px",fontSize:"11px",color:C.muted}}>
          법적 근거: 서울특별시 주차장 설치 및 관리 조례 별표1 (부설주차장 설치기준). 변경 시 면적탭 주차대수 자동 재산정됩니다.
        </div>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>용도</th><th style={{...thS,textAlign:"center"}}>산정기준</th><th style={{...thS,textAlign:"right"}}>기준값</th><th style={{...thS,textAlign:"left"}}>단위</th><th style={{...thS,textAlign:"left"}}>법적 근거 및 비고</th></tr></thead>
            <tbody>
              {Object.entries(refs.parking).map(([type,std])=>(
                <tr key={type}>
                  <td style={tdS}><strong>{BT[type]?.label||type}</strong></td>
                  <td style={{...tdS,textAlign:"center",fontSize:"10px"}}>{std.basis==="area"?"면적기준":"세대수기준"}</td>
                  <td style={{...tdS,textAlign:"right"}}>
                    <input value={std.rate} onChange={e=>D("PARK_STD",{type,k:"rate",v:parseFloat(e.target.value)||0})}
                      style={{width:"70px",border:`1px solid ${C.border}`,borderRadius:"4px",padding:"2px 8px",fontFamily:C.mono,textAlign:"right",fontSize:"12px"}}/>
                  </td>
                  <td style={{...tdS,fontSize:"10px",color:C.muted}}>{std.unit}</td>
                  <td style={{...tdS,fontSize:"9px",color:C.purple}}>{std.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 제부담금 법적 근거 */}
      <Card title="제부담금 법적 근거 및 산정 기준" tag="참고" accentBar={C.amber}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>항목</th><th style={{...thS}}>법적 근거</th><th style={{...thS}}>산정 기준 (참고)</th></tr></thead>
            <tbody>
              {CHARGE_ITEMS.map(ci=>(
                <tr key={ci.key} style={{borderBottom:`1px solid ${C.faint}`}}>
                  <td style={{...tdS,fontWeight:600,whiteSpace:"nowrap"}}>{ci.label}</td>
                  <td style={{...tdS,fontSize:"10px",color:C.purple}}>{ci.law}</td>
                  <td style={{...tdS,fontSize:"10px",color:C.muted}}>{ci.hint}</td>
                </tr>
              ))}
              <tr style={{borderBottom:`1px solid ${C.faint}`}}>
                <td style={{...tdS,fontWeight:600}}>취득세</td>
                <td style={{...tdS,fontSize:"10px",color:C.purple}}>지방세법 §7, §11</td>
                <td style={{...tdS,fontSize:"10px",color:C.muted}}>토지가액×4.6% (취득세4%+농특세0.2%+지방교육세0.4%)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* 재산세 기준 */}
      <Card title="재산세 산정 기준 (시뮬레이터 적용 근사 공식)" tag="지방세법" accentBar={C.red}>
        <div style={{fontSize:"11px",color:C.muted,lineHeight:1.9}}>
          <div>• <strong>건물분 재산세:</strong> 건축공사비 × 잔존가치비율(50%) × 공정시장가액비율(70%) × 세율(0.25%) × 지방교육세(1.2) ≈ <strong style={{color:C.text}}>{PROP_TAX.bldgEffR}%</strong></div>
          <div>• <strong>토지분 재산세(별도합산):</strong> 토지비 × 공정시장가액비율(70%) × 세율(0.3%) × 지방교육세(1.2) ≈ <strong style={{color:C.text}}>{PROP_TAX.landEffR}%</strong></div>
          <div>• <strong>도시지역분:</strong> 과세표준 × 0.14%</div>
          <div style={{marginTop:"8px",padding:"7px 10px",background:C.amberBg,borderRadius:"6px",color:C.amber,fontSize:"10px"}}>
            ⚠ 시뮬레이터는 기획 단계 근사치를 제공합니다. 실제 재산세는 지자체 고시 시가표준액 기준으로 산정되며 편차가 발생할 수 있습니다.<br/>
            임대수입 탭에서 실제값으로 직접 수정 가능합니다.
          </div>
        </div>
      </Card>

      <div style={{textAlign:"center",fontSize:"10px",color:C.muted,padding:"6px 0 10px"}}>
        적용 기준: {refs.region} 도시계획 조례·주차장 조례 (2024년 기준). 조례 개정 시 위 값을 직접 수정하여 최신화 가능합니다.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 9. 면적표 탭
// ═══════════════════════════════════════════════════════
function AreaTab({state,dispatch,bldg,area,allCalcs}){
  const[flTab,setFlTab]=useState("a");
  const bt=BT[bldg.type]||BT.office;
  const D=(type,p)=>dispatch({type,p});
  const{siteMode,site,refs}=state;
  const siteAreaVal=siteMode==="single"?site.area:bldg.ownSiteArea;
  const zoneTypeVal=siteMode==="single"?site.zoneType:bldg.zoneType;
  const zoneStd=refs.zones[zoneTypeVal]||{maxBcr:null,maxFar:null};

  const totalBldgArea=state.buildings.reduce((s,b)=>s+n(b.bldgArea),0);
  const totalFar=allCalcs.reduce((s,c)=>s+c.area.gfaFar,0);
  const sN=n(siteAreaVal);
  const wholeBcr=sN>0?totalBldgArea/sN*100:0;
  const wholeFar=sN>0?totalFar/sN*100:0;
  const isMulti=siteMode==="single"&&state.buildings.length>1;
  const curF=flTab==="a"?area.afd:area.bfd;
  const curS=flTab==="a"?area.sa:area.sb;

  return(
    <div>
      {/* 대지 정보 */}
      <Card title="대지 정보" tag="SITE INFO" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(155px,1fr))">
          {siteMode==="single"?(
            <>
              <TInput label="대지면적" value={site.area} onChange={v=>D("SITE",{area:v})} unit="㎡" placeholder="0.00"/>
              <div>
                <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>용도지역 <span style={{fontSize:"9px",color:C.purple,background:C.purpleBg,padding:"1px 5px",borderRadius:"3px"}}>기준탭 연동</span></div>
                <select value={site.zoneType} onChange={e=>D("SITE",{zoneType:e.target.value})}
                  style={{width:"100%",padding:"7px 10px",border:`1.5px solid ${C.border}`,borderRadius:"7px",fontSize:"13px",fontFamily:C.sans,background:"#fff",color:C.text,outline:"none"}}>
                  {Object.keys(refs.zones).map(z=><option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </>
          ):(
            <>
              <TInput label="대지면적 (해당 건물)" value={bldg.ownSiteArea} onChange={v=>D("BF",{id:bldg.id,k:"ownSiteArea",v})} unit="㎡"/>
              <div>
                <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>용도지역</div>
                <select value={bldg.zoneType} onChange={e=>D("BF",{id:bldg.id,k:"zoneType",v:e.target.value})}
                  style={{width:"100%",padding:"7px 10px",border:`1.5px solid ${C.border}`,borderRadius:"7px",fontSize:"13px",fontFamily:C.sans,background:"#fff",color:C.text,outline:"none"}}>
                  {Object.keys(refs.zones).map(z=><option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </>
          )}
          <TInput label="건축면적" value={bldg.bldgArea} onChange={v=>D("BF",{id:bldg.id,k:"bldgArea",v})} unit="㎡"/>
        </G>

        {/* 컴플라이언스 체크 */}
        <div style={{marginTop:"11px",display:"flex",flexWrap:"wrap",gap:"8px",alignItems:"center"}}>
          {isMulti?(
            <>
              <CompBadge label="건폐율(합산)" actual={wholeBcr} max={zoneStd.maxBcr}/>
              <CompBadge label="용적률(합산)" actual={wholeFar} max={zoneStd.maxFar}/>
            </>
          ):(
            <>
              <CompBadge label="건폐율" actual={area.bcr} max={zoneStd.maxBcr}/>
              <CompBadge label="용적률" actual={area.far} max={zoneStd.maxFar}/>
            </>
          )}
          {zoneStd.maxBcr&&<span style={{fontSize:"10px",color:C.muted}}>기준: {zoneTypeVal} (건폐율 {zoneStd.maxBcr}% / 용적률 {zoneStd.maxFar}%)</span>}
        </div>

        <G cols="repeat(auto-fit,minmax(100px,1fr))" mt="10px">
          {isMulti?(<>
            <KpiCard label={`전체 건폐율(${state.buildings.length}동)`} value={fP(wholeBcr)} unit="%" hi={wholeBcr<=(zoneStd.maxBcr||999)} warn={zoneStd.maxBcr&&wholeBcr>zoneStd.maxBcr}/>
            <KpiCard label={`전체 용적률(${state.buildings.length}동)`} value={fP(wholeFar)} unit="%" hi={wholeFar<=(zoneStd.maxFar||9999)} warn={zoneStd.maxFar&&wholeFar>zoneStd.maxFar}/>
            <KpiCard label="이 건물 연면적" value={fmt(area.gfaT)}/>
            <KpiCard label="이 건물 용산연면적" value={fmt(area.gfaFar)}/>
          </>):(<>
            <KpiCard label="연면적 지상" value={fmt(area.gfaA)}/>
            <KpiCard label="연면적 지하" value={fmt(area.gfaB)}/>
            <KpiCard label="연면적 전체" value={fmt(area.gfaT)}/>
            <KpiCard label="용적률산정용" value={fmt(area.gfaFar)} hi/>
            <KpiCard label="건폐율" value={fP(area.bcr)} unit="%"
              hi={zoneStd.maxBcr?area.bcr<=zoneStd.maxBcr:false}
              warn={zoneStd.maxBcr?area.bcr>zoneStd.maxBcr:false}/>
            <KpiCard label="용적률" value={fP(area.far)} unit="%"
              hi={zoneStd.maxFar?area.far<=zoneStd.maxFar:false}
              warn={zoneStd.maxFar?area.far>zoneStd.maxFar:false}/>
          </>)}
        </G>
      </Card>

      {/* 파라미터 */}
      <Card title="면적 산정 파라미터" tag="CALC PARAMS" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(130px,1fr))">
          <TInput label="전용률" value={bldg.par.exclR} onChange={v=>D("PAR",{id:bldg.id,k:"exclR",v})} unit="%"/>
          <TInput label="기전실 비율" value={bldg.par.mechR} onChange={v=>D("PAR",{id:bldg.id,k:"mechR",v})} unit="%"/>
          {bldg.type==="resi"&&<TInput label="세대수 (주차산정용)" value={bldg.par.units} onChange={v=>D("PAR",{id:bldg.id,k:"units",v})} unit="세대"/>}
          <div>
            <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>
              법정주차대수 <span style={{fontSize:"9px",color:C.green,background:C.greenBg,padding:"1px 5px",borderRadius:"3px"}}>자동계산</span>
            </div>
            <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
              <input value={bldg.par.legalP||area.legalP} onChange={e=>D("PAR",{id:bldg.id,k:"legalP",v:e.target.value})} placeholder={String(area.legalP)}
                style={{width:"80px",border:`1.5px solid ${C.border}`,borderRadius:"7px",padding:"7px 10px",fontSize:"12px",fontFamily:C.mono,outline:"none"}}/>
              <span style={{fontSize:"10px",color:C.muted}}>대 (자동: {area.legalP}대)</span>
            </div>
            <div style={{fontSize:"9px",color:C.purple,marginTop:"3px"}}>{(refs.parking[bldg.type]||refs.parking.office).note}</div>
          </div>
          <TInput label="주차 배수" value={bldg.par.pMult} onChange={v=>D("PAR",{id:bldg.id,k:"pMult",v})} unit="배"/>
          <TInput label="1대당 소요면적" value={bldg.par.pArea} onChange={v=>D("PAR",{id:bldg.id,k:"pArea",v})} unit="㎡"/>
          <KpiCard label="주차장 소요면적" value={fmt(area.pkTot)} hi/>
        </G>
      </Card>

      {/* 층별 면적표 */}
      <Card title="층별 면적표" tag="FLOOR AREA SCHEDULE" accentBar={bt.color}>
        <div style={{display:"flex",alignItems:"center",borderBottom:`1.5px solid ${C.border}`,marginBottom:"0"}}>
          {[["a",`지상 (${bldg.aF.length}층)`],["b",`지하 (${bldg.bF.length}층)`]].map(([t,lbl])=>(
            <button key={t} onClick={()=>setFlTab(t)} style={{padding:"7px 15px",background:"transparent",border:"none",borderBottom:flTab===t?`2.5px solid ${bt.color}`:"2.5px solid transparent",color:flTab===t?bt.color:C.muted,cursor:"pointer",fontSize:"12px",fontWeight:flTab===t?700:400,fontFamily:C.sans,marginBottom:"-1.5px"}}>{lbl}</button>
          ))}
          <div style={{flex:1}}/>
          <div style={{display:"flex",gap:"6px",paddingBottom:"6px"}}>
            <Btn sm variant="ghost" onClick={()=>D("ADD_FL",{id:bldg.id,ft:flTab})}>+ 층 추가</Btn>
            <Btn sm onClick={()=>D("DEL_FL",{id:bldg.id,ft:flTab})}>− 삭제</Btn>
          </div>
        </div>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderTop:"none",borderRadius:"0 0 8px 8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"580px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["층",`${bt.exclCol} ㎡`,"공용 ㎡","전용+공용 ㎡","기전실 ㎡","주차장 ㎡","층합계 ㎡","전용률"].map((h,i)=>(
                  <th key={i} style={{padding:"8px 9px",textAlign:i===0?"left":"right",fontSize:"10px",color:C.muted,fontWeight:700,borderRight:i<7?`1px solid ${C.border}`:"none",whiteSpace:"nowrap",letterSpacing:"0.02em"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {curF.map((f,idx)=>{
                const ratio=f.com>0?(f.ex/f.com*100):0;
                const ratioOk=Math.abs(ratio-n(bldg.par.exclR))<1;
                return(
                  <tr key={f.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                    <td style={{padding:"4px 7px",borderRight:`1px solid ${C.border}`}}>
                      <input value={f.label} onChange={e=>D("FL",{id:bldg.id,ft:flTab,fid:f.id,k:"label",v:e.target.value})}
                        style={{width:"48px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 5px",fontSize:"11px",fontFamily:C.mono,textAlign:"center",outline:"none",color:bt.color,fontWeight:700,background:bt.bg}}/>
                    </td>
                    <td style={{padding:"4px 7px",borderRight:`1px solid ${C.border}`,textAlign:"right"}}>
                      <input value={f.excl===""?"":f.excl} placeholder="0.00" onChange={e=>D("FL",{id:bldg.id,ft:flTab,fid:f.id,k:"excl",v:e.target.value})}
                        style={{width:"85px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 7px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none",background:"#fff"}}/>
                    </td>
                    {[fmt(f.co),fmt(f.com),fmt(f.mech),fmt(f.park),fmt(f.tot)].map((v,i)=>(
                      <td key={i} style={{padding:"4px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:i===1?bt.color:C.mid,fontWeight:i===4?600:400,borderRight:i<4?`1px solid ${C.border}`:"none"}}>{v}</td>
                    ))}
                    {/* 층별 전용률 */}
                    <td style={{padding:"4px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"10px",color:f.com>0?(ratioOk?C.green:C.amber):C.muted,fontWeight:600}}>
                      {f.com>0?`${fP(ratio,1)}%`:"—"}
                    </td>
                  </tr>
                );
              })}
              <tr style={{background:"#f1f5f9",borderTop:`2px solid ${bt.color}30`}}>
                <td style={{padding:"7px 9px",fontSize:"11px",fontWeight:700,color:C.mid,borderRight:`1px solid ${C.border}`}}>소계</td>
                {[fmt(curS.ex),fmt(curS.co),fmt(curS.com),fmt(curS.mech),fmt(curS.park),fmt(curS.tot)].map((v,i)=>(
                  <td key={i} style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:i===2?bt.color:C.text,fontWeight:700,borderRight:i<5?`1px solid ${C.border}`:"none"}}>{v}</td>
                ))}
                <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"10px",color:C.muted,fontWeight:600}}>
                  {curS.com>0?`${fP(curS.ex/curS.com*100,1)}%`:"—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"8px",fontSize:"10px",color:C.muted,display:"flex",gap:"12px",flexWrap:"wrap"}}>
          <span>⬤ <span style={{color:C.green}}>녹색</span>: 목표 전용률({bldg.par.exclR}%) ±1% 이내</span>
          <span>⬤ <span style={{color:C.amber}}>주황</span>: 편차 1% 초과</span>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 10. 사업비 탭
// ═══════════════════════════════════════════════════════
function CostTab({bldg,dispatch,area}){
  const bt=BT[bldg.type]||BT.office;
  const D=(type,p)=>dispatch({type,p});
  const uC=k=>v=>D("CST",{id:bldg.id,k,v});
  const c=bldg.cost;
  const cc=calcCost(bldg,area);

  return(
    <div>
      {/* 토지비 */}
      <Card title="토지비" tag="LAND COST" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(150px,1fr))">
          <TInput label="토지 단가 (원/㎡)" value={c.landUnit} onChange={uC("landUnit")} unit="원/㎡"/>
          <KpiCard label="대지면적 (면적탭 연동)" value={fmt(area.siteN)}/>
          <KpiCard label="토지비" value={fM(cc.land)} unit="" hi sub={fmt(cc.land,0)+" 원"}/>
        </G>
        <div style={{marginTop:"10px"}}>
          <TInput label="취득세 (자동계산 / 수동입력 우선)" value={c.acquiTaxOverride} onChange={uC("acquiTaxOverride")} unit="원"
            lawNote="지방세법 §7" placeholder={`자동: ${fM(cc.acquiTax)} (토지비×${ACQUI_TAX_RATE}%)`}/>
          <div style={{fontSize:"9px",color:C.muted,marginTop:"3px"}}>취득세4% + 농특세0.2% + 지방교육세0.4%. 비어있으면 자동계산.</div>
        </div>
      </Card>

      {/* 공사비 */}
      <Card title="공사비" tag="CONSTRUCTION COST" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <TInput label="지상 단가 (원/㎡)" value={c.constrAbove} onChange={uC("constrAbove")} unit="원/㎡"/>
          <TInput label="지하 단가 (원/㎡)" value={c.constrBelow} onChange={uC("constrBelow")} unit="원/㎡"/>
        </G>
        <G cols="repeat(3,1fr)" mt="9px">
          <KpiCard label="지상 공사비" value={fM(cc.cA)} unit="" sub={fmt(area.gfaA)+"㎡"}/>
          <KpiCard label="지하 공사비" value={fM(cc.cB)} unit="" sub={fmt(area.gfaB)+"㎡"}/>
          <KpiCard label="공사비 합계" value={fM(cc.constr)} unit="" hi/>
        </G>
      </Card>

      {/* 간접비 */}
      <Card title="설계·감리·예비비" tag="SOFT COST" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(130px,1fr))">
          <TInput label="설계비 (공사비 대비)" value={c.designR} onChange={uC("designR")} unit="%"/>
          <TInput label="감리비 (공사비 대비)" value={c.supervR} onChange={uC("supervR")} unit="%"/>
          <TInput label="예비비 (공사비 대비)" value={c.reserveR} onChange={uC("reserveR")} unit="%"/>
        </G>
        <G cols="repeat(3,1fr)" mt="9px">
          <KpiCard label="설계비" value={fM(cc.design)} unit=""/>
          <KpiCard label="감리비" value={fM(cc.superv)} unit=""/>
          <KpiCard label="예비비" value={fM(cc.reserve)} unit=""/>
        </G>
      </Card>

      {/* 제부담금 세분화 */}
      <Card title="제부담금 · 제세공과금" tag="STATUTORY CHARGES" accentBar={C.amber} collapsible>
        <div style={{marginBottom:"10px",padding:"7px 10px",background:C.amberBg,borderRadius:"7px",fontSize:"10px",color:C.amber}}>
          각 항목은 법정 근거에 따른 실제 부담금입니다. 기준탭에서 산정근거를 확인하세요. 해당 없는 항목은 0으로 유지하면 됩니다.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:"10px"}}>
          {CHARGE_ITEMS.map(ci=>(
            <TInput key={ci.key} label={ci.label} value={c.charges[ci.key]} onChange={v=>D("CHG",{id:bldg.id,k:ci.key,v})} unit="원" lawNote={ci.law} placeholder="0"/>
          ))}
        </div>
        <div style={{marginTop:"10px",padding:"7px 11px",background:C.cardAlt,borderRadius:"7px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:"11px",color:C.mid,fontWeight:600}}>제부담금 합계</span>
          <span style={{fontFamily:C.mono,fontSize:"14px",color:C.amber,fontWeight:700}}>{fM(cc.chgTotal)} <span style={{fontSize:"10px",color:C.muted}}>원</span></span>
        </div>
      </Card>

      {/* 금융비용 */}
      <Card title="금융비용 (공사비 대출)" tag="FINANCING COST" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(130px,1fr))">
          <TInput label="LTV" value={c.ltvR} onChange={uC("ltvR")} unit="%"/>
          <TInput label="대출금리" value={c.loanR} onChange={uC("loanR")} unit="%"/>
          <TInput label="공사기간" value={c.loanPeriod} onChange={uC("loanPeriod")} unit="개월"/>
        </G>
        <G cols="repeat(3,1fr)" mt="9px">
          <KpiCard label="대출금액" value={fM(cc.loan)} unit="" sub={`기초사업비의 ${c.ltvR}%`}/>
          <KpiCard label="금융비용(이자)" value={fM(cc.finance)} unit=""/>
          <KpiCard label="기초 사업비" value={fM(cc.base)} unit=""/>
        </G>
      </Card>

      {/* TDC 요약 */}
      <div style={{background:"#fff",border:`2px solid ${bt.color}30`,borderRadius:"12px",padding:"16px 18px",boxShadow:C.shadowMd}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:"20px",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:"9px",color:bt.color,fontWeight:700,letterSpacing:"0.1em",marginBottom:"4px"}}>총 사업비 (TDC)</div>
            <div style={{fontFamily:C.mono,fontSize:"28px",color:C.text,fontWeight:700}}>{fM(cc.tdc)}</div>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{fmt(cc.tdc,0)} 원</div>
          </div>
          <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 20px",minWidth:"180px"}}>
            {[["토지비",cc.land],["공사비",cc.constr],["설계·감리·예비",cc.design+cc.superv+cc.reserve],["취득세",cc.acquiTax],["제부담금",cc.chgTotal],["금융비",cc.finance]].map(([l,v])=>(
              <div key={l}>
                <span style={{fontSize:"10px",color:C.muted}}>{l}: </span>
                <span style={{fontSize:"12px",fontFamily:C.mono,color:C.mid,fontWeight:600}}>{fM(v)}</span>
                <span style={{fontSize:"9px",color:C.muted,marginLeft:"3px"}}>({cc.tdc>0?fP(v/cc.tdc*100):"—"}%)</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{fontSize:"9px",color:C.muted,marginBottom:"3px"}}>자기자본 (Equity)</div>
            <div style={{fontFamily:C.mono,fontSize:"18px",color:C.green,fontWeight:700}}>{fM(cc.equity)}</div>
            <div style={{fontSize:"9px",color:C.muted}}>LTV {c.ltvR}% 적용</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 11. 임대수입 탭
// ═══════════════════════════════════════════════════════
function RevTab({bldg,dispatch,area,cost}){
  const bt=BT[bldg.type]||BT.office;
  const D=(type,p)=>dispatch({type,p});
  const r=bldg.rev;
  const rv=calcRev(bldg,area,cost);

  if(bldg.type==="resi"){
    return(
      <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:"12px",padding:"40px 20px",textAlign:"center",boxShadow:C.shadow}}>
        <div style={{fontSize:"40px",marginBottom:"12px"}}>🏠</div>
        <div style={{fontSize:"15px",fontWeight:700,color:C.text,marginBottom:"8px"}}>공동주택 분양 수익 모듈</div>
        <div style={{fontSize:"12px",color:C.muted,lineHeight:1.8}}>
          공동주택은 분양가 × 세대 수 기반의 별도 수익 모델이 적용됩니다.<br/>
          현재는 임대(업무/상업) 모델만 지원하며, 분양 모듈은 추후 업데이트 예정입니다.
        </div>
      </div>
    );
  }

  return(
    <div>
      {/* 용도별 임대수입 */}
      <Card title="용도별 임대 수입" tag="REVENUE BY USE TYPE" accentBar={bt.color}>
        <div style={{marginBottom:"9px",fontSize:"10px",color:C.muted}}>
          지상 전용면적 합계 참고값: <strong style={{color:bt.color,fontFamily:C.mono}}>{fmt(area.sa.ex)} ㎡</strong> (면적탭 연동)
        </div>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"9px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"560px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["용도명","전용면적 (㎡)","월 임대단가 (원/㎡)","보증금단가 (원/㎡)","월 임대수입","연 임대수입","보증금 합계",""].map((h,i)=>(
                  <th key={i} style={{padding:"8px 9px",textAlign:i<2?"left":"right",fontSize:"10px",color:C.muted,fontWeight:700,borderRight:i<7?`1px solid ${C.border}`:"none"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rv.itemCalcs.map((item,idx)=>(
                <tr key={item.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                  <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                    <input value={item.label} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"label",v:e.target.value})}
                      style={{width:"100px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 6px",fontSize:"11px",fontFamily:C.sans,outline:"none",fontWeight:600,color:bt.color}}/>
                  </td>
                  <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                    <input value={item.exclArea} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"exclArea",v:e.target.value})} placeholder="0.00"
                      style={{width:"85px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 7px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                  </td>
                  <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                    <input value={item.rentUnit} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"rentUnit",v:e.target.value})} placeholder="0"
                      style={{width:"85px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 7px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                  </td>
                  <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                    <input value={item.depositUnit} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"depositUnit",v:e.target.value})} placeholder="0"
                      style={{width:"85px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 7px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                  </td>
                  {[fM(item.mon),fM(item.ann),fM(item.dep)].map((v,i)=>(
                    <td key={i} style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:i===1?bt.color:C.mid,borderRight:i<2?`1px solid ${C.border}`:"none"}}>{v}</td>
                  ))}
                  <td style={{padding:"5px 7px",textAlign:"center"}}>
                    <button onClick={()=>D("DEL_RI",{id:bldg.id,rid:item.id})} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:"14px",lineHeight:1}} onMouseEnter={e=>e.target.style.color=C.red} onMouseLeave={e=>e.target.style.color=C.muted}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"9px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <Btn sm variant="ghost" onClick={()=>D("ADD_RI",{id:bldg.id})}>＋ 용도 추가</Btn>
          <div style={{fontFamily:C.mono,fontSize:"13px",color:bt.color,fontWeight:700}}>
            연 임대수입 합계: {fM(rv.annual)} 원
          </div>
        </div>
      </Card>

      {/* 공통 수입 파라미터 */}
      <Card title="보증금·공실·운영비" tag="COMMON PARAMS" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <TInput label="보증금 전환율" value={r.convR} onChange={v=>D("REV",{id:bldg.id,k:"convR",v})} unit="%"/>
          <TInput label="공실률" value={r.vacancyR} onChange={v=>D("REV",{id:bldg.id,k:"vacancyR",v})} unit="%"/>
          <TInput label="운영비율 (EGI 대비, 재산세 제외)" value={r.opexR} onChange={v=>D("REV",{id:bldg.id,k:"opexR",v})} unit="%"/>
        </G>
        <G cols="repeat(auto-fit,minmax(110px,1fr))" mt="9px">
          <KpiCard label="총수입 GI" value={fM(rv.gi)} unit=""/>
          <KpiCard label="공실 차감" value={fM(rv.vacancy)} unit="" warn={n(r.vacancyR)>10}/>
          <KpiCard label="유효총수입 EGI" value={fM(rv.egi)} unit=""/>
          <KpiCard label="운영비 OpEx" value={fM(rv.opex)} unit=""/>
        </G>
      </Card>

      {/* 임대료 상승 */}
      <Card title="임대료 상승률 설정" tag="RENT ESCALATION" accentBar={C.purple}>
        <div style={{marginBottom:"9px",fontSize:"10px",color:C.muted}}>
          DCF 분석에 반영됩니다. 상가임대차보호법 상 갱신 시 임대료 증가 상한 연 5% (§11). 매 <strong>{r.rentEscPeriod}년</strong>마다 <strong>{r.rentEscR}%</strong> 인상 적용.
        </div>
        <G cols="repeat(2,1fr)">
          <TInput label="임대료 연간 상승률" value={r.rentEscR} onChange={v=>D("REV",{id:bldg.id,k:"rentEscR",v})} unit="%"
            lawNote="상가임대차법 §11: 상한 5%"/>
          <TInput label="상승 적용 주기" value={r.rentEscPeriod} onChange={v=>D("REV",{id:bldg.id,k:"rentEscPeriod",v})} unit="년"/>
        </G>
      </Card>

      {/* 재산세 (독립 항목) */}
      <Card title="재산세 (보유세)" tag="PROPERTY TAX" accentBar={C.red}>
        <div style={{marginBottom:"9px",padding:"7px 10px",background:`${C.red}08`,border:`1px solid ${C.red}20`,borderRadius:"7px",fontSize:"10px",color:C.muted,lineHeight:1.7}}>
          법적 근거: 지방세법 §110~§122. 자동계산값은 근사치이며 실제 고시 시가표준액 기준과 차이가 있을 수 있습니다.<br/>
          수동입력 시 자동계산을 덮어씁니다. 기준탭에서 적용 세율을 확인할 수 있습니다.
        </div>
        <G cols="repeat(auto-fit,minmax(160px,1fr))">
          <TInput label="건물분 재산세 (연)" value={r.propTaxBldgOverride} onChange={v=>D("REV",{id:bldg.id,k:"propTaxBldgOverride",v})} unit="원" lawNote="지방세법 §110"
            placeholder={`자동: ${fM(rv.propTaxBldg)} (공사비기반 근사)`}/>
          <TInput label="토지분 재산세 (연)" value={r.propTaxLandOverride} onChange={v=>D("REV",{id:bldg.id,k:"propTaxLandOverride",v})} unit="원" lawNote="지방세법 §110"
            placeholder={`자동: ${fM(rv.propTaxLand)} (토지비기반 근사)`}/>
          <KpiCard label="재산세 합계 (연)" value={fM(rv.propTax)} unit="" warn={rv.propTax>rv.egi*0.1}
            sub="NOI 차감 항목"/>
        </G>
        <div style={{marginTop:"9px",fontSize:"9px",color:C.muted}}>
          산정식: 건물분 = 공사비×50%×70%×0.25%×1.2 / 토지분 = 토지비×70%×0.3%×1.2. 비어있으면 자동계산.
        </div>
      </Card>

      {/* NOI 요약 */}
      <div style={{background:C.greenBg,border:`2px solid ${C.green}30`,borderRadius:"12px",padding:"16px 18px",boxShadow:C.shadowMd}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:"20px",alignItems:"center"}}>
          <div>
            <div style={{fontSize:"9px",color:C.green,fontWeight:700,letterSpacing:"0.1em",marginBottom:"4px"}}>순영업이익 (NOI)</div>
            <div style={{fontFamily:C.mono,fontSize:"28px",color:C.green,fontWeight:700}}>{fM(rv.noi)}</div>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{fmt(rv.noi,0)} 원 / 연</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 20px"}}>
            {[["임대수입",fM(rv.annual)],["보증금운용",fM(rv.depInc)],["공실 차감","▼ "+fM(rv.vacancy)],["운영비 차감","▼ "+fM(rv.opex)],["재산세 차감","▼ "+fM(rv.propTax)]].map(([l,v])=>(
              <div key={l}><span style={{fontSize:"10px",color:C.muted}}>{l}: </span><span style={{fontSize:"12px",fontFamily:C.mono,fontWeight:600,color:v.startsWith("▼")?C.red:C.mid}}>{v}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 12. 사업성 분석 탭
// ═══════════════════════════════════════════════════════
function AnalysisTab({state,dispatch,allCalcs}){
  const{analysisScope,anlys,buildings}=state;
  const D=(type,p)=>dispatch({type,p});
  const uA=k=>v=>D("ANLYS",{k,v});

  const targets=analysisScope==="all"?allCalcs:allCalcs.filter(c=>c.bldg.id===analysisScope);
  const totTDC=targets.reduce((s,c)=>s+c.cost.tdc,0);
  const totNOI=targets.reduce((s,c)=>s+c.rev.noi,0);
  const totLoan=targets.reduce((s,c)=>s+c.cost.loan,0);
  const totAnn=targets.reduce((s,c)=>s+c.rev.annual,0);
  const totEq=totTDC-totLoan;
  const capRate=totTDC>0?totNOI/totTDC*100:0;
  const ana=totTDC>0&&(totNOI!==0||totEq>0)?calcAnalysis(totTDC,totEq,totLoan,totNOI,totAnn,anlys):null;
  const sig=(v,good,ok)=>v===null?C.muted:v>=good?C.green:v>=ok?C.amber:C.red;
  const thS={padding:"8px 9px",fontSize:"10px",color:C.muted,fontWeight:700,letterSpacing:"0.04em",borderRight:`1px solid ${C.border}`,whiteSpace:"nowrap"};

  return(
    <div>
      {/* 분석 범위 */}
      <Card title="분석 범위" tag="ANALYSIS SCOPE">
        <div style={{display:"flex",flexWrap:"wrap",gap:"7px"}}>
          {[{id:"all",label:`전체 합산 (${buildings.length}동)`,bt:{color:C.accent,bg:C.accentBg}},...buildings.map(b=>({id:b.id,label:`${b.name} (${(BT[b.type]||BT.office).short})`,bt:BT[b.type]||BT.office}))].map(({id,label,bt:btn})=>{
            const active=analysisScope===id;
            return(<button key={id} onClick={()=>D("SCOPE",id)} style={{padding:"6px 14px",borderRadius:"18px",border:`1.5px solid ${active?btn.color:C.border}`,background:active?btn.bg:"#fff",color:active?btn.color:C.muted,fontSize:"11px",fontWeight:active?700:400,cursor:"pointer",fontFamily:C.sans,transition:"all 0.15s"}}>{label}</button>);
          })}
        </div>
        <G cols="repeat(auto-fit,minmax(110px,1fr))" mt="10px">
          <KpiCard label="총사업비 (TDC)" value={fM(totTDC)} unit=""/>
          <KpiCard label="자기자본 (Equity)" value={fM(totEq)} unit=""/>
          <KpiCard label="연 NOI" value={fM(totNOI)} unit="" hi/>
          <KpiCard label="Cap Rate" value={fP(capRate)} unit="%" hi/>
        </G>
      </Card>

      {/* 분석 파라미터 */}
      <Card title="분석 파라미터" tag="PARAMETERS">
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <TInput label="보유기간" value={anlys.holdYears} onChange={uA("holdYears")} unit="년"/>
          <TInput label="할인율 (WACC)" value={anlys.discountR} onChange={uA("discountR")} unit="%"/>
          <TInput label="출구 Cap Rate" value={anlys.exitCapR} onChange={uA("exitCapR")} unit="%"/>
          <TInput label="연 원리금 이율" value={anlys.mortgageR} onChange={uA("mortgageR")} unit="%"/>
          <TInput label="B/C 분석기간" value={anlys.bcYears} onChange={uA("bcYears")} unit="년"/>
          <TInput label="임대료 상승률 (DCF)" value={anlys.rentEscR} onChange={uA("rentEscR")} unit="%" lawNote="빌딩별 설정 우선"/>
          <TInput label="상승 주기" value={anlys.rentEscPeriod} onChange={uA("rentEscPeriod")} unit="년"/>
        </G>
        <div style={{marginTop:"8px",fontSize:"9px",color:C.muted,padding:"6px 10px",background:C.cardAlt,borderRadius:"6px"}}>
          임대료 상승률은 분석대상 건물의 임대수입탭 설정을 우선 사용합니다. 전체 합산 분석 시 여기 설정값을 참고로 활용합니다.
        </div>
      </Card>

      {!ana?(
        <div style={{textAlign:"center",padding:"40px 20px",color:C.muted,fontSize:"13px",background:C.card,borderRadius:"12px",border:`1.5px solid ${C.border}`,lineHeight:2}}>
          사업비와 임대수입 데이터를 먼저 입력해주세요.<br/>
          <span style={{fontSize:"11px"}}>공사비 단가, 임대료 단가 등을 입력하면 자동으로 분석됩니다.</span>
        </div>
      ):(
        <>
          {/* ① 단순수익률 */}
          <Card title="① 단순 수익률" tag="SIMPLE RETURN">
            <G cols="repeat(auto-fit,minmax(140px,1fr))">
              {[["Cap Rate",fP(ana.capRate)+"%",sig(ana.capRate,5,3),"NOI÷TDC"],["Cash-on-Cash",fP(ana.coc)+"%",sig(ana.coc,8,5),"세전CF÷Equity"],["Gross Yield",fP(ana.grossY)+"%",C.mid,"임대수입÷TDC"],["투자회수기간",ana.payback!==null?fP(ana.payback,1)+"년":"—",C.mid,"누적CF 기준"]].map(([l,v,c,sub])=>(
                <div key={l} style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"9px",padding:"11px 13px",boxShadow:C.shadow}}>
                  <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>{l}</div>
                  <div style={{fontFamily:C.mono,fontSize:"19px",color:c,fontWeight:700}}>{v}</div>
                  <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>{sub}</div>
                </div>
              ))}
            </G>
          </Card>

          {/* ② DCF */}
          <Card title="② DCF / NPV / IRR (임대료 상승 반영)" tag="DISCOUNTED CASH FLOW">
            <G cols="repeat(auto-fit,minmax(140px,1fr))">
              <div style={{background:ana.NPV>0?C.greenBg:C.redBg,border:`1.5px solid ${ana.NPV>0?C.green:C.red}30`,borderRadius:"9px",padding:"11px 13px"}}>
                <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"4px"}}>NPV ({anlys.discountR}% 할인)</div>
                <div style={{fontFamily:C.mono,fontSize:"19px",color:ana.NPV>0?C.green:C.red,fontWeight:700}}>{fM(ana.NPV)}</div>
                <div style={{fontSize:"9px",color:ana.NPV>0?C.green:C.red,marginTop:"4px"}}>{ana.NPV>0?"✓ 투자 타당":"✗ 재검토 필요"}</div>
              </div>
              <div style={{background:ana.IRR!==null&&ana.IRR>=n(anlys.discountR)?C.greenBg:C.redBg,border:`1.5px solid ${ana.IRR!==null&&ana.IRR>=n(anlys.discountR)?C.green:C.red}30`,borderRadius:"9px",padding:"11px 13px"}}>
                <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"4px"}}>IRR (자기자본 기준)</div>
                <div style={{fontFamily:C.mono,fontSize:"19px",color:sig(ana.IRR,n(anlys.discountR)+2,n(anlys.discountR)),fontWeight:700}}>{ana.IRR!==null?fP(ana.IRR)+"%":"산출불가"}</div>
                <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>hurdle {anlys.discountR}%</div>
              </div>
              <KpiCard label="출구가치 (TV)" value={fM(ana.tv)} unit="" sub={`Cap ${anlys.exitCapR}% 기준`}/>
              <KpiCard label="연 초기 세전 CF" value={fM(ana.yearNOIs[0]-ana.debtSvc)} unit=""/>
            </G>
            {/* 연도별 CF */}
            <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"8px",marginTop:"11px"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:"380px"}}>
                <thead>
                  <tr style={{background:C.cardAlt}}>
                    {["연도","연 NOI","현금흐름","누적 CF","현재가치","누적 NPV"].map((h,i)=>(
                      <th key={i} style={{...thS,textAlign:i===0?"left":"right"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ana.cfs.map((cf,y)=>{
                    const pv=cf/(1+ana.dr)**y;
                    const cumCf=ana.cfs.slice(0,y+1).reduce((s,c)=>s+c,0);
                    const cumPv=ana.cfs.slice(0,y+1).reduce((s,c,t)=>s+c/(1+ana.dr)**t,0);
                    const yn=y===0?0:(ana.yearNOIs[Math.min(y-1,ana.yearNOIs.length-1)]||0);
                    return(
                      <tr key={y} style={{borderBottom:`1px solid ${C.faint}`,background:y%2?C.cardAlt:"#fff"}}>
                        <td style={{padding:"5px 9px",fontSize:"10px",color:C.muted,fontWeight:y===0?700:400,borderRight:`1px solid ${C.border}`}}>{y===0?"초기투자":`${y}년차`}</td>
                        <td style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:C.mid,borderRight:`1px solid ${C.border}`}}>{y===0?"—":fM(yn)}</td>
                        {[cf,cumCf,pv,cumPv].map((v,i)=>(
                          <td key={i} style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:v<0?C.red:v===0?C.muted:C.green,fontWeight:i===0?600:400,borderRight:i<3?`1px solid ${C.border}`:"none"}}>
                            {v<0?`(${fM(Math.abs(v))})`:fM(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ③ B/C */}
          <Card title="③ 편익비용(B/C) 분석" tag="BENEFIT-COST">
            <G cols="repeat(auto-fit,minmax(140px,1fr))">
              <div style={{background:ana.bc>=1?C.greenBg:C.redBg,border:`1.5px solid ${ana.bc>=1?C.green:C.red}30`,borderRadius:"9px",padding:"11px 13px"}}>
                <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"4px"}}>B/C Ratio ({anlys.bcYears}년)</div>
                <div style={{fontFamily:C.mono,fontSize:"22px",color:ana.bc>=1?C.green:C.red,fontWeight:700}}>{fP(ana.bc,2)}</div>
                <div style={{fontSize:"9px",marginTop:"4px",color:ana.bc>=1.2?C.green:ana.bc>=1?C.amber:C.red}}>{ana.bc>=1.2?"✓ 우수":ana.bc>=1?"△ 타당":"✗ 미달"}</div>
              </div>
              <KpiCard label="PV 편익 합계" value={fM(ana.bc*totEq)} unit=""/>
              <KpiCard label="비용 (자기자본)" value={fM(totEq)} unit=""/>
            </G>
          </Card>

          {/* ④ 민감도 */}
          <Card title="④ NOI 변동 민감도" tag="SENSITIVITY">
            <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"8px"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead>
                  <tr style={{background:C.cardAlt}}>
                    {["NOI 변동","NOI (연)","연 CF","NPV","IRR","판정"].map((h,i)=>(
                      <th key={i} style={{...thS,textAlign:i===0?"left":"right"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ana.sens.map(s=>{
                    const base=s.dp===0;
                    const irrOk=s.irr!==null&&s.irr*100>=n(anlys.discountR);
                    return(
                      <tr key={s.dp} style={{borderBottom:`1px solid ${C.faint}`,background:base?C.accentBg:"transparent"}}>
                        <td style={{padding:"7px 9px",fontFamily:C.mono,fontSize:"11px",color:base?C.accent:s.dp>0?C.green:C.red,fontWeight:base?700:400,borderRight:`1px solid ${C.border}`}}>
                          {s.dp===0?"기준 (0%)":s.dp>0?`+${s.dp}%`:`${s.dp}%`}
                        </td>
                        {[fM(s.noi),fM(s.cf),fM(s.npv),s.irr!==null?fP(s.irr*100)+"%":"—"].map((v,i)=>(
                          <td key={i} style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,fontWeight:base?600:400,color:i===2?(s.npv>0?C.green:C.red):i===3?(irrOk?C.green:C.red):C.mid}}>{v}</td>
                        ))}
                        <td style={{padding:"7px 9px",textAlign:"right",fontSize:"10px",fontWeight:600,color:s.npv>0?C.green:C.red}}>
                          {s.npv>0?"✓ 타당":"✗ 미달"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 13. 메인 앱
// ═══════════════════════════════════════════════════════
const TABS=[
  {id:"area",label:"면적표",icon:"📐"},
  {id:"cost",label:"사업비",icon:"💰"},
  {id:"rev", label:"임대수입",icon:"📈"},
  {id:"analysis",label:"사업성분석",icon:"🔍"},
  {id:"refs",label:"기준",icon:"📋"},
];

export default function App(){
  const[state,dispatch]=useReducer(reducer,initState);
  const{siteMode,site,buildings,activeBldgId,activeTab,refs}=state;
  const D=useCallback((type,p)=>dispatch({type,p}),[]);

  const activeBldg=buildings.find(b=>b.id===activeBldgId)||buildings[0];
  const bt=BT[activeBldg?.type]||BT.office;

  const allCalcs=useMemo(()=>buildings.map(bldg=>{
    const siteArea=siteMode==="single"?site.area:bldg.ownSiteArea;
    const area=calcArea(bldg,siteArea,refs.parking);
    const cost=calcCost(bldg,area);
    const rev=calcRev(bldg,area,cost);
    return{bldg,area,cost,rev};
  }),[buildings,siteMode,site,refs.parking]);

  const activeCalc=allCalcs.find(c=>c.bldg.id===activeBldgId)||allCalcs[0];

  const totTDC=allCalcs.reduce((s,c)=>s+c.cost.tdc,0);
  const totNOI=allCalcs.reduce((s,c)=>s+c.rev.noi,0);
  const cap=totTDC>0?totNOI/totTDC*100:0;

  return(
    <div style={{fontFamily:C.sans,background:C.bg,color:C.text,minHeight:"100vh",fontSize:"13px"}}>
      {/* 헤더 */}
      <div style={{background:C.hdr,padding:"12px 18px",display:"flex",alignItems:"center",gap:"13px",position:"sticky",top:0,zIndex:400,boxShadow:"0 2px 8px rgba(0,0,0,0.3)"}}>
        <div style={{width:"32px",height:"32px",background:C.accent,borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="16" stroke="#fff" strokeWidth="1.5"/><rect x="11" y="7" width="7" height="11" stroke="#fff" strokeWidth="1.5"/><line x1="1" y1="19" x2="19" y2="19" stroke="#fff" strokeWidth="1.5"/></svg>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:"13px",fontWeight:700,color:C.hdrText,letterSpacing:"-0.02em"}}>건축사업 사업성 검토기</div>
          <div style={{fontSize:"9px",color:"#64748b",letterSpacing:"0.04em"}}>Building Feasibility Simulator v3.0 · {refs.region} 조례 기준</div>
        </div>
        {totTDC>0&&(
          <div style={{display:"flex",gap:"14px",flexWrap:"wrap"}}>
            {[["TDC합계",fM(totTDC)],["NOI합계",fM(totNOI)],["Cap Rate",cap>0?fP(cap)+"%":"—"]].map(([l,v])=>(
              <div key={l} style={{textAlign:"right"}}><div style={{fontSize:"8px",color:"#64748b"}}>{l}</div><div style={{fontSize:"12px",fontFamily:C.mono,color:"#e2e8f0",fontWeight:700}}>{v}</div></div>
            ))}
          </div>
        )}
      </div>

      {/* 대지 모드 */}
      <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"8px 18px",display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
        <span style={{fontSize:"10px",fontWeight:700,color:C.muted,letterSpacing:"0.04em"}}>대지 구성</span>
        <div style={{display:"flex",gap:"0",background:C.cardAlt,border:`1.5px solid ${C.border}`,borderRadius:"8px",padding:"2px",overflow:"hidden"}}>
          {[["single","🏗 단일 대지"],["multiple","🏗 복수 대지"]].map(([v,l])=>(
            <button key={v} onClick={()=>D("SITE_MODE",v)} style={{padding:"4px 13px",background:siteMode===v?"#fff":"transparent",border:"none",borderRadius:"6px",color:siteMode===v?C.accent:C.muted,fontSize:"11px",fontWeight:siteMode===v?700:400,cursor:"pointer",fontFamily:C.sans,boxShadow:siteMode===v?C.shadow:"none",transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>
        <div style={{fontSize:"10px",padding:"3px 9px",borderRadius:"5px",background:siteMode==="single"?C.accentBg:C.amberBg,border:`1px solid ${siteMode==="single"?C.accent+"40":C.amber+"40"}`,color:siteMode==="single"?C.accent:C.amber}}>
          {siteMode==="single"?"대지·용도지역 공통 적용 / 건폐율·용적률 합산":"건물별 별도 대지·용도지역 / 각각 산출"}
        </div>
      </div>

      {/* 건물 목록 */}
      <div style={{background:"#fff",borderBottom:`2px solid ${C.border}`,padding:"9px 18px",display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap"}}>
        <span style={{fontSize:"9px",fontWeight:700,color:C.muted,letterSpacing:"0.06em",marginRight:"3px",flexShrink:0}}>건물 목록</span>
        {buildings.map(b=>{
          const bbt=BT[b.type]||BT.office;
          const active=b.id===activeBldgId;
          return(
            <div key={b.id} style={{display:"flex",alignItems:"stretch",background:active?bbt.bg:C.cardAlt,border:`1.5px solid ${active?bbt.color:C.border}`,borderRadius:"18px",overflow:"hidden",transition:"all 0.15s",cursor:"pointer"}}>
              <div onClick={()=>D("ACT_BLDG",b.id)} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 11px"}}>
                <span style={{fontSize:"14px"}}>{bbt.emoji}</span>
                <input value={b.name} onChange={e=>D("BF",{id:b.id,k:"name",v:e.target.value})} onClick={e=>e.stopPropagation()} style={{background:"transparent",border:"none",outline:"none",fontSize:"11px",fontWeight:active?700:500,color:active?bbt.color:C.mid,width:`${Math.max(40,b.name.length*7)}px`,fontFamily:C.sans,cursor:"text"}}/>
                <select value={b.type} onChange={e=>D("BF",{id:b.id,k:"type",v:e.target.value})} onClick={e=>e.stopPropagation()} style={{background:"transparent",border:"none",outline:"none",fontSize:"10px",color:active?bbt.color:C.muted,cursor:"pointer",fontFamily:C.sans,fontWeight:600}}>
                  {Object.entries(BT).map(([k,bt])=><option key={k} value={k}>{bt.short}</option>)}
                </select>
              </div>
              {buildings.length>1&&(
                <button onClick={e=>{e.stopPropagation();D("DEL_BLDG",b.id);}} style={{padding:"4px 9px",background:"transparent",border:"none",borderLeft:`1px solid ${active?bbt.color+"40":C.border}`,color:C.muted,cursor:"pointer",fontSize:"13px",lineHeight:1,transition:"background 0.15s"}} onMouseEnter={e=>e.target.style.background=C.redBg} onMouseLeave={e=>e.target.style.background="transparent"}>×</button>
              )}
            </div>
          );
        })}
        <Btn sm variant="ghost" onClick={()=>D("ADD_BLDG","office")}>＋ 건물 추가</Btn>
      </div>

      {/* 탭 */}
      <div style={{background:"#fff",borderBottom:`1.5px solid ${C.border}`,padding:"0 18px",display:"flex",overflowX:"auto"}}>
        {TABS.map(({id,label,icon})=>{
          const isRefs=id==="refs";
          const active=activeTab===id;
          return(
            <button key={id} onClick={()=>D("TAB",id)} style={{padding:"10px 16px",background:"transparent",border:"none",borderBottom:active?(isRefs?`2.5px solid ${C.purple}`:`2.5px solid ${bt.color}`):"2.5px solid transparent",color:active?(isRefs?C.purple:bt.color):C.muted,cursor:"pointer",fontSize:"12px",fontWeight:active?700:400,fontFamily:C.sans,transition:"all 0.15s",marginBottom:"-1.5px",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"5px"}}>
              <span>{icon}</span>{label}
              {isRefs&&<span style={{fontSize:"8px",background:C.purpleBg,color:C.purple,padding:"1px 5px",borderRadius:"4px",fontWeight:700}}>법정기준</span>}
            </button>
          );
        })}
      </div>

      {/* 콘텐츠 */}
      <div style={{maxWidth:"980px",margin:"0 auto",padding:"14px"}}>
        {activeTab==="area"     &&activeCalc&&<AreaTab     state={state} dispatch={dispatch} bldg={activeBldg} area={activeCalc.area} allCalcs={allCalcs}/>}
        {activeTab==="cost"     &&activeCalc&&<CostTab     bldg={activeBldg} dispatch={dispatch} area={activeCalc.area}/>}
        {activeTab==="rev"      &&activeCalc&&<RevTab      bldg={activeBldg} dispatch={dispatch} area={activeCalc.area} cost={activeCalc.cost}/>}
        {activeTab==="analysis"            &&<AnalysisTab state={state} dispatch={dispatch} allCalcs={allCalcs}/>}
        {activeTab==="refs"                &&<RefsTab     state={state} dispatch={dispatch}/>}
      </div>

      <div style={{textAlign:"center",fontSize:"9px",color:C.muted,padding:"12px 0 24px",letterSpacing:"0.04em"}}>
        건축사업 사업성 검토기 v3.0 · {refs.region} 기준 · 산출값은 기획 단계 참고용이며 실제 인허가·계약에 직접 적용 불가
      </div>
    </div>
  );
}
