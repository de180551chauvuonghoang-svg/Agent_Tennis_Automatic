const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function getConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

// Lấy JWT Client cho Google APIs từ credentials
function getGoogleAuth(config) {
  const creds = config.google_credentials || {};
  if (!creds.client_email || !creds.private_key) {
    return null;
  }

  // Thay thế các ký tự xuống dòng trong private key nếu cần
  const privateKey = creds.private_key.replace(/\\n/g, '\n');

  return new google.auth.JWT(
    creds.client_email,
    null,
    privateKey,
    [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  );
}

/**
 * Tạo sự kiện lịch trên Google Calendar
 * @param {Object} booking { clientName, phone, date, time, durationMinutes, notes }
 * @returns {Promise<{success: boolean, eventLink?: string, error?: string}>}
 */
async function createCalendarEvent(booking) {
  const config = getConfig();
  const auth = getGoogleAuth(config);
  const calendarId = config.google_calendar_id || 'primary';

  // Định dạng thời gian
  // booking.date: "YYYY-MM-DD"
  // booking.time: "HH:mm"
  const startDateTime = new Date(`${booking.date}T${booking.time}:00+07:00`);
  const endDateTime = new Date(startDateTime.getTime() + booking.durationMinutes * 60 * 1000);

  const event = {
    summary: `Học Tennis - ${booking.clientName}`,
    description: `Khách hàng: ${booking.clientName}\nSố điện thoại: ${booking.phone}\nGhi chú: ${booking.notes || 'Không có'}`,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 120 }, // Nhắc trước 2 tiếng
        { method: 'popup', minutes: 1440 }, // Nhắc trước 1 ngày
      ],
    },
  };

  // Chế độ mô phỏng
  if (!auth) {
    console.log('[MÔ PHỎNG CALENDAR] Tạo sự kiện thành công:', event);
    return { success: true, simulated: true };
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const response = await calendar.events.insert({
      calendarId: calendarId,
      resource: event,
    });

    console.log('Đã tạo sự kiện Google Calendar:', response.data.htmlLink);
    return { success: true, eventLink: response.data.htmlLink };
  } catch (error) {
    console.error('Lỗi khi tạo sự kiện Google Calendar:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Đồng bộ dữ liệu khách hàng vào Google Sheets CRM
 * @param {Object} lead { name, phone, platform, notes, bookingDate, bookingTime }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function syncToCRM(lead) {
  const config = getConfig();
  const auth = getGoogleAuth(config);
  const spreadsheetId = config.google_sheets_id;

  if (!spreadsheetId) {
    console.log('[MÔ PHỎNG CRM Sheets] Lưu thông tin khách hàng thành công:', lead);
    return { success: true, simulated: true };
  }

  if (!auth) {
    console.log('[MÔ PHỎNG CRM Sheets] Lưu thông tin khách hàng thành công (chưa có credentials):', lead);
    return { success: true, simulated: true };
  }

  try {
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Đọc dòng đầu tiên để check tiêu đề cột hoặc thêm trực tiếp
    const values = [
      [
        lead.name || 'Khách hàng ẩn danh',
        lead.phone,
        lead.platform || 'Zalo',
        lead.notes || '',
        lead.bookingDate ? `${lead.bookingDate} ${lead.bookingTime}` : 'Chưa đặt lịch',
        new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        'Đã chốt lịch'
      ]
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:G',
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    console.log('Đã lưu thông tin khách hàng vào Google Sheets CRM thành công.');
    return { success: true };
  } catch (error) {
    console.error('Lỗi khi lưu thông tin vào Google Sheets CRM:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createCalendarEvent,
  syncToCRM,
};
