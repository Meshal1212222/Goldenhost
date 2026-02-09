/**
 * Golden Host - WhatsApp Business API Backend
 * ============================================
 * Backend server for handling Meta WhatsApp webhooks
 * and sending messages via WhatsApp Business API
 *
 * Deploy on Railway: https://railway.app
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== Configuration ====================

// Multiple WhatsApp Business Accounts
const WHATSAPP_ACCOUNTS = {
    'golden_ticket': {
        name: 'Golden Ticket',
        phoneNumberId: '596898763496238',
        wabaId: '531042513430236',
        token: process.env.GOLDEN_TICKET_TOKEN || 'EAALAVP2dSyQBQsgmZApRytz6ZArVaZAJWU8B8tmT9FnXPp7QGJvVSIBXOqhMyEPyot01EZAhBi0sbUixxpyknThUWbPo864186QbYIt3rRUkdGNrpeErgVs9XP7kBuHQzdYyuMkS9O2OhuwlzmqiYIZAFnYQbJ7fdubG6QhYlOQnrZBWHB4QV3ehiJtp2FggZDZD'
    },
    'golden_host': {
        name: 'Golden Host',
        phoneNumberId: '529770810215816',
        wabaId: '435381729669619',
        token: process.env.GOLDEN_HOST_TOKEN || '' // Waiting for admin approval
    }
};

const CONFIG = {
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'goldenhost_webhook_2024',
    META_API_URL: 'https://graph.facebook.com/v18.0',
    DEFAULT_ACCOUNT: 'golden_ticket' // Default account to use
};

// Helper function to get account config
function getAccount(accountId) {
    return WHATSAPP_ACCOUNTS[accountId] || WHATSAPP_ACCOUNTS[CONFIG.DEFAULT_ACCOUNT];
}

// ==================== Middleware ====================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================== WhatsApp Webhook (MUST BE BEFORE STATIC) ====================

// Webhook Verification (GET request from Meta)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('Webhook verification request:', { mode, token });

    if (mode === 'subscribe' && token === CONFIG.VERIFY_TOKEN) {
        console.log('Webhook verified successfully!');
        res.status(200).send(challenge);
    } else {
        console.log('Webhook verification failed');
        res.sendStatus(403);
    }
});

// Receive Messages (POST request from Meta)
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        console.log('Received webhook:', JSON.stringify(body, null, 2));

        if (body.object === 'whatsapp_business_account') {
            const entries = body.entry || [];
            for (const entry of entries) {
                const changes = entry.changes || [];
                for (const change of changes) {
                    if (change.field === 'messages') {
                        const value = change.value;
                        const messages = value.messages || [];
                        const contacts = value.contacts || [];
                        for (let i = 0; i < messages.length; i++) {
                            const message = messages[i];
                            const contact = contacts[i] || {};
                            await processIncomingMessage(message, contact, value.metadata);
                        }
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.sendStatus(200);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API info
app.get('/api', (req, res) => {
    res.json({
        status: 'running',
        service: 'Golden Host WhatsApp Backend',
        version: '1.0.0'
    });
});

// ==================== Firebase Setup ====================

let db;

// ==================== In-Memory Storage (Temporary Solution) ====================
// This stores messages in memory when Firebase is not configured
// Messages will be lost on server restart - configure Firebase for persistence

const memoryStore = {
    conversations: new Map(),
    messages: new Map()
};

function getMemoryConversation(phone) {
    if (!memoryStore.conversations.has(phone)) {
        memoryStore.conversations.set(phone, {
            id: phone,
            customerPhone: phone,
            customerName: 'Unknown',
            channel: 'whatsapp_meta',
            status: 'open',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            unreadCount: 0,
            lastMessage: '',
            lastMessageTime: null
        });
        memoryStore.messages.set(phone, []);
    }
    return memoryStore.conversations.get(phone);
}

function addMemoryMessage(phone, messageData) {
    const conv = getMemoryConversation(phone);
    conv.updatedAt = new Date().toISOString();
    conv.lastMessage = messageData.content;
    conv.lastMessageTime = new Date().toISOString();
    conv.unreadCount = (conv.unreadCount || 0) + 1;

    const messages = memoryStore.messages.get(phone) || [];
    messages.push({
        id: messageData.id || `msg_${Date.now()}`,
        ...messageData,
        createdAt: new Date().toISOString()
    });
    memoryStore.messages.set(phone, messages);
}

function initFirebase() {
    try {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
            : null;

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: 'https://sunday-fb28c-default-rtdb.firebaseio.com'
            });
            db = admin.firestore();
            console.log('Firebase initialized successfully');
        } else {
            console.log('No Firebase credentials - running without database');
        }
    } catch (error) {
        console.error('Firebase initialization error:', error.message);
    }
}

initFirebase();

// ==================== Message Processing ====================

async function processIncomingMessage(message, contact, metadata) {
    const messageData = {
        id: message.id,
        from: message.from,
        timestamp: new Date(parseInt(message.timestamp) * 1000).toISOString(),
        type: message.type,
        customerName: contact.profile?.name || 'Unknown',
        customerPhone: message.from,
        phoneNumberId: metadata.phone_number_id,
        content: extractMessageContent(message),
        status: 'received',
        channel: 'whatsapp_meta'
    };

    console.log('Processing message:', messageData);

    // Save to Firebase
    if (db) {
        try {
            // Get or create conversation
            const conversationRef = db.collection('conversations').doc(message.from);
            const conversationDoc = await conversationRef.get();

            if (!conversationDoc.exists) {
                // Create new conversation
                await conversationRef.set({
                    customerPhone: message.from,
                    customerName: contact.profile?.name || 'Unknown',
                    channel: 'whatsapp_meta',
                    status: 'open',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    unreadCount: 1
                });
            } else {
                // Update existing conversation
                await conversationRef.update({
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    unreadCount: admin.firestore.FieldValue.increment(1),
                    lastMessage: messageData.content,
                    lastMessageTime: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // Add message to messages subcollection
            await conversationRef.collection('messages').add({
                ...messageData,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            console.log('Message saved to Firebase');
        } catch (error) {
            console.error('Error saving to Firebase:', error);
        }
    } else {
        // Save to memory (temporary solution)
        const conv = getMemoryConversation(message.from);
        conv.customerName = contact.profile?.name || conv.customerName;
        addMemoryMessage(message.from, messageData);
        console.log('Message saved to memory (temporary)');
    }

    return messageData;
}

function extractMessageContent(message) {
    switch (message.type) {
        case 'text':
            return message.text?.body || '';
        case 'image':
            return '[Image]' + (message.image?.caption || '');
        case 'video':
            return '[Video]' + (message.video?.caption || '');
        case 'audio':
            return '[Audio Message]';
        case 'document':
            return '[Document: ' + (message.document?.filename || 'file') + ']';
        case 'location':
            return `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
        case 'sticker':
            return '[Sticker]';
        case 'button':
            return message.button?.text || '[Button Response]';
        case 'interactive':
            return message.interactive?.button_reply?.title ||
                   message.interactive?.list_reply?.title ||
                   '[Interactive Response]';
        default:
            return '[Unsupported message type: ' + message.type + ']';
    }
}

// ==================== Send Messages API ====================

// Get available WhatsApp accounts
app.get('/api/whatsapp-accounts', (req, res) => {
    const accounts = Object.entries(WHATSAPP_ACCOUNTS)
        .filter(([id, acc]) => acc.token) // Only return accounts with valid tokens
        .map(([id, acc]) => ({
            id: id,
            name: acc.name,
            phoneNumberId: acc.phoneNumberId
        }));
    res.json(accounts);
});

// Send text message
app.post('/api/send-message', async (req, res) => {
    try {
        const { to, message, type = 'text', accountId } = req.body;

        if (!to || !message) {
            return res.status(400).json({ error: 'Missing required fields: to, message' });
        }

        const result = await sendWhatsAppMessage(to, message, type, accountId);
        res.json(result);
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: error.message });
    }
});

async function sendWhatsAppMessage(to, message, type = 'text', accountId = null) {
    // Get the account to use
    const account = getAccount(accountId);

    if (!account.token) {
        throw new Error(`No token configured for account: ${accountId || CONFIG.DEFAULT_ACCOUNT}`);
    }

    // Format phone number (remove + and any spaces)
    const formattedPhone = to.replace(/[\s+\-]/g, '');

    const url = `${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: type
    };

    if (type === 'text') {
        payload.text = { body: message };
    }

    console.log('Sending message:', { to: formattedPhone, message, account: account.name });

    const response = await axios.post(url, payload, {
        headers: {
            'Authorization': `Bearer ${account.token}`,
            'Content-Type': 'application/json'
        }
    });

    // Save sent message
    if (db) {
        try {
            const conversationRef = db.collection('conversations').doc(formattedPhone);
            await conversationRef.collection('messages').add({
                id: response.data.messages?.[0]?.id,
                from: 'employee',
                to: formattedPhone,
                content: message,
                type: type,
                status: 'sent',
                channel: 'whatsapp_meta',
                accountId: accountId || CONFIG.DEFAULT_ACCOUNT,
                accountName: account.name,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            await conversationRef.update({
                lastMessage: message,
                lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('Error saving sent message:', error);
        }
    } else {
        // Save to memory
        addMemoryMessage(formattedPhone, {
            id: response.data.messages?.[0]?.id,
            from: 'employee',
            to: formattedPhone,
            content: message,
            type: type,
            status: 'sent',
            channel: 'whatsapp_meta',
            accountId: accountId || CONFIG.DEFAULT_ACCOUNT,
            accountName: account.name
        });
    }

    return {
        success: true,
        messageId: response.data.messages?.[0]?.id,
        account: account.name,
        data: response.data
    };
}

// Send template message
app.post('/api/send-template', async (req, res) => {
    try {
        const { to, templateName, languageCode = 'en_US', components = [], accountId } = req.body;

        if (!to || !templateName) {
            return res.status(400).json({ error: 'Missing required fields: to, templateName' });
        }

        const account = getAccount(accountId);
        if (!account.token) {
            return res.status(400).json({ error: `No token configured for account: ${accountId || CONFIG.DEFAULT_ACCOUNT}` });
        }

        const formattedPhone = to.replace(/[\s+\-]/g, '');
        const url = `${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`;

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedPhone,
            type: 'template',
            template: {
                name: templateName,
                language: { code: languageCode },
                components: components
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${account.token}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({
            success: true,
            messageId: response.data.messages?.[0]?.id,
            account: account.name,
            data: response.data
        });
    } catch (error) {
        console.error('Send template error:', error.response?.data || error);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// Get WhatsApp message templates
app.get('/api/templates', async (req, res) => {
    try {
        const { accountId } = req.query;
        const account = getAccount(accountId);
        if (!account.token) {
            return res.status(400).json({ error: 'No token configured' });
        }

        const url = `${CONFIG.META_API_URL}/${account.wabaId}/message_templates?fields=name,language,status,category,components`;
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${account.token}` }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Get templates error:', error.response?.data || error);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// ==================== OTP System ====================

// OTP Storage (in memory - for production use Redis or database)
const otpStore = new Map();

// Generate and send OTP
app.post('/api/otp/send', async (req, res) => {
    try {
        const { phone, templateName = 'code_otp', accountId, languageCode = 'en' } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
        }

        // Format phone number
        const formattedPhone = phone.replace(/[\s+\-]/g, '');

        // Generate 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        // Store OTP with 10-minute expiry
        otpStore.set(formattedPhone, {
            code: otp,
            expires: Date.now() + 10 * 60 * 1000, // 10 minutes
            attempts: 0
        });

        // Get account
        const account = getAccount(accountId);
        if (!account.token) {
            return res.status(400).json({ error: 'لا يوجد توكن للحساب' });
        }

        // Send OTP via WhatsApp Template
        const url = `${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`;

        // Build template object
        const templateObj = {
            name: templateName,
            language: { code: languageCode }
        };

        // Add body and button components for OTP
        templateObj.components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: otp }
                ]
            },
            {
                type: 'button',
                sub_type: 'otp',
                index: '0',
                parameters: [
                    { type: 'payload', payload: otp }
                ]
            }
        ];

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedPhone,
            type: 'template',
            template: templateObj
        };

        console.log('Sending OTP template payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${account.token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`OTP sent to ${formattedPhone}: ${otp}`);

        res.json({
            success: true,
            message: 'تم إرسال رمز التحقق',
            messageId: response.data.messages?.[0]?.id,
            expiresIn: 600 // 10 minutes in seconds
        });

    } catch (error) {
        console.error('OTP send error:', error.response?.data || error);
        res.status(500).json({ error: error.response?.data?.error?.message || 'فشل إرسال رمز التحقق' });
    }
});

// Verify OTP
app.post('/api/otp/verify', (req, res) => {
    try {
        const { phone, code } = req.body;

        if (!phone || !code) {
            return res.status(400).json({ error: 'رقم الهاتف ورمز التحقق مطلوبان' });
        }

        const formattedPhone = phone.replace(/[\s+\-]/g, '');
        const storedOtp = otpStore.get(formattedPhone);

        if (!storedOtp) {
            return res.status(400).json({
                success: false,
                error: 'لم يتم إرسال رمز تحقق لهذا الرقم'
            });
        }

        // Check expiry
        if (Date.now() > storedOtp.expires) {
            otpStore.delete(formattedPhone);
            return res.status(400).json({
                success: false,
                error: 'انتهت صلاحية رمز التحقق'
            });
        }

        // Check attempts (max 3)
        if (storedOtp.attempts >= 3) {
            otpStore.delete(formattedPhone);
            return res.status(400).json({
                success: false,
                error: 'تجاوزت الحد الأقصى للمحاولات'
            });
        }

        // Verify code
        if (storedOtp.code === code) {
            otpStore.delete(formattedPhone);
            console.log(`OTP verified for ${formattedPhone}`);
            return res.json({
                success: true,
                message: 'تم التحقق بنجاح',
                verified: true
            });
        } else {
            storedOtp.attempts++;
            return res.status(400).json({
                success: false,
                error: 'رمز التحقق غير صحيح',
                attemptsLeft: 3 - storedOtp.attempts
            });
        }

    } catch (error) {
        console.error('OTP verify error:', error);
        res.status(500).json({ error: 'فشل التحقق' });
    }
});

// ==================== Conversations API ====================

// Get all conversations
app.get('/api/conversations', async (req, res) => {
    try {
        if (db) {
            const snapshot = await db.collection('conversations')
                .orderBy('updatedAt', 'desc')
                .limit(50)
                .get();

            const conversations = [];
            snapshot.forEach(doc => {
                conversations.push({ id: doc.id, ...doc.data() });
            });
            return res.json(conversations);
        } else {
            // Return from memory
            const conversations = Array.from(memoryStore.conversations.values())
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
            return res.json(conversations);
        }
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a conversation
app.get('/api/conversations/:phone/messages', async (req, res) => {
    try {
        const { phone } = req.params;

        if (db) {
            const snapshot = await db.collection('conversations')
                .doc(phone)
                .collection('messages')
                .orderBy('createdAt', 'asc')
                .limit(100)
                .get();

            const messages = [];
            snapshot.forEach(doc => {
                messages.push({ id: doc.id, ...doc.data() });
            });

            // Mark as read
            await db.collection('conversations').doc(phone).update({
                unreadCount: 0
            });

            return res.json(messages);
        } else {
            // Return from memory
            const messages = memoryStore.messages.get(phone) || [];
            const conv = memoryStore.conversations.get(phone);
            if (conv) conv.unreadCount = 0;
            return res.json(messages);
        }
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Health Check ====================

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Golden Host WhatsApp Backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            webhook: '/webhook',
            sendMessage: 'POST /api/send-message',
            sendTemplate: 'POST /api/send-template',
            conversations: 'GET /api/conversations',
            messages: 'GET /api/conversations/:phone/messages'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ==================== Static Files (AFTER API routes) ====================

app.use(express.static(__dirname));

// ==================== Start Server ====================

app.listen(PORT, () => {
    console.log(`
    ========================================
    Golden Host WhatsApp Backend
    ========================================
    Server running on port ${PORT}
    Webhook URL: https://your-railway-url.up.railway.app/webhook

    Configuration:
    - Phone Number ID: ${CONFIG.PHONE_NUMBER_ID}
    - WABA ID: ${CONFIG.WABA_ID}
    - Token: ${CONFIG.WHATSAPP_TOKEN ? 'Set' : 'NOT SET'}
    ========================================
    `);
});
