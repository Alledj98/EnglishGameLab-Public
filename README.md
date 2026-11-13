# English Game Lab — V8 (source edition)

Piattaforma didattica web per esercizi interattivi di inglese nella scuola secondaria di primo grado. Nata dal confronto con un'insegnante, per rendere la pratica più coinvolgente e facilitare la gestione delle attività.

**Demo online:** https://english-gamelab.web.app/ · **Portfolio:** https://www.alle-tech.it/

> **Snapshot del codice per GitHub. Non è un aggiornamento del sito online.** Questa copia è stata resa generica e non contiene la configurazione Firebase dell'istanza in uso. Non pubblicarla su Firebase senza una configurazione e un collaudo indipendenti.

## Funzionalità

- Accesso studenti e dashboard docente, ruoli separati.
- Classi, domande, giochi, punteggi, monitoraggio e report.
- Swipe, MCQ, completamento, Matching, Memory, Word Order, Quick Tap, Time Attack, listening e spelling.
- Importazione massiva con anteprima, controllo duplicati e generatore di prompt didattici.
- Gestione audio e pubblicazione controllata dei contenuti.

## Tecnologie

Frontend in HTML, CSS e JavaScript; Firebase Authentication, Hosting, Firestore, Storage e Cloud Functions con Node.js 22.

## Eseguire i test senza Firebase

Serve Node.js 22. Non è necessario un account Firebase.

```bash
node functions/validate_seed.js
node tests/test_bulk.js
node tests/test_duplicate_questions.js
node tests/test_teacher_prompt.js
node tests/test_v7.js
node tests/test_v8.js
node tests/test_publication_safety.js
```

Il workflow `.github/workflows/ci.yml` esegue solo questi controlli, **non** effettua deploy.

## Configurazione per un ambiente di sviluppo indipendente

Questo snapshot non contiene le impostazioni di produzione. Per usare un progetto Firebase **proprio e separato**:

1. Copiare `public/firebase-config.example.js` in `public/firebase-config.js` e inserire i parametri web del proprio progetto.
2. Copiare `.firebaserc.example` in `.firebaserc` e inserire l'ID del proprio progetto.
3. Consultare `functions/.env.example` per le variabili di bootstrap docente, namespace di login studenti e Storage. Usare valori riferiti solo al proprio ambiente.
4. Per un ambiente di sviluppo indipendente, eseguire `npm --prefix functions install` con Node.js 22, che genera il lockfile mancante, e verificare le Functions con gli emulatori e dati fittizi prima di qualsiasi deploy. Il lockfile non è presente in questa esportazione perché non è stato possibile generarlo offline.

Il setup docente è esplicito su `/bootstrap.html`: il backend accetta soltanto l'email configurata in `EGL_BOOTSTRAP_TEACHER_EMAIL`, nega gli accessi diversi e rifiuta il setup se l'email non è configurata.

**Non usare credenziali, account docente, dati di studenti o configurazione dell'installazione scolastica reale.**

## Privacy e stato

La versione originale, conservata in un repository **privato**, contiene riferimenti personalizzati: non rendere pubblico quel repository, nemmeno dopo aver modificato l'ultimo commit, perché la cronologia conserva i contenuti precedenti. Questa versione deve essere pubblicata in un **nuovo repository con una cronologia Git nuova**.

Il codice dei giochi è mantenuto; il bootstrap e i riferimenti ad ambiente sono stati generalizzati **solo per questa copia GitHub**. La demo online usa una configurazione diversa e non è stata toccata. I test locali non equivalgono a un audit completo di privacy, sicurezza o qualità e non certificano l'identità con l'ultimo deploy. Verificare i diritti d'uso dei contenuti didattici prima della distribuzione.

## Sviluppo e IA

Requisiti, ideazione e direzione del progetto sono guidati dall'autore; l'intelligenza artificiale è stata impiegata principalmente per implementazione, revisione e debugging.

**Licenza:** nessuna licenza open source viene concessa implicitamente. I contenuti e le dipendenze di terzi mantengono le rispettive condizioni.
