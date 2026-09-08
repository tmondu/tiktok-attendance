// TikTok Live Attendance Pro - Frontend Client
(() => {
  const socket = io();

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
          (a.lastComment && a.lastComment.toLowerCase().includes(filter))
        )
      : attendees;

    tableCountBadge.textContent = `${filtered.length} người${filter ? ` (Lọc từ ${attendees.length})` : ''}`;

    if (filtered.length === 0) {
      attendanceTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-icon">${filter ? '🔍' : '📋'}</div>
              <h3>${filter ? 'Không tìm thấy kết quả phù hợp' : 'Chưa có dữ liệu điểm danh'}</h3>
              <p>${filter ? 'Thử tìm với từ khóa khác' : 'Nhập tên kênh và bấm "Bắt Đầu Điểm Danh"'}</p>
            </div>
          </td>
        </tr>`;
      return;
    }

    // Hiển thị tối đa 200 dòng gần nhất trên UI để giữ giao diện siêu mượt (toàn bộ dữ liệu vẫn xuất Excel đầy đủ)
    const displayList = filtered.slice(-200).reverse();

    const fragment = document.createDocumentFragment();
    displayList.forEach((item, index) => {
      const tr = document.createElement('tr');
      const avatarUrl = item.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${item.uniqueId}`;

      let methodClass = 'join';
      if (item.checkinMethod && item.checkinMethod.includes('Cú pháp')) methodClass = 'keyword';
      else if (item.checkinMethod && item.checkinMethod.includes('Đủ Cmt & Tim')) methodClass = 'both';
      else if (item.checkinMethod && item.checkinMethod.includes('Chưa')) methodClass = 'pending';
      else if (item.checkinMethod && item.checkinMethod.includes('Thả tim')) methodClass = 'like';
      else if (item.checkinMethod && item.checkinMethod.includes('Bình luận')) methodClass = 'chat';

      tr.innerHTML = `
        <td class="text-center" style="color: var(--text-muted); font-size: 0.82rem;">${index + 1}</td>
        <td>
          <div class="user-cell">
            <img class="user-avatar" src="${avatarUrl}" alt="${item.nickname || item.uniqueId}" onerror="this.src='https://api.dicebear.com/7.x/bottts/svg?seed=${item.uniqueId}'">
            <div class="user-info">
              <span class="user-name">${escapeHtml(item.nickname || item.uniqueId)}</span>
              <span class="user-handle">@${escapeHtml(item.uniqueId)}</span>
            </div>
          </div>
        </td>
        <td class="text-center" style="color: var(--text-secondary); font-size: 0.85rem;">${formatTime(item.firstSeen)}</td>
        <td class="text-center" style="color: var(--text-secondary); font-size: 0.85rem;">${formatTime(item.lastActive)}</td>
        <td><span class="method-tag ${methodClass}">${escapeHtml(item.checkinMethod || 'Tham gia')}</span></td>
        <td><div class="comment-preview" title="${escapeHtml(item.lastComment || '')}">${escapeHtml(item.lastComment || '—')}</div></td>
        <td class="text-center">
          <div class="interaction-badges">
            <span class="badge-pill" title="Lượt bình luận">💬 ${item.commentCount || 0}</span>
            <span class="badge-pill" title="Lượt thả tim">❤️ ${item.likeCount || 0}</span>
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
      pendingRenderTimeout = setTimeout(renderTable, 250);
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

  socket.on('newAttendee', (attendee) => {
    attendees.push(attendee);
    updateStatsUI({ totalAttendees: attendees.length });
    scheduleRender();
  });

  socket.on('attendeeUpdated', (updated) => {
    const idx = attendees.findIndex(a => a.uniqueId === updated.uniqueId);
    if (idx !== -1) {
      attendees[idx] = updated;
      scheduleRender();
    }
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
    showMessage(`Đang gửi yêu cầu kết nối tới @${channel.replace('@', '')}...`);

    try {
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, mode, keyword })
      });
      const data = await res.json();
      if (!data.success) {
        showMessage(data.message, true);
        btnStart.disabled = false;
      }
    } catch (err) {
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
