// Three crop resolutions are still one neural reader. Require corroboration
// from the independent seven-segment reader or physical-cell template.
export function chooseTotalizerReading({verified=null,tesseract=null,grid=[],neural=[]}){
  if(verified!==null)return verified;
  const physical=grid[0],goodGrid=physical&&physical.score<.08&&physical.margin>.04;
  const values=new Map();
  const allValues=new Set(neural.filter(r=>r.value!==null&&r.score>=.8).map(r=>r.value));
  for(const r of neural){
    const digits=String(Math.round(r.value*100)).padStart(8,'0');
    const narrowOne=r.digitConfidences?.length===8&&[...digits.slice(0,6)].every((d,i)=>r.digitConfidences[i]>=.85||d==='1');
    const corroboratedWeak=narrowOne&&allValues.size===1&&goodGrid&&physical.value===r.value&&physical.margin>.1&&r.score>.95&&r.integerConfidence>=.65&&r.fractionConfidence>.95;
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
