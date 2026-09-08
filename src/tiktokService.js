import { WebcastPushConnection } from 'tiktok-live-connector/legacy';
import EventEmitter from 'events';

export class TikTokService extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.status = 'idle'; // idle | connecting | connected | disconnected | error
    this.channel = '';
    this.settings = {
      mode: 'all', // 'all' | 'join' | 'chat_all' | 'chat_keyword'
      keyword: '',
      caseSensitive: false
    };
    this.sessionStartTime = null;
    this.attendanceMap = new Map();
    this.stats = {
      totalAttendees: 0,
      totalComments: 0,
      totalLikes: 0,
      totalGifts: 0,
      currentViewers: 0
    };
  }

  /**
   * Bắt đầu kết nối tới kênh TikTok Live
   */
  async start(channelInput, customSettings = {}) {
    if (this.status === 'connected' || this.status === 'connecting') {
      await this.stop();
    }

    const cleanChannel = channelInput.trim().replace(/^@/, '');
    if (!cleanChannel) {
      throw new Error('Username TikTok không hợp lệ.');
    }

    this.channel = cleanChannel;
    this.settings = { ...this.settings, ...customSettings };
    this.sessionStartTime = new Date();
    this.status = 'connecting';
    this.emit('status', { status: this.status, channel: this.channel, message: `Đang kết nối tới @${this.channel}...` });

    try {
      // Khởi tạo kết nối với tùy chọn tối ưu tài nguyên
      this.connection = new WebcastPushConnection(this.channel, {
        processInitialData: true,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 1500,
        clientParams: {
          app_language: 'vi-VN',
          webcast_language: 'vi-VN'
        }
      });

      this._setupListeners();

      const state = await this.connection.connect();
      this.status = 'connected';
      this.stats.currentViewers = state?.roomInfo?.user_count || 0;

      this.emit('status', {
        status: this.status,
        channel: this.channel,
        message: `Đã kết nối thành công tới LIVE của @${this.channel}!`,
        roomInfo: state?.roomInfo
      });
      this.emit('stats', this.stats);

      return state;
    } catch (err) {
      this.status = 'error';
      const errMsg = err?.message || 'Không thể kết nối tới TikTok Live. Kênh có thể chưa phát live.';
      this.emit('status', {
        status: this.status,
        channel: this.channel,
        message: errMsg
      });
      throw err;
    }
  }

  /**
   * Ngắt kết nối phiên live hiện tại
   */
  async stop() {
    if (this.connection) {
      try {
        await this.connection.disconnect();
      } catch (e) {
        // bỏ qua lỗi disconnect nếu stream đã đóng
      }
      this.connection = null;
    }
    this.status = 'idle';
    this.emit('status', {
      status: this.status,
      channel: this.channel,
      message: 'Đã dừng điểm danh.'
    });
  }

  /**
   * Xóa danh sách điểm danh và reset thống kê
   */
  reset() {
    this.attendanceMap.clear();
    this.stats = {
      totalAttendees: 0,
      totalComments: 0,
      totalLikes: 0,
      totalGifts: 0,
      currentViewers: 0
    };
    this.sessionStartTime = new Date();
    this.emit('reset');
    this.emit('stats', this.stats);
  }

  /**
   * Cập nhật hoặc ghi nhận thông tin điểm danh của 1 user
   */
  _recordAttendee(userData, checkinMethod, commentText = '', initialCounts = {}) {
    const {
      uniqueId,
      nickname,
      profilePictureUrl,
      userId,
      avatarThumb,
      avatarMedium,
      avatarLarge,
      user
    } = userData;

    if (!uniqueId) return null;

    // Lấy link avatar thực tế từ mọi trường TikTok trả về
    const avatar = profilePictureUrl ||
      avatarThumb?.urlList?.[0] ||
      avatarMedium?.urlList?.[0] ||
      avatarLarge?.urlList?.[0] ||
      user?.avatarThumb?.urlList?.[0] ||
      user?.avatarLarge?.urlList?.[0] ||
      '';

    const now = new Date();
    let attendee = this.attendanceMap.get(uniqueId);

    if (!attendee) {
      attendee = {
        userId: userId ? String(userId) : (user?.id ? String(user.id) : ''),
        uniqueId,
        nickname: nickname || user?.nickname || uniqueId,
        avatar,
        firstSeen: now,
        lastActive: now,
        checkinMethod,
        lastComment: commentText,
        commentCount: initialCounts.comments ?? (commentText ? 1 : 0),
        likeCount: initialCounts.likes ?? 0,
        giftCount: initialCounts.gifts ?? 0
      };
      this.attendanceMap.set(uniqueId, attendee);
      this.stats.totalAttendees = this.attendanceMap.size;
      this.emit('newAttendee', attendee);
    } else {
      attendee.lastActive = now;
      if (nickname) attendee.nickname = nickname;
      if (avatar) attendee.avatar = avatar;
      if (commentText) attendee.lastComment = commentText;
    }

    return attendee;
  }

  /**
   * Thiết lập các event listener từ TikTok Webcast
   */
  _setupListeners() {
    if (!this.connection) return;

    // 1. Sự kiện Người xem vào phòng Live (member / join)
    this.connection.on('member', (data) => {
      if (this.settings.mode === 'all' || this.settings.mode === 'join') {
        this._recordAttendee(data, 'Vào xem LIVE');
        this.emit('stats', this.stats);
      }
    });

    // 2. Sự kiện Bình luận (chat)
    this.connection.on('chat', (data) => {
      this.stats.totalComments++;
      // TikTok protobuf v3 dùng trường content cho nội dung bình luận
      const comment = (
        data.content ||
        data.comment ||
        data.text ||
        data.displayText ||
        ''
      ).trim();

      let isValid = false;
      let method = 'Bình luận';

      const mode = this.settings.mode;

      if (mode === 'all' || mode === 'chat_all' || mode === 'chat_or_like') {
        isValid = true;
      } else if (mode === 'chat_keyword') {
        const targetKw = this.settings.keyword.trim();
        if (targetKw) {
          const checkText = this.settings.caseSensitive ? comment : comment.toLowerCase();
          const findText = this.settings.caseSensitive ? targetKw : targetKw.toLowerCase();
          if (checkText.includes(findText)) {
            isValid = true;
            method = `Cú pháp: "${targetKw}"`;
          }
        }
      } else if (mode === 'chat_and_like') {
        isValid = true;
      }

      if (isValid) {
        let attendee = this.attendanceMap.get(data.uniqueId);
        if (!attendee) {
          const initialMethod = mode === 'chat_and_like' ? 'Chưa thả tim' : method;
          attendee = this._recordAttendee(data, initialMethod, comment, { comments: 1 });
        } else {
          attendee.lastActive = new Date();
          attendee.lastComment = comment;
          attendee.commentCount = (attendee.commentCount || 0) + 1;
          if (mode === 'chat_and_like' && attendee.likeCount > 0) {
            attendee.checkinMethod = 'Đủ Cmt & Tim (Hợp lệ)';
          }
          this.emit('attendeeUpdated', attendee);
        }

        this.emit('chatMessage', {
          uniqueId: data.uniqueId,
          nickname: data.nickname,
          comment,
          avatar: attendee?.avatar || data.profilePictureUrl
        });
      } else {
        const existing = this.attendanceMap.get(data.uniqueId);
        if (existing) {
          existing.commentCount = (existing.commentCount || 0) + 1;
          existing.lastActive = new Date();
          existing.lastComment = comment;
          this.emit('attendeeUpdated', existing);
        }
      }

      this.emit('stats', this.stats);
    });

    // 3. Sự kiện Thả tim (like)
    this.connection.on('like', (data) => {
      const addedLikes = data.likeCount || 1;
      this.stats.totalLikes += addedLikes;
      const mode = this.settings.mode;

      if (mode === 'all' || mode === 'chat_or_like' || mode === 'like_only') {
        let attendee = this.attendanceMap.get(data.uniqueId);
        if (!attendee) {
          attendee = this._recordAttendee(data, 'Thả tim', '', { likes: addedLikes });
        } else {
          attendee.likeCount = (attendee.likeCount || 0) + addedLikes;
          attendee.lastActive = new Date();
          this.emit('attendeeUpdated', attendee);
        }
      } else if (mode === 'chat_and_like') {
        let attendee = this.attendanceMap.get(data.uniqueId);
        if (!attendee) {
          attendee = this._recordAttendee(data, 'Chưa bình luận', '', { likes: addedLikes });
        } else {
          attendee.likeCount = (attendee.likeCount || 0) + addedLikes;
          attendee.lastActive = new Date();
          if (attendee.commentCount > 0) {
            attendee.checkinMethod = 'Đủ Cmt & Tim (Hợp lệ)';
          }
          this.emit('attendeeUpdated', attendee);
        }
      } else {
        const existing = this.attendanceMap.get(data.uniqueId);
        if (existing) {
          existing.likeCount = (existing.likeCount || 0) + addedLikes;
          existing.lastActive = new Date();
          this.emit('attendeeUpdated', existing);
        }
      }

      this.emit('stats', this.stats);
    });

    // 4. Sự kiện Tặng quà (gift)
    this.connection.on('gift', (data) => {
      this.stats.totalGifts++;
      if (this.settings.mode === 'all') {
        this._recordAttendee(data, `Tặng ${data.giftName || 'quà'}`);
      }

      const existing = this.attendanceMap.get(data.uniqueId);
      if (existing) {
        existing.giftCount = (existing.giftCount || 0) + (data.repeatCount || 1);
        existing.lastActive = new Date();
        this.emit('attendeeUpdated', existing);
      }

      this.emit('stats', this.stats);
    });

    // 5. Cập nhật số người đang xem (roomUser)
    this.connection.on('roomUser', (data) => {
      if (data.viewerCount !== undefined) {
        this.stats.currentViewers = data.viewerCount;
        this.emit('stats', this.stats);
      }
    });

    // 6. Phiên Live kết thúc
    this.connection.on('streamEnd', () => {
      this.status = 'disconnected';
      this.emit('status', {
        status: 'disconnected',
        channel: this.channel,
        message: 'Phiên LIVE đã kết thúc.'
      });
    });

    // 7. Lỗi kết nối
    this.connection.on('error', (err) => {
      console.error('TikTok Connection Error:', err?.message || err);
      this.emit('status', {
        status: 'error',
        channel: this.channel,
        message: `Lỗi kết nối: ${err?.message || 'Không xác định'}`
      });
    });

    // 8. Đứt kết nối
    this.connection.on('disconnected', () => {
      if (this.status !== 'idle') {
        this.status = 'disconnected';
        this.emit('status', {
          status: 'disconnected',
          channel: this.channel,
          message: 'Mất kết nối với phiên LIVE.'
        });
      }
    });
  }

  /**
   * Lấy danh sách toàn bộ người đã điểm danh (mảng)
   */
  getAttendanceList() {
    return Array.from(this.attendanceMap.values());
  }

  /**
   * Lấy thông tin phiên làm việc
   */
  getSessionInfo() {
    let modeText = 'Bình luận HOẶC Thả tim';
    if (this.settings.mode === 'chat_or_like') modeText = 'Bình luận HOẶC Thả tim (Tương tác trực tiếp)';
    else if (this.settings.mode === 'chat_and_like') modeText = 'Bắt buộc CẢ Bình luận VÀ Thả tim';
    else if (this.settings.mode === 'like_only') modeText = 'Chỉ người Thả tim (Like)';
    else if (this.settings.mode === 'chat_all') modeText = 'Chỉ người có Bình luận (Comment)';
    else if (this.settings.mode === 'chat_keyword') modeText = `Điểm danh theo từ khóa bình luận: "${this.settings.keyword}"`;
    else if (this.settings.mode === 'all') modeText = 'Tất cả người tham gia (Vào live, Bình luận, Thả tim)';
    else if (this.settings.mode === 'join') modeText = 'Chỉ người vừa vào phòng live (Join)';

    return {
      channel: this.channel,
      status: this.status,
      startTime: this.sessionStartTime || new Date(),
      endTime: new Date(),
      modeText,
      mode: this.settings.mode,
      keyword: this.settings.keyword,
      stats: this.stats
    };
  }

  /**
   * Thêm dữ liệu mẫu (Dành cho việc kiểm tra giao diện và kiểm thử)
   */
  addMockData(count = 5) {
    const mockNames = [
      { u: 'nguyenvana_99', n: 'Nguyễn Văn An', c: 'Có mặt điểm danh ạ' },
      { u: 'tranthib_2k', n: 'Trần Thị Bích', c: 'Em chào thầy/cô! MSHV: 20261101' },
      { u: 'lehoang_dev', n: 'Lê Hoàng Nam', c: 'Chào cả lớp' },
      { u: 'phamthu_hang', n: 'Phạm Thu Hằng', c: 'Có mặt ạ!' },
      { u: 'vu_minhtuan', n: 'Vũ Minh Tuấn', c: 'MS: TT9876' }
    ];

    for (let i = 0; i < Math.min(count, mockNames.length); i++) {
      const item = mockNames[i];
      const attendee = this._recordAttendee(
        {
          uniqueId: item.u,
          nickname: item.n,
          profilePictureUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${item.u}`
        },
        'Bình luận điểm danh',
        item.c
      );
      if (attendee) {
        attendee.commentCount = Math.floor(Math.random() * 5) + 1;
        attendee.likeCount = Math.floor(Math.random() * 20) + 1;
      }
    }
    this.emit('stats', this.stats);
  }
}
