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

let publicPath = path.join(baseDir, '..', 'public');
if (!existsSync(publicPath)) {
  publicPath = path.join(process.cwd(), 'public');
}
if (!existsSync(publicPath)) {
  publicPath = path.join(baseDir, 'public');
}

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const tiktokService = new TikTokService();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(publicPath));

// Socket.IO Events
io.on('connection', (socket) => {
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
tiktokService.on('newAttendee', (attendee) => io.emit('newAttendee', attendee));
tiktokService.on('attendeeUpdated', (attendee) => io.emit('attendeeUpdated', attendee));
tiktokService.on('chatMessage', (msg) => io.emit('chatMessage', msg));
tiktokService.on('reset', () => io.emit('reset'));

// --- API Endpoints ---

// 1. Khởi động điểm danh
app.post('/api/start', async (req, res) => {
  const { channel, mode = 'all', keyword = '', caseSensitive = false } = req.body;
  if (!channel) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên kênh TikTok (username)!' });
  }

  try {
    await tiktokService.start(channel, { mode, keyword, caseSensitive });
    res.json({
      success: true,
      message: `Đã kết nối với phiên LIVE của @${tiktokService.channel}`,
      channel: tiktokService.channel
    });
  } catch (err) {
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

    const buffer = await generateExcelReport(attendees, sessionInfo);

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

// Khởi động server
startServer(Number(PORT));
