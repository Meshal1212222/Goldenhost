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

    // Run chatbot for Golden Ticket incoming messages
    if (metadata.phone_number_id === WHATSAPP_ACCOUNTS.golden_ticket.phoneNumberId) {
        try {
            await handleChatbot(message.from, messageData.content, contact.profile?.name || 'Unknown');
        } catch (error) {
            console.error('Chatbot error:', error);
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

// ==================== Chatbot Engine ====================

// Load Golden Ticket chatbot workflow
const chatbotWorkflow = require('./workflows/golden-ticket-chatbot.json');

// Build step index for quick lookup by ID
const stepIndex = new Map();
(function buildIndex(node) {
    if (!node) return;
    if (node.id != null) stepIndex.set(String(node.id), node);
    if (Array.isArray(node.childs)) node.childs.forEach(buildIndex);
})(chatbotWorkflow.tree);

// Chatbot sessions: phone → { variables, contact, waitingForStep, lastActivity, jumpCounts }
const chatbotSessions = new Map();
const BOT_SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const BOT_ACCOUNT = 'golden_ticket';

function getBotSession(phone) {
    const s = chatbotSessions.get(phone);
    if (!s) return null;
    if (Date.now() - s.lastActivity > BOT_SESSION_TIMEOUT) {
        chatbotSessions.delete(phone);
        return null;
    }
    s.lastActivity = Date.now();
    return s;
}

// Substitute {{variable}} templates
function botSubstitute(text, session) {
    if (!text) return '';
    return text
        .replace(/\{\{contact\.name\}\}/g, session.contact.name || '')
        .replace(/\{\{contact\.phone_number\}\}/g, session.contact.phone_number || '')
        .replace(/\{\{contact\.email\}\}/g, session.contact.email || '')
        .replace(/\{\{(\w+)\}\}/g, (m, v) => session.variables[v] !== undefined ? session.variables[v] : m);
}

// Send text message from bot
async function botSendText(phone, text) {
    const account = getAccount(BOT_ACCOUNT);
    await axios.post(`${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text }
    }, { headers: { 'Authorization': `Bearer ${account.token}`, 'Content-Type': 'application/json' } });
}

// Send interactive buttons (max 3 options, max 20 chars each)
async function botSendButtons(phone, text, options) {
    const account = getAccount(BOT_ACCOUNT);
    await axios.post(`${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', to: phone, type: 'interactive',
        interactive: {
            type: 'button', body: { text },
            action: { buttons: options.map((opt, i) => ({ type: 'reply', reply: { id: `opt_${i}`, title: opt.substring(0, 20) } })) }
        }
    }, { headers: { 'Authorization': `Bearer ${account.token}`, 'Content-Type': 'application/json' } });
}

// Send interactive list
async function botSendList(phone, interactive) {
    const account = getAccount(BOT_ACCOUNT);
    await axios.post(`${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', to: phone, type: 'interactive', interactive
    }, { headers: { 'Authorization': `Bearer ${account.token}`, 'Content-Type': 'application/json' } });
}

// Evaluate workflow conditions
function botEvalConditions(conditions, session) {
    if (!conditions || conditions.length === 0) return false;
    for (const c of conditions) {
        const val = c.hasVariable ? (session.variables[c.variable] || '') : '';
        if (c.filter_operator === 'equal_to' && val !== c.values) return false;
    }
    return true;
}

// Execute a workflow step
async function botExecStep(step, session, phone) {
    if (!step) return;
    try {
        switch (step.type) {
            case 'QuestionStep': {
                const q = step.data.question;
                if (q.type === 'whatsapp_list' && q.interactive) {
                    await botSendList(phone, q.interactive);
                } else if (q.type === 'multiple' && q.options && q.options.length > 0) {
                    if (q.options.length <= 3 && q.options.every(o => o.length <= 20)) {
                        await botSendButtons(phone, q.text, q.options);
                    } else {
                        await botSendList(phone, {
                            type: 'list', body: { text: q.text },
                            action: { button: 'اختر', sections: [{ rows: q.options.map((o, i) => ({ id: `opt_${i}`, title: o.substring(0, 24) })) }] }
                        });
                    }
                } else {
                    await botSendText(phone, q.text);
                }
                session.waitingForStep = String(step.id);
                break;
            }
            case 'BranchStep': {
                let matched = false;
                for (const child of (step.childs || [])) {
                    if (child.type === 'IfCondition' && !matched) {
                        if (botEvalConditions(child.data?.conditions, session)) {
                            matched = true;
                            if (child.childs?.[0]) await botExecStep(child.childs[0], session, phone);
                        }
                    } else if (child.type === 'ElseCondition' && !matched) {
                        if (child.childs?.[0]) await botExecStep(child.childs[0], session, phone);
                        matched = true;
                    }
                }
                break;
            }
            case 'ActionStep': {
                if (step.data?.type === 'send_message') {
                    for (const p of (step.data.payload || [])) {
                        if (p.message?.text) await botSendText(phone, botSubstitute(p.message.text, session));
                    }
                } else if (step.data?.type === 'add_comment') {
                    console.log('[Bot Comment]', botSubstitute(step.data.comment || '', session));
                }
                if (step.childs?.[0]) await botExecStep(step.childs[0], session, phone);
                else chatbotSessions.delete(phone);
                break;
            }
            case 'HttpRequestStep': {
                try {
                    const body = JSON.parse(botSubstitute(step.data.body, session));
                    const headers = {};
                    (step.data.headers || []).forEach(h => { headers[h.key] = h.value; });
                    const resp = await axios.post(step.data.url, body, { headers });
                    if (step.data.saveResponse?.hasVariable) session.variables[step.data.saveResponse.variable] = JSON.stringify(resp.data);
                    (step.data.responseMap || []).forEach(m => { session.variables[m.variable] = resp.data[m.key] || ''; });
                    const ok = (step.childs || []).find(c => c.type === 'ValidAnswer');
                    if (ok?.childs?.[0]) await botExecStep(ok.childs[0], session, phone);
                } catch (err) {
                    console.error('[Bot HTTP Error]', err.message);
                    const fail = (step.childs || []).find(c => c.type === 'InvalidAnswer');
                    if (fail?.childs?.[0]) await botExecStep(fail.childs[0], session, phone);
                }
                break;
            }
            case 'DateTimeStep': {
                // 24/7 - always succeed
                const ok = (step.childs || []).find(c => c.type === 'ValidDateTime');
                if (ok?.childs?.[0]) await botExecStep(ok.childs[0], session, phone);
                break;
            }
            case 'AssignToStep': {
                console.log('[Bot] Assigning conversation to workspace');
                const ok = (step.childs || []).find(c => c.type === 'ValidAssignTo');
                if (ok?.childs?.[0]) await botExecStep(ok.childs[0], session, phone);
                break;
            }
            case 'JumpStep': {
                const key = `jump_${step.id}`;
                session.jumpCounts = session.jumpCounts || {};
                session.jumpCounts[key] = (session.jumpCounts[key] || 0) + 1;
                if (session.jumpCounts[key] <= (step.data?.maxJumps || 10)) {
                    const target = stepIndex.get(String(step.data?.stepId));
                    if (target) await botExecStep(target, session, phone);
                }
                break;
            }
            default: {
                // Structural nodes (ValidAnswer, InvalidAnswer, etc.)
                if (step.childs?.[0]) await botExecStep(step.childs[0], session, phone);
                break;
            }
        }
    } catch (error) {
        console.error(`[Bot Error] ${step.type} (${step.id}):`, error.message);
    }
}

// Process user's response to a question
async function botProcessResponse(step, session, phone, text) {
    const q = step.data.question;
    let valid = false;
    let value = text;

    if (q.type === 'multiple') {
        valid = q.options.includes(text);
    } else if (q.type === 'whatsapp_list') {
        const sections = q.interactive?.action?.sections || [];
        for (const s of sections) {
            for (const r of (s.rows || [])) {
                if (r.title === text) { valid = true; value = r.title; break; }
            }
            if (valid) break;
        }
    } else if (q.type === 'text') {
        valid = text.trim().length > 0;
    }

    // Save response
    if (valid && step.data.saveResponse) {
        if (step.data.saveResponse.hasVariable && step.data.saveResponse.variable)
            session.variables[step.data.saveResponse.variable] = value;
        if (step.data.saveResponse.hasField && step.data.saveResponse.field)
            session.contact[step.data.saveResponse.field] = value;
    }

    session.waitingForStep = null;
    const childType = valid ? 'ValidAnswer' : 'InvalidAnswer';
    const child = (step.childs || []).find(c => c.type === childType);
    if (child?.childs?.[0]) {
        await botExecStep(child.childs[0], session, phone);
    } else if (!valid) {
        await botExecStep(step, session, phone); // Retry
    }
}

// Main chatbot handler
async function handleChatbot(phone, content, contactName) {
    let session = getBotSession(phone);

    if (!session) {
        // New conversation - start chatbot
        session = {
            variables: {},
            contact: { name: contactName, phone_number: phone, email: '' },
            waitingForStep: null,
            lastActivity: Date.now(),
            jumpCounts: {}
        };
        chatbotSessions.set(phone, session);
        const trigger = chatbotWorkflow.tree;
        if (trigger.childs?.[0]) await botExecStep(trigger.childs[0], session, phone);
        return;
    }

    if (session.waitingForStep) {
        const step = stepIndex.get(session.waitingForStep);
        if (step?.type === 'QuestionStep') {
            await botProcessResponse(step, session, phone, content);
        }
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
        console.error('Send message error:', error.response?.data || error);
        const whatsappError = error.response?.data?.error;
        res.status(500).json({
            error: whatsappError?.message || error.message,
            error_code: whatsappError?.code,
            details: whatsappError?.error_data?.details || ''
        });
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
        const { phone, templateName = 'code_otp', language = 'en', accountId } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Format phone number
        const formattedPhone = phone.replace(/[\s+\-]/g, '');

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP with 5-minute expiry
        otpStore.set(formattedPhone, {
            code: otp,
            expires: Date.now() + 5 * 60 * 1000, // 5 minutes
            attempts: 0
        });

        // Get account
        const account = getAccount(accountId);
        if (!account.token) {
            return res.status(400).json({ error: 'No token configured for this account' });
        }

        // Send OTP via WhatsApp Template
        const url = `${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`;
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedPhone,
            type: 'template',
            template: {
                name: templateName,
                language: { code: language },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: otp }
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: '0',
                        parameters: [
                            { type: 'text', text: otp }
                        ]
                    }
                ]
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${account.token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`OTP sent to ${formattedPhone}: ${otp}`);

        res.json({
            success: true,
            message: 'OTP sent successfully',
            messageId: response.data.messages?.[0]?.id,
            expiresIn: 300 // 5 minutes in seconds
        });

    } catch (error) {
        console.error('OTP send error:', error.response?.data || error);
        res.status(500).json({ error: error.response?.data?.error?.message || 'Failed to send OTP' });
    }
});

// Verify OTP
app.post('/api/otp/verify', (req, res) => {
    try {
        const { phone, code } = req.body;

        if (!phone || !code) {
            return res.status(400).json({ error: 'Phone number and OTP code are required' });
        }

        const formattedPhone = phone.replace(/[\s+\-]/g, '');
        const storedOtp = otpStore.get(formattedPhone);

        if (!storedOtp) {
            return res.status(400).json({
                success: false,
                error: 'No OTP was sent to this number'
            });
        }

        // Check expiry
        if (Date.now() > storedOtp.expires) {
            otpStore.delete(formattedPhone);
            return res.status(400).json({
                success: false,
                error: 'OTP has expired'
            });
        }

        // Check attempts (max 3)
        if (storedOtp.attempts >= 3) {
            otpStore.delete(formattedPhone);
            return res.status(400).json({
                success: false,
                error: 'Maximum attempts exceeded'
            });
        }

        // Verify code
        if (storedOtp.code === code) {
            otpStore.delete(formattedPhone);
            console.log(`OTP verified for ${formattedPhone}`);
            return res.json({
                success: true,
                message: 'OTP verified successfully',
                verified: true
            });
        } else {
            storedOtp.attempts++;
            return res.status(400).json({
                success: false,
                error: 'Invalid OTP code',
                attemptsLeft: 3 - storedOtp.attempts
            });
        }

    } catch (error) {
        console.error('OTP verify error:', error);
        res.status(500).json({ error: 'Verification failed' });
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
