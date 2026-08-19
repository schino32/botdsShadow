# Cartello Bot — Shadow RP

Bot Discord + piccola API che riceve gli ordini dal sito e li posta nel tuo canale
staff con bottoni **Approva / Rifiuta / Consegnato**. Cliccando i bottoni su Discord
lo stato si aggiorna anche sul sito (e viceversa, dal pannello staff del sito).

## 1. Crea il bot su Discord

1. Vai su https://discord.com/developers/applications → **New Application** → dagli un nome (es. "Cartello").
2. Nel menu a sinistra vai su **Bot** → **Reset Token** → copia il token (ti servirà come `DISCORD_BOT_TOKEN`). Tienilo segreto.
3. Sempre in **Bot**, attiva nessun "Privileged Gateway Intent" particolare: non servono per questo bot.
4. Vai su **OAuth2 → URL Generator**: scopes `bot`, permessi `Send Messages`, `Embed Links`, `Read Message History`. Copia il link generato in fondo e aprilo nel browser per invitare il bot nel tuo server Discord.
5. Nel tuo server Discord, attiva la **Modalità sviluppatore** (Impostazioni utente → Avanzate), poi tasto destro sul canale dove vuoi ricevere gli ordini → **Copia ID canale** → questo è `DISCORD_CHANNEL_ID`.

## 2. Configura le variabili d'ambiente

Copia `.env.example` in `.env` e compila:

```
DISCORD_BOT_TOKEN=...
DISCORD_CHANNEL_ID=...
ADMIN_KEY=una-chiave-lunga-a-caso
PORT=3000
```

`ADMIN_KEY` protegge le azioni da staff (creare/rimuovere utenti, cambiare stato ordini
dal sito). Deve combaciare con quella che userai nel sito.

## 3. Prova in locale (facoltativo)

```
npm install
npm start
```

Se vedi `Bot connesso come ...` nel terminale, funziona. L'API sarà su `http://localhost:3000`.

## 4. Metti online il bot (Railway, gratis per iniziare)

1. Crea un account su https://railway.app (puoi accedere con GitHub).
2. Carica questa cartella su un repository GitHub (o usa "Deploy from local folder" se Railway te lo propone).
3. Su Railway: **New Project → Deploy from GitHub repo**, seleziona il repo.
4. In **Variables**, aggiungi `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `ADMIN_KEY` (e opzionalmente `PORT`, di solito Railway lo gestisce da solo).
5. Railway builda e avvia il progetto da solo (usa `npm start`). Ti dà un dominio pubblico tipo `https://cartello-bot-production.up.railway.app` — è quello che ti serve come indirizzo dell'API.
6. Se preferisci non usare Railway va bene qualunque hosting Node.js sempre acceso (Render, un VPS, ecc.) — i passaggi sono equivalenti.

## 5. Collega il sito

Apri il file del sito (`blackmarket-rp.html`), in cima allo `<script>` trovi:

```js
const API_BASE = "https://IL-TUO-DOMINIO.up.railway.app";
const ADMIN_KEY = "una-chiave-lunga-a-caso";
```

Sostituisci con l'URL reale che ti ha dato Railway e la stessa `ADMIN_KEY` messa nel `.env`
del bot. Salva e ricarica il sito: da questo momento sito e bot condividono gli stessi
ordini e utenti.

## Note

- I dati (utenti, ordini) sono salvati in `data.json` sul server del bot — è un file
  semplice, va benissimo per un server RP ma non è un vero database: se serve più
  affidabilità in futuro si può passare a SQLite/Postgres senza cambiare l'API.
- Cambia subito la password dell'account `admin` demo (admin/admin123) creato al primo avvio.
- `ADMIN_KEY` è una protezione basilare, non un vero sistema di autenticazione: non
  riusare qui password importanti.
