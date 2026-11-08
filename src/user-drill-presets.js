// User-provided practice reminders, not generated strategy or hand advice.
export const urgentDrills=[
 {position:'BB vs BTN',pot:'C-bet / barrel',street:'Flop / Turn',action:'Call pairs; raise less',detail:'Facing 50–75% c-bets/barrels: call pairs, not check-raise; fold only versus overbets.\nVersus BTN 33% c-bet: reduce check-raising from 24% to about 15%. Check-raise two pair or better; include strong draws versus 66–75% sizing.'},
 {position:'BTN vs blinds',pot:'3-bet pot',street:'Preflop',action:'Tighten calling range',detail:'Call 66+ and suited hands: Axs, K9s+, QTs+, JTs, T9s, 65s.\nOffsuit: AQo+ only.'},
 {position:'BTN / SB',pot:'After B/C',street:'Turn',action:'Bet selected hands',detail:'BTN turn after B/C: top pair, pairs, ace-high and draws use B50 or B100+, not 75%. No extra pure air.\nSB turn: bet two pair or better only; no extra bluffs.'},
 {position:'BB vs BTN / SB',pot:'After X/X',street:'Turn',action:'Bet pairs and draws',detail:'After X/X: versus BTN, bet pairs and draws for 75%.\nVersus SB, bet all pairs for 50–75%.'},
 {position:'Facing a river bet',pot:'Including BTN triple barrel',street:'River',action:'Call according to size',detail:'Bet ≤50%: call pairs. Bet 75%: call top pair or better. Overbet: fold weak hands.\nVersus BTN triple barrel: call wider on a scare card; fold when the board pairs; on blanks, continue with the best hands only.'},
 {position:'SB / BTN / CO',pot:'4-bet decisions',street:'Preflop',action:'Choose position-specific ranges',detail:'SB vs BB: 4-bet more (about 20%) with JJ/TT, AQs/KJs, A4s–A6s and suited connectors. No offsuit junk.\nBTN vs SB: value only (QQ+/AK/JJ); call a jam.\nCO vs BTN: replace KJo/KTo with ATs/A5s/QJs/TT–77.'},
 {position:'BB',pot:'After X/X → X/X',street:'River',action:'Bluff 75%; thin value 33–50%',detail:'After X/X on flop and X/X on turn: bluff for 75%; thin value-bet for 33–50%.'}
];
export function mergeUrgentDrills(current={}){
 const prior=Array.isArray(current.drills)?current.drills:(current.lines||[]).map(detail=>({detail}));
 const details=new Set(urgentDrills.map(d=>d.detail));
 const extras=prior.filter(d=>typeof d?.detail==='string'&&d.detail.trim()&&!details.has(d.detail));
 return [...urgentDrills.map(d=>({...d})),...extras.map(d=>({...d}))].slice(0,20);
}
