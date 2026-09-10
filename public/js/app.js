// TikTok Live Attendance Pro - Frontend Client
(() => {
  console.log('🚀 [TikTok Attendance Pro] Frontend client đã nạp xong!');
  const socket = io();

  socket.on('connect', () => {
    console.log('✅ [Socket.IO] Đã kết nối thành công tới server backend! Client ID:', socket.id);
  });
  socket.on('connect_error', (err) => {
    console.error('❌ [Socket.IO] Lỗi kết nối backend:', err);
    showMessage('Mất kết nối với máy chủ backend: ' + err.message, true);
  });
  socket.on('disconnect', (reason) => {
    console.warn('⚠️ [Socket.IO] Đã ngắt kết nối với backend. Lý do:', reason);
  });

  // State
  let attendees = [];
  let currentStatus = 'idle';
  let ecoMode = false;
  let searchFilter = '';
  let pendingRenderTimeout = null;

  // DOM Elements
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const ecoModeToggle = document.getElementById('ecoModeToggle');
  const channelInput = document.getElementById('channelInput');
  const modeSelect = document.getElementById('modeSelect');
  const keywordGroup = document.getElementById('keywordGroup');
  const keywordInput = document.getElementById('keywordInput');

  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnReset = document.getElementById('btnReset');
  const btnMock = document.getElementById('btnMock');
  const btnExportHeader = document.getElementById('btnExportHeader');
  const btnExportTable = document.getElementById('btnExportTable');

  const statAttendees = document.getElementById('statAttendees');
  const statComments = document.getElementById('statComments');
  const statLikes = document.getElementById('statLikes');
  const statGifts = document.getElementById('statGifts');
  const statViewers = document.getElementById('statViewers');

  const tableCountBadge = document.getElementById('tableCountBadge');
  const searchInput = document.getElementById('searchInput');
  const attendanceTbody = document.getElementById('attendanceTbody');
  const emptyRow = document.getElementById('emptyRow');
  const systemMessage = document.getElementById('systemMessage');
  const msgContent = document.getElementById('msgContent');

  // Format Helper
  function formatTime(isoString) {
    if (!isoString) return '--:--';
    const d = new Date(isoString);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function showMessage(text, isError = false) {
    if (!text) {
      systemMessage.style.display = 'none';
      return;
    }
    systemMessage.style.display = 'flex';
    systemMessage.className = 'system-message' + (isError ? ' error' : '');
    msgContent.textContent = text;
  }

  function updateStatusUI(status, channel, message) {
    currentStatus = status;
    statusPill.setAttribute('data-status', status);

    const labels = {
      idle: 'Chưa kết nối',
      connecting: 'Đang kết nối...',
      connected: `Đang LIVE: @${channel || ''}`,
      disconnected: 'Đã dừng / Kết thúc',
      error: 'Lỗi kết nối'
    };

    statusText.textContent = labels[status] || status;

    if (status === 'connected') {
      btnStart.disabled = true;
      btnStop.disabled = false;
      channelInput.disabled = true;
      modeSelect.disabled = true;
      keywordInput.disabled = true;
    } else if (status === 'connecting') {
      btnStart.disabled = true;
      btnStop.disabled = false;
    } else {
      btnStart.disabled = false;
      btnStop.disabled = true;
      channelInput.disabled = false;
      modeSelect.disabled = false;
      keywordInput.disabled = false;
    }

    if (message) {
      showMessage(message, status === 'error');
    }
  }

  function updateStatsUI(stats) {
    if (!stats) return;
    statAttendees.textContent = (stats.totalAttendees || attendees.length).toLocaleString();
    statComments.textContent = (stats.totalComments || 0).toLocaleString();
    statLikes.textContent = (stats.totalLikes || 0).toLocaleString();
    statGifts.textContent = (stats.totalGifts || 0).toLocaleString();
    statViewers.textContent = (stats.currentViewers || 0).toLocaleString();
    tableCountBadge.textContent = `${attendees.length} người`;
  }

  // Render Table Rows (Efficient Chunked / Filtered)
  function renderTable() {
    if (pendingRenderTimeout) {
      clearTimeout(pendingRenderTimeout);
      pendingRenderTimeout = null;
    }

    const filter = searchFilter.toLowerCase().trim();
    const filtered = filter
      ? attendees.filter(a =>
          (a.uniqueId && a.uniqueId.toLowerCase().includes(filter)) ||
          (a.nickname && a.nickname.toLowerCase().includes(filter)) ||
          (a.comment && a.comment.toLowerCase().includes(filter)) ||
          (a.lastComment && a.lastComment.toLowerCase().includes(filter))
        )
      : attendees;

    tableCountBadge.textContent = `${filtered.length} dòng${filter ? ` (Lọc từ ${attendees.length})` : ''}`;

    if (filtered.length === 0) {
      attendanceTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-icon">${filter ? '🔍' : '📋'}</div>
              <h3>${filter ? 'Không tìm thấy kết quả phù hợp' : 'Chưa có dữ liệu điểm danh'}</h3>
              <p>${filter ? 'Thử tìm với từ khóa khác' : 'Nhập tên kênh và bấm "Bắt Đầu Điểm Danh"'}</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    // Hiển thị tối đa 300 dòng gần nhất trên UI để giữ giao diện siêu mượt (toàn bộ dữ liệu vẫn xuất Excel đầy đủ)
    const displayList = filtered.slice(-300).reverse();

    const fragment = document.createDocumentFragment();
    displayList.forEach((item, index) => {
      const tr = document.createElement('tr');
      const avatarUrl = item.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${item.uniqueId}`;

      let methodClass = 'chat';
      if (item.checkinMethod && item.checkinMethod.includes('Cú pháp')) methodClass = 'keyword';
      else if (item.checkinMethod && item.checkinMethod.includes('Đủ Cmt & Tim')) methodClass = 'both';
      else if (item.checkinMethod && item.checkinMethod.includes('Vào xem')) methodClass = 'join';
      else if (item.checkinMethod && item.checkinMethod.includes('Thả tim')) methodClass = 'like';
      else if (item.checkinMethod && item.checkinMethod.includes('Tặng')) methodClass = 'like';

      const commentText = item.comment || item.lastComment || '';
      const orderBadge = item.commentIndex ? `<span class="cmt-order-badge" title="Lượt bình luận thứ ${item.commentIndex} của người này">Lần ${item.commentIndex}</span>` : '';

      tr.innerHTML = `
        <td class="text-center" style="color: var(--text-muted); font-size: 0.82rem;">${index + 1}</td>
        <td>
          <div class="user-cell">
            <img class="user-avatar" src="${avatarUrl}" referrerpolicy="no-referrer" alt="${item.nickname || item.uniqueId}" onerror="this.src='https://api.dicebear.com/7.x/bottts/svg?seed=${item.uniqueId}'">
            <div class="user-info">
              <span class="user-name">${escapeHtml(item.nickname || item.uniqueId)}</span>
              <span class="user-handle">@${escapeHtml(item.uniqueId)}</span>
            </div>
          </div>
        </td>
        <td class="text-center" style="color: var(--text-secondary); font-size: 0.85rem;">${formatTime(item.time || item.firstSeen)}</td>
        <td>
          <span class="method-tag ${methodClass}">${escapeHtml(item.checkinMethod || 'Bình luận')}</span>
          ${orderBadge}
        </td>
        <td>
          <div class="single-comment-cell" title="${escapeHtml(commentText)}">
            ${commentText ? escapeHtml(commentText) : '<span style="color: var(--text-muted); font-style: italic;">—</span>'}
          </div>
        </td>
        <td class="text-center">
          <div class="interaction-badges">
            <span class="badge-pill" title="Tổng bình luận của người này">💬 ${item.commentCount || 0}</span>
            <span class="badge-pill" title="Tổng tim của người này">❤️ ${item.likeCount || 0}</span>
          </div>
        </td>
      `;
      fragment.appendChild(tr);
    });

    attendanceTbody.innerHTML = '';
    attendanceTbody.appendChild(fragment);
  }

  function scheduleRender() {
    if (ecoMode) return; // Nếu bật Eco mode, tạm hoãn render liên tục
    if (!pendingRenderTimeout) {
      pendingRenderTimeout = setTimeout(renderTable, 200);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Socket.IO Event Handlers ---
  socket.on('init', (data) => {
    attendees = data.attendees || [];
    if (data.channel) channelInput.value = data.channel;
    if (data.settings) {
      modeSelect.value = data.settings.mode || 'all';
      if (data.settings.keyword) keywordInput.value = data.settings.keyword;
    }
    toggleKeywordVisibility();
    updateStatusUI(data.status, data.channel);
    updateStatsUI(data.stats);
    renderTable();
  });

  socket.on('status', (data) => {
    updateStatusUI(data.status, data.channel, data.message);
  });

  socket.on('stats', (stats) => {
    updateStatsUI(stats);
  });

  socket.on('newRecord', (record) => {
    if (!attendees.some(a => a.id && a.id === record.id)) {
      attendees.push(record);
      scheduleRender();
    }
  });

  socket.on('userLikesUpdated', (data) => {
    let changed = false;
    const targetId = (data.uniqueId || '').replace(/^@/, '').toLowerCase().trim();

    attendees.forEach((item) => {
      const itemId = (item.uniqueId || '').replace(/^@/, '').toLowerCase().trim();
      if (itemId === targetId) {
        item.likeCount = data.likeCount;
        if (data.checkinMethod) item.checkinMethod = data.checkinMethod;
        changed = true;
      }
    });

    // Cập nhật trực tiếp số tim vào các dòng đang hiển thị trên màn hình
    const rows = attendanceTbody.querySelectorAll('tr');
    rows.forEach((tr) => {
      const handleEl = tr.querySelector('.user-handle');
      if (handleEl) {
        const rowId = handleEl.textContent.replace(/^@/, '').toLowerCase().trim();
        if (rowId === targetId) {
          const badges = tr.querySelectorAll('.interaction-badges .badge-pill');
          if (badges.length >= 2) {
            badges[1].textContent = `❤️ ${data.likeCount || 0}`;
          }
          if (data.checkinMethod) {
            const tagEl = tr.querySelector('.method-tag');
            if (tagEl) {
              tagEl.textContent = data.checkinMethod;
              tagEl.className = 'method-tag both';
            }
          }
        }
      }
    });

    if (changed) scheduleRender();
  });

  socket.on('reset', () => {
    attendees = [];
    updateStatsUI({ totalAttendees: 0, totalComments: 0, totalLikes: 0, totalGifts: 0, currentViewers: 0 });
    renderTable();
    showMessage('Đã xóa toàn bộ dữ liệu điểm danh.');
  });

  // --- UI Interactions ---

  function toggleKeywordVisibility() {
    keywordGroup.style.display = modeSelect.value === 'chat_keyword' ? 'flex' : 'none';
  }

  modeSelect.addEventListener('change', toggleKeywordVisibility);

  // Eco-mode switch
  ecoModeToggle.addEventListener('change', (e) => {
    ecoMode = e.target.checked;
    if (!ecoMode) {
      renderTable();
      showMessage('Chế độ xem đầy đủ đã bật.');
    } else {
      showMessage('⚡ Chế độ Tiết kiệm CPU đã bật: Dữ liệu vẫn ghi nhận bình thường nhưng giảm tải render màn hình.');
    }
  });

  // Start Attendance
  btnStart.addEventListener('click', async () => {
    const channel = channelInput.value.trim();
    if (!channel) {
      alert('Vui lòng nhập Username kênh TikTok đang LIVE!');
      channelInput.focus();
      return;
    }

    const mode = modeSelect.value;
    const keyword = keywordInput.value.trim();
    if (mode === 'chat_keyword' && !keyword) {
      alert('Vui lòng nhập từ khóa/cú pháp điểm danh!');
      keywordInput.focus();
      return;
    }

    btnStart.disabled = true;
    const cleanName = channel.replace(/^@/, '');
    showMessage(`Đang gửi yêu cầu kết nối tới @${cleanName}...`);
    console.log(`\n👉 [UI] Bấm bắt đầu điểm danh kênh: "${channel}", chế độ: "${mode}"`);

    try {
      console.log(`📡 [HTTP] Gửi POST /api/start...`);
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, mode, keyword })
      });
      console.log(`📥 [HTTP] Phản hồi HTTP Status: ${res.status}`);
      const data = await res.json();
      console.log(`📥 [HTTP] Dữ liệu nhận về:`, data);
      if (!data.success) {
        showMessage(data.message, true);
        btnStart.disabled = false;
      }
    } catch (err) {
      console.error(`❌ [HTTP] Lỗi fetch /api/start:`, err);
      showMessage('Lỗi kết nối máy chủ backend: ' + err.message, true);
      btnStart.disabled = false;
    }
  });

  // Stop Attendance
  btnStop.addEventListener('click', async () => {
    btnStop.disabled = true;
    try {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      showMessage(data.message || 'Đã dừng.');
    } catch (err) {
      showMessage('Lỗi: ' + err.message, true);
    }
  });

  // Reset Attendance
  btnReset.addEventListener('click', async () => {
    if (attendees.length > 0) {
      if (!confirm('Bạn có chắc muốn xóa toàn bộ danh sách điểm danh hiện tại không?')) {
        return;
      }
    }
    try {
      await fetch('/api/reset', { method: 'POST' });
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Mock Data Test Button
  btnMock.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 })
      });
      const data = await res.json();
      showMessage(data.message);
      renderTable();
    } catch (err) {
      alert('Lỗi khi thêm dữ liệu mẫu: ' + err.message);
    }
  });

  // Search Filter
  searchInput.addEventListener('input', (e) => {
    searchFilter = e.target.value;
    renderTable();
  });

  // Export Excel
  function handleExportExcel() {
    if (attendees.length === 0) {
      if (!confirm('Danh sách điểm danh hiện đang trống. Bạn vẫn muốn xuất file Excel chứ?')) {
        return;
      }
    }
    showMessage('Đang chuẩn bị và tạo file Excel...');
    window.location.href = '/api/export';
  }

  btnExportHeader.addEventListener('click', handleExportExcel);
  btnExportTable.addEventListener('click', handleExportExcel);

  // Initialize
  toggleKeywordVisibility();
})();
