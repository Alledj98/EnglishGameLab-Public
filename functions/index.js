const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const crypto = require('crypto');
const EGLBulk = require('./bulk-content');

const seedQuestions = require('./seed_questions.json');
const seedActivities = require('./seed_activities.json');

initializeApp();
const db = getFirestore();
const auth = getAuth();
const audioBucket = () => getStorage().bucket(process.env.EGL_AUDIO_BUCKET || undefined);
const app = express();
app.use(express.json({ limit: '1mb' }));

const TEACHER_EMAIL = String(process.env.EGL_BOOTSTRAP_TEACHER_EMAIL || '').trim().toLowerCase();
const TEACHER_USERNAME = String(process.env.EGL_BOOTSTRAP_TEACHER_USERNAME || 'teacher').trim();
const REGION = 'europe-west1';
const WORD1 = ['blue','green','silver','orange','happy','swift','bright','cool','lucky','sunny','brave','clever','purple','golden','tiny','super'];
const WORD2 = ['tiger','panda','fox','lion','koala','otter','eagle','dolphin','rocket','comet','gecko','falcon','wolf','star','cloud','dragon'];

const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const nowIso = () => new Date().toISOString();
const clamp = (n,a,b) => Math.max(a,Math.min(b,Number(n)||0));
const docId = id => String(Number(id));
const technicalEmail = username => {
  const project = String(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'your-firebase-project').trim();
  const domain = String(process.env.EGL_STUDENT_AUTH_DOMAIN || `${project}.firebaseapp.com`).trim().toLowerCase();
  return `${String(username).trim().toLowerCase()}@${domain}`;
};
const rand = arr => arr[crypto.randomInt(0,arr.length)];
const friendlyPassword = () => `${rand(WORD1)}-${rand(WORD2)}-${crypto.randomInt(10,100)}`;
const unique = a => [...new Set(a)];
const avg = a => a.length ? Math.round((a.reduce((x,y)=>x+Number(y||0),0)/a.length)*10)/10 : 0;
const pairObjects = pairs => (pairs||[]).map(x => Array.isArray(x) ? ({left:x[0],right:x[1]}) : ({left:x?.left,right:x?.right})).filter(x => x.left!==undefined && x.right!==undefined);

async function nextId(key){
  const ref=db.collection('meta').doc('counters');
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref); const data=snap.exists?snap.data():{};
    const next=Number(data[key]||0)+1;
    tx.set(ref,{[key]:next},{merge:true});
    return next;
  });
}
async function reserveIds(key,count){
  const ref=db.collection('meta').doc('counters');
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref); const data=snap.exists?snap.data():{};
    const old=Number(data[key]||0), next=old+count;
    tx.set(ref,{[key]:next},{merge:true});
    return Array.from({length:count},(_,i)=>old+i+1);
  });
}
async function refsData(refs){
  if(!refs.length) return [];
  const snaps=await db.getAll(...refs);
  return snaps.filter(s=>s.exists).map(s=>s.data());
}
async function deleteRefs(refs){
  for(let i=0;i<refs.length;i+=400){
    const batch=db.batch(); refs.slice(i,i+400).forEach(r=>batch.delete(r)); await batch.commit();
  }
}

function publicQuestion(q,gameType=''){
  const p=q.payload||{}; let payload={};
  if(q.type==='mcq'||q.type==='listen_mcq') payload={options:p.options||[]};
  else if(q.type==='error') payload={chunks:p.chunks||[]};
  else if(q.type==='match'){const pairs=pairObjects(p.pairs);payload={left:pairs.map(x=>x.left),right:pairs.map(x=>x.right),pairs};}
  else if(q.type==='fill'&&gameType==='word_order'){
    const parts=String((p.answers||[])[0]||'').trim().split(/\s+/).filter(Boolean);
    const tiles=parts.map(word=>({word,random:crypto.randomInt(1000000)})).sort((a,b)=>a.random-b.random);
    // No completed sentence is sent: only word tiles in randomized order.
    if(tiles.length>1&&tiles.map(t=>t.word).join(' ')===parts.join(' ')){const first=tiles.shift();tiles.push(first);}
    payload={tiles:tiles.map(t=>t.word)};
  }
  return {id:q.id,type:q.type,prompt:q.prompt,payload,topic:q.topic,vocabulary:q.vocabulary||'',difficulty:q.difficulty||'easy',has_audio:Boolean(q.audio_path)};
}
function teacherQuestion(q){
  return {...publicQuestion(q),payload:q.payload||{},explanation:q.explanation||'',correction:q.correction||'',audio_script:q.audio_script||'',tags:q.tags||[],active:q.active!==false};
}
function correctAnswer(q,submitted){
  // A timed-out/unanswered question must NEVER become correct (Number(null) is zero).
  if(submitted===null||submitted===undefined)return false;
  const p=q.payload||{};
  if(q.type==='swipe'){
    if(submitted===null || submitted===undefined) return false;
    const val=typeof submitted==='boolean'?submitted:['true','1','yes','correct'].includes(String(submitted).toLowerCase());
    return val===Boolean(p.correct);
  }
  if(q.type==='mcq' || q.type==='listen_mcq' || q.type==='error') return Number(submitted)===Number(p.correct);
  if(q.type==='fill'||q.type==='spell'){
    const norm=v=>String(v??'').trim().toLowerCase().replace(/[’‘`]/g,"'").replace(/\s+/g,' ');
    return (p.answers||[]).some(a=>norm(a)===norm(submitted));
  }
  if(q.type==='match'){
    try{
      const norm=v=>String(v??'').trim().toLowerCase();
      const expected=new Map(pairObjects(p.pairs).map(x=>[norm(x.left),norm(x.right)]));
      const got=new Map((submitted||[]).map(([a,b])=>[norm(a),norm(b)]));
      if(expected.size!==got.size) return false;
      for(const [k,v] of expected) if(got.get(k)!==v) return false;
      return true;
    }catch{return false;}
  }
  return false;
}
function calculateStreak(attempts){
  const days=unique(attempts.filter(a=>a.completed).map(a=>String(a.started_at||'').slice(0,10))).sort().reverse();
  if(!days.length) return 0;
  const set=new Set(days), today=new Date();
  const fmt=d=>d.toISOString().slice(0,10);
  let cur=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));
  if(!set.has(fmt(cur))){cur.setUTCDate(cur.getUTCDate()-1);if(!set.has(fmt(cur)))return 0;}
  let st=0; while(set.has(fmt(cur))){st++;cur.setUTCDate(cur.getUTCDate()-1);} return st;
}
function badgesFor(xp,streak,total,perfects){
  const b=[];
  if(total>=1)b.push({icon:'🎮',name:'First Game'});
  if(xp>=500)b.push({icon:'⭐',name:'500 XP'});
  if(xp>=1000)b.push({icon:'🚀',name:'Level Up'});
  if(streak>=3)b.push({icon:'🔥',name:'3 Day Streak'});
  if(perfects>=1)b.push({icon:'💯',name:'Perfect Round'});
  if(total>=10)b.push({icon:'🏆',name:'10 Sessions'});
  return b;
}

async function seedStarterContent(){
  // Seed questions and activities independently. This makes first setup and
  // recovery robust if one collection is empty while the other already exists.
  const [qProbe,aProbe]=await Promise.all([
    db.collection('questions').limit(1).get(),
    db.collection('activities').limit(1).get()
  ]);
  if(!qProbe.empty && !aProbe.empty) return {questionsSeeded:0,activitiesSeeded:0};
  const batch=db.batch();
  const counters={};
  let questionsSeeded=0,activitiesSeeded=0;
  if(qProbe.empty){
    for(const raw of seedQuestions){
      const q={...raw,active:raw.active!==false,created_at:raw.created_at||nowIso(),updated_at:raw.updated_at||nowIso()};
      batch.set(db.collection('questions').doc(docId(q.id)),q); questionsSeeded++;
    }
    counters.questions=seedQuestions.length;
  }
  if(aProbe.empty){
    for(const raw of seedActivities){
      const a={...raw,published:raw.published!==false,scope_all:raw.scope_all!==false,class_ids:raw.class_ids||[],created_at:raw.created_at||nowIso(),updated_at:raw.updated_at||nowIso()};
      batch.set(db.collection('activities').doc(docId(a.id)),a); activitiesSeeded++;
    }
    counters.activities=seedActivities.length;
  }
  if(Object.keys(counters).length) batch.set(db.collection('meta').doc('counters'),counters,{merge:true});
  await batch.commit();
  return {questionsSeeded,activitiesSeeded};
}

async function decodedToken(req){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return null;
  try{return await auth.verifyIdToken(h.slice(7));}catch{return null;}
}
async function requireProfile(req,res,next){
  const token=await decodedToken(req);
  if(!token) return res.status(401).json({error:'Authentication required'});
  const snap=await db.collection('users').doc(token.uid).get();
  if(!snap.exists) return res.status(403).json({error:'Profilo non inizializzato. Il docente può completare il setup tramite /bootstrap.html'});
  const profile=snap.data();
  if(profile.active===false) return res.status(403).json({error:'Account disattivato'});
  req.egl={uid:token.uid,token,profile}; next();
}
function teacherOnly(req,res,next){if(req.egl?.profile?.role!=='teacher')return res.status(403).json({error:'Forbidden'});next();}
function studentOnly(req,res,next){if(req.egl?.profile?.role!=='student')return res.status(403).json({error:'Forbidden'});next();}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'English Game Lab Firebase',region:REGION}));

app.post('/api/bootstrap-teacher',wrap(async(req,res)=>{
  const token=await decodedToken(req);
  if(!token) return res.status(401).json({error:'Authentication required'});
  if(!TEACHER_EMAIL) return res.status(503).json({error:'Setup docente non configurato'});
  if(String(token.email||'').trim().toLowerCase()!==TEACHER_EMAIL) return res.status(403).json({error:'Setup non autorizzato'});
  const teachers=await db.collection('users').where('role','==','teacher').limit(1).get();
  if(!teachers.empty && teachers.docs[0].id!==token.uid) return res.status(409).json({error:'Il docente è già stato inizializzato.'});
  await db.collection('users').doc(token.uid).set({username:TEACHER_USERNAME,role:'teacher',active:true,must_change_password:false,created_at:nowIso()},{merge:true});
  await auth.setCustomUserClaims(token.uid,{role:'teacher'});
  await seedStarterContent();
  res.json({ok:true,questions:seedQuestions.length,activities:seedActivities.length});
}));

app.get('/api/me',wrap(async(req,res)=>{
  const token=await decodedToken(req);
  if(!token) return res.json({authenticated:false});
  const snap=await db.collection('users').doc(token.uid).get();
  if(!snap.exists) return res.json({authenticated:false});
  const u=snap.data();
  if(u.active===false) return res.json({authenticated:false});
  res.json({authenticated:true,user:{id:token.uid,username:u.username,role:u.role,must_change_password:Boolean(u.must_change_password)}});
}));

app.use('/api',wrap(requireProfile));

// Mark a student's initial credentials as no longer printable BEFORE Firebase Auth
// changes the password. A failed password update only causes a conservative
// loss of reprint ability, never disclosure of a private replacement password.
app.post('/api/password-change-intent',wrap(async(req,res)=>{
  if(req.egl.profile.role==='student'){
    const id=Number(req.egl.profile.student_id);
    await db.collection('students').doc(docId(id)).set({initial_credential_status:'changed'},{merge:true});
    await db.collection('credentialVault').doc(docId(id)).delete();
  }
  res.json({ok:true});
}));
app.post('/api/password-changed',wrap(async(req,res)=>{
  await db.collection('users').doc(req.egl.uid).set({must_change_password:false},{merge:true});
  res.json({ok:true});
}));

// ---------------- STUDENT ----------------
app.get('/api/student/dashboard',studentOnly,wrap(async(req,res)=>{
  const sid=Number(req.egl.profile.student_id);
  const sSnap=await db.collection('students').doc(docId(sid)).get();
  if(!sSnap.exists)return res.status(404).json({error:'Profilo studente non trovato'});
  const s=sSnap.data();
  const [classSnap,actsSnap,attemptsSnap,answersSnap]=await Promise.all([
    s.class_id?db.collection('classes').doc(docId(s.class_id)).get():Promise.resolve(null),
    db.collection('activities').where('published','==',true).get(),
    db.collection('attempts').where('student_id','==',sid).get(),
    db.collection('answers').where('student_id','==',sid).get()
  ]);
  const className=classSnap?.exists?classSnap.data().name:'';
  const attempts=attemptsSnap.docs.map(d=>d.data()).filter(a=>a.completed).sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at)));
  const activities=actsSnap.docs.map(d=>d.data()).filter(a=>a.scope_all || (a.class_ids||[]).includes(s.class_id)).sort((a,b)=>a.id-b.id);
  const out=activities.map(a=>{
    const aa=attempts.filter(x=>x.activity_id===a.id); const best=aa.length?Math.max(...aa.map(x=>Number(x.score||0))):null;
    const available=!(a.mode==='assignment' && Number(a.attempts_allowed)>0 && aa.length>=Number(a.attempts_allowed));
    return {...a,attempts:aa.length,best,last:aa[0]?.started_at||null,available};
  });
  const actMap=new Map(activities.map(a=>[a.id,a]));
  const recent=attempts.slice(0,8).map(a=>({id:a.id,score:a.score,started_at:a.started_at,finished_at:a.finished_at,title:actMap.get(a.activity_id)?.title||'Activity',icon:actMap.get(a.activity_id)?.icon||'🎯'}));
  const answers=answersSnap.docs.map(d=>d.data());
  const qids=unique(answers.map(a=>a.question_id));
  const qs=await refsData(qids.map(id=>db.collection('questions').doc(docId(id)))); const qmap=new Map(qs.map(q=>[q.id,q]));
  const topicAgg={};
  for(const an of answers){const q=qmap.get(an.question_id);if(!q)continue;const k=q.topic||'Other';topicAgg[k]??={topic:k,correct:0,answers:0};topicAgg[k].answers++;if(an.is_correct)topicAgg[k].correct++;}
  const topic_stats=Object.values(topicAgg).map(x=>({...x,score:Math.round((100*x.correct/x.answers)*10)/10})).sort((a,b)=>b.answers-a.answers);
  const streak=calculateStreak(attempts), xp=Number(s.xp||0), perfects=attempts.filter(a=>Number(a.score)===100).length;
  res.json({student:{id:s.id,code:s.code,xp:Number(s.xp||0),class_name:className},level:1+Math.floor(xp/1000),level_progress:xp%1000,streak,badges:badgesFor(xp,streak,attempts.length,perfects),activities:out,recent,topic_stats});
}));

app.post('/api/student/attempts/start',studentOnly,wrap(async(req,res)=>{
  const sid=Number(req.egl.profile.student_id), aid=Number(req.body.activity_id||0);
  const [sSnap,aSnap]=await Promise.all([db.collection('students').doc(docId(sid)).get(),db.collection('activities').doc(docId(aid)).get()]);
  if(!sSnap.exists||!aSnap.exists||aSnap.data().published===false)return res.status(404).json({error:'Attività non disponibile'});
  const s=sSnap.data(), a=aSnap.data();
  if(!(a.scope_all || (a.class_ids||[]).includes(s.class_id)))return res.status(403).json({error:'Attività non assegnata alla tua classe'});
  const prevSnap=await db.collection('attempts').where('student_id','==',sid).get();
  const prev=prevSnap.docs.map(d=>d.data());
  if(a.mode==='assignment' && Number(a.attempts_allowed)>0 && prev.filter(x=>x.activity_id===aid&&x.completed).length>=Number(a.attempts_allowed))return res.status(400).json({error:'Hai già utilizzato tutti i tentativi disponibili.'});
  const qSnap=await db.collection('questions').where('active','==',true).get();
  let candidates=qSnap.docs.map(d=>d.data()).filter(q=>
    (a.game_type==='mixed'||q.type===a.game_type||(a.game_type==='memory'&&q.type==='match')||(a.game_type==='quick_tap'&&q.type==='mcq')||(a.game_type==='word_order'&&q.type==='fill'&&String(q.payload?.answers?.[0]||'').trim().split(/\s+/).length>=3)) && (!['listen_mcq','spell'].includes(q.type)||Boolean(q.audio_path)) && (!a.topic_filter||q.topic===a.topic_filter) && (!a.vocabulary_filter||q.vocabulary===a.vocabulary_filter) && (!a.difficulty_filter||q.difficulty===a.difficulty_filter)
  );
  if(!candidates.length)return res.status(400).json({error:'Non ci sono domande compatibili con questa attività. Modifica i filtri dalla dashboard docente.'});
  const ansSnap=await db.collection('answers').where('student_id','==',sid).get();
  const ans=ansSnap.docs.map(d=>d.data()), seen=new Set(ans.map(x=>x.question_id)), wrong=new Set(ans.filter(x=>!x.is_correct).map(x=>x.question_id));
  candidates=candidates.map(q=>({q,p:wrong.has(q.id)?0:seen.has(q.id)?2:1,r:Math.random()})).sort((x,y)=>x.p-y.p||x.r-y.r).map(x=>x.q).slice(0,clamp(a.question_count,1,50));
  const attemptId=await nextId('attempts');
  const attempt={id:attemptId,student_id:sid,activity_id:aid,started_at:nowIso(),finished_at:null,score:0,correct_count:0,total_count:candidates.length,xp_awarded:0,completed:false,question_ids:candidates.map(q=>q.id)};
  await db.collection('attempts').doc(docId(attemptId)).set(attempt);
  res.json({attempt_id:attemptId,activity:a,questions:candidates.map(q=>publicQuestion(q,a.game_type))});
}));

app.post('/api/student/attempts/:attemptId/answer',studentOnly,wrap(async(req,res)=>{
  const attemptId=Number(req.params.attemptId), sid=Number(req.egl.profile.student_id), qid=Number(req.body.question_id||0);
  const atSnap=await db.collection('attempts').doc(docId(attemptId)).get();
  if(!atSnap.exists)return res.status(403).json({error:'Tentativo non valido'});
  const at=atSnap.data(); if(at.student_id!==sid||at.completed)return res.status(403).json({error:'Tentativo non valido'});
  if(!(at.question_ids||[]).includes(qid))return res.status(400).json({error:'Domanda non appartenente a questo tentativo'});
  const [qSnap,aSnap]=await Promise.all([db.collection('questions').doc(docId(qid)).get(),db.collection('activities').doc(docId(at.activity_id)).get()]);
  if(!qSnap.exists)return res.status(404).json({error:'Domanda non trovata'});
  const q=qSnap.data(), activity=aSnap.exists?aSnap.data():{mode:'practice'};
  const answerRef=db.collection('answers').doc(`${attemptId}_${qid}`);
  const existing=await answerRef.get();
  if(existing.exists){
    const previous=existing.data();const out={saved:true,already_answered:true};
    if(activity.mode==='practice')Object.assign(out,{correct:Boolean(previous.is_correct),explanation:q.explanation||'',correction:q.correction||''});
    return res.json(out);
  }
  const elapsed=clamp(req.body.elapsed_ms,0,600000);
  const limit=clamp(activity.memory_round_seconds||20,5,120)*1000;
  const timedOut=activity.game_type==='memory'&&(req.body.time_expired===true||elapsed>limit);
  const ok=!timedOut&&correctAnswer(q,req.body.answer);
  await answerRef.create({attempt_id:attemptId,student_id:sid,question_id:qid,answer:req.body.answer??null,is_correct:ok,timed_out:timedOut,elapsed_ms:elapsed,answered_at:nowIso()}).catch(e=>{if(e.code===6||e.code==='already-exists')return;throw e});
  const result=await answerRef.get(),correct=Boolean(result.data()?.is_correct);
  const out={saved:true,timed_out:timedOut}; if(activity.mode==='practice')Object.assign(out,{correct,explanation:q.explanation||'',correction:q.correction||''}); res.json(out);
}));

async function buildAttemptResult(at){
  const ansSnap=await db.collection('answers').where('attempt_id','==',at.id).get(); const answers=ansSnap.docs.map(d=>d.data()); const amap=new Map(answers.map(a=>[a.question_id,a]));
  const qs=await refsData((at.question_ids||[]).map(id=>db.collection('questions').doc(docId(id)))); const qmap=new Map(qs.map(q=>[q.id,q]));
  const topic={};
  for(const qid of at.question_ids||[]){const q=qmap.get(qid);if(!q)continue;const k=q.topic||'Other';topic[k]??={topic:k,total:0,correct:0};topic[k].total++;if(amap.get(qid)?.is_correct)topic[k].correct++;}
  const breakdown=Object.values(topic).map(x=>({...x,score:Math.round((100*x.correct/x.total)*10)/10})).sort((a,b)=>a.topic.localeCompare(b.topic));
  const review=answers.filter(a=>!a.is_correct).slice(0,8).map(a=>{const q=qmap.get(a.question_id)||{};return{prompt:q.prompt||'',correction:q.correction||'',explanation:q.explanation||''};});
  return {answers,breakdown,review};
}
app.post('/api/student/attempts/:attemptId/finish',studentOnly,wrap(async(req,res)=>{
  const attemptId=Number(req.params.attemptId),sid=Number(req.egl.profile.student_id),ref=db.collection('attempts').doc(docId(attemptId));
  let snap=await ref.get(); if(!snap.exists||snap.data().student_id!==sid)return res.status(403).json({error:'Tentativo non valido'});
  let at=snap.data(); const built=await buildAttemptResult(at);
  if(!at.completed){
    const correct=built.answers.filter(a=>a.is_correct).length,total=Number(at.total_count||0),score=total?Math.round((1000*correct/total))/10:0;
    const aSnap=await db.collection('activities').doc(docId(at.activity_id)).get(); const mode=aSnap.exists?aSnap.data().mode:'practice'; const memoryExpired=aSnap.exists&&aSnap.data().game_type==='memory'&&built.answers.some(a=>a.timed_out); const xp=memoryExpired?0:correct*(mode==='assignment'?30:20)+(score===100?100:0);
    await db.runTransaction(async tx=>{
      const fresh=await tx.get(ref); if(!fresh.exists||fresh.data().completed)return;
      tx.update(ref,{finished_at:nowIso(),score,correct_count:correct,xp_awarded:xp,completed:true});
      tx.update(db.collection('students').doc(docId(sid)),{xp:FieldValue.increment(xp)});
    });
    snap=await ref.get(); at=snap.data();
  }
  const result=await buildAttemptResult(at);
  res.json({completed:true,score:at.score,correct:at.correct_count,total:at.total_count,xp:at.xp_awarded,breakdown:result.breakdown,review:result.review,memory_timed_out:result.answers.some(a=>a.timed_out)});
}));

// ---------------- TEACHER ----------------
app.get('/api/teacher/dashboard',teacherOnly,wrap(async(req,res)=>{
  const [classesSnap,studentsSnap,questionsSnap,activitiesSnap,attemptsSnap,answersSnap]=await Promise.all([
    db.collection('classes').get(),db.collection('students').get(),db.collection('questions').where('active','==',true).get(),db.collection('activities').where('published','==',true).get(),db.collection('attempts').get(),db.collection('answers').get()
  ]);
  const classes=classesSnap.docs.map(d=>d.data()),students=studentsSnap.docs.map(d=>d.data()),questions=questionsSnap.docs.map(d=>d.data()),activities=activitiesSnap.docs.map(d=>d.data()),attempts=attemptsSnap.docs.map(d=>d.data()).filter(a=>a.completed);
  const smap=new Map(students.map(s=>[s.id,s])),cmap=new Map(classes.map(c=>[c.id,c])),amap=new Map(activities.map(a=>[a.id,a]));
  const recent=attempts.sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))).slice(0,10).map(at=>{const s=smap.get(at.student_id)||{},a=amap.get(at.activity_id)||{};return{code:s.code||'',real_name:s.real_name||'',class_name:cmap.get(s.class_id)?.name||'',title:a.title||'Activity',icon:a.icon||'🎯',score:at.score,started_at:at.started_at};});
  const qmap=new Map(questions.map(q=>[q.id,q])),topic={};
  for(const an of answersSnap.docs.map(d=>d.data())){const q=qmap.get(an.question_id);if(!q)continue;const k=q.topic;topic[k]??={topic:k,answers:0,correct:0};topic[k].answers++;if(an.is_correct)topic[k].correct++;}
  const topic_stats=Object.values(topic).map(x=>({...x,score:Math.round(1000*x.correct/x.answers)/10})).sort((a,b)=>b.answers-a.answers);
  const today=nowIso().slice(0,10),scores=attempts.map(a=>Number(a.score||0));
  res.json({counts:{classes:classes.length,students:students.length,questions:questions.length,activities:activities.length,played_today:attempts.filter(a=>String(a.started_at).startsWith(today)).length,average:avg(scores)},recent,topic_stats});
}));

app.get('/api/teacher/classes',teacherOnly,wrap(async(req,res)=>{
  const [cSnap,sSnap]=await Promise.all([db.collection('classes').get(),db.collection('students').get()]); const students=sSnap.docs.map(d=>d.data());
  const classes=cSnap.docs.map(d=>({...d.data(),students:students.filter(s=>s.class_id===d.data().id).length})).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  res.json({classes});
}));
app.post('/api/teacher/classes',teacherOnly,wrap(async(req,res)=>{
  const name=String(req.body.name||'').trim(),school_year=String(req.body.school_year||'').trim(); if(!name)return res.status(400).json({error:'Inserisci il nome della classe.'});
  const existing=await db.collection('classes').where('name','==',name).limit(1).get(); if(!existing.empty)return res.status(400).json({error:'Esiste già una classe con questo nome.'});
  const id=await nextId('classes'); await db.collection('classes').doc(docId(id)).set({id,name,school_year,created_at:nowIso()}); res.json({ok:true,id});
}));
app.delete('/api/teacher/classes/:id',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id),st=await db.collection('students').where('class_id','==',id).limit(1).get(); if(!st.empty)return res.status(400).json({error:'La classe contiene studenti. Spostali o cancellali prima.'});
  await db.collection('classes').doc(docId(id)).delete(); res.json({ok:true});
}));

app.get('/api/teacher/classes/:id/students',teacherOnly,wrap(async(req,res)=>{
  const cid=Number(req.params.id); const sSnap=await db.collection('students').where('class_id','==',cid).get(); const students=sSnap.docs.map(d=>d.data()).sort((a,b)=>String(a.code).localeCompare(String(b.code)));
  const uSnaps=await refsData(students.map(s=>db.collection('users').doc(s.user_id))); const umap=new Map(uSnaps.map(u=>[u.student_id,u]));
  const atSnap=await db.collection('attempts').get(); const attempts=atSnap.docs.map(d=>d.data());
  const out=students.map(s=>{const u=umap.get(s.id)||{};const ats=attempts.filter(a=>a.student_id===s.id).sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at)));return{...s,username:u.username||String(s.code||'').toLowerCase(),active:u.active!==false,last_activity:ats[0]?.started_at||null};});
  res.json({students:out});
}));

app.post('/api/teacher/classes/:id/generate-students',teacherOnly,wrap(async(req,res)=>{
  const cid=Number(req.params.id),countReq=clamp(req.body.count,1,30),cSnap=await db.collection('classes').doc(docId(cid)).get(); if(!cSnap.exists)return res.status(404).json({error:'Classe non trovata'});
  const cl=cSnap.data(),sSnap=await db.collection('students').where('class_id','==',cid).get(),existing=sSnap.docs.map(d=>d.data()); if(existing.length>=30)return res.status(400).json({error:'Questa classe ha già 30 account.'});
  const count=Math.min(countReq,30-existing.length);
  const names=Array.isArray(req.body.names)?req.body.names:[];
  if(names.length && names.length!==count)return res.status(400).json({error:'Il numero di nomi deve corrispondere agli account generati.'});
  if(names.some(n=>typeof n!=='string'||n.trim().length>120))return res.status(400).json({error:'Nome studente non valido (max 120 caratteri).'});
  let prefix=String(req.body.prefix||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8); if(!prefix)prefix=String(cl.name||'STU').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8)||'STU';
  const allStudents=(await db.collection('students').get()).docs.map(d=>d.data()),codes=new Set(allStudents.map(s=>String(s.code).toUpperCase())); const ids=await reserveIds('students',count),createdAuth=[],records=[],credentials=[]; let num=existing.length+1;
  try{
    for(let idx=0;idx<count;idx++){
      let code; do{code=`${prefix}-${String(num++).padStart(2,'0')}`;}while(codes.has(code)); codes.add(code); const username=code.toLowerCase(),password=friendlyPassword(),email=technicalEmail(username);
      const au=await auth.createUser({email,password,displayName:code,emailVerified:true,disabled:false}); createdAuth.push(au.uid); await auth.setCustomUserClaims(au.uid,{role:'student'});
      const sid=ids[idx]; records.push({uid:au.uid,sid,student:{id:sid,user_id:au.uid,class_id:cid,code,real_name:(names[idx]||'').trim(),xp:0,initial_credential_status:'issued',created_at:nowIso()},user:{username,role:'student',active:true,must_change_password:false,student_id:sid,created_at:nowIso()}}); credentials.push({id:sid,code,username,password,real_name:(names[idx]||'').trim()});
    }
    const batch=db.batch(); for(const r of records){batch.set(db.collection('students').doc(docId(r.sid)),r.student);batch.set(db.collection('users').doc(r.uid),r.user);} await batch.commit();
  }catch(e){await Promise.allSettled(createdAuth.map(uid=>auth.deleteUser(uid)));throw e;}
  res.json({ok:true,class_name:cl.name,credentials});
}));


// Encrypted teacher-only reprint vault: encryption and passphrase remain client-side.
// This stores only AES-GCM ciphertext, never the initial password or teacher key.
const validVault=v=>v&&v.alg==='AES-GCM-PBKDF2-v1'&&['salt','iv','cipher'].every(k=>typeof v[k]==='string'&&/^[A-Za-z0-9+/=]+$/.test(v[k])&&v[k].length>0&&v[k].length<400);
app.post('/api/teacher/credentials/vault',teacherOnly,wrap(async(req,res)=>{
  const items=req.body?.credentials;
  if(!Array.isArray(items)||!items.length||items.length>30||items.some(x=>!Number.isSafeInteger(x.student_id)||x.student_id<1||!validVault(x.vault)))return res.status(400).json({error:'Archivio cifrato non valido.'});
  if(new Set(items.map(x=>x.student_id)).size!==items.length)return res.status(400).json({error:'Studenti duplicati.'});
  const refs=items.map(x=>db.collection('students').doc(docId(x.student_id))),snaps=await db.getAll(...refs);
  if(snaps.some(s=>!s.exists||s.data().initial_credential_status!=='issued'))return res.status(409).json({error:'Credenziali iniziali non più archiviabili.'});
  const batch=db.batch();
  items.forEach(x=>batch.create(db.collection('credentialVault').doc(docId(x.student_id)),{...x.vault,created_at:nowIso()}));
  await batch.commit();res.json({ok:true,count:items.length});
}));
app.get('/api/teacher/classes/:id/credentials/vault',teacherOnly,wrap(async(req,res)=>{
  const cid=Number(req.params.id),snap=await db.collection('students').where('class_id','==',cid).get();
  const students=snap.docs.map(d=>d.data());const eligible=students.filter(s=>s.initial_credential_status==='issued');
  // vault metadata is private and includes only opaque ciphertext; student info is for teacher UI
  const docs=eligible.length?await db.getAll(...eligible.map(s=>db.collection('credentialVault').doc(docId(s.id)))):[];
  const vmap=new Map(docs.filter(x=>x.exists).map(x=>[Number(x.id),x.data()]));
  res.set('Cache-Control','private, no-store').json({items:students.map(s=>({student_id:s.id,code:s.code,real_name:s.real_name||'',vault:s.initial_credential_status==='issued'?(vmap.get(s.id)||null):null}))});
}));

app.put('/api/teacher/students/:id',teacherOnly,wrap(async(req,res)=>{
  const sid=Number(req.params.id),ref=db.collection('students').doc(docId(sid)),snap=await ref.get(); if(!snap.exists)return res.status(404).json({error:'Studente non trovato'}); const s=snap.data(); const active=req.body.active!==false;
  await Promise.all([ref.set({real_name:String(req.body.real_name||'').trim()},{merge:true}),db.collection('users').doc(s.user_id).set({active},{merge:true}),auth.updateUser(s.user_id,{disabled:!active})]); res.json({ok:true});
}));
app.post('/api/teacher/students/:id/reset-password',teacherOnly,wrap(async(req,res)=>{
  const sid=Number(req.params.id),snap=await db.collection('students').doc(docId(sid)).get(); if(!snap.exists)return res.status(404).json({error:'Studente non trovato'}); const s=snap.data(),password=friendlyPassword();
  await Promise.all([db.collection('students').doc(docId(sid)).set({initial_credential_status:'reset'},{merge:true}),db.collection('credentialVault').doc(docId(sid)).delete()]);
  await Promise.all([auth.updateUser(s.user_id,{password,disabled:false}),db.collection('users').doc(s.user_id).set({active:true},{merge:true})]); res.json({ok:true,password});
}));
app.delete('/api/teacher/students/:id',teacherOnly,wrap(async(req,res)=>{
  const sid=Number(req.params.id),sRef=db.collection('students').doc(docId(sid)),snap=await sRef.get(); if(!snap.exists)return res.json({ok:true}); const s=snap.data();
  await auth.updateUser(s.user_id,{disabled:true}).catch(()=>{});
  const [atSnap,anSnap]=await Promise.all([db.collection('attempts').where('student_id','==',sid).get(),db.collection('answers').where('student_id','==',sid).get()]);
  await deleteRefs([...atSnap.docs.map(d=>d.ref),...anSnap.docs.map(d=>d.ref),sRef,db.collection('credentialVault').doc(docId(sid)),db.collection('users').doc(s.user_id)]); await auth.deleteUser(s.user_id).catch(()=>{}); res.json({ok:true});
}));

app.get('/api/teacher/questions',teacherOnly,wrap(async(req,res)=>{
  const snap=await db.collection('questions').get(); let all=snap.docs.map(d=>d.data()).sort((a,b)=>b.id-a.id); const active=all.filter(q=>q.active!==false);
  const q=String(req.query.q||'').toLowerCase(),topic=String(req.query.topic||''),type=String(req.query.type||''),vocab=String(req.query.vocabulary||''),status=String(req.query.status||'');
  let rows=all; if(status==='active')rows=rows.filter(x=>x.active!==false);if(status==='inactive')rows=rows.filter(x=>x.active===false); if(topic)rows=rows.filter(x=>x.topic===topic);if(type)rows=rows.filter(x=>x.type===type);if(vocab)rows=rows.filter(x=>x.vocabulary===vocab);if(q)rows=rows.filter(x=>String(x.prompt).toLowerCase().includes(q)||String(x.explanation||'').toLowerCase().includes(q)); rows=rows.slice(0,500);
  res.json({questions:rows.map(teacherQuestion),meta:{total:active.length,inactive:all.length-active.length,all:all.length,topics:unique(all.map(x=>x.topic)).sort(),vocabularies:unique(all.map(x=>x.vocabulary).filter(Boolean)).sort()}});
}));
async function saveQuestion(id,data){
  const type=String(data.type||''),prompt=String(data.prompt||'').trim(),topic=String(data.topic||'').trim(); let difficulty=String(data.difficulty||'easy'); if(!['swipe','mcq','fill','error','match','listen_mcq','spell'].includes(type)||!prompt||!topic)throw Object.assign(new Error('Tipo, domanda e argomento sono obbligatori.'),{status:400}); if(!['easy','medium','hard'].includes(difficulty))difficulty='easy';
  const ref=id?db.collection('questions').doc(docId(id)):db.collection('questions').doc(docId(await nextId('questions'))); const old=await ref.get(); if(id&&!old.exists)throw Object.assign(new Error('Domanda non trovata'),{status:404}); const qid=id||Number(ref.id),t=nowIso();
  const payload={...(data.payload||{})}; if(type==='match') payload.pairs=pairObjects(payload.pairs);
  await ref.set({...(old.exists?Object.fromEntries(['demo_pack','demo_index','import_batch'].filter(k=>old.data()[k]!==undefined).map(k=>[k,old.data()[k]])):{}),id:qid,type,prompt,payload,explanation:String(data.explanation||'').trim(),correction:String(data.correction||'').trim(),audio_script:String(data.audio_script||'').trim().slice(0,500),topic,vocabulary:String(data.vocabulary||'').trim(),difficulty,tags:Array.isArray(data.tags)?data.tags:[],audio_path:old.exists?(old.data().audio_path||null):null,audio_mime:old.exists?(old.data().audio_mime||null):null,active:old.exists?old.data().active!==false:!['listen_mcq','spell'].includes(type),created_at:old.exists?old.data().created_at:t,updated_at:t}); return qid;
}
app.post('/api/teacher/questions',teacherOnly,wrap(async(req,res)=>res.json({ok:true,id:await saveQuestion(null,req.body)})));
app.put('/api/teacher/questions/:id',teacherOnly,wrap(async(req,res)=>res.json({ok:true,id:await saveQuestion(Number(req.params.id),req.body)})));
app.post('/api/teacher/questions/:id/duplicate',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id),snap=await db.collection('questions').doc(docId(id)).get(); if(!snap.exists)return res.status(404).json({error:'Domanda non trovata'}); const q=snap.data(),nid=await nextId('questions'),t=nowIso(); await db.collection('questions').doc(docId(nid)).set({...q,id:nid,prompt:`${q.prompt} (copia)`,active:false,audio_path:null,audio_mime:null,created_at:t,updated_at:t});res.json({ok:true,id:nid});
}));
app.delete('/api/teacher/questions/:id',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id),ref=db.collection('questions').doc(docId(id)),used=await db.collection('answers').where('question_id','==',id).limit(1).get(); if(used.empty)await ref.delete();else await ref.set({active:false,updated_at:nowIso()},{merge:true});res.json({ok:true});
}));

// Bulk content import: teacher-only, server validates all fields and only creates
// inactive questions/unpublished activities. No student can see new material
// until the teacher explicitly activates the questions / publishes activities.
app.post('/api/teacher/import-content',teacherOnly,wrap(async(req,res)=>{
  const content=EGLBulk.normalize(req.body);
  if(content.errors.length)return res.status(400).json({error:'Il file contiene errori.',details:content.errors.slice(0,30)});
  if(!content.questions.length&&!content.activities.length)return res.status(400).json({error:'Nessun contenuto valido da importare.'});
  const [qSnap,aSnap]=await Promise.all([db.collection('questions').get(),db.collection('activities').get()]);
  const existingKeys=new Set(qSnap.docs.map(d=>EGLBulk.fingerprint(d.data())));
  const existingTitles=new Set(aSnap.docs.map(d=>String(d.data().title||'').trim().toLowerCase()));
  const addedQ=content.questions.filter(q=>!existingKeys.has(EGLBulk.fingerprint(q)));
  const addedA=content.activities.filter(a=>!existingTitles.has(a.title.trim().toLowerCase()));
  const skipped=content.questions.length-addedQ.length,skippedActivities=content.activities.length-addedA.length;
  if(addedQ.length+addedA.length===0)return res.json({ok:true,questions_added:0,activities_added:0,skipped,skipped_activities:skippedActivities,question_ids:[]});
  const meta=db.collection('meta').doc('counters');
  const starts=await db.runTransaction(async tx=>{
    const snap=await tx.get(meta),data=snap.exists?snap.data():{};
    const qOld=Number(data.questions||0),aOld=Number(data.activities||0);
    tx.set(meta,{questions:qOld+addedQ.length,activities:aOld+addedA.length},{merge:true});
    return {qOld,aOld};
  });
  const batch=db.batch(),t=nowIso(),question_ids=[];
  const importId=crypto.randomUUID();
  addedQ.forEach((q,i)=>{
    const id=starts.qOld+i+1;question_ids.push(id);
    batch.create(db.collection('questions').doc(docId(id)),{...q,id,active:false,import_batch:importId,created_at:t,updated_at:t});
  });
  addedA.forEach((a,i)=>{
    const id=starts.aOld+i+1;
    batch.create(db.collection('activities').doc(docId(id)),{...a,id,published:false,scope_all:false,class_ids:[],created_at:t,updated_at:t,import_batch:importId});
  });
  await batch.commit();
  res.json({ok:true,questions_added:addedQ.length,activities_added:addedA.length,skipped,skipped_activities:skippedActivities,question_ids});
}));
app.post('/api/teacher/questions/activate-import',teacherOnly,wrap(async(req,res)=>{
  const ids=req.body?.ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>120||ids.some(x=>!Number.isInteger(x)||x<1)||new Set(ids).size!==ids.length)
    return res.status(400).json({error:'Specificare fino a 120 ID validi e unici.'});
  const refs=ids.map(id=>db.collection('questions').doc(docId(id)));
  const snaps=await db.getAll(...refs);
  if(snaps.some(s=>!s.exists||s.data().active!==false||!s.data().import_batch||(['listen_mcq','spell'].includes(s.data().type)&&!s.data().audio_path)))return res.status(400).json({error:'Almeno una domanda non è una bozza importata o è già attiva.'});
  const batch=db.batch();for(const ref of refs)batch.update(ref,{active:true,updated_at:nowIso()});await batch.commit();
  res.json({ok:true,activated:refs.length});
}));
app.post('/api/teacher/questions/:id/activate',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'ID non valido.'});
  const ref=db.collection('questions').doc(docId(id)),snap=await ref.get();
  if(!snap.exists)return res.status(404).json({error:'Domanda non trovata.'});
  if(['listen_mcq','spell'].includes(snap.data().type)&&!snap.data().audio_path)return res.status(400).json({error:'Registra prima un audio per questa domanda.'});
  await ref.update({active:true,updated_at:nowIso()});res.json({ok:true});
}));


// V8: teacher-only batch activation/deactivation, never deletes a question or its history.
app.post('/api/teacher/questions/batch-status',teacherOnly,wrap(async(req,res)=>{
  const ids=req.body?.ids,active=req.body?.active;
  if(typeof active!=='boolean'||!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)return res.status(400).json({error:'Seleziona fino a 100 domande uniche e uno stato valido.'});
  const refs=ids.map(id=>db.collection('questions').doc(docId(id))),snaps=await db.getAll(...refs);
  if(snaps.some(d=>!d.exists))return res.status(404).json({error:'Una o più domande non esistono più. Ricarica la pagina.'});
  if(active&&snaps.some(d=>['listen_mcq','spell'].includes(d.data().type)&&!d.data().audio_path))return res.status(400).json({error:'Registra prima gli audio di tutte le domande selezionate.'});
  const batch=db.batch(),t=nowIso();refs.forEach(ref=>batch.update(ref,{active,updated_at:t}));await batch.commit();res.json({ok:true,updated:ids.length});
}));
app.put('/api/teacher/questions/:id/audio-script',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id),value=String(req.body?.audio_script||'').trim();
  if(!Number.isSafeInteger(id)||id<1||value.length>500)return res.status(400).json({error:'Testo audio non valido (max 500 caratteri).'});
  const ref=db.collection('questions').doc(docId(id)),snap=await ref.get();
  if(!snap.exists||!['listen_mcq','spell'].includes(snap.data().type))return res.status(404).json({error:'Domanda audio non trovata.'});
  await ref.update({audio_script:value,updated_at:nowIso()});res.json({ok:true});
}));

// Protected small audio clips: teacher records/uploads, students can only play
// clips attached to questions in their own active attempts. No public URLs.
const AUDIO_TYPES=new Set(['audio/webm','audio/mp4','audio/ogg','audio/mpeg']);
async function sendQuestionAudio(req,res,q){
  if(!q.audio_path)return res.status(404).json({error:'Registrazione non disponibile'});
  const [bytes]=await audioBucket().file(q.audio_path).download();
  res.set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff').type(q.audio_mime||'audio/webm');
  res.send(bytes);
}
app.get('/api/teacher/questions/:id/audio',teacherOnly,wrap(async(req,res)=>{
  const snap=await db.collection('questions').doc(docId(req.params.id)).get();
  if(!snap.exists)return res.status(404).json({error:'Domanda non trovata'});
  await sendQuestionAudio(req,res,snap.data());
}));
app.get('/api/student/attempts/:attemptId/questions/:questionId/audio',studentOnly,wrap(async(req,res)=>{
  const sid=Number(req.egl.profile.student_id),aid=Number(req.params.attemptId),qid=Number(req.params.questionId);
  const at=await db.collection('attempts').doc(docId(aid)).get();
  if(!at.exists||at.data().student_id!==sid||!(at.data().question_ids||[]).includes(qid))return res.status(403).json({error:'Audio non autorizzato'});
  const snap=await db.collection('questions').doc(docId(qid)).get();
  if(!snap.exists||snap.data().active===false)return res.status(404).json({error:'Domanda non disponibile'});
  await sendQuestionAudio(req,res,snap.data());
}));
app.put('/api/teacher/questions/:id/audio',teacherOnly,express.raw({type:()=>true,limit:'320kb'}),wrap(async(req,res)=>{
  const id=Number(req.params.id),mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  const bytes=Buffer.isBuffer(req.rawBody)?req.rawBody:req.body;
  if(!Number.isSafeInteger(id)||id<1||!AUDIO_TYPES.has(mime)||!Buffer.isBuffer(bytes)||bytes.length<100||bytes.length>300000)
    return res.status(400).json({error:'Audio non valido (formati webm/mp4/ogg/mp3, massimo 300 KB).'});
  const ref=db.collection('questions').doc(docId(id)),snap=await ref.get();
  if(!snap.exists||!['listen_mcq','spell'].includes(snap.data().type))return res.status(400).json({error:'La domanda non è un gioco audio.'});
  const path='teacher-audio/'+id+'/'+crypto.randomUUID();
  await audioBucket().file(path).save(bytes,{resumable:false,metadata:{contentType:mime,cacheControl:'private,no-store'}});
  const old=snap.data().audio_path;
  try{await ref.update({audio_path:path,audio_mime:mime,updated_at:nowIso()});}
  catch(e){await audioBucket().file(path).delete({ignoreNotFound:true}).catch(()=>{});throw e;}
  if(old)await audioBucket().file(old).delete({ignoreNotFound:true}).catch(err=>console.warn('Old audio cleanup pending',err.message));
  res.json({ok:true,bytes:bytes.length});
}));

app.get('/api/teacher/activities',teacherOnly,wrap(async(req,res)=>{
  const [aSnap,cSnap]=await Promise.all([db.collection('activities').get(),db.collection('classes').get()]);res.json({activities:aSnap.docs.map(d=>d.data()).sort((a,b)=>a.id-b.id),classes:cSnap.docs.map(d=>d.data()).sort((a,b)=>String(a.name).localeCompare(String(b.name)))});
}));
async function saveActivity(id,data){
  const title=String(data.title||'').trim(); if(!title)throw Object.assign(new Error('Inserisci un titolo.'),{status:400}); const mode=['practice','assignment'].includes(data.mode)?data.mode:'practice',game_type=['swipe','mcq','fill','error','match','listen_mcq','spell','memory','mixed','quick_tap','word_order'].includes(data.game_type)?data.game_type:'mixed';
  const ref=id?db.collection('activities').doc(docId(id)):db.collection('activities').doc(docId(await nextId('activities'))); const old=await ref.get(); const aid=id||Number(ref.id),t=nowIso();
  const activity={id:aid,title,subtitle:String(data.subtitle||'').trim(),icon:String(data.icon||'🎯').trim().slice(0,8)||'🎯',mode,game_type,topic_filter:String(data.topic_filter||'').trim(),vocabulary_filter:String(data.vocabulary_filter||'').trim(),difficulty_filter:String(data.difficulty_filter||'').trim(),question_count:clamp(data.question_count,1,50),time_limit:clamp(data.time_limit,0,120),memory_round_seconds:clamp(data.memory_round_seconds||20,5,120),time_attack:mode==='practice'&&data.time_attack===true&&game_type!=='memory',published:data.published!==false,scope_all:data.scope_all!==false,attempts_allowed:clamp(data.attempts_allowed,0,20),class_ids:data.scope_all!==false?[]:(Array.isArray(data.class_ids)?data.class_ids.map(Number):[]),created_at:old.exists?old.data().created_at:t,updated_at:t,...(old.exists?Object.fromEntries(['demo_pack','demo_index','import_batch'].filter(k=>old.data()[k]!==undefined).map(k=>[k,old.data()[k]])):{} )}; await ref.set(activity);return aid;
}
app.post('/api/teacher/activities',teacherOnly,wrap(async(req,res)=>res.json({ok:true,id:await saveActivity(null,req.body)})));
app.put('/api/teacher/activities/:id',teacherOnly,wrap(async(req,res)=>res.json({ok:true,id:await saveActivity(Number(req.params.id),req.body)})));
app.post('/api/teacher/activities/:id/duplicate',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id),snap=await db.collection('activities').doc(docId(id)).get();if(!snap.exists)return res.status(404).json({error:'Attività non trovata'});const a=snap.data(),nid=await nextId('activities'),t=nowIso();await db.collection('activities').doc(docId(nid)).set({...a,id:nid,title:`${a.title} • Copy`,published:false,created_at:t,updated_at:t});res.json({ok:true,id:nid});
}));
app.delete('/api/teacher/activities/:id',teacherOnly,wrap(async(req,res)=>{
  const id=Number(req.params.id),ref=db.collection('activities').doc(docId(id)),used=await db.collection('attempts').where('activity_id','==',id).limit(1).get();if(used.empty)await ref.delete();else await ref.set({published:false,updated_at:nowIso()},{merge:true});res.json({ok:true});
}));

// V8 demonstration library. Explicit teacher action; all content is created as drafts
// and never published to existing classes. Re-running is idempotent via demo_key.
const DEMO_TOPIC='Demo V8 - Inglese in gioco';
const demoQuestions=[
  {type:'swipe',prompt:'She goes to school every day.',payload:{correct:true},explanation:'Present Simple alla terza persona: goes.'},
  {type:'swipe',prompt:'He play football on Mondays.',payload:{correct:false},explanation:'Terza persona singolare: plays.',correction:'He plays football on Mondays.'},
  {type:'swipe',prompt:'They are playing tennis now.',payload:{correct:true}},
  {type:'swipe',prompt:'I am go to the cinema.',payload:{correct:false},correction:'I am going to the cinema.'},
  {type:'swipe',prompt:'We were at home yesterday.',payload:{correct:true}},
  {type:'swipe',prompt:'She has two brothers.',payload:{correct:true}},
  {type:'swipe',prompt:'We goes to school by bus.',payload:{correct:false},correction:'We go to school by bus.'},
  {type:'swipe',prompt:'There are three apples.',payload:{correct:true}},
  {type:'swipe',prompt:'He didn’t went to school.',payload:{correct:false},correction:'He didn’t go to school.'},
  {type:'swipe',prompt:'My cat is sleeping on the sofa.',payload:{correct:true}},
  {type:'mcq',prompt:'Choose the correct sentence.',payload:{options:['I am reading now.','I reads now.','I reading now.'],correct:0},explanation:'Present Continuous: am/is/are + -ing.'},
  {type:'mcq',prompt:'What is the past of go?',payload:{options:['goed','went','gone'],correct:1},explanation:'Past Simple di go: went.'},
  {type:'fill',prompt:'Complete: Yesterday we ___ to the park.',payload:{answers:['went']},explanation:'Past Simple of go.'},
  {type:'fill',prompt:'Put the words in order to make a sentence.',payload:{answers:['She is playing tennis now.']},explanation:'Present Continuous: subject + be + -ing.'},
  {type:'fill',prompt:'Put the words in order to make a sentence.',payload:{answers:['They go to school by bus.']},explanation:'Present Simple, plural subject.'},
  {type:'fill',prompt:'Put the words in order to make a sentence.',payload:{answers:['I have got a new bike.']},explanation:'Have got.'},
  {type:'fill',prompt:'Put the words in order to make a sentence.',payload:{answers:['We are watching a film tonight.']},explanation:'Present Continuous.'},
  {type:'match',prompt:'Match the animal with its Italian translation.',payload:{pairs:[{left:'cat',right:'gatto'},{left:'dog',right:'cane'},{left:'bird',right:'uccello'}]},explanation:'Animals vocabulary.'},
  {type:'match',prompt:'Match the verb with its past form.',payload:{pairs:[{left:'go',right:'went'},{left:'eat',right:'ate'},{left:'see',right:'saw'}]},explanation:'Irregular verbs.'},
  {type:'listen_mcq',prompt:'Listen and choose the sentence you hear.',audio_script:'She is reading a book.',payload:{options:['She is reading a book.','She is writing a book.','She reads books every day.'],correct:0}},
  {type:'spell',prompt:'Listen and write the word.',audio_script:'Elephant',payload:{answers:['elephant']}},
];
const demoActivities=[
  {title:'DEMO V8 - Memory animali',subtitle:'Abbina le coppie in 20 secondi',icon:'🧠',game_type:'memory',question_count:1,memory_round_seconds:20},
  {title:'DEMO V8 - Swipe Time Attack',subtitle:'Vero o falso senza fermarti',icon:'⚡',game_type:'swipe',question_count:10,time_attack:true,time_limit:60},
  {title:'DEMO V8 - Quick Tap',subtitle:'Tocca la risposta giusta al volo',icon:'👆',game_type:'quick_tap',question_count:10,time_attack:true,time_limit:60},
  {title:'DEMO V8 - Word Order',subtitle:'Riordina le parole in inglese',icon:'🧩',game_type:'word_order',question_count:10},
  {title:'DEMO V8 - Abbinamenti',subtitle:'Le stesse coppie del Memory',icon:'🔗',game_type:'match',question_count:10},
  {title:'DEMO V8 - Listening',subtitle:'Registra la voce prima di attivare',icon:'🎧',game_type:'listen_mcq',question_count:10},
  {title:'DEMO V8 - Spelling',subtitle:'Dettato con voce della prof',icon:'✍️',game_type:'spell',question_count:10},
];
app.post('/api/teacher/demo-v8/install',teacherOnly,wrap(async(req,res)=>{
  const [qs,as]=await Promise.all([db.collection('questions').where('demo_pack','==','v8').get(),db.collection('activities').where('demo_pack','==','v8').get()]);
  const qkeys=new Set(qs.docs.map(d=>d.data().demo_index)),akeys=new Set(as.docs.map(d=>d.data().demo_index));
  const toQ=demoQuestions.map((d,i)=>({d,i})).filter(x=>!qkeys.has(x.i)),toA=demoActivities.map((d,i)=>({d,i})).filter(x=>!akeys.has(x.i));
  if(!toQ.length&&!toA.length)return res.json({ok:true,questions_added:0,activities_added:0,already_present:true});
  const ids=await db.runTransaction(async tx=>{const ref=db.collection('meta').doc('counters'),snap=await tx.get(ref),data=snap.exists?snap.data():{};const oldQ=Number(data.questions||0),oldA=Number(data.activities||0);tx.set(ref,{questions:oldQ+toQ.length,activities:oldA+toA.length},{merge:true});return{q:oldQ,a:oldA}});
  const batch=db.batch(),t=nowIso();
  toQ.forEach(({d,i},n)=>{const id=ids.q+n+1;batch.create(db.collection('questions').doc(docId(id)),{id,type:d.type,prompt:d.prompt,topic:DEMO_TOPIC,difficulty:'easy',vocabulary:'',tags:['demo-v8'],explanation:d.explanation||'',correction:d.correction||'',audio_script:d.audio_script||'',payload:d.payload,active:false,audio_path:null,audio_mime:null,demo_pack:'v8',demo_index:i,created_at:t,updated_at:t})});
  toA.forEach(({d,i},n)=>{const id=ids.a+n+1;batch.create(db.collection('activities').doc(docId(id)),{id,title:d.title,subtitle:d.subtitle,icon:d.icon,mode:'practice',game_type:d.game_type,topic_filter:DEMO_TOPIC,vocabulary_filter:'',difficulty_filter:'',question_count:d.question_count,time_limit:d.time_limit||0,memory_round_seconds:d.memory_round_seconds||20,time_attack:Boolean(d.time_attack),published:false,scope_all:false,class_ids:[],attempts_allowed:0,demo_pack:'v8',demo_index:i,created_at:t,updated_at:t})});
  await batch.commit();res.json({ok:true,questions_added:toQ.length,activities_added:toA.length});
}));

app.get('/api/teacher/results',teacherOnly,wrap(async(req,res)=>{
  const cid=Number(req.query.class_id||0),[sSnap,cSnap,aSnap]=await Promise.all([db.collection('students').get(),db.collection('classes').get(),db.collection('attempts').get()]); const classes=cSnap.docs.map(d=>d.data()).sort((a,b)=>String(a.name).localeCompare(String(b.name))),cmap=new Map(classes.map(c=>[c.id,c])); let students=sSnap.docs.map(d=>d.data()).filter(s=>!cid||s.class_id===cid); const attempts=aSnap.docs.map(d=>d.data()).filter(a=>a.completed);
  const rows=students.map(s=>{const aa=attempts.filter(a=>a.student_id===s.id),scores=aa.map(a=>Number(a.score||0));aa.sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at)));return{id:s.id,code:s.code,real_name:s.real_name||'',class_name:cmap.get(s.class_id)?.name||'',xp:Number(s.xp||0),sessions:aa.length,avg_score:aa.length?avg(scores):null,last_activity:aa[0]?.started_at||null};}).sort((a,b)=>String(a.class_name).localeCompare(String(b.class_name))||String(a.code).localeCompare(String(b.code)));res.json({students:rows,classes});
}));
app.get('/api/teacher/students/:id/results',teacherOnly,wrap(async(req,res)=>{
  const sid=Number(req.params.id),sSnap=await db.collection('students').doc(docId(sid)).get();if(!sSnap.exists)return res.status(404).json({error:'Studente non trovato'});const s=sSnap.data();
  const [uSnap,cSnap,atSnap,anSnap,activitiesSnap]=await Promise.all([db.collection('users').doc(s.user_id).get(),s.class_id?db.collection('classes').doc(docId(s.class_id)).get():Promise.resolve(null),db.collection('attempts').where('student_id','==',sid).get(),db.collection('answers').where('student_id','==',sid).get(),db.collection('activities').get()]);
  const activities=new Map(activitiesSnap.docs.map(d=>[d.data().id,d.data()])); const attempts=atSnap.docs.map(d=>d.data()).filter(a=>a.completed).sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))).slice(0,50).map(a=>({...a,title:activities.get(a.activity_id)?.title||'Activity',icon:activities.get(a.activity_id)?.icon||'🎯',mode:activities.get(a.activity_id)?.mode||'practice'}));
  const answers=anSnap.docs.map(d=>d.data()),qids=unique(answers.map(a=>a.question_id)),qs=await refsData(qids.map(id=>db.collection('questions').doc(docId(id)))),qmap=new Map(qs.map(q=>[q.id,q]));const topics={},errs={};
  for(const an of answers){const q=qmap.get(an.question_id);if(!q)continue;const k=q.topic;topics[k]??={topic:k,answers:0,correct:0};topics[k].answers++;if(an.is_correct)topics[k].correct++;else{errs[q.id]??={prompt:q.prompt,topic:q.topic,explanation:q.explanation||'',times:0};errs[q.id].times++;}}
  res.json({student:{...s,username:uSnap.exists?uSnap.data().username:String(s.code).toLowerCase(),active:uSnap.exists?uSnap.data().active!==false:true,class_name:cSnap?.exists?cSnap.data().name:''},attempts,topics:Object.values(topics).map(x=>({...x,score:Math.round(1000*x.correct/x.answers)/10})).sort((a,b)=>b.answers-a.answers),errors:Object.values(errs).sort((a,b)=>b.times-a.times).slice(0,10),streak:calculateStreak(atSnap.docs.map(d=>d.data()))});
}));

app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Server error',detail:err.status?undefined:err.message});});

exports.api = onRequest({region:REGION,memory:'512MiB',timeoutSeconds:60,maxInstances:10},app);
