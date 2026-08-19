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

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error('Manca DISCORD_BOT_TOKEN o DISCORD_CHANNEL_ID nel file .env');
  process.exit(1);
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
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
  const msg = await channel.send({ embeds: [buildOrderEmbed(order)], components: buildOrderButtons(order) });
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

app.post('/api/users', requireAdminKey, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username e password richiesti' });
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'username già esistente' });
  }
  const user = { username, password, role: role === 'admin' ? 'admin' : 'user' };
  db.users.push(user);
  saveData(db);
  res.json({ username: user.username, role: user.role });
});

app.delete('/api/users/:username', requireAdminKey, (req, res) => {
  db.users = db.users.filter(u => u.username.toLowerCase() !== req.params.username.toLowerCase());
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

app.listen(PORT, () => console.log(`API in ascolto sulla porta ${PORT}`));
