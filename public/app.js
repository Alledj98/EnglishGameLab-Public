const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
const state = { me:null, teacherTab:'dashboard', teacherData:{}, game:null, currentClass:null, resultsClass:0 };

const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate = s => s ? new Date(s).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
const pct = n => `${Math.round(Number(n||0))}%`;
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a };
const gameLabel=t=>({swipe:'Swipe — vero/falso',mcq:'Scelta multipla (MCQ)',fill:'Completa la frase',error:'Trova l’errore',match:'Abbinamenti',memory:'Memory',listen_mcq:'Ascolta e scegli',spell:'Dettato',quick_tap:'Quick Tap',word_order:'Word Order',mixed:'Giochi misti'})[t]||String(t||'');

function firebaseEmailForUsername(username){
  const u=String(username||'').trim().toLowerCase();
  if(u.includes('@')) return u;
  const domain=String(window.EGL_FIREBASE_CONFIG?.authDomain||'').trim().toLowerCase();
  if(!domain) throw new Error('Configurazione Firebase assente');
  return `${u}@${domain}`;
}
async function api(url, opts={}){
  await Promise.all([window.eglAuthReady || Promise.resolve(), window.eglAuthPersistenceReady || Promise.resolve()]);
  const auth=window.eglAuth;

  // Authentication is handled by Firebase Auth in the browser. The app keeps
  // the same API interface used by the tested local V1, so the UI/game logic
  // remains unchanged.
  if(url==='/api/login' && (opts.method||'GET').toUpperCase()==='POST'){
    const body=JSON.parse(opts.body||'{}');
    try{
      const email=firebaseEmailForUsername(body.username);
      const cred=await auth.signInWithEmailAndPassword(email,String(body.password||''));
             // Teacher bootstrap is an explicit, separately authorized setup step.
return {ok:true};
    }catch(e){
      if(e?.isSetupError) throw e;
      if(String(e?.code||'').startsWith('auth/')) throw new Error('Username o password non corretti');
      throw new Error(e?.message||'Errore durante il login');
    }
  }
  if(url==='/api/logout' && (opts.method||'GET').toUpperCase()==='POST'){
    await auth.signOut(); return {ok:true};
  }
  if(url==='/api/change-password' && (opts.method||'GET').toUpperCase()==='POST'){
    const body=JSON.parse(opts.body||'{}'), user=auth.currentUser;
    if(!user) throw new Error('Authentication required');
    if(String(body.new_password||'').length<8) throw new Error('La nuova password deve avere almeno 8 caratteri.');
    try{
      const cred=firebase.auth.EmailAuthProvider.credential(user.email,String(body.old_password||''));
      await user.reauthenticateWithCredential(cred);
      await api('/api/password-change-intent',{method:'POST',body:'{}'});
      await user.updatePassword(String(body.new_password||''));
      const token=await user.getIdToken(true);
      await fetch('/api/password-changed',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:'{}'});
      return {ok:true};
    }catch(e){
      if(e?.code==='auth/wrong-password' || e?.code==='auth/invalid-credential') throw new Error('Password attuale non corretta.');
      throw new Error(e?.message || 'Impossibile cambiare la password.');
    }
  }

  const headers={'Content-Type':'application/json',...(opts.headers||{})};
  if(auth.currentUser){
    const token=await auth.currentUser.getIdToken();
    headers.Authorization=`Bearer ${token}`;
  }
  const res=await fetch(url,{headers,...opts});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error || data.detail || `Errore ${res.status}`);
  return data;
}
function toast(msg,type='ok'){
  const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=msg; toastRoot.appendChild(el);
  setTimeout(()=>el.remove(),3400);
}
function closeModal(){modalRoot.innerHTML=''}
function openModal(html,wide=false){modalRoot.innerHTML=`<div class="modal-backdrop" id="backdrop"><div class="modal ${wide?'wide':''}">${html}</div></div>`; $('#backdrop').addEventListener('mousedown',e=>{if(e.target.id==='backdrop') closeModal()})}
function topbar(role='student'){
  return `<header class="topbar"><div class="brand"><div class="brand-mark">🎮</div><span>English Game Lab</span></div><div class="top-actions">
    ${role==='teacher'?'<span class="pill">👩‍🏫 Teacher</span>':''}
    <button class="btn secondary sm" onclick="showPasswordModal()">🔐 Password</button>
    <button class="btn ghost sm" onclick="logout()">Esci</button><div class="avatar">${role==='teacher'?'T':'EN'}</div></div></header>`
}

async function boot(){
  try{const m=await api('/api/me'); if(!m.authenticated) return renderLogin(); state.me=m.user; if(m.user.role==='teacher') renderTeacher('dashboard'); else renderStudent();}
  catch(e){renderLogin();}
}
function renderLogin(){
  state.me=null;
  app.innerHTML=`<main class="login-page"><section class="login-shell card">
    <div class="login-art"><div class="brand"><div class="brand-mark">🎮</div><span>English Game Lab</span></div>
      <h1>Learn English.<br><span>Play your way.</span></h1><p>Giochi, sfide e progressi per allenare l'inglese senza trasformarlo nell'ennesimo compito.</p>
      <div class="floating-chip chip1">⚡ +100 XP</div><div class="floating-chip chip2">🔥 5 streak</div><div class="floating-chip chip3">⚽ Sports</div>
    </div>
    <form class="login-form" id="loginForm"><div class="eyebrow">Welcome back</div><h2>Ready to play?</h2><p>Accedi con le credenziali consegnate dalla prof.</p>
      <div class="stack"><div class="field"><label>Username</label><input class="input" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary" type="submit">Entra nel Game Lab →</button></div>
      <div class="login-note">Gli studenti usano un codice pseudonimo. L'associazione con il nome reale è visibile solo nell'area docente protetta.</div>
    </form></section></main>`;
  $('#loginForm').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.currentTarget); try{await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(fd))}); await boot()}catch(err){toast(err.message,'error')}}
}
async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'})}catch{} renderLogin()}
function showPasswordModal(){
  openModal(`<div class="modal-head"><div><div class="eyebrow">Sicurezza</div><h2>Cambia password</h2></div><button class="close" onclick="closeModal()">×</button></div>
  <form id="pwForm" class="stack"><div class="field"><label>Password attuale</label><input class="input" type="password" name="old_password" required></div>
  <div class="field"><label>Nuova password</label><input class="input" type="password" name="new_password" minlength="8" required></div>
  <button class="btn primary">Salva nuova password</button></form>`);
  $('#pwForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });toast('Password aggiornata');closeModal();state.me.must_change_password=false}catch(err){toast(err.message,'error')}}
}

// ---------------- STUDENT ----------------
async function renderStudent(){
  app.innerHTML=`<div class="shell">${topbar('student')}<main class="main"><div class="card pad center">Caricamento…</div></main></div>`;
  try{
    const d=await api('/api/student/dashboard'); state.student=d;
    const activities=d.activities.map(a=>activityCard(a)).join('');
    const stats=d.topic_stats.length?d.topic_stats.map(x=>`<div class="progress-row"><strong>${esc(x.topic)}</strong><div class="bar"><span style="width:${Number(x.score||0)}%"></span></div><span class="right strong">${pct(x.score)}</span></div>`).join(''):'<div class="empty">Gioca una prima attività per vedere qui i tuoi progressi.</div>';
    const recent=d.recent.length?d.recent.map(r=>`<div class="list-row"><div class="strong">${esc(r.icon)} ${esc(r.title)}</div><div class="muted small">${fmtDate(r.started_at)}</div><div class="right"><strong>${pct(r.score)}</strong></div></div>`).join(''):'<div class="empty">Nessuna sessione completata ancora.</div>';
    const badges=d.badges.length?d.badges.map(b=>`<div class="badge-card"><span>${b.icon}</span>${esc(b.name)}</div>`).join(''):'<span class="muted small">Il primo badge arriva dopo la prima partita.</span>';
    app.innerHTML=`<div class="shell">${topbar('student')}<main class="main">
      <section class="hero"><div class="hero-main card"><div class="eyebrow">${esc(d.student.class_name||'English Game Lab')}</div><h1>Welcome back, ${esc(d.student.code)}! 👋</h1><p class="muted">Allenati, supera le sfide e guarda quanto migliori nel tempo.</p>
        <div class="row between"><span class="strong">Level ${d.level}</span><span class="muted small">${d.level_progress} / 1000 XP</span></div><div class="xpbar"><span style="width:${d.level_progress/10}%"></span></div>
      </div><div class="hero-side card"><div class="row between"><div><div class="muted small">TOTAL XP</div><div class="big-stat">⭐ ${d.student.xp}</div></div><div><div class="muted small">STREAK</div><div class="big-stat">🔥 ${d.streak}</div></div></div><div class="badges" style="margin-top:18px">${badges}</div></div></section>
      <div class="section-title"><div><h2>Choose your challenge</h2><p>Practice quante volte vuoi; le verifiche assegnate hanno tentativi limitati.</p></div></div>
      <section class="activity-grid">${activities}</section>
      <div class="section-title"><div><h2>Your progress</h2><p>Percentuali calcolate sulle risposte realmente date.</p></div></div>
      <section class="two-col"><div class="card pad">${stats}</div><div class="card pad"><div class="eyebrow">Recent activity</div>${recent}</div></section>
    </main></div>`;
  }catch(e){toast(e.message,'error')}
}
function activityCard(a){
  const locked=!a.available;
  return `<article class="activity-card card"><div class="row between"><div class="activity-icon">${esc(a.icon)}</div><span class="pill ${a.mode}">${a.mode==='practice'?'PRACTICE':'ASSIGNMENT'}</span></div>
  <h3>${esc(a.title)}</h3><p>${esc(a.subtitle||'English challenge')}</p><div class="bottom"><div class="score-chip">${a.attempts?`Best <strong>${pct(a.best)}</strong> · ${a.attempts} session${a.attempts===1?'':'s'}`:'Not played yet'}</div>
  <button class="btn ${locked?'secondary':'primary'} sm" ${locked?'disabled':''} onclick="startActivity(${a.id})">${locked?'Completed ✓':'PLAY →'}</button></div></article>`
}
async function startActivity(id){
  try{
    const g=await api('/api/student/attempts/start',{method:'POST',body:JSON.stringify({activity_id:id})});
    const attack=Boolean(g.activity.time_attack&&g.activity.mode==='practice');
    state.game={...g,index:0,answered:false,startedAt:Date.now(),timer:null,attackTimer:null,pendingAnswer:null,finishing:false,seconds:0,timeBank:g.activity.time_limit||60,attackDeadline:attack?Date.now()+(g.activity.time_limit||60)*1000:0,attack,audioUrl:null,selectedMatches:[],matchLeft:null,matchRight:null,memoryExpired:false};
    renderGameQuestion();
  }catch(e){toast(e.message,'error')}
}
function updateTimerText(g){
  const el=$('#timer');if(!el)return;
  if(g.attack)el.textContent=Math.max(0,Math.ceil((g.attackDeadline-Date.now())/1000));
  else if(g.activity.game_type==='memory')el.textContent=Math.max(0,Math.ceil((g.memoryDeadline-Date.now())/1000));
  else el.textContent=Math.max(0,Math.ceil((g.roundDeadline-Date.now())/1000));
}
function startAttackClock(g){
  if(g.attackTimer)return;
  g.attackTimer=setInterval(()=>{
    if(state.game!==g||g.finishing){clearInterval(g.attackTimer);g.attackTimer=null;return}
    updateTimerText(g);
    if(g.attackDeadline<=Date.now())finishGame();
  },150);
}
function renderGameQuestion(){
  const g=state.game;if(!g||g.finishing)return;
  const q=g.questions[g.index];if(!q)return finishGame();
  if(g.audioUrl){URL.revokeObjectURL(g.audioUrl);g.audioUrl=null;}
  g.answered=false;g.swipePending=false;g.startedAt=Date.now();g.selectedMatches=[];g.matchLeft=null;g.matchRight=null;
  if(g.timer){clearInterval(g.timer);g.timer=null}
  const isMemory=g.activity.game_type==='memory';
  const roundSeconds=isMemory?(g.activity.memory_round_seconds||20):(g.activity.time_limit||0);
  g.roundDeadline=Date.now()+roundSeconds*1000;
  if(isMemory)g.memoryDeadline=g.roundDeadline;
  const progress=Math.round(g.index/g.questions.length*100);
  app.innerHTML=`<div class="game-screen"><header class="game-top"><button class="btn ghost sm" onclick="confirmExitGame()">← Exit</button><div class="game-progress"><span style="width:${progress}%"></span></div><div class="game-meta"><span class="label">${g.index+1} / ${g.questions.length}</span></div>${(g.attack||roundSeconds)?`<div class="timer" id="timer">${Math.ceil(g.attack?(g.attackDeadline-Date.now())/1000:roundSeconds)}</div>`:''}</header>
  <main class="game-wrap"><div class="question-tag"><span class="pill">${esc(q.topic)}</span>${q.vocabulary?`<span class="pill">${esc(q.vocabulary)}</span>`:''}<span class="pill ${q.difficulty}">${esc(q.difficulty)}</span></div><div id="questionArea">${questionHtml(q)}</div><div id="feedbackArea" aria-live="polite"></div></main></div>`;
  bindQuestion(q);
  if(['listen_mcq','spell'].includes(q.type))loadQuestionAudio(q);
  if(g.attack){startAttackClock(g);updateTimerText(g)}
  else if(roundSeconds){g.timer=setInterval(()=>{
    if(state.game!==g||g.finishing){clearInterval(g.timer);g.timer=null;return}
    updateTimerText(g);
    if(g.roundDeadline<=Date.now()){
      clearInterval(g.timer);g.timer=null;
      if(!g.answered)submitAnswer(null,true);
    }
  },150)}
}

function questionHtml(q){
  if(q.type==='swipe') return `<p class="center muted strong">Swipe right if the sentence is correct. Left if it is wrong.</p><div class="swipe-zone"><div class="swipe-card" id="swipeCard"><span class="swipe-stamp stamp-right">CORRECT ✓</span><span class="swipe-stamp stamp-left">WRONG ✕</span>${esc(q.prompt)}</div></div><div class="swipe-actions"><button class="swipe-btn no" id="swipeNo" aria-label="Incorrect">← ✕</button><button class="swipe-btn yes" id="swipeYes" aria-label="Correct">✓ →</button></div>`;
  if(q.type==='listen_mcq')return `<h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><p class="muted">🎧 Ascolta la registrazione e scegli.</p><audio id="questionAudio" controls preload="none" style="width:100%"></audio><div class="answers">${q.payload.options.map((o,i)=>`<button class="answer-btn" data-answer="${i}">${esc(o)}</button>`).join('')}</div></div>`;
  if(q.type==='spell')return `<h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><p class="muted">🎧 Ascolta e scrivi la parola.</p><audio id="questionAudio" controls preload="none" style="width:100%"></audio><div class="fill-box"><input id="fillInput" class="input" autocomplete="off" placeholder="Type the word…"><button id="fillSubmit" class="btn primary">CHECK</button></div></div>`;
  if(q.type==='match'&&state.game.activity.game_type==='memory')return memoryQuestionHtml(q);
  if(q.type==='fill'&&state.game.activity.game_type==='word_order')return `<h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><p class="muted center">Tocca le parole nell'ordine corretto. Puoi annullare toccando una parola scelta.</p><div class="word-order-answer" id="wordAnswer" aria-live="polite"></div><div class="word-order-bank" id="wordBank"></div><div class="row wrap" style="justify-content:center;margin-top:20px"><button class="btn secondary" id="wordReset">Ricomincia</button><button class="btn primary" id="wordCheck">CONTROLLA</button></div></div>`;
  if(q.type==='mcq'&&state.game.activity.game_type==='quick_tap')return `<h2 class="question-title">${esc(q.prompt)}</h2><p class="center muted strong">👆 Tocca subito la risposta corretta!</p><div class="quick-tap-grid">${q.payload.options.map((o,i)=>`<button class="quick-tap-btn" data-answer="${i}">${esc(o)}</button>`).join('')}</div>`;
  if(q.type==='mcq') return `<h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><div class="answers">${q.payload.options.map((o,i)=>`<button class="answer-btn" data-answer="${i}"><span class="pill">${String.fromCharCode(65+i)}</span> ${esc(o)}</button>`).join('')}</div></div>`;
  if(q.type==='fill') return `<h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><div class="fill-box"><input id="fillInput" class="input" autocomplete="off" placeholder="Type your answer…"><button id="fillSubmit" class="btn primary">CHECK</button></div></div>`;
  if(q.type==='error') return `<p class="center muted strong">Tap the part of the sentence that contains the mistake.</p><h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><div class="error-chunks">${q.payload.chunks.map((c,i)=>`<button class="chunk" data-answer="${i}">${esc(c)}</button>`).join('')}</div></div>`;
  if(q.type==='match'){
    const left=shuffle(q.payload.left),right=shuffle(q.payload.right); state.game.matchShown={left,right};
    return `<h2 class="question-title">${esc(q.prompt)}</h2><div class="game-card card"><div class="match-grid"><div class="match-col">${left.map((x,i)=>`<button class="match-item" data-side="left" data-val="${esc(x)}">${esc(x)}</button>`).join('')}</div><div class="match-col">${right.map(x=>`<button class="match-item" data-side="right" data-val="${esc(x)}">${esc(x)}</button>`).join('')}</div></div><div class="match-lines" id="matchLines"></div><button id="matchSubmit" class="btn primary" style="margin-top:18px" disabled>CHECK MATCHES</button></div>`
  }
  return '';
}
function bindQuestion(q){
  if(q.type==='fill'&&state.game.activity.game_type==='word_order'){initWordOrder(q);return}
  if(q.type==='swipe') bindSwipe();
  if(q.type==='mcq'||q.type==='listen_mcq'||q.type==='error') $$('[data-answer]').forEach(b=>b.onclick=()=>{if(!state.game.answered)submitAnswer(Number(b.dataset.answer))});
  if(q.type==='fill'||q.type==='spell'){const input=$('#fillInput');$('#fillSubmit').onclick=()=>submitAnswer(input.value);input.addEventListener('keydown',e=>{if(e.key==='Enter')submitAnswer(input.value)});setTimeout(()=>input.focus(),100)}
  if(q.type==='match'&&state.game.activity.game_type==='memory'){$$('.memory-card').forEach(b=>b.onclick=()=>memoryFlip(Number(b.dataset.index)));}
  else if(q.type==='match'){
    $$('.match-item').forEach(b=>b.onclick=()=>selectMatch(b)); $('#matchSubmit').onclick=()=>submitAnswer(state.game.selectedMatches.map(x=>[x.left,x.right]));
  }
}

function initWordOrder(q){
  const g=state.game;g.wordSelected=[];const words=q.payload.tiles||[];
  function draw(){
    const bank=$('#wordBank'),answer=$('#wordAnswer');if(!bank||!answer)return;
    bank.innerHTML=words.map((word,i)=>g.wordSelected.includes(i)?'':`<button type="button" class="word-tile" data-add="${i}">${esc(word)}</button>`).join('');
    answer.innerHTML=g.wordSelected.length?g.wordSelected.map(i=>`<button type="button" class="word-tile chosen" data-remove="${i}">${esc(words[i])}</button>`).join(''):'<span class="muted">La tua frase apparirà qui…</span>';
    $$('[data-add]',bank).forEach(el=>el.onclick=()=>{if(g.answered)return;g.wordSelected.push(Number(el.dataset.add));draw()});
    $$('[data-remove]',answer).forEach(el=>el.onclick=()=>{if(g.answered)return;g.wordSelected=g.wordSelected.filter(i=>i!==Number(el.dataset.remove));draw()});
  }
  $('#wordReset').onclick=()=>{if(!g.answered){g.wordSelected=[];draw()}};
  $('#wordCheck').onclick=()=>{if(!g.answered&&g.wordSelected.length===words.length)submitAnswer(g.wordSelected.map(i=>words[i]).join(' '));else toast('Seleziona tutte le parole.','error')};
  draw();
}
function memoryQuestionHtml(q){
  // Use the question's pairs, then shuffle the face-down cards.
  const items=[];
  (q.payload.pairs||[]).forEach((pair,i)=>{items.push({pair:i,text:pair.left});items.push({pair:i,text:pair.right});});
  const g=state.game;g.memoryPairs=q.payload.pairs||[];g.memoryCards=shuffle(items).map(x=>({...x,revealed:false,matched:false}));g.memoryFirst=null;g.memoryLocked=false;
  return `<h2 class="question-title">${esc(q.prompt)}</h2><p class="center muted">Trova tutte le coppie. Se sbagli, riprova!</p><div class="memory-grid">${g.memoryCards.map((_,i)=>`<button type="button" class="memory-card" data-index="${i}" aria-label="Carta ${i+1} coperta">?</button>`).join('')}</div>`;
}
function memoryFlip(i){
  const g=state.game;if(!g||g.answered||g.memoryLocked||!g.memoryCards||g.finishing)return;
  const card=g.memoryCards[i];if(!card||card.matched||card.revealed)return;
  card.revealed=true;const el=$$('.memory-card')[i];el.textContent=card.text;el.classList.add('flipped');
  if(g.memoryFirst===null){g.memoryFirst=i;return}
  const first=g.memoryFirst;g.memoryFirst=null;g.memoryLocked=true;
  if(g.memoryCards[first].pair===card.pair){
    g.memoryCards[first].matched=true;card.matched=true;
    setTimeout(()=>{$$('.memory-card')[first]?.classList.add('matched');$$('.memory-card')[i]?.classList.add('matched');g.memoryLocked=false;
      if(g.memoryCards.every(x=>x.matched))submitAnswer(g.memoryPairs.map(x=>[x.left,x.right]));},350);
  }else{
    if(g.attack)g.timeBank=Math.max(0,g.timeBank-2);
    setTimeout(()=>{for(const ix of [first,i]){g.memoryCards[ix].revealed=false;const e=$$('.memory-card')[ix];if(e){e.textContent='?';e.classList.remove('flipped');}}g.memoryLocked=false;},650);
  }
}
async function loadQuestionAudio(q){
  const g=state.game,audio=$('#questionAudio');if(!audio||!g)return;
  try{
    const token=await window.eglAuth.currentUser.getIdToken();
    const res=await fetch(`/api/student/attempts/${g.attempt_id}/questions/${q.id}/audio`,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
    if(!res.ok)throw new Error('Audio non disponibile');
    const blob=await res.blob();if(state.game!==g||g.questions[g.index]?.id!==q.id)return;
    const url=URL.createObjectURL(blob);g.audioUrl=url;audio.src=url;
  }catch(e){if(state.game===g)toast('Impossibile caricare l’audio della domanda','error')}
}

function bindSwipe(){
  const card=$('#swipeCard'); let startX=0,dx=0,drag=false;
  const move=x=>{dx=x-startX;card.classList.add('dragging');card.style.transform=`translateX(${dx}px) rotate(${dx/18}deg)`;$('.stamp-right').style.opacity=Math.max(0,dx/100);$('.stamp-left').style.opacity=Math.max(0,-dx/100)};
  card.onpointerdown=e=>{if(state.game.answered)return;drag=true;startX=e.clientX;card.setPointerCapture(e.pointerId)};
  card.onpointermove=e=>{if(drag)move(e.clientX)};
  card.onpointerup=e=>{if(!drag)return;drag=false;card.classList.remove('dragging');if(Math.abs(dx)>95) swipeSubmit(dx>0); else{card.style.transform='';$('.stamp-right').style.opacity=0;$('.stamp-left').style.opacity=0}dx=0};
  $('#swipeNo').onclick=()=>swipeSubmit(false);$('#swipeYes').onclick=()=>swipeSubmit(true);
  window.onkeydown=e=>{if(state.game?.answered)return;if(e.key==='ArrowLeft')swipeSubmit(false);if(e.key==='ArrowRight')swipeSubmit(true)}
}
function swipeSubmit(val){const card=$('#swipeCard'); if(!card||state.game.answered||state.game.swipePending)return;state.game.swipePending=true; card.style.transform=`translateX(${val?700:-700}px) rotate(${val?24:-24}deg)`;card.style.opacity='0';setTimeout(()=>submitAnswer(val),160)}
function selectMatch(btn){
  if(state.game.answered||btn.classList.contains('done'))return;const side=btn.dataset.side,val=btn.dataset.val;
  if(side==='left'){ $$('.match-item[data-side="left"]').forEach(x=>x.classList.remove('active'));state.game.matchLeft=val;btn.classList.add('active') }
  else{$$('.match-item[data-side="right"]').forEach(x=>x.classList.remove('active'));state.game.matchRight=val;btn.classList.add('active')}
  if(state.game.matchLeft&&state.game.matchRight){const l=state.game.matchLeft,r=state.game.matchRight;state.game.selectedMatches.push({left:l,right:r});$$('.match-item').filter(x=>x.dataset.val===l||x.dataset.val===r).forEach(x=>{x.classList.add('done');x.classList.remove('active')});state.game.matchLeft=null;state.game.matchRight=null;$('#matchLines').innerHTML=state.game.selectedMatches.map(x=>`<span class="match-pair">${esc(x.left)} ↔ ${esc(x.right)}</span>`).join('');$('#matchSubmit').disabled=state.game.selectedMatches.length!==state.game.matchShown.left.length}
}
async function submitAnswer(answer,timedOut=false){
  const g=state.game;if(!g||g.answered||g.finishing)return;
  g.answered=true;window.onkeydown=null;
  if(g.timer){clearInterval(g.timer);g.timer=null}
  const q=g.questions[g.index],elapsed=Date.now()-g.startedAt;
  try{
    const promise=api(`/api/student/attempts/${g.attempt_id}/answer`,{method:'POST',body:JSON.stringify({question_id:q.id,answer,elapsed_ms:elapsed,time_expired:Boolean(timedOut)})});
    g.pendingAnswer=promise;const r=await promise;g.pendingAnswer=null;
    if(state.game!==g||g.finishing)return;
    const speedMode=g.attack||g.activity.game_type==='quick_tap';
    if(g.attack){
      g.attackDeadline+=(r.correct?4:-6)*1000;
      g.attackDeadline=Math.min(g.attackDeadline,Date.now()+120000);
      updateTimerText(g);
    }
    if(g.activity.game_type==='memory'&&timedOut){
      g.memoryExpired=true;
      $('#feedbackArea').innerHTML='<div class="feedback bad"><strong>⏰ Tempo scaduto: questa sessione Memory assegna 0 XP.</strong></div>';
      return setTimeout(()=>{if(state.game===g)finishGame()},600);
    }
    if(speedMode){
      const area=$('#feedbackArea');
      if(area)area.innerHTML=`<div class="feedback-flash ${r.correct?'right':'wrong'}" role="status">${g.attack?(r.correct?'✓ +4 s':'✕ −6 s'):(r.correct?'✓ Corretto!':'✕ Riprova nella prossima!')}</div>`;
      if(g.attack&&g.attackDeadline<=Date.now())return finishGame();
      const at=g.index;
      return setTimeout(()=>{if(state.game===g&&!g.finishing&&g.index===at)nextQuestion()},260);
    }
    if(g.activity.mode==='practice')showFeedback(r,timedOut);
    else setTimeout(()=>{if(state.game===g)nextQuestion()},280);
  }catch(e){g.pendingAnswer=null;if(!g.finishing){g.answered=false;g.swipePending=false;toast(e.message,'error')}}
}

function showFeedback(r,timedOut){
  const ok=!!r.correct;$('#feedbackArea').innerHTML=`<div class="feedback ${ok?'ok':'bad'}"><div class="row between wrap"><div><h3>${timedOut?'⏱ Time!':ok?'🔥 Correct! +XP':'💡 Not quite'}</h3><div class="muted">${esc(r.explanation||'')}</div>${r.correction?`<div style="margin-top:8px"><span class="pill">Correct form</span> <strong>${esc(r.correction)}</strong></div>`:''}</div>${state.game?.attack?'<span class="pill">Prossima domanda…</span>':`<button class="btn ${ok?'success':'primary'}" onclick="nextQuestion()">NEXT →</button>`}</div></div>`;
  setTimeout(()=>$('#feedbackArea')?.scrollIntoView({behavior:'smooth',block:'nearest'}),60)
}
function nextQuestion(){
  const g=state.game;if(!g||g.finishing)return;
  if(g.attack&&g.attackDeadline<=Date.now())return finishGame();
  g.index++;renderGameQuestion();
}
function confirmExitGame(){
  if(confirm('Vuoi uscire? Il tentativo resterà incompleto.')){
    const g=state.game;if(g?.timer)clearInterval(g.timer);if(g?.attackTimer)clearInterval(g.attackTimer);
    if(g?.audioUrl)URL.revokeObjectURL(g.audioUrl);state.game=null;window.onkeydown=null;renderStudent();
  }
}
async function finishGame(){
  const g=state.game;if(!g||g.finishing)return;
  g.finishing=true;
  if(g.timer)clearInterval(g.timer);if(g.attackTimer)clearInterval(g.attackTimer);
  g.timer=null;g.attackTimer=null;
  if(g.audioUrl)URL.revokeObjectURL(g.audioUrl);window.onkeydown=null;
  try{
    if(g.pendingAnswer)await g.pendingAnswer.catch(()=>{});
    const r=await api(`/api/student/attempts/${g.attempt_id}/finish`,{method:'POST',body:'{}'});
    if(state.game===g){g.result=r;renderGameResult(r)}
  }catch(e){toast(e.message,'error');if(state.game===g)renderStudent()}
}

function renderGameResult(r){
  const label=r.score>=90?'Outstanding! 🏆':r.score>=75?'Great job! 🔥':r.score>=60?'Good progress! 💪':'Keep practising! 🚀';
  const breakdown=r.breakdown.map(x=>`<div class="break-card card"><span class="muted small">${esc(x.topic)}</span><strong>${pct(x.score)}</strong><span class="tiny muted">${x.correct}/${x.total} correct</span></div>`).join('');
  const review=r.review.length?`<div class="card pad" style="margin-top:18px"><div class="eyebrow">Review</div><h3>Things worth revisiting</h3>${r.review.map(x=>`<div style="padding:13px 0;border-bottom:1px solid var(--line)"><strong>${esc(x.prompt)}</strong>${x.correction?`<div class="small" style="color:var(--ok);margin-top:5px">✓ ${esc(x.correction)}</div>`:''}<div class="muted small">${esc(x.explanation)}</div></div>`).join('')}</div>`:'';
  app.innerHTML=`<div class="shell">${topbar('student')}<main class="main" style="max-width:900px"><div class="result-hero card"><div class="eyebrow">Challenge complete</div><h1>${r.memory_timed_out?'⏰ Memory: tempo scaduto':label}</h1>${r.memory_timed_out?'<p>Sessione scaduta: 0 XP, anche se avevi già trovato alcune coppie.</p>':''}<div class="result-score" style="--pct:${r.score}%"><strong>${pct(r.score)}</strong></div><p class="muted">${r.correct} correct answers out of ${r.total} · <strong style="color:var(--yellow)">+${r.xp} XP</strong></p><button class="btn primary" onclick="state.game=null;renderStudent()">BACK HOME →</button></div><div class="section-title"><div><h2>Section results</h2></div></div><div class="breakdown-grid">${breakdown}</div>${review}</main></div>`;
}

// ---------------- TEACHER ----------------
const navItems=[['dashboard','◫','Overview'],['classes','👥','Classi & alunni'],['questions','❓','Banca domande'],['activities','🎮','Giochi & attività'],['results','📊','Risultati']];
function teacherShell(content,tab){
  return `<div class="shell">${topbar('teacher')}<div class="teacher-layout"><aside class="sidebar no-print">${navItems.map(([id,ic,tx])=>`<button class="nav-btn ${tab===id?'active':''}" onclick="renderTeacher('${id}')"><span>${ic}</span>${tx}</button>`).join('')}</aside><main class="teacher-main">${content}</main></div></div>`
}
async function renderTeacher(tab='dashboard'){
  state.teacherTab=tab; app.innerHTML=teacherShell('<div class="card pad center">Caricamento…</div>',tab);
  try{
    if(tab==='dashboard') return renderTeacherDashboard(await api('/api/teacher/dashboard'));
    if(tab==='classes') return renderClasses(await api('/api/teacher/classes'));
    if(tab==='questions') return refreshQuestionBank();
    if(tab==='activities') return renderActivities(await api('/api/teacher/activities'));
    if(tab==='results') return loadResults(state.resultsClass||0);
  }catch(e){toast(e.message,'error')}
}
function teacherHeader(title,sub,action=''){return `<div class="teacher-header"><div><div class="eyebrow">Teacher dashboard</div><h1>${title}</h1>${sub?`<div class="muted small">${sub}</div>`:''}</div>${action}</div>`}
function renderTeacherDashboard(d){
  state.teacherData.dashboard=d;
  const stats=[['👥',d.counts.students,'Studenti'],['❓',d.counts.questions,'Domande'],['🎮',d.counts.activities,'Attività pubblicate'],['⚡',d.counts.played_today,'Sessioni oggi']].map(x=>`<div class="stat-card card"><div class="icon">${x[0]}</div><div class="value">${x[1]}</div><div class="label">${x[2]}</div></div>`).join('');
  const recent=d.recent.length?d.recent.map(r=>`<div class="list-row"><div><strong>${esc(r.code)}</strong><div class="tiny muted">${esc(r.real_name||'Nome non associato')} · ${esc(r.title)}</div></div><div class="muted small">${fmtDate(r.started_at)}</div><div class="right strong">${pct(r.score)}</div></div>`).join(''):'<div class="empty">Le attività degli studenti compariranno qui.</div>';
  const topic=d.topic_stats.length?d.topic_stats.map(x=>`<div class="progress-row"><strong>${esc(x.topic)}</strong><div class="bar"><span style="width:${x.score}%"></span></div><span class="right strong">${pct(x.score)}</span></div>`).join(''):'<div class="empty">Le statistiche appariranno dopo le prime sessioni.</div>';
  const alert=state.me.must_change_password?`<div class="card pad" style="border-color:rgba(255,216,77,.35);margin-bottom:18px"><div class="row between wrap"><div><strong>🔐 Cambia la password iniziale</strong><div class="muted small">Il primo accesso usa una password temporanea: sostituiscila prima di pubblicare il sito.</div></div><button class="btn primary sm" onclick="showPasswordModal()">Cambia ora</button></div></div>`:'';
  app.innerHTML=teacherShell(`${teacherHeader('Bentornato/a 👋','Controlla attività, progressi e contenuti da un unico posto.')} ${alert}<section class="stats-grid">${stats}</section><section class="two-col" style="margin-top:18px"><div class="card pad"><div class="row between"><div><div class="eyebrow">Recent activity</div><h3>Ultime sessioni</h3></div><div class="big-stat">${pct(d.counts.average)}</div></div>${recent}</div><div class="card pad"><div class="eyebrow">Class performance</div><h3>Risultati per argomento</h3>${topic}</div></section>`, 'dashboard')
}
function renderClasses(d){
  state.teacherData.classes=d.classes;
  const cards=d.classes.length?d.classes.map(c=>`<article class="class-card card"><div class="row between"><span class="pill">${esc(c.school_year||'Classe')}</span><span class="big">${c.students}</span></div><h3>${esc(c.name)}</h3><div class="muted small">studenti associati</div><div class="row wrap" style="margin-top:18px"><button class="btn primary sm" onclick="openClass(${c.id})">Apri</button><button class="btn secondary sm" onclick="generateStudentsModal(${c.id},'${esc(c.name)}')">+ Account</button>${c.students===0?`<button class="btn danger sm" onclick="deleteClass(${c.id})">Elimina</button>`:''}</div></article>`).join(''):'<div class="empty card">Crea la prima classe e genera in un clic fino a 30 account pseudonimi.</div>';
  app.innerHTML=teacherShell(`${teacherHeader('Classi & alunni','Solo qui è visibile l’associazione tra codice e nome reale.','<button class="btn primary" onclick="newClassModal()">+ NUOVA CLASSE</button>')}<div class="class-grid">${cards}</div>`,'classes')
}
function newClassModal(){openModal(`<div class="modal-head"><div><div class="eyebrow">Nuova classe</div><h2>Crea classe</h2></div><button class="close" onclick="closeModal()">×</button></div><form id="classForm" class="stack"><div class="field"><label>Nome classe</label><input class="input" name="name" placeholder="es. 2A" required></div><div class="field"><label>Anno scolastico</label><input class="input" name="school_year" placeholder="2026/27"></div><button class="btn primary">CREA CLASSE</button></form>`);$('#classForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/teacher/classes',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});closeModal();toast('Classe creata');renderTeacher('classes')}catch(err){toast(err.message,'error')}}}
async function deleteClass(id){if(!confirm('Eliminare questa classe vuota?'))return;try{await api(`/api/teacher/classes/${id}`,{method:'DELETE'});toast('Classe eliminata');renderTeacher('classes')}catch(e){toast(e.message,'error')}}
function generateStudentsModal(cid,name){
  openModal(`<div class="modal-head"><div><div class="eyebrow">${esc(name)}</div><h2>Genera account studenti</h2></div><button class="close" onclick="closeModal()">×</button></div><form id="genForm" class="stack"><div class="modal-grid"><div class="field"><label>Numero account</label><input class="input" name="count" type="number" min="1" max="30" value="30" required></div><div class="field"><label>Prefisso codice</label><input class="input" name="prefix" value="${esc(name.replace(/[^A-Za-z0-9]/g,''))}" maxlength="8"></div><div class="field full"><label>Nomi alunni (facoltativo, uno per riga nell'ordine di generazione)</label><textarea class="textarea" name="names" rows="7" placeholder="Mario Rossi\nSara Bianchi\n..."></textarea><div class="tiny muted">Se inserisci i nomi, devono essere tanti quanti gli account da generare. Rimangono privati nell'area docente e compariranno sulle schede stampate.</div></div></div><div class="field full"><label>🔐 Frase segreta per ristampare le password iniziali</label><input class="input" name="vault_passphrase" type="password" minlength="12" autocomplete="off" required placeholder="Almeno 12 caratteri; conserva la frase in un posto sicuro"><div class="tiny muted">I codici iniziali saranno cifrati nel browser e archiviati sul server. Usa sempre la stessa frase segreta: senza di essa non saranno più leggibili. Le password scelte dagli studenti non vengono memorizzate.</div></div><button class="btn primary">GENERA E STAMPA CREDENZIALI</button></form>`);
  $('#genForm').onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.currentTarget));o.count=Number(o.count);const secret=o.vault_passphrase;delete o.vault_passphrase;o.names=o.names.trim()?o.names.split(/\r?\n/).map(x=>x.trim()):[];if(o.names.length&&o.names.length!==o.count){toast('Il numero di nomi deve corrispondere agli account richiesti.','error');return}try{const r=await api(`/api/teacher/classes/${cid}/generate-students`,{method:'POST',body:JSON.stringify(o)});let archived=true;try{await vaultStore(r.credentials,secret)}catch(ex){archived=false;console.error('Credential vault:',ex)}showCredentials(r.class_name,r.credentials);toast(archived?`${r.credentials.length} account creati, password iniziali archiviate in forma cifrata`:'Account creati, ma archivio cifrato non riuscito: stampa le password adesso!',archived?'ok':'error')}catch(err){toast(err.message,'error')}};
}
function showCredentials(className,creds){
  state.lastCredentials={className,creds};
  openModal(`<div class="modal-head"><div><div class="eyebrow">${esc(className)}</div><h2>Schede studenti</h2></div><button class="close no-print" onclick="closeModal()">×</button></div><div class="row wrap credentials-actions" style="margin-bottom:18px"><button class="btn primary" onclick="window.print()">🖨 Stampa schede</button><button class="btn secondary" onclick="downloadCredentialsCSV()">⬇ CSV</button></div><div class="login-note no-print" style="margin:0 0 16px">${creds.some(c=>!c.password)?'Schede senza password recuperabile: account precedenti alla V7 o password già modificata. Se necessario, usa Reset PW.':'Stampa o consegna subito le nuove password. Non sono memorizzate in chiaro.'}</div><div class="credentials">${creds.map(c=>`<div class="credential-card"><h3>🎮 English Game Lab</h3><div class="small muted">Classe ${esc(className)}</div>${c.real_name?`<div class="credential-name">${esc(c.real_name)}</div>`:'<div class="credential-name muted">Nome: ____________________</div>'}<div class="credential-line"><span>Codice studente</span><strong>${esc(c.code||c.username)}</strong></div><div class="credential-line"><span>Username</span><strong>${esc(c.username)}</strong></div><div class="credential-line"><span>${c.password?'Password generata':'Password'}</span><strong>${c.password?esc(c.password):'Non recuperabile'}</strong></div><div class="credential-line"><span>Sito</span><strong>${esc(location.origin)}</strong></div><div class="tiny muted">${c.password?'Conserva le credenziali in un luogo sicuro.':'Password non recuperabile: richiedere reset alla docente.'}</div></div>`).join('')}</div>`,true);
}
function downloadCredentialsCSV(){
  const x=state.lastCredentials;if(!x)return;
  const csv='nome,code,username,password\n'+x.creds.map(c=>[c.real_name||'',c.code,c.username,c.password||''].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=`schede-${x.className.replace(/[^a-z0-9_-]/gi,'_')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function printClassCards(){
  const cl=(state.teacherData.classes||[]).find(x=>x.id===state.currentClass),students=state.currentStudents||[];
  if(!students.length)return toast('Nessuno studente da stampare.','error');
  try{showCredentials(cl?.name||'Classe',await reprintCredentials(state.currentClass,students));}
  catch(e){toast(e.message,'error')}
}
async function printStudentCard(id){
  const s=(state.currentStudents||[]).find(x=>x.id===id);if(!s)return;
  const cl=(state.teacherData.classes||[]).find(x=>x.id===state.currentClass);
  try{showCredentials(cl?.name||'Classe',await reprintCredentials(state.currentClass,[s]));}
  catch(e){toast(e.message,'error')}
}

// Browser-only encryption: the passphrase never travels to the server.
const vaultBase64=u=>btoa(String.fromCharCode(...u));
const vaultBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function vaultKey(secret,salt){
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:180000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function vaultEncrypt(password,secret){
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await vaultKey(secret,salt);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(password)));
  return {alg:'AES-GCM-PBKDF2-v1',salt:vaultBase64(salt),iv:vaultBase64(iv),cipher:vaultBase64(cipher)};
}
async function vaultDecrypt(vault,secret){
  try{
    const key=await vaultKey(secret,vaultBytes(vault.salt));
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:vaultBytes(vault.iv)},key,vaultBytes(vault.cipher));
    return new TextDecoder().decode(plaintext);
  }catch{throw new Error('Frase segreta errata oppure archivio danneggiato.')}
}
async function vaultStore(credentials,secret){
  if(!window.crypto?.subtle||secret.length<12)throw new Error('Cifratura non disponibile o frase segreta troppo breve.');
  const payload=[];for(const c of credentials)payload.push({student_id:c.id,vault:await vaultEncrypt(c.password,secret)});
  return api('/api/teacher/credentials/vault',{method:'POST',body:JSON.stringify({credentials:payload})});
}
function askVaultSecret(){
  return new Promise(resolve=>{
    openModal(`<div class="modal-head"><h2>🔐 Ristampa protetta</h2></div><form id="vaultUnlock" class="stack"><div class="field"><label>Frase segreta della docente</label><input class="input" name="secret" type="password" autocomplete="off" minlength="12" required autofocus></div><p class="muted small">La frase viene usata soltanto nel browser per decifrare le password iniziali. Non viene inviata al server né memorizzata.</p><div class="row"><button class="btn primary">Sblocca schede</button><button type="button" id="vaultCancel" class="btn secondary">Annulla</button></div></form>`);
    $('#backdrop')?.addEventListener('mousedown',e=>{if(e.target.id==='backdrop'){e.stopImmediatePropagation();closeModal();resolve(null)}},true);
    $('#vaultCancel').onclick=()=>{closeModal();resolve(null)};
    $('#vaultUnlock').onsubmit=e=>{e.preventDefault();const value=new FormData(e.currentTarget).get('secret');closeModal();resolve(value)};
  });
}
async function reprintCredentials(classId,students){
  const data=await api(`/api/teacher/classes/${classId}/credentials/vault`);
  const map=new Map(data.items.map(x=>[x.student_id,x]));
  const hasVault=students.some(x=>map.get(x.id)?.vault);
  const secret=hasVault?await askVaultSecret():null;
  if(hasVault&&!secret)throw new Error('Ristampa annullata.');
  const result=[];
  for(const student of students){
    const entry=map.get(student.id),password=entry?.vault?await vaultDecrypt(entry.vault,secret):null;
    result.push({...student,real_name:student.real_name||'',password});
  }
  return result;
}

async function openClass(cid){
  state.currentClass=cid;
  try{
    const d=await api(`/api/teacher/classes/${cid}/students`);
    state.currentStudents=d.students;
    const cl=(state.teacherData.classes||[]).find(x=>x.id===cid);
    const rows=d.students.length?d.students.map(s=>`<tr><td><span class="code">${esc(s.code)}</span></td><td>${esc(s.real_name||'— non associato —')}</td><td>${esc(s.username)}</td><td>${s.last_activity?fmtDate(s.last_activity):'Mai'}</td><td><span class="${s.active?'active-dot':'active-dot inactive-dot'}"></span> ${s.active?'Attivo':'Disattivo'}</td><td><div class="row wrap"><button class="btn secondary sm" onclick="editStudentById(${s.id})">Modifica</button><button class="btn secondary sm" onclick="printStudentCard(${s.id})">Stampa</button><button class="btn secondary sm" onclick="resetStudentPasswordById(${s.id})">Reset PW</button><button class="btn danger sm" onclick="deleteStudent(${s.id})">Elimina</button></div></td></tr>`).join(''):'<tr><td colspan="6"><div class="empty">Nessuno studente. Genera gli account per iniziare.</div></td></tr>';
    const action=`<div class="row"><button class="btn secondary" onclick="renderTeacher('classes')">← Classi</button><button class="btn primary" onclick="generateStudentsForCurrentClass()">+ ACCOUNT</button><button class="btn secondary" onclick="printClassCards()">🖨 Ristampa schede</button></div>`;
    app.innerHTML=teacherShell(`${teacherHeader(cl?cl.name:'Classe','Associa i nomi reali ai codici pseudonimi.',action)}<div class="table-card card"><table class="table"><thead><tr><th>Codice</th><th>Nome reale (privato)</th><th>Username</th><th>Ultima attività</th><th>Stato</th><th>Azioni</th></tr></thead><tbody>${rows}</tbody></table></div>`,'classes');
  }catch(e){toast(e.message,'error')}
}
function generateStudentsForCurrentClass(){const c=(state.teacherData.classes||[]).find(x=>x.id===state.currentClass);generateStudentsModal(state.currentClass,c?.name||'Classe')}
function editStudentById(id){const s=(state.currentStudents||[]).find(x=>x.id===id);if(s)editStudent(s)}
function resetStudentPasswordById(id){const s=(state.currentStudents||[]).find(x=>x.id===id);if(s)resetStudentPassword(id,s.code)}
function editStudent(s){openModal(`<div class="modal-head"><h2>Modifica studente</h2><button class="close" onclick="closeModal()">×</button></div><form id="studentEdit" class="stack"><div class="field"><label>Nome e cognome reale <span class="muted">(visibile solo al docente)</span></label><input class="input" name="real_name" value="${esc(s.real_name||'')}"></div><label class="row"><input type="checkbox" name="active" ${s.active?'checked':''}> Account attivo</label><button class="btn primary">SALVA</button></form>`);$('#studentEdit').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{await api(`/api/teacher/students/${s.id}`,{method:'PUT',body:JSON.stringify({real_name:fd.get('real_name'),active:fd.get('active')==='on'})});closeModal();toast('Studente aggiornato');openClass(state.currentClass)}catch(err){toast(err.message,'error')}}}
async function resetStudentPassword(id,code){if(!confirm(`Generare una nuova password per ${code}? La precedente smetterà di funzionare.`))return;try{const r=await api(`/api/teacher/students/${id}/reset-password`,{method:'POST',body:'{}'});const s=(state.currentStudents||[]).find(x=>x.id===id)||{};const cl=(state.teacherData.classes||[]).find(x=>x.id===state.currentClass);showCredentials(cl?.name||'Classe',[{code,username:s.username||code.toLowerCase(),real_name:s.real_name||'',password:r.password}]);toast('Nuova password generata. Stampa subito la scheda.')}catch(e){toast(e.message,'error')}}
async function deleteStudent(id){if(!confirm('Eliminare lo studente e tutto il suo storico? Questa azione non è reversibile.'))return;try{await api(`/api/teacher/students/${id}`,{method:'DELETE'});toast('Studente eliminato');openClass(state.currentClass)}catch(e){toast(e.message,'error')}}

const questionFilters={q:'',topic:'',type:'',status:''};
const selectedQuestionIds=new Set();
async function refreshQuestionBank(){
  const params=new URLSearchParams(questionFilters);
  return renderQuestions(await api('/api/teacher/questions?'+params));
}
function selectVisibleQuestions(checked){
  $$('.bank-select').forEach(b=>{b.checked=checked;const id=Number(b.value);checked?selectedQuestionIds.add(id):selectedQuestionIds.delete(id)});
  updateQuestionSelection();
}
function toggleQuestionSelection(id,checked){
  checked?selectedQuestionIds.add(id):selectedQuestionIds.delete(id);updateQuestionSelection();
}
function updateQuestionSelection(){
  const counter=$('#selectedQuestionCount');if(counter)counter.textContent=selectedQuestionIds.size+' selezionate';
  const all=$('#selectVisibleQuestions');if(all){const boxes=$$('.bank-select');all.checked=boxes.length>0&&boxes.every(b=>b.checked)}
  $$('.batch-action').forEach(b=>b.disabled=selectedQuestionIds.size===0);
}
async function batchQuestionStatus(active){
  const ids=[...selectedQuestionIds];if(!ids.length)return toast('Seleziona prima alcune domande.','error');
  if(!confirm(`${active?'Attivare':'Disattivare'} ${ids.length} domande? ${active?'Potranno essere usate nei giochi pubblicati.':'Lo storico degli studenti rimarrà invariato.'}`))return;
  try{
    const r=await api('/api/teacher/questions/batch-status',{method:'POST',body:JSON.stringify({ids,active})});
    selectedQuestionIds.clear();toast(`${r.updated} domande ${active?'attivate':'disattivate'}`);await refreshQuestionBank();
  }catch(e){toast(e.message,'error')}
}
function renderQuestions(d){
  state.teacherData.questions=d.questions;state.teacherData.qmeta=d.meta;
  const currentIds=new Set(d.questions.map(q=>q.id));for(const id of [...selectedQuestionIds])if(!currentIds.has(id))selectedQuestionIds.delete(id);
  const rows=d.questions.map(q=>`<tr><td><input class="bank-select" type="checkbox" value="${q.id}" aria-label="Seleziona domanda ${q.id}" ${selectedQuestionIds.has(q.id)?'checked':''} onchange="toggleQuestionSelection(${q.id},this.checked)"></td><td><span class="pill">${esc(gameLabel(q.type))}</span> <span class="pill">${q.active!==false?'🟢 Attiva':'⚪ Inattiva'}</span>${['listen_mcq','spell'].includes(q.type)?`<span class="pill">${q.has_audio?'🎧 Audio pronto':'🔴 Audio mancante'}</span>`:''}</td><td><div class="question-preview strong">${esc(q.prompt)}</div><div class="tiny muted">${esc(q.explanation||'')}</div></td><td>${esc(q.topic)}</td><td>${esc(q.vocabulary||'—')}</td><td><span class="pill ${q.difficulty}">${esc(q.difficulty)}</span></td><td><div class="row wrap"><button class="btn secondary sm" onclick="questionModal(${q.id})">Modifica</button>${['listen_mcq','spell'].includes(q.type)?`<button class="btn secondary sm" onclick="audioModal(${q.id})">🎙 Audio</button>`:''}${q.active===false?`<button class="btn success sm" onclick="activateQuestion(${q.id})">Attiva</button>`:`<button class="btn secondary sm" onclick="changeSingleQuestion(${q.id},false)">Disattiva</button>`}<button class="btn secondary sm" onclick="duplicateQuestion(${q.id})">Duplica</button><button class="btn danger sm" onclick="deleteQuestion(${q.id})">Elimina</button></div></td></tr>`).join('');
  app.innerHTML=teacherShell(`${teacherHeader('Banca domande',`${d.meta.total} attive · ${d.meta.inactive||0} inattive · ${d.meta.all||0} totali`,'<div class="row wrap"><button class="btn secondary" onclick="openAudioQueue()">🎙 Registra audio in serie</button><button class="btn secondary" onclick="importContentModal()">✨ Importa / IA</button><button class="btn primary" onclick="questionModal()">+ NUOVA DOMANDA</button></div>')}
  <div class="toolbar"><input id="qSearch" class="input" placeholder="Cerca testo…" value="${esc(questionFilters.q)}"><select id="qTopic" class="select"><option value="">Tutti gli argomenti</option>${d.meta.topics.map(x=>`<option value="${esc(x)}" ${x===questionFilters.topic?'selected':''}>${esc(x)}</option>`).join('')}</select><select id="qType" class="select"><option value="">Tutti i tipi</option>${['swipe','mcq','fill','error','match','listen_mcq','spell'].map(t=>`<option value="${t}" ${t===questionFilters.type?'selected':''}>${esc(gameLabel(t))}</option>`).join('')}</select><select id="qStatus" class="select" aria-label="Stato domanda"><option value="">Attive e inattive</option><option value="active" ${questionFilters.status==='active'?'selected':''}>Solo attive</option><option value="inactive" ${questionFilters.status==='inactive'?'selected':''}>Solo inattive</option></select><button class="btn secondary" onclick="filterQuestions()">Filtra</button></div>
  <div class="row wrap selection-toolbar"><label class="row"><input id="selectVisibleQuestions" type="checkbox" onchange="selectVisibleQuestions(this.checked)"> Seleziona tutte le domande visibili</label><span class="muted small" id="selectedQuestionCount">${selectedQuestionIds.size} selezionate</span><button class="btn success sm batch-action" onclick="batchQuestionStatus(true)" disabled>✓ Attiva selezionate</button><button class="btn secondary sm batch-action" onclick="batchQuestionStatus(false)" disabled>⏸ Disattiva selezionate</button></div>
  <div class="table-card card"><table class="table"><thead><tr><th>✓</th><th>Tipo / Stato</th><th>Domanda</th><th>Argomento</th><th>Vocabolario</th><th>Livello</th><th>Azioni</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Nessuna domanda con questi filtri.</td></tr>'}</tbody></table></div><p class="tiny muted" style="margin-top:10px">Per sicurezza la selezione si applica solo alle righe caricate (massimo 500 per filtro). Attivando una domanda audio è obbligatorio aver prima registrato l’audio.</p>`,'questions');
  updateQuestionSelection();
}
async function filterQuestions(){
  questionFilters.q=$('#qSearch').value;questionFilters.topic=$('#qTopic').value;questionFilters.type=$('#qType').value;questionFilters.status=$('#qStatus').value;
  selectedQuestionIds.clear();try{await refreshQuestionBank()}catch(e){toast(e.message,'error')}
}
async function changeSingleQuestion(id,active){
  selectedQuestionIds.clear();selectedQuestionIds.add(id);await batchQuestionStatus(active);
}

function questionModal(id=null){
  const q=id?(state.teacherData.questions||[]).find(x=>x.id===id):null;
  openModal(`<div class="modal-head"><div><div class="eyebrow">Question editor</div><h2>${q?'Modifica domanda':'Nuova domanda'}</h2></div><button class="close" onclick="closeModal()">×</button></div><form id="questionForm" class="stack"><div class="modal-grid"><div class="field"><label>Tipo di gioco</label><select class="select" name="type" id="qfType"><option value="swipe">Swipe correct / incorrect</option><option value="mcq">Scelta multipla</option><option value="fill">Completa la frase</option><option value="error">Trova l'errore</option><option value="match">Abbina coppie / Memory</option><option value="listen_mcq">🎧 Ascolta e scegli (registra audio)</option><option value="spell">🎧 Dettato (registra audio)</option></select></div><div class="field"><label>Difficoltà</label><select class="select" name="difficulty"><option>easy</option><option>medium</option><option>hard</option></select></div><div class="field full"><label>Domanda / frase</label><textarea class="textarea" name="prompt" required>${esc(q?.prompt||'')}</textarea></div><div class="field"><label>Argomento</label><input class="input" name="topic" value="${esc(q?.topic||'Present Simple')}" required></div><div class="field"><label>Vocabolario opzionale</label><input class="input" name="vocabulary" value="${esc(q?.vocabulary||'')}"></div><div class="field full" id="payloadEditor"></div><div class="field full" id="audioScriptEditor"><label>Testo da leggere ad alta voce (solo Listening e Dettato)</label><textarea class="textarea" name="audio_script" placeholder="Es. The elephant is very big">${esc(q?.audio_script||'')}</textarea><div class="tiny muted">Visibile solo alla docente durante la registrazione; non compare agli alunni.</div></div><div class="field full"><label>Spiegazione mostrata in Practice Mode</label><textarea class="textarea" name="explanation">${esc(q?.explanation||'')}</textarea></div><div class="field full"><label>Correzione (opzionale)</label><input class="input" name="correction" value="${esc(q?.correction||'')}"></div><div class="field full"><label>Tag separati da virgola</label><input class="input" name="tags" value="${esc((q?.tags||[]).join(', '))}"></div></div><button class="btn primary">SALVA DOMANDA</button></form>`,true);
  const f=$('#questionForm');f.type.value=q?.type||'swipe';f.difficulty.value=q?.difficulty||'easy';renderPayloadEditor(q);$('#qfType').onchange=()=>renderPayloadEditor(null);
  f.onsubmit=async e=>{e.preventDefault();const fd=new FormData(f);const type=fd.get('type');let payload={};try{
    if(type==='swipe') payload={correct:fd.get('swipe_correct')==='true'};
    if(type==='mcq'||type==='listen_mcq'){const opts=fd.get('options').split('\n').map(x=>x.trim()).filter(Boolean);const c=Number(fd.get('correct_index'))-1;if(opts.length<2||c<0||c>=opts.length)throw new Error('Inserisci almeno 2 opzioni e un indice corretto valido.');payload={options:opts,correct:c}}
    if(type==='fill'||type==='spell'){const ans=fd.get('answers').split(',').map(x=>x.trim()).filter(Boolean);if(!ans.length)throw new Error('Inserisci almeno una risposta accettata.');payload={answers:ans}}
    if(type==='error'){const chunks=fd.get('chunks').split('|').map(x=>x.trim()).filter(Boolean);const c=Number(fd.get('wrong_index'))-1;if(chunks.length<2||c<0||c>=chunks.length)throw new Error('Dividi la frase in parti con | e indica la parte errata.');payload={chunks,correct:c}}
    if(type==='match'){const pairs=fd.get('pairs').split('\n').map(x=>x.split('=').map(y=>y.trim())).filter(x=>x.length===2&&x[0]&&x[1]).map(([left,right])=>({left,right}));if(pairs.length<2)throw new Error('Inserisci almeno due coppie nel formato parola = risposta.');payload={pairs}}
    const obj={type,prompt:fd.get('prompt'),topic:fd.get('topic'),vocabulary:fd.get('vocabulary'),difficulty:fd.get('difficulty'),explanation:fd.get('explanation'),correction:fd.get('correction'),audio_script:fd.get('audio_script'),tags:fd.get('tags').split(',').map(x=>x.trim()).filter(Boolean),payload};
    await api(id?`/api/teacher/questions/${id}`:'/api/teacher/questions',{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal();toast('Domanda salvata');renderTeacher('questions')
  }catch(err){toast(err.message,'error')}}
}
function renderPayloadEditor(q){
  const t=$('#qfType').value,p=q?.type===t?q.payload:{};let html='';
  if(t==='swipe')html=`<label>Risposta corretta</label><select class="select" name="swipe_correct"><option value="true" ${p?.correct===true?'selected':''}>La frase è corretta</option><option value="false" ${p?.correct===false?'selected':''}>La frase è scorretta</option></select>`;
  if(t==='mcq'||t==='listen_mcq')html=`<label>Opzioni — una per riga</label><textarea class="textarea" name="options">${esc((p?.options||['Option 1','Option 2']).join('\n'))}</textarea><label>Numero dell'opzione corretta (1, 2, 3…)</label><input class="input" name="correct_index" type="number" min="1" value="${Number(p?.correct??0)+1}">`;
  if(t==='fill'||t==='spell')html=`<label>Risposte accettate — separate da virgola</label><input class="input" name="answers" value="${esc((p?.answers||[]).join(', '))}">`;
  if(t==='error')html=`<label>Dividi la frase in parti con |</label><input class="input" name="chunks" value="${esc((p?.chunks||[]).join(' | '))}"><label>Numero della parte errata</label><input class="input" type="number" min="1" name="wrong_index" value="${Number(p?.correct??0)+1}">`;
  if(t==='match')html=`<label>Coppie — una per riga, formato sinistra = destra</label><textarea class="textarea" name="pairs">${esc((p?.pairs||[]).map(x=>Array.isArray(x)?x.join(' = '):`${x.left} = ${x.right}`).join('\n'))}</textarea>`;
  $('#payloadEditor').innerHTML=html;const script=$('#audioScriptEditor');if(script)script.style.display=['listen_mcq','spell'].includes(t)?'block':'none';
}
async function duplicateQuestion(id){try{await api(`/api/teacher/questions/${id}/duplicate`,{method:'POST',body:'{}'});toast('Domanda duplicata');renderTeacher('questions')}catch(e){toast(e.message,'error')}}
async function deleteQuestion(id){if(!confirm('Eliminare questa domanda? Se esiste nello storico verrà disattivata senza perdere i risultati passati.'))return;try{await api(`/api/teacher/questions/${id}`,{method:'DELETE'});toast('Domanda rimossa');renderTeacher('questions')}catch(e){toast(e.message,'error')}}

// Local file preview; the protected API validates again before Firestore writes.
let bulkPending=null;
function importContentModal(){
  bulkPending=null;
  const games=Object.entries(EGLTeacherPrompt.GAMES).map(([k,v])=>`<label class="teacher-check"><input name="teacherGame" type="checkbox" value="${k}" ${['swipe','mcq','fill','match'].includes(k)?'checked':''} onchange="updateGiPrompt()"> ${esc(v[0])}</label>`).join('');
  openModal(`<div class="modal-head"><div><div class="eyebrow">Importazione massiva · V8</div><h2>Domande e attività</h2></div><button class="close" onclick="closeModal()">×</button></div><div class="stack">
    <div class="login-note" style="margin:0"><b>Gi, ora bastano due copia-incolla!</b> Genera un prompt con il modello TXT già incluso, invialo a ChatGPT o Gemini, poi incolla qui sotto la risposta. Nessun file necessario.</div>
    <details class="bulk-help teacher-panel" id="teacherBuilder"><summary>✨ 1 · Crea un prompt completo per l'IA</summary><div class="stack" style="padding-top:15px">
      <div class="field"><label for="teacherTopic">Argomento *</label><input class="input" id="teacherTopic" maxlength="120" value="Present Perfect" placeholder="Es. Food, Comparatives..." oninput="updateGiPrompt()"></div>
      <div class="teacher-grid"><div class="field"><label for="teacherClass">Classe</label><select class="select" id="teacherClass" onchange="updateGiPrompt()"><option>1ª media</option><option selected>2ª media</option><option>3ª media</option></select></div><div class="field"><label for="teacherLevel">Livello</label><select class="select" id="teacherLevel" onchange="updateGiPrompt()"><option>A1</option><option selected>A1–A2</option><option>A2</option></select></div><div class="field"><label for="teacherDifficulty">Difficoltà</label><select class="select" id="teacherDifficulty" onchange="updateGiPrompt()"><option selected>facile</option><option>medio</option><option>difficile</option></select></div><div class="field"><label for="teacherCount">Domande (max 120)</label><input class="input" type="number" id="teacherCount" min="5" max="120" step="1" value="20" oninput="updateGiPrompt()"></div></div>
      <div class="field"><label for="teacherGoals">Obiettivo (facoltativo)</label><textarea class="textarea" id="teacherGoals" rows="2" maxlength="400" placeholder="Es. Lessico sportivo, frasi semplici..." oninput="updateGiPrompt()"></textarea></div>
      <div class="field"><label>Seleziona i giochi</label><div class="teacher-grid">${games}</div></div>
      <label class="teacher-check"><input type="checkbox" id="teacherActivities" checked onchange="updateGiPrompt()"> Genera anche attività non pubblicate</label>
      <div class="field"><label for="teacherGeneratedPrompt">Prompt con modello V8 incorporato</label><textarea class="textarea teacher-mono" rows="7" id="teacherGeneratedPrompt" readonly></textarea><span class="tiny muted">Il modello originale è già nel prompt: non devi allegarlo.</span></div>
      <div class="row wrap"><button class="btn primary" id="teacherCopy" onclick="copyGiPrompt()">📋 Copia il prompt completo</button><span class="tiny muted" id="teacherPromptMessage" role="status"></span></div>
    </div></details>
    <div class="field"><label for="bulkPaste"><b>2 · Incolla qui la risposta dell'IA</b></label><textarea class="textarea teacher-mono teacher-paste" id="bulkPaste" rows="9" placeholder="ARGOMENTO: Present Perfect&#10;DIFFICOLTÀ: facile&#10;&#10;GIOCO: Vero o falso&#10;DOMANDA: She has finished her homework.&#10;RISPOSTA: vero&#10;---" oninput="invalidateBulkPreview()"></textarea><span class="tiny muted">Se l'IA mette l'intero testo tra tre backtick, li eliminiamo automaticamente.</span></div>
    <button class="btn primary" onclick="previewBulkText()">🔎 3 · Verifica e mostra anteprima</button>
    <details class="bulk-help"><summary>📁 Oppure importa un file TXT, JSON o CSV (facoltativo)</summary><div class="stack" style="padding-top:12px"><div class="field"><label for="bulkFile">Seleziona il file</label><input class="input" id="bulkFile" type="file" accept=".txt,.json,.csv,text/plain,application/json,text/csv" onchange="invalidateBulkPreview()"></div><button class="btn secondary" onclick="previewBulkFile()">Verifica file</button><div class="row wrap"><a class="btn secondary sm" href="/modelli/LEZIONE_COMPLETA_V8.txt" download>Modello TXT</a><a class="btn secondary sm" href="/modelli/DOMANDE_EXCEL_CSV.csv" download>Modello CSV</a></div></div></details>
    <div id="bulkPreview" class="bulk-preview muted small" aria-live="polite">Nessun contenuto verificato.</div>
    <div class="tiny muted">L'importazione mantiene le domande inattive e le attività non pubblicate. Il docente controllerà le risposte e registrerà manualmente eventuali audio.</div>
  </div>`,true);
  updateGiPrompt();
}
function updateGiPrompt(){
  const field=$('#teacherGeneratedPrompt'),copy=$('#teacherCopy'),error=$('#teacherPromptMessage');if(!field)return;
  try{
    field.value=EGLTeacherPrompt.buildPrompt({topic:$('#teacherTopic').value,schoolClass:$('#teacherClass').value,level:$('#teacherLevel').value,difficulty:$('#teacherDifficulty').value,count:Number($('#teacherCount').value),goals:$('#teacherGoals').value,games:$$('input[name="teacherGame"]:checked').map(x=>x.value),activities:$('#teacherActivities').checked});
    copy.disabled=false;error.textContent='';
  }catch(e){field.value='';copy.disabled=true;error.textContent=e.message}
}
async function copyGiPrompt(){
  const el=$('#teacherGeneratedPrompt');if(!el?.value)return;
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(el.value);
    else {el.focus();el.select();if(!document.execCommand('copy'))throw Error('Copia non supportata');}
    toast('Prompt copiato! Incollalo nell’IA.');
  }catch(e){el.focus();el.select();toast('Usa Ctrl+C per copiare il prompt selezionato.','error')}
}
function invalidateBulkPreview(){
  bulkPending=null;
  const el=$('#bulkPreview');if(el)el.textContent='Contenuto modificato. Premi Verifica prima di importare.';
}
function showBulkPreview(raw){
  const out=EGLBulk.normalize(raw),container=$('#bulkPreview');bulkPending=out.errors.length?null:{raw,out};
  container.innerHTML=`<div class="row wrap"><span class="pill">${out.questions.length} domande valide</span><span class="pill">${out.activities.length} attività valide</span><span class="pill">${out.errors.length} errori</span></div>${out.errors.length?`<div class="bulk-errors">${out.errors.slice(0,15).map(x=>`<p>${esc(x)}</p>`).join('')}</div>`:''}${out.warnings.length?`<div class="muted tiny">${out.warnings.slice(0,10).map(esc).join('<br>')}</div>`:''}<div class="bulk-list">${out.questions.slice(0,8).map(q=>`<div class="bulk-item"><strong>${esc(q.type.toUpperCase())}</strong> · ${esc(q.topic)} — ${esc(q.prompt)}</div>`).join('')}${out.questions.length>8?`<div class="muted tiny">E altre ${out.questions.length-8} domande…</div>`:''}${out.activities.map(a=>`<div class="bulk-item"><strong>ATTIVITÀ</strong> · ${esc(a.title)}</div>`).join('')}</div>${bulkPending?'<button class="btn primary" id="confirmBulk" onclick="commitBulkImport()">Conferma importazione come bozze</button>':'<p>Correggi gli errori prima di importare.</p>'}`;
}
function previewBulkText(){
  bulkPending=null;
  const container=$('#bulkPreview'),text=EGLTeacherPrompt.cleanPastedText($('#bulkPaste')?.value);
  if(!text)return toast('Incolla prima il testo generato dall’IA.','error');
  if(new Blob([text]).size>900000)return toast('Testo troppo grande: massimo 900 KB.','error');
  try{showBulkPreview(EGLBulk.parseTeacherText(text))}
  catch(e){container.textContent=e.message;toast(e.message,'error')}
}
async function previewBulkFile(){
  bulkPending=null;
  const file=$('#bulkFile')?.files?.[0],container=$('#bulkPreview');if(!file)return toast('Seleziona un file.','error');
  if(file.size>900000)return toast('File troppo grande: massimo 900 KB.','error');
  try{
    const rawText=await file.text();let raw;
    if(/\.csv$/i.test(file.name))raw=EGLBulk.parseCSV(rawText);
    else if(/\.json$/i.test(file.name))raw=JSON.parse(rawText.replace(/^\uFEFF/,''));
    else if(/\.txt$/i.test(file.name))raw=EGLBulk.parseTeacherText(rawText);
    else throw new Error('Usa un file TXT, JSON o CSV.');
    showBulkPreview(raw);
  }catch(e){bulkPending=null;container.textContent=e.message;toast(e.message,'error')}
}
async function commitBulkImport(){
  if(!bulkPending)return;const btn=$('#confirmBulk');if(btn)btn.disabled=true;
  if(!confirm('Importare le domande come INATTIVE e le attività come NON PUBBLICATE?')){if(btn)btn.disabled=false;return}
  try{
    const r=await api('/api/teacher/import-content',{method:'POST',body:JSON.stringify(bulkPending.raw)});
    bulkPending=null;state.lastBulkIds=r.question_ids||[];
    openModal(`<div class="modal-head"><h2>Importazione completata</h2><button class="close" onclick="closeModal();renderTeacher('questions')">×</button></div><div class="stack"><p><strong>${r.questions_added}</strong> nuove domande inattive, <strong>${r.activities_added}</strong> attività non pubblicate.</p><p class="muted small">${r.skipped} domande e ${r.skipped_activities} attività già presenti saltate. Controlla le risposte prima di attivare: le domande attive possono comparire anche nei giochi esistenti con filtri compatibili.</p>${state.lastBulkIds.length?'<button class="btn success" onclick="activateLastBulk()">Attiva tutte le domande appena importate</button>':''}<button class="btn secondary" onclick="closeModal();renderTeacher('questions')">Mantieni in bozza e chiudi</button></div>`);
  }catch(e){toast(e.message,'error');if(btn)btn.disabled=false}
}
async function activateLastBulk(){
  const ids=state.lastBulkIds||[];if(!ids.length)return;
  if(!confirm(`Attivare ${ids.length} domande? Potrebbero essere usate nei giochi già pubblicati.`))return;
  try{await api('/api/teacher/questions/activate-import',{method:'POST',body:JSON.stringify({ids})});state.lastBulkIds=[];closeModal();toast('Domande attivate');renderTeacher('questions')}catch(e){toast(e.message,'error')}
}

let activeRecorder=null,recordStream=null,audioCandidate=null;
let audioQueueIds=[],audioQueuePosition=0;
async function openAudioQueue(){
  try{
    const d=await api('/api/teacher/questions?status=inactive');
    // The audio recorder is intended first for new inactive questions without a clip.
    audioQueueIds=d.questions.filter(q=>['listen_mcq','spell'].includes(q.type)&&!q.has_audio).map(q=>q.id);
    if(!audioQueueIds.length)return toast('Non ci sono domande audio inattive senza registrazione.','ok');
    state.teacherData.questions=[...new Map([...(state.teacherData.questions||[]),...d.questions].map(q=>[q.id,q])).values()];
    audioQueuePosition=0;audioModal(audioQueueIds[0],true);
  }catch(e){toast(e.message,'error')}
}
function discardCurrentRecording(){
  if(activeRecorder?.state==='recording'){activeRecorder.onstop=null;activeRecorder.ondataavailable=null;activeRecorder.stop()}
  recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;activeRecorder=null;audioCandidate=null;
  const a=$('#teacherAudioPreview');if(a?.dataset.url)URL.revokeObjectURL(a.dataset.url);
}
function skipQueueAudio(){
  discardCurrentRecording();
  audioQueuePosition++;if(audioQueuePosition>=audioQueueIds.length){audioQueueIds=[];closeAudioModal();toast('Coda registrazioni completata.');return renderTeacher('questions')}
  audioModal(audioQueueIds[audioQueuePosition],true);
}
function audioModal(id,inQueue=false){
  discardCurrentRecording();
  const q=(state.teacherData.questions||[]).find(x=>x.id===id);if(!q)return;
  audioCandidate=null;
  const readText=q.audio_script||(q.type==='spell'?q.payload?.answers?.[0]:q.prompt)||q.prompt;
  openModal(`<div class="modal-head"><div><div class="eyebrow">🎙 Registrazione docente ${inQueue?`· ${audioQueuePosition+1} di ${audioQueueIds.length}`:''}</div><h2>${esc(q.prompt)}</h2></div><button class="close" onclick="closeAudioModal()">×</button></div>
  <div class="stack"><div class="record-script"><span class="eyebrow">Testo da pronunciare</span><div class="record-script-text">${esc(readText)}</div><div class="tiny muted">Questo testo non viene mostrato allo studente. Leggilo ad alta voce durante la registrazione.</div></div>
  <div class="field"><label>Modifica il testo da leggere</label><textarea class="textarea" id="audioScriptValue" rows="2">${esc(q.audio_script||readText)}</textarea><button class="btn secondary sm" onclick="saveAudioScript(${id})">Salva testo di lettura</button></div>
  <p class="muted small">Registra una frase o una parola (max 15 secondi), ascoltala e conferma. Max 300 KB; compressione a 32 kbps se supportata dal browser.</p>
  <div class="row wrap"><button class="btn primary" id="recStart" onclick="startAudioRecording()">● Registra</button><button class="btn secondary" id="recStop" onclick="stopAudioRecording()" disabled>■ Ferma</button></div>
  <p id="audioStatus" class="muted small">Pronta per registrare.</p><audio id="teacherAudioPreview" controls style="width:100%"></audio>
  <div class="field"><label>Oppure scegli un file audio già pronto (WebM, MP4, OGG o MP3, max 300 KB)</label><input id="audioPick" type="file" accept=".webm,.m4a,.mp4,.ogg,.mp3,audio/*" class="input"></div>
  <div class="row wrap"><button class="btn success" onclick="uploadQuestionAudio(${id},${inQueue})">Salva audio privato ${inQueue?'e passa alla successiva':''}</button>${inQueue?'<button class="btn secondary" onclick="skipQueueAudio()">Salta questa →</button>':''}</div>
  ${q.has_audio?'<p class="muted small">Questa domanda ha già un audio. Il nuovo caricamento lo sostituirà.</p>':''}
  </div>`,true);
  $('#audioPick').onchange=e=>{audioCandidate=e.target.files?.[0]||null;showTeacherAudioPreview(audioCandidate)};
}
async function saveAudioScript(id){
  const value=$('#audioScriptValue')?.value||'';
  try{
    await api(`/api/teacher/questions/${id}/audio-script`,{method:'PUT',body:JSON.stringify({audio_script:value})});
    const q=(state.teacherData.questions||[]).find(x=>x.id===id);if(q)q.audio_script=value;
    const shown=$('.record-script-text');if(shown)shown.textContent=value;
    toast('Testo di lettura salvato.');
  }catch(e){toast(e.message,'error')}
}
function closeAudioModal(){audioQueueIds=[];audioQueuePosition=0;discardCurrentRecording();closeModal();}
function showTeacherAudioPreview(blob){const a=$('#teacherAudioPreview');if(!a||!blob)return;if(a.dataset.url)URL.revokeObjectURL(a.dataset.url);a.dataset.url=URL.createObjectURL(blob);a.src=a.dataset.url;}
async function startAudioRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('Registrazione non supportata da questo browser. Puoi caricare un file.','error');
  try{
    recordStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
    const type=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg'].find(x=>MediaRecorder.isTypeSupported(x));
    activeRecorder=new MediaRecorder(recordStream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:32000});
    const chunks=[];activeRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    activeRecorder.onstop=()=>{recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;const mime=activeRecorder.mimeType.split(';')[0];audioCandidate=new Blob(chunks,{type:mime});showTeacherAudioPreview(audioCandidate);const st=$('#audioStatus');if(st)st.textContent='Registrazione pronta: '+Math.round(audioCandidate.size/1024)+' KB';};
    activeRecorder.start();$('#recStart').disabled=true;$('#recStop').disabled=false;$('#audioStatus').textContent='Registrazione in corso… (max 15 secondi)';
    setTimeout(()=>{if(activeRecorder?.state==='recording')stopAudioRecording()},15000);
  }catch(e){recordStream?.getTracks().forEach(t=>t.stop());toast('Microfono non disponibile: controlla i permessi.','error')}
}
function stopAudioRecording(){if(activeRecorder?.state==='recording')activeRecorder.stop();if($('#recStart'))$('#recStart').disabled=false;if($('#recStop'))$('#recStop').disabled=true;}
async function uploadQuestionAudio(id,inQueue=false){
  const blob=audioCandidate;if(!blob)return toast('Registra o seleziona un audio.','error');
  const mime=(blob.type||'').split(';')[0].toLowerCase();if(blob.size>300000||blob.size<100)return toast('Audio troppo grande o vuoto (max 300 KB).','error');
  if(!['audio/webm','audio/mp4','audio/ogg','audio/mpeg'].includes(mime))return toast('Formato non supportato: usa WebM, MP4, OGG o MP3.','error');
  try{const token=await window.eglAuth.currentUser.getIdToken(),res=await fetch(`/api/teacher/questions/${id}/audio`,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':mime},body:blob});
    if(!res.ok){const x=await res.json().catch(()=>({}));throw new Error(x.error||'Errore caricamento audio')}
    if(inQueue){const q=(state.teacherData.questions||[]).find(x=>x.id===id);if(q)q.has_audio=true;toast('Audio salvato; domanda ancora inattiva.');skipQueueAudio();}else{closeAudioModal();toast('Audio salvato. Ora puoi attivare la domanda.');renderTeacher('questions');}
  }catch(e){toast(e.message,'error')}
}

async function activateQuestion(id){
  if(!confirm('Attivare questa domanda? Potrebbe apparire nei giochi pubblicati.'))return;
  try{await api(`/api/teacher/questions/${id}/activate`,{method:'POST',body:'{}'});toast('Domanda attivata');renderTeacher('questions')}catch(e){toast(e.message,'error')}
}

function renderActivities(d){
  state.teacherData.activities=d.activities;state.teacherData.activityClasses=d.classes;
  const cards=d.activities.map(a=>`<article class="activity-card card"><div class="row between"><div class="activity-icon">${esc(a.icon)}</div><span class="pill ${a.mode}">${a.mode}</span></div><h3>${esc(a.title)}</h3><p>${esc(a.subtitle||'')}</p><div class="row wrap" style="margin-top:12px"><span class="pill">${esc(gameLabel(a.game_type))}</span>${a.topic_filter?`<span class="pill">${esc(a.topic_filter)}</span>`:''}<span class="pill">${a.question_count} Q</span>${a.time_limit?`<span class="pill">⏱ ${a.time_limit}s</span>`:''}</div><div class="bottom"><span class="small ${a.published?'':'muted'}">${a.published?'🟢 Published':'⚪ Draft'}</span><div class="row"><button class="btn secondary sm" onclick="activityModal(${a.id})">Modifica</button><button class="btn secondary sm" onclick="duplicateActivity(${a.id})">Duplica</button><button class="btn danger sm" onclick="deleteActivity(${a.id})">Elimina</button></div></div></article>`).join('');
  app.innerHTML=teacherShell(`${teacherHeader('Giochi & attività','I motori di gioco sono riutilizzabili: cambia contenuti, filtri e classi senza toccare codice.','<div class="row wrap"><button class="btn secondary" onclick="installDemoV8()">✨ Installa esempi V8 (bozze)</button><button class="btn primary" onclick="activityModal()">+ NUOVA ATTIVITÀ</button></div>')}<div class="activity-grid">${cards}</div>`,'activities')
}
function activityModal(id=null){
  const a=id?(state.teacherData.activities||[]).find(x=>x.id===id):null,classes=state.teacherData.activityClasses||[];
  openModal(`<div class="modal-head"><div><div class="eyebrow">Activity editor</div><h2>${a?'Modifica attività':'Nuova attività'}</h2></div><button class="close" onclick="closeModal()">×</button></div><form id="activityForm" class="stack"><div class="modal-grid">
  <div class="field"><label>Titolo</label><input class="input" name="title" value="${esc(a?.title||'')}" required></div><div class="field"><label>Icona / emoji</label><input class="input" name="icon" value="${esc(a?.icon||'🎯')}"></div><div class="field full"><label>Sottotitolo</label><input class="input" name="subtitle" value="${esc(a?.subtitle||'')}"></div>
  <div class="field"><label>Modalità</label><select class="select" name="mode"><option value="practice">Practice — feedback immediato</option><option value="assignment">Assignment/Test — risultato finale</option></select></div><div class="field"><label>Motore di gioco</label><select class="select" name="game_type"><option value="mixed">Mixed</option><option value="swipe">Swipe</option><option value="mcq">Scelta multipla</option><option value="fill">Completa</option><option value="error">Trova errore</option><option value="match">Matching</option><option value="memory">🧠 Memory</option><option value="quick_tap">👆 Quick Tap (usa MCQ)</option><option value="word_order">🧩 Word Order (usa frasi Complete)</option><option value="listen_mcq">🎧 Ascolta e scegli</option><option value="spell">🎧 Dettato</option></select></div>
  <div class="field"><label>Filtro argomento (vuoto = tutti)</label><input class="input" name="topic_filter" value="${esc(a?.topic_filter||'')}"></div><div class="field"><label>Filtro vocabolario</label><input class="input" name="vocabulary_filter" value="${esc(a?.vocabulary_filter||'')}"></div><div class="field"><label>Difficoltà</label><select class="select" name="difficulty_filter"><option value="">Tutte</option><option>easy</option><option>medium</option><option>hard</option></select></div><div class="field"><label>Numero domande</label><input class="input" type="number" min="1" max="50" name="question_count" value="${a?.question_count||10}"></div><div class="field"><label>Memory: secondi per sessione (5-120; default 20)</label><input class="input" type="number" min="5" max="120" name="memory_round_seconds" value="${a?.memory_round_seconds||20}"></div><div class="field"><label>Timer per domanda (0 = off)</label><input class="input" type="number" min="0" max="120" name="time_limit" value="${a?.time_limit||0}"></div><div class="field"><label>Tentativi consentiti (0 = illimitati)</label><input class="input" type="number" min="0" max="20" name="attempts_allowed" value="${a?.attempts_allowed||0}"></div>
  <div class="field full"><label class="row"><input type="checkbox" name="time_attack" ${a?.time_attack?'checked':''}> ⚡ Time Attack (solo Practice: +4s corretta, −6s errata; timer iniziale nel campo precedente)</label></div><div class="field full"><label class="row"><input type="checkbox" name="published" ${a?.published===true?'checked':''}> Pubblicata e visibile agli studenti</label><label class="row"><input id="scopeAll" type="checkbox" name="scope_all" ${(!a||a.scope_all!==false)?'checked':''}> Disponibile a tutte le classi</label></div>
  <div class="field full" id="classChooser"><label>Classi assegnate</label><div class="row wrap">${classes.length?classes.map(c=>`<label class="pill"><input type="checkbox" name="class_ids" value="${c.id}" ${(a?.class_ids||[]).includes(c.id)?'checked':''}> ${esc(c.name)}</label>`).join(''):'<span class="muted small">Crea prima almeno una classe se vuoi assegnare l’attività solo a gruppi specifici.</span>'}</div></div>
  </div><button class="btn primary">SALVA ATTIVITÀ</button></form>`,true);
  const f=$('#activityForm');f.mode.value=a?.mode||'practice';f.game_type.value=a?.game_type||'mixed';f.difficulty_filter.value=a?.difficulty_filter||'';$('#scopeAll').onchange=()=>$('#classChooser').style.opacity=$('#scopeAll').checked?.45:1;$('#scopeAll').onchange();
  f.onsubmit=async e=>{e.preventDefault();const fd=new FormData(f);const obj=Object.fromEntries(fd);obj.published=fd.get('published')==='on';obj.time_attack=fd.get('time_attack')==='on';obj.scope_all=fd.get('scope_all')==='on';obj.class_ids=fd.getAll('class_ids').map(Number);obj.question_count=Number(obj.question_count);obj.memory_round_seconds=Number(obj.memory_round_seconds);obj.time_limit=Number(obj.time_limit);obj.attempts_allowed=Number(obj.attempts_allowed);try{await api(id?`/api/teacher/activities/${id}`:'/api/teacher/activities',{method:id?'PUT':'POST',body:JSON.stringify(obj)});closeModal();toast('Attività salvata');renderTeacher('activities')}catch(err){toast(err.message,'error')}}
}
async function installDemoV8(){
  if(!confirm('Creare domande ed attività dimostrative V8, tutte come bozze NON visibili agli alunni? Questa operazione non modifica le classi o i risultati esistenti.'))return;
  try{const d=await api('/api/teacher/demo-v8/install',{method:'POST',body:'{}'});toast(d.already_present?'Gli esempi V8 sono già presenti.':`Create ${d.questions_added} domande e ${d.activities_added} attività demo come bozze.`);renderTeacher('activities')}catch(e){toast(e.message,'error')}
}
async function duplicateActivity(id){try{await api(`/api/teacher/activities/${id}/duplicate`,{method:'POST',body:'{}'});toast('Attività duplicata come bozza');renderTeacher('activities')}catch(e){toast(e.message,'error')}}
async function deleteActivity(id){if(!confirm('Rimuovere questa attività? Se esistono risultati passati verrà solo nascosta agli studenti.'))return;try{await api(`/api/teacher/activities/${id}`,{method:'DELETE'});toast('Attività rimossa');renderTeacher('activities')}catch(e){toast(e.message,'error')}}

async function loadResults(cid=0){state.resultsClass=cid;try{const d=await api(`/api/teacher/results?class_id=${cid}`);renderResults(d)}catch(e){toast(e.message,'error')}}
function renderResults(d){
  const rows=d.students.map(s=>`<tr class="clickable" onclick="studentResult(${s.id})"><td><span class="code">${esc(s.code)}</span></td><td>${esc(s.real_name||'—')}</td><td>${esc(s.class_name||'—')}</td><td>${s.sessions}</td><td><strong>${s.avg_score==null?'—':pct(s.avg_score)}</strong></td><td>${s.xp} XP</td><td>${fmtDate(s.last_activity)}</td></tr>`).join('');
  const select=`<select class="select" onchange="loadResults(Number(this.value))"><option value="0">Tutte le classi</option>${d.classes.map(c=>`<option value="${c.id}" ${state.resultsClass===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`;
  app.innerHTML=teacherShell(`${teacherHeader('Risultati','Clicca uno studente per vedere andamento, errori ricorrenti e cronologia.')}<div class="toolbar">${select}</div><div class="table-card card"><table class="table"><thead><tr><th>Codice</th><th>Nome reale</th><th>Classe</th><th>Sessioni</th><th>Media</th><th>XP</th><th>Ultima attività</th></tr></thead><tbody>${rows||'<tr><td colspan="7"><div class="empty">Nessuno studente in questa vista.</div></td></tr>'}</tbody></table></div>`,'results')
}
async function studentResult(id){try{const d=await api(`/api/teacher/students/${id}/results`);const topic=d.topics.length?d.topics.map(x=>`<div class="progress-row"><strong>${esc(x.topic)}</strong><div class="bar"><span style="width:${x.score}%"></span></div><span class="right strong">${pct(x.score)}</span></div>`).join(''):'<div class="empty">Nessuna risposta ancora.</div>';const attempts=d.attempts.map(a=>`<div class="list-row"><div><strong>${esc(a.icon)} ${esc(a.title)}</strong><div class="tiny muted">${esc(a.mode)}</div></div><div class="muted small">${fmtDate(a.started_at)}</div><div class="right strong">${pct(a.score)}</div></div>`).join('');const errors=d.errors.length?d.errors.map(e=>`<div style="padding:12px 0;border-bottom:1px solid var(--line)"><strong>${esc(e.prompt)}</strong><div class="tiny muted">${esc(e.topic)} · sbagliata ${e.times} volt${e.times===1?'a':'e'}</div><div class="small">${esc(e.explanation)}</div></div>`).join(''):'<div class="empty">Nessun errore registrato 🎉</div>';
  openModal(`<div class="modal-head"><div><div class="eyebrow">${esc(d.student.class_name||'')}</div><h2>${esc(d.student.real_name||d.student.code)} <span class="code">${esc(d.student.code)}</span></h2></div><button class="close" onclick="closeModal()">×</button></div><div class="stats-grid" style="grid-template-columns:repeat(3,1fr)"><div class="stat-card card"><div class="value">${d.student.xp}</div><div class="label">XP</div></div><div class="stat-card card"><div class="value">🔥 ${d.streak}</div><div class="label">streak giorni</div></div><div class="stat-card card"><div class="value">${d.attempts.length}</div><div class="label">sessioni recenti</div></div></div><div class="two-col" style="margin-top:16px"><div class="card pad"><div class="eyebrow">Performance</div>${topic}</div><div class="card pad"><div class="eyebrow">Errori ricorrenti</div>${errors}</div></div><div class="card pad" style="margin-top:16px"><div class="eyebrow">Cronologia</div>${attempts||'<div class="empty">Nessuna sessione.</div>'}</div>`,true)}catch(e){toast(e.message,'error')}}

boot();
