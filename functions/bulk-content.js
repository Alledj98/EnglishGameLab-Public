/* English Game Lab: portable content format v1. No external dependencies.
   Load in browser and require from Cloud Functions. */
(function(root, factory){
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.EGLBulk=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_Q=120,MAX_A=20;
  const allowedTypes=new Set(['swipe','mcq','fill','error','match','listen_mcq','spell']);
  const s=(v,max=300)=>String(v??'').trim().slice(0,max);
  const norm=v=>s(v,1000).toLocaleLowerCase('en').replace(/\s+/g,' ');
  const arr=(v,sep='|')=>Array.isArray(v)?v.map(x=>s(x,250)).filter(Boolean):s(v,4000).split(sep).map(x=>s(x,250)).filter(Boolean);
  const unique=a=>[...new Set(a)];
  // Identical instructions do not imply identical questions: compare their actual
  // solution data too. Keep this logic byte-identical in browser and backend.
  function fingerprint(q){
    const type=norm(q?.type),p=q?.payload||{};
    let content;
    if(type==='match'){
      // The order of Memory cards is not part of the exercise's identity.
      content=(Array.isArray(p.pairs)?p.pairs:[]).map(pair=>JSON.stringify(
        Array.isArray(pair)?[norm(pair[0]),norm(pair[1])]:[norm(pair?.left),norm(pair?.right)]
      )).sort();
    }else if(type==='mcq'||type==='listen_mcq'){
      const options=(Array.isArray(p.options)?p.options:[]).map(norm);
      const ix=Number(p.correct);
      content={options:[...options].sort(),answer:Number.isInteger(ix)&&ix>=0&&ix<options.length?options[ix]:null};
    }else if(type==='fill'||type==='spell'){
      content={answers:(Array.isArray(p.answers)?p.answers:[]).map(norm).sort()};
    }else if(type==='error'){
      content={chunks:(Array.isArray(p.chunks)?p.chunks:[]).map(norm),wrongIndex:p.correct};
    }else if(type==='swipe'){
      content={correct:p.correct};
    }else{
      content=p;
    }
    // Generic listening/dictation prompts can share every visible word; the
    // recorded phrase is an essential part of the question as well.
    const script=(type==='listen_mcq'||type==='spell')?norm(q?.audio_script):null;
    return JSON.stringify([type,norm(q?.topic),norm(q?.prompt),content,script]);
  }
  function reject(message){throw new Error(message)}
  function question(raw){
    if(!raw || typeof raw!=='object'||Array.isArray(raw))reject('La domanda deve essere un oggetto.');
    const type=s(raw.type,30).toLowerCase(), prompt=s(raw.prompt,900),topic=s(raw.topic,120);
    if(type==='swipe'&&raw.correct===undefined)raw={...raw,correct:raw.answer};
    if(!allowedTypes.has(type))reject('Tipo gioco non valido: '+type);
    if(!prompt||!topic)reject('Domanda e argomento sono obbligatori.');
    if(String(raw.prompt||'').length>900||String(raw.topic||'').length>120)reject('Testo troppo lungo.');
    const difficulty=({facile:'easy',medio:'medium',media:'medium',difficile:'hard'})[s(raw.difficulty||'easy',30).toLowerCase()]||s(raw.difficulty||'easy',30).toLowerCase();
    if(!['easy','medium','hard'].includes(difficulty))reject('Difficoltà non valida: '+difficulty);
    const q={type,prompt,topic,difficulty,vocabulary:s(raw.vocabulary,120),explanation:s(raw.explanation,900),correction:s(raw.correction,400),audio_script:s(raw.audio_script,500),tags:unique(arr(raw.tags,',')).slice(0,10),payload:{}};
    if(type==='swipe'){
      const val=raw.correct;
      if(!(typeof val==='boolean'||['true','false','1','0','yes','no','correct','incorrect','vero','falso','giusto','sbagliato'].includes(norm(val))))reject('Swipe: correct deve essere true o false.');
      q.payload={correct:val===true||['true','1','yes','correct','vero','giusto'].includes(norm(val))};
    }
    if(type==='mcq'||type==='listen_mcq'){
      const options=arr(raw.options); if(options.length<2||options.length>6||new Set(options.map(norm)).size!==options.length)reject('Scelta multipla: servono 2–6 opzioni differenti.');
      const answer=s(raw.answer,250);const n=Number(answer);let ix=-1;
      if(answer&&Number.isInteger(n)&&n>=1&&n<=options.length)ix=n-1;
      else ix=options.findIndex(x=>norm(x)===norm(answer));
      if(ix<0)reject('Scelta multipla: answer deve corrispondere a una delle opzioni (o numero 1–6).');
      q.payload={options,correct:ix};
    }
    if(type==='fill'||type==='spell'){
      const answers=unique(arr(raw.answers||raw.answer));if(!answers.length||answers.length>10)reject('Completa: inserire 1–10 risposte accettate.');
      q.payload={answers};
    }
    if(type==='error'){
      const chunks=arr(raw.chunks);if(chunks.length<2||chunks.length>12)reject('Trova errore: servono 2–12 parti della frase.');
      const ix=Number(raw.wrong_index||raw.wrongIndex);if(!Number.isInteger(ix)||ix<1||ix>chunks.length)reject('Trova errore: wrong_index deve essere il numero della parte errata (da 1).');
      q.payload={chunks,correct:ix-1};
    }
    if(type==='match'){
      let pairs=raw.pairs;
      if(typeof pairs==='string')pairs=arr(pairs).map(p=>{const pos=p.indexOf('=');return pos<0?[]:[p.slice(0,pos).trim(),p.slice(pos+1).trim()]});
      if(!Array.isArray(pairs))reject('Abbina: pairs deve essere un elenco.');
      const normalized=pairs.map(p=>Array.isArray(p)?{left:s(p[0],250),right:s(p[1],250)}:{left:s(p?.left,250),right:s(p?.right,250)});
      if(normalized.length<2||normalized.length>10||normalized.some(p=>!p.left||!p.right)||new Set(normalized.map(p=>norm(p.left))).size!==normalized.length||new Set(normalized.map(p=>norm(p.right))).size!==normalized.length)reject('Abbina: servono 2–10 coppie univoche valide.');
      q.payload={pairs:normalized};
    }
    return q;
  }
  function activity(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))reject('Attività non valida.');
    const title=s(raw.title,120),topic_filter=s(raw.topic_filter||raw.topic,120),mode=s(raw.mode||'practice',30),game_type=s(raw.game_type||'mixed',30);
    if(!title)reject('Titolo attività obbligatorio.');
    if(!['practice','assignment'].includes(mode)||!['mixed','memory','word_order','quick_tap',...allowedTypes].includes(game_type))reject('Modalità o tipo gioco non valido.');
    const count=Number(raw.question_count??10),limit=Number(raw.time_limit??0),tries=Number(raw.attempts_allowed??0);
    if(!Number.isInteger(count)||count<1||count>50||!Number.isInteger(limit)||limit<0||limit>120||!Number.isInteger(tries)||tries<0||tries>20||!Number.isInteger(Number(raw.memory_round_seconds||20))||Number(raw.memory_round_seconds||20)<5||Number(raw.memory_round_seconds||20)>120)reject('Conteggio domande, timer o tentativi non validi.');
    return {title,subtitle:s(raw.subtitle,250),icon:s(raw.icon||'🎯',8),mode,game_type,topic_filter,vocabulary_filter:s(raw.vocabulary_filter,120),difficulty_filter:s(raw.difficulty_filter,30),question_count:count,time_limit:limit,attempts_allowed:tries,memory_round_seconds:Number(raw.memory_round_seconds||20),time_attack:raw.time_attack===true||['sì','si','true','1','yes'].includes(norm(raw.time_attack))};
  }
  function normalize(data){
    if(Array.isArray(data))data={version:1,questions:data,activities:[]};
    if(!data||typeof data!=='object'||data.version!==1||!Array.isArray(data.questions)||!(data.activities===undefined||Array.isArray(data.activities)))reject('Formato JSON: atteso {"version":1,"questions":[],"activities":[]}.');
    if(data.questions.length+((data.activities||[]).length)===0)reject('Il file non contiene contenuti.');
    if(data.questions.length>MAX_Q||(data.activities||[]).length>MAX_A)reject(`Limite per importazione: ${MAX_Q} domande e ${MAX_A} attività.`);
    const questions=[],activities=[],seen=new Set(),errors=[],warnings=[];
    data.questions.forEach((q,i)=>{
      try{const x=question(q),key=fingerprint(x);if(seen.has(key)){warnings.push(`Domanda ${i+1}: contenuto identico a un’altra domanda del file, verrà saltata.`);return}seen.add(key);questions.push(x)}
      catch(e){errors.push(`Domanda ${i+1}: ${e.message}`)}
    });
    const atitles=new Set();(data.activities||[]).forEach((a,i)=>{
      try{const x=activity(a),key=norm(x.title);if(atitles.has(key)){warnings.push(`Attività ${i+1}: titolo ripetuto, verrà saltata.`);return}atitles.add(key);activities.push(x)}
      catch(e){errors.push(`Attività ${i+1}: ${e.message}`)}
    });
    return {questions,activities,errors,warnings};
  }
  function parseCSV(text){
    text=String(text||'').replace(/^\uFEFF/,'');
    const first=text.split(/\r?\n/)[0]||'';const delim=first.split(';').length>first.split(',').length?';':',';
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];if(c==='"'){
        if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted;
      }else if(c===delim&&!quoted){row.push(field);field=''}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field=''}
      else field+=c;
    }
    if(quoted)reject('CSV: virgolette non chiuse.');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)reject('CSV: aggiungi intestazioni e almeno una domanda.');
    const headers=rows.shift().map(h=>s(h,100).toLowerCase());
    if(!['type','prompt','topic'].every(x=>headers.includes(x)))reject('CSV: colonne obbligatorie type, prompt, topic.');
    return {version:1,questions:rows.map(cols=>Object.fromEntries(headers.map((h,i)=>[h,cols[i]||'']))),activities:[]};
  }

  // Teacher-friendly format. No JSON/CSV syntax and no nesting required.
  // One question/activity per --- separator; shared headings act as defaults.
  function parseTeacherText(text){
    const lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/);
    const questions=[],activities=[];let context={topic:'',difficulty:'easy'},item={},pairs=[];
    const normKey=k=>s(k,100).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[ _-]/g,'');
    const keyMap={argomento:'topic',topic:'topic',difficolta:'difficulty',difficulty:'difficulty',gioco:'type',tipo:'type',domanda:'prompt',frase:'prompt',testo:'prompt',risposta:'answer',rispostecorrette:'answers',risposte:'answers',opzioni:'options',scelte:'options',spiegazione:'explanation',correzione:'correction',vocabolario:'vocabulary',etichetta:'tags',tags:'tags',coppie:'pairs',parti:'chunks',parole:'chunks',parteerrata:'wrong_index',attivita:'activity_title',titoloattivita:'activity_title',numerodomande:'question_count',timer:'time_limit',modalita:'mode',sfidaatempo:'time_attack',tempoMemory:'memory_round_seconds',tempomemory:'memory_round_seconds',testoaudio:'audio_script',cosaleggere:'audio_script',testodaleggere:'audio_script'};
    const typeMap={'vero o falso':'swipe','corretto o sbagliato':'swipe','swipe':'swipe','scelta multipla':'mcq','quiz':'mcq','mcq':'mcq','completa':'fill','completamento':'fill','trova errore':'error','errore':'error','abbinamenti':'match','abbina':'match','matching':'match','memory':'match','ascolta e scegli':'listen_mcq','ascolta e rispondi':'listen_mcq','listening':'listen_mcq','listen and choose':'listen_mcq','dettato':'spell','scrivi la parola':'spell','spelling':'spell','riordina le parole':'fill','word order':'fill','ordine parole':'fill','tocca veloce':'mcq','quick tap':'mcq'};
    function flush(){
      if(!Object.keys(item).length)return;
      if(item.activity_title){
        activities.push({title:item.activity_title,topic_filter:item.topic||context.topic,mode:(item.mode||'practice').toLowerCase(),game_type:(()=>{const v=String(item.type||'mixed').toLowerCase();return v==='memory'?'memory':['riordina le parole','word order','ordine parole'].includes(v)?'word_order':['tocca veloce','quick tap'].includes(v)?'quick_tap':typeMap[v]||v})(),question_count:Number(item.question_count||10),time_limit:Number(item.time_limit||0),memory_round_seconds:Number(item.memory_round_seconds||20),time_attack:/^(si|sì|true|1|yes)$/i.test(item.time_attack||'')});
      }else if(item.type||item.prompt){
        if(!item.type)throw new Error('Ogni domanda deve avere GIOCO: ...');
        questions.push({...context,...item,type:typeMap[String(item.type).trim().toLowerCase()]||String(item.type).toLowerCase(),pairs:item.pairs||pairs.map(x=>x.join(' = ')).join('|')});
      }
      item={};pairs=[];
    }
    let collectingPairs=false;
    for(let i=0;i<lines.length;i++){
      const line=lines[i].trim(); if(!line||line.startsWith('#'))continue;
      if(/^---+$/.test(line)){flush();collectingPairs=false;continue;}
      if(collectingPairs&&!line.includes(':')&&line.includes('=')){const ix=line.indexOf('=');pairs.push([line.slice(0,ix).trim(),line.slice(ix+1).trim()]);continue;}
      const colon=line.indexOf(':'); if(colon<1)throw new Error('Riga '+(i+1)+': scrivi NOME: contenuto (per le coppie usa parola = traduzione).');
      const rawKey=line.slice(0,colon).trim(),k=keyMap[normKey(rawKey)],v=line.slice(colon+1).trim();
      if(!k)throw new Error('Riga '+(i+1)+': voce non riconosciuta: '+rawKey);
      if((k==='topic'||k==='difficulty')&&!Object.keys(item).length){context[k]=v;continue;}
      if(k==='pairs'){item.pairs=v;collectingPairs=true;continue;}
      collectingPairs=false;item[k]=v;
    }
    flush();return {version:1,questions,activities};
  }

  function parse(text,name){
    if(/\.csv$/i.test(name||''))return normalize(parseCSV(text));
    if(/\.txt$/i.test(name||''))return normalize(parseTeacherText(text));
    let obj;try{obj=JSON.parse(String(text||'').replace(/^\uFEFF/,''))}catch(e){reject('JSON non valido: '+e.message)}
    return normalize(obj);
  }
  return {MAX_Q,MAX_A,question,activity,normalize,parse,parseCSV,parseTeacherText,fingerprint};
});
