const { makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const { MongoClient } = require('mongodb');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());

// Tera MongoDB Connection URL yahan direct laga diya hai
const MONGO_URL = process.env.MONGO_URL || "mongodb+srv://stymk73_db_user:ydTdWSQqaIgH1plg@cluster0.raupn1f.mongodb.net/?appName=Cluster0";
const DB_NAME = "whatsapp_bot_db";

let sock = null;
let qrCodeData = '';
let isConnected = false;

async function useMongoDBAuthState(collection) {
    const writeData = async (data, id) => {
        const bufferData = JSON.stringify(data, (k, v) => Buffer.isBuffer(v) ? { type: 'Buffer', data: v.toJSON().data } : v);
        await collection.updateOne({ _id: id }, { $set: { data: bufferData } }, { upsert: true });
    };

    const readData = async (id) => {
        try {
            const res = await collection.findOne({ _id: id });
            if (!res) return null;
            return JSON.parse(res.data, (k, v) => {
                if (v !== null && typeof v === 'object' && v.type === 'Buffer') {
                    return Buffer.from(v.data);
                }
                return v;
            });
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: id });
        } catch (error) {}
    };

    const creds = (await readData('creds')) || (await (async () => {
        const initCreds = require('@whiskeysockets/baileys').initAuthCreds();
        await writeData(initCreds, 'creds');
        return initCreds;
    })());

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, 'creds');
        }
    };
}

async function startWhatsApp() {
    try {
        const client = new MongoClient(MONGO_URL);
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection('auth_sessions');

        const { state, saveCreds } = await useMongoDBAuthState(collection);

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Chrome (Linux)", "Desktop", "3.0.0"]
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrcode.toDataURL(qr, (err, url) => {
                    if (!err) qrCodeData = url;
                });
                isConnected = false;
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp Successfully Connected via Database!');
                isConnected = true;
                qrCodeData = '';
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                isConnected = false;
                if (shouldReconnect) {
                    setTimeout(startWhatsApp, 3000);
                }
            }
        });
    } catch (err) {
        console.log('MongoDB Connection Error:', err);
        setTimeout(startWhatsApp, 5000);
    }
}

startWhatsApp();

app.get('/qr-status', (req, res) => {
    res.json({ connected: isConnected, qr: qrCodeData });
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
                <div id="content"><p>QR Code load ho raha hai...</p></div>
                <button class="btn" onclick="location.reload()">Refresh Karein</button>
            </div>
            <script>
                async function fetchQR() {
                    try {
                        let res = await fetch('/qr-status');
                        let data = await res.json();
                        let content = document.getElementById('content');
                        if (data.connected) {
                            content.innerHTML = '<h3 style="color: green;">✅ WhatsApp Connected!</h3><p>Session database mein save ho gaya hai.</p>';
                        } else if (data.qr) {
                            content.innerHTML = '<p>Apne phone se scan karein:</p><img src="' + data.qr + '" alt="QR Code">';
                        } else {
                            content.innerHTML = '<p>⏳ Database connect ho raha hai, thoda ruko...</p>';
                        }
                    } catch(e) {}
                }
                setInterval(fetchQR, 3000);
                fetchQR();
            </script>
        </body>
        </html>
    `);
});

app.post('/send', async (req, res) => {
    if (!isConnected || !sock) {
        return res.status(400).json({ status: 'error', message: 'WhatsApp connected nahi hai!' });
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
    console.log(`Server running on port ${PORT}`);
});
