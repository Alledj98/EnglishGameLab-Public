# Revisione per repository GitHub pubblico

Data: 13 novembre 2026

- La copia deriva dalla V8 caricata nell'archivio di revisione privata.
- Sostituiti account, nomi e email docente hardcoded nel frontend, nel bootstrap e nel backend.
- L'API di bootstrap del docente ora dipende da una variabile ambiente e **nega il bootstrap** quando non configurata.
- Sostituiti identificativi dell'istanza Firebase in uso con file di esempio; nessun `.env` reale.
- Rimosso l'hosting `site` fisso e ignorati i file di configurazione locali.
- Rinominati riferimenti al nickname del docente nell'interfaccia, nei modelli e nei nomi dei moduli.
- I giochi, la logica didattica e i file seed sono mantenuti in questa copia.
- È necessario un **nuovo repository pubblico**, perché il repository privato esistente contiene la storia originale.
- Nessun deploy Firebase, migrazione dati o modifica account è previsto per la pubblicazione del sorgente.

## Controlli e limiti

Questa preparazione esegue controlli statici, sintattici e test locali. Non equivale a una verifica completa delle autorizzazioni backend o del copyright dei contenuti. L'uso in un nuovo ambiente richiede una propria configurazione Firebase e test d'integrazione.
