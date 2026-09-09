import ExcelJS from 'exceljs';

/**
 * Định dạng thời gian theo chuẩn Việt Nam
 */
function formatTime(d) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Tạo sheet tổng hợp người dùng (Top Cmt hoặc Top Tim)
 */
function createSummaryWorksheet(workbook, options) {
  const {
    sheetName,
    bannerTitle,
    bannerColor = 'FF1E1E2F',
    headerColor = 'FF0E7490',
    userList = [],
    sessionInfo = {},
    sortCriterion = 'Số lần bình luận (CMT)'
  } = options;

  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ showGridLines: true }]
  });

  const {
    channel = 'N/A',
    startTime = new Date(),
    totalComments = 0,
    totalLikes = 0
  } = sessionInfo;

  // 1. Header Banner
  worksheet.mergeCells('A1:J1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = bannerTitle;
  titleCell.font = { name: 'Segoe UI', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: bannerColor }
  };
  worksheet.getRow(1).height = 36;

  // 2. Metadata Info
  const cleanChannel = channel.replace(/^@/, '');
  const metaRows = [
    ['Kênh TikTok LIVE:', `@${cleanChannel}`, '', 'Bắt đầu điểm danh:', formatTime(startTime)],
    ['Tổng người tham gia:', `${userList.length} người`, '', 'Tiêu chí sắp xếp:', `Từ lớn đến bé theo ${sortCriterion}`],
    ['Tổng tương tác toàn phiên:', `Bình luận: ${totalComments} | Tim: ${totalLikes}`, '', 'Thời điểm xuất file:', formatTime(new Date())]
  ];

  metaRows.forEach((rowValues) => {
    const row = worksheet.addRow(rowValues);
    row.font = { name: 'Segoe UI', size: 10 };
    row.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF555555' } };
    row.getCell(4).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF555555' } };
    row.getCell(2).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF111827' } };
    row.getCell(5).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF111827' } };
  });

  // Empty spacer row
  worksheet.addRow([]);

  // 3. Table Header
  const headers = [
    { header: 'STT (Hạng)', key: 'stt', width: 12, align: 'center' },
    { header: 'Username (@ID)', key: 'uniqueId', width: 22, align: 'left' },
    { header: 'Tên hiển thị (Nickname)', key: 'nickname', width: 26, align: 'left' },
    { header: 'Số lần CMT', key: 'commentCount', width: 15, align: 'right' },
    { header: 'Số lượt TIM', key: 'likeCount', width: 15, align: 'right' },
    { header: 'Tổng tương tác', key: 'totalInteractions', width: 16, align: 'right' },
    { header: 'Tỷ lệ CMT', key: 'commentRatio', width: 14, align: 'center' },
    { header: 'Lần đầu tương tác', key: 'firstSeen', width: 20, align: 'center' },
    { header: 'Hoạt động cuối', key: 'lastActive', width: 20, align: 'center' },
    { header: 'Bình luận gần nhất', key: 'lastComment', width: 45, align: 'left' }
  ];

  const headerRow = worksheet.addRow(headers.map(h => h.header));
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: headerColor }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'medium', color: { argb: 'FF333333' } },
      right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
    };
  });

  const dataStartRowNumber = worksheet.rowCount + 1;
  const grandTotalComments = userList.reduce((acc, u) => acc + (u.commentCount || 0), 0) || totalComments || 1;

  // 4. Data Rows
  userList.forEach((user, index) => {
    const cmtCount = Number(user.commentCount || 0);
    const lkCount = Number(user.likeCount || 0);
    const totalInteractions = cmtCount + lkCount;
    const ratioPercent = grandTotalComments > 0 ? ((cmtCount / grandTotalComments) * 100).toFixed(1) + '%' : '0%';

    const row = worksheet.addRow([
      index + 1,
      `@${(user.uniqueId || '').replace(/^@/, '')}`,
      user.nickname || user.uniqueId || 'Ẩn danh',
      cmtCount,
      lkCount,
      totalInteractions,
      ratioPercent,
      formatTime(user.firstSeen),
      formatTime(user.lastActive),
      user.lastComment || ''
    ]);

    row.height = 24;
    const isEven = index % 2 === 0;

    row.eachCell((cell, colNumber) => {
      const colConfig = headers[colNumber - 1];
      cell.font = { name: 'Segoe UI', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colConfig ? colConfig.align : 'left',
        wrapText: colConfig ? colConfig.key === 'lastComment' : false
      };

      // In đậm cột số liệu quan trọng
      if (colConfig && ['commentCount', 'likeCount', 'totalInteractions'].includes(colConfig.key)) {
        cell.font = { name: 'Segoe UI', size: 10, bold: true };
      }

      // Nền xen kẽ (Zebra)
      let bgColor = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

      // Nổi bật Top 1, Top 2, Top 3
      if (index === 0 && colNumber === 1) {
        bgColor = 'FFFEF3C7'; // Vàng nhạt Top 1
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFB45309' } };
      } else if (index === 1 && colNumber === 1) {
        bgColor = 'FFF1F5F9'; // Bạc nhạt Top 2
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF475569' } };
      } else if (index === 2 && colNumber === 1) {
        bgColor = 'FFFFEDD5'; // Đồng nhạt Top 3
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFC2410C' } };
      }

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgColor }
      };

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
  });

  const dataEndRowNumber = worksheet.rowCount;

  // 5. Total Summary Row
  const sumComments = userList.reduce((sum, u) => sum + Number(u.commentCount || 0), 0);
  const sumLikes = userList.reduce((sum, u) => sum + Number(u.likeCount || 0), 0);
  const sumInteractions = sumComments + sumLikes;

  const summaryRow = worksheet.addRow([
    'TỔNG CỘNG',
    `Tổng: ${userList.length} người`,
    '',
    userList.length > 0 ? { formula: `SUM(D${dataStartRowNumber}:D${dataEndRowNumber})`, result: sumComments } : 0,
    userList.length > 0 ? { formula: `SUM(E${dataStartRowNumber}:E${dataEndRowNumber})`, result: sumLikes } : 0,
    userList.length > 0 ? { formula: `SUM(F${dataStartRowNumber}:F${dataEndRowNumber})`, result: sumInteractions } : 0,
    '100%',
    '',
    '',
    ''
  ]);

  summaryRow.height = 26;
  summaryRow.font = { name: 'Segoe UI', size: 10, bold: true };
  summaryRow.eachCell((cell, colNumber) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' }
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF64748B' } },
      bottom: { style: 'medium', color: { argb: 'FF64748B' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
    if ([4, 5, 6].includes(colNumber)) {
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (colNumber === 7) {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  });

  // Auto column widths
  headers.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return worksheet;
}

/**
 * Tạo file Excel báo cáo điểm danh TikTok Live với 3 tabs:
 * 1. Chi Tiết Điểm Danh (tất cả các dòng ghi nhận sự kiện)
 * 2. Tổng Hợp - Top Bình Luận (sắp xếp từ lớn đến bé theo cmt)
 * 3. Tổng Hợp - Top Thả Tim (sắp xếp từ lớn đến bé theo tim)
 * 
 * @param {Array} attendanceList - Danh sách các dòng điểm danh chi tiết
 * @param {Object} sessionInfo - Thông tin phiên live và cài đặt điểm danh
 * @param {Array} userSummaryList - Danh sách thống kê từng người dùng duy nhất
 * @returns {Promise<Buffer>}
 */
export async function generateExcelReport(attendanceList = [], sessionInfo = {}, userSummaryList = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TikTok Attendance System';
  workbook.lastModifiedBy = 'TikTok Attendance System';
  workbook.created = new Date();
  workbook.modified = new Date();

  const {
    channel = 'N/A',
    startTime = new Date(),
    modeText = 'Tất cả người tham gia',
    keyword = '',
    totalComments = 0,
    totalLikes = 0
  } = sessionInfo;

  // =========================================================================
  // TAB 1: DANH SÁCH ĐIỂM DANH (CHI TIẾT TỪNG LƯỢT CMT / CHECK-IN)
  // =========================================================================
  const detailSheet = workbook.addWorksheet('Danh Sách Điểm Danh', {
    views: [{ showGridLines: true }]
  });

  // Header Banner
  detailSheet.mergeCells('A1:J1');
  const titleCell = detailSheet.getCell('A1');
  titleCell.value = 'BÁO CÁO ĐIỂM DANH TIKTOK LIVE (CHI TIẾT)';
  titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E1E2F' } // Dark sleek TikTok theme
  };
  detailSheet.getRow(1).height = 36;

  // Metadata Info
  const cleanChannel = channel.replace(/^@/, '');
  const metaRows = [
    ['Kênh TikTok LIVE:', `@${cleanChannel}`, '', 'Bắt đầu điểm danh:', formatTime(startTime)],
    ['Tổng người tham gia:', sessionInfo?.stats?.totalAttendees ?? (userSummaryList.length || attendanceList.length), '', 'Tổng lượt ghi nhận:', `${attendanceList.length} dòng`],
    ['Chế độ điểm danh:', modeText + (keyword ? ` (Từ khóa: "${keyword}")` : ''), '', 'Tổng tương tác:', `Bình luận: ${totalComments} | Tim: ${totalLikes}`]
  ];

  metaRows.forEach((rowValues) => {
    const row = detailSheet.addRow(rowValues);
    row.font = { name: 'Segoe UI', size: 10 };
    row.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF555555' } };
    row.getCell(4).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF555555' } };
  });

  // Spacer row
  detailSheet.addRow([]);

  // Table Headers
  const detailHeaders = [
    { header: 'STT', key: 'stt', width: 8, align: 'center' },
    { header: 'Username (@ID)', key: 'uniqueId', width: 22, align: 'left' },
    { header: 'Tên hiển thị', key: 'nickname', width: 26, align: 'left' },
    { header: 'Thời gian', key: 'time', width: 20, align: 'center' },
    { header: 'Hình thức', key: 'checkinMethod', width: 22, align: 'center' },
    { header: 'Lần cmt', key: 'commentIndex', width: 12, align: 'center' },
    { header: 'Nội dung bình luận / Cú pháp', key: 'comment', width: 45, align: 'left' },
    { header: 'Tổng cmt (User)', key: 'commentCount', width: 16, align: 'right' },
    { header: 'Số tim (User)', key: 'likeCount', width: 14, align: 'right' }
  ];

  const detailHeaderRow = detailSheet.addRow(detailHeaders.map(h => h.header));
  detailHeaderRow.height = 28;

  detailHeaderRow.eachCell((cell) => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF6929C4' } // TikTok Purple
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'medium', color: { argb: 'FF333333' } },
      right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
    };
  });

  // Data Rows
  attendanceList.forEach((item, index) => {
    const commentText = item.comment || item.lastComment || '';
    const row = detailSheet.addRow([
      index + 1,
      `@${(item.uniqueId || '').replace(/^@/, '')}`,
      item.nickname || item.uniqueId,
      formatTime(item.time || item.firstSeen),
      item.checkinMethod || 'Bình luận',
      item.commentIndex ? `Lần ${item.commentIndex}` : '—',
      commentText,
      item.commentCount || 0,
      item.likeCount || 0
    ]);

    row.height = 24;
    const isEven = index % 2 === 0;

    row.eachCell((cell, colNumber) => {
      const colConfig = detailHeaders[colNumber - 1];
      cell.font = { name: 'Segoe UI', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colConfig ? colConfig.align : 'left',
        wrapText: colConfig ? colConfig.key === 'comment' : false
      };

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF7F8FA' }
      };

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE6E6E6' } },
        left: { style: 'thin', color: { argb: 'FFE6E6E6' } },
        bottom: { style: 'thin', color: { argb: 'FFE6E6E6' } },
        right: { style: 'thin', color: { argb: 'FFE6E6E6' } }
      };
    });
  });

  // Total Row
  const detailSummaryRow = detailSheet.addRow([
    'TỔNG',
    `Tổng dòng: ${attendanceList.length}`,
    '',
    '',
    '',
    '',
    '',
    totalComments,
    totalLikes
  ]);
  detailSummaryRow.height = 24;
  detailSummaryRow.font = { name: 'Segoe UI', size: 10, bold: true };
  detailSummaryRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8E8F0' }
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF888888' } },
      bottom: { style: 'medium', color: { argb: 'FF888888' } }
    };
  });

  detailHeaders.forEach((col, idx) => {
    detailSheet.getColumn(idx + 1).width = col.width;
  });

  // =========================================================================
  // CHUẨN BỊ DỮ LIỆU TỔNG HỢP CHO TỪNG NGƯỜI DÙNG DUY NHẤT
  // =========================================================================
  let summaryUsers = [];

  if (userSummaryList && userSummaryList.length > 0) {
    summaryUsers = userSummaryList.map(u => ({
      uniqueId: u.uniqueId || '',
      nickname: u.nickname || u.uniqueId || '',
      commentCount: Number(u.commentCount || 0),
      likeCount: Number(u.likeCount || 0),
      firstSeen: u.firstSeen,
      lastActive: u.lastActive || u.firstSeen,
      lastComment: u.lastComment || ''
    }));
  } else if (attendanceList && attendanceList.length > 0) {
    // Tự động gom nhóm từ attendanceList nếu userSummaryList chưa được truyền
    const userMap = new Map();
    attendanceList.forEach(item => {
      const uid = (item.uniqueId || item.nickname || 'unknown').replace(/^@/, '');
      if (!userMap.has(uid)) {
        userMap.set(uid, {
          uniqueId: uid,
          nickname: item.nickname || uid,
          commentCount: 0,
          likeCount: Number(item.likeCount || 0),
          firstSeen: item.time || item.firstSeen || new Date(),
          lastActive: item.time || item.lastActive || new Date(),
          lastComment: item.comment || item.lastComment || ''
        });
      }
      const existing = userMap.get(uid);
      if (item.comment) {
        existing.commentCount++;
        existing.lastComment = item.comment;
      }
      if (item.likeCount && Number(item.likeCount) > existing.likeCount) {
        existing.likeCount = Number(item.likeCount);
      }
      if (item.time) {
        if (!existing.firstSeen || new Date(item.time) < new Date(existing.firstSeen)) {
          existing.firstSeen = item.time;
        }
        if (!existing.lastActive || new Date(item.time) > new Date(existing.lastActive)) {
          existing.lastActive = item.time;
        }
      }
    });
    summaryUsers = Array.from(userMap.values());
  }

  // =========================================================================
  // TAB 2: TỔNG HỢP - TOP BÌNH LUẬN (SẮP XẾP TỪ LỚN ĐẾN BÉ THEO CMT)
  // =========================================================================
  const commentSortedUsers = [...summaryUsers].sort((a, b) => {
    // 1. Số lần cmt giảm dần (lớn đến bé)
    if (b.commentCount !== a.commentCount) {
      return b.commentCount - a.commentCount;
    }
    // 2. Nếu bằng cmt, xếp theo số tim giảm dần
    if (b.likeCount !== a.likeCount) {
      return b.likeCount - a.likeCount;
    }
    // 3. Xếp theo thứ tự xuất hiện trước
    return new Date(a.firstSeen || 0) - new Date(b.firstSeen || 0);
  });

  createSummaryWorksheet(workbook, {
    sheetName: 'Tổng Hợp - Top Bình Luận',
    bannerTitle: 'BẢNG TỔNG HỢP TƯƠNG TÁC - XẾP HẠNG BÌNH LUẬN (TOP CMT)',
    bannerColor: 'FF0F172A', // Dark Slate
    headerColor: 'FF0E7490', // Cyan / Teal hiện đại
    userList: commentSortedUsers,
    sessionInfo,
    sortCriterion: 'Số lần bình luận (CMT) giảm dần'
  });

  // =========================================================================
  // TAB 3: TỔNG HỢP - TOP THẢ TIM (SẮP XẾP TỪ LỚN ĐẾN BÉ THEO TIM)
  // =========================================================================
  const likeSortedUsers = [...summaryUsers].sort((a, b) => {
    // 1. Số lượt tim giảm dần (lớn đến bé)
    if (b.likeCount !== a.likeCount) {
      return b.likeCount - a.likeCount;
    }
    // 2. Nếu bằng tim, xếp theo số cmt giảm dần
    if (b.commentCount !== a.commentCount) {
      return b.commentCount - a.commentCount;
    }
    // 3. Xếp theo thứ tự xuất hiện trước
    return new Date(a.firstSeen || 0) - new Date(b.firstSeen || 0);
  });

  createSummaryWorksheet(workbook, {
    sheetName: 'Tổng Hợp - Top Thả Tim',
    bannerTitle: 'BẢNG TỔNG HỢP TƯƠNG TÁC - XẾP HẠNG THẢ TIM (TOP TIM)',
    bannerColor: 'FF1E1B4B', // Dark Indigo
    headerColor: 'FFE11D48', // TikTok Rose/Red Heart
    userList: likeSortedUsers,
    sessionInfo,
    sortCriterion: 'Số lượt thả tim (TIM) giảm dần'
  });

  return await workbook.xlsx.writeBuffer();
}
