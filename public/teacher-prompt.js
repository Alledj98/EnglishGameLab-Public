/* English Game Lab V8: generatore prompt con modello TXT incorporato. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EGLTeacherPrompt=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MODELLO_V8="# ENGLISH GAME LAB V8 - MODELLO COMPLETO PER DOCENTE\n# Copia i blocchi, modifica le frasi, separa ogni domanda/attività con ---\n# Le domande importate restano INATTIVE, le attività NON PUBBLICATE.\n# Importante: se una domanda contiene un audio devi registrarlo sul sito prima di attivarla.\n\nARGOMENTO: Animali e Present Simple\nDIFFICOLTÀ: facile\n\nGIOCO: Vero o falso\nDOMANDA: She plays football every Saturday.\nRISPOSTA: vero\nSPIEGAZIONE: Alla terza persona si aggiunge -s.\n\n---\n\nGIOCO: Scelta multipla\nDOMANDA: Choose the correct sentence.\nOPZIONI: She play tennis. | She plays tennis. | She playing tennis.\nRISPOSTA: She plays tennis.\n\n---\n\n# Quick Tap usa esattamente le stesse domande di Scelta multipla.\n# Word Order usa una domanda di Completa con una frase completa come risposta.\nGIOCO: Word Order\nDOMANDA: Riordina le parole per creare la frase.\nRISPOSTA: They are playing tennis today.\n\n---\n\n# Memory usa le stesse coppie di Abbinamenti.\nGIOCO: Memory\nDOMANDA: Associa gli animali e le traduzioni.\nCOPPIE:\ncat = gatto\ndog = cane\nbird = uccello\n\n---\n\nGIOCO: Ascolta e scegli\nDOMANDA: Listen and choose the sentence you hear.\nTESTO DA LEGGERE: She is reading a book.\nOPZIONI: She is reading a book. | She is writing a book. | She reads a book every day.\nRISPOSTA: She is reading a book.\n\n---\n\nGIOCO: Dettato\nDOMANDA: Listen and write the word.\nTESTO DA LEGGERE: Elephant\nRISPOSTA: elephant\n\n---\n\nATTIVITÀ: Memory - Animali\nGIOCO: Memory\nNUMERO DOMANDE: 1\nTEMPO MEMORY: 20\n\n---\n\nATTIVITÀ: Time Attack - Vero o falso\nGIOCO: Swipe\nNUMERO DOMANDE: 10\nTIMER: 60\nSFIDA A TEMPO: sì\n\n---\n\nATTIVITÀ: Quick Tap - Risposta veloce\nGIOCO: Quick Tap\nNUMERO DOMANDE: 10\nTIMER: 60\nSFIDA A TEMPO: sì\n\n---\n\nATTIVITÀ: Word Order - Riordina le parole\nGIOCO: Word Order\nNUMERO DOMANDE: 5\n\n---\n\nATTIVITÀ: Listening\nGIOCO: Ascolta e scegli\nNUMERO DOMANDE: 5\n\n---\n\nATTIVITÀ: Spelling\nGIOCO: Dettato\nNUMERO DOMANDE: 5";
 const GAMES={
  swipe:['Vero o falso / Swipe','Vero o falso','RISPOSTA: vero o falso. Alterna frasi corrette e scorrette.'],
  mcq:['Scelta multipla / Quick Tap','Scelta multipla','OPZIONI: 2–6 scelte distinte separate da |. RISPOSTA identica a una scelta. Quick Tap riutilizza queste domande.'],
  fill:['Completa / Word Order','Completa','RISPOSTA (o RISPOSTE divise da |). Per Word Order usa frasi intere di almeno 3 parole come risposta.'],
  error:["Trova l’errore","Trova errore",'PAROLE: parti della frase separate da |; PARTE ERRATA: numero da 1 al numero di parti.'],
  match:['Abbinamenti / Memory','Abbinamenti','COPPIE: seguito da 2–10 righe parola = traduzione. Memory riutilizza le coppie.'],
  listen_mcq:['Ascolta e scegli','Ascolta e scegli','TESTO DA LEGGERE: frase da registrare; OPZIONI: scelte separate da |; RISPOSTA uguale a una scelta.'],
  spell:['Dettato','Dettato','TESTO DA LEGGERE: testo da registrare; RISPOSTA: parola corretta.']
 };
 function cleanPastedText(raw){let t=String(raw??'').replace(/^\uFEFF/,'').trim();const m=t.match(/^```(?:txt|text|plaintext)?\s*\r?\n([\s\S]*?)\r?\n```$/i);return m?m[1].trim():t;}
 function buildPrompt(o={}){
  const topic=String(o.topic??'').trim();if(!topic||topic.length>120)throw Error('Inserisci un argomento (max 120 caratteri).');
  const cls=o.schoolClass??'2ª media',level=o.level??'A1–A2',difficulty=o.difficulty??'facile';
  if(!['1ª media','2ª media','3ª media'].includes(cls)||!['A1','A1–A2','A2'].includes(level)||!['facile','medio','difficile'].includes(difficulty))throw Error('Classe, livello o difficoltà non validi.');
  const count=Number(o.count??20);if(!Number.isInteger(count)||count<5||count>120)throw Error('Scegli da 5 a 120 domande.');
  const games=Array.isArray(o.games)?[...new Set(o.games)]:['swipe','mcq','fill','match'];
  if(!games.length||games.some(k=>!Object.prototype.hasOwnProperty.call(GAMES,k)))throw Error('Seleziona almeno un tipo di gioco.');
  const goals=String(o.goals??'').trim().slice(0,400), activities=o.activities!==false;
  return `Agisci come docente esperta di inglese delle scuole medie. Prepara testo pronto da INCOLLARE direttamente nell'importazione massiva English Game Lab V8.\n\n`+
  `ARGOMENTO: ${topic}\nCLASSE: ${cls}\nLIVELLO: ${level}\nDIFFICOLTÀ: ${difficulty}\nNUMERO DOMANDE: ${count}\nTIPOLOGIE RICHIESTE: ${games.map(x=>GAMES[x][1]).join(', ')}\n`+
  (goals?`OBIETTIVI: ${goals}\n`:'')+`\nREGOLE OBBLIGATORIE:\n`+
  `- Genera esattamente ${count} blocchi DOMANDA, distribuiti tra le tipologie scelte, ciascuno con GIOCO, DOMANDA, i campi di risposta previsti per QUEL tipo (RISPOSTA/RISPOSTE, COPPIE o PAROLE/PARTE ERRATA) e una SPIEGAZIONE breve.\n`+
  `- Inizia con ARGOMENTO: ${topic} e DIFFICOLTÀ: ${difficulty}. Separa ogni domanda e attività con una riga --- da sola.\n`+
  `- Non inventare etichette o valori: segui il modello TXT V8 completo riportato sotto. Non copiare nel risultato le domande dimostrative del modello.\n`+
  games.map(x=>`- ${GAMES[x][1]}: ${GAMES[x][2]}`).join('\n')+'\n'+
  (activities?'- Dopo le domande, crea da 1 a 8 blocchi ATTIVITÀ compatibili con le domande effettivamente create, con GIOCO, NUMERO DOMANDE e MODALITÀ: practice. Il numero richiesto non deve superare quello disponibile per il gioco. Quick Tap richiede Scelta multipla, Word Order richiede Completa con risposta a frase intera, Memory richiede Abbinamenti. Le attività restano NON PUBBLICATE.\n':'- Non generare blocchi ATTIVITÀ.\n')+
  `- Massimo 120 domande e 20 attività. Evita duplicati, risposte ambigue, errori grammaticali, dati personali di studenti. Verifica le soluzioni.\n`+
  `- Per Listening e Dettato scrivi solo TESTO DA LEGGERE: la prof registrerà la voce sul sito, senza audio generato dall'IA.\n`+
  `- Restituisci SOLO testo TXT piano pronto da incollare: nessuna premessa, NESSUN JSON/CSV, nessun file da scaricare, niente allegati, niente blocchi Markdown o backtick.\n\n`+
  `MODELLO ORIGINALE V8 (È GIÀ INCLUSO, NON SERVE ALLEGARLO):\n========= INIZIO MODELLO =========\n${MODELLO_V8}\n========= FINE MODELLO =========\n\n`+
  `ADESSO PRODUCI SOLTANTO IL TXT IMPORTABILE PER ${topic}.`;
 }
 return {MODELLO_V8,GAMES,cleanPastedText,buildPrompt};
});
