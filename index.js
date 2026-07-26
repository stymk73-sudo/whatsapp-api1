const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock;
let qrCodeData = '';
let isConnected = false;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // QR code ko direct website image link mein badal rahe hain
            qrcode.toDataURL(qr, (err, url) => {
                if (!err) {
                    qrCodeData = url;
                }
            });
            isConnected = false;
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp Successfully Connected!');
            isConnected = true;
            qrCodeData = '';
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

// Website par seedha QR code dikhane ke liye route
app.get('/', (req, res) => {
    if (isConnected) {
        return res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2 style="color: green;">✅ WhatsApp Connected Successfully!</h2>
                <p>Ab aapka server ready hai aur aap API ke through messages bhej sakte hain.</p>
            </div>
        `);
    }

    if (qrCodeData) {
        return res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 30px;">
                <h2>📱 WhatsApp API Login</h2>
                <p>Apne phone se WhatsApp kholkar yeh QR code scan karein:</p>
                <img src="${qrCodeData}" alt="QR Code" style="width: 250px; height: 250px; border: 1px solid #ccc; padding: 10px; border-radius: 10px;" />
                <p style="color: gray; margin-top: 10px;">Yeh page har 5 second mein apne aap refresh ho raha hai...</p>
                <script>
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </div>
        `);
    }

    res.send(`
        <div style="font-family: Arial; text-align: center; margin-top: 50px;">
            <h2>⏳ QR Code generate ho raha hai...</h2>
            <p>Kripya 5 second intezaar karein, page apne aap refresh ho jayega.</p>
            <script>
                setTimeout(() => window.location.reload(), 3000);
            </script>
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
