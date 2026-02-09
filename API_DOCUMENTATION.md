# Golden Host - OTP API Documentation

## Base URL
```
https://goldenhost-production.up.railway.app
```

---

## 1. Send OTP (إرسال رمز التحقق)

**Endpoint:** `POST /api/otp/send`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "phone": "201272020627"
}
```

**ملاحظة:** الرقم بدون `+` وبدون مسافات

**Response (نجاح):**
```json
{
  "success": true,
  "message": "تم إرسال رمز التحقق",
  "messageId": "wamid.xxxxx",
  "expiresIn": 600
}
```

**Response (خطأ):**
```json
{
  "error": "رسالة الخطأ"
}
```

---

## 2. Verify OTP (التحقق من الرمز)

**Endpoint:** `POST /api/otp/verify`

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "phone": "201272020627",
  "code": "1234"
}
```

**Response (نجاح):**
```json
{
  "success": true,
  "message": "تم التحقق بنجاح"
}
```

**Response (خطأ):**
```json
{
  "error": "رمز التحقق غير صحيح"
}
```

---

## Laravel Example (مثال لارافيل)

### Controller:
```php
<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class OTPController extends Controller
{
    public function sendOTP(Request $request)
    {
        $request->validate(['phone' => 'required|string']);
        
        $phone = preg_replace('/[\s+\-]/', '', $request->phone);
        
        // Saudi numbers use SMS
        if (str_starts_with($phone, '966')) {
            // Your SMS code here
            return response()->json(['success' => true, 'method' => 'sms']);
        }
        
        // International numbers use WhatsApp
        $response = Http::post('https://goldenhost-production.up.railway.app/api/otp/send', [
            'phone' => $phone
        ]);
        
        return $response->json();
    }

    public function verifyOTP(Request $request)
    {
        $request->validate(['phone' => 'required', 'code' => 'required']);
        
        $phone = preg_replace('/[\s+\-]/', '', $request->phone);
        
        if (str_starts_with($phone, '966')) {
            // Your SMS verification here
            return response()->json(['success' => true]);
        }
        
        $response = Http::post('https://goldenhost-production.up.railway.app/api/otp/verify', [
            'phone' => $phone,
            'code' => $request->code
        ]);
        
        return $response->json();
    }
}
```

### Routes (routes/api.php):
```php
Route::post('/send-otp', [OTPController::class, 'sendOTP']);
Route::post('/verify-otp', [OTPController::class, 'verifyOTP']);
```

---

## Phone Number Format

| Country | Input | Correct Format |
|---------|-------|----------------|
| Egypt +20 | 01272020627 | 201272020627 |
| Morocco +212 | 0612345678 | 212612345678 |
| UAE +971 | 0501234567 | 971501234567 |

**Important:** Remove leading `0` after country code

---

## OTP Details

- **Code Length:** 4 digits
- **Validity:** 10 minutes
- **Max Attempts:** 3
