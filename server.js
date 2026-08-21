require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  TICKET_CATEGORY_ID,
  STAFF_ROLE_ID,
  GEMINI_API_KEY,
} = process.env;

// Modello Gemini da usare.
const GEMINI_MODEL = "gemini-3.6-flash";

// ---------------------------------------------------------------------------
// TIPI DI TICKET
// Modifica/aggiungi voci qui: ognuna diventa un'opzione nel menu a tendina.
// "id" deve essere breve, senza spazi (usato come customId interno).
// ---------------------------------------------------------------------------
const TICKET_TYPES = [
  {
    id: "assistenza_generale",
    label: "Assistenza Generale",
    emoji: "🛠️",
    descrizione: "Problemi tecnici, bug, errori, altro",
    ruoloStaffId: ["1242928164703830056","1239696019458097234"], // 👈 sostituisci con l'ID vero
    domandaIniziale:
      "Ciao! Sono qui per l'assistenza generale. Dimmi: che problema stai riscontrando?",
  },
  {
    id: "donazioni",
    label: "Donazioni",
    emoji: "💳",
    descrizione: "Acquisti, rimborsi, addebiti, donazioni",
    ruoloStaffId: ["1235232860731080734","1235233067694690435","1235233397312458844","1270109646111113337","1242929211669479587","1496204626318594169"], // 👈 sostituisci con l'ID vero
    domandaIniziale:
      "Ciao! Ticket per donazioni. Dammi l'email/username usato per l'acquisto, oppure se vorresti fare una donazione, spiegami cosa è successo (mancato accredito, doppio addebito, rimborso, ecc.).",
  },
  {
    id: "assistenza_bug",
    label: "Assistenza Bug",
    emoji: "🚨",
    descrizione: "Segnala un bug agli staffer",
    ruoloStaffId: ["1242928164703830056","1239696019458097234"], // 👈 sostituisci con l'ID vero
    domandaIniziale:
      "Ciao! Vuoi segnalare qualcosa? Scrivimi cosa è successo, con eventuali prove (clip).",
  },
  {
    id: "sban",
    label: "Sban",
    emoji: "🚫",
    descrizione: "Contatta uno staff per essere sbannato",
    ruoloStaffId: "1239696019458097234", // 👈 sostituisci con l'ID vero
    domandaIniziale:
      "Ciao! Che tipo di ban hai avuto? Scrivimi cosa è successo, con eventuali prove (clip, ID utente).",
  },
  {
    id: "anticheat",
    label: "Anticheat",
    emoji: "👺",
    descrizione: "Verifiche anticheat",
    ruoloStaffId: ["1496927924325187584","1242552533109440644","1496204626318594169","1235233067694690435","1235232860731080734"], // 👈 sostituisci con l'ID vero
    domandaIniziale:
      "Ciao! Uno staffer sarà presto da te per eseguire i controlli anticheat.",
  },
  {
    id: "permadeath",
    label: "Permadeath",
    emoji: "☠️",
    descrizione: "Contatta staffer per eseguire perma",
    ruoloStaffId: ["1235232860731080734","1235233067694690435","1496204626318594169","1235233397312458844","1270109646111113337","1242929211669479587"], // 👈 sostituisci con l'ID vero
    domandaIniziale:
      "Ciao! Allega pure i motivi e descrivi il tutto con prove video (clip) e gli staffer analizzeranno il tutto.",
  },
];

// Se una categoria non ha un ruoloStaffId (o lo lasci vuoto ""), viene usato
// questo ruolo di riserva generico, definito in STAFF_ROLE_ID nel file .env.

// ---------------------------------------------------------------------------
// COMPORTAMENTO DELL'AI
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `
Sei l'assistente di supporto automatico dei ticket su Discord.
Il tuo compito è aiutare gli utenti con domande semplici, frequenti o informative
(es. come funziona un servizio, dove trovare informazioni, problemi comuni con soluzione nota).

Devi ESCALATE (passare la mano allo staff umano) quando:
- l'utente chiede esplicitamente di parlare con una persona / uno staffer
- si tratta di pagamenti, rimborsi, ban, segnalazioni di altri utenti, problemi account gravi
- è un bug tecnico che richiede accesso a sistemi interni
- la richiesta è ambigua, delicata, o non sei sicuro di aver capito bene
- l'utente è arrabbiato o insoddisfatto della tua risposta

Rispondi SEMPRE e SOLO con un oggetto JSON valido, senza testo prima o dopo, nel formato:
{
  "puo_risolvere": true oppure false,
  "risposta": "testo della risposta da mostrare all'utente",
  "motivo_escalation": "breve motivo, solo se puo_risolvere è false, altrimenti stringa vuota"
}

Se puo_risolvere è true, "risposta" deve essere una risposta completa e utile.
Se puo_risolvere è false, "risposta" deve essere un messaggio gentile che dice che stai
girando la richiesta allo staff, SENZA inventare soluzioni che non sei sicuro siano corrette.

IMPORTANTE: non iniziare mai la risposta con conferme generiche o riempitivi come "Ok",
"Va bene", "Certo", "Perfetto", ecc. Vai dritto al punto, rispondendo direttamente al
problema/alla domanda che l'utente ha scritto.
`.trim();

// Storico messaggi per ticket (in memoria: si resetta se il bot riavvia)
const ticketHistory = new Map(); // channelId -> [{ role, content }]
const activeTickets = new Map(); // channelId -> true (AI attiva) | false (in mano allo staff)
const ticketStaffRole = new Map(); // channelId -> ID del ruolo staff da taggare per QUEL ticket

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ---------------------------------------------------------------------------
// SLASH COMMANDS
// ---------------------------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName("pannello-ticket")
    .setDescription("Pubblica il pannello per aprire un ticket (solo staff)"),
  new SlashCommandBuilder()
    .setName("riprendi-ai")
    .setDescription("Riattiva le risposte automatiche dell'AI in questo ticket (solo staff)"),
  new SlashCommandBuilder()
    .setName("ferma-ai")
    .setDescription("Disattiva l'AI in questo ticket, lo prendi in carico tu (solo staff)"),
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("Slash command registrati.");
}

function isStaff(member) {
  return STAFF_ROLE_ID ? member.roles.cache.has(STAFF_ROLE_ID) : false;
}

// Normalizza ruoloStaffId (può essere una stringa singola o un array di ID)
// in un array di ID sempre valido, con fallback allo STAFF_ROLE_ID generico.
function normalizzaRuoli(ruoloStaffId) {
  let lista = [];
  if (Array.isArray(ruoloStaffId)) lista = ruoloStaffId.filter(Boolean);
  else if (ruoloStaffId) lista = [ruoloStaffId];

  if (lista.length === 0 && STAFF_ROLE_ID) lista = [STAFF_ROLE_ID];
  return lista;
}

// Vero se il membro è staff globale OPPURE ha almeno uno dei ruoli staff di questo ticket
function isStaffPerTicket(member, channelId) {
  if (isStaff(member)) return true;
  const ruoli = ticketStaffRole.get(channelId) || [];
  return ruoli.some((id) => member.roles.cache.has(id));
}

// ---------------------------------------------------------------------------
// CHIAMATA ALL'API GEMINI
// ---------------------------------------------------------------------------
async function chiediAllAI(channelId, messaggioUtente) {
  const storico = ticketHistory.get(channelId) || [];
  storico.push({ role: "user", content: messaggioUtente });

  // Gemini vuole i ruoli "user" e "model" (non "assistant"), e i messaggi
  // dentro "parts" invece che "content" diretto.
  const contents = storico.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Errore API Gemini: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const testoGrezzo =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n").trim() || "";

  let parsed;
  try {
    const pulito = testoGrezzo.replace(/^```json|```$/g, "").trim();
    parsed = JSON.parse(pulito);
  } catch (e) {
    parsed = {
      puo_risolvere: false,
      risposta:
        "Non sono riuscito a elaborare una risposta strutturata, giro la richiesta allo staff.",
      motivo_escalation: "Errore di parsing della risposta AI",
    };
  }

  storico.push({ role: "assistant", content: JSON.stringify(parsed) });
  ticketHistory.set(channelId, storico);

  return parsed;
}

// ---------------------------------------------------------------------------
// CREAZIONE DEL PANNELLO
// ---------------------------------------------------------------------------
async function pubblicaPannello(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("🎫 Apri un ticket")
    .setDescription("Scegli la categoria che descrive meglio la tua richiesta dal menu qui sotto.")
    .setColor(0x5865f2);

  const select = new StringSelectMenuBuilder()
    .setCustomId("apri_ticket_select")
    .setPlaceholder("Scegli una categoria...")
    .addOptions(
      TICKET_TYPES.map((t) => ({
        label: t.label,
        value: t.id,
        description: t.descrizione,
        emoji: t.emoji,
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: "Pannello pubblicato.", ephemeral: true });
}

// ---------------------------------------------------------------------------
// MODULO (MODAL) DI APERTURA TICKET
// ---------------------------------------------------------------------------
function creaModal(tipoId) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${tipoId}`)
    .setTitle("Apertura ticket");

  const nomeInput = new TextInputBuilder()
    .setCustomId("nome")
    .setLabel("Nome")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const cognomeInput = new TextInputBuilder()
    .setCustomId("cognome")
    .setLabel("Cognome")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const cittaInput = new TextInputBuilder()
    .setCustomId("citta")
    .setLabel("Città")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const descrizioneInput = new TextInputBuilder()
    .setCustomId("descrizione")
    .setLabel("Descrivi il problema")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nomeInput),
    new ActionRowBuilder().addComponents(cognomeInput),
    new ActionRowBuilder().addComponents(cittaInput),
    new ActionRowBuilder().addComponents(descrizioneInput)
  );

  return modal;
}

// ---------------------------------------------------------------------------
// CREAZIONE DEL TICKET
// ---------------------------------------------------------------------------
async function creaTicket(interaction, tipoId, datiForm) {
  const tipo = TICKET_TYPES.find((t) => t.id === tipoId);
  if (!tipo) return;

  const guild = interaction.guild;
  const nomeCanale = `${tipo.id}-${interaction.user.username}`.toLowerCase().slice(0, 90);
  const ruoliStaff = normalizzaRuoli(tipo.ruoloStaffId);

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    ...ruoliStaff.map((id) => ({
      id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    })),
  ];

  const canale = await guild.channels.create({
    name: nomeCanale,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
  });

  activeTickets.set(canale.id, true);
  ticketStaffRole.set(canale.id, ruoliStaff);
  ticketHistory.set(canale.id, [
    {
      role: "user",
      content: `[CONTESTO INTERNO, non è un messaggio dell'utente] Questo ticket è stato aperto nella categoria "${tipo.label}". Dati utente: Nome ${datiForm.nome}, Cognome ${datiForm.cognome}, Città ${datiForm.citta}. Tienilo a mente per il resto della conversazione.`,
    },
    {
      role: "assistant",
      content: JSON.stringify({
        puo_risolvere: true,
        risposta: "Contesto registrato.",
        motivo_escalation: "",
      }),
    },
  ]);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("chiudi_ticket_button")
      .setLabel("Chiudi ticket")
      .setStyle(ButtonStyle.Danger)
  );

  const embedDati = new EmbedBuilder()
    .setTitle(`🎫 ${tipo.label}`)
    .addFields(
      { name: "Nome", value: datiForm.nome, inline: true },
      { name: "Cognome", value: datiForm.cognome, inline: true },
      { name: "Città", value: datiForm.citta, inline: true },
      { name: "Descrizione problema", value: datiForm.descrizione }
    )
    .setColor(0x5865f2);

  await canale.send({
    content: `<@${interaction.user.id}>`,
    embeds: [embedDati],
    components: [row],
  });

  await interaction.reply({ content: `Ticket creato: ${canale}`, ephemeral: true });

  // L'AI risponde subito in base alla descrizione scritta nel modulo
  try {
    await canale.sendTyping();
    const risultato = await chiediAllAI(canale.id, datiForm.descrizione);

    if (risultato.puo_risolvere) {
      await canale.send(risultato.risposta);
    } else {
      activeTickets.set(canale.id, false);
      const embedEscalation = new EmbedBuilder()
        .setTitle("🔔 Richiesto intervento staff")
        .setDescription(risultato.motivo_escalation || "L'AI non è sicura di poter risolvere.")
        .setColor(0xed4245);

      await canale.send(risultato.risposta);
      await canale.send({
        content: ruoliStaff.length ? ruoliStaff.map((id) => `<@&${id}>`).join(" ") : "@staff",
        embeds: [embedEscalation],
      });
    }
  } catch (err) {
    console.error(err);
    await canale.send("⚠️ Ho avuto un problema a generare la risposta, ho avvisato lo staff.");
    if (ruoliStaff.length) {
      await canale.send(`${ruoliStaff.map((id) => `<@&${id}>`).join(" ")} errore tecnico sull'AI del ticket.`);
    }
  }
}

// ---------------------------------------------------------------------------
// EVENTI
// ---------------------------------------------------------------------------
client.once("ready", () => {
  console.log(`Bot online come ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "pannello-ticket") {
        if (!isStaff(interaction.member)) {
          return interaction.reply({ content: "Solo lo staff può farlo.", ephemeral: true });
        }
        await pubblicaPannello(interaction);
      }

      if (interaction.commandName === "riprendi-ai") {
        if (!isStaffPerTicket(interaction.member, interaction.channel.id)) {
          return interaction.reply({ content: "Solo lo staff può farlo.", ephemeral: true });
        }
        activeTickets.set(interaction.channel.id, true);
        await interaction.reply("🤖 Risposte automatiche AI riattivate in questo ticket.");
      }

      if (interaction.commandName === "ferma-ai") {
        if (!isStaffPerTicket(interaction.member, interaction.channel.id)) {
          return interaction.reply({ content: "Solo lo staff può farlo.", ephemeral: true });
        }
        activeTickets.set(interaction.channel.id, false);
        await interaction.reply("🛑 AI disattivata in questo ticket, ora lo gestisci tu.");
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "apri_ticket_select") {
      const modal = creaModal(interaction.values[0]);
      await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket_modal_")) {
      const tipoId = interaction.customId.replace("ticket_modal_", "");
      const datiForm = {
        nome: interaction.fields.getTextInputValue("nome"),
        cognome: interaction.fields.getTextInputValue("cognome"),
        citta: interaction.fields.getTextInputValue("citta"),
        descrizione: interaction.fields.getTextInputValue("descrizione"),
      };
      await creaTicket(interaction, tipoId, datiForm);
    }

    if (interaction.isButton() && interaction.customId === "chiudi_ticket_button") {
      if (!isStaffPerTicket(interaction.member, interaction.channel.id)) {
        return interaction.reply({ content: "Solo lo staff può chiudere il ticket.", ephemeral: true });
      }
      await interaction.reply("Chiudo il ticket tra 5 secondi...");
      activeTickets.delete(interaction.channel.id);
      ticketHistory.delete(interaction.channel.id);
      ticketStaffRole.delete(interaction.channel.id);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      interaction.reply({ content: "Si è verificato un errore.", ephemeral: true }).catch(() => {});
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!activeTickets.has(message.channel.id)) return; // non è un canale ticket
  if (activeTickets.get(message.channel.id) === false) return; // AI in pausa

  try {
    await message.channel.sendTyping();
    const risultato = await chiediAllAI(message.channel.id, message.content);

    if (risultato.puo_risolvere) {
      await message.reply(risultato.risposta);
    } else {
      activeTickets.set(message.channel.id, false);
      const ruoliStaff = ticketStaffRole.get(message.channel.id) || (STAFF_ROLE_ID ? [STAFF_ROLE_ID] : []);

      const embed = new EmbedBuilder()
        .setTitle("🔔 Richiesto intervento staff")
        .setDescription(risultato.motivo_escalation || "L'AI non è sicura di poter risolvere.")
        .setColor(0xed4245);

      await message.reply(risultato.risposta);
      await message.channel.send({
        content: ruoliStaff.length ? ruoliStaff.map((id) => `<@&${id}>`).join(" ") : "@staff",
        embeds: [embed],
      });
    }
  } catch (err) {
    console.error(err);
    await message.reply("⚠️ Ho avuto un problema a generare la risposta, ho avvisato lo staff.");
    const ruoliStaff = ticketStaffRole.get(message.channel.id) || (STAFF_ROLE_ID ? [STAFF_ROLE_ID] : []);
    if (ruoliStaff.length) {
      await message.channel.send(`${ruoliStaff.map((id) => `<@&${id}>`).join(" ")} errore tecnico sull'AI del ticket.`);
    }
  }
});

// ---------------------------------------------------------------------------
// AVVIO
// ---------------------------------------------------------------------------
(async () => {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
