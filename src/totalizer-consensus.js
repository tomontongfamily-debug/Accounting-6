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
