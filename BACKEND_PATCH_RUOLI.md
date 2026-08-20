# Patch Backend – Ruoli personalizzati nel database

Il frontend Cartello supporta già questi ruoli:
- `admin` → Staff (unico con accesso pannello)
- `user` → Operatore
- `boss_cartello` → Boss Cartello
- `vice_boss_cartello` → Vice Boss Cartello
- `consigliere_cartello` → Consigliere Cartello
- `boss` → Boss
- `vice` → Vice
- `consigliere` → Consigliere

Il server attuale **forza** ogni ruolo diverso da `admin` a `user`.
Questa patch lo corregge e aggiunge `PATCH /api/users/:username`.

---

## 1. Dove intervenire

Cerca nel bot i file che gestiscono:
- salvataggio utenti (JSON / SQLite / Mongo / Map)
- route `POST /api/users`
- route `DELETE /api/users/:username`
- login `POST /api/login`

Di solito si chiamano qualcosa tipo:
`server.js`, `index.js`, `api.js`, `routes/users.js`, `db.js`

---

## 2. Validazione ruoli (sostituisci la logica attuale)

**PRIMA** (tipico codice che causa il problema):
```js
const role = body.role === 'admin' ? 'admin' : 'user';
```

**DOPO**:
```js
const ALLOWED_ROLES = new Set([
  'admin',
  'user',
  'boss_cartello',
  'vice_boss_cartello',
  'consigliere_cartello',
  'boss',
  'vice',
  'consigliere'
]);

function normalizeRole(role) {
  const r = String(role || 'user').toLowerCase().trim();
  return ALLOWED_ROLES.has(r) ? r : 'user';
}
```

Usa sempre `normalizeRole(...)` in create e update.

---

## 3. Nuovo endpoint PATCH (aggiungi vicino a POST/DELETE users)

```js
// PATCH /api/users/:username  – cambia ruolo (e opzionalmente password)
// Header: x-admin-key: <ADMIN_KEY>
// Body JSON: { "role": "boss_cartello" }  oppure  { "role": "admin", "password": "nuova" }
app.patch('/api/users/:username', requireAdmin, async (req, res) => {
  try {
    const username = decodeURIComponent(req.params.username || '').trim();
    if (!username) return res.status(400).json({ error: 'username mancante' });

    const users = await loadUsers(); // <-- adatta alla tua funzione di lettura DB
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'utente non trovato' });

    if (req.body.role !== undefined) {
      user.role = normalizeRole(req.body.role);
    }
    if (req.body.password !== undefined && String(req.body.password).length >= 3) {
      // se usi hash:
      // user.passwordHash = await bcrypt.hash(String(req.body.password), 10);
      // se salvi in chiaro (come molti bot demo):
      user.password = String(req.body.password);
    }

    await saveUsers(users); // <-- adatta alla tua funzione di scrittura DB
    return res.json({ username: user.username, role: user.role });
  } catch (e) {
    console.error('PATCH /api/users error', e);
    return res.status(500).json({ error: 'errore server' });
  }
});
```

`requireAdmin` deve essere lo stesso middleware che già usi per
`POST /api/users` e `DELETE /api/users/:username` (controllo header `x-admin-key`).

---

## 4. Fix su POST /api/users (crea utente)

Assicurati che **non** forzi più il ruolo:

```js
app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role);

    if (!username || password.length < 3) {
      return res.status(400).json({ error: 'username/password non validi' });
    }

    const users = await loadUsers();
    if (users.some(u => u.username === username)) {
      return res.status(400).json({ error: 'username già esistente' });
    }

    const user = { username, password, role }; // o passwordHash se usi bcrypt
    users.push(user);
    await saveUsers(users);

    return res.json({ username: user.username, role: user.role });
  } catch (e) {
    console.error('POST /api/users error', e);
    return res.status(500).json({ error: 'errore server' });
  }
});
```

---

## 5. Login – accesso pannello solo per admin

Nel login non cambiare nulla di critico: il frontend già fa:

```js
if (state.user.role === 'admin') → pannello staff
else → catalogo
```

Quindi Boss/Vice/Consigliere restano sul catalogo, come richiesto.

Opzionale: se vuoi che anche certi gradi vedano il pannello in futuro:

```js
const STAFF_ROLES = new Set(['admin']); // aggiungi qui se serve
```

---

## 6. Esempio con JSON file (se il bot salva su file)

```js
const fs = require('fs');
const path = require('path');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

async function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
```

---

## 7. Esempio con better-sqlite3

```js
// Migrazione: assicurati che la colonna role sia TEXT libero
// db.exec(`CREATE TABLE IF NOT EXISTS users (
//   username TEXT PRIMARY KEY,
//   password TEXT NOT NULL,
//   role TEXT NOT NULL DEFAULT 'user'
// )`);

function loadUsers() {
  return db.prepare('SELECT username, password, role FROM users').all();
}

function saveUserRole(username, role) {
  db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, username);
}
```

Per PATCH in questo caso puoi fare update diretto senza riscrivere tutto l’array.

---

## 8. Dopo il deploy su Railway

1. Fai commit + push (o redeploy manuale)
2. Verifica:
```bash
curl -X PATCH "https://botdsshadow-production.up.railway.app/api/users/Boss%20Cartello" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: ShadowRPBlackMarket" \
  -d '{"role":"boss_cartello"}'
```
Risposta attesa:
```json
{"username":"Boss Cartello","role":"boss_cartello"}
```

3. Nel frontend Cartello il cambio ruolo tornerà a usare PATCH
   (senza più localStorage / delete+recreate).

---

## 9. Checklist rapida

- [ ] Rimosso `role === 'admin' ? 'admin' : 'user'`
- [ ] Aggiunto `normalizeRole()` con tutti i gradi
- [ ] `POST /api/users` salva il ruolo scelto
- [ ] Aggiunto `PATCH /api/users/:username`
- [ ] Login lascia `role` così com’è nel DB
- [ ] Redeploy Railway
- [ ] Test curl PATCH ok

Se mi mandi il file del bot dove ci sono le route `/api/users`, ti preparo la patch già applicata riga per riga sul tuo codice.

---

# Patch 2 – Modifica ruoli Discord dalla tab Ruoli

Il frontend chiama:

```http
PATCH /api/members/:discordUserId/roles
Header: x-admin-key: <ADMIN_KEY>
Body: {
  "faction": "cartello",
  "rank": "boss" | "vice" | "consigliere" | "membro",
  "rankLabel": "Boss Cartello"
}
```

## Endpoint da aggiungere (discord.js v14)

```js
// Mappa rank → nome ruolo Discord (deve coincidere coi ruoli del server)
const CARTELLO_ROLE_NAMES = {
  boss: 'Boss Cartello',           // oppure '🦂│Boss Cartello'
  vice: 'Vice Boss Cartello',
  consigliere: 'Consigliere Cartello',
  membro: 'Membro Cartello'
};

// Tutti i ruoli Cartello da rimuovere prima di assegnarne uno nuovo
const CARTELLO_ROLE_MATCH = (name) => {
  const n = name.toLowerCase();
  return n.includes('cartello') && (
    n.includes('boss') || n.includes('vice') ||
    n.includes('consigliere') || n.includes('membro')
  );
};

app.patch('/api/members/:id/roles', requireAdmin, async (req, res) => {
  try {
    const memberId = req.params.id;
    const rank = String(req.body.rank || '').toLowerCase();
    if (!CARTELLO_ROLE_NAMES[rank]) {
      return res.status(400).json({ error: 'rank non valido' });
    }

    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'membro non trovato su Discord' });

    // Trova i Role objects nel guild
    const allRoles = await guild.roles.fetch();
    const cartelloRoles = allRoles.filter(r => CARTELLO_ROLE_MATCH(r.name));

    // Ruolo target: match flessibile sul nome
    const targetName = CARTELLO_ROLE_NAMES[rank].toLowerCase();
    const targetRole = allRoles.find(r => {
      const n = r.name.toLowerCase();
      return n.includes(targetName) || (
        rank === 'boss' && n.includes('boss') && !n.includes('vice') && n.includes('cartello')
      ) || (
        rank === 'vice' && n.includes('vice') && n.includes('cartello')
      ) || (
        rank === 'consigliere' && n.includes('consigliere') && n.includes('cartello')
      ) || (
        rank === 'membro' && n.includes('membro') && n.includes('cartello')
      );
    });

    if (!targetRole) {
      return res.status(404).json({ error: 'ruolo Discord non trovato: ' + CARTELLO_ROLE_NAMES[rank] });
    }

    // Il ruolo del bot deve essere sopra i ruoli Cartello
    const botMember = await guild.members.fetchMe();
    if (targetRole.position >= botMember.roles.highest.position) {
      return res.status(403).json({ error: 'il ruolo del bot è troppo basso per gestire questo ruolo' });
    }

    // Rimuovi tutti i gradi Cartello, poi aggiungi quello nuovo
    const toRemove = member.roles.cache.filter(r => cartelloRoles.has(r.id) && r.id !== targetRole.id);
    if (toRemove.size) await member.roles.remove(toRemove);
    if (!member.roles.cache.has(targetRole.id)) await member.roles.add(targetRole);

    return res.json({
      ok: true,
      memberId,
      rank,
      roleName: targetRole.name
    });
  } catch (e) {
    console.error('PATCH /api/members/:id/roles', e);
    return res.status(500).json({ error: e.message || 'errore Discord' });
  }
});
```

## Permessi Discord richiesti

1. Bot con intent **Server Members Intent** attivo nel Developer Portal
2. Permesso **Manage Roles**
3. Ruolo del bot **sopra** Boss/Vice/Consigliere/Membro Cartello nella lista ruoli del server

## Test dopo deploy

```bash
# Sostituisci MEMBER_ID con un ID Discord reale
curl -X PATCH "https://botdsshadow-production.up.railway.app/api/members/MEMBER_ID/roles" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: ShadowRPBlackMarket" \
  -d '{"faction":"cartello","rank":"vice","rankLabel":"Vice Boss Cartello"}'
```

Risposta attesa:
```json
{"ok":true,"memberId":"...","rank":"vice","roleName":"🦂│Vice Boss Cartello"}
```
