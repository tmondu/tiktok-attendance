import ExcelJS from 'exceljs';

/**
 * Tạo file Excel báo cáo điểm danh TikTok Live
 * @param {Array} attendanceList - Danh sách người tham gia
 * @param {Object} sessionInfo - Thông tin phiên live và cài đặt điểm danh
 * @returns {Promise<Buffer>}
 */
export async function generateExcelReport(attendanceList, sessionInfo = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TikTok Attendance System';
  workbook.lastModifiedBy = 'TikTok Attendance System';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Danh Sách Điểm Danh', {
    views: [{ showGridLines: true }]
  });

  const {
    channel = 'N/A',
    startTime = new Date(),
    endTime = new Date(),
    modeText = 'Tất cả người tham gia',
    keyword = '',
    totalComments = 0,
    totalLikes = 0
  } = sessionInfo;

  // 1. Header Banner
  worksheet.mergeCells('A1:J1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'BÁO CÁO ĐIỂM DANH TIKTOK LIVE';
  titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E1E2F' } // Dark sleek TikTok theme
  };
  worksheet.getRow(1).height = 36;

  // 2. Metadata Info
  const formatTime = (d) => {
    if (!d) return 'N/A';
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const metaRows = [
    ['Kênh TikTok LIVE:', `@${channel.replace('@', '')}`, '', 'Bắt đầu điểm danh:', formatTime(startTime)],
    ['Tổng người tham gia:', sessionInfo?.stats?.totalAttendees ?? attendanceList.length, '', 'Tổng lượt ghi nhận:', `${attendanceList.length} dòng`],
    ['Chế độ điểm danh:', modeText + (keyword ? ` (Từ khóa: "${keyword}")` : ''), '', 'Tổng tương tác:', `Bình luận: ${totalComments} | Tim: ${totalLikes}`]
  ];

  metaRows.forEach((rowValues) => {
    const row = worksheet.addRow(rowValues);
    row.font = { name: 'Segoe UI', size: 10 };
    row.getCell(1).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF555555' } };
    row.getCell(4).font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF555555' } };
  });

  // Empty spacer row
  worksheet.addRow([]);

  // 3. Table Header
  const headers = [
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

  const headerRow = worksheet.addRow(headers.map(h => h.header));
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF6929C4' } // TikTok Purple / Modern indigo
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
      bottom: { style: 'medium', color: { argb: 'FF333333' } },
      right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
    };
  });

  // 4. Populate Data Rows
  attendanceList.forEach((item, index) => {
    const commentText = item.comment || item.lastComment || '';
    const row = worksheet.addRow([
      index + 1,
      `@${item.uniqueId}`,
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
      const colConfig = headers[colNumber - 1];
      cell.font = { name: 'Segoe UI', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colConfig ? colConfig.align : 'left',
        wrapText: colConfig ? colConfig.key === 'comment' : false
      };

      // Zebra background
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

  // 5. Total Summary Row
  const summaryRow = worksheet.addRow([
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
  summaryRow.height = 24;
  summaryRow.font = { name: 'Segoe UI', size: 10, bold: true };
  summaryRow.eachCell((cell) => {
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

  // Auto column widths
  headers.forEach((col, idx) => {
    worksheet.getColumn(idx + 1).width = col.width;
  });

  return await workbook.xlsx.writeBuffer();
}
