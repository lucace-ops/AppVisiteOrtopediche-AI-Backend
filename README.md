# Backend AI — App Visite Ortopediche

Backend minimale Vercel. La chiave OpenAI NON va inserita nei file dell'app USB.

## Deploy
1. Crea un nuovo repository GitHub e carica questi file mantenendo la cartella `api`.
2. In Vercel: Add New > Project > importa il repository > Deploy.
3. Vercel > progetto > Settings > Environment Variables:
   - `OPENAI_API_KEY` = la secret key OpenAI (obbligatoria)
   - `OPENAI_MODEL` = `gpt-5-mini` (facoltativa; puoi cambiarla in seguito)
   - `ALLOWED_ORIGIN` = `*` per il primo test locale della app USB. Nota: una app aperta da file:// può avere Origin `null`; CORS non è un meccanismo di autenticazione.
4. Dopo aver aggiunto/modificato le variabili, fai Redeploy.
5. L'endpoint sarà: `https://NOME-PROGETTO.vercel.app/api/clinical-analysis`
6. Nella V4: Impostazioni > Supporto AI clinico > incolla l'endpoint > Salva endpoint.

## Sicurezza / uso clinico
- Non committare mai `.env`, chiavi API o credenziali.
- La app invia solo anamnesi, EO e testo degli esami; non invia volutamente anagrafica, diagnosi o terapia.
- Per il test usare casi fittizi o de-identificati.
- Prima dell'uso con dati sanitari reali serve una valutazione specifica privacy/GDPR, configurazione del trattamento dati e adeguate misure di sicurezza/controllo accessi.
- L'output è supporto decisionale e richiede convalida del medico.
