const questions=require('./seed_questions.json');
const activities=require('./seed_activities.json');
const allowed=new Set(['mcq','swipe','fill','error','match']);
const ids=new Set(); let errors=[];
const fail=m=>errors.push(m);
for(const q of questions){
  if(!Number.isInteger(q.id)||q.id<1) fail(`Invalid id: ${q.id}`);
  if(ids.has(q.id)) fail(`Duplicate question id ${q.id}`); ids.add(q.id);
  if(!allowed.has(q.type)) fail(`Q${q.id}: invalid type ${q.type}`);
  if(!String(q.prompt||'').trim()) fail(`Q${q.id}: empty prompt`);
  if(!String(q.topic||'').trim()) fail(`Q${q.id}: empty topic`);
  const p=q.payload||{};
  if(q.type==='mcq'){
    if(!Array.isArray(p.options)||p.options.length<2) fail(`Q${q.id}: MCQ options missing`);
    if(!Number.isInteger(p.correct)||p.correct<0||p.correct>=p.options.length) fail(`Q${q.id}: invalid correct MCQ index`);
  }
  if(q.type==='swipe'){
    if(typeof p.correct!=='boolean') fail(`Q${q.id}: swipe correct must be boolean`);
    if(p.correct===false&&!String(q.correction||'').trim()) fail(`Q${q.id}: false swipe missing correction`);
  }
  if(q.type==='fill'&&(!Array.isArray(p.answers)||!p.answers.length)) fail(`Q${q.id}: fill answers missing`);
  if(q.type==='error'){
    if(!Array.isArray(p.chunks)||p.chunks.length<2) fail(`Q${q.id}: error chunks missing`);
    if(!Number.isInteger(p.correct)||p.correct<0||p.correct>=p.chunks.length) fail(`Q${q.id}: invalid error index`);
    if(!String(q.correction||'').trim()) fail(`Q${q.id}: error question missing correction`);
  }
  if(q.type==='match'){
    if(!Array.isArray(p.pairs)||p.pairs.length<2) fail(`Q${q.id}: match pairs missing`);
    if((p.pairs||[]).some(Array.isArray)) fail(`Q${q.id}: nested match arrays are not Firestore-compatible`);
    const left=new Set((p.pairs||[]).map(x=>String(x.left).toLowerCase()));
    const right=new Set((p.pairs||[]).map(x=>String(x.right).toLowerCase()));
    if(left.size!==(p.pairs||[]).length||right.size!==(p.pairs||[]).length) fail(`Q${q.id}: duplicate match keys/values`);
  }
}
if(questions.length!==186) fail(`Expected 186 starter questions, found ${questions.length}`);
if(activities.length!==10) fail(`Expected 10 starter activities, found ${activities.length}`);
for(const a of activities){
  const candidates=questions.filter(q=>q.active!==false)
    .filter(q=>!a.topic_filter||q.topic===a.topic_filter)
    .filter(q=>!a.vocabulary_filter||q.vocabulary===a.vocabulary_filter)
    .filter(q=>!a.difficulty_filter||q.difficulty===a.difficulty_filter)
    .filter(q=>!a.game_type||a.game_type==='mixed'||q.type===a.game_type);
  if(candidates.length<Number(a.question_count||0)) fail(`Activity ${a.id} (${a.title}) requests ${a.question_count} questions but only ${candidates.length} match its filters`);
}
if(errors.length){ console.error('Seed validation FAILED'); errors.forEach(e=>console.error(' - '+e)); process.exit(1); }
console.log(`Seed validation OK: ${questions.length} questions, ${activities.length} activities.`);
