// Seven-stroke classifier fitted to reviewed, geometrically aligned glyphs.
// Only aggregate coefficients are shipped; photos and complete counter values
// stay outside the repository. This model supplies evidence, never a reading.
import {TOTALIZER_GLYPH_WEIGHTS as weights} from './totalizer-glyph-weights.js';
const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
export function classifyTotalizerGlyph(coverage){
 if(coverage?.length!==7||coverage.some(v=>!Number.isFinite(v)||v<0||v>1))return null;
 const features=[...coverage.map(v=>(v-.5)*2),1];
 const scores=weights.map(w=>w.reduce((sum,v,i)=>sum+v*features[i],0));
 const maximum=Math.max(...scores),digit=scores.indexOf(maximum);
 const probability=1/scores.reduce((sum,v)=>sum+Math.exp(v-maximum),0);
 if(probability<.99||[...patterns[digit]].some((on,i)=>on==='1'?coverage[i]<.15:coverage[i]>.65))return null;
 return String(digit);
}
