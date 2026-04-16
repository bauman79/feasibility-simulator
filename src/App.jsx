import { useState, useMemo, useReducer, useCallback, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, serverTimestamp } from "firebase/firestore";

// ═══════════════════════════════════════════════════════
// § 0. Firebase 초기화
// ═══════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

// ═══════════════════════════════════════════════════════
// § 0-A. PWA 서비스워커 등록
// ═══════════════════════════════════════════════════════
if(typeof window!=="undefined"&&"serviceWorker"in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("/sw.js").catch(()=>{});
  });
}

// ═══════════════════════════════════════════════════════
// § 0-B. Firebase Auth 훅 (실제 Google 로그인)
// ═══════════════════════════════════════════════════════
function useAuth(){
  const[user,setUser]=useState(null);
  const[loading,setLoading]=useState(true);

  useEffect(()=>{
    const unsubscribe=onAuthStateChanged(auth,u=>{
      setUser(u?{
        name: u.displayName,
        email: u.email,
        photo: u.photoURL,
        uid: u.uid,
      }:null);
      setLoading(false);
    });
    return unsubscribe;
  },[]);

  const signIn=async()=>{
    try{
      const provider=new GoogleAuthProvider();
      provider.setCustomParameters({prompt:"select_account"});
      await signInWithPopup(auth,provider);
    }catch(e){ console.error("로그인 실패:",e); }
  };

  const signOut=async()=>{
    try{ await fbSignOut(auth); }catch(e){ console.error("로그아웃 실패:",e); }
  };

  return{user,loading,signIn,signOut};
}

// ═══════════════════════════════════════════════════════
// § 0-C. Firestore 저장/불러오기
// ═══════════════════════════════════════════════════════
const LOCAL_KEY="feasibility_v8_state";

// 로컬 저장 (비로그인 시 폴백)
function saveLocal(state){
  try{ localStorage.setItem(LOCAL_KEY,JSON.stringify(state)); return true; }catch(e){ return false; }
}
function loadLocal(){
  try{ const r=localStorage.getItem(LOCAL_KEY); return r?JSON.parse(r):null; }catch(e){ return null; }
}

// Firestore 저장 (로그인 시)
async function saveToCloud(uid, state, projectName="기본 프로젝트"){
  const id = "project_" + Date.now();
  await setDoc(doc(db,"users",uid,"projects",id),{
    name: projectName || "프로젝트",
    state: JSON.stringify(state),
    savedAt: serverTimestamp(),
  });
  return id;
}

// Firestore 프로젝트 목록 불러오기
async function loadProjectList(uid){
  const snap=await getDocs(collection(db,"users",uid,"projects"));
  return snap.docs.map(d=>({id:d.id,...d.data(),savedAt:d.data().savedAt?.toDate?.()?.toLocaleString("ko-KR")||""}));
}

// 특정 프로젝트 불러오기
async function loadFromCloud(uid, projectId){
  const snap=await getDoc(doc(db,"users",uid,"projects",projectId));
  if(!snap.exists()) return null;
  return JSON.parse(snap.data().state);
}

// 프로젝트 삭제
async function deleteProject(uid, projectId){
  await deleteDoc(doc(db,"users",uid,"projects",projectId));
}

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
    landUnit:"", landMult:"1.0",     // landMult: 배수 → 감정추정가 = landUnit × landMult
    constrAbove:"", constrBelow:"",
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
// § 3-B. 분담금 의무/선택/비해당 자동 판정
// ═══════════════════════════════════════════════════════
// status: "required" | "optional" | "na"
function getChargeStatus(chargeKey, bldg, area){
  const t=bldg.type;
  const gfaT=area?.gfaT||0;
  const gfaFar=area?.gfaFar||0;
  const hasSaleInType=bldg.revItems?.some(i=>i.saleMode!=="rent");
  const isOfficeRetail=["office","retail","mixed"].includes(t);

  const M=(reason)=>({status:"required", reason, color:"#b91c1c", label:"의무"});
  const O=(reason)=>({status:"optional", reason, color:"#92400e", label:"선택"});
  const N=(reason)=>({status:"na",       reason, color:"#64748b", label:"비해당"});

  switch(chargeKey){
    case"waterSupply": return M("신규 건축물 상수도 인입 시 의무 부담 (수도법 §71)");
    case"sewer":       return M("신규 건축물 오수 발생 시 의무 부담 (하수도법 §61)");
    case"distHeat":    return O("지역난방 공급구역 내 해당 시 부담. 공급가능 여부 확인 필요");
    case"gas":         return O("도시가스 공급 지역 해당 시. 사업자 확인 필요");
    case"transport":
      if(isOfficeRetail && gfaFar>=5000)
        return M(`업무/판매 용적률산정용 연면적 ${Math.round(gfaFar).toLocaleString()}㎡ ≥ 5,000㎡ — 수도권 과밀억제권역 해당 시 의무`);
      if(isOfficeRetail && gfaFar>0)
        return O(`현재 ${Math.round(gfaFar).toLocaleString()}㎡ — 5,000㎡ 미달. 해당 지역 확인 필요`);
      if(t==="resi" && hasSaleInType)
        return M("분양 주택 500세대 이상 해당 시 의무 (광역교통법)");
      return O("규모·용도 검토 필요");
    case"school":
      if(t==="resi" && hasSaleInType) return M("분양 공동주택 포함 시 의무 (학교용지확보특례법)");
      if(t==="resi") return O("임대 전용 시 비적용 — 분양 전환 시 재검토");
      return N("공동주택 이외 용도 — 비해당");
    case"overcrowd":
      if(isOfficeRetail && gfaT>25000)
        return M(`연면적 ${Math.round(gfaT).toLocaleString()}㎡ > 25,000㎡ 초과 — 수도권 과밀억제권역 업무·판매용 의무`);
      if(isOfficeRetail)
        return O(`현재 ${Math.round(gfaT).toLocaleString()}㎡ — 25,000㎡ 미달. 증가 시 재검토`);
      return N("업무·판매시설 아님 — 비해당");
    case"develop":
      return O("개발이익 발생 시 사후 부과. 개략 추정 입력 후 실제 감정평가로 확정");
    default: return O("항목 확인 필요");
  }
}
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
  const landMult=Math.max(1, n(c.landMult)||1);
  const appraisalLand=land*landMult;  // 감정 추정 토지가

  const cA=area.gfaA*n(c.constrAbove);
  const cB=area.gfaB*n(c.constrBelow);
  const constr=cA+cB;

  const designRate=c.designROverride?n(c.designROverride):getDesignRate(constr,refs.design);
  const design=constr*designRate/100;
  const supervRate=c.supervROverride?n(c.supervROverride):refs.superv;
  const superv=constr*supervRate/100;
  const reserve=constr*n(c.reserveR)/100;
  const acquiTax=c.acquiTaxOverride?n(c.acquiTaxOverride):land*ACQUI_TAX_RATE/100;

  const autoCharges=calcChargesAuto(bldg,area,constr,land,refs.charges);
  const charges={}; let chgTotal=0;
  for(const key of Object.keys(autoCharges)){
    const ov=c.chargeOverrides[key];
    const auto=autoCharges[key];
    const cs=getChargeStatus(key,bldg,area);
    // 비해당(na)이면 0, override 우선, 그 다음 auto
    const final=cs.status==="na"?0:(ov!==""?n(ov):auto);
    charges[key]={ auto, final, overridden:ov!=="", enabled:refs.charges[key]?.enabled||false, cs };
    chgTotal+=final;
  }

  const indirect=design+superv+reserve+acquiTax+chgTotal;
  const base=land+constr+indirect;
  const loan=base*n(c.ltvR)/100;
  const finance=loan*n(c.loanR)/100*n(c.loanPeriod)/12;
  const tdc=base+finance;
  return{ land, landMult, appraisalLand, cA,cB,constr, design,designRate, superv,supervRate,
          reserve, acquiTax, charges, chgTotal, indirect, base, loan, finance, tdc, equity:tdc-loan };
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
    case"LOAD_STATE": return{...p};
    default: return state;
  }
}

// 앱 시작 시 로컬스토리지에서 이전 상태 복원
function getInitState(){
  try{
    const raw=localStorage.getItem(LOCAL_KEY);
    if(raw){const parsed=JSON.parse(raw); if(parsed&&parsed.buildings&&parsed.site)return parsed;}
  }catch(e){}
  return initState;
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
// § 7-A. 인증·저장 UI
// ═══════════════════════════════════════════════════════
function AuthBar({user,loading,signIn,signOut,onSave,onLoad,lastSaved,onModeSwitch,saveMsg}){
  return(
    <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"6px 18px",display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",justifyContent:"flex-end"}}>
      <button onClick={()=>onModeSwitch&&onModeSwitch("apartment")} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 11px",borderRadius:"6px",border:"1.5px solid #7c3aed",background:"#f5f3ff",color:"#7c3aed",fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:700}}>
        🏠 공동주택
      </button>
      <div style={{width:"1px",height:"18px",background:C.border}}/>
      <button onClick={onLoad} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 11px",borderRadius:"6px",border:`1.5px solid ${C.border}`,background:"#fff",color:C.mid,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600}}>
        📂 불러오기{user?" (클라우드)":""}
      </button>
      <button onClick={onSave} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 11px",borderRadius:"6px",border:`1.5px solid ${C.accent}`,background:C.accentBg,color:C.accent,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600}}>
        💾 저장{user?" (클라우드)":""}
      </button>
      {lastSaved&&<span style={{fontSize:"9px",color:C.muted}}>저장: {lastSaved}</span>}
      {saveMsg&&<span style={{fontSize:"10px",color:C.green,fontWeight:600}}>{saveMsg}</span>}
      <div style={{width:"1px",height:"20px",background:C.border,margin:"0 4px"}}/>
      {user?(
        <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
          {user.photo?<img src={user.photo} style={{width:"24px",height:"24px",borderRadius:"50%"}} alt=""/>:<div style={{width:"24px",height:"24px",borderRadius:"50%",background:C.accentBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px"}}>👤</div>}
          <span style={{fontSize:"11px",color:C.mid,fontWeight:600}}>{user.name||user.email}</span>
          <button onClick={signOut} style={{fontSize:"10px",padding:"3px 8px",borderRadius:"5px",border:`1px solid ${C.border}`,background:"#fff",color:C.muted,cursor:"pointer",fontFamily:C.sans}}>로그아웃</button>
        </div>
      ):(
        <button onClick={signIn} disabled={loading} style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 12px",borderRadius:"6px",border:`1.5px solid ${C.border}`,background:"#fff",color:C.mid,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600,opacity:loading?0.6:1}}>
          <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          {loading?"확인 중...":"Google 로그인"}
        </button>
      )}
    </div>
  );
}
      <button onClick={onSave} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 11px",borderRadius:"6px",border:`1.5px solid ${C.accent}`,background:C.accentBg,color:C.accent,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600}}>
        💾 저장
      </button>
      {lastSaved&&<span style={{fontSize:"9px",color:C.muted}}>저장: {lastSaved}</span>}

      <div style={{width:"1px",height:"20px",background:C.border,margin:"0 4px"}}/>

      {/* Google 로그인 */}
      {user?(
        <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
          <div style={{width:"24px",height:"24px",borderRadius:"50%",background:C.accentBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px"}}>{user.photo?<img src={user.photo} style={{width:"24px",height:"24px",borderRadius:"50%"}} alt=""/>:"👤"}</div>
          <span style={{fontSize:"11px",color:C.mid,fontWeight:600}}>{user.name||user.email}</span>
          <button onClick={signOut} style={{fontSize:"10px",padding:"3px 8px",borderRadius:"5px",border:`1px solid ${C.border}`,background:"#fff",color:C.muted,cursor:"pointer",fontFamily:C.sans}}>로그아웃</button>
        </div>
      ):(
        <button onClick={signIn} disabled={loading} style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 12px",borderRadius:"6px",border:`1.5px solid ${C.border}`,background:"#fff",color:C.mid,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600,opacity:loading?0.6:1}}>
          <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          {loading?"연결 중...":"Google 로그인"}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 7-B. 토지이음 팝업 모달
// ═══════════════════════════════════════════════════════
function EumModal({onClose}){
  const ref=useRef();
  useEffect(()=>{
    const handler=e=>{ if(ref.current&&!ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown",handler);
    return()=>document.removeEventListener("mousedown",handler);
  },[onClose]);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div ref={ref} style={{background:"#fff",borderRadius:"12px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)",width:"min(900px,95vw)",height:"min(700px,90vh)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:"10px",background:C.cardAlt}}>
          <span style={{fontSize:"16px"}}>🗺️</span>
          <div style={{flex:1}}>
            <div style={{fontSize:"13px",fontWeight:700,color:C.text}}>토지이음 — 토지이용계획 확인</div>
            <div style={{fontSize:"10px",color:C.muted}}>eum.go.kr · 용도지역·지구, 공시지가 등 확인 가능</div>
          </div>
          <button onClick={onClose} style={{width:"28px",height:"28px",borderRadius:"50%",border:`1.5px solid ${C.border}`,background:"#fff",cursor:"pointer",fontSize:"16px",display:"flex",alignItems:"center",justifyContent:"center",color:C.mid,fontWeight:700,fontFamily:C.sans}}>×</button>
        </div>
        <iframe
          src="https://www.eum.go.kr/web/am/amMain.jsp"
          style={{flex:1,border:"none",width:"100%"}}
          title="토지이음"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
        <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`,fontSize:"9px",color:C.muted,textAlign:"center"}}>
          토지이음(eum.go.kr) 외부 서비스 연동 · 공시지가 및 용도지역 확인 후 시뮬레이터에 직접 입력하세요
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// § 7-C. 산출내역 탭 (계산 흐름 시각화)
// ═══════════════════════════════════════════════════════
function FlowArrow(){
  return <div style={{textAlign:"center",fontSize:"18px",color:C.muted,lineHeight:1,margin:"4px 0"}}>↓</div>;
}
function FlowBox({title,color,bg,items,note}){
  return(
    <div style={{border:`2px solid ${color}30`,borderRadius:"10px",background:bg||"#fff",overflow:"hidden",marginBottom:"6px"}}>
      <div style={{padding:"7px 13px",background:`${color}15`,borderBottom:`1px solid ${color}20`}}>
        <span style={{fontSize:"12px",fontWeight:700,color}}>{title}</span>
      </div>
      <div style={{padding:"10px 13px"}}>
        {items.map(([l,v,sub],i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"3px 0",borderBottom:i<items.length-1?`1px dashed ${C.faint}`:"none"}}>
            <span style={{fontSize:"11px",color:C.mid}}>{l}</span>
            <div style={{textAlign:"right"}}>
              <span style={{fontFamily:C.mono,fontSize:"13px",color,fontWeight:600}}>{v}</span>
              {sub&&<span style={{fontSize:"9px",color:C.muted,marginLeft:"5px"}}>{sub}</span>}
            </div>
          </div>
        ))}
        {note&&<div style={{marginTop:"7px",fontSize:"9px",color:C.muted,lineHeight:1.6,fontStyle:"italic"}}>{note}</div>}
      </div>
    </div>
  );
}

function CalcFlowTab({bldg,area,cost,rev,ana,anlys}){
  if(!bldg)return null;
  const c=cost, r=rev;
  const hasSale=(r?.saleIncome||0)>0;
  const exclR=n(bldg.par.exclR);
  const er=exclR/100;

  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"16px",alignItems:"start"}}>

      {/* ── 1. 면적 계산 흐름 ── */}
      <div>
        <div style={{fontSize:"13px",fontWeight:700,color:C.accent,marginBottom:"10px",paddingBottom:"6px",borderBottom:`2px solid ${C.accent}20`}}>
          📐 면적 산출 흐름
        </div>
        <FlowBox title="① 전용면적 입력" color={C.accent} items={[
          ["지상 전용면적 합계", fmt(area?.sa?.ex)+" ㎡", "직접 입력값"],
          ["지하 전용면적 합계", fmt(area?.sb?.ex)+" ㎡", "직접 입력값"],
        ]}/>
        <FlowArrow/>
        <FlowBox title="② 전용+공용 산출" color={C.accent} note={`산식: 전용 ÷ 전용률(${exclR}%) = 전용+공용`} items={[
          ["지상 전용+공용", fmt(area?.sa?.com)+" ㎡", `전용${fmt(area?.sa?.ex)} ÷ ${exclR}%`],
          ["지하 전용+공용", fmt(area?.sb?.com)+" ㎡"],
          ["공용면적(지상)", fmt(area?.sa?.co)+" ㎡", "전용+공용 − 전용"],
        ]}/>
        <FlowArrow/>
        <FlowBox title="③ 기전실·주차장 배분" color={C.accent} note="전체 전용+공용 합계 기준 비율로 층별 배분" items={[
          ["기전실 비율", n(bldg.par.mechR)+"%", "전체 전용+공용 대비"],
          ["기전실 총계", fmt(area?.mchTot)+" ㎡"],
          ["법정주차대수", (area?.legalP||0)+"대", "조례 자동계산"],
          ["주차장 총계", fmt(area?.pkTot)+" ㎡", "대수×배수×1대당면적"],
        ]}/>
        <FlowArrow/>
        <FlowBox title="④ 층합계 → 연면적" color={C.accent} items={[
          ["지상 층합계", fmt(area?.gfaA)+" ㎡", "전용+공용+기전실+주차"],
          ["지하 층합계", fmt(area?.gfaB)+" ㎡"],
          ["전체 연면적", fmt(area?.gfaT)+" ㎡"],
          ["용적률산정용", fmt(area?.gfaFar)+" ㎡", "지상 전용+공용만"],
        ]}/>
        <FlowArrow/>
        <FlowBox title="⑤ 건폐율·용적률 검토" color={C.green} items={[
          ["건폐율", fP(area?.bcr)+"%", `건축면적(${fmt(n(bldg.bldgArea))}) ÷ 대지면적(${fmt(area?.siteN)})`],
          ["용적률", fP(area?.far)+"%", "용산연면적 ÷ 대지면적"],
        ]}/>
      </div>

      {/* ── 2. 사업비 계산 흐름 ── */}
      <div>
        <div style={{fontSize:"13px",fontWeight:700,color:C.amber,marginBottom:"10px",paddingBottom:"6px",borderBottom:`2px solid ${C.amber}20`}}>
          💰 사업비 산출 흐름
        </div>
        <FlowBox title="① 토지비" color={C.amber} note={c?.landMult>1?`감정 추정가 = 입력단가 × ${c?.landMult}배`:"배수 1.0 = 입력단가 그대로"} items={[
          ["대지면적", fmt(area?.siteN)+" ㎡"],
          ["토지 단가 (입력)", fM(n(bldg.cost.landUnit))+" 원/㎡"],
          ["토지비 (장부)", fM(c?.land)+" 원"],
          ...(c?.landMult>1?[["감정 추정가", fM(c?.appraisalLand)+" 원", `×${c?.landMult}배`]]:[] ),
        ]}/>
        <FlowArrow/>
        <FlowBox title="② 공사비" color={C.amber} note="지상/지하 단가 분리 적용" items={[
          ["지상 공사비", fM(c?.cA)+" 원", `${fmt(area?.gfaA)}㎡ × ${fM(n(bldg.cost.constrAbove))}원/㎡`],
          ["지하 공사비", fM(c?.cB)+" 원", `${fmt(area?.gfaB)}㎡ × ${fM(n(bldg.cost.constrBelow))}원/㎡`],
          ["공사비 합계", fM(c?.constr)+" 원"],
        ]}/>
        <FlowArrow/>
        <FlowBox title="③ 간접비" color={C.amber} note="설계비는 공사비 규모별 대가기준 자동 적용" items={[
          ["설계비", fM(c?.design)+" 원", `${fP(c?.designRate)}% (대가기준 자동)`],
          ["감리비", fM(c?.superv)+" 원", `${fP(c?.supervRate)}%`],
          ["예비비", fM(c?.reserve)+" 원", `${bldg.cost.reserveR}%`],
          ["취득세", fM(c?.acquiTax)+" 원", `토지비 × ${ACQUI_TAX_RATE}%`],
          ["제부담금 합계", fM(c?.chgTotal)+" 원"],
        ]}/>
        <FlowArrow/>
        <FlowBox title="④ 기초 사업비 → TDC" color={C.amber} items={[
          ["기초 사업비", fM(c?.base)+" 원", "토지+공사+간접"],
          ["대출금액", fM(c?.loan)+" 원", `LTV ${bldg.cost.ltvR}%`],
          ["금융비용(이자)", fM(c?.finance)+" 원", `연${bldg.cost.loanR}% × ${bldg.cost.loanPeriod}개월`],
          ["TDC (총사업비)", fM(c?.tdc)+" 원", "기초+금융"],
          ["자기자본(Equity)", fM(c?.equity)+" 원", "TDC − 대출금"],
        ]}/>
        {/* 제부담금 세부 */}
        <div style={{marginTop:"10px",border:`1px solid ${C.amber}30`,borderRadius:"8px",overflow:"hidden"}}>
          <div style={{padding:"6px 12px",background:`${C.amber}10`,fontSize:"11px",fontWeight:700,color:C.amber}}>제부담금 세부 (의무/선택/비해당)</div>
          {Object.entries(INIT_CHARGES).map(([key,ci])=>{
            const cs=c?.charges?.[key]?.cs||getChargeStatus(key,bldg,area);
            const val=c?.charges?.[key]?.final||0;
            const statusColor=cs.status==="required"?C.red:cs.status==="optional"?C.amber:C.muted;
            return(
              <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 12px",borderBottom:`1px solid ${C.faint}`,background:"#fff"}}>
                <div>
                  <span style={{fontSize:"10px",fontWeight:600,color:C.mid}}>{ci.label}</span>
                  <span style={{marginLeft:"6px",fontSize:"9px",padding:"1px 5px",borderRadius:"3px",background:`${statusColor}15`,color:statusColor,fontWeight:600}}>{cs.label}</span>
                </div>
                <span style={{fontFamily:C.mono,fontSize:"11px",color:val>0?C.amber:C.muted}}>{val>0?fM(val)+" 원":"—"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3. 수익 계산 흐름 ── */}
      <div>
        <div style={{fontSize:"13px",fontWeight:700,color:C.green,marginBottom:"10px",paddingBottom:"6px",borderBottom:`2px solid ${C.green}20`}}>
          📈 수익 산출 흐름
        </div>
        {hasSale&&(
          <>
            <FlowBox title="① 분양 수입" color="#dc2626" bg="#fff9f9" items={[
              ["총 분양면적", fmt(r?.totalSaleArea)+" ㎡", "층합계 기준"],
              ["분양수입 합계", fM(r?.saleIncome)+" 원", "준공 시 일시수령"],
              ["배분 사업비", fM(r?.saleTDC)+" 원", `TDC × ${fP(pct(r?.totalSaleArea,area?.gfaA))}%`],
              ["분양 개발이익", fM(r?.saleProfit)+" 원"],
              ["사업수지율", fP(r?.saleSujiRate)+"%", "분양수입÷배분사업비"],
            ]}/>
            <FlowArrow/>
          </>
        )}
        <FlowBox title={hasSale?"② 임대 수입 (GI)":"① 임대 수입 (GI)"} color={C.green} note="용도별 임대수입 + 보증금 운용수익 합산" items={[
          ["연 임대수입", fM(r?.annual)+" 원"],
          ["보증금 합계", fM(r?.deposit)+" 원"],
          ["보증금 운용수익", fM(r?.depInc)+" 원", `전환율 ${bldg.rev.convR}%`],
          ["총수입 GI", fM(r?.gi)+" 원"],
        ]}/>
        <FlowArrow/>
        <FlowBox title={hasSale?"③ EGI (공실 차감)":"② EGI (공실 차감)"} color={C.green} note={`공실률 ${bldg.rev.vacancyR}% 적용`} items={[
          ["공실 차감", `▼ ${fM(r?.vacancy)}`+" 원"],
          ["유효총수입 EGI", fM(r?.egi)+" 원"],
        ]}/>
        <FlowArrow/>
        <FlowBox title={hasSale?"④ NOI 산출":"③ NOI 산출"} color={C.green} note="운영비 + 재산세 차감 → 순영업이익" items={[
          ["운영비 (OpEx)", `▼ ${fM(r?.opex)}`+" 원", `EGI × ${bldg.rev.opexR}%`],
          ["재산세 (건물분)", `▼ ${fM(r?.propTaxBldg)}`+" 원", "공사비 기준 근사"],
          ["재산세 (토지분)", `▼ ${fM(r?.propTaxLand)}`+" 원", "토지비 기준 근사"],
          ["NOI (순영업이익)", fM(r?.noi)+" 원 / 연"],
        ]}/>
        <FlowArrow/>
        <FlowBox title={hasSale?"⑤ 임대 수익률":"④ 임대 수익률"} color={C.green} items={[
          ["Cap Rate", fP(c?.tdc>0?r?.noi/c?.tdc*100:0)+"%", "NOI ÷ TDC"],
          ["임대 Cap Rate", fP(c?.tdc&&r?.rentTDC>0?r?.noi/r?.rentTDC*100:0)+"%", "NOI ÷ 임대배분TDC"],
        ]}/>
      </div>

      {/* ── 4. 사업성 분석 흐름 ── */}
      {ana&&(
        <div>
          <div style={{fontSize:"13px",fontWeight:700,color:C.purple,marginBottom:"10px",paddingBottom:"6px",borderBottom:`2px solid ${C.purple}20`}}>
            🔍 사업성 분석 흐름
          </div>
          <FlowBox title="① 현금흐름 구성" color={C.purple} note={hasSale?"0년차: −자기자본+분양수입 / 1~n년차: 임대NOI−원리금 / n년차말: +출구가치":"0년차: −자기자본 / 1~n년차: NOI−원리금 / n년차말: +출구가치"} items={[
            ["보유기간", anlys?.holdYears+"년"],
            ["임대료 상승", anlys?.rentEscR+"% / "+anlys?.rentEscPeriod+"년마다"],
            [hasSale?"0년차 CF (분양포함)":"0년차 CF", fM(ana?.cfs?.[0])+" 원"],
            ["1년차 임대 CF", fM(ana?.yearNOIs?.[0] - ana?.debtSvc)+" 원"],
            ["연 원리금", fM(ana?.debtSvc)+" 원", `대출×${anlys?.mortgageR}%`],
          ]}/>
          <FlowArrow/>
          <FlowBox title="② 출구가치 (Terminal Value)" color={C.purple} note={`NOI ÷ 출구Cap Rate(${anlys?.exitCapR}%) = 매각 추정가`} items={[
            ["출구 Cap Rate", anlys?.exitCapR+"%"],
            ["출구가치 (TV)", fM(ana?.tv)+" 원"],
            ["잔여 대출 상환", fM(ana?.rentLoan)+" 원"],
            ["순 출구 CF", fM(ana?.tv-ana?.rentLoan)+" 원"],
          ]}/>
          <FlowArrow/>
          <FlowBox title="③ NPV / IRR 산출" color={C.purple} note={`할인율 ${anlys?.discountR}% 적용. IRR = NPV=0이 되는 할인율`} items={[
            ["NPV", fM(ana?.NPV)+" 원", ana?.NPV>0?"✓ 타당":"✗ 재검토"],
            ["통합 IRR", ana?.IRR!==null?fP(ana?.IRR)+"%":"산출불가", `기준 ${anlys?.discountR}%`],
            ["투자회수기간", ana?.payback!==null?fP(ana?.payback,1)+"년":"—"],
          ]}/>
          <FlowArrow/>
          <FlowBox title="④ B/C 분석" color={C.purple} note={`편익 = ${anlys?.bcYears}년 NOI PV + 출구가치 PV / 비용 = 자기자본`} items={[
            ["B/C Ratio", fP(ana?.bc,2), ana?.bc>=1.2?"✓ 우수":ana?.bc>=1?"△ 타당":"✗ 미달"],
          ]}/>
          <FlowArrow/>
          <FlowBox title="⑤ 민감도 분석 요약" color={C.purple} note="NOI ±20% 변동 시 통합IRR 범위" items={
            ana?.sens?[
              ["NOI −20%", ana.sens[0]?.irr!==null?fP(ana.sens[0].irr*100)+"%":"—"],
              ["NOI 기준", ana.sens[2]?.irr!==null?fP(ana.sens[2].irr*100)+"%":"—"],
              ["NOI +20%", ana.sens[4]?.irr!==null?fP(ana.sens[4].irr*100)+"%":"—"],
            ]:[]
          }/>
        </div>
      )}
    </div>
  );
}

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
function ChargRow({chargeKey,chargeRef,chargeResult,override,dispatch,bldgId,bldg,area}){
  const D=(type,p)=>dispatch({type,p});
  const cs=chargeResult?.cs||getChargeStatus(chargeKey,bldg,area);
  const isEnabled=chargeRef.enabled;
  const autoVal=chargeResult?.auto||0;
  const finalVal=chargeResult?.final||0;
  const isOverridden=chargeResult?.overridden||false;
  const isSpecial=chargeKey==="develop";
  const isNA=cs.status==="na";
  const isRequired=cs.status==="required";

  return(
    <div style={{padding:"10px 13px",borderBottom:`1px solid ${C.faint}`,background:isNA?C.cardAlt:isEnabled?"#fff":C.cardAlt,opacity:isNA?0.6:1}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:"10px",flexWrap:"wrap"}}>
        {/* 활성 토글 + 의무/선택/비해당 배지 */}
        <div style={{display:"flex",alignItems:"center",gap:"7px",minWidth:"220px",flex:"0 0 auto"}}>
          {!isNA&&(
            <button onClick={()=>D("CHARGE_REF",{key:chargeKey,k:"enabled",v:!isEnabled})}
              style={{width:"32px",height:"18px",borderRadius:"9px",border:"none",cursor:isRequired?"not-allowed":"pointer",background:isEnabled?C.green:C.faint,transition:"background 0.2s",flexShrink:0,position:"relative"}}>
              <div style={{width:"14px",height:"14px",borderRadius:"50%",background:"#fff",position:"absolute",top:"2px",left:isEnabled?"16px":"2px",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
            </button>
          )}
          {isNA&&<div style={{width:"32px",flexShrink:0}}/>}
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:"2px"}}>
              <span style={{fontSize:"12px",fontWeight:600,color:isNA?C.muted:isEnabled?C.text:C.muted}}>{chargeRef.label}</span>
              <span style={{fontSize:"8px",padding:"1px 5px",borderRadius:"3px",fontWeight:700,background:`${cs.color}15`,color:cs.color}}>{cs.label}</span>
              {isRequired&&<span style={{fontSize:"8px",color:C.red}}>🔴고정</span>}
            </div>
            <div style={{fontSize:"9px",color:C.purple}}>{chargeRef.law}</div>
            <div style={{fontSize:"9px",color:C.muted,marginTop:"1px"}}>{cs.reason}</div>
          </div>
        </div>

        {/* 자동계산 값 */}
        <div style={{flex:1,minWidth:"140px"}}>
          {isNA?(
            <div style={{fontSize:"10px",color:C.muted,fontStyle:"italic"}}>비해당 — 이 사업에 적용되지 않습니다</div>
          ):isEnabled&&!isSpecial?(
            <div style={{fontSize:"11px",color:C.muted}}>
              자동계산: <span style={{fontFamily:C.mono,color:isOverridden?C.muted:C.teal,fontWeight:isOverridden?400:700,textDecoration:isOverridden?"line-through":"none"}}>{fM(autoVal)} 원</span>
            </div>
          ):isEnabled&&isSpecial?(
            <div style={{display:"flex",gap:"8px",alignItems:"center",flexWrap:"wrap"}}>
              <TInput label="준공 후 토지가액 (원/㎡)" value={override?.developLandUnit||""} onChange={v=>D("CST",{id:bldgId,k:"developLandUnit",v})} unit="원/㎡" small/>
              <div style={{fontSize:"10px",color:C.muted,marginTop:"16px"}}>자동: <span style={{fontFamily:C.mono,color:C.teal,fontWeight:700}}>{fM(autoVal)}</span></div>
            </div>
          ):(
            <div style={{fontSize:"10px",color:C.muted}}>비활성 — 토글로 활성화</div>
          )}
        </div>

        {/* 수동입력 */}
        {isEnabled&&!isNA&&(
          <div style={{minWidth:"160px",flex:"0 0 auto"}}>
            <TInput label={`직접입력 ${isOverridden?"★ 적용중":"(자동값 사용)"}`} value={override?.[chargeKey]||""} onChange={v=>D("CO",{id:bldgId,k:chargeKey,v})} unit="원" small warn={isOverridden} placeholder={autoVal>0?`자동: ${fM(autoVal)}`:"0"}/>
            {isOverridden&&<button onClick={()=>D("CO",{id:bldgId,k:chargeKey,v:""})} style={{fontSize:"9px",color:C.red,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0",fontFamily:C.sans}}>× 자동으로 되돌리기</button>}
          </div>
        )}

        {/* 최종값 */}
        {isEnabled&&!isNA&&(
          <div style={{textAlign:"right",minWidth:"90px",flex:"0 0 auto"}}>
            <div style={{fontSize:"9px",color:C.muted}}>최종 적용</div>
            <div style={{fontFamily:C.mono,fontSize:"13px",color:isOverridden?C.amber:C.teal,fontWeight:700}}>{fM(finalVal)}</div>
          </div>
        )}
      </div>
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
function CostTab({bldg,dispatch,area,refs,onEum}){
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
        <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",marginBottom:"8px"}}>
          <button onClick={onEum}
            style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 12px",borderRadius:"7px",border:`1.5px solid #0ea5e9`,background:"#f0f9ff",color:"#0369a1",fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:C.sans,boxShadow:C.shadow}}>
            🗺️ 토지이음에서 가격 확인
          </button>
        </div>
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <TInput label="토지 단가 (원/㎡)" value={c.landUnit} onChange={uC("landUnit")} unit="원/㎡"/>
          <div>
            <div style={{fontSize:"11px",color:C.muted,marginBottom:"4px",fontWeight:600}}>
              감정가 배수 <span style={{fontSize:"9px",color:C.teal,background:C.tealBg,padding:"1px 5px",borderRadius:"3px"}}>추정배수</span>
            </div>
            <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
              <input value={c.landMult} onChange={e=>uC("landMult")(e.target.value)}
                style={{width:"65px",border:`1.5px solid ${C.border}`,borderRadius:"7px",padding:"7px 10px",fontSize:"13px",fontFamily:C.mono,outline:"none",textAlign:"right"}}/>
              <span style={{fontSize:"10px",color:C.muted}}>배</span>
            </div>
            <div style={{fontSize:"9px",color:C.muted,marginTop:"3px"}}>입력단가 × 배수 = 감정추정가</div>
          </div>
          <KpiCard label="대지면적" value={fmt(area.siteN)}/>
          <KpiCard label="토지비 (입력기준)" value={fM(cc.land)} unit="" hi sub={fmt(cc.land,0)+" 원"}/>
          {n(c.landMult)>1&&(
            <KpiCard label={`감정 추정 토지가 (×${c.landMult})`} value={fM(cc.appraisalLand)} unit="" ok2 sub="참고값 (사업비 미반영)"/>
          )}
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
          🔴 <strong>의무</strong>: 규모·용도상 반드시 납부 (토글 비활성화 불가) &nbsp;
          🟡 <strong>선택</strong>: 해당 여부 확인 후 활성화 &nbsp;
          ⬜ <strong>비해당</strong>: 이 사업 비적용
        </div>
        <div style={{border:`1.5px solid ${C.border}`,borderRadius:"9px",overflow:"hidden"}}>
          {Object.keys(INIT_CHARGES).map(key=>(
            <ChargRow key={key} chargeKey={key} chargeRef={refs.charges[key]}
              chargeResult={cc.charges[key]} override={{...bldg.cost.chargeOverrides, developLandUnit:bldg.cost.developLandUnit}}
              dispatch={dispatch} bldgId={bldg.id} bldg={bldg} area={area}/>
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
// ════════════════════════════════════════════════════════════════
// § APT-1. 공동주택 기준 상수
// ════════════════════════════════════════════════════════════════

// 업로드된 면적표를 기본값으로 설정
const DEFAULT_APT_TYPES = [
  { typeLabel:"39", units:168, exclArea:39.96, coreCommon:13.14, wallCommon:4.51, amenity:2.32, mechElec:4.31, ugParking:28.86, saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"" },
  { typeLabel:"49", units:188, exclArea:49.96, coreCommon:14.14, wallCommon:5.51, amenity:2.90, mechElec:5.39, ugParking:36.08, saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"" },
  { typeLabel:"59", units:445, exclArea:59.96, coreCommon:16.82, wallCommon:5.83, amenity:3.48, mechElec:6.47, ugParking:43.30, saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"" },
  { typeLabel:"74", units:102, exclArea:74.96, coreCommon:20.22, wallCommon:6.73, amenity:4.35, mechElec:8.08, ugParking:54.13, saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"" },
  { typeLabel:"84", units:184, exclArea:84.96, coreCommon:21.97, wallCommon:7.28, amenity:4.93, mechElec:9.16, ugParking:61.36, saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"" },
];

// 설계비 요율 — 건축사협회 건축설계 대가기준 (2종중급)
// 근거: 국토부 고시 「엔지니어링사업 대가 등에 관한 기준」
const APT_DESIGN_BRACKETS = [
  { upTo:5e9,      rate:5.47, label:"50억 이하",   kind:"2종중급" },
  { upTo:1e10,     rate:4.85, label:"50~100억",    kind:"2종중급" },
  { upTo:2e10,     rate:4.42, label:"100~200억",   kind:"2종중급" },
  { upTo:5e10,     rate:3.96, label:"200~500억",   kind:"2종중급" },
  { upTo:1e11,     rate:3.70, label:"500~1000억",  kind:"2종중급" },
  { upTo:Infinity, rate:3.48, label:"1000억 초과", kind:"2종중급" },
];
// 감리비 요율 — 3종중급
const APT_SUPERV_BRACKETS = [
  { upTo:5e9,      rate:7.50, label:"50억 이하",   kind:"3종중급" },
  { upTo:1e10,     rate:6.20, label:"50~100억",    kind:"3종중급" },
  { upTo:2e10,     rate:5.55, label:"100~200억",   kind:"3종중급" },
  { upTo:5e10,     rate:5.04, label:"200~500억",   kind:"3종중급" },
  { upTo:1e11,     rate:4.73, label:"500~1000억",  kind:"3종중급" },
  { upTo:Infinity, rate:4.45, label:"1000억 초과", kind:"3종중급" },
];

function getAptDesignRate(base) {
  for(const b of APT_DESIGN_BRACKETS) if(base <= b.upTo) return b.rate;
  return APT_DESIGN_BRACKETS[APT_DESIGN_BRACKETS.length-1].rate;
}
function getAptSupervRate(base) {
  for(const b of APT_SUPERV_BRACKETS) if(base <= b.upTo) return b.rate;
  return APT_SUPERV_BRACKETS[APT_SUPERV_BRACKETS.length-1].rate;
}

// ════════════════════════════════════════════════════════════════
// § APT-2. 공동주택 초기 상태
// ════════════════════════════════════════════════════════════════
let _auid=1000;
const auid=()=>++_auid;

const mkAptType=(overrides={})=>({
  id:auid(), typeLabel:"59", units:0,
  exclArea:59.96, coreCommon:16.82, wallCommon:5.83,
  amenity:3.48, mechElec:6.47, ugParking:43.30,
  saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"",
  ...overrides,
});
const mkNonResi=(overrides={})=>({
  id:auid(), label:"근린생활시설", floor:"1층",
  exclArea:"", commonArea:"",
  saleMode:"sale", salePrice:"", rentUnit:"", depositUnit:"",
  ...overrides,
});

const initAptState={
  projectName:"",
  siteInfo:{
    location:"", zoneType:"제3종일반주거",
    siteArea:"", siteAreaActual:"", bldgArea:"",
    floorsAbove:"", floorsBelow:"",
    structure:"RC조", heating:"개별난방",
  },
  types: DEFAULT_APT_TYPES.map(t=>({...t, id:auid()})),
  nonResi:[
    mkNonResi({label:"근린생활시설", floor:"1~2층"}),
  ],
  parking:{
    legalPerUnit:"1.0",       // 세대당 법정 — 서울시 주차장조례 별표1
    legalNonResiM2:"134",     // 근생: 시설면적 134㎡당 1대
    planMult:"1.3",           // 계획배수 (법정의 1.3배)
    areaPerSlot:"25.0",       // 1대당 소요면적 ㎡
    commercialSlots:"0",      // 공영/별도 주차장 대수
    commercialSaleMode:"none",// "none"|"sale"|"rent"
    commercialSaleIncome:"0", // 공영 매각수입 천원
    commercialRentIncome:"0", // 공영 월 임대수입 천원
  },
  cost:{
    // 토지비
    landPubPrice:"",         // 공시지가 원/㎡ (토지이음 확인)
    landCorrFactor:"2.185",  // 보정배율 (샘플 기준)
    landPubYear:"2025",      // 공시지가 기준년도
    // 공사비 단가 (천원/㎡) — 2024 공공건축물 공사비 가이드라인
    aptAbove:"2209",         // 공동주택 지상
    corrAptAbove:"1.1",      // 보정계수
    aptBelow:"1144",         // 공동주택 지하
    corrAptBelow:"1.1",
    nonResiAbove:"1921",     // 근린생활시설 지상 (평균)
    corrNonResi:"1.0",
    parkingAbove:"1918",     // 주차장
    corrParking:"1.0",
    // 간접비 요율 (직접공사비 기준, 보정 포함)
    surveyR:"1.0",           // 조사·측량비 %
    corrIndirect:"1.1",      // 간접비 보정계수
    designROverride:"",      // 빈값=자동(대가기준)
    supervROverride:"",      // 빈값=자동(대가기준)
    facilR:"0.23",           // 시설부대비 %
    // 상하수도 인입비
    waterPerUnit:"531930",   // 상수도: 세대당 원 (안산시 2024)
    sewerPerM3:"900480",     // 하수도: 오수발생량 ㎥당 원
    sewagePerPerson:"0.28",  // 오수발생량 ㎥/일/인 (하수정비기본계획)
    personsPerUnit:"2.5",    // 세대당 거주인원
    // 부대비 (토지+공사+간접 합계 기준)
    mgmtR:"5.73",            // 일반관리비 % (인천도시공사 기준)
    salesR:"0.27",           // 판매비 % (인천도시공사 기준)
    // 예비비
    reserveR:"10.0",         // 기준사업비의 10%
    // 금융
    loanR:"4.5",             // 연 금리 %
    constPeriod:"3",         // 공사기간 년
    startYear:"2025",        // 사업 시작년도
  },
  revenue:{
    contractR:"10",  // 계약금 % — 분양 스케줄
    midR:"50",       // 중도금 %
    balanceR:"40",   // 잔금 %
    convR:"4.5",     // 보증금 전환율 % (임대 시)
    vacancyR:"5",    // 공실률 % (임대 시)
  },
  anlys:{
    discountR:"4.5",  // 할인율 % (= 금리)
  },
  aptActiveTab:"building",
};

// ════════════════════════════════════════════════════════════════
// § APT-3. 공동주택 계산 함수
// ════════════════════════════════════════════════════════════════
function calcAptArea(apt){
  const{types,nonResi,parking:pk}=apt;

  // 타입별 면적 산출
  const typeCalcs=types.map(t=>{
    const u=+t.units||0;
    const excl=+t.exclArea||0;
    const core=+t.coreCommon||0;
    const wall=+t.wallCommon||0;
    const residComm=core+wall;
    const supply=excl+residComm;          // 공급면적
    const amen=+t.amenity||0;
    const mech=+t.mechElec||0;
    const otherComm=amen+mech;            // 기타공용
    const total=supply+otherComm;         // 계
    const ugPark=+t.ugParking||0;
    const contract=total+ugPark;          // 계약면적
    const pct=0;                          // 세대 비율(합산 후 계산)
    return{
      ...t,
      residComm,supply,otherComm,total,ugPark,contract,
      tExcl:excl*u, tCore:core*u, tWall:wall*u, tResidComm:residComm*u,
      tSupply:supply*u, tAmen:amen*u, tMech:mech*u, tOtherComm:otherComm*u,
      tTotal:total*u, tUgPark:ugPark*u, tContract:contract*u, units:u,
    };
  });

  const totalUnits=typeCalcs.reduce((s,t)=>s+t.units,0);
  // 비율 계산
  typeCalcs.forEach(t=>{ t.pct=totalUnits>0?t.units/totalUnits*100:0; });

  const sumT=k=>typeCalcs.reduce((s,t)=>s+t[k],0);
  const tExcl=sumT("tExcl"), tSupply=sumT("tSupply"), tTotal=sumT("tTotal");
  const tUgPark=sumT("tUgPark"), tContract=sumT("tContract");

  // 비주거 면적
  const nonResiCalcs=nonResi.map(nr=>({
    ...nr,
    excl:+(nr.exclArea)||0,
    comm:+(nr.commonArea)||0,
    tot:(+(nr.exclArea)||0)+(+(nr.commonArea)||0),
  }));
  const nrExcl=nonResiCalcs.reduce((s,r)=>s+r.excl,0);
  const nrTot=nonResiCalcs.reduce((s,r)=>s+r.tot,0);

  // 주차대수 산정
  const legalResid=Math.ceil(totalUnits*(+(pk.legalPerUnit)||1));
  const legalNR=+(pk.legalNonResiM2)||134;
  const legalNonResi=legalNR>0?Math.ceil(nrExcl/legalNR):0;
  const legalTotal=legalResid+legalNonResi;
  const planMult=+(pk.planMult)||1.3;
  const planTotal=Math.ceil(legalTotal*planMult);
  const commSlots=+(pk.commercialSlots)||0;
  const allSlots=planTotal+commSlots;
  const areaPerSlot=+(pk.areaPerSlot)||25;
  const pkAreaTotal=allSlots*areaPerSlot;

  // 연면적 집계
  // 지상: 주거지상(tTotal) + 비주거(nrTot)
  const gfaAboveResid=tTotal;
  const gfaAboveNR=nrTot;
  const gfaAbove=gfaAboveResid+gfaAboveNR;
  // 지하: 지하주차장(tUgPark) + 계획주차(planTotal × area/slot)
  const gfaBelow=tUgPark+planTotal*areaPerSlot;
  const gfaTotal=gfaAbove+gfaBelow;
  const gfaFar=gfaAbove; // 용적률산정용

  const sN=+(apt.siteInfo.siteAreaActual)||+(apt.siteInfo.siteArea)||0;
  const bN=+(apt.siteInfo.bldgArea)||0;
  const bcr=sN>0?bN/sN*100:0;
  const far=sN>0?gfaFar/sN*100:0;

  return{
    typeCalcs,nonResiCalcs,
    totalUnits,tExcl,tSupply,tTotal,tUgPark,tContract,
    nrExcl,nrTot,
    legalResid,legalNonResi,legalTotal,planTotal,commSlots,allSlots,pkAreaTotal,
    gfaAboveResid,gfaAboveNR,gfaAbove,gfaBelow,gfaTotal,gfaFar,
    sN,bcr,far,
  };
}

function calcAptCost(apt,area){
  const c=apt.cost;
  const sN=area.sN;

  // 토지비 (공시지가×면적×보정)
  const pubPrice=+(c.landPubPrice)||0;
  const corr=+(c.landCorrFactor)||1;
  const land=pubPrice*sN*corr/1000; // 천원

  // 직접공사비 (천원)
  const aptA=area.gfaAboveResid*(+(c.aptAbove)||0)*(+(c.corrAptAbove)||1);
  const aptB=area.gfaBelow*(+(c.aptBelow)||0)*(+(c.corrAptBelow)||1);
  const nrA=area.gfaAboveNR*(+(c.nonResiAbove)||0)*(+(c.corrNonResi)||1);
  const pkA=area.pkAreaTotal*(+(c.parkingAbove)||0)*(+(c.corrParking)||1);
  const directConstr=aptA+aptB+nrA+pkA;

  // 간접비 (직접공사비×요율×보정)
  const corrI=+(c.corrIndirect)||1.1;
  const baseI=directConstr;
  const designRate=c.designROverride?+(c.designROverride):getAptDesignRate(baseI*1000);
  const supervRate=c.supervROverride?+(c.supervROverride):getAptSupervRate(baseI*1000);
  const survey=baseI*(+(c.surveyR)||1)/100*corrI;
  const design=baseI*designRate/100*corrI;
  const superv=baseI*supervRate/100*corrI;
  const facil=baseI*(+(c.facilR)||0.23)/100*corrI;
  // 상하수도 (원→천원)
  const water=area.totalUnits*(+(c.waterPerUnit)||0)/1000;
  const sewagePpl=area.totalUnits*(+(c.personsPerUnit)||2.5);
  const sewageM3=sewagePpl*(+(c.sewagePerPerson)||0.28);
  const sewer=sewageM3*(+(c.sewerPerM3)||0)/1000;
  const indirect=survey+design+superv+facil+water+sewer;

  // 부대비 (토지+공사+간접 합계 기준)
  const baseOther=land+directConstr+indirect;
  const mgmt=baseOther*(+(c.mgmtR)||5.73)/100;
  const sales=baseOther*(+(c.salesR)||0.27)/100;
  const other=mgmt+sales;

  // 예비비
  const baseCost=land+directConstr+indirect+other;
  const reserve=baseCost*(+(c.reserveR)||10)/100;

  // 총사업비 (금융 전)
  const tdc=baseCost+reserve;

  // 금융비용 (평균 잔액 기준 단순화)
  const period=+(c.constPeriod)||3;
  const loanR=+(c.loanR)||4.5;
  const finance=tdc*(loanR/100)*period/2;

  const tdcTotal=tdc+finance;

  return{
    land,aptA,aptB,nrA,pkA,directConstr,
    survey,design,designRate,superv,supervRate,facil,water,sewer,indirect,
    mgmt,sales,other,baseCost,reserve,tdc,finance,tdcTotal,
    corrI,baseI,period,loanR,
  };
}

function calcAptRevenue(apt,area,cost){
  const{revenue:r}=apt;
  const{typeCalcs,nonResiCalcs}=area;

  // 타입별 수입
  let aptSale=0, aptRentAnn=0;
  const typeRevs=typeCalcs.map(t=>{
    if(t.saleMode==="sale"){
      const inc=t.tSupply*(+(t.salePrice)||0); // 천원 (천원/㎡ × ㎡)
      aptSale+=inc;
      return{...t, inc, annInc:0};
    } else {
      const ann=t.tExcl*(+(t.rentUnit)||0)*12/1000; // 천원
      const dep=t.tExcl*(+(t.depositUnit)||0)/1000;
      const depInc=dep*(+(r.convR)||4.5)/100;
      const gi=(ann+depInc)*(1-(+(r.vacancyR)||5)/100);
      aptRentAnn+=gi;
      return{...t, inc:0, annInc:gi, dep};
    }
  });

  // 비주거 수입
  let nrSale=0, nrRentAnn=0;
  const nrRevs=nonResiCalcs.map(nr=>{
    if(nr.saleMode==="sale"){
      const inc=nr.excl*(+(nr.salePrice)||0); // 천원
      nrSale+=inc;
      return{...nr, inc, annInc:0};
    } else {
      const ann=nr.excl*(+(nr.rentUnit)||0)*12/1000;
      const dep=nr.excl*(+(nr.depositUnit)||0)/1000;
      const depInc=dep*(+(r.convR)||4.5)/100;
      const gi=(ann+depInc)*(1-(+(r.vacancyR)||5)/100);
      nrRentAnn+=gi;
      return{...nr, inc:0, annInc:gi, dep};
    }
  });

  // 공영주차장 수입
  let pkInc=0;
  const pk=apt.parking;
  if(pk.commercialSaleMode==="sale") pkInc=+(pk.commercialSaleIncome)||0;
  else if(pk.commercialSaleMode==="rent") pkInc=(+(pk.commercialRentIncome)||0)*12;

  const totalSale=aptSale+nrSale;
  const totalRentAnn=aptRentAnn+nrRentAnn;
  const totalRevenue=totalSale+(pkInc); // 분양수입 합계 (임대는 별도)

  // 분양 스케줄 (천원)
  const contractAmt=totalSale*(+(r.contractR)||10)/100;
  const midAmt=totalSale*(+(r.midR)||50)/100;
  const balanceAmt=totalSale*(+(r.balanceR)||40)/100;

  return{
    typeRevs,nrRevs,
    aptSale,aptRentAnn,nrSale,nrRentAnn,pkInc,
    totalSale,totalRentAnn,totalRevenue,
    contractAmt,midAmt,balanceAmt,
  };
}

function calcAptAnalysis(apt,cost,rev){
  const dr=(+(apt.anlys.discountR)||4.5)/100;
  const period=+(apt.cost.constPeriod)||3;
  const{tdc,land,directConstr,indirect,other,reserve,loanR}=cost;
  const{totalSale,contractAmt,midAmt,balanceAmt,pkInc,totalRentAnn}=rev;

  // 연도별 현금흐름 (Y=0~period)
  const nonLandCost=directConstr+indirect+other+reserve; // 금융비용 제외
  const cfs=[];
  for(let y=0;y<=period;y++){
    let out=0,inc=0;
    if(y===0){
      out=land;
      inc=contractAmt;
    } else if(y<period){
      out=nonLandCost/period;
      inc=midAmt/(period-1||1);
    } else {
      out=0;
      inc=balanceAmt+pkInc;
    }
    cfs.push({y, out, inc, net:inc-out});
  }

  // 연도별 금융비용 추가
  let cumDebt=0;
  cfs.forEach((cf,i)=>{
    cumDebt+=cf.out-cf.inc;
    cf.debt=Math.max(0,cumDebt);
    cf.fin=i>0?cf.debt*(loanR/100):0;
    cf.netFin=cf.net-cf.fin;
  });

  const cfNets=cfs.map(c=>c.net);
  const cfNetsFin=cfs.map(c=>c.netFin);

  // NPV / IRR (세전, 금융비용 제외)
  const NPV=calcNPV(cfNets,dr);
  const IRR=calcIRR(cfNets);

  // NPV (금융비용 포함)
  const NPVfin=calcNPV(cfNetsFin,dr);

  // 수익성지수 PI
  let pvOut=0,pvInc=0;
  cfs.forEach((cf,y)=>{ pvOut+=cf.out/(1+dr)**y; pvInc+=cf.inc/(1+dr)**y; });
  const PI=pvOut>0?pvInc/pvOut:0;

  // 단순 지표
  const profit=totalSale-tdc;
  const profitR=tdc>0?profit/tdc*100:0;
  const totalCostIncFin=tdc+cost.finance;
  const profitRFin=totalCostIncFin>0?(totalSale-totalCostIncFin)/totalCostIncFin*100:0;

  return{
    cfs,NPV,IRR:IRR!==null?IRR*100:null,NPVfin,PI,
    pvOut,pvInc,profit,profitR,profitRFin,
    totalRevenue:totalSale,period,dr,
    totalRentAnn,
  };
}

// ════════════════════════════════════════════════════════════════
// § APT-4. 공동주택 상태 관리 (별도 useReducer)
// ════════════════════════════════════════════════════════════════
function aptReducer(state,{type,p}){
  const upTypes=fn=>({...state,types:state.types.map(t=>t.id===p.id?fn(t):t)});
  const upNR=fn=>({...state,nonResi:state.nonResi.map(r=>r.id===p.id?fn(r):r)});
  switch(type){
    case"APT_PROJ":    return{...state,projectName:p};
    case"APT_SITE":    return{...state,siteInfo:{...state.siteInfo,...p}};
    case"APT_COST":    return{...state,cost:{...state.cost,...p}};
    case"APT_REV":     return{...state,revenue:{...state.revenue,...p}};
    case"APT_ANLYS":   return{...state,anlys:{...state.anlys,...p}};
    case"APT_PK":      return{...state,parking:{...state.parking,...p}};
    case"APT_TAB":     return{...state,aptActiveTab:p};
    case"APT_ADD_TYPE":return{...state,types:[...state.types,mkAptType()]};
    case"APT_DEL_TYPE":return{...state,types:state.types.filter(t=>t.id!==p.id)};
    case"APT_TYPE":    return upTypes(t=>({...t,[p.k]:p.v}));
    case"APT_ADD_NR":  return{...state,nonResi:[...state.nonResi,mkNonResi()]};
    case"APT_DEL_NR":  return{...state,nonResi:state.nonResi.filter(r=>r.id!==p.id)};
    case"APT_NR":      return upNR(r=>({...r,[p.k]:p.v}));
    case"APT_RESET_TYPES":return{...state,types:DEFAULT_APT_TYPES.map(t=>({...t,id:auid()}))};
    default: return state;
  }
}

// ════════════════════════════════════════════════════════════════
// § APT-5. 공동주택 UI 원자 컴포넌트
// ════════════════════════════════════════════════════════════════
function AInput({label,value,onChange,unit,placeholder="",small,lawNote,readOnly,warn}){
  const[focus,setFocus]=useState(false);
  return(
    <div>
      {label&&<div style={{fontSize:"11px",color:C.muted,marginBottom:"3px",fontWeight:600,display:"flex",alignItems:"center",gap:"4px",flexWrap:"wrap"}}>
        {label}
        {lawNote&&<span style={{fontSize:"8px",color:C.purple,background:C.purpleBg,padding:"1px 4px",borderRadius:"3px",fontWeight:500,whiteSpace:"nowrap"}}>{lawNote}</span>}
      </div>}
      <div style={{position:"relative"}}>
        <input value={value??""} readOnly={readOnly} placeholder={placeholder}
          onChange={onChange?e=>onChange(e.target.value):undefined}
          onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
          style={{width:"100%",boxSizing:"border-box",
            background:readOnly?C.cardAlt:"#fff",
            border:`1.5px solid ${warn?C.amber:focus?C.accent:C.border}`,
            borderRadius:"6px",color:readOnly?C.muted:C.text,
            padding:unit?(small?"4px 30px 4px 8px":"6px 32px 6px 9px"):(small?"4px 8px":"6px 9px"),
            fontSize:small?"10px":"12px",fontFamily:C.mono,outline:"none",
            boxShadow:focus?`0 0 0 3px ${C.accentBg}`:C.shadow,transition:"all 0.15s"}}/>
        {unit&&<span style={{position:"absolute",right:"8px",top:"50%",transform:"translateY(-50%)",fontSize:"9px",color:C.muted,pointerEvents:"none"}}>{unit}</span>}
      </div>
    </div>
  );
}

function ModeTag({label,color}){ return <span style={{fontSize:"8px",padding:"1px 5px",borderRadius:"3px",background:`${color}15`,color,fontWeight:700,whiteSpace:"nowrap"}}>{label}</span>; }

// ════════════════════════════════════════════════════════════════
// § APT-6. 건축개요 탭
// ════════════════════════════════════════════════════════════════
function AptBuildingTab({apt,dispatch,area,onEum}){
  const D=(t,p)=>dispatch({type:t,p});
  const si=apt.siteInfo;
  const pk=apt.parking;

  return(
    <div>
      {/* 프로젝트 기본정보 */}
      <Card title="프로젝트 기본정보" tag="PROJECT INFO" accentBar={C_apt}>
        <G cols="repeat(auto-fit,minmax(160px,1fr))">
          <AInput label="프로젝트명" value={apt.projectName} onChange={v=>D("APT_PROJ",v)} unit="" mono={false} placeholder="사업명 입력"/>
          <AInput label="대지위치" value={si.location} onChange={v=>D("APT_SITE",{location:v})} unit="" mono={false} placeholder="경기도 안산시..."/>
          <div>
            <div style={{fontSize:"11px",color:C.muted,marginBottom:"3px",fontWeight:600}}>
              용도지역 <ModeTag label="기준탭 연동" color={C.purple}/>
            </div>
            <select value={si.zoneType} onChange={e=>D("APT_SITE",{zoneType:e.target.value})}
              style={{width:"100%",padding:"6px 9px",border:`1.5px solid ${C.border}`,borderRadius:"6px",fontSize:"12px",fontFamily:C.sans,background:"#fff",outline:"none"}}>
              {Object.keys(INIT_ZONE_STDS).map(z=><option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </G>
        <G cols="repeat(auto-fit,minmax(140px,1fr))" mt="10px">
          <AInput label="대지면적" value={si.siteArea} onChange={v=>D("APT_SITE",{siteArea:v})} unit="㎡"/>
          <AInput label="실사용 대지면적" value={si.siteAreaActual} onChange={v=>D("APT_SITE",{siteAreaActual:v})} unit="㎡" placeholder="사업에 활용되는 실면적"/>
          <AInput label="건축면적" value={si.bldgArea} onChange={v=>D("APT_SITE",{bldgArea:v})} unit="㎡"/>
          <AInput label="지상층수" value={si.floorsAbove} onChange={v=>D("APT_SITE",{floorsAbove:v})} unit="층"/>
          <AInput label="지하층수" value={si.floorsBelow} onChange={v=>D("APT_SITE",{floorsBelow:v})} unit="층"/>
          <AInput label="구조형식" value={si.structure} onChange={v=>D("APT_SITE",{structure:v})} unit="" mono={false} placeholder="RC조"/>
          <AInput label="난방방식" value={si.heating} onChange={v=>D("APT_SITE",{heating:v})} unit="" mono={false} placeholder="개별난방"/>
        </G>
        {/* 건폐율/용적률 */}
        {area.sN>0&&(
          <div style={{marginTop:"10px",display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
            {[["건폐율",area.bcr],[" 용적률",area.far]].map(([l,v])=>{
              const zs=INIT_ZONE_STDS[si.zoneType]||{};
              const max=l.includes("건폐율")?zs.maxBcr:zs.maxFar;
              const ok=max?v<=max:true;
              return <div key={l} style={{display:"inline-flex",alignItems:"center",gap:"5px",padding:"3px 8px",borderRadius:"6px",background:ok?C.greenBg:C.redBg,border:`1px solid ${ok?C.green+"40":C.red+"40"}`,fontSize:"11px",color:ok?C.green:C.red,fontWeight:600}}>
                {l}: <span style={{fontFamily:C.mono}}>{v.toFixed(1)}%</span>
                {max&&<span style={{opacity:0.7,fontWeight:400}}>/ {max}%</span>}
                <span>{ok?"✓":"✗"}</span>
              </div>;
            })}
            <span style={{fontSize:"9px",color:C.muted}}>{si.zoneType}</span>
          </div>
        )}
      </Card>

      {/* 세대 타입별 면적표 */}
      <Card title="세대 타입별 면적표" tag="UNIT TYPE AREA SCHEDULE" accentBar={C_apt}>
        <div style={{marginBottom:"8px",padding:"7px 11px",background:C.purpleBg,border:`1px solid ${C.purple}20`,borderRadius:"7px",fontSize:"10px",color:C.purple,lineHeight:1.7}}>
          <strong>면적 구성:</strong> 공급면적 = 전용 + 주거공용(코어+벽체) &nbsp;|&nbsp; 계 = 공급면적 + 기타공용(부대복리+기전) &nbsp;|&nbsp; 계약면적 = 계 + 지하주차장
          <br/><ModeTag label="첨부 면적표 기본값 적용 중" color={C.purple}/> 수치는 직접 수정 가능합니다.
        </div>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"9px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"900px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                <th rowSpan={2} style={aTh()}>TYPE</th>
                <th rowSpan={2} style={aTh()}>세대수</th>
                <th rowSpan={2} style={aTh()}>비율</th>
                <th rowSpan={2} style={aTh()}>전용면적<br/><span style={{fontSize:"8px",fontWeight:400}}>/세대(㎡)</span></th>
                <th colSpan={3} style={aTh("#dbeafe")}>주거공용면적/세대(㎡)</th>
                <th rowSpan={2} style={aTh("#dcfce7")}>공급면적<br/><span style={{fontSize:"8px",fontWeight:400}}>/세대(㎡)</span></th>
                <th colSpan={3} style={aTh("#fef3c7")}>기타공용면적/세대(㎡)</th>
                <th rowSpan={2} style={aTh()}>계<br/><span style={{fontSize:"8px",fontWeight:400}}>/세대(㎡)</span></th>
                <th rowSpan={2} style={aTh()}>지하주차장<br/><span style={{fontSize:"8px",fontWeight:400}}>/세대(㎡)</span></th>
                <th rowSpan={2} style={aTh()}>계약면적<br/><span style={{fontSize:"8px",fontWeight:400}}>/세대(㎡)</span></th>
                <th rowSpan={2} style={aTh()}>분양/임대</th>
                <th rowSpan={2} style={aTh()}>삭제</th>
              </tr>
              <tr style={{background:C.cardAlt}}>
                <th style={aTh("#dbeafe","9px")}>코어공용</th>
                <th style={aTh("#dbeafe","9px")}>벽체공용</th>
                <th style={aTh("#dbeafe","9px")}>소계</th>
                <th style={aTh("#fef3c7","9px")}>부대복리</th>
                <th style={aTh("#fef3c7","9px")}>기계전기</th>
                <th style={aTh("#fef3c7","9px")}>소계</th>
              </tr>
            </thead>
            <tbody>
              {area.typeCalcs.map((t,idx)=>{
                const orig=apt.types.find(x=>x.id===t.id)||apt.types[idx]||{};
                return(
                  <tr key={t.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                    <td style={aTd()}><input value={orig.typeLabel} onChange={e=>D("APT_TYPE",{id:t.id,k:"typeLabel",v:e.target.value})} style={aInpS(42,C_apt)}/></td>
                    <td style={aTd()}><input value={orig.units} onChange={e=>D("APT_TYPE",{id:t.id,k:"units",v:e.target.value})} style={aInpS(50)}/></td>
                    <td style={{...aTd(),fontFamily:C.mono,fontSize:"10px",color:C.muted,textAlign:"right"}}>{t.pct.toFixed(1)}%</td>
                    <td style={aTd()}><input value={orig.exclArea} onChange={e=>D("APT_TYPE",{id:t.id,k:"exclArea",v:e.target.value})} style={aInpS(55)}/></td>
                    <td style={aTd("bg")}><input value={orig.coreCommon} onChange={e=>D("APT_TYPE",{id:t.id,k:"coreCommon",v:e.target.value})} style={aInpS(55)}/></td>
                    <td style={aTd("bg")}><input value={orig.wallCommon} onChange={e=>D("APT_TYPE",{id:t.id,k:"wallCommon",v:e.target.value})} style={aInpS(55)}/></td>
                    <td style={{...aTd("bg"),fontFamily:C.mono,fontSize:"11px",color:C.accent,fontWeight:600,textAlign:"right"}}>{t.residComm.toFixed(2)}</td>
                    <td style={{...aTd("green"),fontFamily:C.mono,fontSize:"11px",color:C.green,fontWeight:700,textAlign:"right"}}>{t.supply.toFixed(2)}</td>
                    <td style={aTd("am")}><input value={orig.amenity} onChange={e=>D("APT_TYPE",{id:t.id,k:"amenity",v:e.target.value})} style={aInpS(55)}/></td>
                    <td style={aTd("am")}><input value={orig.mechElec} onChange={e=>D("APT_TYPE",{id:t.id,k:"mechElec",v:e.target.value})} style={aInpS(55)}/></td>
                    <td style={{...aTd("am"),fontFamily:C.mono,fontSize:"11px",color:C.amber,fontWeight:600,textAlign:"right"}}>{t.otherComm.toFixed(2)}</td>
                    <td style={{...aTd(),fontFamily:C.mono,fontSize:"11px",fontWeight:700,textAlign:"right"}}>{t.total.toFixed(2)}</td>
                    <td style={aTd()}><input value={orig.ugParking} onChange={e=>D("APT_TYPE",{id:t.id,k:"ugParking",v:e.target.value})} style={aInpS(55)}/></td>
                    <td style={{...aTd(),fontFamily:C.mono,fontSize:"11px",fontWeight:700,textAlign:"right",color:C.teal}}>{t.contract.toFixed(2)}</td>
                    <td style={aTd()}>
                      <select value={orig.saleMode} onChange={e=>D("APT_TYPE",{id:t.id,k:"saleMode",v:e.target.value})} style={{fontSize:"10px",padding:"2px 4px",border:`1px solid ${C.border}`,borderRadius:"4px",fontFamily:C.sans,background:"#fff"}}>
                        <option value="sale">분양</option><option value="rent">임대</option>
                      </select>
                    </td>
                    <td style={aTd()}>
                      <button onClick={()=>D("APT_DEL_TYPE",{id:t.id})} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:"13px"}} onMouseEnter={e=>e.target.style.color=C.red} onMouseLeave={e=>e.target.style.color=C.muted}>×</button>
                    </td>
                  </tr>
                );
              })}
              {/* 합계행 */}
              <tr style={{background:"#f1f5f9",borderTop:`2px solid ${C_apt}30`}}>
                <td style={{padding:"7px 8px",fontWeight:700,color:C.mid,fontSize:"11px"}} colSpan={2}>합계</td>
                <td style={{...aTd(),fontFamily:C.mono,fontWeight:700,textAlign:"right"}}>{area.totalUnits}세대</td>
                <td style={{...aTd(),fontFamily:C.mono,fontWeight:700,textAlign:"right"}}>{area.tExcl.toFixed(2)}</td>
                <td style={aTd("bg")} colSpan={2}/>
                <td style={{...aTd("bg"),fontFamily:C.mono,fontWeight:700,textAlign:"right",color:C.accent}}>{area.typeCalcs.reduce((s,t)=>s+t.tResidComm,0).toFixed(2)}</td>
                <td style={{...aTd("green"),fontFamily:C.mono,fontWeight:700,textAlign:"right",color:C.green}}>{area.tSupply.toFixed(2)}</td>
                <td style={aTd("am")} colSpan={2}/>
                <td style={{...aTd("am"),fontFamily:C.mono,fontWeight:700,textAlign:"right",color:C.amber}}>{area.typeCalcs.reduce((s,t)=>s+t.tOtherComm,0).toFixed(2)}</td>
                <td style={{...aTd(),fontFamily:C.mono,fontWeight:700,textAlign:"right"}}>{area.tTotal.toFixed(2)}</td>
                <td style={{...aTd(),fontFamily:C.mono,fontWeight:700,textAlign:"right"}}>{area.tUgPark.toFixed(2)}</td>
                <td style={{...aTd(),fontFamily:C.mono,fontWeight:700,textAlign:"right",color:C.teal}}>{area.tContract.toFixed(2)}</td>
                <td colSpan={2}/>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"9px",display:"flex",gap:"8px",alignItems:"center"}}>
          <Btn sm variant="ghost" onClick={()=>D("APT_ADD_TYPE",{})}>＋ 타입 추가</Btn>
          <Btn sm onClick={()=>D("APT_RESET_TYPES",{})}>↺ 기본값 복원</Btn>
          <span style={{fontSize:"9px",color:C.muted}}>기본값 = 첨부 면적표 기준 (39/49/59/74/84㎡ 5개 타입)</span>
        </div>
      </Card>

      {/* 비주거시설 */}
      <Card title="비주거시설 면적" tag="NON-RESIDENTIAL" accentBar={C.teal}>
        <div style={{border:`1.5px solid ${C.border}`,borderRadius:"9px",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"600px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["용도","층","전용면적(㎡)","공용면적(㎡)","소계(㎡)","분양/임대","삭제"].map((h,i)=>(
                  <th key={i} style={{padding:"8px 10px",fontSize:"10px",color:C.muted,fontWeight:700,textAlign:i<2?"left":"right",borderRight:i<6?`1px solid ${C.border}`:"none"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {area.nonResiCalcs.map((nr,idx)=>{
                const orig=apt.nonResi.find(x=>x.id===nr.id)||{};
                return(
                  <tr key={nr.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                    <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}><input value={orig.label||""} onChange={e=>D("APT_NR",{id:nr.id,k:"label",v:e.target.value})} style={{width:"110px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 6px",fontSize:"11px",fontFamily:C.sans,outline:"none",fontWeight:600,color:C.teal}}/></td>
                    <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}><input value={orig.floor||""} onChange={e=>D("APT_NR",{id:nr.id,k:"floor",v:e.target.value})} style={{width:"70px",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"3px 6px",fontSize:"11px",fontFamily:C.sans,outline:"none"}}/></td>
                    <td style={{padding:"5px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}><input value={orig.exclArea||""} onChange={e=>D("APT_NR",{id:nr.id,k:"exclArea",v:e.target.value})} placeholder="0.00" style={aInpS(80)}/></td>
                    <td style={{padding:"5px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}><input value={orig.commonArea||""} onChange={e=>D("APT_NR",{id:nr.id,k:"commonArea",v:e.target.value})} placeholder="0.00" style={aInpS(80)}/></td>
                    <td style={{padding:"5px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:C.teal,fontWeight:600,borderRight:`1px solid ${C.border}`}}>{nr.tot.toFixed(2)}</td>
                    <td style={{padding:"5px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}>
                      <select value={orig.saleMode||"sale"} onChange={e=>D("APT_NR",{id:nr.id,k:"saleMode",v:e.target.value})} style={{fontSize:"10px",padding:"2px 4px",border:`1px solid ${C.border}`,borderRadius:"4px",fontFamily:C.sans}}>
                        <option value="sale">분양</option><option value="rent">임대</option>
                      </select>
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"center"}}>
                      <button onClick={()=>D("APT_DEL_NR",{id:nr.id})} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:"13px"}} onMouseEnter={e=>e.target.style.color=C.red} onMouseLeave={e=>e.target.style.color=C.muted}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <Btn sm variant="ghost" onClick={()=>D("APT_ADD_NR",{})}>＋ 비주거시설 추가</Btn>
          <span style={{fontFamily:C.mono,fontSize:"12px",color:C.teal,fontWeight:700}}>비주거 합계: {area.nrTot.toFixed(2)} ㎡</span>
        </div>
      </Card>

      {/* 주차대수 */}
      <Card title="주차대수 산정" tag="PARKING" accentBar={C.green}>
        <div style={{marginBottom:"9px",padding:"7px 11px",background:C.greenBg,border:`1px solid ${C.green}30`,borderRadius:"7px",fontSize:"10px",color:C.green,lineHeight:1.7}}>
          <ModeTag label="서울시 주차장 조례 별표1" color={C.green}/> 세대당 법정 산정. 계획대수 = 법정 × 배수.
        </div>
        <G cols="repeat(auto-fit,minmax(130px,1fr))">
          <AInput label="세대당 법정대수" value={pk.legalPerUnit} onChange={v=>D("APT_PK",{legalPerUnit:v})} unit="대/세대" lawNote="주차장조례 별표1"/>
          <AInput label="근생 법정기준면적" value={pk.legalNonResiM2} onChange={v=>D("APT_PK",{legalNonResiM2:v})} unit="㎡/대" lawNote="시설면적당"/>
          <KpiCard label="법정주차대수 합계" value={`${area.legalTotal}대`} unit="" ok2 sub={`주거 ${area.legalResid}대 + 근생 ${area.legalNonResi}대`}/>
          <AInput label="계획 배수" value={pk.planMult} onChange={v=>D("APT_PK",{planMult:v})} unit="배" lawNote="법정의 1.2~1.5배 권장"/>
          <KpiCard label="계획주차대수" value={`${area.planTotal}대`} unit="" hi sub={`법정 ${area.legalTotal} × ${pk.planMult}배`}/>
          <AInput label="1대당 소요면적" value={pk.areaPerSlot} onChange={v=>D("APT_PK",{areaPerSlot:v})} unit="㎡/대" lawNote="통상 25~30㎡"/>
          <KpiCard label="주차장 소요면적" value={`${area.pkAreaTotal.toFixed(0)}㎡`} unit="" hi/>
        </G>
        <div style={{marginTop:"10px",padding:"10px 13px",background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"9px"}}>
          <div style={{fontSize:"11px",fontWeight:700,color:C.mid,marginBottom:"8px"}}>공영주차장 (별도 수익 설정)</div>
          <G cols="repeat(auto-fit,minmax(140px,1fr))">
            <AInput label="공영/별도 주차 대수" value={pk.commercialSlots} onChange={v=>D("APT_PK",{commercialSlots:v})} unit="대"/>
            <div>
              <div style={{fontSize:"11px",color:C.muted,marginBottom:"3px",fontWeight:600}}>수익 방식</div>
              <div style={{display:"flex",gap:"5px"}}>
                {[["none","없음"],["sale","매각"],["rent","임대운영"]].map(([v,l])=>(
                  <button key={v} onClick={()=>D("APT_PK",{commercialSaleMode:v})} style={{padding:"4px 10px",borderRadius:"6px",border:`1.5px solid ${pk.commercialSaleMode===v?C.teal:C.border}`,background:pk.commercialSaleMode===v?C.tealBg:"#fff",color:pk.commercialSaleMode===v?C.teal:C.muted,fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:C.sans}}>{l}</button>
                ))}
              </div>
            </div>
            {pk.commercialSaleMode==="sale"&&<AInput label="공영 매각수입" value={pk.commercialSaleIncome} onChange={v=>D("APT_PK",{commercialSaleIncome:v})} unit="천원"/>}
            {pk.commercialSaleMode==="rent"&&<AInput label="공영 월 임대수입" value={pk.commercialRentIncome} onChange={v=>D("APT_PK",{commercialRentIncome:v})} unit="천원/월"/>}
          </G>
        </div>
      </Card>

      {/* 연면적 집계 */}
      <div style={{background:"#fff",border:`2px solid ${C_apt}20`,borderRadius:"12px",padding:"14px 16px",boxShadow:C.shadowMd}}>
        <div style={{fontSize:"11px",fontWeight:700,color:C_apt,marginBottom:"9px",letterSpacing:"0.05em"}}>연면적 집계 (자동)</div>
        <G cols="repeat(auto-fit,minmax(110px,1fr))">
          {[["주거 지상",area.gfaAboveResid.toFixed(2)],["비주거 지상",area.gfaAboveNR.toFixed(2)],["지상 합계",area.gfaAbove.toFixed(2)],["지하 합계",area.gfaBelow.toFixed(2)],["전체 연면적",area.gfaTotal.toFixed(2)],["용적률산정용",area.gfaFar.toFixed(2)]].map(([l,v],i)=>(
            <KpiCard key={l} label={l} value={v} hi={i===4||i===5} ok2={i===2}/>
          ))}
        </G>
      </div>
    </div>
  );
}

// 테이블 스타일 헬퍼
const aTh=(bg,fs="10px")=>({padding:"7px 8px",fontSize:fs,color:C.muted,fontWeight:700,textAlign:"center",borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,background:bg||C.cardAlt,whiteSpace:"nowrap"});
const aTd=(t)=>({padding:"4px 7px",borderRight:`1px solid ${C.border}`,textAlign:"right",background:t==="bg"?"#eff6ff":t==="green"?"#f0fdf4":t==="am"?"#fffbeb":"#fff"});
const aInpS=(w=70,color=C.text)=>({width:`${w}px`,border:`1px solid ${C.border}`,borderRadius:"4px",padding:"3px 6px",fontSize:"11px",fontFamily:C.mono,textAlign:"right",outline:"none",color,background:"#fff"});

// ════════════════════════════════════════════════════════════════
// § APT-7. 사업비 탭
// ════════════════════════════════════════════════════════════════
function AptCostTab({apt,dispatch,area,cost,onEum}){
  const D=(t,p)=>dispatch({type:t,p});
  const c=apt.cost;
  const cc=cost;
  const autoDesign=getAptDesignRate(cc.baseI*1000);
  const autoSuperv=getAptSupervRate(cc.baseI*1000);

  return(
    <div>
      {/* 토지비 */}
      <Card title="토지비 (공시지가 기준)" tag="LAND COST" accentBar={C.amber}>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:"8px"}}>
          <button onClick={onEum} style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 12px",borderRadius:"7px",border:"1.5px solid #0ea5e9",background:"#f0f9ff",color:"#0369a1",fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:C.sans}}>
            🗺️ 토지이음에서 공시지가 확인
          </button>
        </div>
        <G cols="repeat(auto-fit,minmax(150px,1fr))">
          <AInput label="공시지가 (원/㎡)" value={c.landPubPrice} onChange={v=>D("APT_COST",{landPubPrice:v})} unit="원/㎡" lawNote="공시지가 기준"/>
          <AInput label="공시지가 기준연도" value={c.landPubYear} onChange={v=>D("APT_COST",{landPubYear:v})} unit="년"/>
          <AInput label="보정배율" value={c.landCorrFactor} onChange={v=>D("APT_COST",{landCorrFactor:v})} unit="배" lawNote="토지수용보상배율 기준" warn={+(c.landCorrFactor)>3}/>
          <KpiCard label="실사용 대지면적" value={`${area.sN.toFixed(1)}㎡`} unit=""/>
          <KpiCard label="토지비 합계" value={`${fM(cc.land*1000)}원`} unit="" hi sub={`${cc.land.toFixed(0)}천원 | 공시지가×면적×${c.landCorrFactor}배`}/>
        </G>
        <div style={{marginTop:"8px",padding:"7px 11px",background:C.amberBg,borderRadius:"7px",fontSize:"9px",color:C.amber,lineHeight:1.7}}>
          ⚠ 토지보상배율 기준: 서울 주거/상업 1.49~1.59배, 비서울 1.2~2.2배 (요율탭 참고). 샘플(안산) = 2.185배.
          보상비 = 공시지가 × 대지면적 × 보정배율
        </div>
      </Card>

      {/* 직접공사비 */}
      <Card title="직접공사비" tag="DIRECT CONSTRUCTION COST" accentBar={C.amber}>
        <div style={{marginBottom:"9px",padding:"7px 11px",background:C.accentBg,border:`1px solid ${C.accent}30`,borderRadius:"7px",fontSize:"10px",color:C.accent,lineHeight:1.7}}>
          <ModeTag label="2024 공공건축물 공사비 가이드라인" color={C.accent}/> 단가 기본값 적용 중. 보정계수는 규모·층수·지역에 따라 조정.
        </div>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"9px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"600px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["구분","면적(㎡)","기준단가(천원/㎡)","보정계수","적용단가(천원/㎡)","공사비(천원)"].map((h,i)=>(
                  <th key={i} style={{padding:"8px 10px",fontSize:"10px",color:C.muted,fontWeight:700,textAlign:i<1?"left":"right",borderRight:i<5?`1px solid ${C.border}`:"none"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["공동주택 지상",area.gfaAboveResid,"aptAbove","corrAptAbove",cc.aptA,"2024 가이드라인"],
                ["공동주택 지하",area.gfaBelow,"aptBelow","corrAptBelow",cc.aptB,"지하: 지상의 약 52%"],
                ["근린생활시설",area.gfaAboveNR,"nonResiAbove","corrNonResi",cc.nrA,"근생 평균단가"],
                ["주차장",area.pkAreaTotal,"parkingAbove","corrParking",cc.pkA,"지상형 기준"],
              ].map(([lbl,ar,unitK,corrK,val,note])=>{
                const unitV=+(c[unitK])||0;
                const corrV=+(c[corrK])||1;
                return(
                  <tr key={lbl} style={{borderBottom:`1px solid ${C.faint}`}}>
                    <td style={{padding:"6px 10px",fontSize:"12px",fontWeight:600,borderRight:`1px solid ${C.border}`}}>
                      {lbl}<div style={{fontSize:"9px",color:C.muted,fontWeight:400}}>{note}</div>
                    </td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`}}>{ar.toFixed(0)}</td>
                    <td style={{padding:"6px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}>
                      <input value={c[unitK]} onChange={e=>D("APT_COST",{[unitK]:e.target.value})} style={aInpS(70)}/>
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}>
                      <input value={c[corrK]} onChange={e=>D("APT_COST",{[corrK]:e.target.value})} style={aInpS(50)} warn={+(c[corrK])>1.5}/>
                    </td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:C.teal,fontWeight:600,borderRight:`1px solid ${C.border}`}}>{(unitV*corrV).toFixed(0)}</td>
                    <td style={{padding:"6px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"12px",color:C.amber,fontWeight:700}}>{fM(val*1000)}</td>
                  </tr>
                );
              })}
              <tr style={{background:"#f1f5f9",borderTop:`2px solid ${C.amber}30`}}>
                <td style={{padding:"7px 10px",fontWeight:700,color:C.mid}} colSpan={4}>직접공사비 합계</td>
                <td colSpan={2} style={{padding:"7px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"14px",color:C.amber,fontWeight:700}}>{fM(cc.directConstr*1000)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* 간접비 */}
      <Card title="간접비" tag="INDIRECT COST" accentBar={C.amber}>
        <div style={{marginBottom:"8px",padding:"7px 11px",background:C.accentBg,border:`1px solid ${C.accent}30`,borderRadius:"7px",fontSize:"10px",color:C.accent,lineHeight:1.7}}>
          직접공사비 {fM(cc.directConstr*1000)}원 기준 → 설계비 자동요율 <strong>{autoDesign}%</strong>, 감리비 <strong>{autoSuperv}%</strong> (건축사협회 대가기준). 보정계수 {c.corrIndirect} 적용.
        </div>
        <G cols="repeat(auto-fit,minmax(155px,1fr))">
          <AInput label="조사·측량비 요율" value={c.surveyR} onChange={v=>D("APT_COST",{surveyR:v})} unit="%" lawNote="직접공사비 기준"/>
          <div>
            <AInput label={`설계비 요율 ${c.designROverride?"★수동":"(2종중급 자동)"}`} value={c.designROverride} onChange={v=>D("APT_COST",{designROverride:v})} unit="%" placeholder={`자동: ${autoDesign}%`} warn={!!c.designROverride}/>
            {c.designROverride&&<button onClick={()=>D("APT_COST",{designROverride:""})} style={{fontSize:"9px",color:C.red,background:"transparent",border:"none",cursor:"pointer",fontFamily:C.sans}}>× 자동으로</button>}
          </div>
          <div>
            <AInput label={`감리비 요율 ${c.supervROverride?"★수동":"(3종중급 자동)"}`} value={c.supervROverride} onChange={v=>D("APT_COST",{supervROverride:v})} unit="%" placeholder={`자동: ${autoSuperv}%`} warn={!!c.supervROverride}/>
            {c.supervROverride&&<button onClick={()=>D("APT_COST",{supervROverride:""})} style={{fontSize:"9px",color:C.red,background:"transparent",border:"none",cursor:"pointer",fontFamily:C.sans}}>× 자동으로</button>}
          </div>
          <AInput label="시설부대비 요율" value={c.facilR} onChange={v=>D("APT_COST",{facilR:v})} unit="%" lawNote="직접공사비 기준"/>
          <AInput label="간접비 보정계수" value={c.corrIndirect} onChange={v=>D("APT_COST",{corrIndirect:v})} unit="" warn={+(c.corrIndirect)>1.3}/>
        </G>
        <div style={{marginTop:"10px",padding:"10px 13px",background:C.cardAlt,borderRadius:"8px"}}>
          <div style={{fontSize:"11px",fontWeight:700,color:C.mid,marginBottom:"7px"}}>상하수도 원인자부담금 <ModeTag label="직접 산정" color={C.teal}/></div>
          <G cols="repeat(auto-fit,minmax(150px,1fr))">
            <AInput label="상수도: 세대당 부담금" value={c.waterPerUnit} onChange={v=>D("APT_COST",{waterPerUnit:v})} unit="원/세대" lawNote="수도법 §71"/>
            <KpiCard label="상수도 합계" value={fM(cc.water*1000)} unit="" sub={`${area.totalUnits}세대 × ${fM(+(c.waterPerUnit))}원`}/>
            <AInput label="하수도: ㎥당 단가" value={c.sewerPerM3} onChange={v=>D("APT_COST",{sewerPerM3:v})} unit="원/㎥" lawNote="하수도법 §61"/>
            <AInput label="오수발생량" value={c.sewagePerPerson} onChange={v=>D("APT_COST",{sewagePerPerson:v})} unit="㎥/일/인" lawNote="하수정비기본계획"/>
            <AInput label="세대당 거주인원" value={c.personsPerUnit} onChange={v=>D("APT_COST",{personsPerUnit:v})} unit="인/세대"/>
            <KpiCard label="하수도 합계" value={fM(cc.sewer*1000)} unit="" sub={`${(area.totalUnits*(+(c.personsPerUnit)||2.5)*(+(c.sewagePerPerson)||0.28)).toFixed(1)}㎥/일`}/>
          </G>
        </div>
        <G cols="repeat(auto-fit,minmax(100px,1fr))" mt="9px">
          {[["조사측량",cc.survey],["설계비",cc.design],["감리비",cc.superv],["시설부대",cc.facil],["상수도",cc.water],["하수도",cc.sewer]].map(([l,v])=>(
            <KpiCard key={l} label={l} value={fM(v*1000)} unit=""/>
          ))}
        </G>
        <div style={{marginTop:"9px",display:"flex",justifyContent:"flex-end"}}>
          <span style={{fontFamily:C.mono,fontSize:"13px",color:C.amber,fontWeight:700}}>간접비 합계: {fM(cc.indirect*1000)}</span>
        </div>
      </Card>

      {/* 부대비·예비비·금융 */}
      <Card title="부대비 · 예비비 · 금융비용" tag="OTHER COSTS" accentBar={C.amber} collapsible>
        <G cols="repeat(auto-fit,minmax(150px,1fr))">
          <AInput label="일반관리비 요율" value={c.mgmtR} onChange={v=>D("APT_COST",{mgmtR:v})} unit="%" lawNote="기준사업비(토지+공사+간접)"/>
          <AInput label="판매비 요율" value={c.salesR} onChange={v=>D("APT_COST",{salesR:v})} unit="%" lawNote="인천도시공사 기준 0.27%"/>
          <AInput label="예비비 요율" value={c.reserveR} onChange={v=>D("APT_COST",{reserveR:v})} unit="%" lawNote="기준사업비 10% 통상"/>
          <AInput label="연 금리" value={c.loanR} onChange={v=>D("APT_COST",{loanR:v})} unit="%"/>
          <AInput label="공사기간" value={c.constPeriod} onChange={v=>D("APT_COST",{constPeriod:v})} unit="년"/>
          <AInput label="사업 시작연도" value={c.startYear} onChange={v=>D("APT_COST",{startYear:v})} unit="년"/>
        </G>
        <G cols="repeat(auto-fit,minmax(110px,1fr))" mt="9px">
          <KpiCard label="일반관리비" value={fM(cc.mgmt*1000)} unit=""/>
          <KpiCard label="판매비" value={fM(cc.sales*1000)} unit=""/>
          <KpiCard label="예비비" value={fM(cc.reserve*1000)} unit=""/>
          <KpiCard label="금융비용(이자)" value={fM(cc.finance*1000)} unit="" sub="평균잔액기준 단순화"/>
        </G>
      </Card>

      {/* TDC 요약 */}
      <div style={{background:"#fff",border:`2px solid ${C.amber}30`,borderRadius:"12px",padding:"16px 18px",boxShadow:C.shadowMd}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:"20px",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:"9px",color:C.amber,fontWeight:700,letterSpacing:"0.1em",marginBottom:"4px"}}>총 사업비 (TDC, 금융비용 포함)</div>
            <div style={{fontFamily:C.mono,fontSize:"26px",color:C.text,fontWeight:700}}>{fM(cc.tdcTotal*1000)}</div>
            <div style={{fontSize:"10px",color:C.muted}}>{cc.tdcTotal.toFixed(0)} 천원</div>
          </div>
          <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 18px",minWidth:"200px"}}>
            {[["용지비",cc.land],["직접공사비",cc.directConstr],["간접비",cc.indirect],["부대비",cc.other],["예비비",cc.reserve],["금융비용",cc.finance]].map(([l,v])=>(
              <div key={l}><span style={{fontSize:"10px",color:C.muted}}>{l}: </span><span style={{fontSize:"11px",fontFamily:C.mono,fontWeight:600}}>{fM(v*1000)}</span><span style={{fontSize:"9px",color:C.muted,marginLeft:"3px"}}>({cc.tdcTotal>0?fP(v/cc.tdcTotal*100):"—"}%)</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// § APT-8. 분양수입 탭
// ════════════════════════════════════════════════════════════════
function AptRevenueTab({apt,dispatch,area,rev}){
  const D=(t,p)=>dispatch({type:t,p});
  const r=apt.revenue;

  return(
    <div>
      {/* 공동주택 분양/임대수입 */}
      <Card title="공동주택 타입별 수입" tag="RESIDENTIAL REVENUE" accentBar={C.green}>
        <div style={{marginBottom:"8px",fontSize:"10px",color:C.muted}}>
          분양: 공급면적(㎡) × 분양단가(천원/㎡) | 임대: 전용면적(㎡) × 월임대료(원/㎡) × 12
        </div>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"9px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"700px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["TYPE","세대수","전용㎡합계","공급㎡합계","분양/임대","단가","보증금단가","수입(천원)","비고"].map((h,i)=>(
                  <th key={i} style={{padding:"7px 9px",fontSize:"10px",color:C.muted,fontWeight:700,textAlign:i<2?"left":"right",borderRight:i<8?`1px solid ${C.border}`:"none"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rev.typeRevs.map((t,idx)=>{
                const orig=apt.types.find(x=>x.id===t.id)||{};
                const isSale=t.saleMode==="sale";
                return(
                  <tr key={t.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                    <td style={{padding:"5px 9px",fontWeight:700,color:C.green,fontFamily:C.mono,borderRight:`1px solid ${C.border}`}}>{t.typeLabel}㎡형</td>
                    <td style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`}}>{t.units}</td>
                    <td style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`}}>{t.tExcl.toFixed(1)}</td>
                    <td style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:C.green,fontWeight:600,borderRight:`1px solid ${C.border}`}}>{t.tSupply.toFixed(1)}</td>
                    <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                      <select value={orig.saleMode||"sale"} onChange={e=>D("APT_TYPE",{id:t.id,k:"saleMode",v:e.target.value})} style={{fontSize:"10px",padding:"2px 4px",border:`1px solid ${C.border}`,borderRadius:"4px",fontFamily:C.sans,background:"#fff"}}>
                        <option value="sale">분양</option><option value="rent">임대</option>
                      </select>
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}>
                      <input value={isSale?(orig.salePrice||""):(orig.rentUnit||"")} onChange={e=>D("APT_TYPE",{id:t.id,k:isSale?"salePrice":"rentUnit",v:e.target.value})} placeholder={isSale?"천원/㎡(공급)":"원/㎡/월"} style={aInpS(80)}/>
                      <div style={{fontSize:"8px",color:C.muted,textAlign:"right"}}>{isSale?"천원/공급㎡":"원/전용㎡/월"}</div>
                    </td>
                    <td style={{padding:"5px 8px",textAlign:"right",borderRight:`1px solid ${C.border}`}}>
                      {!isSale&&<input value={orig.depositUnit||""} onChange={e=>D("APT_TYPE",{id:t.id,k:"depositUnit",v:e.target.value})} placeholder="원/㎡" style={aInpS(75)}/>}
                      {isSale&&<span style={{fontSize:"10px",color:C.muted}}>—</span>}
                    </td>
                    <td style={{padding:"5px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"12px",color:C.green,fontWeight:700,borderRight:`1px solid ${C.border}`}}>
                      {isSale?fM(t.inc*1000):fM(t.annInc*1000)}
                      <div style={{fontSize:"9px",color:C.muted,fontWeight:400}}>{isSale?"분양":"연임대"}</div>
                    </td>
                    <td style={{padding:"5px 9px",fontSize:"9px",color:C.muted}}>{isSale?`공급면적 기준`:`전용기준 연${(+((orig.rentUnit||0))*12/10000).toFixed(0)}만원/㎡`}</td>
                  </tr>
                );
              })}
              <tr style={{background:"#f0fdf4",borderTop:`2px solid ${C.green}30`}}>
                <td style={{padding:"7px 9px",fontWeight:700,color:C.green}} colSpan={3}>합계</td>
                <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontWeight:700,color:C.green}}>{area.tSupply.toFixed(1)}</td>
                <td colSpan={3}/>
                <td style={{padding:"7px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"14px",color:C.green,fontWeight:700}}>
                  {fM((rev.aptSale+rev.aptRentAnn)*1000)}
                  <div style={{fontSize:"9px",fontWeight:400}}>분양 {fM(rev.aptSale*1000)} + 임대 {fM(rev.aptRentAnn*1000)}/년</div>
                </td>
                <td/>
              </tr>
            </tbody>
          </table>
        </div>
        {/* 주변시세 참고 */}
        <div style={{marginTop:"10px",padding:"9px 12px",background:"#f0fdf4",border:`1px solid ${C.green}30`,borderRadius:"7px",fontSize:"10px",color:C.green,lineHeight:1.7}}>
          💡 <strong>주변시세 참고:</strong> 인근 유사단지 분양가를 토대로 입력. 공급면적 기준 천원/㎡ 단위.<br/>
          예: 84㎡형 분양가 6억 = 공급면적(약 114㎡) 기준 → 600,000천원 ÷ 114 ≈ 5,263천원/㎡
        </div>
      </Card>

      {/* 비주거 수입 */}
      <Card title="비주거시설 수입" tag="NON-RESIDENTIAL REVENUE" accentBar={C.teal}>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"9px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"600px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["용도","층","전용㎡","분양/임대","단가","보증금단가","수입(천원)"].map((h,i)=>(
                  <th key={i} style={{padding:"7px 9px",fontSize:"10px",color:C.muted,fontWeight:700,textAlign:i<2?"left":"right",borderRight:i<6?`1px solid ${C.border}`:"none"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rev.nrRevs.map((nr,idx)=>{
                const orig=apt.nonResi.find(x=>x.id===nr.id)||{};
                const isSale=nr.saleMode==="sale";
                return(
                  <tr key={nr.id} style={{borderBottom:`1px solid ${C.faint}`,background:idx%2?C.cardAlt:"#fff"}}>
                    <td style={{padding:"5px 9px",fontWeight:600,color:C.teal,borderRight:`1px solid ${C.border}`}}>{nr.label}</td>
                    <td style={{padding:"5px 9px",fontSize:"11px",borderRight:`1px solid ${C.border}`}}>{nr.floor}</td>
                    <td style={{padding:"5px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`}}>{nr.excl.toFixed(1)}</td>
                    <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                      <select value={orig.saleMode||"sale"} onChange={e=>D("APT_NR",{id:nr.id,k:"saleMode",v:e.target.value})} style={{fontSize:"10px",padding:"2px 4px",border:`1px solid ${C.border}`,borderRadius:"4px",fontFamily:C.sans}}>
                        <option value="sale">분양</option><option value="rent">임대</option>
                      </select>
                    </td>
                    <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                      <input value={isSale?(orig.salePrice||""):(orig.rentUnit||"")} onChange={e=>D("APT_NR",{id:nr.id,k:isSale?"salePrice":"rentUnit",v:e.target.value})} placeholder={isSale?"천원/㎡":"원/㎡/월"} style={aInpS(80)}/>
                    </td>
                    <td style={{padding:"5px 8px",borderRight:`1px solid ${C.border}`}}>
                      {!isSale&&<input value={orig.depositUnit||""} onChange={e=>D("APT_NR",{id:nr.id,k:"depositUnit",v:e.target.value})} placeholder="원/㎡" style={aInpS(75)}/>}
                      {isSale&&<span style={{color:C.muted,fontSize:"10px"}}>—</span>}
                    </td>
                    <td style={{padding:"5px 10px",textAlign:"right",fontFamily:C.mono,fontSize:"12px",color:C.teal,fontWeight:700}}>
                      {isSale?fM(nr.inc*1000):fM(nr.annInc*1000)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 주차장 수입 (별도) */}
      {apt.parking.commercialSaleMode!=="none"&&(
        <Card title="공영주차장 수입" tag="PARKING REVENUE" accentBar={C.mid}>
          <G cols="repeat(3,1fr)">
            <KpiCard label="공영주차장 대수" value={`${apt.parking.commercialSlots}대`} unit=""/>
            <KpiCard label="수익방식" value={apt.parking.commercialSaleMode==="sale"?"매각":"임대운영"} unit=""/>
            <KpiCard label="주차장 수입" value={fM(rev.pkInc*1000)} unit="" ok2/>
          </G>
        </Card>
      )}

      {/* 분양 스케줄 */}
      <Card title="분양 수입 스케줄" tag="SALE SCHEDULE" accentBar="#dc2626">
        <div style={{marginBottom:"9px",padding:"7px 11px",background:"#fff5f5",border:`1px solid #dc262630`,borderRadius:"7px",fontSize:"10px",color:"#dc2626",lineHeight:1.7}}>
          타당성 단계 단순화 적용. 계약금(착공시) + 중도금(공사중) + 잔금(준공시). 합계 = 100%.
        </div>
        <G cols="repeat(3,1fr)">
          <div>
            <AInput label="계약금 비율" value={r.contractR} onChange={v=>D("APT_REV",{contractR:v})} unit="%" lawNote="통상 10%"/>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"4px"}}>= {fM(rev.contractAmt*1000)}원 (착공시)</div>
          </div>
          <div>
            <AInput label="중도금 비율" value={r.midR} onChange={v=>D("APT_REV",{midR:v})} unit="%" lawNote="통상 50%"/>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"4px"}}>= {fM(rev.midAmt*1000)}원 (공사중 균등)</div>
          </div>
          <div>
            <AInput label="잔금 비율" value={r.balanceR} onChange={v=>D("APT_REV",{balanceR:v})} unit="%" lawNote="통상 40%"/>
            <div style={{fontSize:"10px",color:C.muted,marginTop:"4px"}}>= {fM(rev.balanceAmt*1000)}원 (준공시)</div>
          </div>
        </G>
        {(Number(r.contractR)+Number(r.midR)+Number(r.balanceR))!==100&&(
          <div style={{marginTop:"8px",padding:"6px 10px",background:C.redBg,borderRadius:"6px",fontSize:"10px",color:C.red}}>
            ⚠ 합계 = {Number(r.contractR)+Number(r.midR)+Number(r.balanceR)}% — 100%가 되도록 조정해 주세요.
          </div>
        )}
      </Card>

      {/* 총 수입 요약 */}
      <div style={{background:C.greenBg,border:`2px solid ${C.green}30`,borderRadius:"12px",padding:"16px 18px",boxShadow:C.shadowMd}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:"20px",alignItems:"center"}}>
          <div>
            <div style={{fontSize:"9px",color:C.green,fontWeight:700,letterSpacing:"0.1em",marginBottom:"4px"}}>총 분양수입</div>
            <div style={{fontFamily:C.mono,fontSize:"26px",color:C.green,fontWeight:700}}>{fM(rev.totalSale*1000)}</div>
            <div style={{fontSize:"9px",color:C.muted}}>{rev.totalSale.toFixed(0)} 천원</div>
          </div>
          {rev.totalRentAnn>0&&(
            <div>
              <div style={{fontSize:"9px",color:C.accent,fontWeight:700,marginBottom:"4px"}}>연간 임대수입</div>
              <div style={{fontFamily:C.mono,fontSize:"18px",color:C.accent,fontWeight:700}}>{fM(rev.totalRentAnn*1000)}/년</div>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 16px"}}>
            {[["공동주택 분양",rev.aptSale],["비주거 분양",rev.nrSale],["공영주차장",rev.pkInc]].filter(([,v])=>v>0).map(([l,v])=>(
              <div key={l}><span style={{fontSize:"10px",color:C.muted}}>{l}: </span><span style={{fontSize:"12px",fontFamily:C.mono,fontWeight:600,color:C.green}}>{fM(v*1000)}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// § APT-9. 사업성 분석 탭
// ════════════════════════════════════════════════════════════════
function AptAnalysisTab({apt,dispatch,cost,rev,ana}){
  const D=(t,p)=>dispatch({type:t,p});
  const startY=+(apt.cost.startYear)||2025;
  const period=+(apt.cost.constPeriod)||3;
  const thS={padding:"7px 9px",fontSize:"10px",color:C.muted,fontWeight:700,borderRight:`1px solid ${C.border}`,whiteSpace:"nowrap"};

  if(!ana||rev.totalSale===0)return(
    <div style={{textAlign:"center",padding:"48px 20px",color:C.muted,fontSize:"13px",background:C.card,borderRadius:"12px",border:`1.5px solid ${C.border}`,lineHeight:2}}>
      면적·사업비·분양수입 데이터를 모두 입력하면 자동으로 분석됩니다.
    </div>
  );

  return(
    <div>
      {/* 분석 파라미터 */}
      <Card title="분석 파라미터" tag="PARAMETERS">
        <G cols="repeat(auto-fit,minmax(140px,1fr))">
          <AInput label="할인율" value={apt.anlys.discountR} onChange={v=>D("APT_ANLYS",{discountR:v})} unit="%" lawNote="통상 사업금리 수준"/>
          <KpiCard label="공사기간" value={`${period}년`} unit="" sub="사업비탭에서 설정"/>
          <KpiCard label="총 사업비" value={fM(cost.tdcTotal*1000)} unit=""/>
          <KpiCard label="총 분양수입" value={fM(rev.totalSale*1000)} unit="" ok2={rev.totalSale>cost.tdcTotal}/>
        </G>
      </Card>

      {/* 핵심 지표 */}
      <Card title="사업성 핵심 지표" tag="KEY METRICS">
        <G cols="repeat(auto-fit,minmax(150px,1fr))">
          {/* NPV */}
          <div style={{background:ana.NPV>0?C.greenBg:C.redBg,border:`1.5px solid ${ana.NPV>0?C.green:C.red}30`,borderRadius:"9px",padding:"12px 14px"}}>
            <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>NPV ({apt.anlys.discountR}% 할인)</div>
            <div style={{fontFamily:C.mono,fontSize:"19px",color:ana.NPV>0?C.green:C.red,fontWeight:700}}>{fM(ana.NPV*1000)}</div>
            <div style={{fontSize:"9px",color:ana.NPV>0?C.green:C.red,marginTop:"4px"}}>{ana.NPV>0?"✓ 타당":"✗ 재검토"}</div>
          </div>
          {/* IRR */}
          <div style={{background:ana.IRR!==null&&ana.IRR>=+(apt.anlys.discountR)?C.greenBg:C.redBg,border:`1.5px solid ${ana.IRR!==null&&ana.IRR>=+(apt.anlys.discountR)?C.green:C.red}30`,borderRadius:"9px",padding:"12px 14px"}}>
            <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>세전 IRR</div>
            <div style={{fontFamily:C.mono,fontSize:"19px",color:ana.IRR!==null&&ana.IRR>=+(apt.anlys.discountR)?C.green:C.red,fontWeight:700}}>{ana.IRR!==null?fP(ana.IRR)+"%":"산출불가"}</div>
            <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>기준: {apt.anlys.discountR}%</div>
          </div>
          {/* PI */}
          <div style={{background:ana.PI>=1?C.greenBg:C.redBg,border:`1.5px solid ${ana.PI>=1?C.green:C.red}30`,borderRadius:"9px",padding:"12px 14px"}}>
            <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>수익성지수 (PI)</div>
            <div style={{fontFamily:C.mono,fontSize:"19px",color:ana.PI>=1?C.green:C.red,fontWeight:700}}>{fP(ana.PI,2)}</div>
            <div style={{fontSize:"9px",color:ana.PI>=1.05?C.green:ana.PI>=1?C.amber:C.red,marginTop:"4px"}}>{ana.PI>=1.05?"✓ 우수":ana.PI>=1?"△ 타당":"✗ 미달"}<span style={{color:C.muted}}> (1.0 기준)</span></div>
          </div>
          {/* 사업 수지 */}
          <div style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:"9px",padding:"12px 14px"}}>
            <div style={{fontSize:"10px",color:C.muted,fontWeight:600,marginBottom:"5px"}}>개발이익 (금융전)</div>
            <div style={{fontFamily:C.mono,fontSize:"19px",color:ana.profit>0?C.green:C.red,fontWeight:700}}>{fM(ana.profit*1000)}</div>
            <div style={{fontSize:"9px",color:C.muted,marginTop:"4px"}}>수익률: {fP(ana.profitR)}%</div>
          </div>
        </G>
      </Card>

      {/* 연도별 현금흐름 */}
      <Card title="연도별 현금흐름 (단순화)" tag="ANNUAL CASH FLOW">
        <div style={{marginBottom:"9px",padding:"7px 11px",background:C.cardAlt,borderRadius:"7px",fontSize:"10px",color:C.muted,lineHeight:1.7}}>
          0년차: 토지비 지출 + 계약금 수입 | 1~{period-1}년차: 공사비 지출 + 중도금 수입 | {period}년차: 잔금 수입 + 공영주차장 수입
        </div>
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:"550px"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["연도","현금지출","현금유입","순현금흐름","누적 CF","할인 PV","누적 NPV"].map((h,i)=>(
                  <th key={i} style={{...thS,textAlign:i===0?"left":"right"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ana.cfs.map((cf,y)=>{
                const yr=startY+y;
                const pv=cf.net/(1+ana.dr)**y;
                const cumCf=ana.cfs.slice(0,y+1).reduce((s,c)=>s+c.net,0);
                const cumPv=ana.cfs.slice(0,y+1).reduce((s,c,t)=>s+c.net/(1+ana.dr)**t,0);
                return(
                  <tr key={y} style={{borderBottom:`1px solid ${C.faint}`,background:y%2?C.cardAlt:"#fff"}}>
                    <td style={{padding:"6px 9px",fontSize:"11px",fontWeight:y===0?700:400,color:C.muted,borderRight:`1px solid ${C.border}`}}>{yr}년 ({y}년차)</td>
                    {[cf.out,cf.inc,cf.net,cumCf,pv,cumPv].map((v,i)=>(
                      <td key={i} style={{padding:"6px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",color:i>=2?(v<0?C.red:v===0?C.muted:C.green):(i===0?C.red:C.green),fontWeight:i===2?700:400,borderRight:i<5?`1px solid ${C.border}`:"none"}}>
                        {v<0?`(${fM(Math.abs(v)*1000)})`:fM(v*1000)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 민감도 분석 */}
      <Card title="민감도 분석 (분양가 변동)" tag="SENSITIVITY">
        <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr style={{background:C.cardAlt}}>
                {["분양가 변동","총 분양수입","개발이익","NPV","IRR","PI","판정"].map((h,i)=>(
                  <th key={i} style={{...thS,textAlign:i===0?"left":"right"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[-20,-10,0,10,20].map(dp=>{
                const adjSale=rev.totalSale*(1+dp/100);
                const adjContract=adjSale*(+(apt.revenue.contractR)||10)/100;
                const adjMid=adjSale*(+(apt.revenue.midR)||50)/100;
                const adjBal=adjSale*(+(apt.revenue.balanceR)||40)/100;
                const adjCfs=ana.cfs.map((cf,y)=>{
                  let inc=y===0?adjContract:y<ana.period?adjMid/(ana.period-1||1):adjBal+rev.pkInc;
                  return{...cf, net:inc-cf.out};
                });
                const adjCfNets=adjCfs.map(c=>c.net);
                const adjNPV=calcNPV(adjCfNets,ana.dr);
                const adjIRR=calcIRR(adjCfNets);
                let adjPvOut=0,adjPvInc=0;
                adjCfs.forEach((cf,y)=>{ adjPvOut+=cf.out/(1+ana.dr)**y; adjPvInc+=(y===0?adjContract:y<ana.period?adjMid/(ana.period-1||1):adjBal+rev.pkInc)/(1+ana.dr)**y; });
                const adjPI=adjPvOut>0?adjPvInc/adjPvOut:0;
                const adjProfit=adjSale-cost.tdc;
                const base=dp===0;
                return(
                  <tr key={dp} style={{borderBottom:`1px solid ${C.faint}`,background:base?C.accentBg:"transparent"}}>
                    <td style={{padding:"7px 9px",fontFamily:C.mono,fontSize:"11px",color:base?C.accent:dp>0?C.green:C.red,fontWeight:base?700:400,borderRight:`1px solid ${C.border}`}}>{dp===0?"기준(0%)":dp>0?`+${dp}%`:`${dp}%`}</td>
                    <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,fontWeight:base?700:400}}>{fM(adjSale*1000)}</td>
                    <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,color:adjProfit>0?C.green:C.red,fontWeight:base?700:400}}>{fM(adjProfit*1000)}</td>
                    <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,color:adjNPV>0?C.green:C.red,fontWeight:base?700:400}}>{fM(adjNPV*1000)}</td>
                    <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,color:adjIRR&&adjIRR*100>=+(apt.anlys.discountR)?C.green:C.red,fontWeight:base?700:400}}>{adjIRR!==null?fP(adjIRR*100)+"%":"—"}</td>
                    <td style={{padding:"7px 9px",textAlign:"right",fontFamily:C.mono,fontSize:"11px",borderRight:`1px solid ${C.border}`,color:adjPI>=1?C.green:C.red,fontWeight:base?700:400}}>{fP(adjPI,2)}</td>
                    <td style={{padding:"7px 9px",textAlign:"right",fontSize:"10px",fontWeight:600,color:adjNPV>0?C.green:C.red}}>{adjNPV>0?"✓ 타당":"✗ 미달"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// § APT-10. 산출내역 탭
// ════════════════════════════════════════════════════════════════
function AptFlowTab({apt,area,cost,rev,ana}){
  const FBox=({title,color,items,note})=>(
    <div style={{border:`2px solid ${color}20`,borderRadius:"9px",marginBottom:"7px",overflow:"hidden"}}>
      <div style={{padding:"6px 12px",background:`${color}12`,borderBottom:`1px solid ${color}20`}}>
        <span style={{fontSize:"11px",fontWeight:700,color}}>{title}</span>
      </div>
      <div style={{padding:"9px 12px"}}>
        {items.map(([l,v,s],i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"2px 0",borderBottom:i<items.length-1?`1px dashed ${C.faint}`:"none"}}>
            <span style={{fontSize:"10px",color:C.mid}}>{l}</span>
            <div style={{textAlign:"right"}}>
              <span style={{fontFamily:C.mono,fontSize:"12px",color,fontWeight:600}}>{v}</span>
              {s&&<span style={{fontSize:"9px",color:C.muted,marginLeft:"4px"}}>{s}</span>}
            </div>
          </div>
        ))}
        {note&&<div style={{marginTop:"6px",fontSize:"9px",color:C.muted,lineHeight:1.5,fontStyle:"italic"}}>{note}</div>}
      </div>
    </div>
  );

  return(
    <div>
      <div style={{padding:"9px 13px",background:C.tealBg,border:`1px solid ${C.teal}30`,borderRadius:"9px",marginBottom:"14px",fontSize:"11px",color:C.teal,lineHeight:1.7}}>
        <strong>🔁 산출내역:</strong> 모든 계산의 중간 값과 산식을 흐름도로 표시합니다. 입력값 변경 시 실시간 업데이트됩니다.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"16px",alignItems:"start"}}>

        {/* 1. 면적 흐름 */}
        <div>
          <div style={{fontSize:"12px",fontWeight:700,color:C_apt,marginBottom:"9px",paddingBottom:"5px",borderBottom:`2px solid ${C_apt}20`}}>📐 면적 산출</div>
          <FBox title="① 세대 구성 → 주거 면적" color={C_apt} items={[
            ["세대수 합계", `${area.totalUnits}세대`],
            ["전용면적 합계", `${area.tExcl.toFixed(0)}㎡`],
            ["공급면적 합계", `${area.tSupply.toFixed(0)}㎡`, "전용+주거공용"],
            ["계약면적 합계", `${area.tContract.toFixed(0)}㎡`, "계+지하주차장"],
          ]} note="공급면적=전용+코어공용+벽체공용"/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="② 비주거 면적" color={C.teal} items={[
            ["비주거 전용 합계", `${area.nrExcl.toFixed(0)}㎡`],
            ["비주거 소계", `${area.nrTot.toFixed(0)}㎡`, "전용+공용"],
          ]}/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="③ 주차대수 산정" color={C.green} items={[
            ["법정대수(주거)", `${area.legalResid}대`, `세대당${apt.parking.legalPerUnit}대×${area.totalUnits}`],
            ["법정대수(근생)", `${area.legalNonResi}대`, `${area.nrExcl.toFixed(0)}÷${apt.parking.legalNonResiM2}㎡`],
            ["계획대수", `${area.planTotal}대`, `법정×${apt.parking.planMult}배`],
            ["주차장면적", `${area.pkAreaTotal.toFixed(0)}㎡`, `×${apt.parking.areaPerSlot}㎡/대`],
          ]} note="서울시 주차장조례 별표1 기준"/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="④ 연면적 집계" color={C_apt} items={[
            ["지상(주거+근생)", `${area.gfaAbove.toFixed(0)}㎡`],
            ["지하(주차장)", `${area.gfaBelow.toFixed(0)}㎡`],
            ["전체 연면적", `${area.gfaTotal.toFixed(0)}㎡`],
            ["용적률산정용", `${area.gfaFar.toFixed(0)}㎡`, "지상합계"],
          ]}/>
        </div>

        {/* 2. 사업비 흐름 */}
        <div>
          <div style={{fontSize:"12px",fontWeight:700,color:C.amber,marginBottom:"9px",paddingBottom:"5px",borderBottom:`2px solid ${C.amber}20`}}>💰 사업비 산출</div>
          <FBox title="① 토지비" color={C.amber} items={[
            ["공시지가", `${fM(+(apt.cost.landPubPrice))}원/㎡`],
            ["대지면적", `${area.sN.toFixed(0)}㎡`],
            ["보정배율", `${apt.cost.landCorrFactor}배`],
            ["토지비", `${fM(cost.land*1000)}원`,"공시×면적×배율"],
          ]}/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="② 직접공사비" color={C.amber} items={[
            ["주거지상", `${fM(cost.aptA*1000)}원`,`${area.gfaAboveResid.toFixed(0)}㎡×${apt.cost.aptAbove}천×${apt.cost.corrAptAbove}`],
            ["주거지하", `${fM(cost.aptB*1000)}원`,`${area.gfaBelow.toFixed(0)}㎡×${apt.cost.aptBelow}천×${apt.cost.corrAptBelow}`],
            ["근린생활", `${fM(cost.nrA*1000)}원`,`${area.gfaAboveNR.toFixed(0)}㎡×${apt.cost.nonResiAbove}천`],
            ["주차장", `${fM(cost.pkA*1000)}원`,`${area.pkAreaTotal.toFixed(0)}㎡×${apt.cost.parkingAbove}천`],
            ["소계", `${fM(cost.directConstr*1000)}원`],
          ]}/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="③ 간접비" color={C.amber} items={[
            ["설계비", `${fM(cost.design*1000)}원`,`${fP(cost.designRate)}%×${apt.cost.corrIndirect}`],
            ["감리비", `${fM(cost.superv*1000)}원`,`${fP(cost.supervRate)}%×${apt.cost.corrIndirect}`],
            ["상수도", `${fM(cost.water*1000)}원`,`${area.totalUnits}세대`],
            ["하수도", `${fM(cost.sewer*1000)}원`,`오수발생량 기준`],
            ["소계", `${fM(cost.indirect*1000)}원`],
          ]} note="설계·감리비: 건축사협회 대가기준 자동"/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="④ TDC 산출" color={C.amber} items={[
            ["기준사업비", `${fM((cost.land+cost.directConstr+cost.indirect)*1000)}원`,"토지+공사+간접"],
            ["부대비(관리+판매)", `${fM(cost.other*1000)}원`,`${fP((+(apt.cost.mgmtR))+(+(apt.cost.salesR)))}%`],
            ["예비비", `${fM(cost.reserve*1000)}원`,`${apt.cost.reserveR}%`],
            ["TDC(금융전)", `${fM(cost.tdc*1000)}원`],
            ["금융비용", `${fM(cost.finance*1000)}원`,`연${apt.cost.loanR}%×${apt.cost.constPeriod}년÷2`],
            ["TDC 합계", `${fM(cost.tdcTotal*1000)}원`],
          ]}/>
        </div>

        {/* 3. 수입 흐름 */}
        <div>
          <div style={{fontSize:"12px",fontWeight:700,color:C.green,marginBottom:"9px",paddingBottom:"5px",borderBottom:`2px solid ${C.green}20`}}>📈 수입 산출</div>
          <FBox title="① 공동주택 분양수입" color={C.green} items={
            area.typeCalcs.map(t=>[
              `${t.typeLabel}㎡ × ${t.units}세대`,
              t.saleMode==="sale"?`${fM(t.tSupply.toFixed(0)*+(apt.types.find(x=>x.id===t.id)?.salePrice||0)*1000)}원`:"임대방식",
              t.saleMode==="sale"?`공급${t.tSupply.toFixed(0)}㎡×${apt.types.find(x=>x.id===t.id)?.salePrice||0}천/㎡`:`연${fM(t.annInc*1000)}원`,
            ])
          } note="공급면적(전용+주거공용) 기준 분양단가 적용"/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="② 비주거 분양수입" color={C.teal} items={
            rev.nrRevs.map(nr=>[nr.label,nr.saleMode==="sale"?`${fM(nr.inc*1000)}원`:"임대방식",nr.floor])
          }/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="③ 총 분양수입 → 스케줄" color={C.green} items={[
            ["총 분양수입", `${fM(rev.totalSale*1000)}원`],
            ["계약금(착공)", `${fM(rev.contractAmt*1000)}원`,`${apt.revenue.contractR}%`],
            ["중도금(공사중)", `${fM(rev.midAmt*1000)}원`,`${apt.revenue.midR}%`],
            ["잔금(준공)", `${fM(rev.balanceAmt*1000)}원`,`${apt.revenue.balanceR}%`],
          ]}/>
        </div>

        {/* 4. 분석 흐름 */}
        {ana&&<div>
          <div style={{fontSize:"12px",fontWeight:700,color:C.purple,marginBottom:"9px",paddingBottom:"5px",borderBottom:`2px solid ${C.purple}20`}}>🔍 사업성 분석</div>
          <FBox title="① 현금흐름 구성" color={C.purple} items={
            ana.cfs.map((cf,y)=>[(+(apt.cost.startYear)+y)+"년 ("+y+"년차)",`순: ${fM(cf.net*1000)}원`,`지출 ${fM(cf.out*1000)} / 수입 ${fM(cf.inc*1000)}`])
          } note="0년: 토지+계약금 / 중간: 공사+중도금 / 준공: 잔금"/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="② 현재가치 할인 (IRR 산출)" color={C.purple} items={[
            ["할인율(IRR기준)", `${apt.anlys.discountR}%`],
            ["지출 현재가치", `${fM(ana.pvOut*1000)}원`],
            ["수입 현재가치", `${fM(ana.pvInc*1000)}원`],
          ]} note="IRR = NPV가 0이 되는 할인율 (Newton-Raphson 반복)"/>
          <div style={{textAlign:"center",fontSize:"16px",color:C.muted,margin:"3px 0"}}>↓</div>
          <FBox title="③ 핵심 지표" color={C.purple} items={[
            ["NPV", `${fM(ana.NPV*1000)}원`, ana.NPV>0?"✓":"✗"],
            ["세전 IRR", ana.IRR!==null?`${fP(ana.IRR)}%`:"산출불가"],
            ["수익성지수 PI", fP(ana.PI,3), ana.PI>=1?"✓":"✗"],
            ["개발이익(금융전)", `${fM(ana.profit*1000)}원`, `${fP(ana.profitR)}%`],
          ]}/>
        </div>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// § APT-11. 검토기준 탭
// ════════════════════════════════════════════════════════════════
const C_apt="#6d28d9";
function AptCriteriaTab(){
  const thS={padding:"7px 10px",fontSize:"10px",color:C.muted,fontWeight:700,textAlign:"left",background:C.cardAlt,borderBottom:`1px solid ${C.border}`};
  const tdS={padding:"6px 10px",fontSize:"11px",borderBottom:`1px solid ${C.faint}`};

  return(
    <div>
      <div style={{padding:"9px 13px",background:C.purpleBg,border:`1px solid ${C.purple}30`,borderRadius:"9px",marginBottom:"14px",fontSize:"11px",color:C.purple,lineHeight:1.7}}>
        이 탭은 공동주택 사업성 검토기에서 적용하는 모든 기준값과 법적 근거를 한눈에 확인할 수 있습니다. 수정은 각 탭의 입력란에서 직접 가능합니다.
      </div>

      <Card title="공사비 기준단가" tag="2024 공공건축물 공사비 가이드라인" accentBar={C.amber}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>용도·구분</th><th style={{...thS,textAlign:"right"}}>기준단가(천원/㎡)</th><th style={{...thS,textAlign:"right"}}>보정계수</th><th style={thS}>비고·출처</th></tr></thead>
            <tbody>
              {[
                ["공동주택 지상","2,209","×1.1","2024 공공건축물 공사비 가이드라인 (서울시)"],
                ["공동주택 지하","1,144","×1.1","지상대비 약 52% 수준"],
                ["근린생활시설 지상","1,921","×1.0","업무·근생 평균값"],
                ["주차장","1,918","×1.0","지상형 공영주차장 기준"],
              ].map(([l,d,c,n])=>(
                <tr key={l}><td style={tdS}>{l}</td><td style={{...tdS,textAlign:"right",fontFamily:C.mono,fontWeight:600}}>{d}</td><td style={{...tdS,textAlign:"right",fontFamily:C.mono}}>{c}</td><td style={{...tdS,fontSize:"10px",color:C.muted}}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"8px",fontSize:"9px",color:C.muted}}>* 보정계수는 규모(30층 이상), 지역, 마감수준에 따라 조정. 샘플(30층, 안산시) 기준 ×1.1 적용.</div>
      </Card>

      <Card title="설계비 요율 (2종중급)" tag="건축사협회 건축설계 대가기준" accentBar={C.accent}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>직접공사비 구간</th><th style={{...thS,textAlign:"right"}}>설계 요율(%)</th><th style={{...thS,textAlign:"right"}}>감리 요율(%)</th><th style={thS}>종별</th></tr></thead>
            <tbody>
              {APT_DESIGN_BRACKETS.map((b,i)=>(
                <tr key={i}><td style={tdS}>{b.label}</td><td style={{...tdS,textAlign:"right",fontFamily:C.mono,fontWeight:600}}>{b.rate}</td><td style={{...tdS,textAlign:"right",fontFamily:C.mono}}>{APT_SUPERV_BRACKETS[i]?.rate}</td><td style={{...tdS,fontSize:"10px",color:C.purple}}>{b.kind} / {APT_SUPERV_BRACKETS[i]?.kind}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"8px",fontSize:"9px",color:C.muted}}>* 근거: 국토교통부 고시 「건축사업무 대가기준」. 보정계수 별도 적용.</div>
      </Card>

      <Card title="주차장 법정 기준" tag="서울시 주차장 설치 및 관리 조례 별표1" accentBar={C.green}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>용도</th><th style={thS}>법정 기준</th><th style={thS}>법적 근거</th></tr></thead>
            <tbody>
              {[
                ["공동주택 (85㎡ 이하)","세대당 1대","서울시 주차장조례 별표1"],
                ["공동주택 (85㎡ 초과)","세대당 1.2대","서울시 주차장조례 별표1"],
                ["근린생활시설","시설면적 134㎡당 1대","서울시 주차장조례 별표1"],
                ["업무시설","시설면적 150㎡당 1대","서울시 주차장조례 별표1"],
                ["계획 배수","법정의 1.2~1.5배 권장","통상 적용기준"],
              ].map(([l,s,n])=>(
                <tr key={l}><td style={{...tdS,fontWeight:600}}>{l}</td><td style={tdS}>{s}</td><td style={{...tdS,fontSize:"10px",color:C.purple}}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="부대비·예비비 요율" tag="인천도시공사·KDI 기준" accentBar={C.amber}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>항목</th><th style={{...thS,textAlign:"right"}}>적용 요율</th><th style={thS}>산정 기준</th><th style={thS}>출처</th></tr></thead>
            <tbody>
              {[
                ["일반관리비","5.73%","토지+공사비+간접비 합계","인천도시공사 기준"],
                ["판매비","0.27%","토지+공사비+간접비 합계","인천도시공사 기준"],
                ["예비비","10.0%","기준사업비(토지+공사+간접+부대)","KDI 예비타당성 기준"],
              ].map(([l,r,b,n])=>(
                <tr key={l}><td style={{...tdS,fontWeight:600}}>{l}</td><td style={{...tdS,textAlign:"right",fontFamily:C.mono,fontWeight:700}}>{r}</td><td style={tdS}>{b}</td><td style={{...tdS,fontSize:"10px",color:C.purple}}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="상하수도 원인자부담금 기준" tag="수도법 §71 · 하수도법 §61" accentBar={C.teal}>
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>항목</th><th style={thS}>산정 방식</th><th style={thS}>기준값</th><th style={thS}>법적 근거</th></tr></thead>
            <tbody>
              {[
                ["상수도 원인자부담금","세대수 × 세대당 부담금","531,930원/세대 (2024 안산시)","수도법 §71 · 지자체 고시"],
                ["하수도 원인자부담금","오수발생량 × 단위단가","900,480원/㎥ (서울)","하수도법 §61 · 조례"],
                ["오수발생량","세대수 × 세대당인원 × 원단위","0.28㎥/일/인 (공동주택)","하수정비기본계획"],
                ["세대당 거주인원","세대수 × 2.5인","2.5인/세대 (통계청 기준)","인구주택총조사"],
              ].map(([l,m,v,n])=>(
                <tr key={l}><td style={{...tdS,fontWeight:600}}>{l}</td><td style={tdS}>{m}</td><td style={{...tdS,fontFamily:C.mono,fontWeight:600}}>{v}</td><td style={{...tdS,fontSize:"10px",color:C.purple}}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="분양 스케줄 관행" tag="관행 기준" accentBar="#dc2626">
        <div style={{overflowX:"auto",border:`1px solid ${C.border}`,borderRadius:"8px"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><th style={thS}>구분</th><th style={{...thS,textAlign:"right"}}>통상 비율</th><th style={thS}>수취 시점</th><th style={thS}>비고</th></tr></thead>
            <tbody>
              {[["계약금","10%","착공 시","계약일로부터"],["중도금","50~60%","공사 중 균등분할","일반적으로 4~6회"],["잔금","30~40%","준공(입주) 시","등기 완료 기준"]].map(([l,r,t,n])=>(
                <tr key={l}><td style={{...tdS,fontWeight:600}}>{l}</td><td style={{...tdS,textAlign:"right",fontFamily:C.mono,fontWeight:700}}>{r}</td><td style={tdS}>{t}</td><td style={{...tdS,fontSize:"10px",color:C.muted}}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:"8px",fontSize:"9px",color:C.muted}}>* 타당성 단계 단순화: 계약금(10%)/중도금(50%)/잔금(40%) 적용. 실제 협약에 따라 조정.</div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// § APT-12. 공동주택 메인 컴포넌트
// ════════════════════════════════════════════════════════════════
const APT_TABS=[
  {id:"building",label:"건축개요",icon:"📐"},
  {id:"cost",    label:"사업비",  icon:"💰"},
  {id:"revenue", label:"분양수입",icon:"🏠"},
  {id:"analysis",label:"사업성분석",icon:"🔍"},
  {id:"flow",    label:"산출내역",icon:"🔁"},
  {id:"criteria",label:"검토기준",icon:"📋"},
];

function AptMode({onSwitch,user,authLoading,signIn,signOut,onSave,onLoad,lastSaved}){
  const[apt,aptDispatch]=useReducer(aptReducer,initAptState);
  const[showEum,setShowEum]=useState(false);

  const area=useMemo(()=>calcAptArea(apt),[apt.types,apt.nonResi,apt.parking,apt.siteInfo]);
  const cost=useMemo(()=>calcAptCost(apt,area),[apt,area]);
  const rev=useMemo(()=>calcAptRevenue(apt,area,cost),[apt,area,cost]);
  const ana=useMemo(()=>rev.totalSale>0&&cost.tdc>0?calcAptAnalysis(apt,cost,rev):null,[apt,cost,rev]);

  const totSale=rev.totalSale;
  const tdc=cost.tdcTotal;

  return(
    <div style={{fontFamily:C.sans,background:C.bg,color:C.text,minHeight:"100vh",fontSize:"13px"}}>
      {showEum&&<EumModal onClose={()=>setShowEum(false)}/>}

      {/* 헤더 */}
      <div style={{background:"#3b0764",padding:"11px 18px",display:"flex",alignItems:"center",gap:"13px",position:"sticky",top:0,zIndex:400,boxShadow:"0 2px 8px rgba(0,0,0,0.3)"}}>
        <div style={{width:"32px",height:"32px",background:C_apt,borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"18px"}}>🏠</div>
        <div style={{flex:1}}>
          <div style={{fontSize:"13px",fontWeight:700,color:"#f5f3ff",letterSpacing:"-0.02em"}}>
            공동주택 사업성 검토기
            {apt.projectName&&<span style={{fontSize:"11px",color:"#a78bfa",marginLeft:"8px"}}>— {apt.projectName}</span>}
          </div>
          <div style={{fontSize:"9px",color:"#7c3aed",letterSpacing:"0.04em"}}>Apartment Feasibility Simulator · v1.0</div>
        </div>
        {tdc>0&&totSale>0&&(
          <div style={{display:"flex",gap:"14px",flexWrap:"wrap"}}>
            {[["TDC",fM(tdc*1000)],["분양수입",fM(totSale*1000)],["IRR",ana?.IRR!==null?fP(ana.IRR)+"%":"—"]].map(([l,v])=>(
              <div key={l} style={{textAlign:"right"}}><div style={{fontSize:"8px",color:"#a78bfa"}}>{l}</div><div style={{fontSize:"12px",fontFamily:C.mono,color:"#f5f3ff",fontWeight:700}}>{v}</div></div>
            ))}
          </div>
        )}
      </div>

      {/* 인증 + 모드 전환 바 */}
      <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"6px 18px",display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",justifyContent:"flex-end"}}>
        <button onClick={()=>onSwitch("general")} style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 12px",borderRadius:"6px",border:`1.5px solid ${C_apt}`,background:C.purpleBg,color:C_apt,fontSize:"11px",fontWeight:700,cursor:"pointer",fontFamily:C.sans}}>
          🏢 일반건축물로 전환
        </button>
        <div style={{width:"1px",height:"18px",background:C.border}}/>
        <button onClick={onLoad} style={{padding:"4px 11px",borderRadius:"6px",border:`1.5px solid ${C.border}`,background:"#fff",color:C.mid,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600}}>📂 불러오기</button>
        <button onClick={onSave} style={{padding:"4px 11px",borderRadius:"6px",border:`1.5px solid ${C.accent}`,background:C.accentBg,color:C.accent,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600}}>💾 저장</button>
        {lastSaved&&<span style={{fontSize:"9px",color:C.muted}}>저장: {lastSaved}</span>}
        <div style={{width:"1px",height:"18px",background:C.border}}/>
        {user?(
          <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <span style={{fontSize:"11px",color:C.mid,fontWeight:600}}>{user.name}</span>
            <button onClick={signOut} style={{fontSize:"10px",padding:"3px 8px",borderRadius:"5px",border:`1px solid ${C.border}`,background:"#fff",color:C.muted,cursor:"pointer",fontFamily:C.sans}}>로그아웃</button>
          </div>
        ):(
          <button onClick={signIn} disabled={authLoading} style={{display:"flex",alignItems:"center",gap:"5px",padding:"4px 11px",borderRadius:"6px",border:`1.5px solid ${C.border}`,background:"#fff",color:C.mid,fontSize:"11px",fontFamily:C.sans,cursor:"pointer",fontWeight:600,opacity:authLoading?0.6:1}}>
            <svg width="13" height="13" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            {authLoading?"연결 중...":"Google 로그인"}
          </button>
        )}
      </div>

      {/* 탭 */}
      <div style={{background:"#fff",borderBottom:`1.5px solid ${C.border}`,padding:"0 18px",display:"flex",overflowX:"auto"}}>
        {APT_TABS.map(({id,label,icon})=>{
          const active=apt.aptActiveTab===id;
          return(
            <button key={id} onClick={()=>aptDispatch({type:"APT_TAB",p:id})}
              style={{padding:"10px 14px",background:"transparent",border:"none",borderBottom:active?`2.5px solid ${C_apt}`:"2.5px solid transparent",color:active?C_apt:C.muted,cursor:"pointer",fontSize:"11px",fontWeight:active?700:400,fontFamily:C.sans,transition:"all 0.15s",marginBottom:"-1.5px",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"4px"}}>
              <span>{icon}</span>{label}
            </button>
          );
        })}
      </div>

      {/* 콘텐츠 */}
      <div style={{maxWidth:"1100px",margin:"0 auto",padding:"14px"}}>
        {apt.aptActiveTab==="building" &&<AptBuildingTab apt={apt} dispatch={aptDispatch} area={area} onEum={()=>setShowEum(true)}/>}
        {apt.aptActiveTab==="cost"     &&<AptCostTab     apt={apt} dispatch={aptDispatch} area={area} cost={cost} onEum={()=>setShowEum(true)}/>}
        {apt.aptActiveTab==="revenue"  &&<AptRevenueTab  apt={apt} dispatch={aptDispatch} area={area} rev={rev}/>}
        {apt.aptActiveTab==="analysis" &&<AptAnalysisTab apt={apt} dispatch={aptDispatch} cost={cost} rev={rev} ana={ana}/>}
        {apt.aptActiveTab==="flow"     &&<AptFlowTab     apt={apt} area={area} cost={cost} rev={rev} ana={ana}/>}
        {apt.aptActiveTab==="criteria" &&<AptCriteriaTab/>}
      </div>

      <div style={{textAlign:"center",fontSize:"9px",color:C.muted,padding:"12px 0 24px",letterSpacing:"0.04em"}}>
        공동주택 사업성 검토기 v1.0 · 산출값은 타당성 검토 단계 참고용이며 실제 인허가·계약에 직접 적용 불가
      </div>
    </div>
  );
}


const TABS=[
  {id:"area",    label:"면적표",   icon:"📐"},
  {id:"cost",    label:"사업비",   icon:"💰"},
  {id:"rev",     label:"수익 계획",icon:"📊"},
  {id:"analysis",label:"사업성분석",icon:"🔍"},
  {id:"flow",    label:"산출내역", icon:"🔁"},
  {id:"refs",    label:"기준",     icon:"📋"},
];

export default function App(){
  const[mode,setMode]=useState("general"); // "general" | "apartment"
  const[state,dispatch]=useReducer(reducer,null,getInitState);
  const{siteMode,site,buildings,activeBldgId,activeTab,refs}=state;
  const D=useCallback((type,p)=>dispatch({type,p}),[]);

  // 인증
  const{user,loading:authLoading,signIn,signOut}=useAuth();

  // 저장/불러오기
  const[lastSaved,setLastSaved]=useState(null);
  const[saveMsg,setSaveMsg]=useState(null);
  const[showLoadModal,setShowLoadModal]=useState(false);
  const[projectList,setProjectList]=useState([]);
  const[loadingProjects,setLoadingProjects]=useState(false);

  const showMsg=(msg,isErr=false)=>{
    setSaveMsg(msg);
    setTimeout(()=>setSaveMsg(null),3000);
  };

  const handleSave=async()=>{
    if(user){
      // 클라우드 저장
      try{
        const projName=state.buildings?.[0]?.name||"프로젝트";
        await saveToCloud(user.uid, state, projName);
        const t=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
        setLastSaved(t);
        showMsg("✓ 클라우드 저장 완료");
      }catch(e){ showMsg("저장 실패: "+e.message, true); }
    } else {
      // 로컬 저장
      const ok=saveLocal(state);
      const t=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
      setLastSaved(t);
      showMsg(ok?"✓ 로컬 저장됨 (Google 로그인 시 클라우드 저장)":"저장 실패");
    }
  };

  const handleLoad=async()=>{
    if(user){
      // 클라우드 프로젝트 목록 표시
      setLoadingProjects(true);
      setShowLoadModal(true);
      try{
        const list=await loadProjectList(user.uid);
        setProjectList(list.sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt)));
      }catch(e){ showMsg("목록 불러오기 실패"); }
      setLoadingProjects(false);
    } else {
      // 로컬 불러오기
      const s=loadLocal();
      if(!s){ showMsg("저장된 데이터 없음 (Google 로그인 시 클라우드에서 불러오기)"); return; }
      showMsg("✓ 로컬에서 불러옴");
    }
  };

  const handleLoadProject=async(projectId)=>{
    try{
      const s=await loadFromCloud(user.uid, projectId);
      if(!s){ showMsg("불러오기 실패"); return; }
      dispatch({type:"LOAD_STATE", p:s});
      setShowLoadModal(false);
      showMsg("✓ 불러오기 완료");
    }catch(e){ showMsg("불러오기 실패: "+e.message); setShowLoadModal(false); }
  };

  const handleDeleteProject=async(projectId)=>{
    if(!window.confirm("이 프로젝트를 삭제하시겠습니까?")) return;
    try{
      await deleteProject(user.uid, projectId);
      setProjectList(prev=>prev.filter(p=>p.id!==projectId));
      showMsg("✓ 삭제됨");
    }catch(e){ showMsg("삭제 실패"); }
  };

  // 토지이음 모달
  const[showEum,setShowEum]=useState(false);

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

  // 분석 탭용 통합 계산 (산출내역에도 사용)
  const{anlys}=state;
  const totLoan=allCalcs.reduce((s,c)=>s+c.cost.loan,0);
  const totAnn=allCalcs.reduce((s,c)=>s+c.rev.annual,0);
  const totEq=totTDC-totLoan;
  const totSaleIncome=allCalcs.reduce((s,c)=>s+(c.rev.saleIncome||0),0);
  const totSaleProfit=allCalcs.reduce((s,c)=>s+(c.rev.saleProfit||0),0);
  const totSaleTDC=allCalcs.reduce((s,c)=>s+(c.rev.saleTDC||0),0);
  const totRentLoan=allCalcs.reduce((s,c)=>s+(c.rev.rentLoan||c.cost.loan),0);
  const globalAna=totTDC>0&&(totNOI!==0||totEq>0)
    ?calcAnalysis(totTDC,totEq,totLoan,totNOI,totAnn,anlys,{saleIncome:totSaleIncome,saleProfit:totSaleProfit,saleTDC:totSaleTDC,rentLoan:totRentLoan})
    :null;

  // 공동주택 모드
  if(mode==="apartment") return(
    <AptMode onSwitch={setMode} user={user} authLoading={authLoading}
      signIn={signIn} signOut={signOut}
      onSave={handleSave} onLoad={handleLoad} lastSaved={lastSaved}/>
  );

  return(
    <div style={{fontFamily:C.sans,background:C.bg,color:C.text,minHeight:"100vh",fontSize:"13px"}}>
      {/* 토지이음 모달 */}
      {showEum&&<EumModal onClose={()=>setShowEum(false)}/>}

      {/* 프로젝트 불러오기 모달 */}
      {showLoadModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9000,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
          <div style={{background:"#fff",borderRadius:"12px",boxShadow:"0 20px 60px rgba(0,0,0,0.3)",width:"min(560px,95vw)",maxHeight:"80vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
              <span style={{fontSize:"16px"}}>📂</span>
              <div style={{flex:1}}>
                <div style={{fontSize:"13px",fontWeight:700}}>저장된 프로젝트</div>
                <div style={{fontSize:"10px",color:C.muted}}>클라우드에 저장된 프로젝트를 불러옵니다</div>
              </div>
              <button onClick={()=>setShowLoadModal(false)} style={{width:"28px",height:"28px",borderRadius:"50%",border:`1px solid ${C.border}`,background:"#fff",cursor:"pointer",fontSize:"16px",fontWeight:700,fontFamily:C.sans}}>×</button>
            </div>
            <div style={{overflowY:"auto",padding:"12px"}}>
              {loadingProjects?(
                <div style={{textAlign:"center",padding:"30px",color:C.muted}}>불러오는 중...</div>
              ):projectList.length===0?(
                <div style={{textAlign:"center",padding:"30px",color:C.muted}}>저장된 프로젝트가 없습니다</div>
              ):(
                projectList.map(p=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"11px 14px",borderRadius:"8px",border:`1px solid ${C.border}`,marginBottom:"8px",background:"#fff"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:"13px",fontWeight:600,color:C.text}}>{p.name}</div>
                      <div style={{fontSize:"10px",color:C.muted,marginTop:"2px"}}>저장: {p.savedAt||"—"}</div>
                    </div>
                    <button onClick={()=>handleLoadProject(p.id)} style={{padding:"5px 14px",borderRadius:"6px",border:`1.5px solid ${C.accent}`,background:C.accentBg,color:C.accent,fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:C.sans}}>불러오기</button>
                    <button onClick={()=>handleDeleteProject(p.id)} style={{padding:"5px 10px",borderRadius:"6px",border:`1px solid ${C.border}`,background:"#fff",color:C.red,fontSize:"11px",cursor:"pointer",fontFamily:C.sans}}>삭제</button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 저장 피드백 토스트 */}
      {saveMsg&&(
        <div style={{position:"fixed",bottom:"24px",right:"24px",zIndex:9999,padding:"10px 18px",borderRadius:"9px",background:C.hdr,color:"#fff",fontSize:"13px",fontWeight:600,boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>
          {saveMsg}
        </div>
      )}

      {/* 헤더 */}
      <div style={{background:C.hdr,padding:"11px 18px",display:"flex",alignItems:"center",gap:"13px",position:"sticky",top:0,zIndex:400,boxShadow:"0 2px 8px rgba(0,0,0,0.3)"}}>
        <div style={{width:"32px",height:"32px",background:C.accent,borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="7" height="16" stroke="#fff" strokeWidth="1.5"/><rect x="11" y="7" width="7" height="11" stroke="#fff" strokeWidth="1.5"/><line x1="1" y1="19" x2="19" y2="19" stroke="#fff" strokeWidth="1.5"/></svg>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:"13px",fontWeight:700,color:C.hdrText,letterSpacing:"-0.02em"}}>건축사업 사업성 검토기</div>
          <div style={{fontSize:"9px",color:"#64748b",letterSpacing:"0.04em"}}>v6.0 · {refs.region} 기준</div>
        </div>
        {totTDC>0&&(
          <div style={{display:"flex",gap:"14px",flexWrap:"wrap"}}>
            {[
              ["TDC",fM(totTDC)],
              ...(totSaleAll>0?[["분양수입",fM(totSaleAll)]]:[] ),
              ["NOI/년",fM(totNOI)],
              ["Cap Rate",cap>0?fP(cap)+"%":"—"],
            ].map(([l,v])=>(
              <div key={l} style={{textAlign:"right"}}>
                <div style={{fontSize:"8px",color:"#64748b"}}>{l}</div>
                <div style={{fontSize:"12px",fontFamily:C.mono,color:"#e2e8f0",fontWeight:700}}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 인증 + 저장 바 */}
      <AuthBar user={user} loading={authLoading} signIn={signIn} signOut={signOut}
        onSave={handleSave} onLoad={handleLoad} lastSaved={lastSaved}
        onModeSwitch={setMode} saveMsg={saveMsg}/>

      {/* 대지 모드 */}
      <div style={{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"7px 18px",display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
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
      <div style={{background:"#fff",borderBottom:`2px solid ${C.border}`,padding:"7px 18px",display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap"}}>
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
                  {Object.entries(BT).map(([k,btt])=><option key={k} value={k}>{btt.short}</option>)}
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
          const isFlow=id==="flow";
          const active=activeTab===id;
          const accentColor=isRefs?C.purple:isFlow?C.teal:bt.color;
          return(
            <button key={id} onClick={()=>D("TAB",id)} style={{padding:"10px 14px",background:"transparent",border:"none",borderBottom:active?`2.5px solid ${accentColor}`:"2.5px solid transparent",color:active?accentColor:C.muted,cursor:"pointer",fontSize:"11px",fontWeight:active?700:400,fontFamily:C.sans,transition:"all 0.15s",marginBottom:"-1.5px",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"4px"}}>
              <span>{icon}</span>{label}
              {isRefs&&<span style={{fontSize:"8px",background:C.purpleBg,color:C.purple,padding:"1px 4px",borderRadius:"3px",fontWeight:700}}>법정기준</span>}
              {isFlow&&<span style={{fontSize:"8px",background:C.tealBg,color:C.teal,padding:"1px 4px",borderRadius:"3px",fontWeight:700}}>NEW</span>}
            </button>
          );
        })}
      </div>

      {/* 콘텐츠 */}
      <div style={{maxWidth:"1100px",margin:"0 auto",padding:"14px"}}>
        {activeTab==="area"     &&activeCalc&&<AreaTab     state={state} dispatch={dispatch} bldg={activeBldg} area={activeCalc.area} allCalcs={allCalcs}/>}
        {activeTab==="cost"     &&activeCalc&&<CostTab     bldg={activeBldg} dispatch={dispatch} area={activeCalc.area} refs={refs} onEum={()=>setShowEum(true)}/>}
        {activeTab==="rev"      &&activeCalc&&<RevTab      bldg={activeBldg} dispatch={dispatch} area={activeCalc.area} cost={activeCalc.cost}/>}
        {activeTab==="analysis"            &&<AnalysisTab state={state} dispatch={dispatch} allCalcs={allCalcs}/>}
        {activeTab==="flow"     &&activeCalc&&(
          <div>
            <div style={{padding:"10px 14px",background:C.tealBg,border:`1px solid ${C.teal}30`,borderRadius:"10px",marginBottom:"14px",fontSize:"11px",color:C.teal,lineHeight:1.7}}>
              <strong>🔁 산출내역 탭:</strong> 면적 → 사업비 → 수익 → 사업성 분석까지 모든 계산의 중간 값과 흐름을 한눈에 확인합니다.
              현재 선택된 건물(<strong>{activeBldg.name}</strong>)의 단일 계산 흐름을 표시합니다.
            </div>
            <CalcFlowTab
              bldg={activeBldg}
              area={activeCalc.area}
              cost={activeCalc.cost}
              rev={activeCalc.rev}
              ana={globalAna}
              anlys={anlys}
            />
          </div>
        )}
        {activeTab==="refs"                &&<RefsTab     state={state} dispatch={dispatch}/>}
      </div>

      <div style={{textAlign:"center",fontSize:"9px",color:C.muted,padding:"12px 0 24px",letterSpacing:"0.04em"}}>
        건축사업 사업성 검토기 v6.0 · {refs.region} 기준 · 산출값은 타당성 검토 단계 참고용이며 실제 인허가·계약에 직접 적용 불가
      </div>
    </div>
  );
}

