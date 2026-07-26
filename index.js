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

// Ek JSON status route taaki pata chale QR ready hai ya nahi
app.get('/qr-status', (req, res) => {
    res.json({
        connected: isConnected,
        qr: qrCodeData
    });
});

// Seedha live UI page jo automatically QR load karega
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="hi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp API Login</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f7f6; text-align: center; padding: 40px; }
                .card { background: white; max-width: 350px; margin: 0 auto; padding: 25px; border-radius: 12px; box-shadow: 0px 4px 15px rgba(0,0,0,0.1); }
                img { width: 240px; height: 240px; margin-top: 15px; border: 1px solid #ddd; padding: 8px; border-radius: 8px; }
                .btn { background: #25D366; color: white; border: none; padding: 10px 20px; font-size: 16px; border-radius: 5px; cursor: pointer; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>📱 WhatsApp API Login</h2>
                <div id="content">
                    <p>QR Code load ho raha hai...</p>
                </div>
                <button class="btn" onclick="fetchQR()">Refresh Karein</button>
            </div>

            <script>
                async function fetchQR() {
                    try {
                        let res = await fetch('/qr-status');
                        let data = await res.json();
                        let content = document.getElementById('content');

                        if (data.connected) {
                            content.innerHTML = '<h3 style="color: green;">✅ WhatsApp Connected!</h3><p>Ab aap API use kar sakte hain.</p>';
                        } else if (data.qr) {
                            content.innerHTML = '<p>Apne phone se scan karein:</p><img src="' + data.qr + '" alt="QR Code">';
                        } else {
                            content.innerHTML = '<p>⏳ Thoda intezaar karein, QR ban raha hai...</p>';
                        }
                    } catch(e) {
                        document.getElementById('content').innerHTML = '<p style="color: red;">Server se connect nahi ho pa raha.</p>';
                    }
                }

                // Har 3 second mein apne aap check karega
                setInterval(fetchQR, 3000);
                fetchQR();
            </script>
        </body>
        </html>
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
