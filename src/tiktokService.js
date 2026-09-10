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
    this.attendanceMap = new Map(); // Lưu thông tin người dùng duy nhất và thống kê (uniqueId -> userStats)
    this.userIdMap = new Map(); // Ánh xạ userId -> uniqueId để đồng bộ sự kiện thả tim khi TikTok không gửi uniqueId
    this.records = []; // Lưu toàn bộ các dòng ghi nhận (mỗi cmt là 1 dòng riêng biệt)
    this.processedMsgIds = new Set(); // Bộ nhớ chống trùng lặp tin nhắn theo ID của TikTok
    this.recentComments = new Map(); // Bộ nhớ chống trùng lặp tin nhắn theo user + content (<1.5s)
    this.stats = {
      totalAttendees: 0,
      totalComments: 0,
      totalLikes: 0,
      totalGifts: 0,
      currentViewers: 0
    };
  }

  /**
   * Trích xuất link avatar từ payload của TikTok
   */
  _extractAvatar(userData) {
    if (!userData) return '';
    return userData.profilePictureUrl ||
      userData.avatarThumb?.urlList?.[0] ||
      userData.avatarMedium?.urlList?.[0] ||
      userData.avatarLarge?.urlList?.[0] ||
      userData.user?.avatarThumb?.urlList?.[0] ||
      userData.user?.avatarLarge?.urlList?.[0] ||
      userData.user?.profilePictureUrl ||
      userData.rawUser?.avatarThumb?.urlList?.[0] ||
      userData.rawUser?.avatarLarge?.urlList?.[0] ||
      '';
  }

  /**
   * Trích xuất và chuẩn hóa thông tin người dùng từ mọi sự kiện TikTok
   */
  _resolveUser(data) {
    if (!data) return null;

    const rawUserId = data.userId || 
                      data.rawUser?.idStr || 
                      data.rawUser?.id || 
                      data.user?.idStr || 
                      data.user?.id || 
                      data.user?.userId;
    const strUserId = rawUserId ? String(rawUserId) : '';

    let uniqueId = data.uniqueId || 
                   data.displayId || 
                   data.rawUser?.displayId || 
                   data.rawUser?.uniqueId || 
                   data.user?.uniqueId || 
                   data.user?.displayId;

    if (uniqueId) {
      uniqueId = String(uniqueId).replace(/^@/, '').trim();
    }

    // Tra cứu từ userId nếu uniqueId chưa có
    if (!uniqueId && strUserId && this.userIdMap.has(strUserId)) {
      uniqueId = this.userIdMap.get(strUserId);
    }

    // Fallback: nếu vẫn chưa có uniqueId thì dùng strUserId hoặc nickname
    if (!uniqueId) {
      if (strUserId) {
        uniqueId = `user_${strUserId}`;
      } else if (data.nickname || data.user?.nickname) {
        uniqueId = String(data.nickname || data.user?.nickname).toLowerCase().replace(/\s+/g, '_');
      } else {
        return null;
      }
    }

    // Lưu vào mapping nếu có cả userId và uniqueId chuẩn
    if (strUserId && uniqueId && !uniqueId.startsWith('user_')) {
      this.userIdMap.set(strUserId, uniqueId);
    }

    const nickname = data.nickname || 
                     data.rawUser?.nickname || 
                     data.user?.nickname || 
                     data.user?.nickName || 
                     uniqueId;

    const avatar = this._extractAvatar(data);

    return { uniqueId, nickname, avatar, userId: strUserId };
  }

  /**
   * Xử lý bình luận / emote / câu hỏi từ người xem và ghi vào danh sách
   */
  _handleChatMessage(data, comment, defaultMethod = 'Bình luận') {
    const user = this._resolveUser(data);
    if (!user) return;
    const { uniqueId, nickname, avatar, userId } = user;

    // --- CHỐNG GỬI LẶP TIN NHẮN (DEDUPLICATION) ---
    const msgId = data.msgId ? String(data.msgId) : null;
    const nowMs = Date.now();

    if (msgId) {
      if (this.processedMsgIds.has(msgId)) {
        return; // Bỏ qua vì trùng msgId từ TikTok
      }
      this.processedMsgIds.add(msgId);
      if (this.processedMsgIds.size > 5000) {
        const oldest = this.processedMsgIds.values().next().value;
        this.processedMsgIds.delete(oldest);
      }
    }

    // Chống lặp cùng user + cùng nội dung cmt trong 1.5 giây
    const recentKey = `${uniqueId}_${comment}`;
    const lastSeen = this.recentComments.get(recentKey);
    if (lastSeen && (nowMs - lastSeen) < 1500) {
      return;
    }
    this.recentComments.set(recentKey, nowMs);
    if (this.recentComments.size > 2000) {
      const oldestKey = this.recentComments.keys().next().value;
      this.recentComments.delete(oldestKey);
    }

    this.stats.totalComments++;

    // In log ra terminal để người dùng dễ dàng theo dõi trực tiếp
    console.log(`[TikTok LIVE] Bình luận từ @${uniqueId} (${nickname}): "${comment}"`);

    let isValid = false;
    let method = defaultMethod;
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
      const now = new Date();
      let userStats = this.attendanceMap.get(uniqueId);
      if (!userStats && userId && this.userIdMap.has(userId)) {
        userStats = this.attendanceMap.get(this.userIdMap.get(userId));
      }

      if (!userStats) {
        userStats = {
          userId,
          uniqueId,
          nickname,
          avatar,
          firstSeen: now,
          lastActive: now,
          commentCount: 1,
          likeCount: 0,
          giftCount: 0,
          lastComment: comment
        };
        this.attendanceMap.set(uniqueId, userStats);
        this.stats.totalAttendees = this.attendanceMap.size;
      } else {
        userStats.commentCount = (userStats.commentCount || 0) + 1;
        userStats.lastActive = now;
        userStats.lastComment = comment;
        if (nickname && userStats.nickname === userStats.uniqueId) userStats.nickname = nickname;
        if (avatar && !userStats.avatar) userStats.avatar = avatar;
      }

      // Tạo 1 dòng mới tinh cho lượt bình luận này
      const record = {
        id: `cmt_${Date.now()}_${this.records.length + 1}`,
        uniqueId: userStats.uniqueId,
        nickname: userStats.nickname,
        avatar: userStats.avatar || avatar,
        time: now,
        checkinMethod: method,
        comment,
        commentIndex: userStats.commentCount, // Thứ tự cmt của user này (Lần 1, Lần 2...)
        commentCount: userStats.commentCount,
        likeCount: userStats.likeCount,
        giftCount: userStats.giftCount
      };

      this.records.push(record);
      this.emit('newRecord', record);

      this.emit('chatMessage', {
        uniqueId: userStats.uniqueId,
        nickname: userStats.nickname,
        comment,
        avatar: record.avatar
      });
    }

    this.emit('stats', this.stats);
  }

  /**
   * Tự động lấy cookie ttwid từ máy chủ TikTok để vượt qua xác thực handshake WebSocket
   */
  async _fetchTtwidCookie() {
    const endpoints = [
      'https://www.tiktok.com/live',
      'https://www.tiktok.com/@tiktok/live',
      'https://www.tiktok.com/'
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
          },
          signal: AbortSignal.timeout(6000)
        });
        const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
        const ttwid = cookies.find(c => c && c.includes('ttwid='));
        if (ttwid) {
          return ttwid;
        }
      } catch (e) {
        // Thử endpoint tiếp theo
      }
    }
    return null;
  }

  /**
   * Thiết lập cookie ttwid và bảo vệ không cho sign-server ghi đè cookie rỗng
   */
  async _ensureValidTtwidCookie() {
    if (!this.connection?.webClient?.cookieJar) return;

    try {
      const cookieJar = this.connection.webClient.cookieJar;
      const ttwidCookie = await this._fetchTtwidCookie();
      if (ttwidCookie) {
        await cookieJar.setCookie(ttwidCookie);
        console.log('[TikTok LIVE] Đã tự động cấp cookie ttwid hợp lệ cho phiên kết nối.');
      }

      // Bảo vệ: ngăn sign server trả về header rỗng 'ttwid=' làm mất cookie ttwid
      const origProcess = cookieJar.processSetCookieHeader.bind(cookieJar);
      cookieJar.processSetCookieHeader = async function(header) {
        if (header && typeof header === 'string' && header.startsWith('ttwid=') && header.split(';')[0].trim() === 'ttwid=') {
          return;
        }
        return origProcess(header);
      };
    } catch (err) {
      console.warn('[TikTok LIVE] Cảnh báo khi cấu hình ttwid cookie:', err.message);
    }
  }

  /**
   * Trích xuất username TikTok sạch từ chuỗi nhập vào (hỗ trợ cả URL đầy đủ)
   */
  static extractUsername(input) {
    if (!input) return '';
    let str = input.trim();
    const urlMatch = str.match(/tiktok\.com\/@([^/?#&]+)/i);
    if (urlMatch) {
      return urlMatch[1];
    }
    str = str.replace(/^@+/, '');
    str = str.split('/')[0].split('?')[0].split('#')[0].trim();
    return str;
  }

  /**
   * Bắt đầu kết nối tới kênh TikTok Live
   */
  async start(channelInput, customSettings = {}) {
    if (this.status === 'connected' || this.status === 'connecting') {
      await this.stop();
    }

    const cleanChannel = TikTokService.extractUsername(channelInput);
    if (!cleanChannel) {
      throw new Error('Username TikTok không hợp lệ.');
    }

    this.channel = cleanChannel;
    this.settings = { ...this.settings, ...customSettings };
    this.sessionStartTime = new Date();
    this.status = 'connecting';
    console.log(`\n[TikTok LIVE] Bắt đầu kết nối tới kênh @${this.channel}...`);
    this.emit('status', { status: this.status, channel: this.channel, message: `Đang kết nối tới @${this.channel}...` });

    try {
      // Khởi tạo kết nối với tùy chọn tối ưu tài nguyên
      const connOptions = {
        processInitialData: true,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 1500,
        clientParams: {
          app_language: 'vi-VN',
          webcast_language: 'vi-VN'
        }
      };

      if (customSettings.sessionId) {
        connOptions.session = {
          cookie: {
            type: 'cookie',
            value: {
              sessionId: customSettings.sessionId.trim(),
              ttTargetIdc: customSettings.ttTargetIdc?.trim() || 'useast1a'
            }
          }
        };
      }

      this.connection = new WebcastPushConnection(this.channel, connOptions);

      // Tự động cấp cookie ttwid hợp lệ nếu chưa có, khắc phục triệt để lỗi "Unexpected server response: 200" (ttwid_info_nil)
      await this._ensureValidTtwidCookie();

      this._setupListeners();

      const state = await this.connection.connect();
      this.status = 'connected';
      this.stats.currentViewers = state?.roomInfo?.user_count || 0;
      console.log(`✅ [TikTok LIVE] Đã kết nối thành công tới LIVE của @${this.channel} (Room ID: ${state?.roomId || 'N/A'})!`);

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
      console.error('\n❌ [TikTok Connection Error]:', err?.message || err);
      if (err.config?.requestErrs) {
        console.error('[Chi tiết các lỗi request]:', err.config.requestErrs);
      }

      const allMsgs = [
        err?.message || '',
        ...(err?.config?.requestErrs?.map(e => e?.message || '') || [])
      ].join(' ').toLowerCase();

      let errMsg = '';
      if (allMsgs.includes('enotfound') || allMsgs.includes('etimedout') || allMsgs.includes('econnrefused') || allMsgs.includes('fetch failed')) {
        errMsg = 'Lỗi mạng hoặc Tường lửa (Firewall): Máy tính không thể kết nối tới máy chủ TikTok. Vui lòng kiểm tra Internet, tắt hoặc cho phép Windows Defender Firewall cho file .exe, hoặc đổi DNS sang 8.8.8.8.';
      } else if (allMsgs.includes('failed to retrieve room id') || allMsgs.includes('user_not_found') || allMsgs.includes('offline')) {
        errMsg = `Không tìm thấy phòng LIVE của @${this.channel}. Hãy kiểm tra xem kênh ĐANG PHÁT TRỰC TIẾP trên TikTok hay không và nhập đúng Username.`;
      } else if (allMsgs.includes('rate limit')) {
        errMsg = 'Địa chỉ IP của máy tính đang bị TikTok hoặc máy chủ ký tạm giới hạn tần suất (Rate Limit). Vui lòng thử lại sau vài phút hoặc đổi sang mạng 4G/DNS khác.';
      } else if (allMsgs.includes('unexpected server response: 200')) {
        errMsg = 'Máy chủ TikTok từ chối nâng cấp kết nối WebSocket (Handshake thất bại do thiếu cookie hợp lệ hoặc IP bị chặn). Ứng dụng đã thử tự động cấp lại ttwid cookie, vui lòng thử lại sau ít giây hoặc nhập Session ID trong Cài đặt nâng cao.';
      } else {
        errMsg = err?.message || 'Không thể kết nối tới TikTok Live. Kênh có thể chưa phát live.';
      }

      this.emit('status', {
        status: this.status,
        channel: this.channel,
        message: errMsg
      });
      throw new Error(errMsg);
    }
  }

  /**
   * Dừng kết nối
   */
  async stop() {
    if (this.connection) {
      try {
        await this.connection.disconnect();
      } catch (e) {}
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
    this.userIdMap.clear();
    this.records = [];
    this.processedMsgIds.clear();
    this.recentComments.clear();
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
   * Thiết lập các event listener từ TikTok Webcast
   */
  _setupListeners() {
    if (!this.connection) return;

    // 1. Sự kiện Người xem vào phòng Live (member / join)
    this.connection.on('member', (data) => {
      if (this.settings.mode === 'all' || this.settings.mode === 'join') {
        const user = this._resolveUser(data);
        if (!user) return;
        const { uniqueId, nickname, avatar, userId } = user;

        if (!this.attendanceMap.has(uniqueId)) {
          const now = new Date();
          const userStats = {
            userId,
            uniqueId,
            nickname,
            avatar,
            firstSeen: now,
            lastActive: now,
            commentCount: 0,
            likeCount: 0,
            giftCount: 0
          };
          this.attendanceMap.set(uniqueId, userStats);
          this.stats.totalAttendees = this.attendanceMap.size;

          const record = {
            id: `join_${Date.now()}_${this.records.length + 1}`,
            uniqueId,
            nickname: userStats.nickname,
            avatar: userStats.avatar,
            time: now,
            checkinMethod: 'Vào xem LIVE',
            comment: '',
            commentIndex: null,
            commentCount: 0,
            likeCount: 0,
            giftCount: 0
          };
          this.records.push(record);
          this.emit('newRecord', record);
        }
        this.emit('stats', this.stats);
      }
    });

    // 2. Sự kiện Bình luận (chat, emote, questionNew) - Hỗ trợ mọi hình thức comment của người xem
    this.connection.on('chat', (data) => {
      const comment = (
        data.content ||
        data.comment ||
        data.text ||
        data.displayText ||
        data.message ||
        data.common?.displayText?.defaultPattern ||
        (Array.isArray(data.emotes) && data.emotes.length ? '[Nhãn dán/Emote]' : '') ||
        ''
      ).toString().trim();

      if (comment) {
        this._handleChatMessage(data, comment, 'Bình luận');
      }
    });

    // Bắt sự kiện người xem gửi Sticker / Emote
    this.connection.on('emote', (data) => {
      const comment = (
        data.comment ||
        data.content ||
        data.text ||
        (Array.isArray(data.emotes) && data.emotes.length ? '[Nhãn dán/Emote]' : '[Biểu tượng cảm xúc]')
      ).toString().trim();

      if (comment) {
        this._handleChatMessage(data, comment, 'Nhãn dán / Emote');
      }
    });

    // Bắt sự kiện người xem đặt câu hỏi trong mục Q&A
    this.connection.on('questionNew', (data) => {
      const comment = (
        data.text ||
        data.questionText ||
        data.details?.text ||
        data.content ||
        ''
      ).toString().trim();

      if (comment) {
        this._handleChatMessage(data, comment, 'Hỏi đáp Q&A');
      }
    });

    // 3. Sự kiện Thả tim (like) - Bắt mọi lượt tim, cập nhật tức thì vào bảng và thống kê
    this.connection.on('like', (data) => {
      if (!data) return;

      const addedLikes = Math.max(1, Number(data.likeCount || data.count || data.likes || 1));

      if (data.totalLikeCount) {
        this.stats.totalLikes = Math.max(this.stats.totalLikes, Number(data.totalLikeCount));
      } else if (data.total) {
        this.stats.totalLikes = Math.max(this.stats.totalLikes, Number(data.total));
      } else {
        this.stats.totalLikes += addedLikes;
      }

      const user = this._resolveUser(data);
      if (!user) {
        // Vẫn cập nhật tổng tim phiên LIVE dù không lấy được người dùng
        this.emit('stats', this.stats);
        return;
      }

      const { uniqueId, nickname, avatar, userId } = user;
      const mode = this.settings.mode;
      const now = new Date();

      let userStats = this.attendanceMap.get(uniqueId);
      if (!userStats && userId && this.userIdMap.has(userId)) {
        userStats = this.attendanceMap.get(this.userIdMap.get(userId));
      }

      if (!userStats) {
        userStats = {
          userId,
          uniqueId,
          nickname,
          avatar,
          firstSeen: now,
          lastActive: now,
          commentCount: 0,
          likeCount: addedLikes,
          giftCount: 0
        };
        this.attendanceMap.set(uniqueId, userStats);
        this.stats.totalAttendees = this.attendanceMap.size;

        if (mode === 'chat_or_like' || mode === 'like_only' || mode === 'all') {
          const record = {
            id: `like_${Date.now()}_${this.records.length + 1}`,
            uniqueId: userStats.uniqueId,
            nickname: userStats.nickname,
            avatar: userStats.avatar,
            time: now,
            checkinMethod: 'Thả tim LIVE',
            comment: '',
            commentIndex: null,
            commentCount: 0,
            likeCount: userStats.likeCount,
            giftCount: 0
          };
          this.records.push(record);
          this.emit('newRecord', record);
        }
      } else {
        userStats.likeCount = (userStats.likeCount || 0) + addedLikes;
        userStats.lastActive = now;
        if (nickname && userStats.nickname === userStats.uniqueId) userStats.nickname = nickname;
        if (avatar && !userStats.avatar) userStats.avatar = avatar;

        // Cập nhật lượt tim vào tất cả các dòng đã lưu của người này trong this.records
        for (let i = this.records.length - 1; i >= 0; i--) {
          if (this.records[i].uniqueId === userStats.uniqueId) {
            this.records[i].likeCount = userStats.likeCount;
            if (mode === 'chat_and_like' && userStats.commentCount > 0) {
              this.records[i].checkinMethod = 'Đủ Cmt & Tim (Hợp lệ)';
            }
          }
        }

        // Phát sự kiện cập nhật thời gian thực số tim trên giao diện
        this.emit('userLikesUpdated', {
          uniqueId: userStats.uniqueId,
          likeCount: userStats.likeCount,
          checkinMethod: mode === 'chat_and_like' && userStats.commentCount > 0 ? 'Đủ Cmt & Tim (Hợp lệ)' : null
        });
      }

      this.emit('stats', this.stats);
    });

    // 4. Sự kiện Tặng quà (gift)
    this.connection.on('gift', (data) => {
      this.stats.totalGifts++;
      const user = this._resolveUser(data);
      const uniqueId = user ? user.uniqueId : (data.uniqueId || '');
      let userStats = uniqueId ? this.attendanceMap.get(uniqueId) : null;

      if (userStats) {
        userStats.giftCount = (userStats.giftCount || 0) + (data.repeatCount || 1);
        userStats.lastActive = new Date();
      }

      if (this.settings.mode === 'all' && user) {
        const now = new Date();
        const record = {
          id: `gift_${Date.now()}_${this.records.length + 1}`,
          uniqueId: user.uniqueId,
          nickname: user.nickname,
          avatar: user.avatar,
          time: now,
          checkinMethod: `Tặng ${data.giftName || 'quà'}`,
          comment: `[Quà: ${data.giftName || 'Gift'} x${data.repeatCount || 1}]`,
          commentIndex: null,
          commentCount: userStats?.commentCount || 0,
          likeCount: userStats?.likeCount || 0,
          giftCount: (userStats?.giftCount || 0) + (data.repeatCount || 1)
        };
        this.records.push(record);
        this.emit('newRecord', record);
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
   * Lấy danh sách toàn bộ dòng điểm danh (mỗi bình luận là 1 dòng riêng)
   */
  getAttendanceList() {
    return this.records;
  }

  /**
   * Lấy danh sách tổng hợp tương tác của từng người dùng duy nhất
   */
  getUserSummaryList() {
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
   * Thêm dữ liệu mẫu (mỗi bình luận hiển thị thành 1 dòng riêng biệt)
   */
  addMockData(count = 5) {
    const mockComments = [
      { u: 'nguyenvana_99', n: 'Nguyễn Văn An', c: 'Em chào thầy ạ!' },
      { u: 'tranthib_2k', n: 'Trần Thị Bích', c: 'Em chào thầy/cô! MSHV: 20261101' },
      { u: 'nguyenvana_99', n: 'Nguyễn Văn An', c: 'Có mặt điểm danh ạ! MSV: 20260101' },
      { u: 'lehoang_dev', n: 'Lê Hoàng Nam', c: 'Chào cả lớp, hôm nay học bài nào vậy mọi người?' },
      { u: 'tranthib_2k', n: 'Trần Thị Bích', c: 'Em đã thả 20 tim rồi ạ' },
      { u: 'phamthu_hang', n: 'Phạm Thu Hằng', c: 'Có mặt ạ!' },
      { u: 'vu_minhtuan', n: 'Vũ Minh Tuấn', c: 'MS: TT9876' },
      { u: 'vu_minhtuan', n: 'Vũ Minh Tuấn', c: 'Thầy cho em xin tài liệu buổi trước với ạ' }
    ];

    const limit = Math.min(count * 2, mockComments.length);
    for (let i = 0; i < limit; i++) {
      const item = mockComments[i];
      const now = new Date(Date.now() - (limit - i) * 20000);
      let userStats = this.attendanceMap.get(item.u);

      if (!userStats) {
        userStats = {
          uniqueId: item.u,
          nickname: item.n,
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${item.u}`,
          firstSeen: now,
          lastActive: now,
          commentCount: 1,
          likeCount: Math.floor(Math.random() * 10) + 1,
          giftCount: 0,
          lastComment: item.c
        };
        this.attendanceMap.set(item.u, userStats);
      } else {
        userStats.commentCount++;
        userStats.lastActive = now;
        userStats.lastComment = item.c;
      }

      const record = {
        id: `mock_${Date.now()}_${i + 1}`,
        uniqueId: item.u,
        nickname: item.n,
        avatar: userStats.avatar,
        time: now,
        checkinMethod: 'Bình luận điểm danh',
        comment: item.c,
        commentIndex: userStats.commentCount, // Lần 1, Lần 2 của user này
        commentCount: userStats.commentCount,
        likeCount: userStats.likeCount,
        giftCount: userStats.giftCount
      };

      this.records.push(record);
      this.stats.totalComments++;
      this.stats.totalLikes += record.likeCount;
      this.emit('newRecord', record);
    }

    this.stats.totalAttendees = this.attendanceMap.size;
    this.emit('stats', this.stats);
  }
}
