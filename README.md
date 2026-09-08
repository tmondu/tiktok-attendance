# Ứng Dụng Điểm Danh TikTok LIVE & Xuất File Excel (.xlsx)

Công cụ hỗ trợ kết nối trực tiếp đến các phiên phát livestream trên TikTok bằng username kênh, theo dõi sự kiện thời gian thực để điểm danh người tham gia và xuất báo cáo Excel hoàn chỉnh chỉ với 1 click.

---

## 🌟 Tính Năng Chính

- **Thu thập dữ liệu Real-time**: Lắng nghe sự kiện người xem tham gia phòng (`join`), gửi bình luận (`chat`), thả tim (`like`), tặng quà (`gift`).
- **Nhiều chế độ điểm danh linh hoạt**:
  1. **Toàn bộ người xem**: Ghi nhận bất kỳ ai vào xem, thả tim hoặc bình luận.
  2. **Bất kỳ ai bình luận**: Chỉ ghi nhận khi người xem có để lại bình luận.
  3. **Điểm danh theo cú pháp / từ khóa**: Bắt buộc bình luận chứa từ khóa chỉ định (ví dụ: `Có mặt`, `#diemdanh`, `MSHV:...`).
  4. **Chỉ người vừa vào xem**: Ghi nhận thời điểm user bước vào phòng live.
- **Xuất File Excel chuyên nghiệp**:
  - Tiêu đề, thông tin phiên live (kênh, thời gian bắt đầu - kết thúc, tổng số người tham gia).
  - Bảng chi tiết: STT, Username TikTok (@ID), Tên hiển thị, Giờ vào xem, Giờ tương tác cuối, Hình thức điểm danh, Bình luận gần nhất, Số lượt tương tác.
- **Tối ưu tài nguyên máy tính (CPU < 1%, RAM ~ 40MB)**:
  - Chỉ nhận luồng dữ liệu văn bản (WebSocket JSON/protobuf), **hoàn toàn không tải video hay âm thanh**.
  - Không gây giật lag hay chiếm dụng tài nguyên của máy đang phát livestream.
  - Có chế độ "Tiết kiệm CPU" và có thể chạy ngầm khi thu nhỏ tab.
- **Sẵn sàng đóng gói ra file chạy `.exe` cho Windows**.

---

## 🚀 Hướng Dẫn Sử Dụng

### 1. Khởi động ứng dụng
Mở terminal trong thư mục dự án và chạy:
```bash
npm start
```
Ứng dụng sẽ khởi động và tự động mở trình duyệt tại địa chỉ:
👉 **`http://localhost:3000`**

### 2. Thao tác điểm danh
1. Nhập username kênh TikTok đang phát live (ví dụ: `@nguyenvana` hoặc `nguyenvana`).
2. Chọn **Chế độ điểm danh** phù hợp.
3. Bấm **"Bắt Đầu Điểm Danh"**.
4. Danh sách người xem sẽ tự động nhảy theo thời gian thực trên bảng.
5. Khi kết thúc phiên live (hoặc bất kỳ lúc nào), bấm nút **"Xuất Excel (.xlsx)"** để tải ngay file báo cáo về máy.

> [!TIP]
> Bạn có thể bấm nút **"Thử dữ liệu mẫu"** trên giao diện để xem trước bảng biểu và kiểm tra chức năng xuất file Excel ngay cả khi chưa có livestream nào đang diễn ra!

---

## 📦 Hướng Dẫn Đóng Gói Ra File `.exe` Cho Windows

Khi muốn đóng gói thành **1 file `.exe` duy nhất** (người dùng chỉ cần nhấp đúp file `.exe` để dùng trên bất kỳ máy tính Windows nào mà không cần cài Node.js):

Chạy câu lệnh sau:
```bash
npm run build:exe
```
File chạy sẽ được tạo tại thư mục: `bin/tiktok-attendance.exe`.

---

## 💡 Lưu Ý Quan Trọng Về Vận Hành

1. **Có cần mở app cùng lúc live không?**
   - **Có**: TikTok không lưu lại lịch sử chi tiết từng người vào xem hay toàn bộ tin nhắn sau khi live kết thúc, nên app cần mở trong lúc live đang diễn ra.
2. **Có cần chạy trên cùng máy tính đang phát Live không?**
   - **Không nhất thiết**: Bạn có thể chạy app này trên một **laptop khác, máy phụ của trợ giảng, đồng nghiệp hoặc VPS**, chỉ cần nhập `@username` kênh của bạn.
   - Nếu chạy chung trên máy live, bạn hoàn toàn yên tâm vì app **tốn dưới 1% CPU** (không decode video/audio stream).
