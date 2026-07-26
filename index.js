const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock = null;
let qrCodeData = '';
let isConnected = false;
let isInitializing = false;

async function connectToWhatsApp() {
    if (isInitializing) return;
    isInitializing = true;

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_session');

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Chrome (Linux)", "Desktop", "3.0.0"]
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('New QR Received from Baileys');
                qrcode.toDataURL(qr, (err, url) => {
                    if (!err) {
                        qrCodeData = url;
                    }
                });
                isConnected = false;
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp Connected!');
                isConnected = true;
                qrCodeData = '';
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Connection closed, reconnecting...', shouldReconnect);
                isConnected = false;
                isInitializing = false;
                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 3000);
                }
            }
        });
    } catch (e) {
        console.log('Error in connection:', e);
        isInitializing = false;
    }
}

// Server start hote hi WhatsApp function chala do
connectToWhatsApp();

app.get('/qr-status', (req, res) => {
    // Agar socket nahi hai toh force restart kar do
    if (!sock && !isInitializing) {
        connectToWhatsApp();
    }
    res.json({
        connected: isConnected,
        qr: qrCodeData
    });
});

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
                <button class="btn" onclick="location.reload()">Page Refresh Karein</button>
            </div>

            <script>
                async function fetchQR() {
                    try {
                        let res = await fetch('/qr-status');
                        let data = await res.json();
                        let content = document.getElementById('content');

                        if (data.connected) {
                            content.innerHTML = '<h3 style="color: green;">✅ WhatsApp Connected!</h3><p>Server bilkul taiyar hai.</p>';
                        } else if (data.qr) {
                            content.innerHTML = '<p>Apne phone se scan karein:</p><img src="' + data.qr + '" alt="QR Code">';
                        } else {
                            content.innerHTML = '<p>⏳ Render server wake up ho raha hai, 10 second ruko...</p>';
                        }
                    } catch(e) {
                        document.getElementById('content').innerHTML = '<p style="color: red;">Connection error, refresh karo.</p>';
                    }
                }

                setInterval(fetchQR, 3000);
                fetchQR();
            </script>
        </body>
        </html>
    `);
});

app.post('/send', async (req, pRes) => {
    if (!isConnected || !sock) {
        return pRes.status(400).json({ status: 'error', message: 'WhatsApp connected nahi hai!' });
    }

    const { phone, message } = req.body;
    if (!phone || !message) {
        return pRes.status(400).json({ status: 'error', message: 'Phone aur message chahiye.' });
    }

    try {
        const jid = `${phone}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        pRes.json({ status: 'success', message: 'Message bhej diya gaya hai!' });
    } catch (error) {
        pRes.status(500).json({ status: 'error', message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
