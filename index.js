const { DisconnectReason, makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const http = require('http');
const { airtelPlans, gloPlans, mobilePlans, fetchAirtel, fetchGlo, fetchMobile, mtnPlans, fetchMtn } = require('./plans');

// Create HTTP server for health checks and keep-alive
const PORT = process.env.PORT || 10000; // Render uses PORT from environment
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            message: 'WhatsApp Bot is running',
            platform: 'Render.com'
        }));
    } else if (req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            activeUsers: userStates.size,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid,
            platform: 'Render.com'
        }));
    } else if (req.url === '/qr') {
        // Display QR code as webpage
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (latestQR) {
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <meta http-equiv="refresh" content="30">
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            text-align: center;
                            padding: 50px;
                            background: #f5f5f5;
                        }
                        .container {
                            background: white;
                            padding: 30px;
                            border-radius: 10px;
                            display: inline-block;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        }
                        img { max-width: 400px; }
                        h1 { color: #333; }
                        .instructions {
                            text-align: left;
                            margin-top: 20px;
                            color: #666;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>📱 Scan QR Code to Connect</h1>
                        <img src="${latestQR}" alt="QR Code" />
                        <div class="instructions">
                            <h3>How to scan:</h3>
                            <ol>
                                <li>Open WhatsApp on your phone</li>
                                <li>Go to Settings → Linked Devices</li>
                                <li>Tap "Link a Device"</li>
                                <li>Scan the QR code above</li>
                            </ol>
                            <p><em>Page refreshes every 30 seconds</em></p>
                        </div>
                    </div>
                </body>
                </html>
            `);
        } else {
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <meta http-equiv="refresh" content="10">
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            text-align: center;
                            padding: 50px;
                        }
                    </style>
                </head>
                <body>
                    <h1>⏳ Waiting for QR Code...</h1>
                    <p>The bot is starting up. This page will refresh automatically.</p>
                    <p>If already connected, no QR code is needed.</p>
                </body>
                </html>
            `);
        }
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
    console.log(`📍 Health check available at /health`);
    console.log(`📊 Status available at /status`);
    console.log(`📱 QR Code available at /qr`);
});

// Pre-warm PHP script on startup
async function prewarmPhpScript() {
    try {
        console.log('🔥 Pre-warming PHP script...');
        await axios.post(
            'https://damacsub.com/botpanel/users.php',
            new URLSearchParams({ phone: '00000000000' }),
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            }
        );
        console.log('✅ PHP script is warmed up and ready');
    } catch (error) {
        console.log('⚠️  PHP script pre-warming failed:', error.message);
    }
}

// Keep PHP script alive every 3 minutes
setInterval(async () => {
    try {
        console.log('🔄 Keeping PHP script alive...');
        await axios.post(
            'https://damacsub.com/botpanel/users.php',
            new URLSearchParams({ phone: '00000000000' }),
            { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 10000
            }
        );
        console.log('✅ Keep-alive ping successful');
    } catch (error) {
        console.log('⚠️  Keep-alive ping failed:', error.message);
    }
}, 180000); // Every 3 minutes (180000ms)

// IMPORTANT: Keep Node.js app itself alive
const NODE_APP_URL = 'https://suleimanudata.com.ng/health';

setInterval(async () => {
    try {
        console.log('🔄 Keeping Node.js app alive...');
        await axios.get(NODE_APP_URL, { 
            timeout: 5000,
            headers: { 'User-Agent': 'WhatsApp-Bot-KeepAlive' }
        });
        console.log('✅ Node.js keep-alive successful');
    } catch (error) {
        console.log('⚠️  Node.js keep-alive failed:', error.message);
    }
}, 120000); // Every 2 minutes (120000ms)

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;

// Graceful shutdown handler
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.log('🔄 Restarting in 10 seconds...');
    setTimeout(() => {
        process.exit(1);
    }, 10000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            auth: state,
            version,
            logger: pino({ level: 'silent' }),
            browser: ['Damac Sub Bot', 'Safari', '1.0.0'],
            syncFullHistory: false,
            keepAliveIntervalMs: 30000, // Keep alive every 30 seconds
            connectTimeoutMs: 60000, // 60 second connection timeout
            defaultQueryTimeoutMs: 60000,
            getMessage: async (key) => {
                return { conversation: '' };
            }
        });
        
        // Reset reconnect attempts on successful connection
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.clear();
                console.log('\n==============================================');
                console.log('📱  SCAN QR CODE TO CONNECT WHATSAPP');
                console.log('==============================================\n');
                qrcode.generate(qr, { small: true });
                console.log('\n💡 How to scan:');
                console.log('1. Open WhatsApp on your phone');
                console.log('2. Go to Settings > Linked Devices');
                console.log('3. Tap "Link a Device"');
                console.log('4. Scan the QR code above\n');
                console.log('==============================================\n');
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('\n❌ Connection closed');
                console.log('Status Code:', statusCode);
                console.log('Reason:', lastDisconnect?.error?.message || 'Unknown');
                
                // Handle specific error codes
                if (statusCode === 405 || statusCode === 401) {
                    console.log('\n⚠️  WhatsApp Connection Issue');
                    console.log('💡 Solution: Delete "auth_info_baileys" folder and restart\n');
                    return;
                }
                
                // Handle session errors (from your original error log)
                if (lastDisconnect?.error?.message?.includes('MessageCounterError') || 
                    lastDisconnect?.error?.message?.includes('Bad MAC')) {
                    console.log('\n⚠️  Session Error Detected');
                    console.log('💡 Clearing sessions and reconnecting...\n');
                    
                    // Clear auth state and reconnect
                    try {
                        const fs = require('fs');
                        const authPath = './auth_info_baileys';
                        if (fs.existsSync(authPath)) {
                            fs.rmSync(authPath, { recursive: true, force: true });
                            console.log('✅ Auth state cleared');
                        }
                    } catch (err) {
                        console.error('❌ Error clearing auth state:', err);
                    }
                }
                
                if (shouldReconnect) {
                    reconnectAttempts++;
                    
                    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                        console.log('❌ Max reconnection attempts reached. Exiting...');
                        process.exit(1);
                    }
                    
                    const delay = RECONNECT_DELAY * reconnectAttempts;
                    console.log(`🔄 Reconnecting in ${delay/1000} seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})\n`);
                    
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, delay);
                } else {
                    console.log('🔒 Logged out. Please restart the application.\n');
                    process.exit(0);
                }
            } else if (connection === 'open') {
                reconnectAttempts = 0; // Reset on successful connection
                console.clear();
                console.log('\n==============================================');
                console.log('✅  SUCCESSFULLY CONNECTED TO WHATSAPP!');
                console.log('==============================================');
                console.log('🤖  Damac Sub Bot is now active');
                console.log('📱  Ready to receive messages');
                console.log('⏰  Started at:', new Date().toLocaleString());
                console.log('💾  PID:', process.pid);
                console.log('==============================================\n');
                
                // Pre-warm PHP script after connection
                await prewarmPhpScript();
            } else if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
            }
        });
        
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on("messages.upsert", async (messageInfoUpsert) => {
            try {
                const message = messageInfoUpsert.messages?.[0];
                if (!message) return;

                console.log('📩 Message received:', {
                    from: message.key.remoteJid,
                    fromMe: message.key.fromMe,
                    timestamp: new Date().toISOString(),
                    hasText: !!message.message?.conversation || !!message.message?.extendedTextMessage?.text
                });

                const text = message?.message?.conversation || message?.message?.extendedTextMessage?.text || '';

                if (message.key.fromMe) {
                    console.log('⏭️  Skipping own message');
                    return;
                }

                const chatId = message.key.remoteJid;
                if (!chatId || !chatId.includes('@s.whatsapp.net')) {
                    console.log('⏭️  Skipping non-user message');
                    return;
                }

                console.log('✅ Processing message from:', chatId);
                console.log('📝 Message text:', text);

                const phoneNumber = chatId.split('@')[0];
                const modifiedPhoneNumber = '0' + phoneNumber.slice(3);
                const currentState = userStates.get(chatId);
                
                console.log('🔄 Current state:', currentState || 'NEW_USER');

                const InvalidCmd = `⚠️ *Invalid Command* ⚠️

❌ ⚡️⚡️ ❌
Sorry, i don't understand the command entered.

Note: Always ensure you respond with the menu number

if you have any issue, please contact our support team: https://wa.me/message/SEPAP4A67BJKP1

Press #️⃣ to go back to the main menu or reply with the appropriate menu number`;

                const send = async (text) => {
                    try {
                        console.log('📤 Sending response...');
                        await sock.sendMessage(chatId, { text });
                        console.log('✅ Response sent');
                    } catch (error) {
                        console.error('❌ Error sending message:', error);
                        throw error;
                    }
                };

                // Function to call PHP script with retry logic
                const callPhpScript = async (phone, retries = 3) => {
                    for (let i = 0; i < retries; i++) {
                        try {
                            console.log(`📞 Calling PHP API (attempt ${i + 1}/${retries})...`);
                            const phpScriptUrl = 'https://damacsub.com/botpanel/users.php';
                            const response = await axios.post(
                                phpScriptUrl,
                                new URLSearchParams({ phone }),
                                { 
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    timeout: 15000 // 15 second timeout
                                }
                            );
                            console.log('✅ PHP API responded successfully');
                            return response;
                        } catch (error) {
                            console.log(`❌ PHP API call failed (attempt ${i + 1}/${retries}):`, error.message);
                            if (i === retries - 1) throw error; // Throw on last attempt
                            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
                        }
                    }
                };

                try {
                    const response = await callPhpScript(modifiedPhoneNumber);
                    
                    console.log('response', response.data);
                    const names = `${response.data.first_name || 'N/A'} ${response.data.last_name || 'N/A'}`;
                    const balance = response.data.balance || 'N/A';
                    const account = response.data.account || 'N/A';
                    
                    const welcomeMessage = `*Good Day, ${names}* 🎉,
\n🤑 *Available Balance: ₦${balance === "N/A" ? '0' : balance}*

${account === 'Not available' ? 'generate account number from your dashboard' :
`\n💰 *Acc No: ${account}*
💰 *Bank: Palmpay Bank*`}
\nPay Bills Below 👇
\n*Reply with number*
1️⃣ Buy Data
2️⃣ Buy Airtime
3️⃣ Fund Wallet
4️⃣ Talk to Support
\n⚡️https://damacsub.com/ ⚡️`;

                    if (!currentState) {
                        if (response.data && response.data.success) {
                            await send(welcomeMessage);
                            userStates.set(chatId, 'MAIN_MENU');
                        } else {
                            await send(`Hello, I'm *damacsub AI* from *Damac Sub*.

It seems you haven't created a *Damac Sub* account yet, or the phone number connected to your WhatsApp is different from the one on your *Damac Sub* account.

Please create an account to use our services:
🔗 *Register here*: https://damacsub.com/mobile/register

If you already have an account, contact admin to update your phone number: https://wa.me/message/SEPAP4A67BJKP1`);
                            userStates.set(chatId, '');
                        }
                        return;
                    }

                    // [Rest of your message handling logic remains the same]
                    // ... (keeping the rest of your code as is)

                } catch (error) {
                    console.error('❌ Error calling PHP script:', {
                        errorMessage: error.message,
                        response: error.response?.data || 'No response data',
                    });
                    
                    // Graceful fallback when PHP script is down
                    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                        await send(`⚠️ *Service Temporarily Unavailable*

Our system is waking up. Please try again in 10 seconds.

This usually happens after periods of inactivity.

If the issue persists, contact support: https://wa.me/message/SEPAP4A67BJKP1`);
                    } else {
                        await send('⚠️ An error occurred. Please try again later or contact support.');
                    }
                    return;
                }
            } catch (error) {
                console.error('❌ Error processing message:', error);
                const chatId = messageInfoUpsert.messages?.[0]?.key?.remoteJid;
                if (chatId) {
                    try {
                        await sock.sendMessage(chatId, { text: `⚠️ An error occurred. Please try again later.` });
                    } catch (sendError) {
                        console.error('❌ Error sending error message:', sendError);
                    }
                }
            }
        });

        return sock;
    } catch (error) {
        console.error('❌ Error in connectToWhatsApp:', error);
        reconnectAttempts++;
        
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            const delay = RECONNECT_DELAY * reconnectAttempts;
            console.log(`🔄 Retrying connection in ${delay/1000} seconds...`);
            setTimeout(() => {
                connectToWhatsApp();
            }, delay);
        } else {
            console.log('❌ Max reconnection attempts reached. Exiting...');
            process.exit(1);
        }
    }
}

console.log('\n==============================================');
console.log('🚀  STARTING DAMAC SUB WHATSAPP BOT');
console.log('==============================================');
console.log('📅  Date:', new Date().toLocaleString());
console.log('💻  Node Version:', process.version);
console.log('💾  Process ID:', process.pid);
console.log('==============================================\n');

connectToWhatsApp().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
