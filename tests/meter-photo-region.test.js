import test from 'node:test';
import assert from 'node:assert/strict';
import {meterPhotoRegion} from '../src/meter-photo-region.js';
test('the preview retains the complete digit row with space for outside strokes and the decimal',()=>{
 const region={x:81,y:580,width:505,height:119},crop=meterPhotoRegion([region],720,1280);
 assert.ok(crop.x*720<region.x);assert.ok(crop.y*1280<region.y);
 assert.ok((crop.x+crop.width)*720>region.x+region.width);assert.ok((crop.y+crop.height)*1280>region.y+region.height);
});
test('preview padding clips to photo edges and never invents pixels outside the original',()=>{
 assert.deepEqual(meterPhotoRegion([{x:0,y:0,width:100,height:20}],100,20),{x:0,y:0,width:1,height:1});
 const crop=meterPhotoRegion([{x:2,y:5,width:95,height:25}],100,50);
 for(const key of ['x','y','width','height'])assert.ok(crop[key]>=0&&crop[key]<=1);
 assert.ok(crop.x+crop.width<=1);assert.ok(crop.y+crop.height<=1);
});
test('missing, corrupt or unsuitable regions fall back to the full photo',()=>{
 for(const regions of [undefined,{},[],[{x:NaN,y:0,width:10,height:1}],[{x:0,y:0,width:10,height:20}],[{x:0,y:0,width:101,height:20}]])assert.equal(meterPhotoRegion(regions,100,50),null);
 assert.equal(meterPhotoRegion([],0,50),null);
});
