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

const CONFIG = {
    // Meta WhatsApp API
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || 'EAAa4f8LAgtEBQuvGZAiVEwgy5ZAp8xju9gohcFo9MaZAxvroZAhBAV483MHrxlbjN5C1wA27lIZAsdnkqiv9aC3h0UAXAP2TmZCSSVZAox2qwv8D4py4PpiljWWd1zaLyZC4z2cTNgZAAxXj2zXFJRPS2mb9Wvvrmb6aU64BkFmGZA6OrlrcRd1K22nMppeZBWuRRPXNzsZBAi7mc9gtJzqev0G94H8ZBqcJhtH4WgeVmPUipeavHOPCpoDorlZBiYLe2a0nmILVGNcV94wzes28DcIHqorgZDZD',
    PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || '529770810215816',
    WABA_ID: process.env.WABA_ID || '435381729669619',
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'goldenhost_webhook_2024',

    // Meta API URL
    META_API_URL: 'https://graph.facebook.com/v18.0'
};

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

// Send text message
app.post('/api/send-message', async (req, res) => {
    try {
        const { to, message, type = 'text' } = req.body;

        if (!to || !message) {
            return res.status(400).json({ error: 'Missing required fields: to, message' });
        }

        const result = await sendWhatsAppMessage(to, message, type);
        res.json(result);
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: error.message });
    }
});

async function sendWhatsAppMessage(to, message, type = 'text') {
    // Format phone number (remove + and any spaces)
    const formattedPhone = to.replace(/[\s+\-]/g, '');

    const url = `${CONFIG.META_API_URL}/${CONFIG.PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: type
    };

    if (type === 'text') {
        payload.text = { body: message };
    }

    console.log('Sending message:', { to: formattedPhone, message });

    const response = await axios.post(url, payload, {
        headers: {
            'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    // Save sent message to Firebase
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
    }

    return {
        success: true,
        messageId: response.data.messages?.[0]?.id,
        data: response.data
    };
}

// Send template message
app.post('/api/send-template', async (req, res) => {
    try {
        const { to, templateName, languageCode = 'ar', components = [] } = req.body;

        if (!to || !templateName) {
            return res.status(400).json({ error: 'Missing required fields: to, templateName' });
        }

        const formattedPhone = to.replace(/[\s+\-]/g, '');
        const url = `${CONFIG.META_API_URL}/${CONFIG.PHONE_NUMBER_ID}/messages`;

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
                'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({
            success: true,
            messageId: response.data.messages?.[0]?.id,
            data: response.data
        });
    } catch (error) {
        console.error('Send template error:', error.response?.data || error);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// ==================== Conversations API ====================

// Get all conversations
app.get('/api/conversations', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({ error: 'Database not initialized' });
        }

        const snapshot = await db.collection('conversations')
            .orderBy('updatedAt', 'desc')
            .limit(50)
            .get();

        const conversations = [];
        snapshot.forEach(doc => {
            conversations.push({ id: doc.id, ...doc.data() });
        });

        res.json(conversations);
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a conversation
app.get('/api/conversations/:phone/messages', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({ error: 'Database not initialized' });
        }

        const { phone } = req.params;
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

        res.json(messages);
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
