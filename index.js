const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock;
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Logs / Terminal mein QR code dikhega
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- QR CODE GENERATED, CHECK LOGS ---');
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp Successfully Connected!');
            isConnected = true;
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed. Reconnecting...', shouldReconnect);
            isConnected = false;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
    });
}

connectToWhatsApp();

// Home page route taaki "Cannot GET /" na aaye
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: Arial; text-align: center; margin-top: 50px;">
            <h2>🚀 WhatsApp API Server is Live!</h2>
            <p>Status: <b>${isConnected ? 'Connected ✅' : 'Waiting for Scan ⏳'}</b></p>
            <p>Terminal / Logs mein jakar QR code scan karein.</p>
        </div>
    `);
});

// Message bhejne ki API route
app.post('/send', async (req, res) => {
    if (!isConnected) {
        return res.status(400).json({ status: 'error', message: 'WhatsApp abhi connected nahi hai!' });
    }

    const { phone, message } = req.body;
    if (!phone || !message) {
        return res.status(400).json({ status: 'error', message: 'Phone aur message dono chahiye.' });
    }

    try {
        const jid = `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ status: 'success', message: 'Message bhej diya gaya hai!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
