require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error('Manca DISCORD_BOT_TOKEN o DISCORD_CHANNEL_ID nel file .env');
  process.exit(1);
}
if (!GUILD_ID) {
  console.warn('DISCORD_GUILD_ID non impostato: la sezione "Ruoli" del sito non funzionera finche non lo aggiungi al .env');
}

// ---------- Ruoli account (login sito) ----------
// Solo "admin" apre il pannello staff. Gli altri gradi vedono solo il catalogo.
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

// ---------- storage su file (semplice, va bene per un server RP) ----------
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      users: [{ username: 'admin', password: 'admin123', role: 'admin' }],
      orders: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
let db = loadData();

function requireAdminKey(req, res, next) {
  if (!ADMIN_KEY) return next(); // se non configurata, nessun controllo (solo per test rapidi)
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'chiave admin non valida' });
  }
  next();
}

// ---------- Discord bot ----------
// GuildMembers e' un "privileged intent": va attivato anche nel Developer Portal
// (Bot -> Privileged Gateway Intents -> Server Members Intent) o le liste risulteranno vuote.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function statusMeta(status) {
  return {
    in_attesa:  { label: 'In attesa',   color: 0xc9a227 },
    approvato:  { label: 'Approvato',   color: 0x3c6b64 },
    consegnato: { label: 'Consegnato',  color: 0x4caf50 },
    rifiutato:  { label: 'Rifiutato',   color: 0xb23a2c }
  }[status] || { label: status, color: 0x808080 };
}

function buildOrderEmbed(order, actionedBy) {
  const meta = statusMeta(order.status);
  const itemsText = order.items.map(i => `• ${i.qty}x **${i.name}** — $${(i.price * i.qty).toLocaleString('it-IT')}`).join('\n');
  const embed = new EmbedBuilder()
    .setTitle('Nuovo ordine — Cartello · Shadow RP')
    .setColor(meta.color)
    .addFields(
      { name: 'Operatore', value: order.username, inline: true },
      { name: 'Totale', value: `$${order.total.toLocaleString('it-IT')}`, inline: true },
      { name: 'Stato', value: meta.label, inline: true },
      { name: 'Articoli', value: itemsText || '—' }
    )
    .setFooter({ text: `Ordine ${order.id}` })
    .setTimestamp(order.ts);
  if (order.note) embed.addFields({ name: 'Nota', value: order.note });
  if (actionedBy) embed.addFields({ name: 'Gestito da', value: actionedBy });
  return embed;
}

function buildOrderButtons(order, disabled) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order:${order.id}:approvato`).setLabel('Approva').setStyle(ButtonStyle.Success).setDisabled(!!disabled),
    new ButtonBuilder().setCustomId(`order:${order.id}:rifiutato`).setLabel('Rifiuta').setStyle(ButtonStyle.Danger).setDisabled(!!disabled),
    new ButtonBuilder().setCustomId(`order:${order.id}:consegnato`).setLabel('Consegnato').setStyle(ButtonStyle.Primary).setDisabled(!!disabled)
  );
  return [row];
}

async function postOrderToDiscord(order) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const payload = {
    embeds: [buildOrderEmbed(order)],
    components: buildOrderButtons(order)
  };

  // Tag del ruolo (se configurato)
  if (PING_ROLE_ID) {
    payload.content = `<@&${PING_ROLE_ID}> Nuovo ordine dal black market`;
    // opzionale: evita di pingare @everyone per sbaglio
    payload.allowedMentions = { roles: [PING_ROLE_ID] };
  }

  const msg = await channel.send(payload);
  order.discordChannelId = channel.id;
  order.discordMessageId = msg.id;
  saveData(db);
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const [prefix, orderId, action] = interaction.customId.split(':');
  if (prefix !== 'order') return;

  const order = db.orders.find(o => o.id === orderId);
  if (!order) {
    return interaction.reply({ content: 'Ordine non trovato (forse è stato rimosso).', ephemeral: true });
  }

  order.status = action;
  saveData(db);

  const actionedBy = interaction.user ? `${interaction.user.username}` : null;
  await interaction.update({
    embeds: [buildOrderEmbed(order, actionedBy)],
    components: buildOrderButtons(order, true) // disabilita i bottoni dopo l'azione
  });
});

client.once('clientReady', () => {
  console.log(`Bot connesso come ${client.user.tag}`);
});

client.login(BOT_TOKEN);

// ---------- API REST usata dal sito ----------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, bot: client.isReady() }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase() && u.password === password);
  if (!user) return res.status(401).json({ error: 'credenziali non valide' });
  res.json({ username: user.username, role: user.role });
});

app.get('/api/users', (req, res) => {
  res.json(db.users.map(u => ({ username: u.username, role: u.role })));
});

// Crea utente — ora accetta tutti i ruoli Cartello
app.post('/api/users', requireAdminKey, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username e password richiesti' });
  if (String(password).length < 3) return res.status(400).json({ error: 'password troppo corta' });
  if (db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase())) {
    return res.status(409).json({ error: 'username già esistente' });
  }
  const user = { username: String(username).trim(), password: String(password), role: normalizeRole(role) };
  db.users.push(user);
  saveData(db);
  res.json({ username: user.username, role: user.role });
});

// PATCH — cambia ruolo (e opzionalmente password) senza cancellare l'account
app.patch('/api/users/:username', requireAdminKey, (req, res) => {
  const username = decodeURIComponent(req.params.username || '').trim();
  if (!username) return res.status(400).json({ error: 'username mancante' });

  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'utente non trovato' });

  if (req.body && req.body.role !== undefined) {
    user.role = normalizeRole(req.body.role);
  }
  if (req.body && req.body.password !== undefined && String(req.body.password).length >= 3) {
    user.password = String(req.body.password);
  }

  saveData(db);
  res.json({ username: user.username, role: user.role });
});

app.delete('/api/users/:username', requireAdminKey, (req, res) => {
  const before = db.users.length;
  db.users = db.users.filter(u => u.username.toLowerCase() !== req.params.username.toLowerCase());
  if (db.users.length === before) return res.status(404).json({ error: 'utente non trovato' });
  saveData(db);
  res.json({ ok: true });
});

app.get('/api/orders', (req, res) => {
  const sorted = [...db.orders].sort((a, b) => b.ts - a.ts);
  res.json(sorted);
});

app.post('/api/orders', async (req, res) => {
  const { username, items, note } = req.body || {};
  if (!username || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'ordine non valido' });
  }
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const order = {
    id: crypto.randomBytes(6).toString('hex'),
    username, items, total,
    note: note || '',
    ts: Date.now(),
    status: 'in_attesa'
  };
  db.orders.push(order);
  saveData(db);
  try { await postOrderToDiscord(order); } catch (e) { console.error('errore invio Discord', e); }
  res.json(order);
});

app.patch('/api/orders/:id', requireAdminKey, async (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'ordine non trovato' });
  const { status } = req.body || {};
  if (!['in_attesa', 'approvato', 'consegnato', 'rifiutato'].includes(status)) {
    return res.status(400).json({ error: 'stato non valido' });
  }
  const PING_ROLE_ID = process.env.DISCORD_PING_ROLE_ID || '1498660458788552754';
  order.status = status;
  saveData(db);
  try {
    if (order.discordChannelId && order.discordMessageId) {
      const channel = await client.channels.fetch(order.discordChannelId);
      const msg = await channel.messages.fetch(order.discordMessageId);
      await msg.edit({ embeds: [buildOrderEmbed(order, 'pannello sito')], components: buildOrderButtons(order, true) });
    }
  } catch (e) { console.error('errore aggiornamento messaggio Discord', e); }
  res.json(order);
});

app.delete('/api/orders/:id', requireAdminKey, async (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'ordine non trovato' });
  try {
    if (order.discordChannelId && order.discordMessageId) {
      const channel = await client.channels.fetch(order.discordChannelId);
      const msg = await channel.messages.fetch(order.discordMessageId);
      await msg.delete();
    }
  } catch (e) { console.error('errore eliminazione messaggio Discord', e); }
  db.orders = db.orders.filter(o => o.id !== req.params.id);
  saveData(db);
  res.json({ ok: true });
});

// ---------- ruoli dei membri (in base ai ruoli veri del server Discord) ----------
app.get('/api/members', requireAdminKey, async (req, res) => {
  if (!GUILD_ID) return res.status(400).json({ error: 'DISCORD_GUILD_ID non configurato sul server del bot' });
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch(); // richiede l'intent GuildMembers attivo
    const list = members
      .filter(m => !m.user.bot)
      .map(m => {
        const roles = m.roles.cache
          .filter(r => r.name !== '@everyone')
          .sort((a, b) => b.position - a.position)
          .map(r => ({ name: r.name, color: r.hexColor, position: r.position }));
        return {
          id: m.user.id,
          username: m.user.username,
          displayName: m.displayName,
          topRole: roles[0] || null,
          roles
        };
      })
      .sort((a, b) => (b.topRole ? b.topRole.position : -1) - (a.topRole ? a.topRole.position : -1));
    res.json(list);
  } catch (e) {
    console.error('errore lettura membri', e);
    res.status(500).json({ error: 'impossibile leggere i membri (controlla DISCORD_GUILD_ID e il permesso "Server Members Intent")' });
  }
});

// ---------- Cambia grado Cartello su Discord ----------
// Il frontend chiama: PATCH /api/members/:id/roles
// Body: { faction: 'cartello', rank: 'boss'|'vice'|'consigliere'|'membro', rankLabel: '...' }
const CARTELLO_ROLE_NAMES = {
  boss: 'Boss Cartello',
  vice: 'Vice Boss Cartello',
  consigliere: 'Consigliere Cartello',
  membro: 'Membro Cartello'
};

function isCartelloRankRole(name) {
  const n = String(name || '').toLowerCase();
  if (n.indexOf('cartello') === -1) return false;
  return (
    n.indexOf('boss') !== -1 ||
    n.indexOf('vice') !== -1 ||
    n.indexOf('consigliere') !== -1 ||
    n.indexOf('membro') !== -1
  );
}

function matchCartelloRank(roleName, rank) {
  const n = String(roleName || '').toLowerCase();
  if (n.indexOf('cartello') === -1) return false;
  if (rank === 'boss') return n.indexOf('boss') !== -1 && n.indexOf('vice') === -1;
  if (rank === 'vice') return n.indexOf('vice') !== -1;
  if (rank === 'consigliere') return n.indexOf('consigliere') !== -1;
  if (rank === 'membro') return n.indexOf('membro') !== -1;
  return false;
}

app.patch('/api/members/:id/roles', requireAdminKey, async (req, res) => {
  if (!GUILD_ID) return res.status(400).json({ error: 'DISCORD_GUILD_ID non configurato' });
  if (!client.isReady()) return res.status(503).json({ error: 'bot Discord non ancora pronto' });

  try {
    const memberId = String(req.params.id || '').trim();
    const rank = String((req.body && req.body.rank) || '').toLowerCase().trim();

    if (!memberId) return res.status(400).json({ error: 'id membro mancante' });
    if (!CARTELLO_ROLE_NAMES[rank]) {
      return res.status(400).json({ error: 'rank non valido (usa: boss, vice, consigliere, membro)' });
    }

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) return res.status(404).json({ error: 'membro non trovato su Discord' });

    const allRoles = await guild.roles.fetch();

    // Ruolo target (match flessibile sul nome, es. "🦂│Boss Cartello")
    const targetRole = allRoles.find(r => matchCartelloRank(r.name, rank));
    if (!targetRole) {
      return res.status(404).json({
        error: 'ruolo Discord non trovato: ' + CARTELLO_ROLE_NAMES[rank] +
          ' — controlla che esista sul server con "Cartello" nel nome'
      });
    }

    // Il ruolo del bot deve essere sopra il ruolo da assegnare
    const botMember = await guild.members.fetchMe();
    if (targetRole.position >= botMember.roles.highest.position) {
      return res.status(403).json({
        error: 'il ruolo del bot e troppo basso per gestire "' + targetRole.name +
          '". Sposta il ruolo del bot sopra i ruoli Cartello.'
      });
    }

    // Rimuovi tutti i gradi Cartello, poi aggiungi quello nuovo
    const toRemove = member.roles.cache.filter(
      r => isCartelloRankRole(r.name) && r.id !== targetRole.id
    );
    if (toRemove.size > 0) {
      await member.roles.remove(toRemove, 'Cambio grado da pannello Cartello');
    }
    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole, 'Cambio grado da pannello Cartello');
    }

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

app.listen(PORT, () => console.log(`API in ascolto sulla porta ${PORT}`));
