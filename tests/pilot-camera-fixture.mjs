// Test-only camera frames exercise the live capture path without opening a
// physical camera or changing any production report.
export function pumpCameraBootstrap({imageDataUrl='',failure=''}={}) {
  if(failure==='unsupported') {
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});
    return;
  }
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
    if(failure)throw new DOMException('Fixture camera access denied','NotAllowedError');
    let image;
    if(imageDataUrl){image=new Image();image.src=imageDataUrl;await image.decode();}
    const canvas=document.createElement('canvas');
    canvas.width=image?.naturalWidth||640;canvas.height=image?.naturalHeight||360;
    const context=canvas.getContext('2d');
    const draw=()=>{
      if(image)context.drawImage(image,0,0);
      else {context.fillStyle='#82958b';context.fillRect(0,0,canvas.width,canvas.height);context.font='65px monospace';context.fillStyle='#172922';context.fillText('10010.00',65,200);}
    };
    draw();const stream=canvas.captureStream(10),timer=setInterval(draw,100);
    for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};}
    return stream;
  }}});
}

export async function capturePumpCamera(page,card) {
  await card.getByRole('button',{name:'Open camera',exact:true}).click();
  const rowId=await card.getAttribute('data-pump-row-id');
  await page.waitForFunction(id=>{
    const video=[...document.querySelectorAll('[data-pump-row-id]')].find(row=>row.dataset.pumpRowId===id)?.querySelector('video');
    return video?.videoWidth>0&&video.readyState>=2;
  },rowId);
  await card.getByRole('button',{name:'Capture photo',exact:true}).click();
}

export async function confirmPumpReading(card){
  await card.getByRole('button',{name:/^(Yes, confirm reading|Save corrected reading|Review reading)$/}).click();
  await card.getByRole('dialog',{name:'Are you really sure?',exact:true}).getByRole('button',{name:"I'm really sure",exact:true}).click();
}
