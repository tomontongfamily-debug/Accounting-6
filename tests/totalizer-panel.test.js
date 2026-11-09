import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrintedTotalizerArrow} from '../src/totalizer-panel.js';

test('only a filled, pointed triangle supplies printed-arrow proof',()=>{
 const width=150,height=160,box={x0:30,x1:90,y0:30,y1:130};
 for(const direction of ['left','right'])for(const offset of [0,direction==='left'?60:-30]){
  const bounds={...box,x0:box.x0+offset,x1:box.x1+offset};
  const gray=new Uint8Array(width*height).fill(190);
  for(let y=30;y<130;y++){
   const span=Math.round(60*(1-Math.abs(2*(y-30)/100-1)));
   const start=direction==='right'?bounds.x0:bounds.x1-span;
   for(let x=start;x<start+span;x++)gray[y*width+x]=30;
  }
  assert.equal(isPrintedTotalizerArrow(gray,width,height,bounds),true,direction+' at '+offset);
 }
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 const bars=[[8,0,35,10],[48,8,10,36],[48,56,10,38],[8,90,35,10],[1,56,10,38],[1,8,10,36],[8,45,35,10]];
 for(const pattern of patterns){
  const gray=new Uint8Array(width*height).fill(190);
  for(const [i,on]of [...pattern].entries())if(on==='1'){
   const [dx,dy,w,h]=bars[i];for(let y=30+dy;y<30+dy+h;y++)for(let x=30+dx;x<30+dx+w;x++)gray[y*width+x]=30;
  }
  assert.equal(isPrintedTotalizerArrow(gray,width,height,box),false,'No LCD digit is an outside arrow');
 }
 assert.equal(isPrintedTotalizerArrow(new Uint8Array(width*height).fill(190),width,height,box),false);
});
