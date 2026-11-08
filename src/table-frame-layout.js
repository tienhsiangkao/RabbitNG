function subtract(rect, cover) {
  const x = Math.max(rect.x, cover.x), y = Math.max(rect.y, cover.y);
  const right = Math.min(rect.x+rect.width, cover.x+cover.width);
  const bottom = Math.min(rect.y+rect.height, cover.y+cover.height);
  if (right <= x || bottom <= y) return [rect];
  return [
    { x:rect.x, y:rect.y, width:rect.width, height:y-rect.y },
    { x:rect.x, y:bottom, width:rect.width, height:rect.y+rect.height-bottom },
    { x:rect.x, y, width:x-rect.x, height:bottom-y },
    { x:right, y, width:rect.x+rect.width-right, height:bottom-y }
  ].filter(r => r.width > 0 && r.height > 0);
}

export function tableFrameLayout(table, blockers = [], appearance = {}) {
  const {x,y,width,height} = table;
  const multiplier=Number.isFinite(appearance.frameThickness)?Math.max(1,Math.min(6,appearance.frameThickness)):2;
  const thickness = multiplier * Math.max(2, Math.min(4, Math.round(Math.min(width,height)*.003)));
  // Keep the stronger stroke aligned to the window's outer edge.
  const inset = 0;
  if (![x,y,width,height].every(Number.isFinite) || width <= 4*thickness || height <= 4*thickness) return { thickness, rects:[] };
  let rects = [
    { x:x+inset,y:y+inset,width:width-2*inset,height:thickness },
    { x:x+inset,y:y+height-inset-thickness,width:width-2*inset,height:thickness },
    { x:x+inset,y:y+inset+thickness,width:thickness,height:height-2*(inset+thickness) },
    { x:x+width-inset-thickness,y:y+inset+thickness,width:thickness,height:height-2*(inset+thickness) }
  ];
  for (const cover of blockers) {
    if (![cover.x,cover.y,cover.width,cover.height].every(Number.isFinite)) continue;
    rects = rects.flatMap(r => subtract(r,cover));
    if (!rects.length) break;
  }
  return { thickness, rects:rects.map(r => ({ ...r,x:r.x-x,y:r.y-y })) };
}
