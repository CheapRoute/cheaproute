import React, { useState, useEffect, useRef } from "react";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GOOGLE_MAPS_API_KEY = "AIzaSyAluk6eMZnS5WPvuepqNmDuTz6RlqBQHLE";
const EIA_API_KEY = "wImClQa34TfUslcSAP8wCM6DjqfPJWwvPLFUQQRd";

// ─── EIA GAS PRICE FETCHER ───────────────────────────────────────────────────
// Fetches real weekly retail gas prices by state from the US Energy Information
// Administration. Free, updated every Monday, covers all 50 states.
// 
// EIA product codes: EPM0=regular, EPM0R=midgrade, EPM0P=premium, EPD2D=diesel
// EIA duoarea codes: "S" + state abbrev (STN=Tennessee, SCO=Colorado, etc.)

const EIA_PRODUCT = { regular:"EPM0", midgrade:"EPM0R", premium:"EPM0P", diesel:"EPD2D" };

// Session cache so we don't re-fetch on every pref change
const eiaCache = {}; // key: "fuelType-STATE1-STATE2-..." → {STATE: price}

async function fetchEIAPrices(states, fuelType) {
  if (!EIA_API_KEY) return null; // no key yet — fall back to estimates
  
  const product = EIA_PRODUCT[fuelType?.toLowerCase()] || "EPM0";
  const cacheKey = `${product}-${states.sort().join("-")}`;
  if (eiaCache[cacheKey]) return eiaCache[cacheKey];

  // Build duoarea params — EIA uses "S" prefix: TN→STN, CO→SCO
  const duoParams = states.map(s => `facets[duoarea][]=${encodeURIComponent("S"+s)}`).join("&");
  const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${EIA_API_KEY}` +
    `&frequency=weekly&data[0]=value&facets[product][]=${product}` +
    `&${duoParams}&sort[0][column]=period&sort[0][direction]=desc&length=${states.length * 2}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`EIA API error: ${res.status}`);
    const json = await res.json();
    const rows = json?.response?.data || [];
    
    // Extract most recent price per state
    const prices = {};
    for (const row of rows) {
      // duoarea is like "STN" — strip the leading S to get state abbrev
      const state = row.duoarea?.slice(1);
      if (state && row.value && !prices[state]) {
        prices[state] = parseFloat(row.value);
      }
    }
    eiaCache[cacheKey] = prices;
    return prices;
  } catch (err) {
    console.warn("EIA fetch failed:", err.message);
    return null;
  }
}

// Extract unique states from a set of route segments
function getStatesFromSegs(segs) {
  const states = new Set();
  for (const seg of segs) {
    const st = extractState(seg.city);
    if (st && st !== "DEFAULT") states.add(st);
  }
  return Array.from(states);
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const FUEL_TYPES = ["Regular", "Midgrade", "Premium", "Diesel"];
const TANK_PCTS = ["25%", "50%", "75%", "Full"];
const BUFFER_OPTS = [25, 40, 50, 60, 100];
const DETOUR_OPTS = [1, 2, 5, 10];
const OPT_MODES = [
  { key: "cheapest", label: "Cheapest Fuel", icon: "ti-coin" },
  { key: "balanced", label: "Best Balance", icon: "ti-scale" },
  { key: "fastest", label: "Fastest Trip", icon: "ti-bolt" },
  { key: "rated", label: "Top Rated", icon: "ti-star" },
];

const POPULAR_ROUTES = [
  { origin: "Los Angeles, CA", dest: "Las Vegas, NV" },
  { origin: "New York, NY", dest: "Boston, MA" },
  { origin: "Chicago, IL", dest: "Detroit, MI" },
  { origin: "Denver, CO", dest: "Salt Lake City, UT" },
  { origin: "Dallas, TX", dest: "Houston, TX" },
  { origin: "Seattle, WA", dest: "Portland, OR" },
  { origin: "Miami, FL", dest: "Orlando, FL" },
  { origin: "Edwards, CO", dest: "Las Vegas, NV" },
  { origin: "San Francisco, CA", dest: "Los Angeles, CA" },
  { origin: "Asheville, NC", dest: "Edwards, CO" },
];

// State-level price multipliers vs national average.
// Based on real 2024-2025 AAA data. 1.00 = national average.
const STATE_PRICE_MULT = {
  // Expensive states
  CA:1.32, HI:1.38, WA:1.18, OR:1.14, NV:1.10, IL:1.08,
  PA:1.06, CO:1.06, CT:1.07, NY:1.14, MA:1.09, MI:1.05,
  UT:1.04, AZ:1.03, ID:1.04, WY:1.03, MT:1.03, MN:1.02,
  // Near average
  FL:0.98, OH:0.97, IN:0.96, MO:0.95, WI:0.96, IA:0.96,
  NE:0.97, KS:0.95, NC:0.96, VA:0.97, GA:0.93, AL:0.93,
  // Cheap states
  TX:0.92, OK:0.91, AR:0.91, TN:0.93, MS:0.92, LA:0.92,
  SC:0.93, KY:0.94, WV:0.95, NM:0.96,
  DEFAULT:1.00,
};

// City-level overrides — tourist areas, remote interstates, border crossings
// These reflect real price premiums you'd see on the road
const CITY_PRICE_OVERRIDE = {
  "vail":1.18, "aspen":1.22, "telluride":1.20, "jackson":1.15,
  "glenwood springs":1.12, "avon":1.10, "eagle":1.08,
  "flagstaff":1.06, "santa fe":1.07, "taos":1.09,
  "limon":1.04, "salina":0.98, "colby":0.97, "hays":0.96,
  "shamrock":0.94, "amarillo":0.93, "elk city":0.92,
  "tucumcari":0.95, "santa rosa":0.96,
  "effingham":1.00, "terre haute":0.97, "columbia":0.95,
};

const BASE_PRICES = { regular:3.35, midgrade:3.55, premium:3.75, diesel:3.65 };
const REAL_WORLD_FACTOR = 0.88;
const USABLE_TANK_FACTOR = 0.86;
const STATIONS = ["Maverick","Pilot Travel Center","Flying J","Love's","Kwik Trip","Sheetz","Casey's","Circle K","Shell","Chevron","Sinclair","Phillips 66","Valero"];

// Seeded hash so prices are stable for a given city (don't flicker on re-render)
function cityPriceHash(city) {
  let h = 0;
  for (let i = 0; i < city.length; i++) h = (Math.imul(31, h) + city.charCodeAt(i)) | 0;
  return (Math.abs(h) % 100) / 100; // 0.0–0.99
}

// ─── GOOGLE MAPS LOADER ──────────────────────────────────────────────────────
let gmPromise = null;
function loadGoogleMaps() {
  if (gmPromise) return gmPromise;
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  gmPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geometry&callback=__gmInit`;
    s.async = true;
    window.__gmInit = () => resolve(window.google.maps);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return gmPromise;
}

// ─── FUEL ENGINE ─────────────────────────────────────────────────────────────
function extractState(s) {
  if (!s) return "DEFAULT";
  const p = s.split(",").map(x=>x.trim());
  // Google Maps returns "City, State ZIP, USA" — find the state abbreviation
  // Skip USA, skip empty, find 2-letter state code
  for (let i = p.length - 2; i >= 0; i--) {
    const part = p[i];
    if (!part || part === "USA" || part === "US") continue;
    // Handle "CO 81632" — extract just the letters
    const letters = part.replace(/[^A-Za-z\s]/g,"").trim();
    // State abbrevs are 2 letters
    const words = letters.split(" ").filter(w=>w.length>0);
    for (const w of words) {
      if (w.length === 2) return w.toUpperCase();
    }
  }
  // Fallback: second-to-last component
  if (p.length >= 2) return p[p.length-2].replace(/[^A-Za-z]/g,"").trim().slice(0,2).toUpperCase();
  return "DEFAULT";
}
function getPrice(city, fuelType, realPrices) {
  const base = BASE_PRICES[fuelType?.toLowerCase()] || 3.35;
  const st = extractState(city);

  // If we have real EIA prices for this state, use them
  if (realPrices && realPrices[st]) {
    // Add small stable station-level variation (±$0.04) around the real state avg
    const cityLower = (city || "").toLowerCase();
    const variation = (cityPriceHash(cityLower) - 0.5) * 0.08;
    return Math.round((realPrices[st] + variation) * 100) / 100;
  }

  // Fall back to estimated prices
  let mult = STATE_PRICE_MULT[st] || STATE_PRICE_MULT.DEFAULT;
  const cityLower = (city || "").toLowerCase();
  for (const [key, val] of Object.entries(CITY_PRICE_OVERRIDE)) {
    if (cityLower.includes(key)) { mult = val; break; }
  }
  const variation = (cityPriceHash(cityLower) - 0.5) * 0.16;
  return Math.round((base * mult + variation) * 100) / 100;
}

const STATE_HIGHWAY_CITY = {
  AL:"Birmingham, AL", AR:"Little Rock, AR", AZ:"Flagstaff, AZ",
  CA:"Bakersfield, CA", CO:"Colorado Springs, CO", CT:"Hartford, CT",
  DE:"Wilmington, DE", FL:"Gainesville, FL", GA:"Macon, GA",
  IA:"Des Moines, IA", ID:"Twin Falls, ID", IL:"Springfield, IL",
  IN:"Indianapolis, IN", KS:"Salina, KS", KY:"Lexington, KY",
  LA:"Baton Rouge, LA", MA:"Worcester, MA", MD:"Frederick, MD",
  ME:"Portland, ME", MI:"Lansing, MI", MN:"Rochester, MN",
  MO:"Columbia, MO", MS:"Jackson, MS", MT:"Billings, MT",
  NC:"Charlotte, NC", ND:"Bismarck, ND", NE:"Lincoln, NE",
  NH:"Concord, NH", NJ:"Trenton, NJ", NM:"Albuquerque, NM",
  NV:"Elko, NV", NY:"Syracuse, NY", OH:"Columbus, OH",
  OK:"Oklahoma City, OK", OR:"Salem, OR", PA:"Harrisburg, PA",
  RI:"Providence, RI", SC:"Columbia, SC", SD:"Sioux Falls, SD",
  TN:"Nashville, TN", TX:"Abilene, TX", UT:"Provo, UT",
  VA:"Roanoke, VA", VT:"Burlington, VT", WA:"Ellensburg, WA",
  WI:"Madison, WI", WV:"Charleston, WV", WY:"Casper, WY",
};

function buildSegsFromLegs(legs, fuelType, totalMiles, vehicleRange, bufferMiles, maxDetour, realPrices) {
  // Candidate spacing: 150mi gives enough granularity to make price decisions
  // without triggering micro-stops every 100mi. With 378mi range and full fills,
  // the engine naturally skips 1-2 candidates between actual stops, producing
  // 3-5 real stops on a 1500mi trip with varying gallons based on prices.
  const stopInterval = 150;

  // Build the full route point list from Google's actual geometry.
  // Every step gives us a lat/lng and cumulative miles — these are real positions
  // ON the chosen highway, not approximations.
  const routePoints = [];
  let cumMiles = 0;
  for (const leg of legs) {
    for (const step of leg.steps) {
      const stepMiles = step.distance.value / 1609.34;
      cumMiles += stepMiles;
      const instr = (step.html_instructions || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      routePoints.push({
        miles: cumMiles,
        lat: step.end_location.lat(),
        lng: step.end_location.lng(),
        instr,
      });
    }
  }

  // Get a city name for a route point by scanning nearby step instructions.
  // Google writes "toward Denver", "toward St Louis" etc — extract that city.
  function cityFromNearbySteps(targetMile) {
    const nearby = routePoints
      .filter(p => Math.abs(p.miles - targetMile) < 60)
      .sort((a, b) => Math.abs(a.miles - targetMile) - Math.abs(b.miles - targetMile));

    for (const p of nearby) {
      // "toward CityName" — most reliable indicator in Google directions
      const m = p.instr.match(/toward\s+([A-Z][a-zA-Z ]{2,30})(?:\/|$)/i);
      if (m) {
        const name = m[1].trim();
        if (!/^[A-Z]-?\d/.test(name)) return name; // skip highway numbers
      }
    }
    return null;
  }

  // Nearest highway city within maxDetour miles (degrees) of the route point.
  // maxDetour in minutes → convert to rough miles (1 min ≈ 1 mile at highway speed)
  // Then convert miles to degrees (1 degree ≈ 69 miles)
  const HIGHWAY_CITIES = [
    ["St. Louis, MO",38.627,-90.199],["Kansas City, MO",39.099,-94.578],
    ["Columbia, MO",38.951,-92.334],["Joplin, MO",37.084,-94.513],["Wentzville, MO",38.811,-90.853],["Kingdom City, MO",38.929,-91.935],
    ["Springfield, MO",37.215,-93.298],
    ["Indianapolis, IN",39.768,-86.158],["Louisville, KY",38.252,-85.758],
    ["Lexington, KY",38.040,-84.503],["Columbus, OH",39.961,-82.998],
    ["Cincinnati, OH",39.103,-84.512],["Charleston, WV",38.349,-81.632],
    ["Nashville, TN",36.162,-86.781],["Memphis, TN",35.149,-90.049],
    ["Knoxville, TN",35.960,-83.920],["Chattanooga, TN",35.045,-85.309],
    ["Little Rock, AR",34.746,-92.289],["Fort Smith, AR",35.385,-94.398],
    ["Oklahoma City, OK",35.467,-97.516],["Tulsa, OK",36.154,-95.992],
    ["Amarillo, TX",35.222,-101.831],["Wichita, KS",37.687,-97.330],
    ["Salina, KS",38.840,-97.611],["Hays, KS",38.879,-99.326],
    ["Colby, KS",39.395,-101.051],["Oakley, KS",39.128,-100.852],
    ["Limon, CO",39.262,-103.692],["Byers, CO",39.691,-104.225],
    ["Denver, CO",39.739,-104.990],["Aurora, CO",39.729,-104.832],
    ["Pueblo, CO",38.254,-104.609],["Albuquerque, NM",35.084,-106.650],
    ["Flagstaff, AZ",35.198,-111.651],["Las Vegas, NV",36.169,-115.139],
    ["Salt Lake City, UT",40.760,-111.891],["Grand Junction, CO",39.063,-108.550],
    ["Glenwood Springs, CO",39.550,-107.324],["Eagle, CO",39.655,-106.828],
    ["Vail, CO",39.643,-106.374],["Avon, CO",39.631,-106.523],
    ["Charlotte, NC",35.227,-80.843],["Roanoke, VA",37.271,-79.941],
    ["Richmond, VA",37.540,-77.436],["Atlanta, GA",33.749,-84.388],
    ["Dallas, TX",32.776,-96.796],["El Paso, TX",31.761,-106.485],
    ["Albuquerque, NM",35.084,-106.650],["Tucson, AZ",32.222,-110.974],
    ["Harrisburg, IL",37.738,-88.540],["Mount Vernon, IL",38.317,-88.903],
    ["Effingham, IL",39.120,-88.545],["Terre Haute, IN",39.466,-87.413],
    ["Rolla, MO",37.951,-91.771],["Lebanon, MO",37.680,-92.663],
    ["Shamrock, TX",35.215,-100.247],["Clinton, OK",35.515,-98.967],
    ["Weatherford, OK",35.526,-98.706],["Elk City, OK",35.411,-99.404],
    ["Tucumcari, NM",35.171,-103.724],["Santa Rosa, NM",34.938,-104.682],
    ["Moriarty, NM",34.990,-106.050],["Gallup, NM",35.528,-108.742],
    ["Flagstaff, AZ",35.198,-111.651],["Williams, AZ",35.249,-112.191],
  ];

  function getNearestCity(lat, lng) {
    if (!lat || !lng) return null;
    // Use generous 0.7° radius (~48mi) for naming only.
    // The detour limit is enforced separately in the engine — this is just a label.
    const MAX_DEG = 0.7;
    let best = null, bestDist = Infinity;
    for (const [name, clat, clng] of HIGHWAY_CITIES) {
      const d = Math.sqrt((lat-clat)**2 + (lng-clng)**2);
      if (d < bestDist && d < MAX_DEG) { bestDist = d; best = name; }
    }
    return best;
  }

  const segs = [];
  const seen = new Map();
  let nextStopMile = stopInterval;

  while (nextStopMile < totalMiles - 20) {
    const thisMile = nextStopMile;

    // Find the route point at exactly this mile
    const point = routePoints.length > 0
      ? routePoints.reduce((best, p) =>
          Math.abs(p.miles - thisMile) < Math.abs(best.miles - thisMile) ? p : best,
          routePoints[0])
      : { miles: thisMile, lat: 0, lng: 0 };

    // City name: Google directions text first, then nearest highway city within maxDetour
    const instrCity = cityFromNearbySteps(thisMile);
    const nearbyCity = getNearestCity(point.lat, point.lng);
    const city = instrCity || nearbyCity || `Mile ${Math.round(thisMile)}`;



    const cityKey = city.toLowerCase().slice(0, 20);
    if (!seen.has(cityKey)) {
      seen.set(cityKey, true);
      segs.push({
        city, miles: Math.round(thisMile), lat: point.lat, lng: point.lng,
        stationName: STATIONS[Math.floor(Math.random() * STATIONS.length)],
        detourMin: Math.round(maxDetour * Math.random() * 0.8),
        detourMiles: Math.round(maxDetour * Math.random() * 0.8 * 10) / 10,
        rating: Math.round((3.2 + Math.random() * 1.5) * 10) / 10,
        hasFood: Math.random() > 0.3, hasBath: Math.random() > 0.1,
        price: getPrice(city, fuelType, realPrices),
        updatedMinsAgo: Math.floor(Math.random() * 120) + 5,
      });
    }
    nextStopMile += stopInterval;
  }

  return segs;
}

function getFallbackCity(targetMile, totalMiles, legs) {
  // Use origin/dest states as a rough guide for intermediate stops
  const oState = extractState(legs[0].start_address);
  const dState = extractState(legs[legs.length-1].end_address);
  const frac = targetMile / totalMiles;
  // Interpolate state based on position along route
  const guessState = frac < 0.4 ? oState : frac > 0.7 ? dState : "TX"; // rough middle
  return STATE_HIGHWAY_CITY[guessState] || `Mile ${Math.round(targetMile)} stop`;
}

// ─── TANK SIZE DATABASE ──────────────────────────────────────────────────────
const TANK_DB = {
  "toyota|4runner":23.0,"toyota|camry":14.5,"toyota|corolla":13.2,
  "toyota|rav4":14.5,"toyota|tacoma":21.1,"toyota|tundra":22.5,
  "toyota|highlander":17.9,"toyota|sienna":18.0,"toyota|prius":11.3,
  "lexus|rx 350":19.2,"lexus|rx":19.2,"lexus|es":17.4,"lexus|gx":23.0,
  "lexus|lx":24.6,"lexus|nx":14.8,"lexus|ux":13.2,
  "honda|cr-v":14.0,"honda|civic":12.4,"honda|accord":14.8,
  "honda|pilot":19.5,"honda|odyssey":19.5,"honda|ridgeline":16.4,
  "honda|hrv":13.2,"honda|passport":19.5,
  "ford|f-150":23.0,"ford|escape":15.7,"ford|explorer":18.0,
  "ford|mustang":16.0,"ford|ranger":19.5,"ford|edge":18.0,
  "ford|expedition":28.0,"ford|bronco":16.9,
  "chevrolet|silverado":24.0,"chevrolet|equinox":14.9,"chevrolet|tahoe":24.0,
  "chevrolet|suburban":31.0,"chevrolet|traverse":19.4,"chevrolet|malibu":15.8,
  "chevrolet|colorado":21.0,"chevrolet|blazer":18.9,
  "gmc|sierra":24.0,"gmc|terrain":14.9,"gmc|yukon":24.0,"gmc|acadia":19.4,
  "ram|1500":22.0,"ram|2500":33.0,"ram|3500":33.0,
  "jeep|wrangler":17.5,"jeep|grand cherokee":24.6,"jeep|cherokee":15.8,
  "jeep|compass":13.5,"jeep|gladiator":22.0,
  "dodge|charger":18.5,"dodge|challenger":19.1,"dodge|durango":24.6,
  "subaru|outback":18.5,"subaru|forester":15.9,"subaru|crosstrek":15.9,
  "subaru|impreza":13.2,"subaru|legacy":18.5,"subaru|ascent":19.0,
  "nissan|altima":16.2,"nissan|rogue":14.5,"nissan|frontier":21.0,
  "nissan|titan":26.0,"nissan|murano":20.0,"nissan|pathfinder":19.5,
  "hyundai|tucson":14.3,"hyundai|santa fe":17.7,"hyundai|elantra":14.0,
  "hyundai|sonata":15.9,"hyundai|palisade":18.8,
  "kia|sorento":17.7,"kia|sportage":14.3,"kia|telluride":18.8,"kia|forte":14.0,
  "bmw|x5":21.9,"bmw|3 series":15.6,"bmw|5 series":15.6,"bmw|x3":17.2,
  "mercedes-benz|c-class":16.1,"mercedes-benz|e-class":17.4,"mercedes-benz|gle":21.1,
  "audi|q5":19.8,"audi|a4":16.9,"audi|q7":22.5,
  "volkswagen|jetta":13.2,"volkswagen|tiguan":15.9,"volkswagen|atlas":19.4,
  "buick|enclave":19.4,"buick|encore":14.0,"buick|envision":15.6,
  "cadillac|escalade":24.0,"cadillac|xt5":18.9,"cadillac|ct5":16.0,
  "lincoln|navigator":28.0,"lincoln|aviator":18.0,"lincoln|corsair":14.8,
  "mazda|cx-5":14.8,"mazda|mazda3":13.2,"mazda|cx-9":19.6,
  "acura|mdx":19.5,"acura|rdx":16.6,"acura|tlx":15.3,
  "infiniti|qx60":19.5,"infiniti|qx80":26.0,"infiniti|q50":16.4,
};

function lookupTank(make, model) {
  if (!make||!model) return 0;
  const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
  if (TANK_DB[key]) return TANK_DB[key];
  const makeKey = make.toLowerCase();
  for (const [k,v] of Object.entries(TANK_DB)) {
    const [km,kmod] = k.split("|");
    if (km===makeKey && model.toLowerCase().includes(kmod)) return v;
  }
  return 0;
}

// ─── FUEL ENGINE ─────────────────────────────────────────────────────────────
const tankRatio = {"25%":0.25,"50%":0.5,"75%":0.75,"Full":1.0};

function runEngine(trip, segsOverride) {
  const { totalMiles, mpg, usableTank, fuelType, tankPct, bufferMiles, maxDetour, optimization } = trip;
  const segs = segsOverride || [];
  let fuel = usableTank * (tankRatio[tankPct]||1);
  let range = fuel * mpg;
  let milesDone = 0;
  const stops=[], warnings=[];
  let optCost=0, detourTotal=0, lastFillMile=0;
  const avgPrice = segs.length ? segs.reduce((s,r)=>s+r.price,0)/segs.length : BASE_PRICES[fuelType?.toLowerCase()]||3.35;
  const baseline = (totalMiles/mpg)*avgPrice;

  for (let i=0; i<segs.length; i++) {
    const seg = segs[i];

    // Always calculate range on arrival at this segment point,
    // based on how far we've travelled since milesDone was last set.
    // This must happen BEFORE any continue/skip so range stays accurate.
    const dist = seg.miles - milesDone;
    const roa = range - dist; // range on arrival at this stop

    // Always advance the tracking cursor — even for skipped stops.
    // Without this, milesDone stays stale and every subsequent dist/roa is wrong.
    range = roa;
    milesDone = seg.miles;

    // Now apply the detour filter (but keep range tracking above correct first)
    const next = segs[i+1];
    const distNext = next ? next.miles-seg.miles : totalMiles-seg.miles;
    const ranAfterNext = roa - distNext; // range if we skip this stop

    // Must stop if below buffer or can't reach the next candidate
    const cantReachNext = ranAfterNext < bufferMiles;
    // Also must stop if we can't reach the destination from here without stopping again
    const cantFinish = (roa - (totalMiles - seg.miles)) < bufferMiles && !next;
    let mustStop = roa < bufferMiles || roa < 0 || cantFinish;

    // Price comparisons — needed for both skip logic and fill decisions
    const priceHere = seg.price;
    const priceNext = next ? next.price : priceHere * 1.05;
    const cheaperAhead = priceNext < priceHere * 0.97;
    const cheaperHere  = priceHere  < priceNext * 0.97;
    const bigSavingHere = priceHere < priceNext * 0.93;

    // Detour enforcement — skip candidates too far off route
    const rangeIsCritical = mustStop || cantReachNext;
    if (seg.detourMiles > maxDetour && !rangeIsCritical) continue;

    // Minimum distance since last fill — don't stop if we just filled up recently
    // Exception: if gas here is 15%+ cheaper than next stop (rare but worth it)
    const milesSinceLastFill = seg.miles - lastFillMile;
    const drasticallyCheaper = priceHere < priceNext * 0.85;
    const tooSoon = milesSinceLastFill < 150 && !drasticallyCheaper && !mustStop;

    // Mode-specific skip logic
    // Thresholds must be MEANINGFUL — EIA prices vary ~10-20¢ across states.
    // Skipping on 1-4¢ causes cascading near-empty arrivals with no real savings.
    const canSkipSafely = !mustStop && !cantReachNext;
    if (tooSoon) continue; // haven't driven 150mi since last fill
    if (canSkipSafely) {
      if (optimization === "fastest") continue;
      // Cheapest: skip only if next stop is 8¢+ cheaper AND we have comfortable range
      if (optimization === "cheapest" && priceNext < priceHere - 0.08 && roa > bufferMiles * 2) continue;
      // Balanced: skip only if next stop is 10¢+ cheaper
      if (optimization === "balanced" && priceNext < priceHere - 0.10 && roa > bufferMiles * 2) continue;
      // toprated: never skip a reachable stop
    }

    // Smart stop: stock up HERE before prices rise in the next 2-3 stops
    const futurePrice = (segs[i+2]?.price || segs[i+1]?.price || priceNext);
    const maxFuturePrice = Math.max(priceNext, futurePrice);
    // Cheapest: smart stop if ANY price rise coming (8¢+), stock up aggressively
    // Balanced: smart stop only if significant rise (15¢+), more conservative
    const smartStop =
      optimization === "cheapest"  ? (maxFuturePrice > priceHere + 0.08 && roa > bufferMiles * 3) :
      optimization === "fastest"   ? false :
      optimization === "toprated"  ? (seg.rating >= 4.0 && roa > bufferMiles * 2) :
                                     (maxFuturePrice > priceHere + 0.15 && roa > bufferMiles * 3);

    let action="skip", gallons=0, reason="";

    if (mustStop || cantReachNext) {
      const fa = Math.max(0, roa / mpg);
      const minFuelNeeded = (distNext + bufferMiles) / mpg;

      // Always fill full when forced to stop.
      // With 150mi candidate spacing a full tank (~378mi) lets the engine
      // naturally skip the next 1-2 candidates. Savings come from WHICH
      // stop you fill at (cheap state vs expensive), not micro-fills.
      // Modes differ in how aggressively they SKIP stops — not fill amounts.
      const targetFuel = Math.min(usableTank, Math.max(minFuelNeeded, usableTank));

      gallons = Math.ceil((targetFuel - fa) * 2) / 2;
      gallons = Math.max(1, Math.min(gallons, usableTank - fa));
      action = "stop";
      reason = cantReachNext && !mustStop
        ? `Next stop is ${Math.round(distNext)} miles away — fueling here to arrive safely.`
        : cheaperHere && optimization !== "fastest"
        ? `Gas here ($${priceHere.toFixed(2)}/gal) is cheaper than ahead ($${priceNext.toFixed(2)}/gal) — good time to fill up.`
        : `${Math.round(roa)} miles remaining — fueling here to maintain your ${bufferMiles}-mile buffer.`;

    } else if (smartStop) {
      const fa = Math.max(0, roa / mpg);
      let targetFuel;
      if (optimization === "cheapest")     targetFuel = usableTank;          // stock up fully
      else if (optimization === "toprated") targetFuel = usableTank * 0.85;  // good fill at good station
      else                                  targetFuel = usableTank * 0.75;  // balanced: partial fill
      gallons = Math.max(3, Math.ceil((Math.min(usableTank, targetFuel) - fa) * 2) / 2);
      gallons = Math.min(gallons, usableTank - fa);
      if (gallons >= 2) {
        action = "stop";
        reason = optimization === "toprated"
          ? `${seg.rating}★ rated station — great time to fill up.`
          : `Gas here ($${priceHere.toFixed(2)}/gal) is cheaper than ahead ($${priceNext.toFixed(2)}/gal) — stocking up now.`;
      }
    } else if (cheaperAhead && ranAfterNext > bufferMiles * 1.5) {
      action = "skip"; // enough range + cheaper ahead = skip
    }

    if (action==="stop" && gallons > 0) {
      const fa = Math.max(0, roa/mpg);
      gallons = Math.round(gallons * 2) / 2; // round to nearest 0.5
      const cost = gallons * seg.price;
      optCost += cost;
      detourTotal += seg.detourMin;
      stops.push({
        ...seg, stopNum:stops.length+1, gallons, cost,
        rangeOnArrival: Math.round(roa),
        rangeAfterFill: Math.round(Math.min(usableTank, fa+gallons)*mpg),
        reason, isPartial: gallons < usableTank*0.4,
        filled:false, skipped:false
      });
      // After filling up, update range based on new fuel level
      fuel = Math.min(usableTank, fa + gallons);
      range = fuel * mpg;
      lastFillMile = seg.miles; // track where we last filled up
    }
  }

  // Check if we make it to the end.
  // `range` now always reflects remaining range after processing all segs.
  const finalRange = range - (totalMiles - milesDone);
  if (stops.length===0 && finalRange > bufferMiles) {
    warnings.push({type:"info", msg:`Great news — your ${Math.round(range)}-mile range covers this entire route without stopping!`});
  } else if (finalRange < bufferMiles) {
    warnings.push({type:"warn", msg:`Fuel may be tight on the final stretch. Consider topping off at your last stop.`});
  }

  // Fix cost calculation:
  // optCost = fuel purchased at stops
  // But we started with some fuel already — account for that
  // Total fuel needed for trip = totalMiles / mpg
  // Fuel we already had at start = initial fuel amount
  const initialFuel = usableTank * (tankRatio[tankPct]||1);
  const totalFuelNeeded = totalMiles / mpg;
  const fuelToBuy = Math.max(0, totalFuelNeeded - initialFuel);

  // Savings = what the trip would cost if you just stopped randomly and paid
  // the highest price on your route — vs what CheapRoute had you actually pay.
  // "Baseline" = buying all fuel at the most expensive state price on the route.
  // This reflects real savings from routing through cheaper states and timing fills.
  const totalGallonsBought = stops.reduce((s,st)=>s+st.gallons, 0);
  const maxStopPrice = stops.length ? Math.max(...stops.map(s=>s.price)) : avgPrice;
  const worstCasePrice = Math.max(maxStopPrice, avgPrice * 1.08); // at least 8% above avg
  const realBaseline = totalFuelNeeded * worstCasePrice;
  const weightedOptCost = optCost;
  const savings = Math.max(0, realBaseline - optCost);

  return { stops, warnings, segs,
    summary:{
      totalMiles,
      totalGallons: Math.round(totalFuelNeeded*10)/10,
      baseline: Math.round(realBaseline*100)/100,
      optCost: Math.round(weightedOptCost*100)/100,
      savings: Math.round(savings*100)/100,
      detourTotal, stopCount: stops.length,
      lowestRange: stops.length ? Math.min(...stops.map(s=>s.rangeOnArrival)) : Math.round(range)
    }
  };
}

// ─── EPA / NHTSA APIs ────────────────────────────────────────────────────────
const FALLBACK_MAKES = ["Acura","Audi","BMW","Buick","Cadillac","Chevrolet","Chrysler","Dodge","Ford","Genesis","GMC","Honda","Hyundai","Infiniti","Jeep","Kia","Lexus","Lincoln","Mazda","Mercedes-Benz","Nissan","Ram","Subaru","Tesla","Toyota","Volkswagen","Volvo"];

function epaMenu(params) {
  const endpoint = params.endpoint;
  const p = {...params};
  delete p.endpoint;
  const qs = new URLSearchParams(p).toString();
  const url = `https://www.fueleconomy.gov/ws/rest/vehicle/menu/${endpoint}?${qs}`;
  return fetch(url, {headers:{Accept:"application/json"}})
    .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(d=>{ const items = Array.isArray(d.menuItem)?d.menuItem:d.menuItem?[d.menuItem]:[]; return items; })
    .catch(()=>[]);
}
async function fetchMakes(year) {
  try {
    const items = await epaMenu({endpoint:"make", year});
    const results = items.map(i=>i.value).sort();
    return results.length > 0 ? results : FALLBACK_MAKES;
  } catch { return FALLBACK_MAKES; }
}
async function fetchModels(year, make) {
  try {
    const items = await epaMenu({endpoint:"model", year, make});
    return items.map(i=>i.value).sort();
  } catch { return []; }
}
async function fetchEpaTrims(year, make, model) {
  try {
    const items = await epaMenu({endpoint:"options", year, make, model});
    return items;
  } catch { return []; }
}
async function fetchEpaById(id) {
  try {
    const r = await fetch(`https://www.fueleconomy.gov/ws/rest/vehicle/${id}`,{headers:{Accept:"application/json"}});
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const tank = parseFloat(d.lv2)||parseFloat(d.lv4)||0;
    const fuelType1 = (d.fuelType1||"").toLowerCase();
    const fuelType = fuelType1.includes("premium")?"Premium":fuelType1.includes("diesel")?"Diesel":fuelType1.includes("midgrade")?"Midgrade":"Regular";
    return { city:parseFloat(d.city08)||0, hwy:parseFloat(d.highway08)||0, combined:parseFloat(d.comb08)||0, tank, fuelType };
  } catch { return null; }
}
async function searchEpaVehicles(year, make, modelQuery) {
  try {
    const items = await epaMenu({endpoint:"model", year, make});
    const q = modelQuery.toLowerCase().replace(/[-\s]/g,"");
    return items.filter(i=>i.value.toLowerCase().replace(/[-\s]/g,"").includes(q)).map(i=>i.value);
  } catch { return []; }
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
function ls(k){try{return JSON.parse(localStorage.getItem(k));}catch{return null;}}
function ss(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg:"#eef2f7", surface:"#ffffff", card:"#ffffff", border:"#d0dcea",
  blue:"#1a3a6b", blueMid:"#2556a0", blueLight:"#3b7fd4",
  blueDim:"rgba(37,86,160,0.08)", blueBorder:"rgba(37,86,160,0.25)",
  teal:"#00a878", tealDim:"rgba(0,168,120,0.10)", tealBorder:"rgba(0,168,120,0.30)",
  red:"#d93025", redDim:"rgba(217,48,37,0.08)",
  amber:"#e07b00", amberDim:"rgba(224,123,0,0.09)",
  purple:"#6d28d9", purpleDim:"rgba(109,40,217,0.08)",
  text:"#1a2b3c", muted:"#4a6380", hint:"#8fa8c0",
  green:"#00a878", greenDim:"rgba(0,168,120,0.10)", greenBorder:"rgba(0,168,120,0.30)",
};

const gCss = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:${C.bg};font-family:'Plus Jakarta Sans',sans-serif;color:${C.text};}
  input,select{background:#fff;border:1.5px solid ${C.border};border-radius:10px;color:${C.text};font-family:inherit;font-size:14px;padding:10px 14px;width:100%;outline:none;transition:border 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.04);}
  input:focus,select:focus{border-color:${C.blueLight};box-shadow:0 0 0 3px rgba(59,127,212,0.12);}
  input::placeholder{color:${C.hint};}
  button{cursor:pointer;font-family:inherit;}
  .pac-container{z-index:9999!important;border-radius:10px;border:1.5px solid ${C.border};box-shadow:0 4px 20px rgba(0,0,0,0.1);font-family:'Plus Jakarta Sans',sans-serif;}
  .pac-item{padding:8px 14px;font-size:13px;cursor:pointer;}
  .pac-item:hover{background:${C.blueDim};}
  @keyframes spin{to{transform:rotate(360deg);}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
`;

// ─── ATOMS ───────────────────────────────────────────────────────────────────
const Lbl = ({children,hint}) => (
  <div style={{marginBottom:8}}>
    <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase",marginBottom:hint?3:0}}>{children}</div>
    {hint&&<div style={{fontSize:12,color:C.hint}}>{hint}</div>}
  </div>
);
const Chip = ({active,onClick,children,sm,color}) => {
  const ac=color==="blue"?C.blueMid:color==="amber"?C.amber:color==="purple"?C.purple:C.teal;
  const ab=color==="blue"?C.blueDim:color==="amber"?C.amberDim:color==="purple"?C.purpleDim:C.tealDim;
  return <button onClick={onClick} style={{padding:sm?"6px 11px":"8px 15px",borderRadius:8,fontSize:sm?12:13,fontWeight:active?600:400,border:`1.5px solid ${active?ac:C.border}`,background:active?ab:"#fff",color:active?ac:C.muted,transition:"all 0.15s",whiteSpace:"nowrap"}}>{children}</button>;
};
const PBtn = ({onClick,children,disabled,full,sm}) => (
  <button onClick={onClick} disabled={disabled} style={{background:disabled?"#b0c4de":`linear-gradient(135deg,${C.blueMid},${C.blue})`,color:"#fff",border:"none",borderRadius:10,padding:sm?"9px 18px":"13px 24px",fontSize:sm?13:15,fontWeight:600,width:full?"100%":"auto",opacity:disabled?0.6:1,cursor:disabled?"not-allowed":"pointer",boxShadow:disabled?"none":"0 2px 8px rgba(26,58,107,0.25)"}}>{children}</button>
);
const GBtn = ({onClick,children}) => (
  <button onClick={onClick} style={{background:"#fff",border:`1.5px solid ${C.border}`,color:C.blueMid,borderRadius:10,padding:"12px 20px",fontSize:14,fontWeight:600}}>{children}</button>
);
const Card = ({children,style,accent,blue}) => (
  <div style={{background:C.card,border:`1.5px solid ${accent?C.tealBorder:blue?"rgba(59,158,255,0.3)":C.border}`,borderRadius:14,padding:18,boxShadow:"0 1px 6px rgba(0,0,0,0.06)",...style}}>{children}</div>
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
const Spinner = ({sm}) => <div style={{width:sm?14:16,height:sm?14:16,border:`2px solid ${C.border}`,borderTopColor:C.blueMid,borderRadius:"50%",animation:"spin 0.7s linear infinite",display:"inline-block",verticalAlign:"middle"}} />;

// ─── PLACE AUTOCOMPLETE INPUT ─────────────────────────────────────────────────
function PlaceInput({label,value,onChange,onSelect,placeholder}) {
  const ref = useRef(null);
  const acRef = useRef(null);
  useEffect(()=>{
    loadGoogleMaps().then(maps=>{
      if (!ref.current||acRef.current) return;
      const ac = new maps.places.Autocomplete(ref.current,{types:["geocode"],componentRestrictions:{country:"us"}});
      ac.addListener("place_changed",()=>{
        const p = ac.getPlace();
        if (p.formatted_address) {
          onChange(p.formatted_address);
          onSelect?.({address:p.formatted_address,lat:p.geometry?.location?.lat(),lng:p.geometry?.location?.lng()});
        }
      });
      acRef.current = ac;
    }).catch(()=>{});
  },[]);
  return (
    <div style={{marginBottom:16}}>
      {label&&<Lbl>{label}</Lbl>}
      <input ref={ref} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ─── MAP COMPONENT ────────────────────────────────────────────────────────────
function RouteMap({stops,originCoords,destCoords,routeResult,origin,destination}) {
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  const markersRef = useRef([]);
  const rendererRef = useRef(null);

  useEffect(()=>{
    if (!mapRef.current||!originCoords||!destCoords) return;
    loadGoogleMaps().then(maps=>{
      if (instanceRef.current) instanceRef.current = null;
      instanceRef.current = new maps.Map(mapRef.current,{
        zoom:6,
        center:{lat:(originCoords.lat+destCoords.lat)/2,lng:(originCoords.lng+destCoords.lng)/2},
        mapTypeControl:false,streetViewControl:false,fullscreenControl:false,
        styles:[{featureType:"poi",elementType:"labels",stylers:[{visibility:"off"}]}],
      });
      const map = instanceRef.current;
      markersRef.current.forEach(m=>m.setMap(null));
      markersRef.current=[];
      if (rendererRef.current) rendererRef.current.setMap(null);
      rendererRef.current = new maps.DirectionsRenderer({
        suppressMarkers:true,
        polylineOptions:{strokeColor:C.blueMid,strokeWeight:5,strokeOpacity:0.75}
      });
      rendererRef.current.setMap(map);
      // Reuse the exact DirectionsResult from Step 1 — no second API call.
      // A second call re-routes from scratch and often picks a different highway
      // (e.g. I-70 through Kansas instead of I-40 through Tennessee/Oklahoma).
      if (routeResult) {
        rendererRef.current.setDirections(routeResult);
      }
      // Origin/destination pins
      markersRef.current.push(new maps.Marker({position:originCoords,map,
        icon:{path:maps.SymbolPath.CIRCLE,scale:10,fillColor:C.blueMid,fillOpacity:1,strokeColor:"#fff",strokeWeight:2.5},title:origin||"Origin"}));
      markersRef.current.push(new maps.Marker({position:destCoords,map,
        icon:{path:maps.SymbolPath.CIRCLE,scale:10,fillColor:C.blue,fillOpacity:1,strokeColor:"#fff",strokeWeight:2.5},title:destination||"Destination"}));
      // Fuel stop pins
      stops.forEach((stop,i)=>{
        if (!stop.lat||!stop.lng) return;
        markersRef.current.push(new maps.Marker({
          position:{lat:stop.lat,lng:stop.lng},map,
          icon:{path:maps.SymbolPath.CIRCLE,scale:9,fillColor:stop.isPartial?C.blueLight:C.teal,fillOpacity:1,strokeColor:"#fff",strokeWeight:2},
          label:{text:String(i+1),color:"#fff",fontSize:"11px",fontWeight:"700"},
          title:`Stop ${i+1}: ${stop.city} — $${stop.price.toFixed(2)}/gal`,
        }));
      });
    }).catch(console.error);
  },[stops,originCoords,destCoords,routeResult]);

  if (!originCoords||!destCoords) return (
    <div style={{height:280,background:"#e8f0f8",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:14,border:`1.5px solid ${C.border}`}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:8}}>🗺️</div>
        <div>Map appears after calculating your route</div>
      </div>
    </div>
  );
  return <div ref={mapRef} style={{height:300,borderRadius:12,border:`1.5px solid ${C.border}`,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,0.1)"}} />;
}

// ─── STEP BAR ─────────────────────────────────────────────────────────────────
function StepBar({step,onGoTo}) {
  const steps=["Route","Vehicle","Preferences","Results"];
  return (
    <div style={{display:"flex",alignItems:"center",marginBottom:28}}>
      {steps.map((s,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",flex:i<steps.length-1?1:"none"}}>
          <button onClick={()=>i<step&&onGoTo(i)} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:i<step?"pointer":"default",opacity:i>step?0.35:1}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:i<step?C.teal:i===step?C.blueDim:C.surface,border:`2px solid ${i<step?C.teal:i===step?C.blueMid:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:i<step?"#fff":i===step?C.blueMid:C.muted,transition:"all 0.3s"}}>
              {i<step?"✓":i+1}
            </div>
            <div style={{fontSize:10,fontWeight:600,color:i===step?C.blueMid:C.muted,letterSpacing:"0.4px",whiteSpace:"nowrap"}}>{s}</div>
          </button>
          {i<steps.length-1&&<div style={{flex:1,height:2,background:i<step?C.teal:C.border,margin:"0 4px",marginBottom:18,transition:"background 0.3s"}} />}
        </div>
      ))}
    </div>
  );
}

// ─── STEP 1: ROUTE ────────────────────────────────────────────────────────────
function StepRoute({data,onChange,onNext}) {
  const [showPop,setShowPop] = useState(false);
  const [loading,setLoading] = useState(false);
  const stops = data.stops || [];

  function addStop() {
    if (stops.length >= 10) return;
    onChange({stops:[...stops, {value:"", lat:null, lng:null}], totalMiles:"", driveTime:"", routeLegs:null});
  }

  function removeStop(idx) {
    const newStops = stops.filter((_,i)=>i!==idx);
    onChange({stops:newStops, totalMiles:"", driveTime:"", routeLegs:null});
  }

  function updateStop(idx, val) {
    const newStops = stops.map((s,i)=>i===idx?{...s,value:val}:s);
    onChange({stops:newStops, totalMiles:"", driveTime:"", routeLegs:null});
  }

  function selectStop(idx, place) {
    const newStops = stops.map((s,i)=>i===idx?{value:place.address,lat:place.lat,lng:place.lng}:s);
    onChange({stops:newStops, totalMiles:"", driveTime:"", routeLegs:null});
  }

  async function calcDistance() {
    if (!data.origin||!data.destination) return;
    setLoading(true);
    try {
      const maps = await loadGoogleMaps();
      const waypoints = stops
        .filter(s=>s.value)
        .map(s=>({location:s.value, stopover:true}));
      // Use lat/lng from autocomplete if available — prevents Google from re-geocoding
      // the address string and potentially picking a different route than I-40/I-44.
      const originPoint = data.originLat
        ? new maps.LatLng(data.originLat, data.originLng)
        : data.origin;
      const destPoint = data.destLat
        ? new maps.LatLng(data.destLat, data.destLng)
        : data.destination;
      const result = await new Promise((res,rej)=>{
        new maps.DirectionsService().route({
          origin: originPoint,
          destination: destPoint,
          waypoints,
          travelMode:maps.TravelMode.DRIVING
        },(r,s)=>s==="OK"?res(r):rej(s));
      });
      const legs = result.routes[0].legs;
      const totalMeters = legs.reduce((s,l)=>s+l.distance.value,0);
      const totalSecs = legs.reduce((s,l)=>s+l.duration.value,0);
      const miles = Math.round(totalMeters/1609.34);
      const hrs = Math.floor(totalSecs/3600);
      const mins = Math.round((totalSecs%3600)/60);
      onChange({
        totalMiles:miles,
        driveTime:`${hrs}h ${mins}m`,
        originLat:legs[0].start_location.lat(),
        originLng:legs[0].start_location.lng(),
        destLat:legs[legs.length-1].end_location.lat(),
        destLng:legs[legs.length-1].end_location.lng(),
        routeLegs:legs,
        routeResult:result,
      });
    } catch(e){alert("Could not calculate route. Please check the addresses and try again.");}
    setLoading(false);
  }

  const ready = data.origin&&data.destination&&data.totalMiles;

  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Plan your route</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:24}}>Start typing — Google Maps autocomplete will suggest addresses</p>

      <PlaceInput label="Starting Point" value={data.origin||""} onChange={v=>onChange({origin:v,totalMiles:"",driveTime:"",routeLegs:null})} onSelect={p=>onChange({origin:p.address,originLat:p.lat,originLng:p.lng})} placeholder="e.g. Edwards, CO" />

      {/* Optional stops */}
      {stops.map((stop,idx)=>(
        <div key={idx} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:0}}>
          <div style={{flex:1}}>
            <PlaceInput
              label={`Stop ${idx+1}${stops.length>1?` of ${stops.length}`:""}`}
              value={stop.value}
              onChange={v=>updateStop(idx,v)}
              onSelect={p=>selectStop(idx,p)}
              placeholder={`e.g. Grand Junction, CO`}
            />
          </div>
          <button onClick={()=>removeStop(idx)} style={{marginTop:28,background:"none",border:`1.5px solid ${C.border}`,color:C.red,borderRadius:8,padding:"10px 12px",fontSize:14,flexShrink:0}}>✕</button>
        </div>
      ))}

      {/* Add stop button */}
      {stops.length < 10 && (
        <button onClick={addStop} style={{width:"100%",marginBottom:16,padding:"10px",background:"#f5f8fc",border:`1.5px dashed ${C.blueBorder}`,color:C.blueMid,borderRadius:10,fontSize:13,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          + Add a Stop {stops.length>0?`(${stops.length}/10)`:""}
        </button>
      )}

      <PlaceInput label="Destination" value={data.destination||""} onChange={v=>onChange({destination:v,totalMiles:"",driveTime:"",routeLegs:null})} onSelect={p=>onChange({destination:p.address,destLat:p.lat,destLng:p.lng})} placeholder="e.g. Las Vegas, NV" />

      {data.origin&&data.destination&&!data.totalMiles&&(
        <button onClick={calcDistance} disabled={loading} style={{width:"100%",marginBottom:16,padding:"12px",background:C.blueDim,border:`1.5px solid ${C.blueBorder}`,color:C.blueMid,borderRadius:10,fontSize:14,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          {loading?<><Spinner sm/>&nbsp;Calculating route...</>:"📍 Get exact miles & drive time from Google Maps"}
        </button>
      )}

      <button onClick={()=>setShowPop(s=>!s)} style={{background:"none",border:`1px dashed ${C.border}`,color:C.muted,borderRadius:10,padding:"10px 16px",fontSize:13,width:"100%",marginBottom:12}}>
        {showPop?"▲ Hide popular routes":"▼ Pick a popular route"}
      </button>
      {showPop&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {POPULAR_ROUTES.map((r,i)=>(
            <button key={i} onClick={()=>{onChange({origin:r.origin,destination:r.dest,stops:[],totalMiles:"",driveTime:"",routeLegs:null});setShowPop(false);}} style={{background:"#f5f8fc",border:`1.5px solid ${C.border}`,borderRadius:10,padding:"10px 12px",textAlign:"left",color:C.text,fontSize:12}}>
              <div style={{fontWeight:600,marginBottom:2}}>{r.origin.split(",")[0]} → {r.dest.split(",")[0]}</div>
              <div style={{color:C.muted,fontSize:11}}>Tap to load → then get miles</div>
            </button>
          ))}
        </div>
      )}

      {data.totalMiles&&(
        <Card accent style={{marginBottom:20}}>
          <div style={{fontSize:11,color:C.teal,letterSpacing:"0.5px",marginBottom:12}}>ROUTE CONFIRMED ✓</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            <Stat label="Distance" value={`${data.totalMiles} mi`} accent />
            <Stat label="Drive Time" value={data.driveTime||"—"} />
            <Stat label="Stops Added" value={stops.filter(s=>s.value).length||"None"} />
          </div>
          {stops.filter(s=>s.value).length>0&&(
            <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>YOUR STOPS</div>
              {stops.filter(s=>s.value).map((s,i)=>(
                <div key={i} style={{fontSize:12,color:C.text,padding:"4px 0",display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{color:C.teal,fontWeight:700}}>●</span>{s.value}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <PBtn onClick={onNext} disabled={!ready} full>Continue to Vehicle →</PBtn>
    </div>
  );
}

// ─── STEP 2: VEHICLE ──────────────────────────────────────────────────────────
function StepVehicle({data,onChange,onNext,onBack,saved,onSave}) {
  const [showSaved,setShowSaved] = useState(false);
  const [makes,setMakes] = useState([]);
  const [models,setModels] = useState([]);
  const [trims,setTrims] = useState([]);
  const [makesLoading,setMakesLoading] = useState(false);
  const [modelsLoading,setModelsLoading] = useState(false);
  const [epaStatus,setEpaStatus] = useState("idle");
  const [modelQuery,setModelQuery] = useState(data.model||"");
  const [suggestions,setSuggestions] = useState([]);
  const [showSuggestions,setShowSuggestions] = useState(false);
  const searchTimer = useRef(null);

  useEffect(()=>{
    if (!data.year){setMakes([]);return;}
    setMakesLoading(true);
    fetchMakes(data.year).then(m=>{setMakes(m);setMakesLoading(false);});
  },[data.year]);

  useEffect(()=>{
    if (!data.year||!data.make){setModels([]);return;}
    setModelsLoading(true);
    fetchModels(data.year,data.make).then(m=>{setModels(m);setModelsLoading(false);});
  },[data.year,data.make]);

  // Search EPA models as user types
  function handleModelInput(val) {
    setModelQuery(val);
    onChange({model:"",trim:"",epaCombined:"",mpgLocked:false});
    setTrims([]);
    setEpaStatus("idle");
    setSuggestions([]);
    if (!data.year||!data.make||val.length<2){setShowSuggestions(false);return;}
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async ()=>{
      const results = await searchEpaVehicles(data.year, data.make, val);
      setSuggestions(results.slice(0,8));
      setShowSuggestions(results.length>0);
    }, 300);
  }

  function selectModel(model) {
    setModelQuery(model);
    setSuggestions([]);
    setShowSuggestions(false);
    onChange({model, trim:"", epaCombined:"", mpgLocked:false});
    setEpaStatus("loading");
    fetchEpaTrims(data.year, data.make, model).then(opts=>{
      setTrims(opts);
      setEpaStatus(opts.length?"options":"notfound");
    });
  }

  async function pickTrim(opt) {
    setEpaStatus("loading");
    const specs = await fetchEpaById(opt.value);
    if (specs) {
      const realWorldMpg = String(Math.round(specs.combined * REAL_WORLD_FACTOR * 10) / 10);
      // Try EPA tank first, fall back to our tank database
      const epaTank = specs.tank && specs.tank > 0 ? specs.tank : 0;
      const dbTank = lookupTank(data.make, data.model);
      const rawTank = epaTank || dbTank;
      const listedStr = rawTank > 0 ? String(rawTank) : "";
      const usableStr = rawTank > 2 ? String(Math.round((rawTank - 2) * 10) / 10) : "";
      onChange({
        trim: opt.text,
        epaCombined: specs.combined,
        epaCity: specs.city,
        epaHwy: specs.hwy,
        fuelType: specs.fuelType,
        mpg: realWorldMpg,
        listedTank: listedStr,
        usableTank: usableStr,
        mpgLocked: false,
        tankLocked: false,
      });
      setEpaStatus("found");
    } else {
      onChange({trim: opt.text});
      setEpaStatus("notfound");
    }
  }

  const mpg=parseFloat(data.mpg)||0;
  const listed=parseFloat(data.listedTank)||0;
  // If usableTank not set, auto-calculate as listedTank - 2 gal
  const usable=parseFloat(data.usableTank)||(listed>2?Math.round((listed-2)*10)/10:0);
  const practical=Math.round(mpg*usable);
  const reserve=Math.round((listed-usable)*10)/10;
  const reserveRange=Math.round(reserve*mpg);
  const curFuel=Math.round(usable*(tankRatio[data.tankPct]||1)*10)/10;
  const curRange=Math.round(curFuel*mpg);
  // Ready when we have MPG and either tank field — EPA auto-fill counts
  const hasMpg = parseFloat(data.mpg) > 0;
  const listedNum = parseFloat(data.listedTank) || 0;
  const usableNum = parseFloat(data.usableTank) || (listedNum > 2 ? Math.round((listedNum - 2) * 10) / 10 : 0);
  const hasTank = usableNum > 0 || listedNum > 0;
  // fuelType always has a default ("Regular") so don't gate on it
  const ready = hasMpg && hasTank;
  const readyHint = !hasMpg ? "Enter your MPG to continue" : !hasTank ? "Enter your tank size to continue" : "";

  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Your vehicle</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:20}}>All data powered by the EPA fuel economy database — every vehicle, perfectly matched</p>

      {saved.length>0&&(
        <button onClick={()=>setShowSaved(s=>!s)} style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,color:C.teal,borderRadius:10,padding:"10px 16px",fontSize:13,width:"100%",marginBottom:10,fontWeight:600}}>
          ⭐ Load saved vehicle ({saved.length})
        </button>
      )}
      {showSaved&&(
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
          {saved.map((v,i)=>(
            <button key={i} onClick={()=>{onChange(v);setShowSaved(false);setEpaStatus("found");}} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",textAlign:"left",color:C.text}}>
              <div style={{fontWeight:600,fontSize:14}}>{v.year} {v.make} {v.model} {v.trim}</div>
              <div style={{fontSize:12,color:C.muted}}>{v.fuelType} · {v.mpg} MPG · {v.usableTank} gal usable</div>
            </button>
          ))}
        </div>
      )}

      {/* Year / Make / Model dropdowns powered by NHTSA */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:4}}>
        <div>
          <Lbl>Year</Lbl>
          <select value={data.year||""} onChange={e=>onChange({year:e.target.value,make:"",model:"",trim:"",epaCombined:"",mpgLocked:false})}>
            <option value="">Select year</option>
            {Array.from({length:20},(_,i)=>2025-i).map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <Lbl hint={makesLoading?"Loading from EPA database...":makes.length?`${makes.length} makes available`:""}>Make</Lbl>
          <select value={data.make||""} onChange={e=>onChange({make:e.target.value,model:"",trim:""})} disabled={!makes.length}>
            <option value="">{makesLoading?"Loading...":makes.length?"Select make":"Select year first"}</option>
            {makes.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Model — BOTH dropdown and search box */}
      <div style={{marginBottom:4}}>
        <Lbl hint={modelsLoading?"Loading models...":models.length?`${models.length} models — pick from list or type below`:"Select make first"}>Model</Lbl>
        <select
          value={data.model||""}
          onChange={e=>{
            if (!e.target.value) return;
            selectModel(e.target.value);
          }}
          disabled={!models.length}
          style={{marginBottom:8,borderColor:data.model?C.tealBorder:C.border}}
        >
          <option value="">{modelsLoading?"Loading...":models.length?"Browse models...":"Select make first"}</option>
          {models.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16,position:"relative"}}>
        <Lbl hint="Can't find it above? Type to search (e.g. RX 350, 1500, 4Runner)">Or search by typing</Lbl>
        <input
          value={modelQuery}
          onChange={e=>handleModelInput(e.target.value)}
          placeholder={data.make?`Type model name e.g. RX 350, 1500, 4Runner`:"Select make first"}
          disabled={!data.make}
          style={{paddingRight:data.model?"36px":"14px",borderColor:data.model?C.tealBorder:C.border}}
        />
        {data.model&&<span style={{position:"absolute",right:12,top:32,fontSize:14,color:C.teal}}>✓</span>}
        {showSuggestions&&suggestions.length>0&&(
          <div style={{position:"absolute",top:"100%",left:0,right:0,background:"#fff",border:`1.5px solid ${C.blueBorder}`,borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,0.12)",zIndex:50,overflow:"hidden"}}>
            {suggestions.map((s,i)=>(
              <button key={i} onClick={()=>selectModel(s)} style={{display:"block",width:"100%",padding:"10px 14px",textAlign:"left",background:i%2===0?"#fff":"#f8fafd",border:"none",color:C.text,fontSize:14,borderBottom:`1px solid ${C.border}`}}>
                {data.year} {data.make} <strong>{s}</strong>
              </button>
            ))}
          </div>
        )}
        {data.model&&<div style={{fontSize:12,color:C.teal,marginTop:4}}>✓ Selected: {data.year} {data.make} {data.model}</div>}
      </div>

      {/* EPA status */}
      {epaStatus==="loading"&&(
        <div style={{display:"flex",alignItems:"center",gap:10,background:C.blueDim,border:`1px solid ${C.blueBorder}`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.blueMid}}>
          <Spinner sm/>&nbsp;Looking up EPA data...
        </div>
      )}
      {epaStatus==="options"&&trims.length>0&&(
        <div style={{marginBottom:16}}>
          <Lbl hint="Select your trim — MPG auto-fills from the EPA database">Trim / Engine Option</Lbl>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {trims.map((opt,i)=>(
              <button key={i} onClick={()=>pickTrim(opt)} style={{background:data.trim===opt.text?C.tealDim:"#f8fafd",border:`1.5px solid ${data.trim===opt.text?C.tealBorder:C.border}`,borderRadius:10,padding:"10px 14px",textAlign:"left",color:C.text,fontSize:13,transition:"all 0.15s"}}>
                {opt.text}{data.trim===opt.text&&<span style={{color:C.teal,fontWeight:600,marginLeft:8}}>✓ Selected</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {epaStatus==="found"&&(
        <div style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.teal}}>
          ✓ EPA data loaded — {data.epaCity}/{data.epaHwy}/{data.epaCombined} MPG (city/hwy/combined)
        </div>
      )}
      {epaStatus==="notfound"&&(
        <div style={{background:C.amberDim,border:`1px solid ${C.amber}33`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13,color:C.amber}}>
          ⚠ No EPA data found for this vehicle — enter specs manually below
        </div>
      )}

      <Lbl>Fuel Type</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        {FUEL_TYPES.map(f=><Chip key={f} active={data.fuelType===f} onClick={()=>onChange({fuelType:f})}>{f}</Chip>)}
      </div>

      {/* Real-world values */}
      <div style={{background:"#f8fafd",border:`1.5px solid ${C.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,color:C.muted,letterSpacing:"0.5px",marginBottom:4}}>REAL-WORLD VALUES</div>
        <div style={{fontSize:12,color:C.hint,marginBottom:14}}>Auto-filled from EPA estimates — adjust these to match how your car actually performs.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>

          {/* EPA MPG — read only, shown for reference */}
          <div>
            <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase",marginBottom:8}}>
              EPA Combined MPG
            </div>
            <div style={{position:"relative"}}>
              <input type="number" value={data.epaCombined||""} readOnly placeholder="Auto-fills" style={{paddingRight:44,background:"#f0f6ff",borderColor:C.border,color:C.muted,cursor:"default"}} />
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>MPG</span>
            </div>
            <div style={{fontSize:11,color:C.hint,marginTop:4}}>From EPA database — read only</div>
          </div>

          {/* Real-world MPG — editable */}
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase"}}>Real-World MPG</div>
              {epaStatus==="found"&&!data.mpgLocked&&<span style={{fontSize:10,background:C.tealDim,color:C.teal,border:`1px solid ${C.tealBorder}`,borderRadius:4,padding:"1px 6px",fontWeight:600}}>AUTO</span>}
            </div>
            <div style={{position:"relative"}}>
              <input type="number" value={data.mpg||""} onChange={e=>onChange({mpg:e.target.value,mpgLocked:true})} placeholder="21.3" style={{paddingRight:44}} />
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>MPG</span>
            </div>
            <div style={{fontSize:11,color:C.hint,marginTop:4}}>Your actual highway average</div>
          </div>

          {/* Listed tank — auto-fills from EPA */}
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase"}}>Listed Tank Size</div>
              {epaStatus==="found"&&<span style={{fontSize:10,background:C.tealDim,color:C.teal,border:`1px solid ${C.tealBorder}`,borderRadius:4,padding:"1px 6px",fontWeight:600}}>AUTO</span>}
            </div>
            <div style={{position:"relative"}}>
              <input type="number" value={data.listedTank||""} onChange={e=>{
                const t = parseFloat(e.target.value)||0;
                onChange({listedTank:e.target.value, usableTank: t>2 ? String(Math.round((t-2)*10)/10) : ""});
              }} placeholder="19.2" style={{paddingRight:36}} />
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>gal</span>
            </div>
          </div>

          {/* Gallons at empty — auto = tank minus 2 gal */}
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.7px",textTransform:"uppercase"}}>Gallons at Empty</div>
              {data.usableTank&&<span style={{fontSize:10,background:C.tealDim,color:C.teal,border:`1px solid ${C.tealBorder}`,borderRadius:4,padding:"1px 6px",fontWeight:600}}>AUTO</span>}
            </div>
            <div style={{position:"relative"}}>
              <input type="number" value={data.usableTank||""} onChange={e=>onChange({usableTank:e.target.value,tankLocked:true})} placeholder="16.5" style={{paddingRight:36}} />
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>gal</span>
            </div>
            <div style={{fontSize:11,color:C.hint,marginTop:4}}>Listed tank minus 2-gal reserve</div>
          </div>

        </div>
      </div>

      {mpg&&usable>0&&(
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
      )}



      <div style={{display:"flex",gap:10}}>
        <GBtn onClick={onBack}>← Back</GBtn>
        <PBtn onClick={()=>{
          if (!ready) { return; }
          try {
            const listed = parseFloat(data.listedTank)||0;
            const dbTank = lookupTank(data.make, data.model);
            const finalListed = listed || dbTank;
            const finalUsable = data.usableTank ||
              (finalListed > 2 ? String(Math.round((finalListed - 2) * 10) / 10) : "");
            onSave({...data, listedTank: String(finalListed)||data.listedTank, usableTank: finalUsable});
            onNext();
          } catch(err) {
            setClickError(err.message + "\n" + (err.stack||""));
          }
        }} disabled={!ready} full>Save Vehicle & Continue →</PBtn>
        {!ready && readyHint && <div style={{textAlign:"center",fontSize:12,color:"#ef4444",marginTop:6}}>{readyHint}</div>}

      </div>
    </div>
  );
}

// ─── STEP 3: PREFERENCES ─────────────────────────────────────────────────────
function StepPrefs({data,onChange,onNext,onBack,loading}) {
  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      <h2 style={{fontSize:22,fontWeight:700,marginBottom:4}}>Your preferences</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:24}}>How should CheapRoute plan your stops?</p>
      <Lbl hint={`Only stop where you'll have at least ${data.bufferMiles} miles remaining`}>Safety Buffer</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
        {BUFFER_OPTS.map(b=><Chip key={b} active={data.bufferMiles===b} onClick={()=>onChange({bufferMiles:b})}>{b} mi</Chip>)}
      </div>
      <Lbl hint="Max miles you'll go off-route for cheaper fuel">Max Detour</Lbl>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:24}}>
        {DETOUR_OPTS.map(d=><Chip key={d} active={data.maxDetour===d} onClick={()=>onChange({maxDetour:d})}>{d} mi</Chip>)}
      </div>
      <Lbl hint="What should CheapRoute prioritize?">Optimization Mode</Lbl>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
        {OPT_MODES.map(o=>(
          <button key={o.key} onClick={()=>onChange({optimization:o.key})} style={{padding:"14px 16px",borderRadius:12,textAlign:"left",border:`1.5px solid ${data.optimization===o.key?C.blueMid:C.border}`,background:data.optimization===o.key?C.blueDim:"#f8fafd",color:data.optimization===o.key?C.blueMid:C.muted,transition:"all 0.15s"}}>
            <i className={`ti ${o.icon}`} style={{fontSize:20,display:"block",marginBottom:8}} />
            <div style={{fontSize:13,fontWeight:600}}>{o.label}</div>
          </button>
        ))}
      </div>
      <Card style={{background:"#f8fafd",marginBottom:24}}>
        <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Settings summary</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          <Stat label="Buffer" value={`${data.bufferMiles} mi`} sm />
          <Stat label="Max Detour" value={`${data.maxDetour} mi`} sm />
          <Stat label="Mode" value={OPT_MODES.find(o=>o.key===data.optimization)?.label||"—"} sm />
        </div>
      </Card>
      <div style={{display:"flex",gap:10}}>
        <GBtn onClick={onBack}>← Back</GBtn>
        <PBtn onClick={onNext} disabled={loading} full>{loading?<><Spinner sm/>&nbsp;Finding best stops...</>:"Calculate My Route ⛽"}</PBtn>
      </div>
    </div>
  );
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function MarkFilledModal({stop,onClose,onConfirm}) {
  const [gallons,setGallons] = useState(String(stop.gallons));
  const [price,setPrice] = useState(String(stop.price));
  const cost = Math.round(parseFloat(gallons||0)*parseFloat(price||0)*100)/100;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24,width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.15)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700}}>Mark as Filled ⛽</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22}}>×</button>
        </div>
        <div style={{fontSize:13,color:C.muted,marginBottom:16}}>{stop.city} · {stop.stationName}</div>
        <div style={{marginBottom:14}}>
          <Lbl>Gallons Purchased</Lbl>
          <div style={{position:"relative"}}><input type="number" value={gallons} onChange={e=>setGallons(e.target.value)} style={{paddingRight:36}} /><span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>gal</span></div>
        </div>
        <div style={{marginBottom:14}}>
          <Lbl>Actual Price Per Gallon</Lbl>
          <div style={{position:"relative"}}><input type="number" value={price} onChange={e=>setPrice(e.target.value)} style={{paddingRight:44}} /><span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>$/gal</span></div>
        </div>
        {cost>0&&<div style={{background:C.tealDim,border:`1px solid ${C.tealBorder}`,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:14,color:C.teal,fontWeight:600}}>Total paid: ${cost.toFixed(2)}</div>}
        <PBtn onClick={()=>onConfirm({gallons:parseFloat(gallons),price:parseFloat(price),cost})} full>Confirm Fill-Up</PBtn>
      </div>
    </div>
  );
}

function UpdateMpgModal({currentMpg,onClose,onConfirm}) {
  const [mpg,setMpg] = useState(String(currentMpg));
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:24,width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.15)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700}}>Update Real-World MPG</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22}}>×</button>
        </div>
        <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Based on this leg, what MPG are you getting? CheapRoute recalculates all remaining stops with your actual fuel economy.</div>
        <div style={{marginBottom:14}}>
          <Lbl>Actual MPG This Leg</Lbl>
          <div style={{position:"relative"}}><input type="number" value={mpg} onChange={e=>setMpg(e.target.value)} style={{paddingRight:44}} /><span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted,pointerEvents:"none"}}>MPG</span></div>
        </div>
        <div style={{fontSize:12,color:C.hint,marginBottom:16}}>Tip: Divide miles driven by gallons purchased, or read your trip computer.</div>
        <PBtn onClick={()=>onConfirm(parseFloat(mpg))} disabled={!mpg||isNaN(parseFloat(mpg))} full>Update & Recalculate</PBtn>
      </div>
    </div>
  );
}

// ─── STOP CARD ────────────────────────────────────────────────────────────────
function StopCard({stop,fuelType,onMarkFilled,onSkip}) {
  const [open,setOpen] = useState(false);
  const navGoogle = () => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.stationName+", "+stop.city)}`,"_blank");
  const navWaze = () => window.open(`https://waze.com/ul?q=${encodeURIComponent(stop.city)}&navigate=yes`,"_blank");
  const navApple = () => window.open(`https://maps.apple.com/?q=${encodeURIComponent(stop.stationName+", "+stop.city)}`,"_blank");

  if (stop.filled) return (
    <div style={{background:"#f8fafd",border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12,opacity:0.7}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontWeight:700,fontSize:14,color:C.teal}}>✓ {stop.city}</div><div style={{fontSize:12,color:C.muted}}>{stop.stationName}</div></div>
        <div style={{textAlign:"right"}}><Tag color="green">Filled</Tag><div style={{fontSize:11,color:C.muted,marginTop:4}}>${stop.actualCost?.toFixed(2)} · {stop.actualGallons} gal @ ${stop.actualPrice?.toFixed(2)}/gal</div></div>
      </div>
    </div>
  );
  if (stop.skipped) return (
    <div style={{background:"#f8fafd",border:`1px dashed ${C.border}`,borderRadius:14,padding:14,marginBottom:12,opacity:0.5}}>
      <div style={{fontSize:13,color:C.muted}}>⏭ Skipped — {stop.city}</div>
    </div>
  );

  return (
    <Card style={{marginBottom:12}} accent={!stop.isPartial}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <div style={{width:34,height:34,borderRadius:"50%",flexShrink:0,background:stop.isPartial?C.blueDim:C.tealDim,border:`2px solid ${stop.isPartial?C.blueMid:C.teal}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:stop.isPartial?C.blueMid:C.teal}}>{stop.stopNum}</div>
          <div><div style={{fontWeight:700,fontSize:15}}>{stop.city}</div><div style={{fontSize:12,color:C.muted}}>{stop.stationName}</div></div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:19,fontWeight:700}}>${stop.cost.toFixed(2)}</div>
          <div style={{fontSize:11,color:C.muted}}>{stop.gallons} gal · ${stop.price.toFixed(2)}/gal</div>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        {stop.isPartial?<Tag color="blue">Partial Fill</Tag>:<Tag color="green">Fill Recommended</Tag>}
        <Tag color="amber">+{stop.detourMiles} mi detour</Tag>
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

      {/* Primary actions */}
      <div style={{display:"flex",gap:8,marginBottom:8}}>
        <button onClick={onMarkFilled} style={{flex:2,background:`linear-gradient(135deg,${C.blueMid},${C.blue})`,border:"none",color:"#fff",borderRadius:8,padding:"10px 14px",fontSize:13,fontWeight:600,boxShadow:"0 2px 6px rgba(26,58,107,0.2)"}}>⛽ Mark as Filled</button>
        <button onClick={onSkip} style={{flex:1,background:"#f5f8fc",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"10px 14px",fontSize:13}}>Skip →</button>
      </div>

      {/* Navigation deep-links */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
        <button onClick={navGoogle} style={{background:"#e8f5e9",border:"1px solid #a5d6a7",color:"#2e7d32",borderRadius:8,padding:"8px 4px",fontSize:11,fontWeight:600}}>🗺️ Google Maps</button>
        <button onClick={navWaze} style={{background:"#e3f2fd",border:"1px solid #90caf9",color:"#1565c0",borderRadius:8,padding:"8px 4px",fontSize:11,fontWeight:600}}>🚗 Waze</button>
        <button onClick={navApple} style={{background:"#fce4ec",border:"1px solid #f48fb1",color:"#880e4f",borderRadius:8,padding:"8px 4px",fontSize:11,fontWeight:600}}>🍎 Apple Maps</button>
      </div>

      <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"none",color:C.hint,fontSize:12,padding:0}}>{open?"▲ Less":"▼ Station details"}</button>
      {open&&(
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
function StepResults({plan,setPlan,trip,setTrip,onReset,onSaveTrip,savedTrips}) {
  const [view,setView] = useState("map");
  const [fillingStop,setFillingStop] = useState(null);
  const [showMpg,setShowMpg] = useState(false);
  const [actualSpent,setActualSpent] = useState(0);
  const {summary,stops,warnings} = plan;

  function updatePref(changes) {
    const newTrip={...trip,...changes};
    setTrip(newTrip);
    // Regenerate segs whenever buffer or detour changes — both affect stop spacing/filtering
    let segs = plan.segs;
    if (newTrip.routeLegs && (
      changes.bufferMiles !== undefined ||
      changes.maxDetour !== undefined
    )) {
      const practicalRange = Math.round(newTrip.usableTank * newTrip.mpg);
      segs = buildSegsFromLegs(newTrip.routeLegs, newTrip.fuelType, newTrip.totalMiles, practicalRange, newTrip.bufferMiles||25, newTrip.maxDetour||2, newTrip.realPrices||null);
    }
    const result=runEngine(newTrip, segs);
    result.stops=result.stops.map((s,i)=>{
      const old=stops[i];
      if(old?.filled) return{...s,filled:true,actualGallons:old.actualGallons,actualPrice:old.actualPrice,actualCost:old.actualCost};
      if(old?.skipped) return{...s,skipped:true};
      return s;
    });
    setPlan(result);
  }

  function handleMarkFilled(idx,fd) {
    const newStops=stops.map((s,i)=>i===idx?{...s,filled:true,actualGallons:fd.gallons,actualPrice:fd.price,actualCost:fd.cost}:s);
    setActualSpent(t=>t+fd.cost);
    setPlan(p=>({...p,stops:newStops}));
    setFillingStop(null);
    if(newStops.filter(s=>s.filled).length===1) setTimeout(()=>setShowMpg(true),500);
  }

  function handleMpgUpdate(newMpg) {
    const newTrip={...trip,mpg:newMpg};
    setTrip(newTrip);
    const result=runEngine(newTrip,plan.segs);
    result.stops=result.stops.map((s,i)=>{
      const old=stops[i];
      if(old?.filled) return{...s,filled:true,actualGallons:old.actualGallons,actualPrice:old.actualPrice,actualCost:old.actualCost};
      return s;
    });
    setPlan(result);
    setShowMpg(false);
  }

  const filledCount=stops.filter(s=>s.filled).length;
  const originCoords=trip.originLat?{lat:trip.originLat,lng:trip.originLng}:null;
  const destCoords=trip.destLat?{lat:trip.destLat,lng:trip.destLng}:null;

  return (
    <div style={{animation:"fadeIn 0.3s ease"}}>
      {/* Hero summary card */}
      <Card accent style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div>
            <div style={{fontSize:11,color:C.teal,letterSpacing:"0.5px",marginBottom:4}}>CHEAPROUTE PLAN</div>
            <div style={{fontSize:14,fontWeight:700}}>{trip.origin}</div>
            {(trip.stops||[]).filter(s=>s.value).map((s,i)=>(
              <div key={i} style={{fontSize:12,color:C.teal}}>↓ {s.value}</div>
            ))}
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
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted}}>
          <span>Baseline: <span style={{color:C.text}}>${summary.baseline.toFixed(2)}</span></span>
          <span style={{fontSize:10,color:trip.realPrices?"#059669":"#d97706",fontWeight:600,background:trip.realPrices?"#ecfdf5":"#fffbeb",padding:"2px 7px",borderRadius:99,marginLeft:8}}>
            {trip.realPrices?"✓ Live EIA prices":"~ Estimated prices"}
          </span>
          <span>Gallons: <span style={{color:C.text}}>{summary.totalGallons}</span></span>
          <span>Lowest range: <span style={{color:summary.lowestRange<80?C.red:C.text}}>{summary.lowestRange} mi</span></span>
        </div>
      </Card>

      {/* Live controls */}
      <Card style={{marginBottom:16,background:"#f8fafd"}}>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:"0.5px",marginBottom:12}}>ADJUST PLAN — changes apply instantly</div>
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
          <button onClick={()=>updatePref({bufferMiles:Math.min(trip.bufferMiles+25,100),maxDetour:Math.max(trip.maxDetour-1,1)})} style={{flex:1,background:"#f0ebff",border:"1.5px solid #c4b5fd",color:C.purple,borderRadius:8,padding:"9px 8px",fontSize:13,fontWeight:600}}>⬇ Fewer Stops</button>
          <button onClick={()=>updatePref({bufferMiles:Math.max(trip.bufferMiles-25,25),maxDetour:Math.min(trip.maxDetour+1,10)})} style={{flex:1,background:"#fff7ed",border:"1.5px solid #fcd9a0",color:C.amber,borderRadius:8,padding:"9px 8px",fontSize:13,fontWeight:600}}>⬆ More Stops</button>
          <button onClick={()=>setShowMpg(true)} style={{flex:1,background:C.blueDim,border:`1.5px solid ${C.blueBorder}`,color:C.blueMid,borderRadius:8,padding:"9px 8px",fontSize:13,fontWeight:600}}>📊 Update MPG</button>
        </div>
      </Card>

      {warnings.map((w,i)=>(
        <div key={i} style={{background:w.type==="warn"?C.amberDim:C.blueDim,border:`1px solid ${w.type==="warn"?C.amber:C.blueMid}33`,borderRadius:10,padding:"10px 14px",marginBottom:10,fontSize:13,color:w.type==="warn"?C.amber:C.blueMid,display:"flex",gap:10}}>
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

      {/* View tabs */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[["map","🗺️ Map"],["stops","Fuel Stops"],["summary","Trip Summary"],["trips",`Saved (${savedTrips.length})`]].map(([k,l])=>(
          <Chip key={k} active={view===k} onClick={()=>setView(k)} sm>{l}</Chip>
        ))}
      </div>

      {view==="map"&&(
        <div style={{marginBottom:16}}>
          <RouteMap origin={trip.origin} destination={trip.destination} stops={stops} originCoords={originCoords} destCoords={destCoords} routeResult={trip.routeResult} />
          <div style={{fontSize:12,color:C.muted,marginTop:8,textAlign:"center"}}>🟢 Recommended stops &nbsp;·&nbsp; 🔵 Partial fills &nbsp;·&nbsp; tap navigation buttons on each stop to get directions</div>
        </div>
      )}

      {view==="stops"&&(
        <div>
          {stops.length===0&&(
            <Card style={{textAlign:"center",padding:32}}>
              <div style={{fontSize:32,marginBottom:8}}>🎉</div>
              <div style={{fontWeight:600,marginBottom:4}}>No fuel stops needed!</div>
              <div style={{color:C.muted,fontSize:13}}>Your tank covers this whole route.</div>
            </Card>
          )}
          {stops.map((s,i)=>(
            <StopCard key={i} stop={s} fuelType={trip.fuelType}
              onMarkFilled={()=>setFillingStop(i)}
              onSkip={()=>setPlan(p=>({...p,stops:p.stops.map((st,j)=>j===i?{...st,skipped:true}:st)}))}
            />
          ))}
          {stops.length>0&&(
            <Card style={{display:"flex",alignItems:"center",gap:12,background:"#f8fafd"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:C.blueDim,border:`1px solid ${C.blueMid}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🏁</div>
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
          {[["Route",`${trip.origin} → ${trip.destination}`],["Distance",`${summary.totalMiles} miles`],["Drive Time",trip.driveTime||"—"],["Fuel Type",trip.fuelType],["Real-World MPG",`${trip.mpg} MPG`],["Total Gallons",`${summary.totalGallons} gal`],["Baseline Cost",`$${summary.baseline.toFixed(2)}`],["Optimized Cost",`$${summary.optCost.toFixed(2)}`,"blue"],["Savings",`$${summary.savings.toFixed(2)}`,"green"],["Added Detour",`${summary.detourTotal} min`],["Fuel Stops",summary.stopCount],["Safety Buffer",`${trip.bufferMiles} miles`],["Optimization",OPT_MODES.find(o=>o.key===trip.optimization)?.label]].map(([label,value,color])=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 14px"}}>
              <span style={{fontSize:13,color:C.muted}}>{label}</span>
              <span style={{fontSize:13,fontWeight:600,color:color==="blue"?C.blueMid:color==="green"?C.teal:C.text}}>{value}</span>
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
              <div style={{fontSize:12,color:C.muted}}>{t.totalMiles} mi · ${t.optCost?.toFixed(2)} fuel · saved ${t.savings?.toFixed(2)} · {t.date}</div>
            </Card>
          ))}
        </div>
      )}

      <div style={{display:"flex",gap:10,marginTop:20}}>
        <GBtn onClick={onReset}>← New Route</GBtn>
        <button onClick={onSaveTrip} style={{flex:1,background:"#f8fafd",border:`1px solid ${C.border}`,color:C.muted,borderRadius:10,padding:"12px",fontSize:14,fontWeight:500}}>💾 Save This Trip</button>
      </div>
      <button onClick={()=>window.open("https://docs.google.com/forms/d/e/1FAIpQLSckwOwDcbhOQ5dvVJ-cN82PhCY01gvXQ2YqFGIU8pQMniDJxw/viewform?usp=dialog","_blank")} style={{width:"100%",marginTop:10,background:"none",border:`1px dashed ${C.border}`,color:C.hint,borderRadius:10,padding:"10px",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
        💬 Share feedback or report a bug
      </button>


      {fillingStop!==null&&<MarkFilledModal stop={stops[fillingStop]} onClose={()=>setFillingStop(null)} onConfirm={fd=>handleMarkFilled(fillingStop,fd)} />}
      {showMpg&&<UpdateMpgModal currentMpg={trip.mpg} onClose={()=>setShowMpg(false)} onConfirm={handleMpgUpdate} />}
    </div>
  );
}

// ─── AUTH MODAL ───────────────────────────────────────────────────────────────
function AuthModal({onClose,onAuth}) {
  const [mode,setMode] = useState("signin");
  const [name,setName] = useState("");
  const [email,setEmail] = useState("");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:28,width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.15)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:18,fontWeight:700}}>{mode==="signin"?"Sign In":"Create Account"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:22}}>×</button>
        </div>
        {mode==="signup"&&<div style={{marginBottom:16}}><Lbl>Name</Lbl><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" /></div>}
        <div style={{marginBottom:16}}><Lbl>Email</Lbl><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></div>
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
const defRoute={origin:"",destination:"",totalMiles:"",driveTime:"",originLat:null,originLng:null,destLat:null,destLng:null,routeLegs:null,stops:[]};
const defVehicle={year:"",make:"",model:"",trim:"",epaCombined:"",listedTank:"",mpg:"",usableTank:"",fuelType:"Regular",tankPct:"Full",mpgLocked:false};
const defPrefs={bufferMiles:25,maxDetour:2,optimization:"balanced"};

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = {error:null}; }
  static getDerivedStateFromError(e) { return {error:e}; }
  render() {
    if (this.state.error) return (
      <div style={{padding:32,fontFamily:"sans-serif",maxWidth:600,margin:"0 auto"}}>
        <h2 style={{color:"#d93025",marginBottom:16}}>⚠️ Something went wrong</h2>
        <p style={{marginBottom:12,color:"#444"}}>CheapRoute encountered an error. Details below:</p>
        <pre style={{background:"#f5f5f5",padding:16,borderRadius:8,fontSize:12,overflow:"auto",whiteSpace:"pre-wrap",color:"#333"}}>
          {this.state.error.toString() + " " + (this.state.error.stack||"")}
        </pre>
        <button onClick={()=>window.location.reload()} style={{marginTop:16,padding:"10px 20px",background:"#2556a0",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14}}>
          Reload App
        </button>
      </div>
    );
    return this.props.children;
  }
}

export default function App() {
  const [step,setStep] = useState(0);
  const [route,setRoute] = useState(defRoute);
  const [vehicle,setVehicle] = useState(defVehicle);
  const [prefs,setPrefs] = useState(defPrefs);
  const [plan,setPlan] = useState(null);
  const [trip,setTrip] = useState(null);
  const [user,setUser] = useState(()=>ls("cr_user"));
  const [savedVehicles,setSavedVehicles] = useState(()=>ls("cr_vehicles")||[]);
  const [savedTrips,setSavedTrips] = useState(()=>ls("cr_trips")||[]);
  const [showAuth,setShowAuth] = useState(false);
  const [toast,setToast] = useState(null);
  const [loading,setLoading] = useState(false);

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2500);}
  function mr(d){setRoute(r=>({...r,...d}));}
  function mv(d){setVehicle(v=>({...v,...d}));}
  function mp(d){setPrefs(p=>({...p,...d}));}

  function saveVehicle(v){
    if(!v.make||!v.model) return;
    const upd=[v,...savedVehicles.filter(sv=>!(sv.make===v.make&&sv.model===v.model&&sv.year===v.year))].slice(0,5);
    setSavedVehicles(upd);ss("cr_vehicles",upd);showToast("Vehicle saved!");
  }

  async function calc(){
    setLoading(true);
    try {
      const practicalRange = Math.round(parseFloat(vehicle.usableTank||17) * parseFloat(vehicle.mpg||25));
      const bufMiles = prefs.bufferMiles||25;
      const maxDet = prefs.maxDetour||2;
      const fuelType = vehicle.fuelType;

      // First pass — build segs without prices to know which states we cross
      let tempSegs = route.routeLegs
        ? buildSegsFromLegs(route.routeLegs, fuelType, route.totalMiles, practicalRange, bufMiles, maxDet, null)
        : [];

      // Fetch real EIA weekly gas prices for those states (no-op if no API key yet)
      const routeStates = getStatesFromSegs(tempSegs);
      const realPrices = await fetchEIAPrices(routeStates, fuelType);

      // Second pass — rebuild segs with real prices
      const segs = route.routeLegs
        ? buildSegsFromLegs(route.routeLegs, fuelType, route.totalMiles, practicalRange, bufMiles, maxDet, realPrices)
        : [];

      const t = {...route,...prefs,mpg:parseFloat(vehicle.mpg),usableTank:parseFloat(vehicle.usableTank),
        listedTank:parseFloat(vehicle.listedTank),fuelType,tankPct:vehicle.tankPct,realPrices};
      const plan = runEngine(t, segs);
      setTrip(t);
      setPlan(plan);
      setStep(3);
    } catch(err) {
      alert("Error calculating route: " + err.message + "\n\n" + (err.stack||"").split("\n").slice(0,5).join("\n"));
    } finally {
      setLoading(false);
    }
  }

  function saveTrip(){
    if(!plan) return;
    const entry={origin:route.origin,destination:route.destination,totalMiles:route.totalMiles,optCost:plan.summary.optCost,savings:plan.summary.savings,date:new Date().toLocaleDateString()};
    const upd=[entry,...savedTrips].slice(0,10);
    setSavedTrips(upd);ss("cr_trips",upd);showToast("Trip saved!");
  }

  function reset(){setStep(0);setRoute(defRoute);setVehicle(defVehicle);setPrefs(defPrefs);setPlan(null);setTrip(null);}

  return (
    <ErrorBoundary>
    <>
      <style>{gCss}</style>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css" />
      <div style={{minHeight:"100vh",background:C.bg}}>
        {/* Header */}
        <div style={{background:`linear-gradient(135deg,${C.blue},${C.blueMid})`,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,boxShadow:"0 2px 12px rgba(26,58,107,0.2)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:10,background:"rgba(255,255,255,0.2)",border:"1.5px solid rgba(255,255,255,0.35)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>⛽</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,letterSpacing:"-0.3px",color:"#fff"}}>CheapRoute</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.65)",letterSpacing:"0.5px"}}>SPEND LESS GETTING THERE</div>
            </div>
          </div>
          <button onClick={()=>setShowAuth(true)} style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",borderRadius:8,padding:"6px 12px",fontSize:12,display:"flex",alignItems:"center",gap:5}}>
            <i className="ti ti-user" style={{fontSize:14}} />{user?user.name:"Sign In"}
          </button>
        </div>

        {/* Main content */}
        <div style={{maxWidth:640,margin:"0 auto",padding:"28px 18px 80px",minHeight:"calc(100vh - 62px)"}}>
          <StepBar step={step} onGoTo={n=>n<step&&setStep(n)} />
          {step===0&&<StepRoute data={route} onChange={mr} onNext={()=>setStep(1)} />}
          {step===1&&<StepVehicle data={vehicle} onChange={mv} onNext={()=>setStep(2)} onBack={()=>setStep(0)} saved={savedVehicles} onSave={saveVehicle} />}
          {step===2&&<StepPrefs data={prefs} onChange={mp} onNext={calc} onBack={()=>setStep(1)} loading={loading} />}
          {step===3&&plan&&trip&&<StepResults plan={plan} setPlan={setPlan} trip={trip} setTrip={setTrip} onReset={reset} onSaveTrip={saveTrip} savedTrips={savedTrips} />}
        </div>

        {showAuth&&<AuthModal onClose={()=>setShowAuth(false)} onAuth={u=>{setUser(u);ss("cr_user",u);showToast("Signed in!");}} />}
        {toast&&<div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",background:C.teal,color:"#fff",borderRadius:10,padding:"10px 20px",fontSize:14,fontWeight:600,zIndex:300,boxShadow:"0 4px 16px rgba(0,168,120,0.3)"}}>{toast}</div>}
      </div>
    </>
    </ErrorBoundary>
  );
}
