/**
 * server.js — Backend WhatsApp para Corrêa CRM
 *
 * Nota sobre LID (@lid):
 *   WhatsApp (2024+) usa IDs de privacidade (@lid) em vez do número real
 *   no JID. Por isso sempre salvamos `pushName` (nome do contato no celular)
 *   junto com o identificador — é a única forma confiável de identificar
 *   quem enviou sem a API oficial.
 *
 * Iniciar: node server.js
 * Dev:     npx nodemon server.js
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const { Boom }   = require('@hapi/boom');
const qrcode     = require('qrcode');
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
require('dotenv').config();

// ── Diretório de mídia ────────────────────────────────────────
const MEDIA_DIR = path.join(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ── HTTP + Socket.io ──────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/media', express.static(MEDIA_DIR));       // serve áudios/imagens
app.use(express.static(path.join(__dirname, '.'))); // serve index.html

// ── Estado global ─────────────────────────────────────────────
let sock           = null;
let isConnected    = false;
let connectedPhone = '';
let currentQR      = null;

// ── Conexão WhatsApp ──────────────────────────────────────────
async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth:              state,
    printQRInTerminal: true,
    browser:           ['Corrêa CRM', 'Chrome', '120.0.0'],
    getMessage:        async () => undefined
  });

  // ── Eventos de conexão ──────────────────────────────────────
  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await qrcode.toDataURL(qr);
      io.emit('qr', currentQR);
      io.emit('status', 'waiting_qr');
      console.log('[WA] QR Code gerado — escaneie com o celular.');
    }

    if (connection === 'open') {
      isConnected    = true;
      connectedPhone = (sock.user?.id || '').split('@')[0].split(':')[0];
      currentQR      = null;
      io.emit('status', 'connected');
      io.emit('phone', connectedPhone.replace(/\D/g, ''));
      console.log(`[WA] Conectado! +${connectedPhone.replace(/\D/g, '')}`);
    }

    if (connection === 'close') {
      isConnected    = false;
      connectedPhone = '';
      io.emit('status', 'disconnected');
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('[WA] Deslogado. Delete ./auth_info e reinicie para gerar novo QR.');
      } else {
        console.log('[WA] Reconectando em 5s...');
        setTimeout(connectWhatsApp, 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Mensagens recebidas ─────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid || '';
      if (jid.endsWith('@g.us')) continue; // ignora grupos por ora

      // Extrair identificador limpo (pode ser número real ou LID)
      const phoneId  = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const isLid    = jid.includes('@lid');
      const pushName = msg.pushName || '';

      if (!phoneId) continue;

      const m     = msg.message || {};
      const text  = extractText(m);
      const audio = m.audioMessage || m.pttMessage;

      if (!text && !audio) continue;

      const payload = {
        phoneId,   // identificador (número real ou LID — use pushName para exibir)
        isLid,
        pushName,
        direction: 'in',
        timestamp: Date.now()
      };

      if (text) {
        payload.type = 'text';
        payload.text = text;
        console.log(`[IN] ${pushName || '+' + phoneId}: ${text.slice(0, 80)}`);
      }

      if (audio) {
        try {
          const stream = await downloadContentFromMessage(audio, 'audio');
          let buf = Buffer.from([]);
          for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);

          const fname = `${Date.now()}_${phoneId}.ogg`;
          fs.writeFileSync(path.join(MEDIA_DIR, fname), buf);

          payload.type     = 'audio';
          payload.text     = '[Áudio]';
          payload.mediaUrl = `/media/${fname}`;
          payload.duration = audio.seconds || 0;
          console.log(`[IN] ${pushName || '+' + phoneId}: [Áudio ${audio.seconds || 0}s]`);
        } catch (e) {
          console.error('[AUDIO DOWNLOAD ERROR]', e.message);
          continue;
        }
      }

      io.emit('new_message', payload);
    }
  });
}

// Extrai texto de diferentes tipos de mensagem Baileys
function extractText(m) {
  return (
    m.conversation                                ||
    m.extendedTextMessage?.text                   ||
    m.imageMessage?.caption                       ||
    m.videoMessage?.caption                       ||
    m.documentMessage?.caption                    ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title                  ||
    ''
  );
}

// ── REST: Enviar texto ────────────────────────────────────────
// POST /api/send  →  { phone: "5551999999999", text: "Olá!" }
app.post('/api/send', async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text)
    return res.status(400).json({ error: '"phone" e "text" são obrigatórios.' });
  if (!isConnected || !sock)
    return res.status(503).json({ error: 'WhatsApp não conectado.' });
  try {
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text });
    console.log(`[OUT] +${phone.replace(/\D/g, '')}: ${text.slice(0, 80)}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[SEND ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── REST: Enviar áudio ────────────────────────────────────────
// POST /api/send-audio  →  { phone, audioBase64, mimetype? }
app.post('/api/send-audio', async (req, res) => {
  const { phone, audioBase64, mimetype = 'audio/ogg; codecs=opus' } = req.body || {};
  if (!phone || !audioBase64)
    return res.status(400).json({ error: '"phone" e "audioBase64" são obrigatórios.' });
  if (!isConnected || !sock)
    return res.status(503).json({ error: 'WhatsApp não conectado.' });
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const jid    = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(jid, { audio: buffer, mimetype, ptt: true });

    // Salva localmente para histórico
    const fname = `${Date.now()}_out_${phone.replace(/\D/g, '')}.ogg`;
    fs.writeFileSync(path.join(MEDIA_DIR, fname), buffer);

    console.log(`[OUT-AUDIO] +${phone.replace(/\D/g, '')}`);
    res.json({ ok: true, mediaUrl: `/media/${fname}` });
  } catch (e) {
    console.error('[SEND-AUDIO ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── REST: Status ──────────────────────────────────────────────
app.get('/api/status', (_req, res) =>
  res.json({ connected: isConnected, phone: connectedPhone })
);

// ── Socket.io: sync estado para novo cliente ──────────────────
io.on('connection', socket => {
  console.log('[WS] Frontend conectado');
  socket.emit('status', isConnected ? 'connected' : 'disconnected');
  if (isConnected && connectedPhone) socket.emit('phone', connectedPhone.replace(/\D/g, ''));
  if (currentQR) socket.emit('qr', currentQR);
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║  Corrêa CRM  →  http://localhost:${PORT}   ║`);
  console.log(`╚═══════════════════════════════════════╝\n`);
});

connectWhatsApp();
