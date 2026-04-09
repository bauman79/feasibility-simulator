import { useState, useMemo, useReducer, useCallback } from "react";

// ═══════════════════════════════════════════════════════
// § 1. 법정 기준 데이터
// ═══════════════════════════════════════════════════════
const INIT_ZONE_STDS = {
  "제1종전용주거":{ maxBcr:50, maxFar:100 }, "제2종전용주거":{ maxBcr:40, maxFar:150 },
  "제1종일반주거":{ maxBcr:60, maxFar:200 }, "제2종일반주거":{ maxBcr:60, maxFar:250 },
  "제3종일반주거":{ maxBcr:50, maxFar:300 }, "준주거":{ maxBcr:60, maxFar:500 },
  "중심상업":{ maxBcr:90, maxFar:1500 },     "일반상업":{ maxBcr:80, maxFar:1300 },
  "근린상업":{ maxBcr:70, maxFar:900 },      "유통상업":{ maxBcr:80, maxFar:1100 },
  "전용공업":{ maxBcr:70, maxFar:300 },      "일반공업":{ maxBcr:70, maxFar:350 },
  "준공업":{ maxBcr:70, maxFar:400 },        "보전녹지":{ maxBcr:20, maxFar:80 },
  "생산녹지":{ maxBcr:20, maxFar:100 },      "자연녹지":{ maxBcr:20, maxFar:100 },
  "계획관리":{ maxBcr:40, maxFar:100 },      "생산관리":{ maxBcr:20, maxFar:80 },
  "보전관리":{ maxBcr:20, maxFar:80 },       "농림":{ maxBcr:20, maxFar:80 },
  "자연환경보전":{ maxBcr:20, maxFar:80 },
};

const INIT_PARK_STDS = {
  office:{ label:"업무시설",     basis:"area", rate:150, unit:"㎡/대", note:"서울시 주차장조례 별표1 — 시설면적 150㎡당 1대" },
  retail:{ label:"판매·상업시설",basis:"area", rate:150, unit:"㎡/대", note:"서울시 주차장조례 별표1 — 시설면적 150㎡당 1대" },
  resi:  { label:"공동주택",     basis:"unit", rate:1.0, unit:"대/세대",note:"서울시 주차장조례 별표1 — 세대당 1.0대 (전용 85㎡ 이하)" },
  hotel: { label:"숙박시설",     basis:"area", rate:200, unit:"㎡/대", note:"서울시 주차장조례 별표1 — 시설면적 200㎡당 1대" },
  mixed: { label:"복합시설",     basis:"area", rate:150, unit:"㎡/대", note:"서울시 주차장조례 별표1 — 주용도 기준 적용" },
};

// 설계비 대가기준 (건축사협회 건축설계 대가기준)
const INIT_DESIGN_BRACKETS = [
  { upTo:1e9,        rate:7.5, label:"10억 이하" },
  { upTo:3e9,        rate:6.0, label:"10억~30억" },
  { upTo:1e10,       rate:4.5, label:"30억~100억" },
  { upTo:3e10,       rate:3.5, label:"100억~300억" },
  { upTo:Infinity,   rate:2.5, label:"300억 초과" },
];

// 제부담금 기준 (기준탭에서 수정 가능)
const INIT_CHARGES = {
  waterSupply:{
    label:"상수도원인자부담금", law:"수도법 §71",
    enabled:true, basis:"gfaAll", unitPerSqm:2500,
    note:"연면적(㎡)×단가(원/㎡). 기준: 고덕강일 실적 역산 약 2,500원/㎡",
    hint:"구경별 정액 방식이 원칙이나 타당성 단계에서는 연면적 단가로 근사 적용",
  },
  sewer:{
    label:"하수도원인자부담금", law:"하수도법 §61·서울시 조례",
    enabled:true, basis:"gfaAll", unitPerSqm:15000,
    note:"연면적(㎡)×단가(원/㎡). 기준: 고덕강일 실적 역산 약 15,000원/㎡",
    hint:"오수발생량×고시단가가 원칙. 용도·설계에 따라 편차 발생",
  },
  distHeat:{
    label:"지역난방시설부담금", law:"집단에너지사업법",
    enabled:false, basis:"gfaA", unitPerSqm:25000,
    note:"지상연면적(㎡)×단가(원/㎡). 한국지역난방공사 평균 약 25,000원/㎡",
    hint:"공급 사업자·지구별 상이. 지역난방 공급 가능 지역만 해당",
  },
  gas:{
    label:"도시가스시설분담금", law:"도시가스사업법",
    enabled:false, basis:"gfaA", unitPerSqm:3000,
    note:"지상연면적(㎡)×단가(원/㎡). 서울가스 등 사업자 평균 약 3,000원/㎡",
    hint:"도시가스 사업자별 단가 상이. 실제 견적 후 수정 권장",
  },
  transport:{
    label:"광역교통시설부담금", law:"광역교통법 §11의3",
    enabled:false, basis:"gfaFar",
    stdDevCost:846000,  // 2024 국토부 고시 표준개발비 원/㎡
    rateByType:{ office:0.7, retail:0.8, resi:0.4, hotel:0.6, mixed:0.7 }, // %
    note:"표준개발비(846,000원/㎡)×부과율×용적률산정용 연면적. 수도권 과밀억제권역만 해당",
    hint:"2024 국토부 고시 기준. 용도별 부과율: 업무0.7%·판매0.8%·주택0.4%·숙박0.6%",
  },
  school:{
    label:"학교용지부담금", law:"학교용지확보특례법",
    enabled:false, basis:"manual", unitPerSqm:0,
    note:"분양 공동주택 포함 시 해당. 공급면적합계×표준지가×0.8%",
    hint:"직접 입력. 분양 없는 임대 사업은 미해당",
  },
  overcrowd:{
    label:"과밀부담금", law:"수도권정비계획법 §12",
    enabled:false, basis:"gfaAll",
    stdBldgCost:1837000, // 2024 국토부 고시 기준건축비 원/㎡
    rate:10,             // %
    threshold:25000,     // ㎡
    note:"연면적 25,000㎡ 초과분×기준건축비(1,837,000원/㎡)×10%. 수도권 과밀억제권역 업무·판매용",
    hint:"2024 국토부 고시 기준. 용도·지역에 따라 적용 여부 확인 필요",
  },
  develop:{
    label:"개발부담금", law:"개발이익환수법",
    enabled:false, basis:"calc", rate:25, // %
    note:"(준공후 토지가액 − 취득가액 − 개발비용) × 25%. 사후 산정 → 개략 추정",
    hint:"준공 후 토지 추정가액(원/㎡) 입력 시 자동계산. 실제 감정평가 후 수정",
  },
};

const ACQUI_TAX_RATE = 4.6; // 취득세 4% + 농특세 0.2% + 지방교육세 0.4%
const PROP_TAX = { bldgEffR:0.1225, landEffR:0.252, note:"지방세법 §110~§122" };

// ═══════════════════════════════════════════════════════
// § 2. 건물 유형
// ═══════════════════════════════════════════════════════
const BT = {
  office:{ label:"업무시설",  short:"업무", color:"#1d4ed8", bg:"#dbeafe", emoji:"🏢", exclCol:"임대전용" },
  retail:{ label:"상업시설",  short:"상업", color:"#b45309", bg:"#fef3c7", emoji:"🏪", exclCol:"점포전용" },
  resi:  { label:"공동주택",  short:"주거", color:"#047857", bg:"#d1fae5", emoji:"🏠", exclCol:"세대전용" },
  hotel: { label:"숙박시설",  short:"숙박", color:"#6d28d9", bg:"#ede9fe", emoji:"🏨", exclCol:"객실전용" },
  mixed: { label:"복합시설",  short:"복합", color:"#be185d", bg:"#fce7f3", emoji:"🏙️", exclCol:"전용면적" },
};

// ═══════════════════════════════════════════════════════
// § 3. 유틸리티
// ═══════════════════════════════════════════════════════
const n  = v=>parseFloat(String(v??"").replace(/,/g,""))||0;
const fmt= (v,d=2)=>{ const x=n(v); return(!isFinite(x)||x===0)?"—":x.toLocaleString("ko-KR",{minimumFractionDigits:d,maximumFractionDigits:d}); };
const fP = (v,d=1)=>{ const x=n(v); return !isFinite(x)?"—":x.toLocaleString("ko-KR",{minimumFractionDigits:d,maximumFractionDigits:d}); };
const fM = v=>{ const x=n(v); if(!isFinite(x)||x===0)return"—"; const s=x<0?"△":""; const a=Math.abs(x); if(a>=1e8)return s+(a/1e8).toFixed(1)+"억"; if(a>=1e4)return s+Math.round(a/1e4)+"만"; return s+a.toLocaleString("ko-KR"); };
const pct= (v,t)=>t>0?(v/t*100):0;

let _uid=0; const uid=()=>++_uid;
const mkFloor  = lbl=>({ id:uid(), label:lbl, excl:"" });
// saleMode: "rent" | "sale" | "mixed"
// saleRatio: % of gross area to sell (for mixed)
// salePriceUnit: 분양단가 원/㎡ (층합계 기준)
// saleRate: 분양률 %
// grossAreaOverride: 직접입력 시 사용 (비어있으면 지상 총합계 면적 비율 자동계산)
const mkRevItem= lbl=>({ id:uid(), label:lbl, exclArea:"", rentUnit:"", depositUnit:"",
  saleMode:"rent", saleRatio:"100", salePriceUnit:"", saleRate:"100", grossAreaOverride:"" });
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
  cost:{
    landUnit:"", constrAbove:"", constrBelow:"",
    designROverride:"",  // 빈값 = refs brackets 자동
    supervROverride:"",  // 빈값 = refs.superv.rate 자동
    reserveR:"5.0",
    ltvR:"60", loanR:"5.0", loanPeriod:"24",
    acquiTaxOverride:"",
    chargeOverrides:{ waterSupply:"",sewer:"",distHeat:"",gas:"",transport:"",school:"",overcrowd:"",develop:"" },
    developLandUnit:"", // 개발부담금: 준공 후 토지가액 원/㎡
  },
  rev:{ convR:"4.0", vacancyR:"5.0", opexR:"15.0", rentEscR:"3.0", rentEscPeriod:"2",
        propTaxBldgOverride:"", propTaxLandOverride:"" },
  revItems:[...(DEFAULT_REV_ITEMS[type]||DEFAULT_REV_ITEMS.office).map(x=>({...x,id:uid()}))],
});

// ═══════════════════════════════════════════════════════
// § 4. 계산 함수
// ═══════════════════════════════════════════════════════
const calcNPV=(cfs,r)=>cfs.reduce((s,c,t)=>s+c/(1+r)**t,0);
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

function getDesignRate(constr, brackets){
  for(const b of brackets){ if(constr<=b.upTo)return b.rate; }
  return brackets[brackets.length-1].rate;
}

function calcChargesAuto(bldg, area, constr, land, chargeRefs){
  const type=bldg.type;
  const{ gfaA, gfaT:gfaAll, gfaFar, siteN }=area;
  const res={};

  // 상수도
  const ws=chargeRefs.waterSupply;
  res.waterSupply=ws.enabled ? gfaAll*ws.unitPerSqm : 0;

  // 하수도
  const sw=chargeRefs.sewer;
  res.sewer=sw.enabled ? gfaAll*sw.unitPerSqm : 0;

  // 지역난방
  const dh=chargeRefs.distHeat;
  res.distHeat=dh.enabled ? gfaA*dh.unitPerSqm : 0;

  // 도시가스
  const gas=chargeRefs.gas;
  res.gas=gas.enabled ? gfaA*gas.unitPerSqm : 0;

  // 광역교통시설부담금
  const tr=chargeRefs.transport;
  if(tr.enabled && gfaFar>0){
    const rate=(tr.rateByType[type]||0.7)/100;
    res.transport=tr.stdDevCost*rate*gfaFar;
  } else { res.transport=0; }

  // 학교용지부담금 — 산식 복잡, 자동 0 (override로만 입력)
  res.school=0;

  // 과밀부담금
  const oc=chargeRefs.overcrowd;
  if(oc.enabled && ["office","retail","mixed"].includes(type)){
    const excess=Math.max(0, gfaAll-oc.threshold);
    res.overcrowd=excess*oc.stdBldgCost*(oc.rate/100);
  } else { res.overcrowd=0; }

  // 개발부담금
  const dev=chargeRefs.develop;
  if(dev.enabled){
    const afterUnit=n(bldg.cost.developLandUnit);
    if(afterUnit>0 && siteN>0){
      const afterTotal=afterUnit*siteN;
      const devCostRecog=constr*0.7; // 공사비의 70% 개발비용 인정 (개발이익환수법 시행령)
      const profit=Math.max(0, afterTotal-land-devCostRecog);
      res.develop=profit*(dev.rate/100);
    } else { res.develop=0; }
  } else { res.develop=0; }

  return res;
}

function calcArea(bldg, siteArea, parkRefs){
  const er=n(bldg.par.exclR)/100;
  const mr=n(bldg.par.mechR)/100;
  const pStd=parkRefs[bldg.type]||parkRefs.office;

  const enrich=floors=>floors.map(f=>{ const ex=n(f.excl); const com=er>0?ex/er:0; return{...f,ex,co:com-ex,com}; });
  const af=enrich(bldg.aF), bf=enrich(bldg.bF);
  const allCom=[...af,...bf].reduce((s,f)=>s+f.com,0);
  const mchTot=allCom*mr;

  let autoLegal=0;
  if(pStd.basis==="area"){ const ref=[...af].reduce((s,f)=>s+f.com,0); autoLegal=pStd.rate>0?Math.ceil(ref/pStd.rate):0; }
  else { autoLegal=Math.ceil(n(bldg.par.units)*pStd.rate); }
  const legalP=n(bldg.par.legalP)||autoLegal;
  const pkTot=legalP*n(bldg.par.pMult)*n(bldg.par.pArea);

  const dist=floors=>floors.map(f=>{ const mech=allCom>0?f.com/allCom*mchTot:0; const park=allCom>0?f.com/allCom*pkTot:0; return{...f,mech,park,tot:f.com+mech+park}; });
  const afd=dist(af), bfd=dist(bf);
  const sum=fs=>fs.reduce((s,f)=>({ex:s.ex+f.ex,co:s.co+f.co,com:s.com+f.com,mech:s.mech+f.mech,park:s.park+f.park,tot:s.tot+f.tot}),{ex:0,co:0,com:0,mech:0,park:0,tot:0});
  const sa=sum(afd),sb=sum(bfd);
  const sN=n(siteArea),bN=n(bldg.bldgArea);
  return{ afd,bfd,sa,sb,allCom,mchTot,pkTot,legalP:autoLegal, gfaA:sa.tot,gfaB:sb.tot,gfaT:sa.tot+sb.tot, gfaFar:sa.com, bcr:sN>0?bN/sN*100:0, far:sN>0?sa.com/sN*100:0, siteN:sN };
}

function calcCost(bldg, area, refs){
  const c=bldg.cost;
  const land=area.siteN*n(c.landUnit);
  const cA=area.gfaA*n(c.constrAbove);
  const cB=area.gfaB*n(c.constrBelow);
  const constr=cA+cB;

  // 설계비 — refs brackets 자동, override 가능
  const designRate=c.designROverride?n(c.designROverride):getDesignRate(constr,refs.design);
  const design=constr*designRate/100;

  // 감리비 — refs.superv 자동, override 가능
  const supervRate=c.supervROverride?n(c.supervROverride):refs.superv;
  const superv=constr*supervRate/100;

  const reserve=constr*n(c.reserveR)/100;

  // 취득세
  const acquiTax=c.acquiTaxOverride?n(c.acquiTaxOverride):land*ACQUI_TAX_RATE/100;

  // 제부담금 자동계산
  const autoCharges=calcChargesAuto(bldg,area,constr,land,refs.charges);

  // override 우선 적용
  const charges={};
  let chgTotal=0;
  for(const key of Object.keys(autoCharges)){
    const ov=c.chargeOverrides[key];
    const auto=autoCharges[key];
    const final=ov!==""?n(ov):auto;
    charges[key]={ auto, final, overridden:ov!=="", enabled:refs.charges[key]?.enabled||false };
    chgTotal+=final;
  }

  const indirect=design+superv+reserve+acquiTax+chgTotal;
  const base=land+constr+indirect;
  const loan=base*n(c.ltvR)/100;
  const finance=loan*n(c.loanR)/100*n(c.loanPeriod)/12;
  const tdc=base+finance;
  return{ land,cA,cB,constr,design,designRate,superv,supervRate,reserve,acquiTax,charges,chgTotal,indirect,base,loan,finance,tdc,equity:tdc-loan };
}

function calcRev(bldg,area,cost){
  const r=bldg.rev;
  // 지상 전용면적 합계 (비율 배분 기준)
  const totalExcl=area.sa.ex||1;
  // 지상 층합계(총면적) — 분양면적 배분 기준
  const totalGfaA=area.gfaA||1;

  let annual=0, deposit=0;
  let saleIncome=0, totalSaleArea=0, totalRentExcl=0;

  const itemCalcs=bldg.revItems.map(item=>{
    const exclArea=n(item.exclArea);
    const mode=item.saleMode||"rent";
    const saleRatio=mode==="rent"?0:mode==="sale"?1:n(item.saleRatio)/100;
    const rentRatio=1-saleRatio;

    // 분양면적 (층합계 기준) — 직접입력 우선, 없으면 전용면적 비율로 배분
    const grossAuto=totalExcl>0?(exclArea/totalExcl)*totalGfaA:0;
    const grossArea=n(item.grossAreaOverride)||grossAuto;
    const itemSaleArea=grossArea*saleRatio;
    const itemRentExcl=exclArea*rentRatio;

    // 분양수입
    const itemSaleIncome=itemSaleArea*n(item.salePriceUnit)*(n(item.saleRate)/100);
    // 임대수입 (임대 비율 전용면적만)
    const mon=itemRentExcl*n(item.rentUnit);
    const ann=mon*12;
    const dep=itemRentExcl*n(item.depositUnit);

    annual+=ann; deposit+=dep;
    saleIncome+=itemSaleIncome; totalSaleArea+=itemSaleArea; totalRentExcl+=itemRentExcl;

    return{...item, exclArea, mode, saleRatio, rentRatio,
           grossArea, grossAuto, itemSaleArea, itemRentExcl,
           itemSaleIncome, mon, ann, dep };
  });

  const depInc=deposit*n(r.convR)/100;
  const gi=annual+depInc;
  const vacancy=gi*n(r.vacancyR)/100;
  const egi=gi-vacancy;
  const opex=egi*n(r.opexR)/100;
  // 재산세: 임대 보유 비율만 적용
  const rentAreaRatio=totalGfaA>0?(totalGfaA-totalSaleArea)/totalGfaA:1;
  const propTaxBldg=r.propTaxBldgOverride?n(r.propTaxBldgOverride):cost.constr*rentAreaRatio*0.5*PROP_TAX.bldgEffR/100;
  const propTaxLand=r.propTaxLandOverride?n(r.propTaxLandOverride):cost.land*rentAreaRatio*PROP_TAX.landEffR/100;
  const propTax=propTaxBldg+propTaxLand;
  const noi=egi-opex-propTax;

  // 사업비 배분 (면적 비율)
  const saleAreaRatio=totalGfaA>0?totalSaleArea/totalGfaA:0;
  const saleTDC=cost.tdc*saleAreaRatio;
  const rentTDC=cost.tdc*(1-saleAreaRatio);
  const saleLoan=cost.loan*saleAreaRatio;
  const rentLoan=cost.loan*(1-saleAreaRatio);
  // 분양 개발이익
  const saleProfit=saleIncome-saleTDC;
  const saleProfitRate=saleTDC>0?saleProfit/saleTDC*100:0;
  const saleSujiRate=saleTDC>0?saleIncome/saleTDC*100:0; // 사업수지율

  return{ annual, deposit, depInc, gi, vacancy, egi, opex,
          propTaxBldg, propTaxLand, propTax, noi, itemCalcs,
          saleIncome, totalSaleArea, totalRentExcl,
          saleAreaRatio, saleTDC, rentTDC, saleLoan, rentLoan,
          saleProfit, saleProfitRate, saleSujiRate };
}

function calcAnalysis(tdc,equity,loan,noi,annual,anlys,rev){
  const dr=n(anlys.discountR)/100;
  const exitCap=n(anlys.exitCapR)/100;
  const mortR=n(anlys.mortgageR)/100;
  const years=Math.max(1,Math.round(n(anlys.holdYears)));
  const escR=n(anlys.rentEscR)/100;
  const escPer=Math.max(1,Math.round(n(anlys.rentEscPeriod)));

  // 분양 파트
  const saleIncome=rev?.saleIncome||0;
  const saleProfit=rev?.saleProfit||0;
  const saleTDC=rev?.saleTDC||0;
  const rentLoan=rev?.rentLoan||loan; // 임대 보유분 장기 대출
  const rentEquity=equity-saleIncome+saleTDC; // 순임대 자기자본 (분양수입으로 회수 후)

  // 임대 파트 연도별 NOI
  const debtSvc=rentLoan*mortR;
  const tv=exitCap>0?noi/exitCap:0;
  const exitNet=tv-rentLoan;
  const yearNOIs=Array.from({length:years},(_,i)=>noi*(1+escR)**Math.floor(i/escPer));

  // ── 통합 현금흐름 (분양 일시수령 포함) ──
  // year0: -equity(전체 투입) + saleIncome(분양 일시수령)
  const yr0=(-equity)+saleIncome;
  const cfs=[yr0,...yearNOIs.map((yn,i)=>(yn-debtSvc)+(i===years-1?exitNet:0))];
  const NPV=calcNPV(cfs,dr);
  const IRR=calcIRR(cfs);

  // ── 임대 전용 분석 (분양 없는 경우와 동일한 방식) ──
  const rentEquityForIRR=Math.max(equity-saleIncome,1); // 분양수입 공제 후 실질 투자금
  const rentCfs=[-rentEquityForIRR,...yearNOIs.map((yn,i)=>(yn-debtSvc)+(i===years-1?exitNet:0))];
  const rentNPV=calcNPV(rentCfs,dr);
  const rentIRR=calcIRR(rentCfs);

  const capRate=tdc>0?noi/tdc*100:0;
  const rentCapRate=(tdc-saleTDC)>0?noi/(tdc-saleTDC)*100:0;
  const coc=equity>0?(yearNOIs[0]-debtSvc)/equity*100:0;
  const grossY=tdc>0?annual/tdc*100:0;
  let payback=null,cum=cfs[0];
  for(let y=1;y<cfs.length;y++){ const prev=cum; cum+=cfs[y]; if(cum>=0&&prev<0){payback=y-1+Math.abs(prev)/cfs[y];break;} }
  const bcYrs=Math.max(1,Math.round(n(anlys.bcYears)));
  let tb=0; for(let y=1;y<=bcYrs;y++) tb+=yearNOIs[Math.min(y-1,years-1)]/(1+dr)**y;
  tb+=exitCap>0?tv/(1+dr)**bcYrs:0;
  const bc=equity>0?tb/equity:0;
  const sens=[-20,-10,0,10,20].map(dp=>{
    const nAdj=noi*(1+dp/100); const cfAdj=nAdj-debtSvc;
    const tvAdj=exitCap>0?nAdj/exitCap:0;
    const cfsA=[yr0,...Array.from({length:years},(_,i)=>cfAdj+(i===years-1?tvAdj-rentLoan:0))];
    return{dp,noi:nAdj,cf:cfAdj,npv:calcNPV(cfsA,dr),irr:calcIRR(cfsA)};
  });
  return{ NPV,IRR:IRR!==null?IRR*100:null,
          rentNPV,rentIRR:rentIRR!==null?rentIRR*100:null,
          capRate,rentCapRate,coc,grossY,payback,bc,tv,cfs,yearNOIs,sens,dr,years,debtSvc,
          saleIncome,saleProfit,saleTDC,rentLoan };
}

// ═══════════════════════════════════════════════════════
// § 5. 상태 관리
// ═══════════════════════════════════════════════════════
const initState={
  refs:{
    region:"서울특별시",
    zones:{...INIT_ZONE_STDS},
    parking:{...INIT_PARK_STDS},
    design:[...INIT_DESIGN_BRACKETS],
    superv:1.5, // % 기본값
    charges:JSON.parse(JSON.stringify(INIT_CHARGES)),
  },
  siteMode:"single",
  site:{ area:"", zoneType:"일반상업" },
  buildings:[mkBldg(1,"건물 1","office")],
  activeBldgId:1, activeTab:"area", analysisScope:"all",
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
    case"BF":  return upB(p.id,b=>({...b,[p.k]:p.v}));
    case"PAR": return upB(p.id,b=>({...b,par:{...b.par,[p.k]:p.v}}));
    case"CST": return upB(p.id,b=>({...b,cost:{...b.cost,[p.k]:p.v}}));
    case"CO":  return upB(p.id,b=>({...b,cost:{...b.cost,chargeOverrides:{...b.cost.chargeOverrides,[p.k]:p.v}}}));
    case"REV": return upB(p.id,b=>({...b,rev:{...b.rev,[p.k]:p.v}}));
    case"ADD_RI": return upB(p.id,b=>({...b,revItems:[...b.revItems,mkRevItem("신규 용도")]}));
    case"DEL_RI": return upB(p.id,b=>({...b,revItems:b.revItems.filter(r=>r.id!==p.rid)}));
    case"RI":  return upB(p.id,b=>({...b,revItems:b.revItems.map(r=>r.id===p.rid?{...r,[p.k]:p.v}:r)}));
    case"ADD_FL": return upB(p.id,b=>p.ft==="a"?{...b,aF:[...b.aF,mkFloor(`${b.aF.length+1}F`)]}:{...b,bF:[...b.bF,mkFloor(`B${b.bF.length+1}`)]});
    case"DEL_FL": return upB(p.id,b=>p.ft==="a"&&b.aF.length>1?{...b,aF:b.aF.slice(0,-1)}:p.ft==="b"&&b.bF.length>0?{...b,bF:b.bF.slice(0,-1)}:b);
    case"FL":  return upB(p.id,b=>{ const arr=p.ft==="a"?b.aF:b.bF; const nxt=arr.map(f=>f.id===p.fid?{...f,[p.k]:p.v}:f); return p.ft==="a"?{...b,aF:nxt}:{...b,bF:nxt}; });
    case"TAB":   return{...state,activeTab:p};
    case"SCOPE": return{...state,analysisScope:p};
    case"ANLYS": return{...state,anlys:{...state.anlys,[p.k]:p.v}};
    // refs 업데이트
    case"ZONE_STD":    return{...state,refs:{...state.refs,zones:{...state.refs.zones,[p.zone]:{...state.refs.zones[p.zone],[p.k]:p.v}}}};
    case"PARK_STD":    return{...state,refs:{...state.refs,parking:{...state.refs.parking,[p.type]:{...state.refs.parking[p.type],[p.k]:p.v}}}};
    case"DESIGN_BRACKET": return{...state,refs:{...state.refs,design:state.refs.design.map((b,i)=>i===p.i?{...b,[p.k]:p.v}:b)}};
    case"SUPERV_RATE": return{...state,refs:{...state.refs,superv:p.v}};
    case"CHARGE_REF":  return{...state,refs:{...state.refs,charges:{...state.refs.charges,[p.key]:{...state.refs.charges[p.key],[p.k]:p.v}}}};
    case"CHARGE_RATE_TYPE": return{...state,refs:{...state.refs,charges:{...state.refs.charges,transport:{...state.refs.charges.transport,rateByType:{...state.refs.charges.transport.rateByType,[p.btype]:p.v}}}}};
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════
// § 6. 디자인 토큰
// ═══════════════════════════════════════════════════════
const C={
  bg:"#f1f5f9", card:"#ffffff", cardAlt:"#f8fafc",
  border:"#e2e8f0", faint:"#e2e8f0",
  text:"#0f172a", mid:"#334155", muted:"#64748b",
  accent:"#2563eb", accentBg:"#dbeafe",
  green:"#047857", greenBg:"#dcfce7",
  red:"#b91c1c",   redBg:"#fee2e2",
  amber:"#92400e", amberBg:"#fef3c7",
  purple:"#6d28d9",purpleBg:"#ede9fe",
  teal:"#0f766e",  tealBg:"#ccfbf1",
  hdr:"#0f172a", hdrText:"#f1f5f9",
  shadow:"0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:"0 4px 8px rgba(0,0,0,0.07)",
  mono:"ui-monospace,SFMono-Regular,'SF Mono',Menlo,monospace",
  sans:"-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif",
};

// ═══════════════════════════════════════════════════════
// § 7. 원자 컴포넌트
// ═══════════════════════════════════════════════════════
function TInput({label,value,onChange,unit,placeholder="",readOnly=false,mono=true,small,lawNote,warn}){
  const[focus,setFocus]=useState(false);
  return(
    <div>
      {label&&<div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600,display:"flex",alignItems:"center",gap:"5px",flexWrap:"wrap"}}>
        {label}
        {lawNote&&<span style={{fontSize:"9px",color:C.purple,background:C.purpleBg,padding:"1px 5px",borderRadius:"3px",fontWeight:500,whiteSpace:"nowrap"}}>{lawNote}</span>}
      </div>}
      <div style={{position:"relative"}}>
        <input value={value} readOnly={readOnly} placeholder={placeholder}
          onChange={onChange?e=>onChange(e.target.value):undefined}
          onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
          style={{width:"100%",boxSizing:"border-box",background:readOnly?C.cardAlt:"#fff",border:`1.5px solid ${warn?C.amber:focus?C.accent:C.border}`,borderRadius:"7px",color:readOnly?C.muted:C.text,padding:unit?(small?"5px 32px 5px 9px":"7px 34px 7px 10px"):(small?"5px 9px":"7px 10px"),fontSize:small?"11px":"13px",fontFamily:mono?C.mono:C.sans,outline:"none",boxShadow:focus?`0 0 0 3px ${C.accentBg}`:C.shadow,transition:"all 0.15s"}}/>
        {unit&&<span style={{position:"absolute",right:"9px",top:"50%",transform:"translateY(-50%)",fontSize:"9px",color:C.muted,pointerEvents:"none"}}>{unit}</span>}
      </div>
    </div>
  );
}

function KpiCard({label,value,unit="㎡",sub,hi,warn,ok2,large}){
  const fg=hi?C.accent:warn?C.red:ok2?C.green:C.text;
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

function Card({title,tag,children,accentBar,collapsible,defaultOpen=true}){
  const[open,setOpen]=useState(defaultOpen);
  return(
    <div style={{background:C.card,border:`1.5px solid ${C.border}`,borderRadius:"12px",marginBottom:"14px",boxShadow:C.shadow,overflow:"hidden"}}>
      <div onClick={collapsible?()=>setOpen(o=>!o):undefined} style={{padding:"10px 15px",borderBottom:open?`1px solid ${C.border}`:"none",display:"flex",alignItems:"center",gap:"9px",background:C.cardAlt,borderLeft:accentBar?`4px solid ${accentBar}`:"none",cursor:collapsible?"pointer":"default",userSelect:"none"}}>
        <span style={{fontSize:"12px",fontWeight:700,color:C.text,flex:1}}>{title}</span>
        {tag&&<span style={{fontSize:"9px",color:C.muted,letterSpacing:"0.08em",fontWeight:600,background:C.faint,padding:"2px 6px",borderRadius:"4px"}}>{tag}</span>}
        {collapsible&&<span style={{fontSize:"11px",color:C.muted,transition:"transform 0.2s",display:"inline-block",transform:open?"rotate(0deg)":"rotate(-90deg)"}}>▾</span>}
      </div>
      {open&&<div style={{padding:"13px 15px"}}>{children}</div>}
    </div>
  );
}

function Btn({children,onClick,variant="default",sm}){
  const[h,sH]=useState(false);
  const vs={primary:{bg:h?"#1d4ed8":C.accent,color:"#fff",bd:C.accent},ghost:{bg:h?C.accentBg:"transparent",color:C.accent,bd:`${C.accent}60`},default:{bg:h?C.cardAlt:"#fff",color:C.mid,bd:C.border},danger:{bg:h?C.redBg:"#fff",color:C.red,bd:`${C.red}40`},teal:{bg:h?C.tealBg:"#fff",color:C.teal,bd:`${C.teal}40`}};
  const s=vs[variant]||vs.default;
  return(<button onClick={onClick} onMouseEnter={()=>sH(true)} onMouseLeave={()=>sH(false)} style={{padding:sm?"5px 11px":"7px 15px",borderRadius:"7px",fontSize:sm?"10px":"12px",fontFamily:C.sans,cursor:"pointer",fontWeight:600,background:s.bg,color:s.color,border:`1.5px solid ${s.bd}`,transition:"all 0.15s",boxShadow:C.shadow}}>{children}</button>);
}

const G=({cols,gap="9px",mt,children})=><div style={{display:"grid",gridTemplateColumns:cols||"repeat(auto-fit,minmax(130px,1fr))",gap,marginTop:mt}}>{children}</div>;

function CompBadge({label,actual,max}){
  if(!max)return null;
  const ok=actual<=max;
  return(
    <div style={{display:"inline-flex",alignItems:"center",gap:"5px",padding:"3px 8px",borderRadius:"6px",background:ok?C.greenBg:C.redBg,border:`1px solid ${ok?C.green+"40":C.red+"40"}`,fontSize:"11px",color:ok?C.green:C.red,fontWeight:600}}>
      <span style={{fontFamily:C.mono}}>{fP(actual)}%</span>
      <span style={{fontWeight:400,opacity:0.7}}>/ {max}%</span>
      <span>{ok?"✓ 적합":"✗ 초과"}</span>
      <span style={{fontSize:"9px",opacity:0.6}}>{label}</span>
    </div>
  );
}

// 제부담금 행 컴포넌트
function ChargRow({chargeKey,chargeRef,chargeResult,override,dispatch,bldgId}){
  const D=(type,p)=>dispatch({type,p});
  const isEnabled=chargeRef.enabled;
  const autoVal=chargeResult?.auto||0;
  const finalVal=chargeResult?.final||0;
  const isOverridden=chargeResult?.overridden||false;
  const isSpecial=chargeKey==="develop"; // 개발부담금은 별도 처리

  return(
    <div style={{padding:"10px 13px",borderBottom:`1px solid ${C.faint}`,background:isEnabled?"#fff":C.cardAlt}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:"10px",flexWrap:"wrap"}}>
        {/* 활성 토글 */}
        <div style={{display:"flex",alignItems:"center",gap:"7px",minWidth:"200px",flex:"0 0 auto"}}>
          <button onClick={()=>D("CHARGE_REF",{key:chargeKey,k:"enabled",v:!isEnabled})}
            style={{width:"32px",height:"18px",borderRadius:"9px",border:"none",cursor:"pointer",background:isEnabled?C.green:C.faint,transition:"background 0.2s",flexShrink:0,position:"relative"}}>
            <div style={{width:"14px",height:"14px",borderRadius:"50%",background:"#fff",position:"absolute",top:"2px",left:isEnabled?"16px":"2px",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
          </button>
          <div>
            <div style={{fontSize:"12px",fontWeight:600,color:isEnabled?C.text:C.muted}}>{chargeRef.label}</div>
            <div style={{fontSize:"9px",color:C.purple}}>{chargeRef.law}</div>
          </div>
        </div>

        {/* 자동계산 값 */}
        <div style={{flex:1,minWidth:"140px"}}>
          {isEnabled&&!isSpecial?(
            <div style={{fontSize:"11px",color:C.muted}}>
              자동계산: <span style={{fontFamily:C.mono,color:isOverridden?C.muted:C.teal,fontWeight:isOverridden?400:700,textDecoration:isOverridden?"line-through":"none"}}>{fM(autoVal)} 원</span>
              <span style={{fontSize:"9px",color:C.muted,marginLeft:"5px"}}>({chargeRef.note?.split('.')[0]})</span>
            </div>
          ):isEnabled&&isSpecial?(
            <div style={{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}>
              <TInput label="준공 후 토지가액 (원/㎡)" value={override?.developLandUnit||""} onChange={v=>D("CST",{id:bldgId,k:"developLandUnit",v})} unit="원/㎡" small/>
              <div style={{fontSize:"10px",color:C.muted,marginTop:"16px"}}>→ 자동: <span style={{fontFamily:C.mono,color:isOverridden?C.muted:C.teal,fontWeight:700}}>{fM(autoVal)}</span></div>
            </div>
          ):(
            <div style={{fontSize:"10px",color:C.muted}}>비활성 — 기준탭에서 활성화 가능</div>
          )}
        </div>

        {/* 수동입력 override */}
        {isEnabled&&(
          <div style={{minWidth:"160px",flex:"0 0 auto"}}>
            <TInput label={`직접입력 ${isOverridden?"★ 적용중":"(자동값 사용)"}`} value={override?.[chargeKey]||""} onChange={v=>D("CO",{id:bldgId,k:chargeKey,v})} unit="원" small warn={isOverridden} placeholder={autoVal>0?`자동: ${fM(autoVal)}`:"해당 없음"}/>
            {isOverridden&&<button onClick={()=>D("CO",{id:bldgId,k:chargeKey,v:""})} style={{fontSize:"9px",color:C.red,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:C.sans}}>× 자동으로 되돌리기</button>}
          </div>
        )}

        {/* 최종 적용값 */}
        {isEnabled&&(
          <div style={{textAlign:"right",minWidth:"90px",flex:"0 0 auto"}}>
            <div style={{fontSize:"9px",color:C.muted}}>최종 적용</div>
            <div style={{fontFamily:C.mono,fontSize:"13px",color:isOverridden?C.amber:C.teal,fontWeight:700}}>{fM(finalVal)}</div>
          </div>
        )}
      </div>
      {isEnabled&&chargeRef.hint&&<div style={{fontSize:"9px",color:C.muted,marginTop:"4px",paddingLeft:"42px",fontStyle:"italic"}}>{chargeRef.hint}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 8. 기준 탭
// ═══════════════════════════════════════════════════════
function RefsTab({state,dispatch}){
  const D=(type,p)=>dispatch({type,p});
  const{refs}=state;
  const[editZone,setEditZone]=useState(null);
  const thS={padding:"7px 9px",fontSize:"10px",color:C.muted,fontWeight:700,borderBottom:`1px solid ${C.border}`,textAlign:"left",background:C.cardAlt,whiteSpace:"nowrap"};
  const tdS={padding:"6px 9px",fontSize:"12px",borderBottom:`1px solid ${C.faint}`};

  return(
    <div>
      <div style={{padding:"9px 13px",background:C.purpleBg,border:`1px solid ${C.purple}30`,borderRadius:"9px",marginBottom:"14px",fontSize:"11px",color:C.purple,lineHeight:1.7}}>
        <strong>기준 탭:</strong> 이 탭의 값을 수정하면 모든 탭에 즉시 자동 반영됩니다. 지역 변경 시 조례값 업데이트를 여기서 하면 됩니다. 현재 적용 지역: <strong>{refs.region}</strong>
      </div>

      {/* 설계·감리비 대가기준 */}
      <Card title="설계·감리비 기준" tag="건축사협회 대가기준 · 엔지니어링 대가기준" accentBar={C.accent}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",alignItems:"start"}}>
          <div>
            <div style={{fontSize:"11px",fontWeight:700,color:C.mid,marginBottom:"8px"}}>설계비 구간별 요율 — 공사비 규모에 따라 자동 적용</div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:"8px",overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr><th style={thS}>공사비 구간</th><th style={{...thS,textAlign:"right"}}>요율(%)</th></tr></thead>
                <tbody>
                  {refs.design.map((b,i)=>(
                    <tr key={i}>
                      <td style={tdS}>{b.label}</td>
                      <td style={{...tdS,textAlign:"right"}}>
                        <input value={b.rate} onChange={e=>D("DESIGN_BRACKET",{i,k:"rate",v:parseFloat(e.target.value)||0})} style={{width:"55px",border:`1px solid ${C.border}`,borderRadius:"4px",padding:"2px 6px",fontFamily:C.mono,textAlign:"right",fontSize:"12px"}}/>
                        <span style={{fontSize:"10px",color:C.muted,marginLeft:"3px"}}>%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>건축사협회 건축설계 대가기준. 각 건물 사업비탭에서 개별 수정 가능.</div>
          </div>
          <div>
            <div style={{fontSize:"11px",fontWeight:700,color:C.mid,marginBottom:"8px"}}>감리비 기본 요율</div>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <input value={refs.superv} onChange={e=>D("SUPERV_RATE",{v:parseFloat(e.target.value)||0})} style={{width:"70px",border:`1.5px solid ${C.border}`,borderRadius:"7px",padding:"7px 10px",fontFamily:C.mono,fontSize:"14px",textAlign:"right",outline:"none"}}/>
              <span style={{fontSize:"12px",color:C.mid}}>% (공사비 대비)</span>
            </div>
            <div style={{fontSize:"9px",color:C.muted,marginTop:"5px"}}>엔지니어링 대가기준. 실무 협의에 따라 개별 수정 가능.</div>
          </div>
        </div>
      </Card>

      {/* 제부담금 기준 */}
      <Card title="제부담금 자동계산 기준" tag="항목별 법적근거" accentBar={C.teal}>
        <div style={{marginBottom:"10px",fontSize:"11px",color:C.muted,lineHeight:1.7}}>
          단가를 수정하면 사업비 탭의 제부담금이 자동 재산정됩니다. 연면적 기반 단가는 실적 데이터 기반 근사값입니다. 실제 협의 결과나 설계 완료 후 사업비 탭에서 개별 수정하세요.
        </div>
        <div style={{border:`1px solid ${C.border}`,borderRadius:"8px",overflow:"hidden"}}>
          {Object.entries(refs.charges).map(([key,cr])=>{
            const hasUnit=cr.unitPerSqm!==undefined;
            const hasStdCost=cr.stdDevCost!==undefined||cr.stdBldgCost!==undefined;
            return(
              <div key={key} style={{padding:"10px 13px",borderBottom:`1px solid ${C.faint}`,background:"#fff"}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
                  <div style={{minWidth:"160px",flex:"1"}}>
                    <div style={{fontSize:"11px",fontWeight:700,color:cr.enabled?C.text:C.muted}}>{cr.label}</div>
                    <div style={{fontSize:"9px",color:C.purple}}>{cr.law}</div>
                  </div>
                  {hasUnit&&(
                    <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                      <input value={cr.unitPerSqm} onChange={e=>D("CHARGE_REF",{key,k:"unitPerSqm",v:parseFloat(e.target.value)||0})}
                        style={{width:"80px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"4px 8px",fontFamily:C.mono,textAlign:"right",fontSize:"12px"}}/>
                      <span style={{fontSize:"10px",color:C.muted}}>원/㎡</span>
                    </div>
                  )}
                  {key==="transport"&&(
                    <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                      <input value={cr.stdDevCost} onChange={e=>D("CHARGE_REF",{key,k:"stdDevCost",v:parseFloat(e.target.value)||0})}
                        style={{width:"90px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"4px 8px",fontFamily:C.mono,textAlign:"right",fontSize:"12px"}}/>
                      <span style={{fontSize:"10px",color:C.muted}}>원/㎡ (표준개발비)</span>
                    </div>
                  )}
                  {key==="overcrowd"&&(
                    <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                      <input value={cr.stdBldgCost} onChange={e=>D("CHARGE_REF",{key,k:"stdBldgCost",v:parseFloat(e.target.value)||0})}
                        style={{width:"90px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"4px 8px",fontFamily:C.mono,textAlign:"right",fontSize:"12px"}}/>
                      <span style={{fontSize:"10px",color:C.muted}}>원/㎡ (기준건축비)</span>
                    </div>
                  )}
                  <div style={{fontSize:"9px",color:C.muted,maxWidth:"200px"}}>{cr.note?.split('.')[0]}</div>
                </div>
                {key==="transport"&&(
                  <div style={{marginTop:"8px",paddingLeft:"2px"}}>
                    <div style={{fontSize:"10px",color:C.muted,marginBottom:"5px"}}>용도별 부과율(%)</div>
                    <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                      {Object.entries(cr.rateByType).map(([bt,rate])=>(
                        <div key={bt} style={{display:"flex",alignItems:"center",gap:"4px"}}>
                          <span style={{fontSize:"10px",color:C.mid}}>{BT[bt]?.short||bt}:</span>
                          <input value={rate} onChange={e=>D("CHARGE_RATE_TYPE",{btype:bt,v:parseFloat(e.target.value)||0})}
                            style={{width:"45px",border:`1px solid ${C.border}`,borderRadius:"4px",padding:"2px 5px",fontFamily:C.mono,textAlign:"right",fontSize:"11px"}}/>
                          <span style={{fontSize:"9px",color:C.muted}}>%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 용도지역 건폐율/용적률 */}
      <Card title="용도지역별 건폐율·용적률" tag="서울시 도시계획 조례 §55~56" accentBar={C.accent} collapsible defaultOpen={false}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"350px"}}>
            <thead><tr><th style={thS}>용도지역</th><th style={{...thS,textAlign:"right"}}>건폐율 최대(%)</th><th style={{...thS,textAlign:"right"}}>용적률 최대(%)</th><th style={{...thS,textAlign:"center"}}>수정</th></tr></thead>
            <tbody>
              {Object.entries(refs.zones).map(([zone,std])=>(
                <tr key={zone} style={{background:editZone===zone?C.accentBg:"transparent"}}>
                  <td style={tdS}>{zone}</td>
                  <td style={{...tdS,textAlign:"right"}}>
                    {editZone===zone?<input value={std.maxBcr} onChange={e=>D("ZONE_STD",{zone,k:"maxBcr",v:parseFloat(e.target.value)||0})} style={{width:"55px",border:`1px solid ${C.accent}`,borderRadius:"4px",padding:"2px 6px",fontFamily:C.mono,textAlign:"right"}}/>:<strong>{std.maxBcr}</strong>}
                  </td>
                  <td style={{...tdS,textAlign:"right"}}>
                    {editZone===zone?<input value={std.maxFar} onChange={e=>D("ZONE_STD",{zone,k:"maxFar",v:parseFloat(e.target.value)||0})} style={{width:"65px",border:`1px solid ${C.accent}`,borderRadius:"4px",padding:"2px 6px",fontFamily:C.mono,textAlign:"right"}}/>:<strong>{std.maxFar}</strong>}
                  </td>
                  <td style={{...tdS,textAlign:"center"}}>
                    <button onClick={()=>setEditZone(editZone===zone?null:zone)} style={{fontSize:"10px",padding:"2px 7px",borderRadius:"4px",border:`1px solid ${C.border}`,background:editZone===zone?C.accent:"#fff",color:editZone===zone?"#fff":C.mid,cursor:"pointer",fontFamily:C.sans}}>{editZone===zone?"완료":"수정"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 주차 기준 */}
      <Card title="용도별 법정 주차대수" tag="서울시 주차장 조례 별표1" accentBar={C.green} collapsible defaultOpen={false}>
        <div style={{border:`1px solid ${C.border}`,borderRadius:"8px",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>용도</th><th style={thS}>산정기준</th><th style={{...thS,textAlign:"right"}}>기준값</th><th style={thS}>단위</th></tr></thead>
            <tbody>
              {Object.entries(refs.parking).map(([type,std])=>(
                <tr key={type}>
                  <td style={tdS}><strong>{BT[type]?.label||type}</strong></td>
                  <td style={{...tdS,fontSize:"10px"}}>{std.basis==="area"?"면적기준":"세대수기준"}</td>
                  <td style={{...tdS,textAlign:"right"}}><input value={std.rate} onChange={e=>D("PARK_STD",{type,k:"rate",v:parseFloat(e.target.value)||0})} style={{width:"65px",border:`1px solid ${C.border}`,borderRadius:"4px",padding:"2px 8px",fontFamily:C.mono,textAlign:"right",fontSize:"12px"}}/></td>
                  <td style={{...tdS,fontSize:"10px",color:C.muted}}>{std.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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
  const isMulti=siteMode==="single"&&state.buildings.length>1;
  const wholeBcr=sN>0?totalBldgArea/sN*100:0;
  const wholeFar=sN>0?totalFar/sN*100:0;
  const curF=flTab==="a"?area.afd:area.bfd;
  const curS=flTab==="a"?area.sa:area.sb;

  return(
    <div>
      <Card title="대지 정보" tag="SITE INFO" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(155px,1fr))">
          {siteMode==="single"?(
            <>
              <TInput label="대지면적" value={site.area} onChange={v=>D("SITE",{area:v})} unit="㎡" placeholder="0.00"/>
              <div>
                <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>용도지역 <span style={{fontSize:"9px",color:C.purple,background:C.purpleBg,padding:"1px 5px",borderRadius:"3px"}}>기준탭 연동</span></div>
                <select value={site.zoneType} onChange={e=>D("SITE",{zoneType:e.target.value})} style={{width:"100%",padding:"7px 10px",border:`1.5px solid ${C.border}`,borderRadius:"7px",fontSize:"13px",fontFamily:C.sans,background:"#fff",color:C.text,outline:"none"}}>
                  {Object.keys(refs.zones).map(z=><option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </>
          ):(
            <>
              <TInput label="대지면적 (해당 건물)" value={bldg.ownSiteArea} onChange={v=>D("BF",{id:bldg.id,k:"ownSiteArea",v})} unit="㎡"/>
              <div>
                <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>용도지역</div>
                <select value={bldg.zoneType} onChange={e=>D("BF",{id:bldg.id,k:"zoneType",v:e.target.value})} style={{width:"100%",padding:"7px 10px",border:`1.5px solid ${C.border}`,borderRadius:"7px",fontSize:"13px",fontFamily:C.sans,background:"#fff",color:C.text,outline:"none"}}>
                  {Object.keys(refs.zones).map(z=><option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </>
          )}
          <TInput label="건축면적" value={bldg.bldgArea} onChange={v=>D("BF",{id:bldg.id,k:"bldgArea",v})} unit="㎡"/>
        </G>
        <div style={{marginTop:"10px",display:"flex",flexWrap:"wrap",gap:"8px",alignItems:"center"}}>
          {isMulti?(<><CompBadge label="건폐율(합산)" actual={wholeBcr} max={zoneStd.maxBcr}/><CompBadge label="용적률(합산)" actual={wholeFar} max={zoneStd.maxFar}/></>):(<><CompBadge label="건폐율" actual={area.bcr} max={zoneStd.maxBcr}/><CompBadge label="용적률" actual={area.far} max={zoneStd.maxFar}/></>)}
          {zoneStd.maxBcr&&<span style={{fontSize:"10px",color:C.muted}}>기준: {zoneTypeVal} (건폐율 {zoneStd.maxBcr}% / 용적률 {zoneStd.maxFar}%)</span>}
        </div>
        <G cols="repeat(auto-fit,minmax(100px,1fr))" mt="10px">
          {isMulti?(<><KpiCard label={`전체 건폐율(${state.buildings.length}동)`} value={fP(wholeBcr)} unit="%" hi={wholeBcr<=(zoneStd.maxBcr||999)} warn={zoneStd.maxBcr&&wholeBcr>zoneStd.maxBcr}/><KpiCard label={`전체 용적률(${state.buildings.length}동)`} value={fP(wholeFar)} unit="%" hi={wholeFar<=(zoneStd.maxFar||9999)} warn={zoneStd.maxFar&&wholeFar>zoneStd.maxFar}/><KpiCard label="이 건물 연면적" value={fmt(area.gfaT)}/><KpiCard label="이 건물 용산연면적" value={fmt(area.gfaFar)}/></>):(<><KpiCard label="연면적 지상" value={fmt(area.gfaA)}/><KpiCard label="연면적 지하" value={fmt(area.gfaB)}/><KpiCard label="연면적 전체" value={fmt(area.gfaT)}/><KpiCard label="용적률산정용" value={fmt(area.gfaFar)} hi/><KpiCard label="건폐율" value={fP(area.bcr)} unit="%" hi={zoneStd.maxBcr?area.bcr<=zoneStd.maxBcr:false} warn={zoneStd.maxBcr?area.bcr>zoneStd.maxBcr:false}/><KpiCard label="용적률" value={fP(area.far)} unit="%" hi={zoneStd.maxFar?area.far<=zoneStd.maxFar:false} warn={zoneStd.maxFar?area.far>zoneStd.maxFar:false}/></>)}
        </G>
      </Card>

      <Card title="면적 산정 파라미터" tag="CALC PARAMS" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(130px,1fr))">
          <TInput label="전용률" value={bldg.par.exclR} onChange={v=>D("PAR",{id:bldg.id,k:"exclR",v})} unit="%"/>
          <TInput label="기전실 비율" value={bldg.par.mechR} onChange={v=>D("PAR",{id:bldg.id,k:"mechR",v})} unit="%"/>
          {bldg.type==="resi"&&<TInput label="세대수 (주차산정용)" value={bldg.par.units} onChange={v=>D("PAR",{id:bldg.id,k:"units",v})} unit="세대"/>}
          <div>
            <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>법정주차대수 <span style={{fontSize:"9px",color:C.green,background:C.greenBg,padding:"1px 5px",borderRadius:"3px"}}>자동계산</span></div>
            <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
              <input value={bldg.par.legalP||area.legalP} onChange={e=>D("PAR",{id:bldg.id,k:"legalP",v:e.target.value})} placeholder={String(area.legalP)} style={{width:"75px",border:`1.5px solid ${C.border}`,borderRadius:"7px",padding:"7px 10px",fontSize:"12px",fontFamily:C.mono,outline:"none"}}/>
              <span style={{fontSize:"10px",color:C.muted}}>대 (자동: {area.legalP})</span>
            </div>
            <div style={{fontSize:"9px",color:C.purple,marginTop:"3px"}}>{(refs.parking[bldg.type]||refs.parking.office).note}</div>
          </div>
          <TInput label="주차 배수" value={bldg.par.pMult} onChange={v=>D("PAR",{id:bldg.id,k:"pMult",v})} unit="배"/>
          <TInput label="1대당 소요면적" value={bldg.par.pArea} onChange={v=>D("PAR",{id:bldg.id,k:"pArea",v})} unit="㎡"/>
          <KpiCard label="주차장 소요면적" value={fmt(area.pkTot)} hi/>
        </G>
      </Card>

      <Card title="층별 면적표" tag="FLOOR AREA SCHEDULE" accentBar={bt.color}>
        <div style={{display:"flex",alignItems:"center",borderBottom:`1.5px solid ${C.border}`}}>
          {[["a",`지상 (${bldg.aF.length}층)`],["b",`지하 (${bldg.bF.length}층)`]].map(([t,lbl])=>(
            <button key={t} onClick={()=>setFlTab(t)} style={{padding:"7px 14px",background:"transparent",border:"none",borderBottom:flTab===t?`2.5px solid ${bt.color}`:"2.5px solid transparent",color:flTab===t?bt.color:C.muted,cursor:"pointer",fontSize:"12px",fontWeight:flTab===t?700:400,fontFamily:C.sans,marginBottom:"-1.5px"}}>{lbl}</button>
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
                {["층",`${bt.exclCol} ㎡`,"공용 ㎡","전용+공용 ㎡","기전실 ㎡","주차장 ㎡","층합계 ㎡","층별 전용률"].map((h,i)=>(
                  <th key={i} style={{padding:"8px 9px",textAlign:i===0?"left":"right",fontSize:"10px",color:C.muted,fontWeight:700,borderRight:i<7?`1px solid ${C.border}`:"none",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {curF.map((f,idx)=>{
                const ratio=f.com>0?(f.ex/f.com*100):0;
                const ratioOk=f.com>0&&Math.abs(ratio-n(bldg.par.exclR))<1;
                return(
                  <tr key={f.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                    <td style={{padding:"4px 7px",borderRight:`1px solid ${C.border}`}}>
                      <input value={f.label} onChange={e=>D("FL",{id:bldg.id,ft:flTab,fid:f.id,k:"label",v:e.target.value})} style={{width:"46px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 5px",fontSize:"11px",fontFamily:C.mono,textAlign:"center",outline:"none",color:bt.color,fontWeight:700,background:bt.bg}}/>
                    </td>
                    <td style={{padding:"4px 7px",borderRight:`1px solid ${C.border}`,textAlign:"right"}}>
                      <input value={f.excl===""?"":f.excl} placeholder="0.00" onChange={e=>D("FL",{id:bldg.id,ft:flTab,fid:f.id,k:"excl",v:e.target.value})} style={{width:"82px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 7px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                    </td>
                    {[fmt(f.co),fmt(f.com),fmt(f.mech),fmt(f.park),fmt(f.tot)].map((v,i)=>(
                      <td key={i} style={{padding:"4px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:i===1?bt.color:C.mid,fontWeight:i===4?600:400,borderRight:i<4?`1px solid ${C.border}`:"none"}}>{v}</td>
                    ))}
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
                <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"10px",color:C.muted,fontWeight:600}}>{curS.com>0?`${fP(curS.ex/curS.com*100,1)}%`:"—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"6px",fontSize:"9px",color:C.muted}}>⬤ <span style={{color:C.green}}>녹색</span>: 목표 전용률({bldg.par.exclR}%) ±1% 이내 &nbsp; ⬤ <span style={{color:C.amber}}>주황</span>: 편차 초과</div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 10. 사업비 탭
// ═══════════════════════════════════════════════════════
function CostTab({bldg,dispatch,area,refs}){
  const bt=BT[bldg.type]||BT.office;
  const D=(type,p)=>dispatch({type,p});
  const uC=k=>v=>D("CST",{id:bldg.id,k,v});
  const c=bldg.cost;
  const cc=calcCost(bldg,area,refs);
  const autoDesignRate=getDesignRate(cc.constr,refs.design);

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
          <TInput label="취득세 (자동계산 / 직접입력 우선)" value={c.acquiTaxOverride} onChange={uC("acquiTaxOverride")} unit="원"
            lawNote="지방세법 §7 · 취득4%+농특0.2%+교육0.4%=4.6%" placeholder={`자동: ${fM(cc.acquiTax)} 원 (토지비×${ACQUI_TAX_RATE}%)`}/>
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

      {/* 설계·감리·예비비 */}
      <Card title="설계·감리·예비비" tag="SOFT COST" accentBar={bt.color}>
        <div style={{marginBottom:"10px",padding:"8px 11px",background:C.accentBg,border:`1px solid ${C.accent}30`,borderRadius:"7px",fontSize:"10px",color:C.accent,lineHeight:1.7}}>
          📐 설계비는 공사비 규모에 따라 건축사협회 대가기준 요율이 자동 적용됩니다.
          현재 공사비 <strong>{fM(cc.constr)}</strong> → 적용 요율 <strong>{autoDesignRate}%</strong> ({refs.design.find(b=>cc.constr<=b.upTo)?.label||"300억 초과"} 구간)
        </div>
        <G cols="repeat(auto-fit,minmax(160px,1fr))">
          <div>
            <TInput label={`설계비 요율 ${c.designROverride?"★ 직접입력":"(대가기준 자동)"}`} value={c.designROverride} onChange={uC("designROverride")} unit="%"
              placeholder={`자동: ${autoDesignRate}%`} warn={!!c.designROverride}/>
            {c.designROverride&&<button onClick={()=>uC("designROverride")("")} style={{fontSize:"9px",color:C.red,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:C.sans}}>× 자동으로 되돌리기</button>}
            <div style={{fontSize:"10px",color:C.muted,marginTop:"3px"}}>→ 설계비: <strong style={{fontFamily:C.mono,color:C.accent}}>{fM(cc.design)}</strong> 원</div>
          </div>
          <div>
            <TInput label={`감리비 요율 ${c.supervROverride?"★ 직접입력":"(엔지니어링기준 자동)"}`} value={c.supervROverride} onChange={uC("supervROverride")} unit="%"
              placeholder={`자동: ${refs.superv}%`} warn={!!c.supervROverride}/>
            {c.supervROverride&&<button onClick={()=>uC("supervROverride")("")} style={{fontSize:"9px",color:C.red,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:C.sans}}>× 자동으로 되돌리기</button>}
            <div style={{fontSize:"10px",color:C.muted,marginTop:"3px"}}>→ 감리비: <strong style={{fontFamily:C.mono,color:C.accent}}>{fM(cc.superv)}</strong> 원</div>
          </div>
          <TInput label="예비비 (공사비 대비)" value={c.reserveR} onChange={uC("reserveR")} unit="%"/>
        </G>
      </Card>

      {/* 제부담금 */}
      <Card title="제부담금 · 제세공과금 (자동계산)" tag="STATUTORY CHARGES" accentBar={C.teal} collapsible>
        <div style={{marginBottom:"10px",padding:"8px 11px",background:C.tealBg,border:`1px solid ${C.teal}30`,borderRadius:"7px",fontSize:"10px",color:C.teal,lineHeight:1.7}}>
          🔄 기준탭의 단가를 기반으로 자동 계산됩니다. 직접입력 시 자동값을 덮어씁니다. 토글(●/○)로 항목을 활성화/비활성화할 수 있습니다.
        </div>
        <div style={{border:`1.5px solid ${C.border}`,borderRadius:"9px",overflow:"hidden"}}>
          {Object.keys(INIT_CHARGES).map(key=>(
            <ChargRow key={key} chargeKey={key} chargeRef={refs.charges[key]}
              chargeResult={cc.charges[key]} override={{...bldg.cost.chargeOverrides, developLandUnit:bldg.cost.developLandUnit}}
              dispatch={dispatch} bldgId={bldg.id}/>
          ))}
        </div>
        <div style={{marginTop:"10px",padding:"9px 13px",background:C.cardAlt,borderRadius:"8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <span style={{fontSize:"11px",color:C.mid,fontWeight:600}}>제부담금 합계</span>
            <div style={{fontSize:"9px",color:C.muted}}>취득세 별도</div>
          </div>
          <span style={{fontFamily:C.mono,fontSize:"16px",color:C.teal,fontWeight:700}}>{fM(cc.chgTotal)} <span style={{fontSize:"10px",color:C.muted}}>원</span></span>
        </div>
      </Card>

      {/* 금융비용 */}
      <Card title="금융비용 (공사기간 대출)" tag="FINANCING COST" accentBar={bt.color}>
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
          <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 18px",minWidth:"200px"}}>
            {[["토지비",cc.land],["공사비",cc.constr],["설계비",cc.design],["감리비",cc.superv],["예비비",cc.reserve],["취득세",cc.acquiTax],["제부담금",cc.chgTotal],["금융비",cc.finance]].map(([l,v])=>(
              <div key={l}><span style={{fontSize:"10px",color:C.muted}}>{l}: </span><span style={{fontSize:"11px",fontFamily:C.mono,color:C.mid,fontWeight:600}}>{fM(v)}</span><span style={{fontSize:"9px",color:C.muted,marginLeft:"3px"}}>({cc.tdc>0?fP(pct(v,cc.tdc)):"—"}%)</span></div>
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
// § 11. 수익 계획 탭 (임대 + 분양)
// ═══════════════════════════════════════════════════════
const MODE_CFG={
  rent: { label:"임대",  color:C.accent,  bg:C.accentBg,  icon:"🏠" },
  sale: { label:"분양",  color:"#dc2626",  bg:"#fee2e2",   icon:"💰" },
  mixed:{ label:"혼합",  color:C.teal,    bg:C.tealBg,    icon:"🔀" },
};

function RevTab({bldg,dispatch,area,cost}){
  const bt=BT[bldg.type]||BT.office;
  const D=(type,p)=>dispatch({type,p});
  const r=bldg.rev;
  const rv=calcRev(bldg,area,cost);
  const hasSale=rv.itemCalcs.some(i=>i.mode!=="rent");

  return(
    <div>
      {/* 안내 배너 */}
      <div style={{padding:"9px 13px",background:C.tealBg,border:`1px solid ${C.teal}30`,borderRadius:"9px",marginBottom:"14px",fontSize:"10px",color:C.teal,lineHeight:1.7}}>
        <strong>수익 계획:</strong> 용도별로 <strong>임대 / 분양 / 혼합</strong>을 선택할 수 있습니다.
        혼합 선택 시 분양 비율(%)에 따라 층합계 면적 기준으로 분양면적이 자동 배분됩니다.
        분양수입은 준공 시 일시 수령으로 처리합니다 (타당성 단계 단순화).
      </div>

      <Card title="용도별 수익 계획" tag="REVENUE PLAN · 임대 + 분양" accentBar={bt.color}>
        <div style={{marginBottom:"9px",display:"flex",gap:"14px",fontSize:"10px",color:C.muted,flexWrap:"wrap"}}>
          <span>지상 전용면적 합계: <strong style={{color:bt.color,fontFamily:C.mono}}>{fmt(area.sa.ex)} ㎡</strong></span>
          <span>지상 층합계(분양기준): <strong style={{color:C.teal,fontFamily:C.mono}}>{fmt(area.gfaA)} ㎡</strong></span>
        </div>

        {/* 용도별 행 — 모드별 다른 UI */}
        <div style={{border:`1.5px solid ${C.border}`,borderRadius:"9px",overflow:"hidden"}}>
          {rv.itemCalcs.map((item,idx)=>{
            const mc=MODE_CFG[item.mode]||MODE_CFG.rent;
            const isSale=item.mode==="sale"||item.mode==="mixed";
            const isRent=item.mode==="rent"||item.mode==="mixed";
            return(
              <div key={item.id} style={{borderBottom:idx<rv.itemCalcs.length-1?`1px solid ${C.faint}`:"none",background:idx%2?C.cardAlt:"#fff"}}>
                {/* 헤더 행: 용도명 + 모드 선택 + 전용면적 */}
                <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 10px",borderBottom:`1px solid ${C.faint}`,background:mc.bg+"60",flexWrap:"wrap"}}>
                  <input value={item.label} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"label",v:e.target.value})}
                    style={{border:"none",background:"transparent",outline:"none",fontSize:"12px",fontWeight:700,color:bt.color,fontFamily:C.sans,minWidth:"80px",maxWidth:"130px"}}/>
                  {/* 모드 선택 토글 */}
                  <div style={{display:"flex",gap:"3px",background:"#fff",border:`1px solid ${C.border}`,borderRadius:"6px",padding:"2px",flexShrink:0}}>
                    {Object.entries(MODE_CFG).map(([m,mc2])=>(
                      <button key={m} onClick={()=>D("RI",{id:bldg.id,rid:item.id,k:"saleMode",v:m})}
                        style={{padding:"3px 9px",border:"none",borderRadius:"4px",cursor:"pointer",fontSize:"10px",fontWeight:600,fontFamily:C.sans,background:item.saleMode===m?mc2.color:"transparent",color:item.saleMode===m?"#fff":C.muted,transition:"all 0.15s"}}>
                        {mc2.icon} {mc2.label}
                      </button>
                    ))}
                  </div>
                  {/* 혼합 시 분양 비율 슬라이더 */}
                  {item.mode==="mixed"&&(
                    <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                      <span style={{fontSize:"10px",color:C.muted}}>분양:</span>
                      <input type="range" min="0" max="100" step="5" value={item.saleRatio}
                        onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"saleRatio",v:e.target.value})}
                        style={{width:"80px",accentColor:C.teal}}/>
                      <span style={{fontFamily:C.mono,fontSize:"11px",color:C.teal,fontWeight:700,minWidth:"32px"}}>{item.saleRatio}%</span>
                      <span style={{fontSize:"10px",color:C.muted}}>임대:{100-n(item.saleRatio)}%</span>
                    </div>
                  )}
                  {/* 전용면적 */}
                  <div style={{display:"flex",alignItems:"center",gap:"4px",marginLeft:"auto"}}>
                    <span style={{fontSize:"10px",color:C.muted}}>전용면적:</span>
                    <input value={item.exclArea} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"exclArea",v:e.target.value})} placeholder="0.00"
                      style={{width:"75px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 7px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                    <span style={{fontSize:"9px",color:C.muted}}>㎡</span>
                  </div>
                  <button onClick={()=>D("DEL_RI",{id:bldg.id,rid:item.id})}
                    style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:"14px",flexShrink:0,padding:"0 4px"}}
                    onMouseEnter={e=>e.target.style.color=C.red} onMouseLeave={e=>e.target.style.color=C.muted}>×</button>
                </div>

                {/* 입력 행 */}
                <div style={{display:"flex",gap:"0",flexWrap:"wrap"}}>
                  {/* 분양 입력 */}
                  {isSale&&(
                    <div style={{flex:"1 1 280px",padding:"8px 12px",borderRight:`1px solid ${C.faint}`,background:"#fff9f9"}}>
                      <div style={{fontSize:"10px",color:"#dc2626",fontWeight:700,marginBottom:"7px"}}>💰 분양 계획</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}>
                        <div>
                          <div style={{fontSize:"10px",color:C.muted,marginBottom:"3px"}}>분양단가 (원/㎡) <span style={{fontSize:"9px",color:C.teal}}>층합계 기준</span></div>
                          <input value={item.salePriceUnit} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"salePriceUnit",v:e.target.value})} placeholder="0"
                            style={{width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"5px 8px",fontSize:"12px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:"10px",color:C.muted,marginBottom:"3px"}}>분양률 (%)</div>
                          <input value={item.saleRate} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"saleRate",v:e.target.value})} placeholder="100"
                            style={{width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"5px 8px",fontSize:"12px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:"10px",color:C.muted,marginBottom:"3px"}}>분양면적 (자동/직접입력)</div>
                          <input value={item.grossAreaOverride} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"grossAreaOverride",v:e.target.value})} placeholder={`자동: ${fmt(item.grossArea)} ㎡`}
                            style={{width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"5px 8px",fontSize:"12px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
                          <div style={{fontSize:"9px",color:C.muted}}>분양수입 (자동계산)</div>
                          <div style={{fontFamily:C.mono,fontSize:"14px",color:"#dc2626",fontWeight:700}}>{fM(item.itemSaleIncome)}</div>
                          <div style={{fontSize:"9px",color:C.muted}}>{fmt(item.itemSaleArea)} ㎡ × {fM(n(item.salePriceUnit))} × {item.saleRate}%</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 임대 입력 */}
                  {isRent&&(
                    <div style={{flex:"1 1 280px",padding:"8px 12px",background:"#f0fdf4"}}>
                      <div style={{fontSize:"10px",color:C.green,fontWeight:700,marginBottom:"7px"}}>🏠 임대 계획</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"7px"}}>
                        <div>
                          <div style={{fontSize:"10px",color:C.muted,marginBottom:"3px"}}>월 임대단가 (원/㎡)</div>
                          <input value={item.rentUnit} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"rentUnit",v:e.target.value})} placeholder="0"
                            style={{width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"5px 8px",fontSize:"12px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:"10px",color:C.muted,marginBottom:"3px"}}>보증금단가 (원/㎡)</div>
                          <input value={item.depositUnit} onChange={e=>D("RI",{id:bldg.id,rid:item.id,k:"depositUnit",v:e.target.value})} placeholder="0"
                            style={{width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"5px 8px",fontSize:"12px",fontFamily:C.mono,textAlign:"right",outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:"9px",color:C.muted}}>임대 전용면적</div>
                          <div style={{fontFamily:C.mono,fontSize:"13px",color:C.green,fontWeight:700}}>{fmt(item.itemRentExcl)} ㎡</div>
                        </div>
                        <div>
                          <div style={{fontSize:"9px",color:C.muted}}>연 임대수입</div>
                          <div style={{fontFamily:C.mono,fontSize:"14px",color:C.green,fontWeight:700}}>{fM(item.ann)}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{marginTop:"10px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"8px"}}>
          <Btn sm variant="ghost" onClick={()=>D("ADD_RI",{id:bldg.id})}>＋ 용도 추가</Btn>
          <div style={{display:"flex",gap:"16px"}}>
            {rv.saleIncome>0&&<div style={{fontFamily:C.mono,fontSize:"12px",color:"#dc2626",fontWeight:700}}>분양수입: {fM(rv.saleIncome)}</div>}
            {rv.annual>0&&<div style={{fontFamily:C.mono,fontSize:"12px",color:C.green,fontWeight:700}}>연 임대수입: {fM(rv.annual)}</div>}
          </div>
        </div>
      </Card>

      {/* 분양 수지 요약 (분양 있는 경우만) */}
      {hasSale&&(
        <Card title="분양 수지 요약" tag="SALE SUMMARY" accentBar="#dc2626">
          <G cols="repeat(auto-fit,minmax(130px,1fr))">
            <KpiCard label="총 분양수입" value={fM(rv.saleIncome)} unit="" large/>
            <KpiCard label="분양 배분 사업비" value={fM(rv.saleTDC)} unit=""/>
            <KpiCard label="분양 개발이익" value={fM(rv.saleProfit)} unit="" ok2={rv.saleProfit>0} warn={rv.saleProfit<0}/>
            <KpiCard label="사업수지율" value={fP(rv.saleSujiRate)} unit="%" ok2={rv.saleSujiRate>=110} warn={rv.saleSujiRate<100}
              sub="분양수입÷배분사업비"/>
            <KpiCard label="총 분양면적" value={fmt(rv.totalSaleArea)} sub="층합계 기준"/>
            <KpiCard label="임대 보유 배분 TDC" value={fM(rv.rentTDC)} unit=""/>
          </G>
          <div style={{marginTop:"10px",padding:"8px 12px",background:C.amberBg,borderRadius:"7px",fontSize:"10px",color:C.amber,lineHeight:1.7}}>
            ⚠ 분양 배분 사업비 = TDC × (분양면적 / 지상 층합계). 실무에서는 직접공사비·간접비를 분리해 배분하지만 타당성 단계에서는 면적 비율 배분을 적용합니다.
          </div>
        </Card>
      )}

      <Card title="보증금·공실·운영비" tag="COMMON PARAMS" accentBar={bt.color}>
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <TInput label="보증금 전환율" value={r.convR} onChange={v=>D("REV",{id:bldg.id,k:"convR",v})} unit="%"/>
          <TInput label="공실률" value={r.vacancyR} onChange={v=>D("REV",{id:bldg.id,k:"vacancyR",v})} unit="%"/>
          <TInput label="운영비율 (EGI 대비, 재산세 제외)" value={r.opexR} onChange={v=>D("REV",{id:bldg.id,k:"opexR",v})} unit="%"/>
        </G>
        <G cols="repeat(4,1fr)" mt="9px">
          <KpiCard label="총수입 GI" value={fM(rv.gi)} unit=""/><KpiCard label="공실 차감" value={fM(rv.vacancy)} unit="" warn={n(r.vacancyR)>10}/><KpiCard label="EGI" value={fM(rv.egi)} unit=""/><KpiCard label="운영비 OpEx" value={fM(rv.opex)} unit=""/>
        </G>
      </Card>

      <Card title="임대료 상승률" tag="RENT ESCALATION · 상가임대차법 §11 상한 5%" accentBar={C.purple}>
        <G cols="repeat(2,1fr)">
          <TInput label="연간 상승률" value={r.rentEscR} onChange={v=>D("REV",{id:bldg.id,k:"rentEscR",v})} unit="%" lawNote="상한 5%"/>
          <TInput label="적용 주기" value={r.rentEscPeriod} onChange={v=>D("REV",{id:bldg.id,k:"rentEscPeriod",v})} unit="년"/>
        </G>
      </Card>

      <Card title="재산세 (보유세) — 독립 항목" tag="지방세법 §110~§122" accentBar={C.red}>
        <div style={{marginBottom:"9px",fontSize:"10px",color:C.muted,lineHeight:1.7}}>
          자동: 건물분(공사비×50%×70%×0.25%×1.2) + 토지분(토지비×70%×0.3%×1.2). 직접입력 시 자동값 덮어씀.
        </div>
        <G cols="repeat(auto-fit,minmax(160px,1fr))">
          <TInput label="건물분 재산세 (연)" value={r.propTaxBldgOverride} onChange={v=>D("REV",{id:bldg.id,k:"propTaxBldgOverride",v})} unit="원" lawNote="지방세법 §110" placeholder={`자동: ${fM(rv.propTaxBldg)}`}/>
          <TInput label="토지분 재산세 (연)" value={r.propTaxLandOverride} onChange={v=>D("REV",{id:bldg.id,k:"propTaxLandOverride",v})} unit="원" lawNote="지방세법 §110" placeholder={`자동: ${fM(rv.propTaxLand)}`}/>
          <KpiCard label="재산세 합계 (연)" value={fM(rv.propTax)} unit="" warn={rv.propTax>rv.egi*0.1} sub="NOI 차감 항목"/>
        </G>
      </Card>

      <div style={{background:C.greenBg,border:`2px solid ${C.green}30`,borderRadius:"12px",padding:"16px 18px",boxShadow:C.shadowMd}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:"20px",alignItems:"center"}}>
          <div>
            <div style={{fontSize:"9px",color:C.green,fontWeight:700,letterSpacing:"0.1em",marginBottom:"4px"}}>순영업이익 (NOI)</div>
            <div style={{fontFamily:C.mono,fontSize:"28px",color:C.green,fontWeight:700}}>{fM(rv.noi)}</div>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>{fmt(rv.noi,0)} 원 / 연</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 18px"}}>
            {[["임대수입",fM(rv.annual)],["보증금운용",fM(rv.depInc)],["공실 차감","▼ "+fM(rv.vacancy)],["운영비","▼ "+fM(rv.opex)],["재산세","▼ "+fM(rv.propTax)]].map(([l,v])=>(
              <div key={l}><span style={{fontSize:"10px",color:C.muted}}>{l}: </span><span style={{fontSize:"11px",fontFamily:C.mono,fontWeight:600,color:v.startsWith("▼")?C.red:C.mid}}>{v}</span></div>
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
  const totSaleIncome=targets.reduce((s,c)=>s+(c.rev.saleIncome||0),0);
  const totSaleProfit=targets.reduce((s,c)=>s+(c.rev.saleProfit||0),0);
  const totSaleTDC=targets.reduce((s,c)=>s+(c.rev.saleTDC||0),0);
  const totRentLoan=targets.reduce((s,c)=>s+(c.rev.rentLoan||c.cost.loan),0);
  const hasSale=totSaleIncome>0;
  const capRate=totTDC>0?totNOI/totTDC*100:0;
  const ana=totTDC>0&&(totNOI!==0||totEq>0)?calcAnalysis(totTDC,totEq,totLoan,totNOI,totAnn,anlys,{saleIncome:totSaleIncome,saleProfit:totSaleProfit,saleTDC:totSaleTDC,rentLoan:totRentLoan}):null;
  const sig=(v,good,ok)=>v===null?C.muted:v>=good?C.green:v>=ok?C.amber:C.red;
  const thS={padding:"7px 9px",fontSize:"10px",color:C.muted,fontWeight:700,borderRight:`1px solid ${C.border}`,whiteSpace:"nowrap"};

  return(
    <div>
      <Card title="분석 범위" tag="ANALYSIS SCOPE">
        <div style={{display:"flex",flexWrap:"wrap",gap:"7px"}}>
          {[{id:"all",label:`전체 합산 (${buildings.length}동)`,bt:{color:C.accent,bg:C.accentBg}},...buildings.map(b=>({id:b.id,label:`${b.name} (${(BT[b.type]||BT.office).short})`,bt:BT[b.type]||BT.office}))].map(({id,label,bt:btn})=>{
            const active=analysisScope===id;
            return(<button key={id} onClick={()=>D("SCOPE",id)} style={{padding:"6px 14px",borderRadius:"18px",border:`1.5px solid ${active?btn.color:C.border}`,background:active?btn.bg:"#fff",color:active?btn.color:C.muted,fontSize:"11px",fontWeight:active?700:400,cursor:"pointer",fontFamily:C.sans,transition:"all 0.15s"}}>{label}</button>);
          })}
        </div>
        <G cols="repeat(auto-fit,minmax(110px,1fr))" mt="10px">
          <KpiCard label="총사업비 (TDC)" value={fM(totTDC)} unit=""/>
          <KpiCard label="자기자본" value={fM(totEq)} unit=""/>
          {hasSale&&<KpiCard label="분양수입 (일시)" value={fM(totSaleIncome)} unit="" ok2/>}
          {hasSale&&<KpiCard label="분양 개발이익" value={fM(totSaleProfit)} unit="" ok2={totSaleProfit>0} warn={totSaleProfit<0}/>}
          <KpiCard label="연 NOI (임대)" value={fM(totNOI)} unit="" hi/>
          <KpiCard label="Cap Rate (임대)" value={fP(capRate)} unit="%" hi/>
        </G>
        {hasSale&&(
          <div style={{marginTop:"10px",padding:"9px 13px",background:"#fff0f0",border:`1px solid #dc262630`,borderRadius:"8px",fontSize:"10px",color:"#dc2626",lineHeight:1.7}}>
            <strong>혼합 사업 현금흐름 구조:</strong> 준공 시 분양수입({fM(totSaleIncome)}) 일시 유입 → 이후 임대 NOI 지속 발생 → 보유기간 말 임대 자산 매각. 통합 IRR은 이 세 가지를 합산한 단일 현금흐름 기준입니다.
          </div>
        )}
      </Card>

      <Card title="분석 파라미터" tag="PARAMETERS">
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <TInput label="보유기간" value={anlys.holdYears} onChange={uA("holdYears")} unit="년"/>
          <TInput label="할인율 (WACC)" value={anlys.discountR} onChange={uA("discountR")} unit="%"/>
          <TInput label="출구 Cap Rate" value={anlys.exitCapR} onChange={uA("exitCapR")} unit="%"/>
          <TInput label="연 원리금 이율" value={anlys.mortgageR} onChange={uA("mortgageR")} unit="%"/>
          <TInput label="B/C 분석기간" value={anlys.bcYears} onChange={uA("bcYears")} unit="년"/>
          <TInput label="임대료 상승률 (DCF)" value={anlys.rentEscR} onChange={uA("rentEscR")} unit="%"/>
          <TInput label="상승 주기" value={anlys.rentEscPeriod} onChange={uA("rentEscPeriod")} unit="년"/>
        </G>
      </Card>

      {!ana?(
        <div style={{textAlign:"center",padding:"40px 20px",color:C.muted,fontSize:"13px",background:C.card,borderRadius:"12px",border:`1.5px solid ${C.border}`,lineHeight:2}}>
          사업비와 수익 데이터를 먼저 입력해주세요.
        </div>
      ):(
        <>
          {/* ─ 분양 수지 (분양 있을 때만) ─ */}
          {hasSale&&(
            <Card title="① 분양 수지" tag="SALE SUMMARY" accentBar="#dc2626">
              <G cols="repeat(auto-fit,minmax(130px,1fr))">
                <KpiCard label="분양수입" value={fM(totSaleIncome)} unit="" large/>
                <KpiCard label="배분 사업비" value={fM(totSaleTDC)} unit=""/>
                <KpiCard label="분양 개발이익" value={fM(totSaleProfit)} unit="" ok2={totSaleProfit>0} warn={totSaleProfit<0}
                  sub={`사업수지율 ${fP(totSaleTDC>0?totSaleIncome/totSaleTDC*100:0)}%`}/>
                <div style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"9px",padding:"11px 13px",boxShadow:C.shadow}}>
                  <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>개발이익률</div>
                  <div style={{fontFamily:C.mono,fontSize:"19px",color:totSaleProfit>0?C.green:C.red,fontWeight:700}}>
                    {totSaleTDC>0?fP(totSaleProfit/totSaleTDC*100):"—"}%
                  </div>
                  <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>개발이익÷배분사업비</div>
                </div>
              </G>
            </Card>
          )}

          {/* ─ 단순 수익률 ─ */}
          <Card title={hasSale?"② 임대 단순 수익률":"① 단순 수익률"} tag="SIMPLE RETURN · 임대 파트">
            <G cols="repeat(auto-fit,minmax(140px,1fr))">
              {[["Cap Rate",fP(ana.capRate)+"%",sig(ana.capRate,5,3),"NOI÷TDC"],["Cash-on-Cash",fP(ana.coc)+"%",sig(ana.coc,8,5),"세전CF÷전체Equity"],["Gross Yield",fP(ana.grossY)+"%",C.mid,"임대수입÷TDC"],["투자회수기간",ana.payback!==null?fP(ana.payback,1)+"년":"—",C.mid,"통합CF 기준"]].map(([l,v,c,sub])=>(
                <div key={l} style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"9px",padding:"11px 13px",boxShadow:C.shadow}}>
                  <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>{l}</div>
                  <div style={{fontFamily:C.mono,fontSize:"19px",color:c,fontWeight:700}}>{v}</div>
                  <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>{sub}</div>
                </div>
              ))}
            </G>
          </Card>

          <Card title={hasSale?`${hasSale?"③":"②"} DCF / NPV / IRR (통합 — 분양+임대)`: "② DCF / NPV / IRR"} tag="DISCOUNTED CASH FLOW · 임대료 상승 반영">
            {hasSale&&(
              <div style={{marginBottom:"10px",padding:"8px 12px",background:"#fff0f0",border:`1px solid #dc262630`,borderRadius:"7px",fontSize:"10px",color:"#dc2626",lineHeight:1.7}}>
                0년차 현금흐름 = −전체자기자본 + 분양수입({fM(totSaleIncome)}) 일시수령.
                이후 임대 NOI({fM(totNOI)}/년) 지속, 만기 임대자산 출구가치 실현.
              </div>
            )}
            <G cols="repeat(auto-fit,minmax(140px,1fr))">
              <div style={{background:ana.NPV>0?C.greenBg:C.redBg,border:`1.5px solid ${ana.NPV>0?C.green:C.red}30`,borderRadius:"9px",padding:"11px 13px"}}>
                <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"4px"}}>NPV ({anlys.discountR}% 할인)</div>
                <div style={{fontFamily:C.mono,fontSize:"19px",color:ana.NPV>0?C.green:C.red,fontWeight:700}}>{fM(ana.NPV)}</div>
                <div style={{fontSize:"9px",color:ana.NPV>0?C.green:C.red,marginTop:"4px"}}>{ana.NPV>0?"✓ 타당":"✗ 재검토"}</div>
              </div>
              <div style={{background:ana.IRR!==null&&ana.IRR>=n(anlys.discountR)?C.greenBg:C.redBg,border:`1.5px solid ${ana.IRR!==null&&ana.IRR>=n(anlys.discountR)?C.green:C.red}30`,borderRadius:"9px",padding:"11px 13px"}}>
                <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"4px"}}>통합 IRR {hasSale?"(분양+임대)":""}</div>
                <div style={{fontFamily:C.mono,fontSize:"19px",color:sig(ana.IRR,n(anlys.discountR)+2,n(anlys.discountR)),fontWeight:700}}>{ana.IRR!==null?fP(ana.IRR)+"%":"산출불가"}</div>
                <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>hurdle {anlys.discountR}%</div>
              </div>
              <KpiCard label="출구가치 (TV)" value={fM(ana.tv)} unit="" sub={`임대자산 Cap ${anlys.exitCapR}%`}/>
              <KpiCard label="임대 연초 세전 CF" value={fM(ana.yearNOIs[0]-ana.debtSvc)} unit=""/>
            </G>
            <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"8px",marginTop:"11px"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:"400px"}}>
                <thead><tr style={{background:C.cardAlt}}>{["연도","비고","현금흐름","누적 CF","현재가치","누적 NPV"].map((h,i)=><th key={i} style={{...thS,textAlign:i===0?"left":"right"}}>{h}</th>)}</tr></thead>
                <tbody>
                  {ana.cfs.map((cf,y)=>{
                    const pv=cf/(1+ana.dr)**y;
                    const cumCf=ana.cfs.slice(0,y+1).reduce((s,c)=>s+c,0);
                    const cumPv=ana.cfs.slice(0,y+1).reduce((s,c,t)=>s+c/(1+ana.dr)**t,0);
                    const yn=y===0?null:(ana.yearNOIs[Math.min(y-1,ana.yearNOIs.length-1)]||0);
                    const note=y===0?(hasSale?`투자+분양수령`:"초기투자"):`NOI ${fM(yn)}`;
                    return(
                      <tr key={y} style={{borderBottom:`1px solid ${C.faint}`,background:y===0?"#fff5f5":y%2?C.cardAlt:"#fff"}}>
                        <td style={{padding:"5px 9px",fontSize:"10px",color:C.muted,fontWeight:y===0?700:400,borderRight:`1px solid ${C.border}`}}>{y===0?"0년차":`${y}년차`}</td>
                        <td style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"10px",color:C.muted,borderRight:`1px solid ${C.border}`}}>{note}</td>
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

          <Card title={hasSale?"④ B/C 분석":"③ B/C 분석"} tag="BENEFIT-COST">
            <G cols="repeat(3,1fr)">
              <div style={{background:ana.bc>=1?C.greenBg:C.redBg,border:`1.5px solid ${ana.bc>=1?C.green:C.red}30`,borderRadius:"9px",padding:"11px 13px"}}>
                <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"4px"}}>B/C ({anlys.bcYears}년)</div>
                <div style={{fontFamily:C.mono,fontSize:"22px",color:ana.bc>=1?C.green:C.red,fontWeight:700}}>{fP(ana.bc,2)}</div>
                <div style={{fontSize:"9px",color:ana.bc>=1.2?C.green:ana.bc>=1?C.amber:C.red,marginTop:"4px"}}>{ana.bc>=1.2?"✓ 우수":ana.bc>=1?"△ 타당":"✗ 미달"}</div>
              </div>
              <KpiCard label="PV 편익 합계" value={fM(ana.bc*totEq)} unit=""/>
              <KpiCard label="비용 (자기자본)" value={fM(totEq)} unit=""/>
            </G>
          </Card>

          <Card title={hasSale?"⑤ NOI 민감도 분석":"④ NOI 민감도 분석"} tag="SENSITIVITY · 임대 NOI 기준">
            <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"8px"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{background:C.cardAlt}}>{["NOI 변동","NOI (연)","연 CF","NPV","통합IRR","판정"].map((h,i)=><th key={i} style={{...thS,textAlign:i===0?"left":"right"}}>{h}</th>)}</tr></thead>
                <tbody>
                  {ana.sens.map(s=>{
                    const base=s.dp===0;
                    const irrOk=s.irr!==null&&s.irr*100>=n(anlys.discountR);
                    return(
                      <tr key={s.dp} style={{borderBottom:`1px solid ${C.faint}`,background:base?C.accentBg:"transparent"}}>
                        <td style={{padding:"7px 9px",fontFamily:C.mono,fontSize:"11px",color:base?C.accent:s.dp>0?C.green:C.red,fontWeight:base?700:400,borderRight:`1px solid ${C.border}`}}>{s.dp===0?"기준 (0%)":s.dp>0?`+${s.dp}%`:`${s.dp}%`}</td>
                        {[fM(s.noi),fM(s.cf),fM(s.npv),s.irr!==null?fP(s.irr*100)+"%":"—"].map((v,i)=>(
                          <td key={i} style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,fontWeight:base?600:400,color:i===2?(s.npv>0?C.green:C.red):i===3?(irrOk?C.green:C.red):C.mid}}>{v}</td>
                        ))}
                        <td style={{padding:"7px 9px",textAlign:"right",fontSize:"10px",fontWeight:600,color:s.npv>0?C.green:C.red}}>{s.npv>0?"✓ 타당":"✗ 미달"}</td>
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
const TABS=[{id:"area",label:"면적표",icon:"📐"},{id:"cost",label:"사업비",icon:"💰"},{id:"rev",label:"수익 계획",icon:"📊"},{id:"analysis",label:"사업성분석",icon:"🔍"},{id:"refs",label:"기준",icon:"📋"}];

export default function App(){
  const[state,dispatch]=useReducer(reducer,initState);
  const{siteMode,site,buildings,activeBldgId,activeTab,refs}=state;
  const D=useCallback((type,p)=>dispatch({type,p}),[]);

  const activeBldg=buildings.find(b=>b.id===activeBldgId)||buildings[0];
  const bt=BT[activeBldg?.type]||BT.office;

  const allCalcs=useMemo(()=>buildings.map(bldg=>{
    const siteArea=siteMode==="single"?site.area:bldg.ownSiteArea;
    const area=calcArea(bldg,siteArea,refs.parking);
    const cost=calcCost(bldg,area,refs);
    const rev=calcRev(bldg,area,cost);
    return{bldg,area,cost,rev};
  }),[buildings,siteMode,site,refs]);

  const activeCalc=allCalcs.find(c=>c.bldg.id===activeBldgId)||allCalcs[0];
  const totTDC=allCalcs.reduce((s,c)=>s+c.cost.tdc,0);
  const totNOI=allCalcs.reduce((s,c)=>s+c.rev.noi,0);
  const totSaleAll=allCalcs.reduce((s,c)=>s+(c.rev.saleIncome||0),0);
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
          <div style={{fontSize:"9px",color:"#64748b",letterSpacing:"0.04em"}}>Building Feasibility Simulator v5.0 · {refs.region} 기준</div>
        </div>
        {totTDC>0&&(
          <div style={{display:"flex",gap:"14px",flexWrap:"wrap"}}>
            {[
              ["TDC",fM(totTDC)],
              ...(totSaleAll>0?[["분양수입",fM(totSaleAll)]]:[] ),
              ["NOI/년",fM(totNOI)],
              ["Cap Rate",cap>0?fP(cap)+"%":"—"],
            ].map(([l,v])=>(
              <div key={l} style={{textAlign:"right"}}><div style={{fontSize:"8px",color:"#64748b"}}>{l}</div><div style={{fontSize:"12px",fontFamily:C.mono,color:"#e2e8f0",fontWeight:700}}>{v}</div></div>
            ))}
          </div>
        )}
      </div>

      {/* 대지 모드 */}
      <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"8px 18px",display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
        <span style={{fontSize:"10px",fontWeight:700,color:C.muted,letterSpacing:"0.04em"}}>대지 구성</span>
        <div style={{display:"flex",gap:"0",background:C.cardAlt,border:`1.5px solid ${C.border}`,borderRadius:"8px",padding:"2px",overflow:"hidden"}}>
          {[["single","🏗 단일 대지"],["multiple","🏗 복수 대지"]].map(([v,l])=>(
            <button key={v} onClick={()=>D("SITE_MODE",v)} style={{padding:"4px 12px",background:siteMode===v?"#fff":"transparent",border:"none",borderRadius:"6px",color:siteMode===v?C.accent:C.muted,fontSize:"11px",fontWeight:siteMode===v?700:400,cursor:"pointer",fontFamily:C.sans,boxShadow:siteMode===v?C.shadow:"none",transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>
        <div style={{fontSize:"10px",padding:"3px 9px",borderRadius:"5px",background:siteMode==="single"?C.accentBg:C.amberBg,border:`1px solid ${siteMode==="single"?C.accent+"40":C.amber+"40"}`,color:siteMode==="single"?C.accent:C.amber}}>
          {siteMode==="single"?"대지·용도지역 공통 / 건폐율·용적률 합산":"건물별 별도 대지 / 각각 산출"}
        </div>
      </div>

      {/* 건물 목록 */}
      <div style={{background:"#fff",borderBottom:`2px solid ${C.border}`,padding:"8px 18px",display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap"}}>
        <span style={{fontSize:"9px",fontWeight:700,color:C.muted,letterSpacing:"0.06em",marginRight:"3px",flexShrink:0}}>건물 목록</span>
        {buildings.map(b=>{
          const bbt=BT[b.type]||BT.office;
          const active=b.id===activeBldgId;
          return(
            <div key={b.id} style={{display:"flex",alignItems:"stretch",background:active?bbt.bg:C.cardAlt,border:`1.5px solid ${active?bbt.color:C.border}`,borderRadius:"18px",overflow:"hidden",transition:"all 0.15s",cursor:"pointer"}}>
              <div onClick={()=>D("ACT_BLDG",b.id)} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 10px"}}>
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
            <button key={id} onClick={()=>D("TAB",id)} style={{padding:"10px 15px",background:"transparent",border:"none",borderBottom:active?(isRefs?`2.5px solid ${C.purple}`:`2.5px solid ${bt.color}`):"2.5px solid transparent",color:active?(isRefs?C.purple:bt.color):C.muted,cursor:"pointer",fontSize:"12px",fontWeight:active?700:400,fontFamily:C.sans,transition:"all 0.15s",marginBottom:"-1.5px",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"5px"}}>
              <span>{icon}</span>{label}
              {isRefs&&<span style={{fontSize:"8px",background:C.purpleBg,color:C.purple,padding:"1px 5px",borderRadius:"4px",fontWeight:700}}>법정기준</span>}
            </button>
          );
        })}
      </div>

      {/* 콘텐츠 */}
      <div style={{maxWidth:"980px",margin:"0 auto",padding:"14px"}}>
        {activeTab==="area"     &&activeCalc&&<AreaTab     state={state} dispatch={dispatch} bldg={activeBldg} area={activeCalc.area} allCalcs={allCalcs}/>}
        {activeTab==="cost"     &&activeCalc&&<CostTab     bldg={activeBldg} dispatch={dispatch} area={activeCalc.area} refs={refs}/>}
        {activeTab==="rev"      &&activeCalc&&<RevTab      bldg={activeBldg} dispatch={dispatch} area={activeCalc.area} cost={activeCalc.cost}/>}
        {activeTab==="analysis"            &&<AnalysisTab state={state} dispatch={dispatch} allCalcs={allCalcs}/>}
        {activeTab==="refs"                &&<RefsTab     state={state} dispatch={dispatch}/>}
      </div>

      <div style={{textAlign:"center",fontSize:"9px",color:C.muted,padding:"12px 0 24px",letterSpacing:"0.04em"}}>
        건축사업 사업성 검토기 v5.0 · {refs.region} 기준 · 산출값은 타당성 검토 단계 참고용이며 실제 인허가·계약에 직접 적용 불가
      </div>
    </div>
  );
}
