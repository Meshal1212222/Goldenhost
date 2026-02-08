# Golden Host - WhatsApp Backend

Backend server for Meta WhatsApp Business API integration.

## Deployment on Railway

### Step 1: Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub

### Step 2: Deploy
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose this repository
4. Select the `whatsapp-backend` folder

### Step 3: Add Environment Variables
In Railway dashboard, add these variables:

| Variable | Value |
|----------|-------|
| `WHATSAPP_TOKEN` | Your Meta access token |
| `PHONE_NUMBER_ID` | 529770810215816 |
| `WABA_ID` | 435381729669619 |
| `VERIFY_TOKEN` | goldenhost_webhook_2024 |
| `FIREBASE_SERVICE_ACCOUNT` | Your Firebase service account JSON |

### Step 4: Get Your Railway URL
After deployment, Railway gives you a URL like:
```
https://your-app-name.up.railway.app
```

### Step 5: Configure Meta Webhook
1. Go to Meta Developer Console
2. Go to WhatsApp > Configuration
3. Add Webhook URL: `https://your-app.up.railway.app/webhook`
4. Verify Token: `goldenhost_webhook_2024`
5. Subscribe to: `messages`

## API Endpoints

### Send Message
```bash
POST /api/send-message
{
  "to": "966501234567",
  "message": "Hello!"
}
```

### Get Conversations
```bash
GET /api/conversations
```

### Get Messages
```bash
GET /api/conversations/:phone/messages
```

## Firebase Setup

1. Go to Firebase Console > Project Settings > Service Accounts
2. Click "Generate new private key"
3. Copy the entire JSON content
4. Paste it as the `FIREBASE_SERVICE_ACCOUNT` environment variable in Railway

## Testing

```bash
# Health check
curl https://your-app.up.railway.app/health

# Send test message
curl -X POST https://your-app.up.railway.app/api/send-message \
  -H "Content-Type: application/json" \
  -d '{"to": "966501234567", "message": "Test message"}'
```
