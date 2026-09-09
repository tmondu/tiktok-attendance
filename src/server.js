import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { TikTokService } from './tiktokService.js';
import { generateExcelReport } from './excelExporter.js';

import { existsSync } from 'fs';
import { embeddedAssets } from './embeddedAssets.js';

// Tương thích cả khi chạy qua ESM lẫn khi bundle CJS
let baseDir = process.cwd();
try {
  if (typeof __dirname !== 'undefined') {
    baseDir = __dirname;
  } else if (import.meta && import.meta.url) {
    baseDir = path.dirname(fileURLToPath(import.meta.url));
  }
} catch (e) {
  baseDir = process.cwd();
}

const exeDir = path.dirname(process.execPath);
const possiblePaths = [
  path.join(process.cwd(), 'public'),
  path.join(exeDir, 'public'),
  path.join(exeDir, '..', 'public'),
  path.join(baseDir, '..', 'public'),
  path.join(baseDir, 'public')
];

let publicPath = possiblePaths.find((p) => existsSync(path.join(p, 'index.html')));

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const tiktokService = new TikTokService();

// Cấu hình Express
app.set('etag', false);

// Middlewares
app.use(cors());
app.use(express.json());

// Chặn cache để đảm bảo không bao giờ bị 304 khi cập nhật code
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const start = Date.now();
  res.on('finish', () => {
    if (!req.originalUrl.startsWith('/socket.io/')) {
      console.log(`[HTTP ${new Date().toLocaleTimeString('vi-VN')}] ${req.method} ${req.originalUrl} -> Mã: ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

if (publicPath) {
  app.use(express.static(publicPath, { etag: false, maxAge: 0 }));
}

// Fallback phục vụ giao diện từ assets nhúng sẵn (đảm bảo file .exe chạy độc lập không cần thư mục public kèm theo)
app.get(['/', '/index.html'], (req, res) => {
  res.type('html').send(embeddedAssets.indexHtml);
});
app.get('/css/style.css', (req, res) => {
  res.type('text/css').send(embeddedAssets.styleCss);
});
app.get('/js/app.js', (req, res) => {
  res.type('application/javascript').send(embeddedAssets.appJs);
});

// Socket.IO Events
io.on('connection', (socket) => {
  console.log(`🔌 [Socket.IO] Trình duyệt web đã kết nối (Client ID: ${socket.id})`);

  socket.on('disconnect', () => {
    console.log(`🔌 [Socket.IO] Trình duyệt web đã ngắt kết nối (Client ID: ${socket.id})`);
  });

  // Gửi trạng thái ban đầu và toàn bộ danh sách khi client kết nối
  socket.emit('init', {
    status: tiktokService.status,
    channel: tiktokService.channel,
    stats: tiktokService.stats,
    settings: tiktokService.settings,
    attendees: tiktokService.getAttendanceList()
  });

  socket.on('request_sync', () => {
    socket.emit('sync', {
      status: tiktokService.status,
      channel: tiktokService.channel,
      stats: tiktokService.stats,
      attendees: tiktokService.getAttendanceList()
    });
  });
});

// Chuyển tiếp sự kiện từ TikTokService sang Socket.IO
tiktokService.on('status', (data) => io.emit('status', data));
tiktokService.on('stats', (stats) => io.emit('stats', stats));
tiktokService.on('newRecord', (record) => io.emit('newRecord', record));
tiktokService.on('userLikesUpdated', (data) => io.emit('userLikesUpdated', data));
tiktokService.on('chatMessage', (msg) => io.emit('chatMessage', msg));
tiktokService.on('reset', () => io.emit('reset'));

// --- API Endpoints ---

// 1. Khởi động điểm danh
app.post('/api/start', async (req, res) => {
  const { channel, mode = 'all', keyword = '', caseSensitive = false, sessionId, ttTargetIdc } = req.body;
  console.log(`\n======================================================`);
  console.log(`👉 [API /api/start] Nhận yêu cầu kết nối từ trình duyệt:`);
  console.log(`   - Kênh TikTok: "${channel}"`);
  console.log(`   - Chế độ điểm danh: "${mode}"`);
  console.log(`   - Từ khóa (nếu có): "${keyword}"`);
  console.log(`======================================================`);

  if (!channel) {
    console.log(`⚠️ [API /api/start] Thất bại: Không có username kênh.`);
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên kênh TikTok (username)!' });
  }

  try {
    await tiktokService.start(channel, { mode, keyword, caseSensitive, sessionId, ttTargetIdc });
    console.log(`✅ [API /api/start] Kết nối thành công tới @${tiktokService.channel}!`);
    res.json({
      success: true,
      message: `Đã kết nối với phiên LIVE của @${tiktokService.channel}`,
      channel: tiktokService.channel
    });
  } catch (err) {
    console.error(`❌ [API /api/start] Kết nối thất bại:`, err.message);
    res.status(500).json({
      success: false,
      message: err.message || 'Không thể kết nối tới TikTok Live. Hãy chắc chắn kênh đang phát live!'
    });
  }
});

// 2. Dừng điểm danh
app.post('/api/stop', async (req, res) => {
  try {
    await tiktokService.stop();
    res.json({ success: true, message: 'Đã dừng kết nối.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Xóa dữ liệu điểm danh
app.post('/api/reset', (req, res) => {
  tiktokService.reset();
  res.json({ success: true, message: 'Đã xóa toàn bộ danh sách điểm danh.' });
});

// 4. Lấy trạng thái hiện tại
app.get('/api/status', (req, res) => {
  res.json({
    status: tiktokService.status,
    channel: tiktokService.channel,
    stats: tiktokService.stats,
    sessionInfo: tiktokService.getSessionInfo(),
    totalCount: tiktokService.attendanceMap.size
  });
});

// 5. Thêm dữ liệu mẫu thử nghiệm
app.post('/api/mock', (req, res) => {
  const count = req.body.count || 5;
  tiktokService.addMockData(count);
  res.json({
    success: true,
    message: `Đã thêm ${count} dữ liệu mẫu thử nghiệm`,
    total: tiktokService.attendanceMap.size
  });
});

// 6. Xuất File Excel
app.get('/api/export', async (req, res) => {
  try {
    const attendees = tiktokService.getAttendanceList();
    const sessionInfo = tiktokService.getSessionInfo();
    const userSummary = tiktokService.getUserSummaryList ? tiktokService.getUserSummaryList() : [];

    const buffer = await generateExcelReport(attendees, sessionInfo, userSummary);

    const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const channelName = tiktokService.channel || 'tiktok_live';
    const filename = `DiemDanh_${channelName}_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Lỗi xuất Excel:', err);
    res.status(500).json({ success: false, message: 'Không thể tạo file Excel: ' + err.message });
  }
});

// Tự động tìm port khả dụng nếu port 3000 đang được dùng
function startServer(portToTry) {
  const serverInstance = httpServer.listen(portToTry, () => {
    const url = `http://localhost:${portToTry}`;
    console.log(`\n======================================================`);
    console.log(`🚀 Ứng dụng Điểm Danh TikTok LIVE đã sẵn sàng!`);
    console.log(`🌐 Truy cập giao diện: ${url}`);
    console.log(`======================================================\n`);

    // Tự động mở trình duyệt nếu không trong container headless
    if (process.env.OPEN_BROWSER !== 'false' && process.env.NODE_ENV !== 'test') {
      open(url).catch(() => {});
    }
  });

  serverInstance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Cổng ${portToTry} đang bận, đang thử cổng ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Lỗi khởi động server:', err);
    }
  });
}

// Xử lý lỗi toàn cục tránh tắt ứng dụng đột ngột
process.on('uncaughtException', (err) => {
  console.error('\n❌ Lỗi hệ thống:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n⚠️ Lỗi bất đồng bộ chưa được xử lý:', reason);
});

// Khởi động server
startServer(Number(PORT));
