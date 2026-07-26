app.get('/', (req, res) => {
    res.send('WhatsApp API is Running Successfully!');
});
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal'); // Agar yeh error de toh isko hata ke simple log kar sakte hain, par Baileys bina web ke bhi terminal par QR dikha sakta hai

const app = express();
app.use(express.json());

let sock;
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Yeh seedha Railway ke Logs mein QR code print kar dega!
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- QR CODE AAGAYA HAI, LOGS MEIN DEKHO ---');
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
