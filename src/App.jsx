import { useState, useEffect } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const FUEL_TYPES = ["Regular", "Midgrade", "Premium", "Diesel"];
const TANK_PCTS = ["25%", "50%", "75%", "Full"];
const BUFFER_OPTS = [25, 40, 50, 60, 100];
const DETOUR_OPTS = [2, 5, 10, 15];
const OPT_MODES = [
  { key: "cheapest", label: "Cheapest Fuel", icon: "ti-coin" },
  { key: "balanced", label: "Best Balance", icon: "ti-scale" },
  { key: "fastest", label: "Fastest Trip", icon: "ti-bolt" },
  { key: "rated", label: "Top Rated", icon: "ti-star" },
];

const POPULAR_ROUTES = [
  { origin: "Los Angeles, CA", dest: "Las Vegas, NV", miles: 270 },
  { origin: "New York, NY", dest: "Boston, MA", miles: 215 },
  { origin: "Chicago, IL", dest: "Detroit, MI", miles: 280 },
  { origin: "Denver, CO", dest: "Salt Lake City, UT", miles: 370 },
  { origin: "Dallas, TX", dest: "Houston, TX", miles: 240 },
  { origin: "Seattle, WA", dest: "Portland, OR", miles: 175 },
  { origin: "Miami, FL", dest: "Orlando, FL", miles: 235 },
  { origin: "Edwards, CO", dest: "Las Vegas, NV", miles: 500 },
  { origin: "San Francisco, CA", dest: "Los Angeles, CA", miles: 380 },
  { origin: "Phoenix, AZ", dest: "Tucson, AZ", miles: 115 },
  { origin: "Asheville, NC", dest: "Edwards, CO", miles: 1680 },
];

// Simulated EPA database — Phase 2 replaces with real EPA API
const EPA_DB = {
  "2022|Lexus|RX 350|AWD":      { city:19, hwy:26, combined:22, tank:19.2, fuel:"Midgrade" },
  "2022|Lexus|RX 350|FWD":      { city:20, hwy:27, combined:22, tank:17.4, fuel:"Midgrade" },
  "2023|Toyota|Camry|SE":       { city:28, hwy:39, combined:32, tank:14.5, fuel:"Regular" },
  "2023|Toyota|Camry|XSE V6":   { city:22, hwy:33, combined:26, tank:14.5, fuel:"Regular" },
  "2021|Ford|F-150|XLT":        { city:17, hwy:24, combined:20, tank:23.0, fuel:"Regular" },
  "2021|Ford|F-150|Raptor":     { city:15, hwy:18, combined:16, tank:26.0, fuel:"Regular" },
  "2022|Honda|CR-V|EX":         { city:28, hwy:34, combined:30, tank:14.0, fuel:"Regular" },
  "2022|Honda|CR-V|Sport":      { city:26, hwy:32, combined:28, tank:14.0, fuel:"Regular" },
  "2023|Chevrolet|Tahoe|LT":    { city:15, hwy:20, combined:17, tank:24.0, fuel:"Regular" },
  "2022|Toyota|RAV4|XLE":       { city:27, hwy:35, combined:30, tank:14.5, fuel:"Regular" },
  "2023|BMW|X5|xDrive40i":      { city:21, hwy:26, combined:23, tank:21.9, fuel:"Premium" },
  "2022|Jeep|Wrangler|Sport":   { city:17, hwy:25, combined:20, tank:17.5, fuel:"Regular" },
  "2021|Ram|1500|Laramie":      { city:17, hwy:22, combined:19, tank:22.0, fuel:"Regular" },
  "2023|Hyundai|Tucson|SEL":    { city:26, hwy:33, combined:29, tank:14.3, fuel:"Regular" },
  "2022|Subaru|Outback|Premium":{ city:26, hwy:33, combined:29, tank:18.5, fuel:"Regular" },
  "2018|Toyota|4Runner|SR5":    { city:16, hwy:19, combined:17, tank:23.0, fuel:"Regular" },
  "2018|Toyota|4Runner|TRD Off-Road": { city:16, hwy:19, combined:17, tank:23.0, fuel:"Regular" },
  "2018|Toyota|4Runner|Limited":{ city:16, hwy:19, combined:17, tank:23.0, fuel:"Regular" },
  "2018|Toyota|4Runner|TRD Pro":{ city:16, hwy:19, combined:17, tank:23.0, fuel:"Regular" },
};

const MAKES = ["Acura","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","Genesis","GMC","Honda","Hyundai","Infiniti","Jeep","Kia","Lexus","Lincoln","Mazda","Mercedes-Benz","Nissan","Ram","Subaru","Tesla","Toyota","Volkswagen","Volvo"];
const REAL_WORLD_FACTOR = 0.88;
const USABLE_TANK_FACTOR = 0.86;

const STATE_PRICE_MULT = {
  CA:1.28, HI:1.35, WA:1.15, OR:1.12, NV:1.08, AZ:1.02, UT:1.04,
  CO:1.05, TX:0.92, FL:0.97, GA:0.90, NY:1.18, MA:1.10, IL:1.06,
  MI:1.03, OH:0.95, PA:1.04, DEFAULT:1.00,
};
const BASE_PRICES = { regular:3.35, midgrade:3.55, premium:3.75, diesel:3.65 };

// ─── FUEL ENGINE ─────────────────────────────────────────────────────────────

function extractState(s) {
  const p = s.split(",");
  return p.length > 1 ? p[p.length-1].trim() : "DEFAULT";
}

function getPrice(city, fuelType) {
  const st = extractState(city);
  const mult = STATE_PRICE_MULT[st] || 1.0;
  const base = BASE_PRICES[fuelType.toLowerCase()] || 3.35;
  return Math.round((base * mult + (Math.random()-0.5)*0.1) * 100) / 100;
}

const MID_CITIES = {
  "CA-NV": ["Barstow, CA","Baker, CA"],
  "CO-NV": ["Grand Junction, CO","Green River, UT","Salina, UT","Beaver, UT","St. George, UT","Mesquite, NV"],
  "CO-UT": ["Glenwood Springs, CO","Price, UT","Helper, UT"],
  "TX-TX": ["Waco, TX","Corsicana, TX","Hillsboro, TX"],
  "FL-FL": ["Fort Lauderdale, FL","West Palm Beach, FL","Vero Beach, FL"],
  "WA-OR": ["Olympia, WA","Longview, WA"],
  "NY-MA": ["Hartford, CT","Providence, RI"],
  "IL-MI": ["Gary, IN","Kalamazoo, MI","Battle Creek, MI"],
  "CA-CA": ["Santa Barbara, CA","San Luis Obispo, CA","Paso Robles, CA","King City, CA"],
  "NC-CO": ["Knoxville, TN","Nashville, TN","Memphis, TN","Little Rock, AR","Oklahoma City, OK","Amarillo, TX","Raton, NM","Walsenburg, CO"],
};
const STATIONS = ["Maverick","Pilot Travel Center","Flying J","Love's","Kwik Trip","Sheetz","Casey's","Circle K","Shell","Chevron","Sinclair"];

function buildSegs(origin, dest, miles, fuelType) {
  const oSt = extractState(origin), dSt = extractState(dest);
  const key = `${oSt}-${dSt}`;
  const pool = MID_CITIES[key] || [];
  const count = Math.max(2, Math.min(7, Math.floor(miles / 80)));
  const oCity = origin.split(",")[0];
  return Array.from({length: count}, (_, i) => {
    const frac = (i+1)/(count+1);
    const city = pool[i] || `${frac<0.5 ? oCity+" area" : dest.split(",")[0]+" outskirts"}, ${frac<0.5 ? oSt : dSt}`;
    return {
      city, miles: Math.round(frac*miles),
      stationName: STATIONS[Math.floor(Math.random()*STATIONS.length)],
      detourMin: [1,2,3,4,5][Math.floor(Math.random()*5)],
      detourMiles: Math.round(Math.random()*3*10)/10,
      rating: Math.round((3.2+Math.random()*1.5)*10)/10,
      hasFood: Math.random()>0.3, hasBath: Math.random()>0.1,
      price: getPrice(city, fuelType),
      updatedMinsAgo: Math.floor(Math.random()*120)+5,
    };
  });
}

const tankRatio = {"25%":0.25,"50%":0.5,"75%":0.75,"Full":1.0};

function runEngine(trip, segsOverride) {
  const { origin, destination, totalMiles, mpg, usableTank, fuelType, tankPct, bufferMiles, maxDetour, optimization } = trip;
  const segs = segsOverride || buildSegs(origin, destination, totalMiles, fuelType);
  let fuel = usableTank * (tankRatio[tankPct]||1);
  let range = fuel * mpg;
  let milesDone = 0;
  const stops=[], warnings=[];
  let optCost=0, detourTotal=0;
  const avgPrice = segs.reduce((s,r)=>s+r.price,0)/segs.length;
  const baseline = (totalMiles/mpg)*avgPrice;

  for (let i=0; i<segs.length; i++) {
    const seg = segs[i];
    if (seg.detourMin > maxDetour && optimization !== "cheapest") continue;
    const dist = seg.miles - milesDone;
    const roa = range - dist; // range on arrival
    const next = segs[i+1];
    const distNext = next ? next.miles-seg.miles : totalMiles-seg.miles;
    const nextPrice = next ? next.price : seg.price*1.1;
    const ran = roa - distNext; // range after next
    const pricier = nextPrice > seg.price*1.04;
    const cheaper = nextPrice < seg.price*0.96;
    let action="skip", gallons=0, reason="";
    const must = roa < bufferMiles*1.5 || ran < bufferMiles;

    if (must) {
      const fa = Math.max(0, roa/mpg);
      gallons = Math.max(0.5, Math.ceil((distNext/mpg + bufferMiles/mpg - fa)*2)/2);
      action="stop";
      reason = ran < bufferMiles
        ? `Range will drop below your ${bufferMiles}-mile buffer — fueling here is essential.`
        : `Low range approaching — fueling here maintains your ${bufferMiles}-mile safety buffer.`;
    } else if ((pricier && optimization!=="fastest") || optimization==="cheapest") {
      if (!cheaper) {
        const fa = Math.max(0, roa/mpg);
        gallons = Math.ceil(Math.min(usableTank-fa, usableTank*0.85)*2)/2;
        if (gallons>=3) { action="stop"; reason=`Price rises to $${nextPrice.toFixed(2)}/gal ahead. Smart to fill at $${seg.price.toFixed(2)}/gal here.`; }
      }
    } else if (cheaper && ran > bufferMiles*1.5) {
      action="skip";
    }

    if (action==="stop") {
      const fa = Math.max(0, roa/mpg);
      const cost = gallons*seg.price;
      optCost+=cost; detourTotal+=seg.detourMin;
      stops.push({...seg, stopNum:stops.length+1, gallons, cost, rangeOnArrival:Math.round(roa), rangeAfterFill:Math.round(Math.min(usableTank,fa+gallons)*mpg), reason, isPartial:gallons<usableTank*0.5, filled:false, skipped:false});
      fuel = Math.min(usableTank, fa+gallons);
      range = fuel*mpg;
      milesDone = seg.miles;
    }
  }

  if (stops.length===0) warnings.push({type:"info", msg:`Your ${Math.round(range)}-mile range covers this entire route — no fuel stops needed!`});
  if (range-(totalMiles-milesDone) < bufferMiles) warnings.push({type:"warn", msg:"Fuel may be tight on the final stretch. Consider topping off at your last recommended stop."});

  const savings = Math.max(0, baseline-optCost);
  return { stops, warnings, segs,
    summary:{ totalMiles, totalGallons:Math.round(totalMiles/mpg*10)/10, baseline:Math.round(baseline*100)/100, optCost:Math.round(optCost*100)/100, savings:Math.round(savings*100)/100, detourTotal, stopCount:stops.length, lowestRange:stops.length?Math.min(...stops.map(s=>s.rangeOnArrival)):Math.round(range) }
  };
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
function ls(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function ss(k,v) { try { localStorage.setItem(k,JSON.stringify(v)); } catch {} }

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg:"#eef2f7",
  surface:"#ffffff",
  card:"#ffffff",
  border:"#d0dcea",
  borderMed:"#b0c4de",
  blue:"#1a3a6b",
  blueMid:"#2556a0",
  blueLight:"#3b7fd4",
  blueDim:"rgba(37,86,160,0.08)",
  blueBorder:"rgba(37,86,160,0.25)",
  teal:"#00a878",
  tealDim:"rgba(0,168,120,0.10)",
  tealBorder:"rgba(0,168,120,0.30)",
  red:"#d93025", redDim:"rgba(217,48,37,0.08)",
  amber:"#e07b00", amberDim:"rgba(224,123,0,0.09)",
  purple:"#6d28d9", purpleDim:"rgba(109,40,217,0.08)",
  text:"#1a2b3c",
  muted:"#4a6380",
  hint:"#8fa8c0",
  green:"#00a878", greenDim:"rgba(0,168,120,0.10)", greenBorder:"rgba(0,168,120,0.30)",
};

const gCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:${C.bg};font-family:'Plus Jakarta Sans',sans-serif;color:${C.text};}
  input,select{background:#fff;border:1.5px solid ${C.border};border-radius:10px;color:${C.text};font-family:inherit;font-size:14px;padding:10px 14px;width:100%;outline:none;transition:border 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
  input:focus,select:focus{border-color:${C.blueLight};box-shadow:0 0 0 3px rgba(59,127,212,0.12);}
  input::placeholder{color:${C.hint};}
  button{cursor:pointer;font-family:inherit;}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
`;

// ─── ATOMS ───────────────────────────────────────────────────────────────────

const Lbl = ({children, hint}) => (
  <div style={{marginBottom:8}}>
    <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase",marginBottom:hint?3:0}}>{children}</div>
    {hint && <div style={{fontSize:12,color:C.hint}}>{hint}</div>}
  </div>
);

const Chip = ({active, onClick, children, sm, color}) => {
  const ac = color==="blue"?C.blueMid:color==="amber"?C.amber:color==="purple"?C.purple:C.teal;
  const ab = color==="blue"?C.blueDim:color==="amber"?C.amberDim:color==="purple"?C.purpleDim:C.tealDim;
  return <button onClick={onClick} style={{padding:sm?"6px 11px":"8px 15px",borderRadius:8,fontSize:sm?12:13,fontWeight:active?600:400,border:`1.5px solid ${active?ac:C.border}`,background:active?ab:"#fff",color:active?ac:C.muted,transition:"all 0.15s",whiteSpace:"nowrap",boxShadow:active?"none":"0 1px 2px rgba(0,0,0,0.04)"}}>{children}</button>;
};

const PBtn = ({onClick,children,disabled,full,sm}) => (
  <button onClick={onClick} disabled={disabled} style={{background:disabled?"#b0c4de":`linear-gradient(135deg,${C.blueMid},${C.blue})`,color:"#fff",border:"none",borderRadius:10,padding:sm?"9px 18px":"13px 24px",fontSize:sm?13:15,fontWeight:600,width:full?"100%":"auto",opacity:disabled?0.6:1,cursor:disabled?"not-allowed":"pointer",transition:"all 0.15s",boxShadow:disabled?"none":"0 2px 8px rgba(26,58,107,0.25)"}}>{children}</button>
);

const GBtn = ({onClick,children}) => (
  <button onClick={onClick} style={{background:"#fff",border:`1.5px solid ${C.border}`,color:C.blueMid,borderRadius:10,padding:"12px 20px",fontSize:14,fontWeight:600}}>{children}</button>
);

const Card = ({children,style,accent,blue}) => (
  <div style={{background:C.card,border:`1.5px solid ${accent?C.tealBorder:blue?C.blueBorder:C.border}`,borderRadius:14,padding:18,boxShadow:"0 1px 6px rgba(0,0,0,0.06)",...style}}>{children}</div>
);

const Stat = ({label,value,accent,warn,blue,sm}) => (
  <div>
    <div style={{fontSize:10,color:C.muted,letterSpacing:"0.5px",textTransform:"uppercase",marginBottom:3}}>{label}</div>
    <div style={{fontSize:sm?15:20,fontWeight:700,color:accent?C.teal:warn?C.red:blue?C.blueMid:C.text}}>{value}</div>
  </div>
);

const Tag = ({children,color="green"}) => {
  const m={green:[C.tealDim,C.teal],blue:[C.blueDim,C.blueMid],amber:[C.amberDim,C.amber],red:[C.redDim,C.red],purple:[C.purpleDim,C.purple]};
  const [bg,fg]=m[color]||m.green;
  return <span style={{background:bg,color:fg,border:`1px solid ${fg}44`,borderRadius:6,fontSize:11,fontWeight:600,padding:"3px 8px"}}>{children}</span>;
};

const Divider = ({style}) => <div style={{height:1,background:C.border,opacity:0.7,...style}} />;

const Field = ({label,value,onChange,placeholder,suffix,hint,type="text",readOnly,autoFilled}) => (
  <div style={{marginBottom:16}}>
    {label && (
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase"}}>{label}</div>
        {autoFilled && <span style={{fontSize:10,background:C.greenDim,color:C.green,border:`1px solid ${C.greenBorder}`,borderRadius:4,padding:"1px 6px",fontWeight:600}}>AUTO-FILLED</span>}
      </div>
    )}
    {hint && <div style={{fontSize:12,color:C.hint,marginBottom:6}}>{hint}</div>}
    <div style={{position:"relative"}}>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly}
        style={{paddingRight:suffix?44:14,background:autoFilled?"rgba(0,200,150,0.05)":C.surface,borderColor:autoFilled?C.greenBorder:C.border}} />
      {suffix && <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>{suffix}</span>}
    </div>
  </div>
);

const Spinner = () => <div style={{width:16,height:16,border:`2px solid ${C.border}`,borderTopColor:C.blueMid,borderRadius:"50%",animation:"spin 0.7s linear infinite",display:"inline-block"}} />;

// ─── STEP BAR ────────────────────────────────────────────────────────────────

function StepBar({step, onGoTo}) {
  const steps=["Route","Vehicle","Preferences","Results"];
  return (
    <div style={{display:"flex",alignItems:"center",marginBottom:28}}>
      {steps.map((s,i) => (
        <div key={i} style={{display:"flex",alignItems:"center",flex:i<steps.length-1?1:"none"}}>
          <button onClick={()=>i<step&&onGoTo(i)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:i<step?"pointer":"default",opacity:i>step?0.35:1}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:i<step?C.teal:i===step?C.blueDim:C.surface,border:`2px solid ${i<step?C.teal:i===step?C.blueMid:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:i<step?"#fff":i===step?C.blueMid:C.muted,transition:"all 0.3s"}}>
              {i<step?"✓":i+1}
            </div>
            <div style={{fontSize:10,fontWeight:600,color:i===step?C.blueMid:C.muted,letterSpacing:"0.4px",whiteSpace:"nowrap"}}>{s}</div>
          </button>
          {i<steps.length-1 && <div style={{flex:1,height:2,background:i<step?C.teal:C.border,margin:"0 4px",marginBottom:18,transition:"background 0.3s"}} />}
        </div>
      ))}
    </div>
  );
}

// ─── STEP 1: ROUTE ───────────────────────────────────────────────────────────

function StepRoute({data, onChange, onNext}) {
  const [showPop, setShowPop] = useState(false);
  const ready = data.origin && data.destination && data.totalMiles;
  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Plan your route</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:24}}>Enter any US origin and destination</p>
      <Field label="Starting Point" value={data.origin} onChange={e=>onChange({origin:e.target.value})} placeholder="e.g. Denver, CO" />
      <Field label="Destination" value={data.destination} onChange={e=>onChange({destination:e.target.value})} placeholder="e.g. Salt Lake City, UT" />
      <Field label="Approximate Miles" value={data.totalMiles} onChange={e=>onChange({totalMiles:parseInt(e.target.value)||""})} placeholder="e.g. 370" suffix="mi" type="number" hint="Look up in Google Maps — Phase 2 will auto-fill this from the addresses above" />
      <button onClick={()=>setShowPop(s=>!s)} style={{background:"none",border:`1px dashed ${C.border}`,color:C.muted,borderRadius:10,padding:"10px 16px",fontSize:13,width:"100%",marginBottom:12}}>
        {showPop?"▲ Hide popular routes":"▼ Pick a popular route to demo"}
      </button>
      {showPop && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {POPULAR_ROUTES.map((r,i) => (
            <button key={i} onClick={()=>{onChange({origin:r.origin,destination:r.dest,totalMiles:r.miles});setShowPop(false);}} style={{background:"#f5f8fc",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"left",color:C.text,fontSize:12}}>
              <div style={{fontWeight:600,marginBottom:2}}>{r.origin.split(",")[0]} → {r.dest.split(",")[0]}</div>
              <div style={{color:C.muted,fontSize:11}}>{r.miles} miles</div>
            </button>
          ))}
        </div>
      )}
      {ready && (
        <Card accent style={{marginBottom:20}}>
          <div style={{fontSize:11,color:C.teal,letterSpacing:"0.5px",marginBottom:12}}>ROUTE PREVIEW</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            <Stat label="Distance" value={`${data.totalMiles} mi`} />
            <Stat label="Est. Drive Time" value={`~${Math.round(data.totalMiles/65*10)/10}h`} />
            <Stat label="Est. Fuel Stops" value={`${Math.max(0,Math.floor(data.totalMiles/280))}–${Math.ceil(data.totalMiles/180)}`} />
          </div>
        </Card>
      )}
      <PBtn onClick={onNext} disabled={!ready} full>Continue to Vehicle →</PBtn>
    </div>
  );
}

// ─── STEP 2: VEHICLE ─────────────────────────────────────────────────────────

function StepVehicle({data, onChange, onNext, onBack, saved, onSave}) {
  const [showSaved, setShowSaved] = useState(false);
  const [epaStatus, setEpaStatus] = useState("idle"); // idle | loading | found | notfound

  // EPA lookup when year+make+model+trim filled
  useEffect(() => {
    if (!data.year || !data.make || !data.model || !data.trim) { setEpaStatus("idle"); return; }
    const key = `${data.year}|${data.make}|${data.model}|${data.trim}`;
    const match = EPA_DB[key];
    if (!match) { setEpaStatus("notfound"); return; }
    setEpaStatus("loading");
    const t = setTimeout(() => {
      onChange({
        epaCombined: match.combined, epaCity: match.city, epaHwy: match.hwy,
        listedTank: String(match.tank), fuelType: match.fuel,
        mpg: data.mpgLocked ? data.mpg : String(Math.round(match.combined * REAL_WORLD_FACTOR * 10)/10),
        usableTank: data.tankLocked ? data.usableTank : String(Math.round(match.tank * USABLE_TANK_FACTOR * 10)/10),
      });
      setEpaStatus("found");
    }, 700);
    return () => clearTimeout(t);
  }, [data.year, data.make, data.model, data.trim]);

  const mpg = parseFloat(data.mpg)||0;
  const usable = parseFloat(data.usableTank)||0;
  const listed = parseFloat(data.listedTank)||0;
  const practical = Math.round(mpg*usable);
  const reserve = Math.round((listed-usable)*10)/10;
  const reserveRange = Math.round(reserve*mpg);
  const curFuel = Math.round(usable*(tankRatio[data.tankPct]||1)*10)/10;
  const curRange = Math.round(curFuel*mpg);
  const ready = data.mpg && data.usableTank && data.fuelType;

  const availTrims = Object.keys(EPA_DB).filter(k=>k.startsWith(`${data.year}|${data.make}|${data.model}|`)).map(k=>k.split("|")[3]);

  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Your vehicle</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:20}}>Specs auto-fill from EPA database when year/make/model/trim match</p>

      {saved.length>0 && (
        <button onClick={()=>setShowSaved(s=>!s)} style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,color:C.teal,borderRadius:10,padding:"10px 16px",fontSize:13,width:"100%",marginBottom:10,fontWeight:600}}>
          ⭐ Load saved vehicle ({saved.length})
        </button>
      )}
      {showSaved && (
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
          {saved.map((v,i) => (
            <button key={i} onClick={()=>{onChange(v);setShowSaved(false);setEpaStatus("found");}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",textAlign:"left",color:C.text}}>
              <div style={{fontWeight:600,fontSize:14}}>{v.year} {v.make} {v.model} {v.trim}</div>
              <div style={{fontSize:12,color:C.muted}}>{v.fuelType} · {v.mpg} MPG · {v.usableTank} gal usable</div>
            </button>
          ))}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <Lbl>Year</Lbl>
          <select value={data.year||""} onChange={e=>onChange({year:e.target.value,make:"",model:"",trim:"",epaCombined:"",listedTank:"",mpgLocked:false,tankLocked:false})}>
            <option value="">Select year</option>
            {Array.from({length:15},(_,i)=>2024-i).map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <Lbl>Make</Lbl>
          <select value={data.make||""} onChange={e=>onChange({make:e.target.value,model:"",trim:""})}>
            <option value="">Select make</option>
            {MAKES.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <Lbl hint="Type your model">Model</Lbl>
          <input value={data.model||""} onChange={e=>onChange({model:e.target.value,trim:""})} placeholder="e.g. RX 350" />
        </div>
        <div>
          <Lbl hint={availTrims.length?`Known trims: ${availTrims.join(", ")}`:"Type your trim"}>Trim</Lbl>
          <input value={data.trim||""} onChange={e=>onChange({trim:e.target.value})} placeholder="e.g. AWD" />
        </div>
      </div>

      {epaStatus==="loading" && (
        <div style={{display:"flex",alignItems:"center",gap:10,background:C.blueDim,border:`1px solid ${C.blueBorder}`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.blueMid}}>
          <Spinner /> Looking up EPA data...
        </div>
      )}
      {epaStatus==="found" && (
        <div style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.teal}}>
          ✓ EPA data found — {data.epaCity}/{data.epaHwy}/{data.epaCombined} MPG (city/hwy/combined) · {data.listedTank} gal tank
        </div>
      )}
      {epaStatus==="notfound" && data.year && data.make && data.model && data.trim && (
        <div style={{background:C.amberDim,border:`1px solid ${C.amber}33`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.amber}}>
          ⚠ No EPA match found — enter your specs manually below
        </div>
      )}

      <Lbl>Fuel Type</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        {FUEL_TYPES.map(f=><Chip key={f} active={data.fuelType===f} onClick={()=>onChange({fuelType:f})}>{f}</Chip>)}
      </div>

      {/* Real-world section */}
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,color:C.muted,letterSpacing:"0.5px",marginBottom:4}}>REAL-WORLD VALUES</div>
        <div style={{fontSize:12,color:C.hint,marginBottom:14}}>Pre-filled from EPA estimates — update these to match how your car actually drives for more accurate planning.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Field label="Real-World MPG" value={data.mpg||""} onChange={e=>onChange({mpg:e.target.value,mpgLocked:true})} placeholder="21.3" suffix="MPG"
            hint={data.epaCombined?`EPA combined: ${data.epaCombined} MPG`:"Your actual highway average"} autoFilled={epaStatus==="found"&&!data.mpgLocked} />
          <Field label="Listed Tank Size" value={data.listedTank||""} onChange={e=>onChange({listedTank:e.target.value})} placeholder="19.2" suffix="gal"
            hint="From EPA / owner's manual" autoFilled={epaStatus==="found"} />
          <Field label="Gallons When You Hit Empty" value={data.usableTank||""} onChange={e=>onChange({usableTank:e.target.value,tankLocked:true})} placeholder="16.5" suffix="gal"
            hint="How much you fill when gauge hits E" autoFilled={epaStatus==="found"&&!data.tankLocked} />
        </div>
        {epaStatus==="found" && (
          <button onClick={()=>onChange({mpg:String(Math.round((data.epaCombined||22)*REAL_WORLD_FACTOR*10)/10),usableTank:String(Math.round((parseFloat(data.listedTank)||19)*USABLE_TANK_FACTOR*10)/10),mpgLocked:false,tankLocked:false})} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"7px 14px",fontSize:12,marginTop:4}}>
            ↺ Reset to EPA estimates
          </button>
        )}
      </div>

      {mpg && usable ? (
        <Card accent style={{marginBottom:16}}>
          <div style={{fontSize:11,color:C.teal,letterSpacing:"0.5px",marginBottom:12}}>YOUR CALCULATED RANGES</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
            <Stat label="Practical Range" value={`${practical} mi`} accent />
            <Stat label="Reserve Fuel" value={`${reserve} gal`} />
            <Stat label="Reserve Range" value={`${reserveRange} mi`} />
            <Stat label="Current Range" value={`${curRange} mi`} />
          </div>
          <Divider style={{marginBottom:12}} />
          <Lbl hint="How full is your tank right now?">Current Tank Level</Lbl>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {TANK_PCTS.map(p=><Chip key={p} active={data.tankPct===p} onClick={()=>onChange({tankPct:p})} sm>{p}</Chip>)}
          </div>
        </Card>
      ) : null}

      <div style={{display:"flex",gap:10}}>
        <GBtn onClick={onBack}>← Back</GBtn>
        <PBtn onClick={()=>{onSave(data);onNext();}} disabled={!ready} full>Save Vehicle & Continue →</PBtn>
      </div>
    </div>
  );
}

// ─── STEP 3: PREFERENCES ─────────────────────────────────────────────────────

function StepPrefs({data, onChange, onNext, onBack}) {
  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Your preferences</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:24}}>How should CheapRoute plan your stops?</p>
      <Lbl hint={`Only stop where you'll have at least ${data.bufferMiles} miles remaining`}>Safety Buffer</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
        {BUFFER_OPTS.map(b=><Chip key={b} active={data.bufferMiles===b} onClick={()=>onChange({bufferMiles:b})}>{b} mi</Chip>)}
      </div>
      <Lbl hint="Maximum time you'll go off-route for cheaper fuel">Max Detour</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
        {DETOUR_OPTS.map(d=><Chip key={d} active={data.maxDetour===d} onClick={()=>onChange({maxDetour:d})}>{d} min</Chip>)}
      </div>
      <Lbl hint="What should CheapRoute prioritize?">Optimization Mode</Lbl>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
        {OPT_MODES.map(o=>(
          <button key={o.key} onClick={()=>onChange({optimization:o.key})} style={{padding:"14px 16px",borderRadius:12,textAlign:"left",border:`1.5px solid ${data.optimization===o.key?C.blueMid:C.border}`,background:data.optimization===o.key?C.blueDim:"#f8fafd",color:data.optimization===o.key?C.blueMid:C.muted,boxShadow:"0 1px 3px rgba(0,0,0,0.05)",transition:"all 0.15s"}}>
            <i className={`ti ${o.icon}`} style={{fontSize:20,display:"block",marginBottom:8}} />
            <div style={{fontSize:13,fontWeight:600}}>{o.label}</div>
          </button>
        ))}
      </div>
      <Card style={{background:C.surface,marginBottom:24}}>
        <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Settings summary</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          <Stat label="Buffer" value={`${data.bufferMiles} mi`} sm />
          <Stat label="Max Detour" value={`${data.maxDetour} min`} sm />
          <Stat label="Mode" value={OPT_MODES.find(o=>o.key===data.optimization)?.label||"—"} sm />
        </div>
      </Card>
      <div style={{display:"flex",gap:10}}>
        <GBtn onClick={onBack}>← Back</GBtn>
        <PBtn onClick={onNext} full>Calculate My Route ⛽</PBtn>
      </div>
    </div>
  );
}

// ─── MARK FILLED MODAL ───────────────────────────────────────────────────────

function MarkFilledModal({stop, onClose, onConfirm}) {
  const [gallons, setGallons] = useState(String(stop.gallons));
  const [price, setPrice] = useState(String(stop.price));
  const cost = Math.round(parseFloat(gallons||0)*parseFloat(price||0)*100)/100;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24,width:320,animation:"fadeIn 0.2s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700}}>Mark as Filled ⛽</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22}}>×</button>
        </div>
        <div style={{fontSize:13,color:C.muted,marginBottom:16}}>{stop.city} · {stop.stationName}</div>
        <Field label="Gallons Purchased" value={gallons} onChange={e=>setGallons(e.target.value)} type="number" suffix="gal" />
        <Field label="Actual Price Per Gallon" value={price} onChange={e=>setPrice(e.target.value)} type="number" suffix="$/gal" />
        {cost>0 && <div style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:14,color:C.teal,fontWeight:600}}>Total paid: ${cost.toFixed(2)}</div>}
        <PBtn onClick={()=>onConfirm({gallons:parseFloat(gallons),price:parseFloat(price),cost})} full>Confirm Fill-Up</PBtn>
      </div>
    </div>
  );
}

// ─── UPDATE MPG MODAL ────────────────────────────────────────────────────────

function UpdateMpgModal({currentMpg, onClose, onConfirm}) {
  const [mpg, setMpg] = useState(String(currentMpg));
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24,width:320,animation:"fadeIn 0.2s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700}}>Update Real-World MPG</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22}}>×</button>
        </div>
        <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Based on this leg of the trip, what MPG are you getting? CheapRoute will recalculate all remaining stops with your actual fuel economy.</div>
        <Field label="Actual MPG This Leg" value={mpg} onChange={e=>setMpg(e.target.value)} type="number" suffix="MPG" />
        <div style={{fontSize:12,color:C.hint,marginBottom:16}}>Tip: Divide miles driven by gallons purchased, or check your trip computer.</div>
        <PBtn onClick={()=>onConfirm(parseFloat(mpg))} disabled={!mpg||isNaN(parseFloat(mpg))} full>Update & Recalculate Remaining Stops</PBtn>
      </div>
    </div>
  );
}

// ─── STOP CARD ───────────────────────────────────────────────────────────────

function StopCard({stop, fuelType, onMarkFilled, onSkip}) {
  const [open, setOpen] = useState(false);
  if (stop.filled) return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12,opacity:0.65}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontWeight:700,fontSize:14,color:C.teal}}>✓ {stop.city}</div>
          <div style={{fontSize:12,color:C.muted}}>{stop.stationName}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <Tag color="green">Filled</Tag>
          <div style={{fontSize:11,color:C.muted,marginTop:4}}>${stop.actualCost?.toFixed(2)} · {stop.actualGallons} gal @ ${stop.actualPrice?.toFixed(2)}/gal</div>
        </div>
      </div>
    </div>
  );
  if (stop.skipped) return (
    <div style={{background:C.surface,border:`1px dashed ${C.border}`,borderRadius:14,padding:14,marginBottom:12,opacity:0.5}}>
      <div style={{fontSize:13,color:C.muted}}>⏭ Skipped — {stop.city}</div>
    </div>
  );
  return (
    <Card style={{marginBottom:12}} accent={!stop.isPartial}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div style={{width:34,height:34,borderRadius:"50%",flexShrink:0,background:stop.isPartial?C.blueDim:C.tealDim,border:`1px solid ${stop.isPartial?C.blueMid:C.teal}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:stop.isPartial?C.blueMid:C.teal}}>{stop.stopNum}</div>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{stop.city}</div>
            <div style={{fontSize:12,color:C.muted}}>{stop.stationName}</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:19,fontWeight:700}}>${stop.cost.toFixed(2)}</div>
          <div style={{fontSize:11,color:C.muted}}>{stop.gallons} gal · ${stop.price.toFixed(2)}/gal</div>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        {stop.isPartial?<Tag color="blue">Partial Fill</Tag>:<Tag color="green">Fill Recommended</Tag>}
        <Tag color="amber">+{stop.detourMin} min detour</Tag>
        {stop.rangeOnArrival<100&&<Tag color="red">Low range arrival</Tag>}
      </div>
      <div style={{background:"#f0f7ff",border:"1px solid #d0e4f7",borderRadius:8,padding:"10px 12px",fontSize:12,color:C.muted,marginBottom:12,display:"flex",gap:8}}>
        <span style={{color:C.blueMid}}>💡</span><span>{stop.reason}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
        <Stat label="Arrival range" value={`${stop.rangeOnArrival} mi`} warn={stop.rangeOnArrival<80} sm />
        <Stat label="After fill" value={`${stop.rangeAfterFill} mi`} sm />
        <Stat label="Rating" value={`${stop.rating}★`} sm />
        <Stat label="Price age" value={`${stop.updatedMinsAgo}m ago`} sm />
      </div>
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <button onClick={onMarkFilled} style={{flex:2,background:`linear-gradient(135deg,${C.blueMid},${C.blue})`,border:"none",color:"#fff",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:600,boxShadow:"0 2px 6px rgba(26,58,107,0.2)"}}>⛽ Mark as Filled</button>
        <button onClick={onSkip} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"9px 14px",fontSize:13}}>Skip →</button>
      </div>
      <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"none",color:C.hint,fontSize:12,padding:0}}>
        {open?"▲ Less":"▼ Station details"}
      </button>
      {open && (
        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <Stat label="Bathrooms" value={stop.hasBath?"✓ Yes":"✗ No"} sm />
          <Stat label="Food nearby" value={stop.hasFood?"✓ Yes":"✗ No"} sm />
          <Stat label="Fuel type" value={fuelType} sm />
          <Stat label="Off-route" value={`${stop.detourMiles} mi`} sm />
        </div>
      )}
    </Card>
  );
}

// ─── STEP 4: RESULTS ──────────────────────────────────────────────────────────

function StepResults({plan, setPlan, trip, setTrip, onReset, onSaveTrip, savedTrips}) {
  const [view, setView] = useState("stops");
  const [fillingStop, setFillingStop] = useState(null);
  const [showMpg, setShowMpg] = useState(false);
  const [actualSpent, setActualSpent] = useState(0);
  const {summary, stops, warnings} = plan;

  // Instant recalculate on pref change — no navigation needed
  function updatePref(changes) {
    const newTrip = {...trip, ...changes};
    setTrip(newTrip);
    const result = runEngine(newTrip, plan.segs);
    // Preserve filled/skipped state
    result.stops = result.stops.map((s,i) => {
      const old = stops[i];
      if (old?.filled) return {...s, filled:true, actualGallons:old.actualGallons, actualPrice:old.actualPrice, actualCost:old.actualCost};
      if (old?.skipped) return {...s, skipped:true};
      return s;
    });
    setPlan(result);
  }

  function handleFewer() {
    updatePref({bufferMiles:Math.min(trip.bufferMiles+25,100), maxDetour:Math.max(trip.maxDetour-3,2)});
  }
  function handleMore() {
    updatePref({bufferMiles:Math.max(trip.bufferMiles-15,25), maxDetour:Math.min(trip.maxDetour+3,15)});
  }

  function handleMarkFilled(idx, fd) {
    const newStops = stops.map((s,i)=>i===idx?{...s,filled:true,actualGallons:fd.gallons,actualPrice:fd.price,actualCost:fd.cost}:s);
    setActualSpent(t=>t+fd.cost);
    setPlan(p=>({...p,stops:newStops}));
    setFillingStop(null);
    if (newStops.filter(s=>s.filled).length===1) setTimeout(()=>setShowMpg(true),500);
  }

  function handleSkip(idx) {
    setPlan(p=>({...p, stops:p.stops.map((s,i)=>i===idx?{...s,skipped:true}:s)}));
  }

  function handleMpgUpdate(newMpg) {
    const newTrip = {...trip, mpg:newMpg};
    setTrip(newTrip);
    const result = runEngine(newTrip, plan.segs);
    result.stops = result.stops.map((s,i)=>{
      const old = stops[i];
      if (old?.filled) return {...s,filled:true,actualGallons:old.actualGallons,actualPrice:old.actualPrice,actualCost:old.actualCost};
      return s;
    });
    setPlan(result);
    setShowMpg(false);
  }

  const filledCount = stops.filter(s=>s.filled).length;

  // Route strip
  const RouteStrip = () => {
    const pts = [
      {label:trip.origin.split(",")[0], type:"origin"},
      ...stops.map(s=>({label:s.city.split(",")[0], type:s.filled?"filled":"stop", price:s.price})),
      {label:trip.destination.split(",")[0], type:"dest"},
    ];
    return (
      <div style={{overflowX:"auto",paddingBottom:4}}>
        <div style={{display:"flex",alignItems:"center",minWidth:"max-content",padding:"4px 0"}}>
          {pts.map((pt,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center"}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:pt.type==="filled"?C.green:pt.type==="stop"?C.greenDim:C.blue,border:`2px solid ${pt.type==="stop"?C.green:pt.type==="filled"?C.green:C.blue}`}} />
                <div style={{fontSize:10,color:C.muted,whiteSpace:"nowrap",maxWidth:64,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis"}}>{pt.label}</div>
                {pt.price&&<div style={{fontSize:10,color:pt.type==="filled"?C.muted:C.teal,fontWeight:600}}>${pt.price.toFixed(2)}</div>}
              </div>
              {i<pts.length-1&&<div style={{width:28,height:2,background:C.border,flexShrink:0}} />}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      {/* Hero */}
      <Card accent style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{fontSize:11,color:C.teal,letterSpacing:"0.5px",marginBottom:4}}>CHEAPROUTE PLAN</div>
            <div style={{fontSize:14,fontWeight:700}}>{trip.origin}</div>
            <div style={{fontSize:12,color:C.muted}}>→ {trip.destination}</div>
          </div>
          <div style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,borderRadius:12,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:24,fontWeight:700,color:C.teal}}>${summary.savings.toFixed(2)}</div>
            <div style={{fontSize:10,color:C.muted}}>SAVED</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
          <Stat label="Distance" value={`${summary.totalMiles} mi`} />
          <Stat label="Fuel Cost" value={`$${summary.optCost.toFixed(2)}`} accent />
          <Stat label="Stops" value={summary.stopCount} />
          <Stat label="Added Time" value={`+${summary.detourTotal}m`} />
        </div>
        <Divider style={{marginBottom:12}} />
        <RouteStrip />
        <Divider style={{marginTop:12,marginBottom:12}} />
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted}}>
          <span>Baseline: <span style={{color:C.text}}>${summary.baseline.toFixed(2)}</span></span>
          <span>Gallons: <span style={{color:C.text}}>{summary.totalGallons}</span></span>
          <span>Lowest range: <span style={{color:summary.lowestRange<80?C.red:C.text}}>{summary.lowestRange} mi</span></span>
        </div>
      </Card>

      {/* Live controls — no back button needed */}
      <Card style={{marginBottom:16,background:C.surface}}>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.5px",marginBottom:12}}>ADJUST PLAN — changes apply instantly, no need to go back</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,color:C.hint,marginBottom:8}}>Optimization mode</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {OPT_MODES.map(o=><Chip key={o.key} active={trip.optimization===o.key} onClick={()=>updatePref({optimization:o.key})} sm>{o.label}</Chip>)}
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,color:C.hint,marginBottom:8}}>Safety buffer</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {BUFFER_OPTS.map(b=><Chip key={b} active={trip.bufferMiles===b} onClick={()=>updatePref({bufferMiles:b})} sm>{b} mi</Chip>)}
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={handleFewer} style={{flex:1,background:"#f0ebff",border:"1.5px solid #c4b5fd",color:C.purple,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600}}>⬇ Fewer Stops</button>
          <button onClick={handleMore} style={{flex:1,background:"#fff7ed",border:"1.5px solid #fcd9a0",color:C.amber,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600}}>⬆ More Stops</button>
          <button onClick={()=>setShowMpg(true)} style={{flex:1,background:C.blueDim,border:`1.5px solid ${C.blueBorder}`,color:C.blueMid,borderRadius:8,padding:"9px 12px",fontSize:13,fontWeight:600}}>📊 Update MPG</button>
        </div>
      </Card>

      {warnings.map((w,i)=>(
        <div key={i} style={{background:w.type==="warn"?C.amberDim:C.blueDim,border:`1px solid ${w.type==="warn"?C.amber:C.blue}33`,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13,color:w.type==="warn"?C.amber:C.blue,display:"flex",gap:10}}>
          <span>{w.type==="warn"?"⚠️":"ℹ️"}</span><span>{w.msg}</span>
        </div>
      ))}

      {filledCount>0&&(
        <Card blue style={{marginBottom:16}}>
          <div style={{fontSize:11,color:C.blueMid,letterSpacing:"0.5px",marginBottom:10}}>TRIP IN PROGRESS</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            <Stat label="Stops Done" value={filledCount} blue sm />
            <Stat label="Actual Spent" value={`$${actualSpent.toFixed(2)}`} blue sm />
            <Stat label="Stops Left" value={stops.filter(s=>!s.filled&&!s.skipped).length} sm />
          </div>
        </Card>
      )}

      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["stops","Fuel Stops"],["summary","Trip Summary"],["trips",`Saved (${savedTrips.length})`]].map(([k,l])=>(
          <Chip key={k} active={view===k} onClick={()=>setView(k)} sm>{l}</Chip>
        ))}
      </div>

      {view==="stops"&&(
        <div>
          {stops.length===0&&(
            <Card style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:32,marginBottom:8}}>🎉</div>
              <div style={{fontWeight:600,marginBottom:4}}>No fuel stops needed!</div>
              <div style={{color:C.muted,fontSize:13}}>Your tank covers this whole route.</div>
            </Card>
          )}
          {stops.map((s,i)=><StopCard key={i} stop={s} fuelType={trip.fuelType} onMarkFilled={()=>setFillingStop(i)} onSkip={()=>handleSkip(i)} />)}
          {stops.length>0&&(
            <Card style={{display:"flex",alignItems:"center",gap:12,background:C.surface}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:C.blueDim,border:`1px solid ${C.blue}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🏁</div>
              <div>
                <div style={{fontWeight:600,fontSize:14}}>{trip.destination}</div>
                <div style={{fontSize:12,color:C.muted}}>Destination · {trip.totalMiles} miles total</div>
              </div>
            </Card>
          )}
        </div>
      )}

      {view==="summary"&&(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[["Route",`${trip.origin} → ${trip.destination}`],["Total Distance",`${summary.totalMiles} miles`],["Fuel Type",trip.fuelType],["Real-World MPG",`${trip.mpg} MPG`],["Total Gallons",`${summary.totalGallons} gal`],["Baseline Cost",`$${summary.baseline.toFixed(2)}`],["Optimized Cost",`$${summary.optCost.toFixed(2)}`,"blue"],["Savings",`$${summary.savings.toFixed(2)}`,"green"],["Added Detour",`${summary.detourTotal} min`],["Fuel Stops",summary.stopCount],["Safety Buffer",`${trip.bufferMiles} miles`],["Mode",OPT_MODES.find(o=>o.key===trip.optimization)?.label]].map(([label,value,color])=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 14px"}}>
              <span style={{fontSize:13,color:C.muted}}>{label}</span>
              <span style={{fontSize:13,fontWeight:600,color:color==="blue"?C.blue:color==="green"?C.green:C.text}}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {view==="trips"&&(
        <div>
          {savedTrips.length===0&&<Card style={{textAlign:"center",padding:24,color:C.muted,fontSize:14}}>No saved trips yet — save this one below!</Card>}
          {savedTrips.map((t,i)=>(
            <Card key={i} style={{marginBottom:10}}>
              <div style={{fontWeight:600,marginBottom:4}}>{t.origin} → {t.destination}</div>
              <div style={{fontSize:12,color:C.muted}}>{t.totalMiles} mi · ${t.optCost?.toFixed(2)} · saved ${t.savings?.toFixed(2)} · {t.date}</div>
            </Card>
          ))}
        </div>
      )}

      <div style={{display:"flex",gap:10,marginTop:20}}>
        <GBtn onClick={onReset}>← New Route</GBtn>
        <button onClick={onSaveTrip} style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,color:C.muted,borderRadius:10,padding:"12px",fontSize:14,fontWeight:500}}>💾 Save This Trip</button>
      </div>

      {fillingStop!==null&&<MarkFilledModal stop={stops[fillingStop]} onClose={()=>setFillingStop(null)} onConfirm={fd=>handleMarkFilled(fillingStop,fd)} />}
      {showMpg&&<UpdateMpgModal currentMpg={trip.mpg} onClose={()=>setShowMpg(false)} onConfirm={handleMpgUpdate} />}
    </div>
  );
}

// ─── AUTH MODAL ──────────────────────────────────────────────────────────────

function AuthModal({onClose, onAuth}) {
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:28,width:320}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:18,fontWeight:700}}>{mode==="signin"?"Sign In":"Create Account"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22}}>×</button>
        </div>
        {mode==="signup"&&<Field label="Name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" />}
        <Field label="Email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" />
        <PBtn onClick={()=>{if(email){onAuth({name:name||email.split("@")[0],email});onClose();}}} full>{mode==="signin"?"Sign In":"Create Account"}</PBtn>
        <div style={{textAlign:"center",marginTop:14,fontSize:13,color:C.muted}}>
          {mode==="signin"?"New here? ":"Have an account? "}
          <button onClick={()=>setMode(m=>m==="signin"?"signup":"signin")} style={{background:"none",border:"none",color:C.teal,fontSize:13,cursor:"pointer"}}>{mode==="signin"?"Create account":"Sign in"}</button>
        </div>
        <div style={{marginTop:12,fontSize:11,color:C.hint,textAlign:"center"}}>Demo mode — data saved locally in your browser</div>
      </div>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────

const defRoute = {origin:"",destination:"",totalMiles:""};
const defVehicle = {year:"",make:"",model:"",trim:"",epaCombined:"",listedTank:"",mpg:"",usableTank:"",fuelType:"Regular",tankPct:"Full",mpgLocked:false,tankLocked:false};
const defPrefs = {bufferMiles:50,maxDetour:5,optimization:"balanced"};

export default function App() {
  const [step, setStep] = useState(0);
  const [route, setRoute] = useState(defRoute);
  const [vehicle, setVehicle] = useState(defVehicle);
  const [prefs, setPrefs] = useState(defPrefs);
  const [plan, setPlan] = useState(null);
  const [trip, setTrip] = useState(null);
  const [user, setUser] = useState(()=>ls("cr_user"));
  const [savedVehicles, setSavedVehicles] = useState(()=>ls("cr_vehicles")||[]);
  const [savedTrips, setSavedTrips] = useState(()=>ls("cr_trips")||[]);
  const [showAuth, setShowAuth] = useState(false);
  const [toast, setToast] = useState(null);

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2500);}
  function mr(d){setRoute(r=>({...r,...d}));}
  function mv(d){setVehicle(v=>({...v,...d}));}
  function mp(d){setPrefs(p=>({...p,...d}));}

  function saveVehicle(v){
    if(!v.make||!v.model)return;
    const upd=[v,...savedVehicles.filter(sv=>!(sv.make===v.make&&sv.model===v.model&&sv.year===v.year))].slice(0,5);
    setSavedVehicles(upd);ss("cr_vehicles",upd);showToast("Vehicle saved!");
  }

  function calc(){
    const t={...route,...prefs,mpg:parseFloat(vehicle.mpg),usableTank:parseFloat(vehicle.usableTank),listedTank:parseFloat(vehicle.listedTank),fuelType:vehicle.fuelType,tankPct:vehicle.tankPct};
    setTrip(t);setPlan(runEngine(t));setStep(3);
  }

  function saveTrip(){
    if(!plan)return;
    const entry={origin:route.origin,destination:route.destination,totalMiles:route.totalMiles,optCost:plan.summary.optCost,savings:plan.summary.savings,date:new Date().toLocaleDateString()};
    const upd=[entry,...savedTrips].slice(0,10);
    setSavedTrips(upd);ss("cr_trips",upd);showToast("Trip saved!");
  }

  function reset(){setStep(0);setRoute(defRoute);setVehicle(defVehicle);setPrefs(defPrefs);setPlan(null);setTrip(null);}

  return (
    <>
      <style>{gCss}</style>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css" />
      <div style={{minHeight:"100vh",background:C.bg}}>
        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${C.blue},${C.blueMid})`,borderBottom:"none",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 12px rgba(26,58,107,0.18)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:10,background:"rgba(255,255,255,0.2)",border:"1.5px solid rgba(255,255,255,0.35)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>⛽</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.3px",color:"#fff"}}>CheapRoute</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.65)",letterSpacing:"0.5px"}}>FUEL OPTIMIZER</div>
            </div>
          </div>
          <button onClick={()=>setShowAuth(true)} style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",borderRadius:8,padding:"6px 12px",fontSize:12,display:"flex",alignItems:"center",gap:5}}>
            <i className="ti ti-user" style={{fontSize:14}} />
            {user?user.name:"Sign In"}
          </button>
        </div>

        <div style={{maxWidth:620,margin:"0 auto",padding:"28px 18px 80px",background:C.bg,minHeight:"calc(100vh - 62px)"}}>
          <StepBar step={step} onGoTo={n=>n<step&&setStep(n)} />
          {step===0&&<StepRoute data={route} onChange={mr} onNext={()=>setStep(1)} />}
          {step===1&&<StepVehicle data={vehicle} onChange={mv} onNext={()=>setStep(2)} onBack={()=>setStep(0)} saved={savedVehicles} onSave={saveVehicle} />}
          {step===2&&<StepPrefs data={prefs} onChange={mp} onNext={calc} onBack={()=>setStep(1)} />}
          {step===3&&plan&&trip&&<StepResults plan={plan} setPlan={setPlan} trip={trip} setTrip={setTrip} onReset={reset} onSaveTrip={saveTrip} savedTrips={savedTrips} />}
        </div>

        {showAuth&&<AuthModal onClose={()=>setShowAuth(false)} onAuth={u=>{setUser(u);ss("cr_user",u);showToast("Signed in!");}} />}
        {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:C.teal,color:"#fff",borderRadius:10,padding:"10px 20px",fontSize:14,fontWeight:600,zIndex:200}}>{toast}</div>}
      </div>
    </>
  );
}
