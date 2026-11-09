// Three crop resolutions are still one neural reader. Require corroboration
// from the independent seven-segment reader or physical-cell template.
function corroboratedOne(physical,index,glyphs){
  if(physical?.digitMargins?.[index]>.1)return true;
  const layout=physical?.layout;if(!layout)return false;
  const j=index-5,x=layout.left+j*layout.pitch+j*j*(layout.curve||0)*layout.height;
  const h=layout.height+(layout.heightSlope||0)*(x+layout.glyphWidth*.5-layout.dotx),w=layout.glyphWidth*h/layout.height;
  const cx=x+w*.5,cy=layout.base+layout.slope*(x+layout.glyphWidth*.5-layout.dotx)-h*.5;
  return glyphs.some(s=>s.text==='1'&&s.confidence>=90&&!s.lcdAmbiguous&&
    Math.abs((s.bbox.x0+s.bbox.x1)/2-cx)<w*.35&&Math.abs((s.bbox.y0+s.bbox.y1)/2-cy)<h*.18&&
    s.bbox.y1-s.bbox.y0>h*.65&&s.bbox.y1-s.bbox.y0<h*1.3);
}

export function chooseFastTotalizerReading({tesseract=null,neural=[]}){
  // If every nonempty neural view agrees with the independent OCR reading,
  // fitting a grid cannot introduce another supported answer. Use the same
  // per-digit confidence rules; even a weak conflicting view needs the grid.
  if(tesseract===null||neural.some(r=>r.value!==null&&r.value!==tesseract))return null;
  return chooseTotalizerReading({tesseract,neural});
}

// A new resolution must never turn a previously rejected reflection into an
// automatic reading on physical verification alone. Require two confident
// neural resolutions and reject even a weak conflicting decoded view.
export function chooseRescueTotalizerReading({primary=null,neural=[],digitCount=null,minimumViews=2,minimumScore=.95,minimumInteger=.9,minimumFraction=.95}){
  // Short digit-only neural text has no numeric value until an independent
  // physical row proves both its complete cell count and two-place decimal.
  if(digitCount!==null)neural=neural.map(r=>r.value===null&&[6,7].includes(digitCount)&&
    r.unscaledDigits?.length===digitCount&&/^\d+$/.test(r.unscaledDigits)?
    {...r,value:Number(r.unscaledDigits)/100,physicalDecimal:true}:r);
  if(primary===null||neural.some(r=>r.value!==null&&(r.value!==primary||digitCount!==null&&r.digitConfidences?.length!==digitCount)))return null;
  const confident=neural.filter(r=>r.value===primary&&r.score>=minimumScore&&r.integerConfidence>=minimumInteger&&r.fractionConfidence>=minimumFraction&&
    (digitCount===null||r.decimalPlaces===2||r.physicalDecimal));
  return new Set(confident.map(r=>r.inputHeight)).size>=minimumViews?primary:null;
}

export function gridMatchesPhysicalRow(candidate,cells,{minimumKnown=4}={}){
 const layout=candidate?.layout,text=candidate?String(Math.round(candidate.value*100)).padStart(8,'0'):'';
 if(!layout||text.length!==8||cells.length<minimumKnown||cells.length>8||cells.filter(c=>/^\d$/.test(c.text)).length<minimumKnown)return false;
 const {left,pitch,height:h,glyphWidth:w,shear=0,base,slope=0,dotx,heightSlope=0,curve=0}=layout;
 if(![left,pitch,h,w,base,dotx].every(Number.isFinite)||h<=0||pitch<=0)return false;
 const fitted=Array.from({length:8},(_,i)=>{
  const j=i-5,x=left+j*pitch+j*j*curve*h,hh=h+heightSlope*(x+w*.5-dotx),ww=w*hh/h;
  return {x:x+ww*.5+shear*hh*.5,left:x,right:x+ww+shear*hh,bottom:base+slope*(x+w*.5-dotx),digit:text[i]};
 });
 if(cells.some(c=>c.bbox.x0<fitted[0].left-h*.2||c.bbox.x1>fitted.at(-1).right+h*.2))return false;
 return cells.filter(c=>/^\d$/.test(c.text)).every(c=>{
  const x=(c.bbox.x0+c.bbox.x1)/2;
  const aligned=fitted.filter(f=>Math.abs(f.x-x)<pitch*.45&&Math.abs(f.bottom-c.bbox.y1)<h*.2);
  return aligned.length===1&&aligned[0].digit===c.text;
 });
}

export function gridExplainsOcrHints(candidate,layouts){
 if(!candidate||candidate.score>=.04||candidate.margin<=.08||candidate.digitMargins?.length!==8||
   candidate.digitMargins.some(m=>m<=.08)||layouts.some(l=>l.physical.symbols.length>=9))return false;
 const {left,pitch,height:h,glyphWidth:w,base,slope=0,dotx,heightSlope=0,curve=0,shear=0}=candidate.layout||{};
 if(![left,pitch,h,w,base,dotx].every(Number.isFinite)||h<=0||pitch<=0)return false;
 const x0=left-5*pitch+25*curve*h,x7=left+2*pitch+4*curve*h;
 const right=x7+w+Math.abs(shear)*h,top=base-h;
 let hints=0;
 for(const layout of layouts){
  if(!layout.hints.length)continue;
  if(!gridMatchesPhysicalRow(candidate,layout.physical.symbols,{minimumKnown:3}))return false;
  for(const hint of layout.hints)for(const symbol of hint.symbols.filter(s=>/^\d$/.test(s.text))){
    const b=symbol.bbox;if(!b)return false;
    const x=(b.x0+b.x1)/2,y=(b.y0+b.y1)/2;
    const localBase=base+slope*(x-dotx),hh=h+heightSlope*(x-dotx);
    if(x<x0||x>right||b.x0<x0-h*.12||b.x1>right+h*.12||y<localBase-hh||y>localBase||
      b.y0<Math.min(top,localBase-hh)-h*.15||b.y1>localBase+h*.15)return false;
    hints++;
  }
 }
 return hints>0;
}

export function chooseTotalizerReading({verified=null,tesseract=null,grid=[],neural=[],glyphs=[]}){
  if(verified!==null)return verified;
  const physical=grid[0],goodGrid=physical&&physical.score<.08&&physical.margin>.04;
  const values=new Map();
  const allValues=new Set(neural.filter(r=>r.value!==null&&r.score>=.8).map(r=>r.value));
  for(const r of neural){
    const digits=String(Math.round(r.value*100)).padStart(8,'0');
    const narrowOne=r.digitConfidences?.length===8&&[...digits.slice(0,6)].every((d,i)=>r.digitConfidences[i]>=.85||d==='1'&&corroboratedOne(physical,i,glyphs));
    const corroboratedWeak=narrowOne&&allValues.size===1&&goodGrid&&physical.value===r.value&&r.score>.95&&r.integerConfidence>=.65&&r.fractionConfidence>.95;
    if(r.value===null||r.score<.9||r.integerConfidence<.85&&!corroboratedWeak||r.fractionConfidence<.5)continue;
    const prior=values.get(r.value);
    if(!prior||r.score>prior.score)values.set(r.value,r);
  }
  const majority=[...values.keys()].filter(value=>{
    const views=neural.filter(r=>r.value===value&&r.score>.9&&r.integerConfidence>.85&&r.fractionConfidence>.5);
    const otherReadings=[tesseract,goodGrid?physical.value:null].filter(v=>v!==null);
    return allValues.size>1&&otherReadings.length>0&&views.length>=3&&new Set(views.map(r=>r.inputHeight)).size>=2&&Math.max(...views.map(r=>r.fractionConfidence))>.85&&
      otherReadings.every(v=>Math.floor(v)===Math.floor(value));
  });
  if(majority.length===1)return majority[0];
  const supported=[...values.keys()].filter(value=>value===tesseract||goodGrid&&value===physical.value);
  if(supported.length===1)return supported[0];
  if(supported.length>1&&goodGrid&&supported.includes(physical.value)){
    // Keep the visible cell evidence when readers disagree only on the last
    // decimal digit. Conflicting integer readings always require another view.
    if(supported.every(value=>Math.floor(value)===Math.floor(physical.value)))return physical.value;
  }
  return null;
}
