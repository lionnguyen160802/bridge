# 🚀 Hướng Dẫn Cài Đặt & Sử Dụng — Flow Auto Generator v4.4

> **Flow Auto Generator** là Chrome Extension tự động hóa hoàn toàn quy trình tạo video AI trên Google Flow (Video FX) — từ nhận prompt, chọn nhân vật, gửi lệnh render, đến tải video & upload Google Drive — chạy 24/7 trên VPS.

---

## 📑 Mục Lục

- [1. Yêu Cầu Hệ Thống](#-1-yêu-cầu-hệ-thống)
- [2. Cài Đặt Bridge Server](#-2-cài-đặt-bridge-server)
  - [2.1 Cài đặt Local](#21-cài-đặt-local)
  - [2.2 Deploy lên VPS / Render](#22-deploy-lên-vps--render)
- [3. Cài Đặt Chrome Extension](#-3-cài-đặt-chrome-extension)
- [4. Cấu Hình Extension (Popup Settings)](#-4-cấu-hình-extension-popup-settings)
  - [4.1 Cấu hình Bridge](#41-cấu-hình-bridge)
  - [4.2 Cấu hình Google Drive (Tùy chọn)](#42-cấu-hình-google-drive-tùy-chọn)
  - [4.3 Cấu hình Webhook (Tùy chọn)](#43-cấu-hình-webhook-tùy-chọn)
- [5. Tạo Google Drive OAuth Credentials](#-5-tạo-google-drive-oauth-credentials)
- [6. Hướng Dẫn Sử Dụng](#-6-hướng-dẫn-sử-dụng)
  - [6.1 Giao diện Dashboard](#61-giao-diện-dashboard)
  - [6.2 Gửi Job Thủ Công](#62-gửi-job-thủ-công)
  - [6.3 Gửi Job từ n8n / API](#63-gửi-job-từ-n8n--api)
  - [6.4 Quản Lý Queue](#64-quản-lý-queue)
  - [6.5 Theo Dõi Tiến Trình](#65-theo-dõi-tiến-trình)
  - [6.6 Xử Lý Lỗi & Retry](#66-xử-lý-lỗi--retry)
- [7. API Reference — Bridge Server](#-7-api-reference--bridge-server)
- [8. Cấu Hình Nâng Cao](#-8-cấu-hình-nâng-cao)
  - [8.1 Auto-Refresh Tab](#81-auto-refresh-tab)
  - [8.2 Chạy trên VPS 24/7](#82-chạy-trên-vps-247)
- [9. Xử Lý Sự Cố (Troubleshooting)](#-9-xử-lý-sự-cố-troubleshooting)
- [10. FAQ — Câu Hỏi Thường Gặp](#-10-faq--câu-hỏi-thường-gặp)

---

## 📋 1. Yêu Cầu Hệ Thống

| Thành phần | Yêu cầu |
|:---|:---|
| **Google Chrome** | Phiên bản 116+ (hỗ trợ Manifest V3) |
| **Node.js** | Phiên bản 18+ (Bridge Server cần native `fetch`) |
| **npm** | Đi kèm Node.js |
| **Tài khoản Google** | Đã đăng nhập Google Flow tại `https://labs.google/fx` |
| **Hệ điều hành** | Windows / macOS / Linux (VPS khuyến nghị dùng Linux) |
| **RAM (VPS)** | Tối thiểu 2GB (Chrome + Extension chạy liên tục) |

> [!IMPORTANT]
> Extension cần quyền **Chrome Debugger API** để gõ text vào Google Flow. Khi chạy, Chrome sẽ hiển thị thanh cảnh báo `"Flow Auto Generator" started debugging this browser` — **không được đóng** thanh cảnh báo này.

---

## 🖥️ 2. Cài Đặt Bridge Server

Bridge Server là cầu nối giữa hệ thống bên ngoài (n8n, API) và Chrome Extension. Giao tiếp qua HTTP REST API + WebSocket.

### 2.1 Cài đặt Local

```bash
# 1. Di chuyển vào thư mục bridge
cd flow-auto-generator/bridge

# 2. Cài đặt dependencies
npm install

# 3. Khởi chạy server (mặc định port 3500)
npm start
```

**Kết quả mong đợi:**
```
🚀 Bridge Server running on port 3500
📡 WebSocket Server ready
📦 Loaded queue: 0 pending, 0 completed, 0 failed
```

**Tuỳ chỉnh port:**
```bash
# Windows (PowerShell)
$env:PORT=4000; node server.js

# Linux / macOS
PORT=4000 node server.js
```

**Kiểm tra server hoạt động:**
```bash
curl http://localhost:3500/
```
Phản hồi:
```json
{
  "status": "ok",
  "extensionConnected": false,
  "queueLength": 0,
  "processing": false,
  "uptime": 12
}
```

### 2.2 Deploy lên VPS / Render

#### Render (Khuyến nghị cho miễn phí)

1. Push code folder `bridge/` lên GitHub repository
2. Truy cập [render.com](https://render.com) → **New Web Service**
3. Kết nối GitHub repo
4. Cấu hình:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment**: Node 18+
5. Deploy → ghi nhớ URL (VD: `https://bridge-xxxx.onrender.com`)

#### VPS (Linux)

```bash
# Cài Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Clone project & chạy
cd /opt
git clone <your-repo-url> flow-auto-generator
cd flow-auto-generator/bridge
npm install

# Chạy bằng PM2 (process manager)
npm install -g pm2
pm2 start server.js --name bridge-server
pm2 save
pm2 startup    # Tự khởi động khi reboot
```

> [!TIP]
> Nếu deploy trên cloud, nhớ mở port bridge server (mặc định 3500) trong firewall/security group. Nếu dùng reverse proxy (Nginx), cần cấu hình WebSocket upgrade:
> ```nginx
> location / {
>     proxy_pass http://127.0.0.1:3500;
>     proxy_http_version 1.1;
>     proxy_set_header Upgrade $http_upgrade;
>     proxy_set_header Connection "upgrade";
> }
> ```

---

## 🧩 3. Cài Đặt Chrome Extension

### Bước 1: Mở Chrome Extensions

Truy cập `chrome://extensions/` trên thanh địa chỉ Chrome.

### Bước 2: Bật Developer Mode

Bật công tắc **"Developer mode"** ở góc trên bên phải.

### Bước 3: Load Extension

1. Nhấn **"Load unpacked"**
2. Chọn thư mục `flow-auto-generator/` (thư mục gốc chứa `manifest.json`)
3. Extension sẽ xuất hiện trong danh sách với tên **"Flow Auto Generator"**

### Bước 4: Ghim Extension

Nhấn icon puzzle 🧩 trên thanh Chrome → nhấn ghim 📌 cạnh **"Flow Auto Generator"** để dễ truy cập.

### Bước 5: Mở trang Google Flow

Truy cập: `https://labs.google/fx/vi/tools/flow`

> [!NOTE]
> Đảm bảo bạn đã **đăng nhập tài khoản Google** trước khi mở Google Flow. Extension cần Google session để hoạt động.

### Bước 6: Xác nhận kết nối

Nhấn vào icon Extension trên thanh Chrome → popup mở ra → kiểm tra:
- **Bridge**: 🟢 `Connected` (nếu Bridge Server đang chạy)
- **State**: `⏸️ Chờ job`

---

## ⚙️ 4. Cấu Hình Extension (Popup Settings)

Mở popup Extension → kéo xuống mục **⚙️ Cài đặt** → nhấn để mở rộng.

### 4.1 Cấu hình Bridge

| Trường | Mô tả | Mặc định |
|:---|:---|:---|
| **Bridge URL** | URL HTTP của Bridge Server | `https://bridge-u03a.onrender.com` |
| **WS URL** | URL WebSocket của Bridge Server | `wss://bridge-u03a.onrender.com` |
| **Download Path** | Thư mục lưu video khi download | `FlowVideos` |

**Ví dụ cấu hình cho local:**
```
Bridge URL:  http://localhost:3500
WS URL:      ws://localhost:3500
```

**Ví dụ cấu hình cho Render:**
```
Bridge URL:  https://bridge-xxxx.onrender.com
WS URL:      wss://bridge-xxxx.onrender.com
```

> [!CAUTION]
> Sau khi thay đổi Bridge URL / WS URL, nhấn **"💾 Lưu cài đặt"** → Extension sẽ tự động reconnect WebSocket.

### 4.2 Cấu hình Google Drive (Tùy chọn)

Nếu muốn tự động upload video lên Google Drive sau khi render xong:

| Trường | Mô tả |
|:---|:---|
| **Drive Folder ID** | ID thư mục Drive đích (lấy từ URL thư mục Drive) |
| **Drive Client ID** | OAuth 2.0 Client ID (từ Google Cloud Console) |
| **Drive Client Secret** | OAuth 2.0 Client Secret |
| **Drive Refresh Token** | OAuth 2.0 Refresh Token (không hết hạn) |

> Xem [Mục 5](#-5-tạo-google-drive-oauth-credentials) để biết cách tạo credentials.

### 4.3 Cấu hình Webhook (Tùy chọn)

| Trường | Mô tả |
|:---|:---|
| **Default Webhook URL** | URL webhook mặc định để nhận callback khi job hoàn tất |

Webhook sẽ nhận POST request với payload:
```json
{
  "jobId": "project_scene_1_1234567890",
  "rowId": "row_42",
  "projectId": "my_project",
  "sceneId": "scene_01",
  "status": "COMPLETED",
  "result": {
    "videos": ["https://drive.google.com/file/d/.../view"],
    "driveUrl": "https://drive.google.com/file/d/.../view"
  },
  "completedAt": 1720000000000
}
```

---

## 🔑 5. Tạo Google Drive OAuth Credentials

> [!NOTE]
> Bước này chỉ cần nếu bạn muốn tự động upload video lên Google Drive. Nếu không cần, có thể bỏ qua.

### Bước 1: Tạo Project trên Google Cloud Console

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project có sẵn

### Bước 2: Bật Google Drive API

1. Vào **APIs & Services** → **Library**
2. Tìm **"Google Drive API"** → nhấn **Enable**

### Bước 3: Tạo OAuth 2.0 Credentials

1. Vào **APIs & Services** → **Credentials**
2. Nhấn **"+ CREATE CREDENTIALS"** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Flow Auto Generator`
5. Authorized redirect URIs: thêm `https://developers.google.com/oauthplayground`
6. Nhấn **Create** → ghi nhớ **Client ID** và **Client Secret**

### Bước 4: Cấu hình OAuth Consent Screen

1. Vào **OAuth consent screen**
2. User type: **External** (hoặc Internal nếu Google Workspace)
3. Điền thông tin app → thêm scope: `https://www.googleapis.com/auth/drive.file`
4. Thêm test user (email của bạn) nếu app ở trạng thái Testing

### Bước 5: Lấy Refresh Token

1. Truy cập [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Nhấn ⚙️ (Settings) ở góc phải → tick **"Use your own OAuth credentials"**
3. Nhập **Client ID** và **Client Secret** đã tạo
4. Ở cột trái, chọn **Drive API v3** → tick `https://www.googleapis.com/auth/drive.file`
5. Nhấn **"Authorize APIs"** → đăng nhập Google → cho phép quyền
6. Nhấn **"Exchange authorization code for tokens"**
7. Copy **Refresh Token** (access token sẽ tự động refresh bởi extension)

### Bước 6: Lấy Drive Folder ID

1. Mở Google Drive → mở thư mục muốn lưu video
2. Copy phần ID từ URL: `https://drive.google.com/drive/folders/`**`1ABCxyz123`**
3. Phần **`1ABCxyz123`** chính là Folder ID

### Bước 7: Điền vào Extension

Mở popup Extension → **⚙️ Cài đặt** → điền 4 trường Drive → nhấn **"💾 Lưu cài đặt"**

---

## 📖 6. Hướng Dẫn Sử Dụng

### 6.1 Giao diện Dashboard

Nhấn vào icon Extension trên thanh Chrome để mở popup Dashboard:

```
┌──────────────────────────────────┐
│  Flow Auto Generator     v4.4   │
├──────────────────────────────────┤
│  Bridge: 🟢 Connected           │
│  State:  ⏸️ Chờ job              │
├──────────────────────────────────┤
│  📊 Queue: 0  ✅ Done: 3        │
│  ❌ Failed: 1  🔄 Retries: 0    │
├──────────────────────────────────┤
│  [⏸ Pause] [⏭ Skip] [🚫 Cancel]│
├──────────────────────────────────┤
│  🔄 Auto-Refresh: [====3====] p │
├──────────────────────────────────┤
│  ▸ 📤 Gửi job thủ công          │
│  ▸ ⚙️ Cài đặt                   │
│  ▸ ✅ Hoàn tất (3)              │
│  ▸ ❌ Thất bại (1)              │
│  ▸ 📋 Logs                      │
└──────────────────────────────────┘
```

**Giải thích các thành phần:**

| Thành phần | Mô tả |
|:---|:---|
| **Bridge status** | 🟢 Connected / 🔴 Disconnected — trạng thái kết nối WebSocket tới Bridge |
| **State** | Trạng thái hiện tại của state machine (VD: `🎬 Đang render...`) |
| **Stats** | Tổng quan: số job trong queue, hoàn tất, thất bại, retry |
| **Current Job** | Chi tiết job đang chạy: ID, scene, character, prompt, progress bar, thời gian |
| **Controls** | Pause/Resume, Skip (bỏ qua job hiện tại), Cancel (hủy job) |
| **Auto-Refresh** | Slider điều chỉnh thời gian tự động refresh trang Flow (0–60 phút) |

### 6.2 Gửi Job Thủ Công

Mở popup → **📤 Gửi job thủ công** → điền thông tin:

| Trường | Bắt buộc | Mô tả |
|:---|:---|:---|
| **Prompt** | ✅ | Nội dung prompt mô tả video cần tạo |
| **Character** | ❌ | Tên nhân vật (nhiều nhân vật cách bằng dấu phẩy: `Anna, Ben`) |
| **Webhook URL** | ❌ | URL callback khi job xong (ghi đè default webhook) |
| **Drive Folder ID** | ❌ | ID thư mục Drive (ghi đè default folder) |

Nhấn **"🚀 Gửi"** → Job được thêm vào queue → tự động xử lý.

**Ví dụ prompt:**
```
A cinematic shot of a woman walking through a futuristic neon city at sunset, 
camera slowly zooming in, volumetric lighting, 4K quality
```

**Ví dụ character:**
```
Chanh Pink, Anna
```

### 6.3 Gửi Job từ n8n / API

Gửi HTTP POST request tới Bridge Server:

```bash
curl -X POST https://your-bridge-url.com/generate \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my_project",
    "sceneId": "scene_001",
    "character": "Anna",
    "prompt": "A woman walking through rain in slow motion, cinematic lighting",
    "callbackUrl": "https://your-n8n.com/webhook/video-done",
    "driveFolderId": "1ABCxyz123",
    "rowId": "row_42"
  }'
```

**Payload tham số:**

| Trường | Bắt buộc | Mô tả |
|:---|:---|:---|
| `projectId` | ❌ | ID dự án (dùng để mở đúng project trên Flow) |
| `sceneId` | ❌ | ID scene (dùng để đặt tên file, tracking) |
| `character` | ❌ | Tên nhân vật, phân cách bằng dấu phẩy |
| `prompt` | ✅ | Prompt mô tả video |
| `callbackUrl` | ❌ | URL webhook nhận kết quả |
| `driveFolderId` | ❌ | Google Drive folder ID (ghi đè cài đặt mặc định) |
| `rowId` | ❌ | ID bản ghi nguồn (để mapping kết quả về) |

**Phản hồi thành công:**
```json
{
  "success": true,
  "jobId": "my_project_scene_001_5_1720000000000",
  "position": 1,
  "message": "Job queued at position 1"
}
```

**Ví dụ n8n Workflow:**

```
[Schedule Trigger] → [Google Sheets: Đọc prompt] → [HTTP Request: POST /generate] → [Wait for Webhook callback]
```

### 6.4 Quản Lý Queue

#### Từ Popup Dashboard:

| Nút | Chức năng |
|:---|:---|
| **⏸ Pause** | Tạm dừng xử lý queue (job đang chạy vẫn tiếp tục) |
| **▶ Resume** | Tiếp tục xử lý queue |
| **⏭ Skip** | Bỏ qua job hiện tại → đánh dấu failed → xử lý job tiếp |
| **🚫 Cancel** | Hủy job đang chạy |

#### Từ Bridge API:

```bash
# Xem trạng thái chi tiết
curl https://your-bridge-url.com/status

# Xem toàn bộ queue
curl https://your-bridge-url.com/queue

# Tạm dừng queue
curl -X POST https://your-bridge-url.com/pause

# Tiếp tục queue
curl -X POST https://your-bridge-url.com/resume

# Hủy job cụ thể
curl -X POST https://your-bridge-url.com/cancel \
  -H "Content-Type: application/json" \
  -d '{"jobId": "my_project_scene_001_5_1720000000000"}'

# Retry job đã failed
curl -X POST https://your-bridge-url.com/retry \
  -H "Content-Type: application/json" \
  -d '{"jobId": "my_project_scene_001_5_1720000000000"}'

# Xóa lịch sử + unstick queue
curl -X POST https://your-bridge-url.com/clear-history
```

### 6.5 Theo Dõi Tiến Trình

Khi một job đang chạy, Dashboard hiển thị:

```
┌──────────────────────────────────┐
│  🎯 Job hiện tại                 │
│  ID: my_project_scene_001_5     │
│  Scene: scene_001               │
│  Character: Anna                │
│  Prompt: A woman walking...     │
│                                  │
│  🎬 Đang render...               │
│  ████████████░░░░ 71%            │
│  ⏱️ 2m 35s                       │
└──────────────────────────────────┘
```

**Các trạng thái và ý nghĩa:**

| Icon | Trạng thái | Mô tả | Thời gian ước tính |
|:---|:---|:---|:---|
| ⏸️ | Chờ job | Không có job, đang idle | — |
| 🔍 | Tìm nhân vật | Đang tìm card nhân vật trên UI | 1–30s |
| 👆 | Hover nhân vật | Mô phỏng hover lên card | 1–2s |
| 🖱️ | Click ⋮ menu | Nhấn nút More trên card | 1–2s |
| ⏳ | Chờ dropdown | Chờ menu "Thêm vào câu lệnh" xuất hiện | 1–5s |
| 🖱️ | Thêm vào câu lệnh | Click thêm nhân vật vào prompt | 1–2s |
| ⏳ | Chờ ô nhập | Tìm textarea nhập prompt | 1–5s |
| ✏️ | Nhập prompt | Gõ prompt vào ô nhập (Debugger API) | 1–5s |
| ✅ | Xác nhận input | Kiểm tra prompt đã vào ô | 1–2s |
| ⏎ | Ấn Enter | Gửi lệnh render | 1–2s |
| 🎬 | Đang render... | Chờ AI render video (~2 phút) | **120s+** |
| 🔎 | Kiểm tra hoàn tất | Quét video mới trên trang | 5–30s |
| 💾 | Tải video | Download video → Base64 → Drive upload | 10–60s |
| ✅ | Hoàn tất | Job xong | — |
| ❌ | Lỗi | Job gặp lỗi | — |

### 6.6 Xử Lý Lỗi & Retry

**Tự động retry:** Mỗi trạng thái có cơ chế retry tự động với delay tăng dần. VD: `FIND_CHARACTER` thử tối đa 5 lần (1s, 2s, 5s, 10s, 10s).

**Retry thủ công:** Mở popup → **❌ Thất bại** → nhấn **"🔄 Retry"** bên cạnh job muốn thử lại.

**Retry qua API:**
```bash
curl -X POST https://your-bridge-url.com/retry \
  -H "Content-Type: application/json" \
  -d '{"jobId": "job_id_here"}'
```

**Global timeout:** Nếu job chạy quá **15 phút** → tự động force-fail.

---

## 📡 7. API Reference — Bridge Server

### Base URL
```
http://localhost:3500      (local)
https://your-domain.com    (production)
```

### Endpoints

#### `GET /` — Health Check

**Response:**
```json
{
  "status": "ok",
  "extensionConnected": true,
  "queueLength": 2,
  "processing": true,
  "uptime": 3600
}
```

---

#### `POST /generate` — Tạo Job Mới

**Request Body:**
```json
{
  "projectId": "string (tùy chọn)",
  "sceneId": "string (tùy chọn)",
  "character": "string (tùy chọn, phân cách bằng dấu phẩy)",
  "prompt": "string (bắt buộc)",
  "callbackUrl": "string (tùy chọn)",
  "driveFolderId": "string (tùy chọn)",
  "rowId": "string (tùy chọn)"
}
```

**Response (201):**
```json
{
  "success": true,
  "jobId": "project_scene_1_1720000000000",
  "position": 1,
  "message": "Job queued at position 1"
}
```

**Response (400):**
```json
{
  "success": false,
  "error": "prompt is required"
}
```

---

#### `GET /status` — Trạng Thái Chi Tiết

**Response:**
```json
{
  "extensionConnected": true,
  "paused": false,
  "currentJob": {
    "id": "...",
    "prompt": "...",
    "currentState": "WAIT_RENDER",
    "retryCount": 0
  },
  "queueLength": 3,
  "queue": [...],
  "completedCount": 10,
  "failedCount": 2,
  "recentCompleted": [...],
  "recentFailed": [...]
}
```

---

#### `GET /queue` — Toàn Bộ Queue

**Response:**
```json
{
  "queue": [...],
  "completed": [...],
  "failed": [...],
  "counter": 15
}
```

---

#### `POST /cancel` — Hủy Job

**Request Body:** `{ "jobId": "string" }`  
**Response:** `{ "success": true, "message": "Job cancelled" }`

---

#### `POST /pause` — Tạm Dừng Queue

**Response:** `{ "success": true, "message": "Queue paused" }`

---

#### `POST /resume` — Tiếp Tục Queue

**Response:** `{ "success": true, "message": "Queue resumed" }`

---

#### `POST /retry` — Retry Job Failed

**Request Body:** `{ "jobId": "string" }`  
**Response:** `{ "success": true, "message": "Job re-queued", "newJobId": "..." }`

---

#### `POST /clear-history` — Xóa Lịch Sử

Xóa danh sách completed/failed và unstick job bị kẹt.

**Response:** `{ "success": true, "message": "History cleared" }`

---

## 🔧 8. Cấu Hình Nâng Cao

### 8.1 Auto-Refresh Tab

Google Flow sử dụng WebGL/GPU rendering nặng → rò rỉ RAM khi chạy liên tục. Extension tự động refresh trang định kỳ để giải phóng bộ nhớ.

**Cấu hình:** Popup → **🔄 Auto-Refresh** → kéo slider:

| Giá trị | Hành vi |
|:---|:---|
| **0 phút** | Tắt auto-refresh |
| **1–5 phút** | Khuyến nghị cho VPS (chống rò rỉ RAM) |
| **10–60 phút** | Cho máy có nhiều RAM |

> [!NOTE]
> Auto-refresh sẽ **tự động bỏ qua** nếu đang có job đang chạy. Chỉ refresh khi extension ở trạng thái IDLE.

### 8.2 Chạy trên VPS 24/7

Để chạy hệ thống 24/7 trên VPS Linux:

#### 1. Chạy Chrome headless với VNC

```bash
# Cài đặt Chrome + VNC
sudo apt update
sudo apt install -y google-chrome-stable x11vnc xvfb

# Chạy Chrome với virtual display
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
google-chrome --no-sandbox --disable-gpu \
  --load-extension=/path/to/flow-auto-generator \
  https://labs.google/fx/vi/tools/flow &

# Tùy chọn: VNC để remote desktop
x11vnc -display :99 -forever -passwd yourpassword &
```

#### 2. Chạy Bridge Server với PM2

```bash
cd /path/to/flow-auto-generator/bridge
pm2 start server.js --name bridge-server
pm2 save
pm2 startup
```

#### 3. Monitoring

```bash
# Kiểm tra Bridge Server
pm2 status bridge-server
pm2 logs bridge-server

# Kiểm tra extension
curl http://localhost:3500/status
```

> [!WARNING]
> **RAM trên VPS**: Chrome với Google Flow tiêu tốn ~1–2GB RAM. Đảm bảo VPS có ít nhất **2GB RAM** (khuyến nghị 4GB). Bật auto-refresh 3–5 phút để giảm memory leak.

---

## 🔍 9. Xử Lý Sự Cố (Troubleshooting)

### Bridge hiển thị 🔴 Disconnected

| Nguyên nhân | Cách xử lý |
|:---|:---|
| Bridge Server chưa chạy | Chạy `npm start` trong thư mục `bridge/` |
| Sai URL trong settings | Kiểm tra Bridge URL và WS URL trong popup Settings |
| Firewall chặn port | Mở port 3500 (hoặc port tùy chỉnh) |
| SSL/HTTPS mismatch | URL `https://` cần WS URL `wss://`, URL `http://` cần `ws://` |

### Job bị stuck ở trạng thái nào đó

1. **Chờ timeout + retry tự động**: Mỗi state có timeout riêng (10s–10 phút)
2. **Skip thủ công**: Popup → nhấn **"⏭ Skip"**
3. **Hủy job**: Popup → nhấn **"🚫 Cancel"**
4. **Clear stuck jobs**: 
   ```bash
   curl -X POST https://your-bridge/clear-history
   ```

### Prompt không được nhập vào ô

| Nguyên nhân | Cách xử lý |
|:---|:---|
| DevTools đang mở | Đóng DevTools (Chrome Debugger API conflict) |
| Tab Flow không active | Extension sẽ tự tìm/mở tab Flow |
| Google Flow UI thay đổi | Cập nhật phiên bản inject.js mới |

### Video không tải được

| Nguyên nhân | Cách xử lý |
|:---|:---|
| Render chưa xong | Thời gian render mặc định ~2 phút, job sẽ chờ tự động |
| Video quá lớn (>50MB) | Có thể gây OOM khi convert Base64 |
| Token hết hạn | Extension tự động intercept token mới |

### Google Drive upload thất bại

| Nguyên nhân | Cách xử lý |
|:---|:---|
| Chưa cấu hình OAuth | Điền đầy đủ Client ID, Client Secret, Refresh Token |
| Refresh Token hết hạn | Tạo lại Refresh Token tại OAuth Playground |
| Folder ID sai | Kiểm tra lại ID từ URL thư mục Drive |
| Quota API vượt mức | Kiểm tra Google Cloud Console → Quotas |

### Extension bị crash / không phản hồi

1. Truy cập `chrome://extensions/`
2. Tìm **Flow Auto Generator** → nhấn **"Reload"** (🔄)
3. Mở lại trang Google Flow
4. Extension sẽ tự động reconnect Bridge

---

## ❓ 10. FAQ — Câu Hỏi Thường Gặp

### Q: Extension có cần Chrome mở suốt không?
**A:** Có. Extension là Chrome Extension nên cần Chrome browser chạy liên tục. Trên VPS, dùng Xvfb (virtual display) để chạy Chrome headless.

### Q: Có thể chạy nhiều job song song không?
**A:** Không. Hệ thống xử lý **tuần tự** — một job tại một thời điểm. Các job khác nằm trong queue chờ.

### Q: Job mất bao lâu để hoàn tất?
**A:** Trung bình **3–5 phút** mỗi job:
- Chọn nhân vật + nhập prompt: ~10–30s
- AI render video: **~2 phút** (phụ thuộc Google)
- Download + upload Drive: ~10–30s

### Q: Dữ liệu queue có bị mất khi restart Bridge?
**A:** Không. Queue được lưu persistent trong file `queue.json`. Khi restart, Bridge tự động load lại queue và reset job bị stuck.

### Q: Có hỗ trợ nhiều nhân vật trong một video không?
**A:** Có. Nhập tên các nhân vật phân cách bằng dấu phẩy (VD: `Anna, Ben, Charlie`). Extension sẽ lần lượt thêm từng nhân vật trước khi nhập prompt.

### Q: Cần làm gì khi Google Flow thay đổi giao diện?
**A:** Có thể cần cập nhật file `inject.js` — đặc biệt các selector CSS và aria-label dùng để tìm phần tử UI. Kiểm tra logs trong popup để xem lỗi cụ thể.

### Q: Port 3500 đã bị chiếm?
**A:** Đổi port bằng biến môi trường:
```bash
PORT=4000 node server.js
```
Sau đó cập nhật Bridge URL trong popup Settings.

### Q: Webhook callback không nhận được?
**A:** Bridge retry callback tối đa **3 lần** với delay tăng dần (2s, 4s, 6s). Kiểm tra:
- `callbackUrl` có đúng và accessible không
- Server webhook có đang chạy không
- Firewall/CORS có chặn không

### Q: Làm sao biết video đã upload lên Drive thành công?
**A:** Kiểm tra trong popup → **✅ Hoàn tất** → xem chi tiết job → trường `driveUrl` sẽ chứa link Google Drive. Hoặc kiểm tra webhook callback payload có trường `result.driveUrl`.

---

> **📝 Tài liệu này được viết cho Flow Auto Generator v4.4**  
> Cập nhật lần cuối: Tháng 7, 2026
