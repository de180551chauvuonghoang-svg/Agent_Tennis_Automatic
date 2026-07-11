const fs = require('fs');
const path = require('path');

function getConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

/**
 * Tạo link WhatsApp trực tiếp kèm tin nhắn soạn sẵn
 * @param {string} phone Số điện thoại khách
 * @param {string} text Nội dung tin nhắn
 * @returns {string} Link WhatsApp deep link
 */
function getWhatsAppLink(phone, text) {
  // Chuẩn hóa số điện thoại sang mã quốc gia (bỏ số 0 đầu, thêm mã quốc gia nếu chưa có)
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '84' + cleanPhone.substring(1);
  }
  const encodedText = encodeURIComponent(text);
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}

/**
 * Gửi tin nhắn WhatsApp
 * @param {string} to Số điện thoại nhận tin
 * @param {string} text Nội dung tin nhắn
 * @param {string} mediaUrl Đường dẫn ảnh đính kèm (nếu có, dùng để gửi banner báo giá)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendWhatsAppMessage(to, text, mediaUrl = null) {
  const config = getConfig();
  const creds = config.whatsapp_credentials || {};
  const accountSid = creds.account_sid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = creds.auth_token || process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = creds.from_number || process.env.TWILIO_FROM_NUMBER || 'whatsapp:+14155238886'; // Số Twilio Sandbox mặc định

  // Chuẩn hóa định dạng số nhận tin nhắn cho Twilio (cần có prefix whatsapp:)
  let cleanTo = to.replace(/\D/g, '');
  if (cleanTo.startsWith('0')) {
    cleanTo = '84' + cleanTo.substring(1);
  }
  if (!cleanTo.startsWith('+')) {
    cleanTo = '+' + cleanTo;
  }
  const formattedTo = `whatsapp:${cleanTo}`;

  // Nếu không cấu hình Twilio, chạy chế độ mô phỏng (Simulation Mode)
  if (!accountSid || !authToken) {
    console.log(`[MÔ PHỎNG WHATSAPP] Gửi tin đến ${formattedTo}: "${text}" ${mediaUrl ? `[Kèm ảnh: ${mediaUrl}]` : ''}`);
    return { success: true, simulated: true };
  }

  try {
    // Gọi Twilio API bằng fetch thủ công để tránh thêm thư viện twilio cồng kềnh
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams();
    params.append('To', formattedTo);
    params.append('From', fromNumber);
    params.append('Body', text);
    if (mediaUrl) {
      // Đối với Twilio, mediaUrl phải là URL public. Nếu chạy localhost, HLV có thể dùng link tạm hoặc chúng tôi giả lập
      params.append('MediaUrl', mediaUrl);
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const data = await response.json();
    if (response.ok) {
      console.log('Đã gửi tin WhatsApp qua Twilio:', data.sid);
      return { success: true, messageId: data.sid };
    } else {
      console.error('Lỗi phản hồi từ Twilio API:', data.message);
      return { success: false, error: data.message };
    }
  } catch (error) {
    console.error('Lỗi khi gửi WhatsApp qua Twilio:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getWhatsAppLink,
  sendWhatsAppMessage
};
