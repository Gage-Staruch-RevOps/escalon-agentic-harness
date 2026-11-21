// Shared tokenizer for the index builder and the router. Change both sides together by changing this file,
// then run `node build.mjs index`.
export const STOP = new Set(("a an and are as at be by for from how in into is it its of on or that the this to use used uses using when with you your will can any all not do does should what which who also more than other them they these those their then only like such via per about over under up out after before during just each every some most may must need needs want wants make makes made get gets " +
  "i me my we our us please pls lets let go going thing things stuff something really very new now here there it's im dont can't help work working done yes no ok okay hey hi thanks thank so but if else sometimes why way also maybe try again retry redo continue keep going ahead sure cool nice great perfect awesome fine next same still that's thats looks good got it yep yeah nope").split(/\s+/));

export function stem(w) {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 5 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s !== w && /([b-df-hj-km-np-tv-xz])\1$/.test(s) && !/(ll|ss|zz)$/.test(s)) s = s.slice(0, -1); // debugging -> debug
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}
export const words = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9.+-]*/g) || []).map((w) => w.replace(/[.+-]+$/, ''));
export const terms = (s) => words(s).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

// Generic words: they count, but at half weight and never earn the name bonus.
export const WEAK = new Set(['client','page','project','app','build','creat','file','data','tool','cod','websit','site','add','set','setup','writ','user','system','best','guid','run','manag','handl','support','servic','featur','updat','chang','improv','review','check','simpl','basic','general','modern','quick','better','good','great','full','complet','advanc','pro','expert','helper','assistant',
  // Add your project names here (stemmed, lowercase): they are context, not intent, and triggers.json routes them to their notes.
]);
