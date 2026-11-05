// Lossless test-only camera pixels. These numbers are assertions, never reader
// configuration or an expected-value input to the recognizer.
export function totalizerDisplayFixture({text='',frame=false}) {
 const patterns=['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
 const boxes=[[8,8,20,10],[32,12,7,30],[32,55,7,30],[8,80,20,10],[1,55,7,30],[1,12,7,30],[8,44,20,10]];
 const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=500;
 const context=canvas.getContext('2d');context.fillStyle='#b7c9b9';context.fillRect(0,0,1000,500);context.fillStyle='#203529';
 let digit=0;
 for(const c of text){
  if(c==='.'){context.fillRect(100+(digit-1)*60+47,282,8,8);continue;}
  for(const [i,on] of [...patterns[Number(c)]].entries())if(on==='1'){
   const [x,y,w,h]=boxes[i];context.fillRect(100+digit*60+x,200+y,w,h);
  }
  digit++;
 }
 if(frame)context.fillRect(80,175,7,150);
 return canvas.toDataURL('image/png');
}
