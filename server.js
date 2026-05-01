/**
 * server.js — Backend WhatsApp · Corrêa CRM
 *
 * Sobre LID (@lid): WhatsApp 2024+ usa IDs de privacidade no JID.
 * Sempre salvamos pushName junto — é o único identificador confiável
 * sem a API oficial.
 *
 * Iniciar:  node server.js
 * Dev:      npx nodemon server.js
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

// ── Pasta de mídia ────────────────────────────────────────────
const MEDIA_DIR = path.join(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ── HTTP + Socket.io ──────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/media', express.static(MEDIA_DIR));
app.use(express.static(path.join(__dirname, '.')));

// ── Estado ────────────────────────────────────────────────────
let sock = null, isConnected = false, connectedPhone = '', currentQR = null;

// ── WhatsApp ──────────────────────────────────────────────────
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

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = await qrcode.toDataURL(qr);
      io.emit('qr', currentQR);
      io.emit('status', 'waiting_qr');
      console.log('[WA] QR gerado — escaneie com o celular.');
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
      isConnected = false; connectedPhone = '';
      io.emit('status', 'disconnected');
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('[WA] Deslogado. Delete ./auth_info e reinicie.');
      } else {
        console.log('[WA] Reconectando em 5s...');
        setTimeout(connectWhatsApp, 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Histórico inicial (fires quando Baileys sincroniza ao conectar) ──
  sock.ev.on('messages.set', ({ messages }) => {
    if (!messages?.length) return;
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000; // últimos 7 dias

    const history = messages
      .filter(m => {
        if (!m.key?.remoteJid) return false;
        const jid = m.key.remoteJid;
        if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return false;
        return Number(m.messageTimestamp || 0) * 1000 > cutoff;
      })
      .map(m => processMsg(m))
      .filter(m => m && m.text);

    if (history.length) {
      io.emit('message_history', history);
      console.log(`[WA] Histórico: ${history.length} msgs → frontend.`);
    }
  });

  // ── Mensagens em tempo real ────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid || '';
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;

      const phoneId  = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
      const pushName = msg.pushName || '';
      const m        = msg.message || {};

      const text  = extractText(m);
      const audio = m.audioMessage || m.pttMessage;
      const image = m.imageMessage;

      if (!text && !audio && !image) continue;

      const payload = {
        msgId: msg.key.id, phoneId, pushName,
        direction: 'in', timestamp: Date.now()
      };

      if (audio) {
        try {
          const buf   = await downloadMedia(audio, 'audio');
          const fname = `${Date.now()}_${phoneId}.ogg`;
          fs.writeFileSync(path.join(MEDIA_DIR, fname), buf);
          Object.assign(payload, {
            type: 'audio', text: '[Áudio]',
            mediaUrl: `/media/${fname}`, duration: audio.seconds || 0
          });
          console.log(`[IN-AUDIO] ${pushName || '+' + phoneId}: ${audio.seconds || 0}s`);
        } catch (e) {
          console.error('[AUDIO ERR]', e.message); continue;
        }
      } else if (image) {
        try {
          const buf   = await downloadMedia(image, 'image');
          const fname = `${Date.now()}_${phoneId}.jpg`;
          fs.writeFileSync(path.join(MEDIA_DIR, fname), buf);
          Object.assign(payload, {
            type: 'image', text: image.caption || '[Imagem]',
            mediaUrl: `/media/${fname}`
          });
          console.log(`[IN-IMAGE] ${pushName || '+' + phoneId}`);
        } catch (e) {
          Object.assign(payload, { type: 'text', text: '[Imagem]' });
        }
      } else {
        Object.assign(payload, { type: 'text', text });
        console.log(`[IN] ${pushName || '+' + phoneId}: ${text.slice(0, 80)}`);
      }

      io.emit('new_message', payload);
    }
  });
}

// Extrai texto de tipos comuns de mensagem Baileys
function extractText(m) {
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title || ''
  );
}

// Monta payload de uma msg do histórico (texto apenas)
function processMsg(msg) {
  const jid      = msg.key?.remoteJid || '';
  const phoneId  = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  const text     = msg.message ? extractText(msg.message) : '';
  if (!phoneId || !text) return null;
  return {
    msgId:     msg.key?.id || '',
    phoneId,
    pushName:  msg.pushName || '',
    text,
    type:      'text',
    direction: msg.key?.fromMe ? 'out' : 'in',
    timestamp: Number(msg.messageTimestamp || 0) * 1000
  };
}

// Faz download de mídia do Baileys
async function downloadMedia(mediaMsg, type) {
  const stream = await downloadContentFromMessage(mediaMsg, type);
  let buf = Buffer.from([]);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

// ── REST API ──────────────────────────────────────────────────

app.post('/api/send', async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text)     return res.status(400).json({ error: 'phone e text obrigatórios.' });
  if (!isConnected || !sock) return res.status(503).json({ error: 'WhatsApp não conectado.' });
  try {
    const jid  = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    const sent = await sock.sendMessage(jid, { text });
    console.log(`[OUT] +${phone.replace(/\D/g, '')}: ${text.slice(0, 80)}`);
    res.json({ ok: true, msgId: sent?.key?.id });
  } catch (e) {
    console.error('[SEND ERR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/send-audio', async (req, res) => {
  const { phone, audioBase64, mimetype = 'audio/ogg; codecs=opus' } = req.body || {};
  if (!phone || !audioBase64) return res.status(400).json({ error: 'phone e audioBase64 obrigatórios.' });
  if (!isConnected || !sock)  return res.status(503).json({ error: 'WhatsApp não conectado.' });
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const jid    = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    const sent   = await sock.sendMessage(jid, { audio: buffer, mimetype, ptt: true });
    const fname  = `${Date.now()}_out_${phone.replace(/\D/g, '')}.ogg`;
    fs.writeFileSync(path.join(MEDIA_DIR, fname), buffer);
    console.log(`[OUT-AUDIO] +${phone.replace(/\D/g, '')}`);
    res.json({ ok: true, msgId: sent?.key?.id, mediaUrl: `/media/${fname}` });
  } catch (e) {
    console.error('[SEND-AUDIO ERR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status', (_req, res) => res.json({ connected: isConnected, phone: connectedPhone }));

io.on('connection', socket => {
  console.log('[WS] Frontend conectado');
  socket.emit('status', isConnected ? 'connected' : 'disconnected');
  if (isConnected && connectedPhone) socket.emit('phone', connectedPhone.replace(/\D/g, ''));
  if (currentQR) socket.emit('qr', currentQR);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║  Corrêa CRM  →  http://localhost:${PORT}   ║`);
  console.log(`╚═══════════════════════════════════════╝\n`);
});

connectWhatsApp();
