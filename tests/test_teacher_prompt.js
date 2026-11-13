'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const gi=require('../public/teacher-prompt.js');
const bulk=require('../functions/bulk-content.js');
const model=fs.readFileSync(path.join(root,'public/modelli/LEZIONE_COMPLETA_V8.txt'),'utf8').trim();
assert.equal(gi.MODELLO_V8,model,'Template must be embedded without alteration');
const prompt=gi.buildPrompt({topic:'Comparatives',schoolClass:'3ª media',level:'A2',count:30,difficulty:'medio',games:['mcq','match'],activities:true,goals:'Animali'});
assert.ok(prompt.includes(model),'A copied prompt must contain original V8 TXT model');
assert.ok(prompt.includes('CLASSE: 3ª media')&&prompt.includes('NUMERO DOMANDE: 30'));
assert.ok(prompt.includes('OBIETTIVI: Animali')&&prompt.includes('Scelta multipla, Abbinamenti'));
assert.ok(!prompt.includes('PARTE ERRATA: numero da 1 al numero di parti'),'Only selected game rules');
assert.ok(gi.buildPrompt({topic:'Sports',games:['spell'],activities:false}).includes('Non generare blocchi ATTIVITÀ'));
assert.throws(()=>gi.buildPrompt({topic:'',games:['mcq']}),/argomento/);
assert.throws(()=>gi.buildPrompt({topic:'Animals',games:[]}),/Seleziona/);
assert.throws(()=>gi.buildPrompt({topic:'Animals',count:121}),/120/);
assert.throws(()=>gi.buildPrompt({topic:'Animals',games:['untrusted']}),/Seleziona/);
const sample=fs.readFileSync(path.join(root,'public/modelli/LEZIONE_COMPLETA_V8.txt'),'utf8');
const cleaned=gi.cleanPastedText('```txt\n'+sample.trim()+'\n```');
assert.equal(cleaned,sample.trim(),'Remove only full Markdown wrapper');
assert.deepEqual(bulk.normalize(bulk.parseTeacherText(cleaned)).errors,[]);
assert.equal(bulk.normalize(bulk.parseTeacherText(cleaned)).questions.length,6);
assert.equal(bulk.normalize(bulk.parseTeacherText(cleaned)).activities.length,6);
// Exercise UI handlers against actual app.js without Firebase or writes.
const source=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const start=source.indexOf('let bulkPending=null;'),end=source.indexOf('async function commitBulkImport(){',start);
assert.ok(start>=0&&end>start,'Paste UI must exist');
const modal=[];let toasts=[];
const nodes={
 '#teacherTopic':{value:'Comparatives'},'#teacherClass':{value:'2ª media'},'#teacherLevel':{value:'A1–A2'},
 '#teacherDifficulty':{value:'facile'},'#teacherCount':{value:'10'},'#teacherGoals':{value:''},
 '#teacherActivities':{checked:true},'#teacherGeneratedPrompt':{value:''},'#teacherCopy':{disabled:false},
 '#teacherPromptMessage':{textContent:''}, '#bulkPaste':{value:'```txt\n'+sample.trim()+'\n```'},
 '#bulkPreview':{innerHTML:'',textContent:''}, '#bulkFile':{files:[]}
};
const context=vm.createContext({EGLBulk:bulk,EGLTeacherPrompt:gi,Blob,JSON,Number,String,
 '$':x=>nodes[x], '$$':x=>x==='input[name="teacherGame"]:checked'?[{value:'mcq'},{value:'match'}]:[],
 openModal:html=>modal.push(html),esc:x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 toast:(...args)=>toasts.push(args)
});
vm.runInContext(source.slice(start,end),context);
context.importContentModal();
assert.ok(modal[0].includes('id="bulkPaste"')&&modal[0].includes('id="teacherGeneratedPrompt"'));
assert.ok(nodes['#teacherGeneratedPrompt'].value.includes(model));
context.previewBulkText();
assert.match(nodes['#bulkPreview'].innerHTML,/6 domande valide/);
assert.match(nodes['#bulkPreview'].innerHTML,/6 attività valide/);
assert.match(nodes['#bulkPreview'].innerHTML,/Conferma importazione come bozze/);
context.invalidateBulkPreview();
assert.match(nodes['#bulkPreview'].textContent,/modificato/);
nodes['#bulkPaste'].value='SENZA ETICHETTE VALIDE';
context.previewBulkText();
assert.ok(toasts.some(t=>t[1]==='error'));
assert.doesNotMatch(nodes['#bulkPreview'].innerHTML.replace(/.*/s, nodes['#bulkPreview'].textContent),/Conferma importazione come bozze/);
const page=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
assert.ok(page.indexOf('/teacher-prompt.js')>page.indexOf('/bulk-content.js')&&page.indexOf('/teacher-prompt.js')<page.indexOf('/app.js'));
console.log('OK: modello V8 embedded, generatore, parser, validazione, anteprima e importazione senza upload');
