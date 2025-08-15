const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@fadzzzdigital-corp/baileys');
const pino = require('pino');
const ApiFadzzz = require('api-fadzzz');
const fs = require("fs");
const TelegramBot = require('node-telegram-bot-api');

// --- KONFIGURASI BOT ---
const { APIKEY, AUTH_TOKEN, USERNAME, WA_TARGET_JID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = JSON.parse(fs.readFileSync('./configs.json'))

// Inisialisasi OrderKuota
const orderKuota = new ApiFadzzz(APIKEY);

// Inisialisasi bot Telegram (non-polling karena hanya untuk notifikasi)
const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Variabel untuk menyimpan ID transaksi terakhir yang sudah dikirimkan
let lastTransactionId = null;

// Membulatkan Saldo Akhir
function bulatkan(number) {
    return Math.floor(number / 1000) * 1000;
}

// Fungsi untuk mengecek dan mengirim notifikasi ke kedua platform
async function checkAndNotify(sock) {
    if (!AUTH_TOKEN || !USERNAME) {
        console.error('AUTH_TOKEN dan USERNAME belum diisi!');
        return;
    }
    try {
        console.log('Mengecek transaksi baru...');
        const latestTransaction = await orderKuota.get('/orderkuota/cekstatus', { apikey: APIKEY, token: AUTH_TOKEN, username: USERNAME });
        latestTransaction = latestTransaction.result
        if (latestTransaction && latestTransaction.id !== lastTransactionId) {
            console.log('Transaksi baru ditemukan:', latestTransaction.id);

            const autoWithdraw = await orderKuota.get('/orderkuota/withdraw', { apikey: APIKEY, token: AUTH_TOKEN, username: USERNAME, amount: bulatkan(latestTransaction.saldo_akhir.replace(/\./g, '')) })
            console.log(autoWithdraw.result)
            
            lastTransactionId = latestTransaction.id;

            // Kirim notifikasi ke WhatsApp
            const notifWA = formatTransactionWA(latestTransaction)
            if (sock && WA_TARGET_JID) {
                await sock.sendMessage(WA_TARGET_JID, { text: notifWA });
                console.log('Notifikasi terkirim ke WhatsApp.');
            }

            // Kirim notifikasi ke Telegram
            const notifTele = formatTransactionTele(latestTransaction)
            if (TELEGRAM_CHAT_ID) {
                await telegramBot.sendMessage(TELEGRAM_CHAT_ID, notifTele);
                console.log('Notifikasi terkirim ke Telegram.');
            }

        } else {
            console.log('Tidak ada transaksi baru.');
        }
    } catch (error) {
        console.error('Error saat mengecek status:', error);
    }
}

// Fungsi helper untuk memformat pesan transaksi
function formatTransactionWA(transaction) {
    return `💰 *Notifikasi Transaksi Baru!*
    
*Brand:* ${transaction.brand.name}
*Nominal:* ${transaction.kredit}
*Keterangan:* ${transaction.keterangan}
*Status:* ${transaction.status}
*Saldo Akhir:* ${transaction.saldo_akhir}
*Tanggal:* ${transaction.tanggal}

> _Powered by Fadzzz Digital_`;
}
function formatTransactionTele(transaction) {
    return `💰 Notifikasi Transaksi Baru!
    
Brand: ${transaction.brand.name}
Nominal: ${transaction.kredit}
Keterangan: ${transaction.keterangan}
Status: ${transaction.status}
Saldo Akhir: ${transaction.saldo_akhir}
Tanggal: ${transaction.tanggal}

Powered by @cs_fadzzzdigital`;
}

// Fungsi untuk memulai bot WhatsApp
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ['Fadzzz Payment', 'Ubuntu', '1.0'],
        printQRInTerminal: true,
    });

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Koneksi terputus. Mencoba terhubung kembali: ${shouldReconnect}`);
            if (shouldReconnect) {
                startWhatsAppBot();
            }
        } else if (connection === "connecting") {
            console.log("Menghubungkan WhatsApp . . . ");
        } else if (connection === "open") {
            console.log('Bot WhatsApp berhasil terhubung!');
            await checkAndNotify(sock);
            setInterval(() => checkAndNotify(sock), 60000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
}

// Fungsi utama untuk menjalankan bot
async function startAllBots() {
    console.log("Memulai Bot WhatsApp & Telegram...");
    
    // Mulai bot WhatsApp
    const waSock = await startWhatsAppBot();
    console.log('Bot Telegram berhasil diinisialisasi dan siap mengirim pesan!');

    // Tangani proses "stop" secara elegan
    process.once('SIGINT', () => {
        waSock.end();
    });
    process.once('SIGTERM', () => {
        waSock.end();
    });
}

// Jalankan bot
startAllBots();
