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
const nodemailer = require('nodemailer');
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
        token: process.env.GOLDEN_HOST_TOKEN || 'EAAa4f8LAgtEBQp8w03BiZARzFAsh08ZB2MymaRnQcryJvAcrVyU8EFp7dvGVRh4xNkOUu4Mc6yxzb9vOYC3oZCnHCTnZCWsnXkVZAKhRZC9Hl9vHpXt611E9GRkbqM4zBMHUZAPVln5rgt5XODLwn9VBmR4jKJxyUMYzd7T96BAnZBzYK5pZClUSoOZCYzLhx6DgZDZD'
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

// Resolve phone_number_id to accountId
function resolveAccountByPhoneNumberId(phoneNumberId) {
    for (const [id, acc] of Object.entries(WHATSAPP_ACCOUNTS)) {
        if (acc.phoneNumberId === phoneNumberId) return id;
    }
    return CONFIG.DEFAULT_ACCOUNT;
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
                databaseURL: 'https://ticket-system-d693a-default-rtdb.firebaseio.com'
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
    // Determine which account this message belongs to
    const accountId = resolveAccountByPhoneNumberId(metadata.phone_number_id);
    const account = getAccount(accountId);

    const mediaInfo = extractMediaInfo(message);
    const messageData = {
        id: message.id,
        from: message.from,
        timestamp: new Date(parseInt(message.timestamp) * 1000).toISOString(),
        type: message.type,
        customerName: contact.profile?.name || 'Unknown',
        customerPhone: message.from,
        phoneNumberId: metadata.phone_number_id,
        accountId: accountId,
        accountName: account.name,
        content: extractMessageContent(message),
        status: 'received',
        channel: 'whatsapp_meta'
    };

    // Add media metadata if present
    if (mediaInfo) {
        messageData.media_id = mediaInfo.media_id;
        messageData.mime_type = mediaInfo.mime_type;
        if (mediaInfo.filename) messageData.filename = mediaInfo.filename;
    }

    console.log('Processing message:', { from: message.from, account: accountId, type: message.type });

    // Save to Firebase
    if (db) {
        try {
            // Get or create conversation
            const conversationRef = db.collection('conversations').doc(message.from);
            const conversationDoc = await conversationRef.get();

            if (!conversationDoc.exists) {
                // Create new conversation - tag with accountId
                await conversationRef.set({
                    customerPhone: message.from,
                    customerName: contact.profile?.name || 'Unknown',
                    channel: 'whatsapp_meta',
                    accountId: accountId,
                    accountName: account.name,
                    status: 'open',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    unreadCount: 1
                });
            } else {
                // Update existing conversation - also update accountId (in case customer messages different number)
                await conversationRef.update({
                    accountId: accountId,
                    accountName: account.name,
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
            return message.image?.caption || '';
        case 'video':
            return message.video?.caption || '';
        case 'audio':
            return '';
        case 'document':
            return message.document?.filename || 'file';
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

// Extract media metadata from WhatsApp message
function extractMediaInfo(message) {
    switch (message.type) {
        case 'image':
            return { media_id: message.image?.id, mime_type: message.image?.mime_type };
        case 'video':
            return { media_id: message.video?.id, mime_type: message.video?.mime_type };
        case 'audio':
            return { media_id: message.audio?.id, mime_type: message.audio?.mime_type };
        case 'document':
            return { media_id: message.document?.id, mime_type: message.document?.mime_type, filename: message.document?.filename };
        case 'sticker':
            return { media_id: message.sticker?.id, mime_type: message.sticker?.mime_type };
        default:
            return null;
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

// Save bot message to storage (Firebase/memory) so it shows in frontend
async function saveBotMessage(phone, content, messageId) {
    const account = getAccount(BOT_ACCOUNT);
    if (db) {
        try {
            const conversationRef = db.collection('conversations').doc(phone);
            await conversationRef.collection('messages').add({
                id: messageId,
                from: 'bot',
                to: phone,
                content: content,
                type: 'text',
                status: 'sent',
                channel: 'whatsapp_meta',
                accountId: BOT_ACCOUNT,
                accountName: account.name,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            await conversationRef.update({
                lastMessage: content,
                lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error('Error saving bot message:', err);
        }
    } else {
        addMemoryMessage(phone, {
            id: messageId,
            from: 'bot',
            to: phone,
            content: content,
            type: 'text',
            status: 'sent',
            channel: 'whatsapp_meta',
            accountId: BOT_ACCOUNT,
            accountName: account.name
        });
    }
}

// Send text message from bot
async function botSendText(phone, text) {
    const account = getAccount(BOT_ACCOUNT);
    const resp = await axios.post(`${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text }
    }, { headers: { 'Authorization': `Bearer ${account.token}`, 'Content-Type': 'application/json' } });
    await saveBotMessage(phone, text, resp.data.messages?.[0]?.id);
}

// Send interactive buttons (max 3 options, max 20 chars each)
async function botSendButtons(phone, text, options) {
    const account = getAccount(BOT_ACCOUNT);
    const resp = await axios.post(`${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', to: phone, type: 'interactive',
        interactive: {
            type: 'button', body: { text },
            action: { buttons: options.map((opt, i) => ({ type: 'reply', reply: { id: `opt_${i}`, title: opt.substring(0, 20) } })) }
        }
    }, { headers: { 'Authorization': `Bearer ${account.token}`, 'Content-Type': 'application/json' } });
    await saveBotMessage(phone, text + '\n' + options.join(' | '), resp.data.messages?.[0]?.id);
}

// Send interactive list
async function botSendList(phone, interactive) {
    const account = getAccount(BOT_ACCOUNT);
    const resp = await axios.post(`${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp', to: phone, type: 'interactive', interactive
    }, { headers: { 'Authorization': `Bearer ${account.token}`, 'Content-Type': 'application/json' } });
    const bodyText = interactive.body?.text || '[Interactive List]';
    await saveBotMessage(phone, bodyText, resp.data.messages?.[0]?.id);
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

// ==================== Tickets API ====================

const TICKET_API = {
    url: 'https://ticket-ticket-production.up.railway.app/api/ticket',
    apiKey: 'bevatel_ticket_2024_secure_key_x7k9m2'
};

// Get all tickets
app.get('/api/tickets', async (req, res) => {
    try {
        const response = await axios.get(TICKET_API.url, {
            headers: {
                'X-API-Key': TICKET_API.apiKey,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Get tickets error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// Get single ticket
app.get('/api/tickets/:id', async (req, res) => {
    try {
        const response = await axios.get(`${TICKET_API.url}/${req.params.id}`, {
            headers: {
                'X-API-Key': TICKET_API.apiKey,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Get ticket error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data || error.message });
    }
});

// ==================== OTP System ====================

// OTP Storage (in memory - for production use Redis or database)
const otpStore = new Map();

// Generate and send OTP
app.post('/api/otp/send', async (req, res) => {
    try {
        const { phone, templateName = 're', accountId, languageCode = 'en' } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
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
            return res.status(400).json({ error: 'No token configured for this account' });
        }

        // Send OTP via WhatsApp Template
        const url = `${CONFIG.META_API_URL}/${account.phoneNumberId}/messages`;

        // Build template object
        const templateObj = {
            name: templateName,
            language: { code: languageCode }
        };

        // Add body component with OTP code
        templateObj.components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: otp }
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
            message: 'OTP sent successfully',
            messageId: response.data.messages?.[0]?.id,
            expiresIn: 600 // 10 minutes in seconds
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

// ==================== Media Download Proxy ====================

// Download media from WhatsApp by media_id
// This proxies the request through our server so the frontend doesn't need the token
app.get('/api/media/:mediaId', async (req, res) => {
    try {
        const { mediaId } = req.params;
        const { accountId } = req.query;
        const account = getAccount(accountId);

        if (!account.token) {
            return res.status(400).json({ error: 'No token configured' });
        }

        // Step 1: Get the media URL from WhatsApp
        const mediaInfoResponse = await axios.get(`${CONFIG.META_API_URL}/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${account.token}` }
        });

        const mediaUrl = mediaInfoResponse.data.url;
        if (!mediaUrl) {
            return res.status(404).json({ error: 'Media URL not found' });
        }

        // Step 2: Download the actual media file
        const mediaResponse = await axios.get(mediaUrl, {
            headers: { 'Authorization': `Bearer ${account.token}` },
            responseType: 'arraybuffer'
        });

        // Set appropriate content type
        const contentType = mediaResponse.headers['content-type'] || 'application/octet-stream';
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(mediaResponse.data);

    } catch (error) {
        console.error('Media download error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to download media' });
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

// ==================== Admin Email Notification ====================

app.post('/api/notify-admin', async (req, res) => {
    try {
        const { type, userEmail, userName, adminEmail } = req.body;

        if (!userEmail || !adminEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Try sending email via nodemailer (Gmail SMTP)
        const gmailUser = process.env.GMAIL_USER;
        const gmailPass = process.env.GMAIL_APP_PASSWORD;

        if (gmailUser && gmailPass) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: gmailUser,
                    pass: gmailPass
                }
            });

            const platformUrl = req.headers.origin || req.headers.referer || 'https://goldenhost-production-c79d.up.railway.app/customer-chat.html';

            await transporter.sendMail({
                from: `"Golden conv" <${gmailUser}>`,
                to: adminEmail,
                subject: `طلب وصول جديد - ${userName || userEmail}`,
                html: `
                    <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; border-radius: 10px;">
                        <h2 style="color: #667eea;">طلب وصول جديد للمنصة</h2>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <p><strong>الاسم:</strong> ${userName || 'غير معروف'}</p>
                            <p><strong>الإيميل:</strong> ${userEmail}</p>
                            <p><strong>التاريخ:</strong> ${new Date().toLocaleString('ar-SA')}</p>
                        </div>
                        <p>لقبول أو رفض الطلب، ادخل المنصة واضغط على زر "طلبات":</p>
                        <a href="${platformUrl}" style="display:inline-block; background: #667eea; color: white; padding: 10px 25px; border-radius: 8px; text-decoration: none; font-weight: bold;">فتح المنصة</a>
                    </div>
                `
            });

            console.log(`Admin notification email sent to ${adminEmail} about ${userEmail}`);
            res.json({ success: true, method: 'email' });
        } else {
            // No email config - just log it
            console.log(`ACCESS REQUEST: ${userName} (${userEmail}) - Admin: ${adminEmail} - Email not configured`);
            res.json({ success: true, method: 'log_only', note: 'GMAIL_USER and GMAIL_APP_PASSWORD not set' });
        }
    } catch (error) {
        console.error('Notify admin error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== Firebase Auth Proxy (for iOS Safari) ====================
// Proxies /__/auth/* requests to Firebase so auth works on same domain
// This fixes iOS Safari blocking third-party cookies from firebaseapp.com

app.all('/__/auth/*', async (req, res) => {
    const firebaseAuthDomain = 'ticket-system-d693a.firebaseapp.com';
    const targetUrl = `https://${firebaseAuthDomain}${req.originalUrl}`;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: {
                ...req.headers,
                host: firebaseAuthDomain
            },
            data: req.method !== 'GET' ? req.body : undefined,
            responseType: 'arraybuffer',
            validateStatus: () => true
        });

        // Forward response headers
        Object.entries(response.headers).forEach(([key, value]) => {
            if (key !== 'transfer-encoding' && key !== 'connection') {
                res.set(key, value);
            }
        });

        res.status(response.status).send(response.data);
    } catch (error) {
        console.error('Auth proxy error:', error.message);
        res.status(502).json({ error: 'Auth proxy failed' });
    }
});

// ==================== Static Files (AFTER API routes) ====================

app.use(express.static(__dirname));

// ==================== Start Server ====================

app.listen(PORT, () => {
    const accountsInfo = Object.entries(WHATSAPP_ACCOUNTS).map(([id, acc]) =>
        `    - ${acc.name} (${id}): Phone ${acc.phoneNumberId} | Token: ${acc.token ? 'Set' : 'NOT SET'}`
    ).join('\n');
    console.log(`
    ========================================
    Golden Host WhatsApp Backend
    ========================================
    Server running on port ${PORT}
    Webhook URL: https://your-railway-url.up.railway.app/webhook

    WhatsApp Accounts:
${accountsInfo}
    ========================================
    `);
});
