// Preview coordinates only. Never change the stored photo or infer its number.
export function meterPhotoRegion(regions,width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  const row=(Array.isArray(regions)?regions:[]).find(region=>region&&['x','y','width','height'].every(key=>Number.isFinite(region[key]))&&
    region.x>=0&&region.y>=0&&region.width>0&&region.height>0&&
    region.x+region.width<=width&&region.y+region.height<=height&&region.width>=region.height*2);
  if(!row)return null;
  // Keep the entire detected row, its outside strokes and the decimal point.
  const horizontal=Math.max(3,Math.ceil(row.height*.22)),vertical=Math.max(3,Math.ceil(row.height*.3));
  const x=Math.max(0,Math.floor(row.x-horizontal)),y=Math.max(0,Math.floor(row.y-vertical));
  return {x:x/width,y:y/height,width:(Math.min(width,Math.ceil(row.x+row.width+horizontal))-x)/width,
    height:(Math.min(height,Math.ceil(row.y+row.height+vertical))-y)/height};
}
