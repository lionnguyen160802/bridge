const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, TabStopPosition, TabStopType,
  ImageRun, ExternalHyperlink, convertInchesToTwip, TableLayoutType,
} = require('docx');
const fs = require('fs');

// ─── Color Palette ───
const COLORS = {
  primary: '7c3aed',    // Purple
  secondary: '3b82f6',  // Blue
  success: '22c55e',    // Green
  danger: 'ef4444',     // Red
  warning: 'f59e0b',    // Amber
  dark: '1e1e2e',       // Dark bg
  text: '333333',
  textLight: '666666',
  white: 'FFFFFF',
  bg: 'f8f9fc',
  bgAlt: 'eef0f5',
  border: 'dde1e8',
  codeBg: 'f1f3f8',
  tipBg: 'ecfdf5',
  tipBorder: '10b981',
  warnBg: 'fffbeb',
  warnBorder: 'f59e0b',
  cautionBg: 'fef2f2',
  cautionBorder: 'ef4444',
  noteBg: 'eff6ff',
  noteBorder: '3b82f6',
};

// ─── Helpers ───

function heading1(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 36, font: 'Segoe UI', color: COLORS.primary })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    border: { bottom: { color: COLORS.primary, size: 2, style: BorderStyle.SINGLE, space: 8 } },
  });
}

function heading2(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 28, font: 'Segoe UI', color: COLORS.dark })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 160 },
  });
}

function heading3(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, font: 'Segoe UI', color: COLORS.secondary })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 120 },
  });
}

function para(text, opts = {}) {
  const runs = parseInlineFormatting(text);
  return new Paragraph({
    children: runs.map(r => new TextRun({ ...r, size: opts.size || 21, font: opts.font || 'Segoe UI' })),
    spacing: { before: opts.spaceBefore || 80, after: opts.spaceAfter || 80 },
    alignment: opts.align || AlignmentType.LEFT,
  });
}

function parseInlineFormatting(text) {
  const parts = [];
  // Split by **bold** and `code`
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ text: text.slice(lastIdx, match.index), color: COLORS.text });
    }
    if (match[2]) {
      parts.push({ text: match[2], bold: true, color: COLORS.text });
    } else if (match[3]) {
      parts.push({ text: match[3], font: 'Consolas', color: COLORS.primary, shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg } });
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push({ text: text.slice(lastIdx), color: COLORS.text });
  }
  return parts.length ? parts : [{ text, color: COLORS.text }];
}

function bullet(text, level = 0) {
  const runs = parseInlineFormatting(text);
  return new Paragraph({
    children: runs.map(r => new TextRun({ ...r, size: 21, font: 'Segoe UI' })),
    bullet: { level },
    spacing: { before: 40, after: 40 },
  });
}

function numberedItem(number, text) {
  const runs = parseInlineFormatting(text);
  return new Paragraph({
    children: [
      new TextRun({ text: `${number}. `, bold: true, size: 21, font: 'Segoe UI', color: COLORS.primary }),
      ...runs.map(r => new TextRun({ ...r, size: 21, font: 'Segoe UI' })),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: convertInchesToTwip(0.3) },
  });
}

function codeBlock(lines, lang = '') {
  return lines.map((line, i) => new Paragraph({
    children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: COLORS.text })],
    spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 80 : 0 },
    indent: { left: convertInchesToTwip(0.3) },
    shading: { type: ShadingType.CLEAR, fill: COLORS.codeBg },
  }));
}

function alertBox(type, text) {
  const config = {
    note: { label: '📝 GHI CHÚ', bg: COLORS.noteBg, border: COLORS.noteBorder },
    tip: { label: '💡 MẸO', bg: COLORS.tipBg, border: COLORS.tipBorder },
    important: { label: '❗ QUAN TRỌNG', bg: COLORS.warnBg, border: COLORS.warnBorder },
    warning: { label: '⚠️ CẢNH BÁO', bg: COLORS.warnBg, border: COLORS.warnBorder },
    caution: { label: '🚨 CHÚ Ý', bg: COLORS.cautionBg, border: COLORS.cautionBorder },
  };
  const c = config[type] || config.note;
  return [
    new Paragraph({
      children: [new TextRun({ text: c.label, bold: true, size: 20, font: 'Segoe UI', color: c.border })],
      spacing: { before: 160, after: 40 },
      indent: { left: convertInchesToTwip(0.3) },
      shading: { type: ShadingType.CLEAR, fill: c.bg },
      border: { left: { color: c.border, size: 6, style: BorderStyle.SINGLE, space: 8 } },
    }),
    new Paragraph({
      children: parseInlineFormatting(text).map(r => new TextRun({ ...r, size: 20, font: 'Segoe UI' })),
      spacing: { before: 0, after: 160 },
      indent: { left: convertInchesToTwip(0.3) },
      shading: { type: ShadingType.CLEAR, fill: c.bg },
      border: { left: { color: c.border, size: 6, style: BorderStyle.SINGLE, space: 8 } },
    }),
  ];
}

function makeTable(headers, rows) {
  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
    left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
    right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
  };
  const headerRow = new TableRow({
    children: headers.map(h => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: h, bold: true, size: 20, font: 'Segoe UI', color: COLORS.white })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
      })],
      shading: { type: ShadingType.CLEAR, fill: COLORS.primary },
      borders: cellBorder,
      verticalAlign: 'center',
    })),
    tableHeader: true,
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map(cell => new TableCell({
      children: [new Paragraph({
        children: parseInlineFormatting(cell).map(r => new TextRun({ ...r, size: 19, font: 'Segoe UI' })),
        spacing: { before: 40, after: 40 },
      })],
      shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? COLORS.white : COLORS.bg },
      borders: cellBorder,
      verticalAlign: 'center',
    })),
  }));
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
  });
}

function spacer(size = 200) {
  return new Paragraph({ spacing: { before: size, after: 0 }, children: [] });
}

function separator() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { color: COLORS.border, size: 1, style: BorderStyle.SINGLE, space: 6 } },
    children: [],
  });
}

// ══════════════════════════════════════════════════════════════════════
// DOCUMENT 1: SETUP GUIDE
// ══════════════════════════════════════════════════════════════════════
function buildSetupGuide() {
  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Segoe UI', size: 21, color: COLORS.text } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) } },
      },
      children: [
        // ─── Title Page ───
        spacer(1200),
        new Paragraph({
          children: [new TextRun({ text: '🎬', size: 72 })],
          alignment: AlignmentType.CENTER,
        }),
        spacer(200),
        new Paragraph({
          children: [new TextRun({ text: 'FLOW AUTO GENERATOR', bold: true, size: 48, font: 'Segoe UI', color: COLORS.primary })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Hướng Dẫn Cài Đặt & Thiết Lập', size: 32, font: 'Segoe UI', color: COLORS.textLight })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Version 4.4  •  Tháng 7, 2026', size: 22, font: 'Segoe UI', color: COLORS.textLight })],
          alignment: AlignmentType.CENTER,
        }),
        spacer(600),
        new Paragraph({
          children: [new TextRun({ text: 'Chrome Extension tự động hóa hoàn toàn quy trình tạo video AI trên Google Flow (Video FX) — từ nhận prompt, chọn nhân vật, gửi lệnh render, đến tải video & upload Google Drive — chạy 24/7 trên VPS.', size: 21, font: 'Segoe UI', color: COLORS.textLight, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 },
        }),

        // ─── MỤC LỤC ───
        spacer(400),
        separator(),
        heading1('📑 Mục Lục'),
        bullet('Mục 1 — Yêu Cầu Hệ Thống'),
        bullet('Mục 2 — Cài Đặt Bridge Server'),
        bullet('Mục 3 — Cài Đặt Chrome Extension'),
        bullet('Mục 4 — Cấu Hình Extension (Popup Settings)'),
        bullet('Mục 5 — Tạo Google Drive OAuth Credentials'),
        bullet('Mục 6 — Cấu Hình Nâng Cao'),
        bullet('Mục 7 — Chạy Trên VPS 24/7'),
        separator(),

        // ═══════════════════════════════════════
        // MỤC 1: YÊU CẦU HỆ THỐNG
        // ═══════════════════════════════════════
        heading1('📋 1. Yêu Cầu Hệ Thống'),
        spacer(80),
        makeTable(
          ['Thành phần', 'Yêu cầu'],
          [
            ['Google Chrome', 'Phiên bản 116+ (hỗ trợ Manifest V3)'],
            ['Node.js', 'Phiên bản 18+ (Bridge Server cần native fetch)'],
            ['npm', 'Đi kèm Node.js'],
            ['Tài khoản Google', 'Đã đăng nhập Google Flow tại https://labs.google/fx'],
            ['Hệ điều hành', 'Windows / macOS / Linux (VPS khuyến nghị Linux)'],
            ['RAM (VPS)', 'Tối thiểu 2GB (Chrome + Extension chạy liên tục, khuyến nghị 4GB)'],
          ]
        ),
        spacer(100),
        ...alertBox('important', 'Extension cần quyền Chrome Debugger API để gõ text vào Google Flow. Khi chạy, Chrome sẽ hiển thị thanh cảnh báo "Flow Auto Generator started debugging this browser" — KHÔNG ĐƯỢC đóng thanh cảnh báo này.'),

        // ═══════════════════════════════════════
        // MỤC 2: CÀI ĐẶT BRIDGE SERVER
        // ═══════════════════════════════════════
        heading1('🖥️ 2. Cài Đặt Bridge Server'),
        para('Bridge Server là cầu nối giữa hệ thống bên ngoài (n8n, API) và Chrome Extension. Giao tiếp qua HTTP REST API + WebSocket.'),

        heading2('2.1  Cài đặt Local'),
        ...codeBlock([
          '# 1. Di chuyển vào thư mục bridge',
          'cd flow-auto-generator/bridge',
          '',
          '# 2. Cài đặt dependencies',
          'npm install',
          '',
          '# 3. Khởi chạy server (mặc định port 3500)',
          'npm start',
        ]),
        spacer(80),
        para('**Kết quả mong đợi:**'),
        ...codeBlock([
          '🚀 Bridge Server running on port 3500',
          '📡 WebSocket Server ready',
          '📦 Loaded queue: 0 pending, 0 completed, 0 failed',
        ]),

        para('**Tuỳ chỉnh port:**'),
        ...codeBlock([
          '# Windows (PowerShell)',
          '$env:PORT=4000; node server.js',
          '',
          '# Linux / macOS',
          'PORT=4000 node server.js',
        ]),

        para('**Kiểm tra server hoạt động:**'),
        ...codeBlock([
          'curl http://localhost:3500/',
        ]),
        para('Phản hồi mong đợi:'),
        ...codeBlock([
          '{',
          '  "status": "ok",',
          '  "extensionConnected": false,',
          '  "queueLength": 0,',
          '  "processing": false,',
          '  "uptime": 12',
          '}',
        ]),

        heading2('2.2  Deploy lên Render (Miễn phí)'),
        numberedItem(1, 'Push code folder `bridge/` lên GitHub repository'),
        numberedItem(2, 'Truy cập render.com → **New Web Service**'),
        numberedItem(3, 'Kết nối GitHub repo'),
        numberedItem(4, 'Cấu hình:'),
        bullet('**Build Command**: `npm install`', 1),
        bullet('**Start Command**: `node server.js`', 1),
        bullet('**Environment**: Node 18+', 1),
        numberedItem(5, 'Deploy → ghi nhớ URL (VD: `https://bridge-xxxx.onrender.com`)'),

        heading2('2.3  Deploy lên VPS (Linux)'),
        ...codeBlock([
          '# Cài Node.js',
          'curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -',
          'sudo apt install -y nodejs',
          '',
          '# Clone project & chạy',
          'cd /opt',
          'git clone <your-repo-url> flow-auto-generator',
          'cd flow-auto-generator/bridge',
          'npm install',
          '',
          '# Chạy bằng PM2 (process manager)',
          'npm install -g pm2',
          'pm2 start server.js --name bridge-server',
          'pm2 save',
          'pm2 startup    # Tự khởi động khi reboot',
        ]),
        spacer(80),
        ...alertBox('tip', 'Nếu deploy trên cloud, nhớ mở port bridge server (mặc định 3500) trong firewall/security group. Nếu dùng reverse proxy (Nginx), cần cấu hình WebSocket upgrade.'),
        para('**Cấu hình Nginx (nếu dùng reverse proxy):**'),
        ...codeBlock([
          'location / {',
          '    proxy_pass http://127.0.0.1:3500;',
          '    proxy_http_version 1.1;',
          '    proxy_set_header Upgrade $http_upgrade;',
          '    proxy_set_header Connection "upgrade";',
          '}',
        ]),

        // ═══════════════════════════════════════
        // MỤC 3: CÀI ĐẶT CHROME EXTENSION
        // ═══════════════════════════════════════
        heading1('🧩 3. Cài Đặt Chrome Extension'),

        heading2('Bước 1: Mở Chrome Extensions'),
        para('Truy cập `chrome://extensions/` trên thanh địa chỉ Chrome.'),

        heading2('Bước 2: Bật Developer Mode'),
        para('Bật công tắc **"Developer mode"** ở góc trên bên phải.'),

        heading2('Bước 3: Load Extension'),
        numberedItem(1, 'Nhấn **"Load unpacked"**'),
        numberedItem(2, 'Chọn thư mục `flow-auto-generator/` (thư mục gốc chứa `manifest.json`)'),
        numberedItem(3, 'Extension sẽ xuất hiện trong danh sách với tên **"Flow Auto Generator"**'),

        heading2('Bước 4: Ghim Extension'),
        para('Nhấn icon puzzle 🧩 trên thanh Chrome → nhấn ghim 📌 cạnh **"Flow Auto Generator"** để dễ truy cập.'),

        heading2('Bước 5: Mở trang Google Flow'),
        para('Truy cập: `https://labs.google/fx/vi/tools/flow`'),
        ...alertBox('note', 'Đảm bảo bạn đã đăng nhập tài khoản Google trước khi mở Google Flow. Extension cần Google session để hoạt động.'),

        heading2('Bước 6: Xác nhận kết nối'),
        para('Nhấn vào icon Extension trên thanh Chrome → popup mở ra → kiểm tra:'),
        bullet('**Bridge**: 🟢 Connected (nếu Bridge Server đang chạy)'),
        bullet('**State**: ⏸️ Chờ job'),

        // ═══════════════════════════════════════
        // MỤC 4: CẤU HÌNH EXTENSION
        // ═══════════════════════════════════════
        heading1('⚙️ 4. Cấu Hình Extension (Popup Settings)'),
        para('Mở popup Extension → kéo xuống mục **⚙️ Cài đặt** → nhấn để mở rộng.'),

        heading2('4.1  Cấu hình Bridge'),
        makeTable(
          ['Trường', 'Mô tả', 'Mặc định'],
          [
            ['Bridge URL', 'URL HTTP của Bridge Server', 'https://bridge-u03a.onrender.com'],
            ['WS URL', 'URL WebSocket của Bridge Server', 'wss://bridge-u03a.onrender.com'],
            ['Download Path', 'Thư mục lưu video khi download', 'FlowVideos'],
          ]
        ),
        spacer(80),
        para('**Ví dụ cấu hình cho local:**'),
        ...codeBlock([
          'Bridge URL:  http://localhost:3500',
          'WS URL:      ws://localhost:3500',
        ]),
        para('**Ví dụ cấu hình cho Render:**'),
        ...codeBlock([
          'Bridge URL:  https://bridge-xxxx.onrender.com',
          'WS URL:      wss://bridge-xxxx.onrender.com',
        ]),
        ...alertBox('caution', 'Sau khi thay đổi Bridge URL / WS URL, nhấn "💾 Lưu cài đặt" → Extension sẽ tự động reconnect WebSocket.'),

        heading2('4.2  Cấu hình Google Drive (Tùy chọn)'),
        para('Nếu muốn tự động upload video lên Google Drive sau khi render xong:'),
        makeTable(
          ['Trường', 'Mô tả'],
          [
            ['Drive Folder ID', 'ID thư mục Drive đích (lấy từ URL thư mục Drive)'],
            ['Drive Client ID', 'OAuth 2.0 Client ID (từ Google Cloud Console)'],
            ['Drive Client Secret', 'OAuth 2.0 Client Secret'],
            ['Drive Refresh Token', 'OAuth 2.0 Refresh Token (không hết hạn)'],
          ]
        ),
        para('→ Xem **Mục 5** để biết cách tạo credentials.'),

        heading2('4.3  Cấu hình Webhook (Tùy chọn)'),
        makeTable(
          ['Trường', 'Mô tả'],
          [
            ['Default Webhook URL', 'URL webhook mặc định để nhận callback khi job hoàn tất'],
          ]
        ),
        spacer(80),
        para('Webhook sẽ nhận POST request với payload:'),
        ...codeBlock([
          '{',
          '  "jobId": "project_scene_1_1234567890",',
          '  "rowId": "row_42",',
          '  "projectId": "my_project",',
          '  "sceneId": "scene_01",',
          '  "status": "COMPLETED",',
          '  "result": {',
          '    "videos": ["https://drive.google.com/file/d/.../view"],',
          '    "driveUrl": "https://drive.google.com/file/d/.../view"',
          '  },',
          '  "completedAt": 1720000000000',
          '}',
        ]),

        // ═══════════════════════════════════════
        // MỤC 5: TẠO GOOGLE DRIVE OAUTH
        // ═══════════════════════════════════════
        heading1('🔑 5. Tạo Google Drive OAuth Credentials'),
        ...alertBox('note', 'Bước này chỉ cần nếu bạn muốn tự động upload video lên Google Drive. Nếu không cần, có thể bỏ qua.'),

        heading2('Bước 1: Tạo Project trên Google Cloud Console'),
        numberedItem(1, 'Truy cập Google Cloud Console (https://console.cloud.google.com/)'),
        numberedItem(2, 'Tạo project mới hoặc chọn project có sẵn'),

        heading2('Bước 2: Bật Google Drive API'),
        numberedItem(1, 'Vào **APIs & Services** → **Library**'),
        numberedItem(2, 'Tìm **"Google Drive API"** → nhấn **Enable**'),

        heading2('Bước 3: Tạo OAuth 2.0 Credentials'),
        numberedItem(1, 'Vào **APIs & Services** → **Credentials**'),
        numberedItem(2, 'Nhấn **"+ CREATE CREDENTIALS"** → **OAuth client ID**'),
        numberedItem(3, 'Application type: **Web application**'),
        numberedItem(4, 'Name: `Flow Auto Generator`'),
        numberedItem(5, 'Authorized redirect URIs: thêm `https://developers.google.com/oauthplayground`'),
        numberedItem(6, 'Nhấn **Create** → ghi nhớ **Client ID** và **Client Secret**'),

        heading2('Bước 4: Cấu hình OAuth Consent Screen'),
        numberedItem(1, 'Vào **OAuth consent screen**'),
        numberedItem(2, 'User type: **External** (hoặc Internal nếu Google Workspace)'),
        numberedItem(3, 'Điền thông tin app → thêm scope: `https://www.googleapis.com/auth/drive.file`'),
        numberedItem(4, 'Thêm test user (email của bạn) nếu app ở trạng thái Testing'),

        heading2('Bước 5: Lấy Refresh Token'),
        numberedItem(1, 'Truy cập OAuth 2.0 Playground (https://developers.google.com/oauthplayground/)'),
        numberedItem(2, 'Nhấn ⚙️ (Settings) ở góc phải → tick **"Use your own OAuth credentials"**'),
        numberedItem(3, 'Nhập **Client ID** và **Client Secret** đã tạo'),
        numberedItem(4, 'Ở cột trái, chọn **Drive API v3** → tick `https://www.googleapis.com/auth/drive.file`'),
        numberedItem(5, 'Nhấn **"Authorize APIs"** → đăng nhập Google → cho phép quyền'),
        numberedItem(6, 'Nhấn **"Exchange authorization code for tokens"**'),
        numberedItem(7, 'Copy **Refresh Token** (access token sẽ tự động refresh bởi extension)'),

        heading2('Bước 6: Lấy Drive Folder ID'),
        numberedItem(1, 'Mở Google Drive → mở thư mục muốn lưu video'),
        numberedItem(2, 'Copy phần ID từ URL: https://drive.google.com/drive/folders/**1ABCxyz123**'),
        numberedItem(3, 'Phần **1ABCxyz123** chính là Folder ID'),

        heading2('Bước 7: Điền vào Extension'),
        para('Mở popup Extension → **⚙️ Cài đặt** → điền 4 trường Drive → nhấn **"💾 Lưu cài đặt"**'),

        // ═══════════════════════════════════════
        // MỤC 6: CẤU HÌNH NÂNG CAO
        // ═══════════════════════════════════════
        heading1('🔧 6. Cấu Hình Nâng Cao'),

        heading2('6.1  Auto-Refresh Tab'),
        para('Google Flow sử dụng WebGL/GPU rendering nặng → rò rỉ RAM khi chạy liên tục. Extension tự động refresh trang định kỳ để giải phóng bộ nhớ.'),
        para('**Cấu hình:** Popup → **🔄 Auto-Refresh** → điều chỉnh giá trị:'),
        makeTable(
          ['Giá trị', 'Hành vi'],
          [
            ['0 phút', 'Tắt auto-refresh'],
            ['1–5 phút', 'Khuyến nghị cho VPS (chống rò rỉ RAM)'],
            ['10–60 phút', 'Cho máy có nhiều RAM'],
          ]
        ),
        ...alertBox('note', 'Auto-refresh sẽ tự động bỏ qua nếu đang có job đang chạy. Chỉ refresh khi extension ở trạng thái IDLE.'),

        heading2('6.2  Chạy trên VPS 24/7'),
        heading3('Chạy Chrome headless với VNC'),
        ...codeBlock([
          '# Cài đặt Chrome + VNC',
          'sudo apt update',
          'sudo apt install -y google-chrome-stable x11vnc xvfb',
          '',
          '# Chạy Chrome với virtual display',
          'Xvfb :99 -screen 0 1920x1080x24 &',
          'export DISPLAY=:99',
          'google-chrome --no-sandbox --disable-gpu \\',
          '  --load-extension=/path/to/flow-auto-generator \\',
          '  https://labs.google/fx/vi/tools/flow &',
          '',
          '# Tùy chọn: VNC để remote desktop',
          'x11vnc -display :99 -forever -passwd yourpassword &',
        ]),

        heading3('Chạy Bridge Server với PM2'),
        ...codeBlock([
          'cd /path/to/flow-auto-generator/bridge',
          'pm2 start server.js --name bridge-server',
          'pm2 save',
          'pm2 startup',
        ]),

        heading3('Monitoring'),
        ...codeBlock([
          '# Kiểm tra Bridge Server',
          'pm2 status bridge-server',
          'pm2 logs bridge-server',
          '',
          '# Kiểm tra extension',
          'curl http://localhost:3500/status',
        ]),
        ...alertBox('warning', 'RAM trên VPS: Chrome với Google Flow tiêu tốn ~1–2GB RAM. Đảm bảo VPS có ít nhất 2GB RAM (khuyến nghị 4GB). Bật auto-refresh 3–5 phút để giảm memory leak.'),

        // ─── Footer ───
        separator(),
        new Paragraph({
          children: [new TextRun({ text: '📝 Tài liệu này được viết cho Flow Auto Generator v4.4 — Cập nhật: Tháng 7, 2026', size: 18, font: 'Segoe UI', color: COLORS.textLight, italics: true })],
          alignment: AlignmentType.CENTER,
        }),
      ],
    }],
  });
}

// ══════════════════════════════════════════════════════════════════════
// DOCUMENT 2: USER GUIDE
// ══════════════════════════════════════════════════════════════════════
function buildUserGuide() {
  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Segoe UI', size: 21, color: COLORS.text } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) } },
      },
      children: [
        // ─── Title Page ───
        spacer(1200),
        new Paragraph({
          children: [new TextRun({ text: '📖', size: 72 })],
          alignment: AlignmentType.CENTER,
        }),
        spacer(200),
        new Paragraph({
          children: [new TextRun({ text: 'FLOW AUTO GENERATOR', bold: true, size: 48, font: 'Segoe UI', color: COLORS.primary })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Hướng Dẫn Sử Dụng', size: 32, font: 'Segoe UI', color: COLORS.textLight })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({ text: 'Version 4.4  •  Tháng 7, 2026', size: 22, font: 'Segoe UI', color: COLORS.textLight })],
          alignment: AlignmentType.CENTER,
        }),
        spacer(600),
        new Paragraph({
          children: [new TextRun({ text: 'Hướng dẫn chi tiết cách sử dụng Dashboard, gửi job, quản lý queue, theo dõi tiến trình, xử lý lỗi và các câu hỏi thường gặp.', size: 21, font: 'Segoe UI', color: COLORS.textLight, italics: true })],
          alignment: AlignmentType.CENTER,
        }),

        // ─── MỤC LỤC ───
        spacer(400),
        separator(),
        heading1('📑 Mục Lục'),
        bullet('Mục 1 — Giao Diện Dashboard'),
        bullet('Mục 2 — Gửi Job Thủ Công'),
        bullet('Mục 3 — Gửi Job từ n8n / API'),
        bullet('    3.1 Yêu cầu: Tài khoản n8n (Cloud hoặc Self-hosted)', 1),
        bullet('    3.2 Tạo Workflow trên n8n (từng bước)', 1),
        bullet('    3.3 Sơ đồ tổng thể Workflow', 1),
        bullet('    3.4 Gửi job bằng API trực tiếp', 1),
        bullet('Mục 4 — Quản Lý Queue'),
        bullet('Mục 5 — Theo Dõi Tiến Trình'),
        bullet('Mục 6 — Xử Lý Lỗi & Retry'),
        bullet('Mục 7 — API Reference — Bridge Server'),
        bullet('Mục 8 — Xử Lý Sự Cố (Troubleshooting)'),
        bullet('Mục 9 — FAQ — Câu Hỏi Thường Gặp'),
        separator(),

        // ═══════════════════════════════════════
        // MỤC 1: GIAO DIỆN DASHBOARD
        // ═══════════════════════════════════════
        heading1('🎯 1. Giao Diện Dashboard'),
        para('Nhấn vào icon Extension trên thanh Chrome để mở popup Dashboard.'),
        spacer(80),
        heading2('Các thành phần chính'),
        makeTable(
          ['Thành phần', 'Mô tả'],
          [
            ['🟢 Bridge status', 'Connected / 🔴 Disconnected — trạng thái kết nối WebSocket tới Bridge'],
            ['State', 'Trạng thái hiện tại của state machine (VD: 🎬 Đang render...)'],
            ['📊 Stats', 'Tổng quan: số job trong queue, hoàn tất, thất bại, retry'],
            ['🎯 Current Job', 'Chi tiết job đang chạy: ID, scene, character, prompt, progress bar, thời gian'],
            ['🎮 Controls', 'Pause/Resume, Skip (bỏ qua job), Cancel (hủy job)'],
            ['🔄 Auto-Refresh', 'Điều chỉnh thời gian tự động refresh trang Flow (0–60 phút)'],
            ['📤 Gửi job thủ công', 'Form gửi job manual (prompt, character, webhook, Drive folder)'],
            ['⚙️ Cài đặt', 'Bridge URL, Webhook, Google Drive credentials'],
            ['✅ Hoàn tất', 'Danh sách job đã hoàn tất'],
            ['❌ Thất bại', 'Danh sách job lỗi + nút Retry'],
            ['📋 Logs', 'Real-time log (tối đa 300 dòng)'],
          ]
        ),

        // ═══════════════════════════════════════
        // MỤC 2: GỬI JOB THỦ CÔNG
        // ═══════════════════════════════════════
        heading1('📤 2. Gửi Job Thủ Công'),
        para('Mở popup → **📤 Gửi job thủ công** → điền thông tin:'),
        spacer(80),
        makeTable(
          ['Trường', 'Bắt buộc', 'Mô tả'],
          [
            ['Prompt', '✅ Có', 'Nội dung prompt mô tả video cần tạo'],
            ['Character', '❌ Không', 'Tên nhân vật (nhiều nhân vật cách bằng dấu phẩy: Anna, Ben)'],
            ['Scene ID', '❌ Không', 'ID scene (để tracking và đặt tên file)'],
            ['Webhook URL', '❌ Không', 'URL callback khi job xong (ghi đè default webhook)'],
            ['Drive Folder ID', '❌ Không', 'ID thư mục Drive (ghi đè default folder)'],
          ]
        ),
        spacer(80),
        para('Nhấn **"🚀 Gửi Job"** → Job được thêm vào queue → tự động xử lý.'),
        spacer(80),
        para('**Ví dụ prompt:**'),
        ...codeBlock([
          'A cinematic shot of a woman walking through a futuristic neon city',
          'at sunset, camera slowly zooming in, volumetric lighting, 4K quality',
        ]),
        para('**Ví dụ character (nhiều nhân vật):**'),
        ...codeBlock(['Chanh Pink, Anna']),

        // ═══════════════════════════════════════
        // MỤC 3: GỬI JOB TỪ N8N / API
        // ═══════════════════════════════════════
        heading1('🔗 3. Gửi Job từ n8n / API'),

        // ── 3.1 Yêu cầu tài khoản n8n ──
        heading2('3.1  Yêu cầu: Tài khoản n8n'),
        para('Để tự động gửi job tạo video từ workflow, bạn cần có một **tài khoản n8n** — nền tảng automation workflow mã nguồn mở.'),
        spacer(80),
        makeTable(
          ['Lựa chọn', 'Mô tả', 'Chi phí'],
          [
            ['n8n Cloud', 'Dùng trực tiếp tại https://app.n8n.cloud — không cần cài đặt', 'Miễn phí (giới hạn) / Trả phí từ $20/tháng'],
            ['n8n Self-hosted', 'Tự cài trên VPS bằng Docker hoặc npm', 'Miễn phí (cần VPS riêng)'],
          ]
        ),

        heading3('Cách 1: Đăng ký n8n Cloud (Khuyến nghị cho người mới)'),
        numberedItem(1, 'Truy cập **https://app.n8n.cloud/register**'),
        numberedItem(2, 'Đăng ký bằng email hoặc tài khoản Google'),
        numberedItem(3, 'Xác nhận email → đăng nhập vào dashboard n8n'),
        numberedItem(4, 'Giao diện n8n sẵn sàng tại URL dạng: `https://your-name.app.n8n.cloud`'),
        ...alertBox('tip', 'Gói miễn phí n8n Cloud cho phép chạy tới 5 workflow active. Đủ để dùng với Flow Auto Generator.'),

        heading3('Cách 2: Cài n8n Self-hosted (Docker)'),
        ...codeBlock([
          '# Cài đặt bằng Docker (cách nhanh nhất)',
          'docker run -d --name n8n \\',
          '  -p 5678:5678 \\',
          '  -v n8n_data:/home/node/.n8n \\',
          '  n8nio/n8n',
          '',
          '# Truy cập n8n tại:',
          '# http://localhost:5678',
        ]),
        spacer(80),
        ...codeBlock([
          '# Hoặc cài bằng npm',
          'npm install -g n8n',
          'n8n start',
        ]),

        // ── 3.2 Tạo Workflow trên n8n ──
        heading2('3.2  Tạo Workflow trên n8n (Hướng dẫn từng bước)'),
        para('Dưới đây là hướng dẫn chi tiết tạo workflow gửi job tự động từ Google Sheets → Flow Auto Generator.'),
        spacer(80),

        heading3('Bước 1: Tạo Workflow mới'),
        numberedItem(1, 'Đăng nhập n8n → nhấn **"+ Add Workflow"** (hoặc **"Create new workflow"**)'),
        numberedItem(2, 'Đặt tên workflow: `Flow Video Generator`'),
        numberedItem(3, 'Canvas workflow trống sẽ hiện ra với node **Start**'),

        heading3('Bước 2: Thêm node Trigger (Kích hoạt)'),
        para('Chọn một trong các cách kích hoạt:'),
        spacer(40),
        para('**Cách A — Schedule Trigger (Chạy theo lịch):**'),
        numberedItem(1, 'Nhấn **"+"** → tìm **"Schedule Trigger"**'),
        numberedItem(2, 'Cấu hình: **Rule** → `Every 10 minutes` (hoặc theo nhu cầu)'),
        numberedItem(3, 'Nhấn **"Execute Node"** để test'),
        spacer(40),
        para('**Cách B — Manual Trigger (Chạy thủ công):**'),
        numberedItem(1, 'Nhấn **"+"** → tìm **"Manual Trigger"**'),
        numberedItem(2, 'Không cần cấu hình gì — nhấn **"Execute Workflow"** khi muốn chạy'),
        spacer(40),
        para('**Cách C — Webhook Trigger (Gọi từ bên ngoài):**'),
        numberedItem(1, 'Nhấn **"+"** → tìm **"Webhook"**'),
        numberedItem(2, 'Method: **POST**, Path: `trigger-video`'),
        numberedItem(3, 'n8n sẽ cung cấp URL webhook: `https://your-n8n.com/webhook/trigger-video`'),

        heading3('Bước 3: Thêm node đọc dữ liệu (Google Sheets / Airtable / khác)'),
        para('**Ví dụ với Google Sheets:**'),
        numberedItem(1, 'Nhấn **"+"** → tìm **"Google Sheets"**'),
        numberedItem(2, 'Operation: **Read Rows**'),
        numberedItem(3, 'Kết nối tài khoản Google (OAuth) → chọn Spreadsheet → chọn Sheet'),
        numberedItem(4, 'Cấu hình cột dữ liệu trong Google Sheets:'),
        spacer(40),
        makeTable(
          ['Cột', 'Mô tả', 'Ví dụ'],
          [
            ['A — prompt', 'Nội dung prompt video', 'A woman walking through rain...'],
            ['B — character', 'Tên nhân vật', 'Anna, Ben'],
            ['C — sceneId', 'ID scene', 'scene_001'],
            ['D — projectId', 'ID dự án', 'my_project'],
            ['E — status', 'Trạng thái (để filter)', 'pending / done / failed'],
          ]
        ),
        spacer(40),
        numberedItem(5, 'Thêm **Filter** (tùy chọn): chỉ lấy row có `status = "pending"`'),

        heading3('Bước 4: Thêm node HTTP Request (Gửi job tới Bridge)'),
        para('Đây là node quan trọng nhất — gửi job tới Bridge Server:'),
        numberedItem(1, 'Nhấn **"+"** → tìm **"HTTP Request"**'),
        numberedItem(2, 'Cấu hình như sau:'),
        spacer(40),
        makeTable(
          ['Trường', 'Giá trị'],
          [
            ['Method', 'POST'],
            ['URL', 'https://bridge-u03a.onrender.com/generate'],
            ['Authentication', 'None'],
            ['Body Content Type', 'JSON'],
          ]
        ),
        spacer(40),
        numberedItem(3, 'Trong phần **Body Parameters**, thêm các trường (dùng Expression để map từ Google Sheets):'),
        spacer(40),
        ...codeBlock([
          '{',
          '  "prompt":      "{{ $json.prompt }}",',
          '  "character":   "{{ $json.character }}",',
          '  "sceneId":     "{{ $json.sceneId }}",',
          '  "projectId":   "{{ $json.projectId }}",',
          '  "callbackUrl": "https://your-n8n.com/webhook/video-done",',
          '  "driveFolderId": "1ABCxyz123",',
          '  "rowId":       "{{ $json.row_number }}"',
          '}',
        ]),
        spacer(40),
        ...alertBox('note', 'URL Bridge Server hiện tại đã được deploy tại: https://bridge-u03a.onrender.com — Nếu bạn deploy Bridge riêng, thay URL tương ứng.'),

        heading3('Bước 5: Thêm node Webhook nhận kết quả (Tùy chọn)'),
        para('Nếu muốn nhận callback khi video tạo xong để cập nhật Google Sheets:'),
        numberedItem(1, 'Tạo **Workflow mới** (hoặc dùng Webhook Trigger trong workflow riêng)'),
        numberedItem(2, 'Thêm node **Webhook**: Method **POST**, Path: `video-done`'),
        numberedItem(3, 'Copy URL webhook (VD: `https://your-n8n.com/webhook/video-done`)'),
        numberedItem(4, 'Dán URL này vào trường `callbackUrl` ở Bước 4'),
        numberedItem(5, 'Thêm node **Google Sheets** → Operation: **Update Row** → cập nhật `status = "done"` và `video_url` từ callback data'),
        spacer(40),
        para('**Payload callback nhận được từ Bridge:**'),
        ...codeBlock([
          '{',
          '  "jobId": "my_project_scene_001_5_1720000000000",',
          '  "rowId": "row_42",',
          '  "projectId": "my_project",',
          '  "sceneId": "scene_001",',
          '  "status": "COMPLETED",',
          '  "result": {',
          '    "videos": [...],',
          '    "driveUrl": "https://drive.google.com/file/d/.../view"',
          '  },',
          '  "timestamp": "2026-07-20T10:30:00.000Z"',
          '}',
        ]),

        heading3('Bước 6: Kích hoạt Workflow'),
        numberedItem(1, 'Nhấn **"Save"** để lưu workflow'),
        numberedItem(2, 'Nhấn toggle **"Active"** (góc trên phải) để bật workflow chạy tự động'),
        numberedItem(3, 'Hoặc nhấn **"Execute Workflow"** để chạy thủ công lần đầu test'),
        spacer(80),
        ...alertBox('note', 'Lần đầu nên chạy thủ công ("Execute Workflow") để test từng node trước khi bật auto. Kiểm tra kết quả từng bước trên canvas n8n.'),

        // ── 3.3 Sơ đồ tổng thể Workflow ──
        heading2('3.3  Sơ đồ tổng thể Workflow n8n'),
        para('Luồng hoạt động end-to-end:'),
        spacer(40),
        ...codeBlock([
          '┌─────────────────┐     ┌──────────────────┐     ┌───────────────────────┐',
          '│ Schedule Trigger │────▶│  Google Sheets    │────▶│  HTTP Request          │',
          '│ (mỗi 10 phút)   │     │  (đọc prompt)     │     │  POST /generate        │',
          '└─────────────────┘     └──────────────────┘     │  → Bridge Server       │',
          '                                                  └───────────┬───────────┘',
          '                                                              │',
          '                                                              ▼',
          '┌─────────────────┐     ┌──────────────────┐     ┌───────────────────────┐',
          '│  Google Sheets   │◀────│  Webhook          │◀────│  Bridge Server         │',
          '│  (cập nhật done) │     │  /video-done      │     │  callback kết quả      │',
          '└─────────────────┘     └──────────────────┘     └───────────────────────┘',
        ]),

        // ── 3.4 Gửi job bằng API (không cần n8n) ──
        heading2('3.4  Gửi job bằng API trực tiếp (không cần n8n)'),
        para('Nếu không dùng n8n, bạn có thể gửi job trực tiếp qua HTTP:'),
        ...codeBlock([
          'curl -X POST https://bridge-u03a.onrender.com/generate \\',
          '  -H "Content-Type: application/json" \\',
          '  -d \'{',
          '    "projectId": "my_project",',
          '    "sceneId": "scene_001",',
          '    "character": "Anna",',
          '    "prompt": "A woman walking through rain in slow motion",',
          '    "callbackUrl": "https://your-n8n.com/webhook/video-done",',
          '    "driveFolderId": "1ABCxyz123",',
          '    "rowId": "row_42"',
          '  }\'',
        ]),
        spacer(80),
        heading3('Payload tham số'),
        makeTable(
          ['Trường', 'Bắt buộc', 'Mô tả'],
          [
            ['projectId', '❌', 'ID dự án (dùng để mở đúng project trên Flow)'],
            ['sceneId', '❌', 'ID scene (tracking, đặt tên file)'],
            ['character', '❌', 'Tên nhân vật, phân cách bằng dấu phẩy'],
            ['prompt', '✅', 'Prompt mô tả video'],
            ['callbackUrl', '❌', 'URL webhook nhận kết quả'],
            ['driveFolderId', '❌', 'Google Drive folder ID (ghi đè cài đặt mặc định)'],
            ['rowId', '❌', 'ID bản ghi nguồn (mapping kết quả)'],
          ]
        ),
        spacer(80),
        para('**Phản hồi thành công (201):**'),
        ...codeBlock([
          '{',
          '  "success": true,',
          '  "jobId": "my_project_scene_001_5_1720000000000",',
          '  "position": 1,',
          '  "message": "Job queued at position 1"',
          '}',
        ]),
        ...alertBox('tip', 'Bridge Server hỗ trợ nhận array từ n8n. Có thể gửi [{...}, {...}] để queue nhiều job cùng lúc.'),

        // ═══════════════════════════════════════
        // MỤC 4: QUẢN LÝ QUEUE
        // ═══════════════════════════════════════
        heading1('📋 4. Quản Lý Queue'),

        heading2('4.1  Từ Popup Dashboard'),
        makeTable(
          ['Nút', 'Chức năng'],
          [
            ['⏸ Pause', 'Tạm dừng xử lý queue (job đang chạy vẫn tiếp tục)'],
            ['▶ Resume', 'Tiếp tục xử lý queue'],
            ['⏭ Skip', 'Bỏ qua job hiện tại → đánh dấu failed → xử lý job tiếp'],
            ['✖ Cancel', 'Hủy job đang chạy'],
            ['🗑️ Xóa lịch sử', 'Xóa danh sách Done/Failed'],
          ]
        ),

        heading2('4.2  Từ Bridge API'),
        ...codeBlock([
          '# Xem trạng thái chi tiết',
          'curl https://bridge-u03a.onrender.com/status',
          '',
          '# Xem toàn bộ queue',
          'curl https://bridge-u03a.onrender.com/queue',
          '',
          '# Tạm dừng queue',
          'curl -X POST https://bridge-u03a.onrender.com/pause',
          '',
          '# Tiếp tục queue',
          'curl -X POST https://bridge-u03a.onrender.com/resume',
          '',
          '# Hủy job cụ thể',
          'curl -X POST https://bridge-u03a.onrender.com/cancel \\',
          '  -H "Content-Type: application/json" \\',
          '  -d \'{"jobId": "my_project_scene_001_5_1720000000000"}\'',
          '',
          '# Retry job đã failed',
          'curl -X POST https://bridge-u03a.onrender.com/retry \\',
          '  -H "Content-Type: application/json" \\',
          '  -d \'{"jobId": "my_project_scene_001_5_1720000000000"}\'',
          '',
          '# Xóa lịch sử + unstick queue',
          'curl -X POST https://bridge-u03a.onrender.com/clear-history',
        ]),

        // ═══════════════════════════════════════
        // MỤC 5: THEO DÕI TIẾN TRÌNH
        // ═══════════════════════════════════════
        heading1('📊 5. Theo Dõi Tiến Trình'),
        para('Khi một job đang chạy, Dashboard hiển thị thông tin chi tiết bao gồm: Job ID, Scene, Character, Prompt, trạng thái hiện tại, thanh progress bar (%), và thời gian đã chạy.'),
        spacer(80),
        heading2('Các trạng thái và ý nghĩa'),
        makeTable(
          ['Icon', 'Trạng thái', 'Mô tả', 'Thời gian ước tính'],
          [
            ['⏸️', 'Chờ job', 'Không có job, đang idle', '—'],
            ['🔍', 'Tìm nhân vật', 'Đang tìm card nhân vật trên UI', '1–30s'],
            ['👆', 'Hover nhân vật', 'Mô phỏng hover lên card', '1–2s'],
            ['🖱️', 'Click ⋮ menu', 'Nhấn nút More trên card', '1–2s'],
            ['⏳', 'Chờ dropdown', 'Chờ menu "Thêm vào câu lệnh" xuất hiện', '1–5s'],
            ['🖱️', 'Thêm vào câu lệnh', 'Click thêm nhân vật vào prompt', '1–2s'],
            ['⏳', 'Chờ ô nhập', 'Tìm textarea nhập prompt', '1–5s'],
            ['✏️', 'Nhập prompt', 'Gõ prompt vào ô nhập (Debugger API)', '1–5s'],
            ['✅', 'Xác nhận input', 'Kiểm tra prompt đã vào ô', '1–2s'],
            ['⏎', 'Ấn Enter', 'Gửi lệnh render', '1–2s'],
            ['🎬', 'Đang render...', 'Chờ AI render video (~2 phút)', '120s+'],
            ['🔎', 'Kiểm tra hoàn tất', 'Quét video mới trên trang', '5–30s'],
            ['💾', 'Tải video', 'Download video → Base64 → Drive upload', '10–60s'],
            ['📤', 'Gửi kết quả', 'Gửi callback về n8n/webhook', '1–5s'],
            ['✅', 'Hoàn tất', 'Job hoàn thành', '—'],
            ['❌', 'Lỗi', 'Job gặp lỗi', '—'],
          ]
        ),
        spacer(80),
        para('**Thời gian trung bình mỗi job:** 3–5 phút (phụ thuộc thời gian render của Google Flow).'),

        // ═══════════════════════════════════════
        // MỤC 6: XỬ LÝ LỖI & RETRY
        // ═══════════════════════════════════════
        heading1('🔄 6. Xử Lý Lỗi & Retry'),

        heading2('6.1  Tự động retry'),
        para('Mỗi trạng thái có cơ chế retry tự động với delay tăng dần:'),
        makeTable(
          ['State', 'Timeout', 'Max Retries', 'Retry Delays'],
          [
            ['FIND_CHARACTER', '30s', '5', '1s, 2s, 5s, 10s, 10s'],
            ['HOVER_CHARACTER', '10s', '3', '1s, 2s, 5s'],
            ['CLICK_MORE_MENU', '10s', '5', '0.5s, 1s, 2s, 3s, 5s'],
            ['WAIT_MENU', '15s', '5', '0.5s, 1s, 2s, 3s, 5s'],
            ['CLICK_ADD_BUTTON', '10s', '3', '1s, 2s, 5s'],
            ['WAIT_TEXTAREA', '15s', '5', '0.5s, 1s, 2s, 3s, 5s'],
            ['INJECT_PROMPT', '10s', '3', '1s, 2s, 5s'],
            ['VERIFY_INPUT', '10s', '3', '0.5s, 1s, 2s'],
            ['PRESS_ENTER', '10s', '3', '1s, 2s, 3s'],
            ['WAIT_RENDER', '10 phút', '5', '5s, 10s, 30s, 60s, 120s'],
            ['DETECT_COMPLETE', '60s', '4', '2s, 5s, 10s, 20s'],
            ['DOWNLOAD_VIDEO', '60s', '3', '5s, 10s, 15s'],
          ]
        ),

        heading2('6.2  Retry thủ công'),
        para('Mở popup → **❌ Thất bại** → nhấn nút **"🔄"** bên cạnh job muốn thử lại.'),
        para('Hoặc qua API:'),
        ...codeBlock([
          'curl -X POST https://bridge-u03a.onrender.com/retry \\',
          '  -H "Content-Type: application/json" \\',
          '  -d \'{"jobId": "job_id_here"}\'',
        ]),

        heading2('6.3  Global timeout'),
        para('Nếu một job chạy quá **15 phút** → tự động force-fail. Cơ chế này được kiểm tra bởi keepalive alarm mỗi 1 phút.'),

        // ═══════════════════════════════════════
        // MỤC 7: API REFERENCE
        // ═══════════════════════════════════════
        heading1('📡 7. API Reference — Bridge Server'),
        para('**Base URL:** `https://bridge-u03a.onrender.com` (production) hoặc `http://localhost:3500` (local)'),
        spacer(80),
        makeTable(
          ['Method', 'Path', 'Mô tả'],
          [
            ['GET', '/', 'Health check — trạng thái server + extension'],
            ['POST', '/generate', 'Tạo job mới (nhận prompt, character, projectId...)'],
            ['GET', '/status', 'Trạng thái chi tiết: job hiện tại, queue, history'],
            ['GET', '/queue', 'Danh sách queue đầy đủ'],
            ['POST', '/cancel', 'Hủy job (đang chạy hoặc trong queue)'],
            ['POST', '/pause', 'Tạm dừng xử lý queue'],
            ['POST', '/resume', 'Tiếp tục xử lý queue'],
            ['POST', '/retry', 'Retry job đã failed'],
            ['POST', '/clear-history', 'Xóa lịch sử completed/failed + unstick jobs'],
          ]
        ),

        heading2('Chi tiết endpoint chính'),

        heading3('GET / — Health Check'),
        ...codeBlock([
          '// Response:',
          '{',
          '  "status": "ok",',
          '  "extensionConnected": true,',
          '  "queueLength": 2,',
          '  "processing": true,',
          '  "uptime": 3600',
          '}',
        ]),

        heading3('POST /generate — Tạo Job Mới'),
        para('**Request Body:**'),
        ...codeBlock([
          '{',
          '  "projectId": "string (tùy chọn)",',
          '  "sceneId": "string (tùy chọn)",',
          '  "character": "string (tùy chọn)",',
          '  "prompt": "string (bắt buộc)",',
          '  "callbackUrl": "string (tùy chọn)",',
          '  "driveFolderId": "string (tùy chọn)",',
          '  "rowId": "string (tùy chọn)"',
          '}',
        ]),
        para('**Response (201):**'),
        ...codeBlock([
          '{',
          '  "success": true,',
          '  "jobId": "project_scene_1_1720000000000",',
          '  "position": 1,',
          '  "message": "Job queued at position 1"',
          '}',
        ]),

        heading3('GET /status — Trạng Thái Chi Tiết'),
        ...codeBlock([
          '// Response:',
          '{',
          '  "extensionConnected": true,',
          '  "paused": false,',
          '  "currentJob": { "id": "...", "currentState": "WAIT_RENDER" },',
          '  "queueLength": 3,',
          '  "queue": [...],',
          '  "completedCount": 10,',
          '  "failedCount": 2,',
          '  "recentCompleted": [...],',
          '  "recentFailed": [...]',
          '}',
        ]),

        heading3('POST /cancel — Hủy Job'),
        para('**Request:** `{ "jobId": "string" }` → **Response:** `{ "success": true, "message": "Job cancelled" }`'),

        heading3('POST /pause — Tạm Dừng'),
        para('**Response:** `{ "success": true, "message": "Queue paused" }`'),

        heading3('POST /resume — Tiếp Tục'),
        para('**Response:** `{ "success": true, "message": "Queue resumed" }`'),

        heading3('POST /retry — Retry Job'),
        para('**Request:** `{ "jobId": "string" }` → **Response:** `{ "success": true, "newJobId": "..." }`'),

        heading3('POST /clear-history — Xóa Lịch Sử'),
        para('Xóa completed/failed + unstick job bị kẹt. **Response:** `{ "success": true }`'),

        // ═══════════════════════════════════════
        // MỤC 8: TROUBLESHOOTING
        // ═══════════════════════════════════════
        heading1('🔍 8. Xử Lý Sự Cố (Troubleshooting)'),

        heading2('Bridge hiển thị 🔴 Disconnected'),
        makeTable(
          ['Nguyên nhân', 'Cách xử lý'],
          [
            ['Bridge Server chưa chạy', 'Chạy `npm start` trong thư mục bridge/'],
            ['Sai URL trong settings', 'Kiểm tra Bridge URL và WS URL trong popup Settings'],
            ['Firewall chặn port', 'Mở port 3500 (hoặc port tùy chỉnh)'],
            ['SSL/HTTPS mismatch', 'URL https:// cần WS URL wss://, URL http:// cần ws://'],
          ]
        ),

        heading2('Job bị stuck'),
        numberedItem(1, '**Chờ timeout + retry tự động**: Mỗi state có timeout riêng (10s–10 phút)'),
        numberedItem(2, '**Skip thủ công**: Popup → nhấn **"⏭ Skip"**'),
        numberedItem(3, '**Hủy job**: Popup → nhấn **"✖ Cancel"**'),
        numberedItem(4, '**Clear stuck jobs qua API:**'),
        ...codeBlock(['curl -X POST https://bridge-u03a.onrender.com/clear-history']),

        heading2('Prompt không được nhập vào ô'),
        makeTable(
          ['Nguyên nhân', 'Cách xử lý'],
          [
            ['DevTools đang mở', 'Đóng DevTools (Chrome Debugger API conflict)'],
            ['Tab Flow không active', 'Extension sẽ tự tìm/mở tab Flow'],
            ['Google Flow UI thay đổi', 'Cập nhật phiên bản inject.js mới'],
          ]
        ),

        heading2('Video không tải được'),
        makeTable(
          ['Nguyên nhân', 'Cách xử lý'],
          [
            ['Render chưa xong', 'Thời gian render mặc định ~2 phút, job sẽ chờ tự động'],
            ['Video quá lớn (>50MB)', 'Có thể gây OOM khi convert Base64'],
            ['Token hết hạn', 'Extension tự động intercept token mới'],
          ]
        ),

        heading2('Google Drive upload thất bại'),
        makeTable(
          ['Nguyên nhân', 'Cách xử lý'],
          [
            ['Chưa cấu hình OAuth', 'Điền đầy đủ Client ID, Client Secret, Refresh Token'],
            ['Refresh Token hết hạn', 'Tạo lại Refresh Token tại OAuth Playground'],
            ['Folder ID sai', 'Kiểm tra lại ID từ URL thư mục Drive'],
            ['Quota API vượt mức', 'Kiểm tra Google Cloud Console → Quotas'],
          ]
        ),

        heading2('Extension bị crash / không phản hồi'),
        numberedItem(1, 'Truy cập `chrome://extensions/`'),
        numberedItem(2, 'Tìm **Flow Auto Generator** → nhấn **"Reload"** (🔄)'),
        numberedItem(3, 'Mở lại trang Google Flow'),
        numberedItem(4, 'Extension sẽ tự động reconnect Bridge'),

        // ═══════════════════════════════════════
        // MỤC 9: FAQ
        // ═══════════════════════════════════════
        heading1('❓ 9. FAQ — Câu Hỏi Thường Gặp'),

        heading3('Q: Extension có cần Chrome mở suốt không?'),
        para('**A:** Có. Extension là Chrome Extension nên cần Chrome browser chạy liên tục. Trên VPS, dùng Xvfb (virtual display) để chạy Chrome headless.'),

        heading3('Q: Có thể chạy nhiều job song song không?'),
        para('**A:** Không. Hệ thống xử lý **tuần tự** — một job tại một thời điểm. Các job khác nằm trong queue chờ.'),

        heading3('Q: Job mất bao lâu để hoàn tất?'),
        para('**A:** Trung bình **3–5 phút** mỗi job:'),
        bullet('Chọn nhân vật + nhập prompt: ~10–30s'),
        bullet('AI render video: ~2 phút (phụ thuộc Google)'),
        bullet('Download + upload Drive: ~10–30s'),

        heading3('Q: Dữ liệu queue có bị mất khi restart Bridge?'),
        para('**A:** Không. Queue được lưu persistent trong file `queue.json`. Khi restart, Bridge tự động load lại queue và reset job bị stuck.'),

        heading3('Q: Có hỗ trợ nhiều nhân vật trong một video không?'),
        para('**A:** Có. Nhập tên các nhân vật phân cách bằng dấu phẩy (VD: `Anna, Ben, Charlie`). Extension sẽ lần lượt thêm từng nhân vật trước khi nhập prompt.'),

        heading3('Q: Cần làm gì khi Google Flow thay đổi giao diện?'),
        para('**A:** Có thể cần cập nhật file `inject.js` — đặc biệt các selector CSS và aria-label dùng để tìm phần tử UI. Kiểm tra logs trong popup để xem lỗi cụ thể.'),

        heading3('Q: Port 3500 đã bị chiếm?'),
        para('**A:** Đổi port bằng biến môi trường:'),
        ...codeBlock(['PORT=4000 node server.js']),
        para('Sau đó cập nhật Bridge URL và WS URL trong popup Settings.'),

        heading3('Q: Webhook callback không nhận được?'),
        para('**A:** Bridge retry callback tối đa **3 lần** với delay tăng dần (2s, 4s, 6s). Kiểm tra:'),
        bullet('`callbackUrl` có đúng và accessible không'),
        bullet('Server webhook có đang chạy không'),
        bullet('Firewall/CORS có chặn không'),

        heading3('Q: Làm sao biết video đã upload lên Drive thành công?'),
        para('**A:** Kiểm tra trong popup → **✅ Hoàn tất** → xem chi tiết job → trường `driveUrl` sẽ chứa link Google Drive. Hoặc kiểm tra webhook callback payload có trường `result.driveUrl`.'),

        heading3('Q: Extension bị tắt khi Chrome chạy lâu?'),
        para('**A:** Extension sử dụng Chrome Alarm (keepalive mỗi 1 phút) + WebSocket heartbeat (mỗi 25s) để duy trì Service Worker hoạt động. Nếu vẫn bị tắt, thử:'),
        bullet('Kiểm tra Chrome chưa bị crash (VNC vào VPS kiểm tra)'),
        bullet('Tăng RAM cho VPS'),
        bullet('Giảm auto-refresh interval'),

        // ─── Footer ───
        separator(),
        new Paragraph({
          children: [new TextRun({ text: '📝 Tài liệu này được viết cho Flow Auto Generator v4.4 — Cập nhật: Tháng 7, 2026', size: 18, font: 'Segoe UI', color: COLORS.textLight, italics: true })],
          alignment: AlignmentType.CENTER,
        }),
      ],
    }],
  });
}

// ═══════════════════════════════════════
// GENERATE FILES
// ═══════════════════════════════════════
async function main() {
  console.log('📝 Generating SETUP_GUIDE.docx...');
  const setupDoc = buildSetupGuide();
  const setupBuf = await Packer.toBuffer(setupDoc);
  fs.writeFileSync('SETUP_GUIDE.docx', setupBuf);
  console.log(`   ✅ SETUP_GUIDE.docx (${(setupBuf.length / 1024).toFixed(1)} KB)`);

  console.log('📝 Generating USER_GUIDE.docx...');
  const userDoc = buildUserGuide();
  const userBuf = await Packer.toBuffer(userDoc);
  fs.writeFileSync('USER_GUIDE.docx', userBuf);
  console.log(`   ✅ USER_GUIDE.docx (${(userBuf.length / 1024).toFixed(1)} KB)`);

  console.log('\n🎉 Done! 2 files generated successfully.');
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
