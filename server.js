/**
 * server.js — Backend WhatsApp para Corrêa CRM
 * Usa @whiskeysockets/baileys para conectar ao WhatsApp Web (sem API paga).
 * A sessão é salva em ./auth_info — não delete esta pasta após conectar.
 *
 * Iniciar: node server.js
 */

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion }
  = require('@whiskeysockets/baileys');
const { Boom }    = require('@hapi/boom');
const qrcode      = require('qrcode');
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const path        = require('path');
require('dotenv').config();

// ── HTTP + Socket.io ──────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));   // serve index.html

// ── State ─────────────────────────────────────────────────────
let sock           = null;
let isConnected    = false;
let connectedPhone = '';
let currentQR      = null;

// ── WhatsApp Connection ───────────────────────────────────────
async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth:               state,
    printQRInTerminal:  true,     // QR também no terminal como fallback
    browser:            ['Corrêa CRM', 'Chrome', '120.0.0'],
    getMessage:         async () => undefined   // evita erros de histórico
  });

  // ── Eventos de conexão ────────────────────────────────────
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
      connectedPhone = (sock.user?.id || '').split(':')[0].replace(/\D/g, '');
      currentQR      = null;
      io.emit('status', 'connected');
      io.emit('phone', connectedPhone);
      console.log(`[WA] Conectado! Número: +${connectedPhone}`);
    }

    if (connection === 'close') {
      isConnected    = false;
      connectedPhone = '';
      io.emit('status', 'disconnected');
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('[WA] Desconectado. Código:', code);

      if (code === DisconnectReason.loggedOut) {
        console.log('[WA] Sessão encerrada. Delete ./auth_info e reinicie para reconectar.');
      } else {
        console.log('[WA] Reconectando em 5s...');
        setTimeout(connectWhatsApp, 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Mensagens recebidas ───────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;                        // ignora enviadas por mim
      const jid = msg.key.remoteJid || '';
      if (jid.endsWith('@g.us')) continue;                 // ignora grupos (por ora)

      const phone = jid.split('@')[0].replace(/\D/g, '');
      const text  = extractText(msg);
      if (!text) continue;

      console.log(`[IN] +${phone}: ${text.slice(0, 80)}`);

      // Emite para o frontend salvar no Firebase
      io.emit('new_message', {
        phone,
        remoteJid: jid,
        text,
        direction: 'in',
        timestamp: Date.now()
      });
    }
  });
}

// Extrai texto de diferentes tipos de mensagem
function extractText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation                        ||
    m.extendedTextMessage?.text           ||
    m.imageMessage?.caption               ||
    m.videoMessage?.caption               ||
    m.documentMessage?.caption            ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title          ||
    ''
  );
}

// ── REST API ──────────────────────────────────────────────────

// POST /api/send  { phone: "5551999999999", text: "Olá!" }
app.post('/api/send', async (req, res) => {
  const { phone, text } = req.body || {};
  if (!phone || !text)
    return res.status(400).json({ error: '"phone" e "text" são obrigatórios.' });
  if (!isConnected || !sock)
    return res.status(503).json({ error: 'WhatsApp não está conectado.' });

  try {
    const digits = phone.replace(/\D/g, '');
    const jid    = digits + '@s.whatsapp.net';
    await sock.sendMessage(jid, { text });
    console.log(`[OUT] +${digits}: ${text.slice(0, 80)}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[SEND ERROR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/status
app.get('/api/status', (_req, res) => {
  res.json({ connected: isConnected, phone: connectedPhone });
});

// ── Socket.io: enviar estado ao novo cliente ──────────────────
io.on('connection', socket => {
  console.log('[WS] Frontend conectado');
  socket.emit('status', isConnected ? 'connected' : 'disconnected');
  if (isConnected && connectedPhone) socket.emit('phone', connectedPhone);
  if (currentQR) socket.emit('qr', currentQR);
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  Corrêa CRM — Servidor rodando       ║`);
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

connectWhatsApp();
