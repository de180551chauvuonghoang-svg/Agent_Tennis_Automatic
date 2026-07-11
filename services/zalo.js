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
 * Tạo link Zalo mở trò chuyện trực tiếp
 * @param {string} phone Số điện thoại khách
 * @returns {string} Link Zalo deep link
 */
function getZaloLink(phone) {
  let cleanPhone = phone.replace(/\D/g, '');
  // Zalo thường dùng số điện thoại dạng 09xxxxxx hoặc 849xxxxxx
  if (cleanPhone.startsWith('84')) {
    cleanPhone = '0' + cleanPhone.substring(2);
  }
  return `https://zalo.me/${cleanPhone}`;
}

/**
 * Gửi tin nhắn Zalo thông qua Zalo OA (Official Account) API
 * @param {string} to Số điện thoại nhận tin
 * @param {string} text Nội dung tin nhắn
 * @param {string} mediaUrl Đường dẫn ảnh (báo giá) nếu có
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendZaloMessage(to, text, mediaUrl = null) {
  const config = getConfig();
  const creds = config.zalo_credentials || {};
  const accessToken = creds.access_token || process.env.ZALO_ACCESS_TOKEN;
  
  let cleanTo = to.replace(/\D/g, '');
  if (cleanTo.startsWith('0')) {
    cleanTo = '84' + cleanTo.substring(1);
  }

  // Nếu chưa cấu hình Zalo OA Access Token, chạy chế độ mô phỏng (Simulation Mode)
  if (!accessToken) {
    console.log(`[MÔ PHỎNG ZALO] Gửi tin đến ${cleanTo}: "${text}" ${mediaUrl ? `[Kèm ảnh: ${mediaUrl}]` : ''}`);
    return { success: true, simulated: true };
  }

  try {
    // 1. Tìm User ID bằng số điện thoại (Yêu cầu Zalo OA có quyền lấy User ID từ SĐT)
    // API Zalo: POST https://openapi.zalo.me/v2.0/oa/getprofile
    // Ở đây ta giả lập cấu trúc gửi tin nhắn trực tiếp bằng API v3.0 nếu đã có User ID hoặc dùng sđt
    let userId = cleanTo; // Giả sử user_id trùng SĐT hoặc đã được định danh trước đó

    // Cấu trúc API gửi tin nhắn văn bản của Zalo OA
    const body = {
      recipient: {
        user_id: userId
      },
      message: {
        text: text
      }
    };

    // Nếu gửi hình ảnh banner báo giá
    if (mediaUrl) {
      body.message = {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'media',
            elements: [{
              media_type: 'image',
              url: mediaUrl,
              title: 'Báo Giá Khóa Học Tennis',
              subtitle: text
            }]
          }
        }
      };
    }

    const response = await fetch('https://openapi.zalo.me/v3.0/oa/message/transaction', {
      method: 'POST',
      headers: {
        'access_token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error === 0) {
      console.log('Đã gửi tin Zalo OA thành công:', data.data.message_id);
      return { success: true, messageId: data.data.message_id };
    } else {
      console.error('Lỗi từ Zalo OA API:', data.message);
      return { success: false, error: data.message };
    }
  } catch (error) {
    console.error('Lỗi khi gửi tin Zalo:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getZaloLink,
  sendZaloMessage
};
