'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const browser=require('../public/bulk-content');
const backend=require('../functions/bulk-content');

// Reproduces the teacher's real example: repeated *instructions* with
// different matching pairs, listening scripts, answer options and dictation.
const teacherText=`ARGOMENTO: genitivo sassone
DIFFICOLTÀ: medio

GIOCO: Memory
DOMANDA: Associa l'espressione in inglese con la corretta traduzione in italiano.
COPPIE:
the boy's dog = il cane del ragazzo
the boys' dog = il cane dei ragazzi
my sister's room = la stanza di mia sorella
my sisters' room = la stanza delle mie sorelle
SPIEGAZIONE: Con il singolare regolare si aggiunge 's, mentre con il plurale che termina in -s si aggiunge solo l'apostrofo.

---

GIOCO: Memory
DOMANDA: Associa ciascuna frase al suo significato in italiano.
COPPIE:
children's toys = i giocattoli dei bambini
women's bags = le borse delle donne
the teacher's desk = la cattedra dell'insegnante
the teachers' desk = la scrivania degli insegnanti
SPIEGAZIONE: I plurali irregolari come children e women formano il genitivo sassone aggiungendo 's.

---

GIOCO: Memory
DOMANDA: Associa la forma con il genitivo sassone alla traduzione italiana.
COPPIE:
John's car = l'auto di John
James's car = l'auto di James
the cat's milk = il latte del gatto
the cats' milk = il latte dei gatti
SPIEGAZIONE: I nomi singolari terminanti in -s possono prendere 's; i plurali regolari prendono solo l'apostrofo.

---

GIOCO: Memory
DOMANDA: Associa i legami di parentela e possesso alla traduzione corretta.
COPPIE:
Lucy and Tom's house = la casa di Lucy e Tom (in comune)
Lucy's and Tom's bikes = le biciclette di Lucy e di Tom (separate)
my mother's bag = la borsa di mia madre
my parents' house = la casa dei miei genitori
SPIEGAZIONE: Il possesso congiunto richiede 's solo sul secondo nome; il plurale regolare parents richiede solo l'apostrofo.

---

GIOCO: Ascolta e scegli
DOMANDA: Listen and choose the sentence you hear.
TESTO DA LEGGERE: This is my brother's guitar.
OPZIONI: This is my brother's guitar. | This is my brothers' guitar. | This is my brothers guitar.
RISPOSTA: This is my brother's guitar.
SPIEGAZIONE: Si riferisce a un solo fratello (brother's) ed è richiesto l'apostrofo prima della s.

---

GIOCO: Ascolta e scegli
DOMANDA: Listen and choose the sentence you hear.
TESTO DA LEGGERE: Where are the girls' books?
OPZIONI: Where are the girl's books? | Where are the girls' books? | Where are the girls books?
RISPOSTA: Where are the girls' books?
SPIEGAZIONE: La frase riguarda più ragazze (girls'), quindi l'apostrofo va posto dopo la -s del plurale.

---

GIOCO: Ascolta e scegli
DOMANDA: Listen and choose the sentence you hear.
TESTO DA LEGGERE: It is Peter and Mary's bedroom.
OPZIONI: It is Peter and Mary's bedroom. | It is Peter's and Mary's bedroom. | It is Peter and Mary bedroom.
RISPOSTA: It is Peter and Mary's bedroom.
SPIEGAZIONE: Nella proprietà condivisa della stessa stanza, la desinenza 's si applica solo all'ultimo possessore.

---

GIOCO: Dettato
DOMANDA: Listen and write the possessive word.
TESTO DA LEGGERE: Mark's
RISPOSTA: Mark's
SPIEGAZIONE: Il nome proprio singolare richiede l'apostrofo seguito dalla s per formare il genitivo sassone.

---

GIOCO: Dettato
DOMANDA: Listen and write the possessive word.
TESTO DA LEGGERE: children's
RISPOSTA: children's
SPIEGAZIONE: Children è un nome plurale irregolare, pertanto aggiunge regolarmente apostrofo ed esse ('s).

---

GIOCO: Dettato
DOMANDA: Listen and write the possessive word.
TESTO DA LEGGERE: parents'
RISPOSTA: parents'
SPIEGAZIONE: Il plurale regolare termina già in -s, quindi si aggiunge soltanto l'apostrofo alla fine della parola.`;

const raw=browser.parseTeacherText(teacherText);
const parsed=browser.normalize(raw);
assert.deepEqual(parsed.errors,[]);
assert.deepEqual(parsed.warnings,[],'Do not call different answers duplicates');
assert.equal(parsed.questions.length,10,'All 10 teacher questions must survive parsing');
assert.deepEqual(parsed.questions.reduce((acc,q)=>(acc[q.type]=(acc[q.type]||0)+1,acc),{}),{match:4,listen_mcq:3,spell:3});
assert.equal(new Set(parsed.questions.map(browser.fingerprint)).size,10);
assert.deepEqual(backend.normalize(raw),parsed,'Browser and backend must agree on content');
assert.equal(fs.readFileSync(path.join(__dirname,'../public/bulk-content.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../functions/bulk-content.js'),'utf8'),'No drift between parsers');

// Exact duplicates still get skipped, both inside an upload and against stored records.
let again=browser.normalize({version:1,questions:[raw.questions[0],raw.questions[0]],activities:[]});
assert.equal(again.questions.length,1);
assert.equal(again.warnings.length,1);
assert.equal(browser.fingerprint({...parsed.questions[0],active:false,id:123}),backend.fingerprint(parsed.questions[0]));

// Generic matching instructions with different pairs must not collide.
const match=parsed.questions[0];
const distinctMatch={...match,payload:{pairs:match.payload.pairs.map((p,i)=>i===0?{...p,right:'nuova traduzione'}:p)}};
assert.notEqual(browser.fingerprint(match),browser.fingerprint(distinctMatch));
const rearrangedMatch={...match,payload:{pairs:[...match.payload.pairs].reverse()}};
assert.equal(browser.fingerprint(match),browser.fingerprint(rearrangedMatch),'Reordering cards is not a new exercise');

// Same listening instruction and choices but different spoken phrase are distinct.
const listening=parsed.questions[4];
assert.notEqual(browser.fingerprint(listening),browser.fingerprint({...listening,audio_script:'Different recording'}));
assert.notEqual(browser.fingerprint(listening),browser.fingerprint({...listening,payload:{...listening.payload,options:['Other',...listening.payload.options.slice(1)]}}));
const shuffledListening={...listening,payload:{options:[...listening.payload.options].reverse(),correct:listening.payload.options.length-1-listening.payload.correct}};
assert.equal(browser.fingerprint(listening),browser.fingerprint(shuffledListening),'Reordered choices and same solution are a duplicate');
const differentSolution={...listening,payload:{...listening.payload,correct:1}};
assert.notEqual(browser.fingerprint(listening),browser.fingerprint(differentSolution));

const dictation=parsed.questions[7];
assert.notEqual(browser.fingerprint(dictation),browser.fingerprint({...dictation,payload:{answers:['another answer']}}));
assert.notEqual(browser.fingerprint(dictation),browser.fingerprint({...dictation,audio_script:'different sound'}));
const fill=browser.question({type:'fill',prompt:'Complete the sentence.',topic:'genitivo sassone',answer:"Anna's book"});
assert.notEqual(browser.fingerprint(fill),browser.fingerprint({...fill,payload:{answers:["the teachers' books"]}}));
const swipe=browser.question({type:'swipe',prompt:'That is correct.',topic:'test',correct:true});
assert.notEqual(browser.fingerprint(swipe),browser.fingerprint({...swipe,payload:{correct:false}}));
const error=browser.question({type:'error',prompt:'Find the mistake.',topic:'test',chunks:['He','play','tennis'],wrong_index:2});
assert.notEqual(browser.fingerprint(error),browser.fingerprint({...error,payload:{chunks:['She','play','tennis'],correct:1}}));
console.log('OK: 10/10 teacher items, no false duplicates, real duplicates skipped, semantic payload matches client/server');
