const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const geminiService = require('./services/gemini');
const zaloService = require('./services/zalo');
const whatsappService = require('./services/whatsapp');
const googleService = require('./services/google');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Cấu hình Multer để upload ảnh
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage: storage });

// Helper đọc/ghi Database JSON
const dbPath = path.join(__dirname, 'database.json');
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (error) {
    return { leads: [] };
  }
}
function writeDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

// Helper đọc/ghi Config JSON
const configPath = path.join(__dirname, 'config.json');
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {};
  }
}
function writeConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

// Chuẩn hóa số điện thoại và phát hiện quốc gia
function normalizePhoneNumber(phoneStr) {
  if (!phoneStr) return { phone: '', platform: 'Zalo' };

  // Giữ dấu + nếu có, sau đó chỉ loại ký tự phi số trong phần còn lại
  const hasPlus = phoneStr.trim().startsWith('+');
  let clean = phoneStr.replace(/\D/g, ''); // chỉ giữ chữ số

  // Việt Nam: bắt đầu bằng 84 (11 số) hoặc 0 (10 số)
  const isVietnam =
    (!hasPlus && clean.startsWith('0') && clean.length === 10) ||
    (clean.startsWith('84') && clean.length === 11);

  if (isVietnam) {
    if (clean.startsWith('84')) clean = '0' + clean.substring(2);
    return { phone: clean, platform: 'Zalo' };
  }

  // Số quốc tế: giữ dấu +
  return { phone: '+' + clean, platform: 'WhatsApp' };
}

// ==================== CÁC API ENDPOINTS ====================

// 1. Quản lý cấu hình
app.get('/api/config', (req, res) => {
  res.json(readConfig());
});

app.post('/api/config', (req, res) => {
  const config = readConfig();
  const updated = { ...config, ...req.body };
  writeConfig(updated);
  res.json({ success: true, config: updated });
});

// Upload banner báo giá (tiếng Anh / quốc tế)
app.post('/api/config/upload-banner', upload.single('banner'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không tìm thấy file tải lên' });
  }
  const bannerUrl = `/uploads/${req.file.filename}`;
  const config = readConfig();
  config.price_banner_path = bannerUrl;
  writeConfig(config);
  res.json({ success: true, bannerUrl });
});

// Upload banner báo giá (tiếng Việt)
app.post('/api/config/upload-banner-vi', upload.single('banner'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không tìm thấy file tải lên' });
  }
  const bannerUrl = `/uploads/${req.file.filename}`;
  const config = readConfig();
  config.price_banner_path_vi = bannerUrl;
  writeConfig(config);
  res.json({ success: true, bannerUrl });
});

// 2. Quản lý Khách hàng (Leads)
app.get('/api/leads', (req, res) => {
  const db = readDB();
  res.json(db.leads);
});

// Upload ảnh chụp màn hình để OCR khách hàng mới
app.post('/api/leads/upload', upload.single('screenshot'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không tìm thấy file ảnh chụp màn hình' });
  }

  const filePath = req.file.path;
  const mimeType = req.file.mimetype;

  try {
    // Chạy OCR qua Gemini
    const ocrData = await geminiService.performOCR(filePath, mimeType);

    // Xử lý cả 2 format: mới (countryCode + phoneBody) và cũ (phone)
    let rawPhone;
    if (ocrData.countryCode && ocrData.phoneBody) {
      // Format mới: ghép countryCode + phoneBody
      const cc = ocrData.countryCode.trim(); // ví dụ: '+86'
      const pb = ocrData.phoneBody.replace(/\s/g, ''); // ví dụ: '13824301352'
      rawPhone = cc + pb; // '+8613824301352'
    } else {
      rawPhone = ocrData.phone || '';
    }

    // Chuẩn hóa SĐT và chọn nền tảng
    const { phone, platform } = normalizePhoneNumber(rawPhone);

    // Gửi lại countryCode + phoneBody đã chuẩn hóa về FE để hiển thị riêng lẻ
    let finalCountryCode = ocrData.countryCode || '';
    let finalPhoneBody = ocrData.phoneBody || '';
    if (!finalCountryCode) {
      const clean = phone.replace(/[\s\-\.]/g, '');
      if (clean.startsWith('+')) {
        const m = clean.match(/^(\+\d{1,3})(\d+)$/);
        if (m) { finalCountryCode = m[1]; finalPhoneBody = m[2]; }
      } else if (clean.startsWith('0')) {
        finalCountryCode = '+84'; finalPhoneBody = clean.slice(1);
      } else {
        finalCountryCode = '+84'; finalPhoneBody = clean;
      }
    }

    const newLead = {
      id: 'lead_' + Date.now(),
      phone: phone || rawPhone,
      countryCode: finalCountryCode,
      phoneBody: finalPhoneBody,
      name: ocrData.name,
      notes: ocrData.notes,
      platform: platform,
      screenshotPath: `/uploads/${req.file.filename}`,
      status: 'New',
      messages: [],
      createdAt: new Date().toISOString()
    };

    // Kiểm tra xem số điện thoại đã tồn tại chưa
    const db = readDB();
    const existing = db.leads.find(l => l.phone === newLead.phone && newLead.phone !== '');
    if (existing) {
      return res.json({
        success: true,
        isDuplicate: true,
        existingLead: existing,
        ocrData: newLead
      });
    }

    res.json({ success: true, lead: newLead });
  } catch (error) {
    console.error('Lỗi khi chạy OCR:', error);
    res.status(500).json({ error: 'Không thể xử lý ảnh bằng OCR. Hãy thử điền tay thông tin.' });
  }
});

// Lưu khách hàng mới vào Database
app.post('/api/leads', (req, res) => {
  const db = readDB();
  const leadData = req.body;
  
  if (!leadData.phone) {
    return res.status(400).json({ error: 'Số điện thoại là bắt buộc' });
  }

  // Check trùng sđt lần nữa
  const existing = db.leads.find(l => l.phone === leadData.phone);
  if (existing) {
    return res.status(400).json({ error: 'Số điện thoại đã tồn tại trong hệ thống' });
  }

  const newLead = {
    ...leadData,
    id: leadData.id || 'lead_' + Date.now(),
    status: 'New',
    messages: leadData.messages || [],
    createdAt: leadData.createdAt || new Date().toISOString()
  };

  db.leads.unshift(newLead);
  writeDB(db);
  res.json({ success: true, lead: newLead });
});

// Xóa khách hàng
app.delete('/api/leads/:id', (req, res) => {
  const db = readDB();
  const initialLength = db.leads.length;
  db.leads = db.leads.filter(l => l.id !== req.params.id);
  
  if (db.leads.length === initialLength) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }
  
  writeDB(db);
  res.json({ success: true });
});

// 3. Quản lý hội thoại và AI Chatbot

// Gửi tin nhắn chào mừng & bắt đầu chat
app.post('/api/leads/start-chat', async (req, res) => {
  const { id, language } = req.body;
  const db = readDB();
  const leadIndex = db.leads.findIndex(l => l.id === id);

  if (leadIndex === -1) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

  const lead = db.leads[leadIndex];
  const config = readConfig();

  // Tạo nội dung tin nhắn chào theo template ngôn ngữ
  const effectiveLang = language || lead.language || 'vi';
  let greetingTemplate;
  if (effectiveLang === 'vi') {
    greetingTemplate = config.greeting_template || '';
  } else {
    // Tiếng Anh hoặc ngôn ngữ quốc tế khác
    greetingTemplate = config.greeting_template_en || '';
    // Nếu chưa cấu hình template tiếng Anh, tự sinh greeting tiếng Anh mặc định
    if (!greetingTemplate) {
      greetingTemplate = `Hello {{name}}, I am the AI Assistant of Coach {{coach_name}}. Our partner has shared your contact information with us. Could you let us know what level of tennis you are interested in (beginner or advanced), and which area you would prefer for training?`;
    }
  }
  const clientName = lead.name || 'there';
  let greeting = greetingTemplate
    .replace(/{{name}}/g, clientName)
    .replace(/{{coach_name}}/g, config.coach_name || '');

  // 1. Lưu tin nhắn vào lịch sử
  const greetingMsg = {
    id: 'msg_' + Date.now(),
    sender: 'model',
    content: greeting,
    timestamp: new Date().toISOString()
  };
  // Lưu ngôn ngữ vào lead (dùng cho chatbot sau này)
  if (language) lead.language = language;
  lead.messages.push(greetingMsg);
  lead.status = 'Chatting';

  db.leads[leadIndex] = lead;
  writeDB(db);

  // 2. Gửi tin nhắn thật thông qua API (hoặc giả lập)
  let link = '';
  let sendResult = { success: true };
  if (lead.platform === 'Zalo') {
    link = zaloService.getZaloLink(lead.phone);
    sendResult = await zaloService.sendZaloMessage(lead.phone, greeting);
  } else {
    link = whatsappService.getWhatsAppLink(lead.phone, greeting);
    sendResult = await whatsappService.sendWhatsAppMessage(lead.phone, greeting);
  }

  res.json({ 
    success: true, 
    lead, 
    chatLink: link,
    apiSent: !sendResult.simulated,
    apiError: sendResult.error || null
  });
});

// Nhận tin nhắn thủ công từ HLV gửi đi từ Dashboard
app.post('/api/chat/send-manual', async (req, res) => {
  const { leadId, content } = req.body;
  const db = readDB();
  const leadIndex = db.leads.findIndex(l => l.id === leadId);

  if (leadIndex === -1) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

  const lead = db.leads[leadIndex];
  const manualMsg = {
    id: 'msg_' + Date.now(),
    sender: 'model',
    content: content,
    timestamp: new Date().toISOString()
  };

  lead.messages.push(manualMsg);
  db.leads[leadIndex] = lead;
  writeDB(db);

  // Gửi tin nhắn đi qua API nếu có kết nối
  if (lead.platform === 'Zalo') {
    await zaloService.sendZaloMessage(lead.phone, content);
  } else {
    await whatsappService.sendWhatsAppMessage(lead.phone, content);
  }

  res.json({ success: true, messages: lead.messages });
});

// Mô phỏng tin nhắn từ khách gửi đến (dùng để Test hệ thống)
app.post('/api/chat/simulate-message', async (req, res) => {
  const { leadId, content } = req.body;
  const db = readDB();
  const leadIndex = db.leads.findIndex(l => l.id === leadId);

  if (leadIndex === -1) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

  const lead = db.leads[leadIndex];
  
  // 1. Thêm tin nhắn của Khách (user)
  const userMsg = {
    id: 'msg_user_' + Date.now(),
    sender: 'user',
    content: content,
    timestamp: new Date().toISOString()
  };

  // Dịch tin nhắn nếu ngôn ngữ của khách không phải tiếng Việt
  if (lead.language && lead.language !== 'vi') {
    try {
      const translation = await geminiService.translateToVietnamese(content);
      if (translation) {
        userMsg.translation = translation;
      }
    } catch (e) {
      console.error('Lỗi khi dịch tin nhắn mô phỏng:', e);
    }
  }
  lead.messages.push(userMsg);

  // Nếu trạng thái không phải Chatting, AI không tự trả lời (hoặc đang chờ HLV chốt lịch)
  if (lead.status !== 'Chatting') {
    db.leads[leadIndex] = lead;
    writeDB(db);
    return res.json({ success: true, lead, replySimulated: false });
  }

  try {
    // Định dạng lịch sử trò chuyện cho Gemini: [{role: 'user'|'model', content: '...'}]
    const chatHistory = lead.messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'model',
      content: m.content
    }));

    // 2. Chạy Chatbot AI Gemini (truyền ngôn ngữ của lead)
    const aiResponse = await geminiService.runChatbot(chatHistory, lead.language || 'vi');

    // 3. Thêm tin nhắn trả lời của AI (model)
    const aiMsg = {
      id: 'msg_model_' + Date.now(),
      sender: 'model',
      content: aiResponse.reply,
      timestamp: new Date().toISOString()
    };
    lead.messages.push(aiMsg);

    // 4. Nếu AI yêu cầu gửi banner báo giá
    let bannerSent = false;
    if (aiResponse.send_price_banner) {
      const config = readConfig();
      const leadLang = lead.language || 'vi';
      // Chọn banner theo ngôn ngữ: VI → banner tiếng Việt, EN/khác → banner quốc tế
      const bannerPath = leadLang === 'vi'
        ? (config.price_banner_path_vi || config.price_banner_path || '/uploads/pricing_banner.png')
        : (config.price_banner_path || '/uploads/pricing_banner.png');

      const bannerMsg = {
        id: 'msg_banner_' + Date.now(),
        sender: 'model',
        content: '[Hệ thống gửi Banner Báo Giá]',
        mediaUrl: bannerPath,
        timestamp: new Date().toISOString()
      };
      lead.messages.push(bannerMsg);
      bannerSent = true;

      // Gửi banner qua API nếu được thiết lập
      const fullBannerUrl = req.protocol + '://' + req.get('host') + bannerPath;
      if (lead.platform === 'Zalo') {
        await zaloService.sendZaloMessage(lead.phone, "Ảnh báo giá đính kèm", fullBannerUrl);
      } else {
        await whatsappService.sendWhatsAppMessage(lead.phone, "Ảnh báo giá đính kèm", fullBannerUrl);
      }
    }

    // 5. Nếu AI phát hiện mong muốn đặt lịch học
    if (aiResponse.trigger_coach_booking) {
      lead.status = 'Awaiting Booking';
    }

    db.leads[leadIndex] = lead;
    writeDB(db);

    // Gửi phản hồi chính của AI qua API thực tế nếu có cấu hình
    if (lead.platform === 'Zalo') {
      await zaloService.sendZaloMessage(lead.phone, aiResponse.reply);
    } else {
      await whatsappService.sendWhatsAppMessage(lead.phone, aiResponse.reply);
    }

    res.json({ 
      success: true, 
      lead, 
      replySimulated: true, 
      aiResponse,
      bannerSent
    });
  } catch (error) {
    console.error('Lỗi khi chạy chatbot trả lời tự động:', error);
    res.status(500).json({ error: 'Gemini Chatbot gặp lỗi. Xem log server.' });
  }
});

// 4. Xác nhận chốt lịch & đồng bộ Calendar / CRM
app.post('/api/leads/confirm-booking', async (req, res) => {
  const { leadId, date, time, durationMinutes, notes } = req.body;
  const db = readDB();
  const leadIndex = db.leads.findIndex(l => l.id === leadId);

  if (leadIndex === -1) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

  const lead = db.leads[leadIndex];
  
  try {
    // 1. Tạo sự kiện Google Calendar
    const calendarResult = await googleService.createCalendarEvent({
      clientName: lead.name || 'Khách hàng',
      phone: lead.phone,
      date,
      time,
      durationMinutes: parseInt(durationMinutes) || 120,
      notes
    });

    // 2. Lưu thông tin CRM (Google Sheets)
    const crmResult = await googleService.syncToCRM({
      name: lead.name,
      phone: lead.phone,
      platform: lead.platform,
      notes: notes || lead.notes,
      bookingDate: date,
      bookingTime: time
    });

    // 3. Cập nhật trạng thái khách hàng thành Booked
    lead.status = 'Booked';
    lead.bookingDetails = {
      date,
      time,
      durationMinutes,
      notes,
      calendarLink: calendarResult.eventLink || null,
      syncedCRM: crmResult.success && !crmResult.simulated
    };

    // Thêm tin nhắn hệ thống thông báo chốt lịch thành công
    lead.messages.push({
      id: 'msg_sys_' + Date.now(),
      sender: 'system',
      content: `Lịch học đã được chốt: ngày ${date} lúc ${time} (${durationMinutes} phút). Đã đồng bộ Google Calendar & CRM.`,
      timestamp: new Date().toISOString()
    });

    db.leads[leadIndex] = lead;
    writeDB(db);

    res.json({ 
      success: true, 
      lead,
      calendarSynced: !calendarResult.simulated,
      crmSynced: !crmResult.simulated
    });
  } catch (error) {
    console.error('Lỗi khi chốt lịch và đồng bộ:', error);
    res.status(500).json({ error: 'Gặp lỗi trong quá trình đồng bộ Google Services.' });
  }
});

// Webhook tiếp nhận tin nhắn từ WhatsApp Twilio
app.post('/api/webhooks/whatsapp', async (req, res) => {
  const twilioFrom = req.body.From; // ví dụ: "whatsapp:+8613824301352"
  const content = req.body.Body;     // ví dụ: "Hello, what are the fees?"
  
  if (!twilioFrom || !content) {
    return res.status(400).send('Invalid request');
  }

  // Loại bỏ tiền tố "whatsapp:" nếu có
  const rawPhone = twilioFrom.replace('whatsapp:', '');
  const { phone } = normalizePhoneNumber(rawPhone);

  const db = readDB();
  let leadIndex = db.leads.findIndex(l => l.phone === phone);
  let lead;

  if (leadIndex === -1) {
    // Tạo lead mới tự động nếu chưa có
    const id = 'lead_' + Date.now();
    
    // Tách mã quốc gia và phần thân số điện thoại
    let finalCountryCode = '';
    let finalPhoneBody = '';
    const clean = phone.replace(/[\s\-\.]/g, '');
    if (clean.startsWith('+')) {
      const m = clean.match(/^(\+\d{1,3})(\d+)$/);
      if (m) { finalCountryCode = m[1]; finalPhoneBody = m[2]; }
    } else if (clean.startsWith('0')) {
      finalCountryCode = '+84'; finalPhoneBody = clean.slice(1);
    } else {
      finalCountryCode = '+84'; finalPhoneBody = clean;
    }

    lead = {
      id,
      phone,
      countryCode: finalCountryCode,
      phoneBody: finalPhoneBody,
      name: 'Khách hàng WhatsApp',
      notes: 'Tự động tạo từ tin nhắn WhatsApp mới',
      platform: 'WhatsApp',
      screenshotPath: '',
      status: 'Chatting', // mặc định cho AI tự trả lời luôn
      language: 'en', // default to English for new WhatsApp international leads
      messages: [],
      createdAt: new Date().toISOString()
    };
    db.leads.push(lead);
    leadIndex = db.leads.length - 1;
  } else {
    lead = db.leads[leadIndex];
  }

  // 1. Thêm tin nhắn của Khách (user)
  const userMsg = {
    id: 'msg_user_' + Date.now(),
    sender: 'user',
    content: content,
    timestamp: new Date().toISOString()
  };

  // Dịch từ tiếng Anh sang tiếng Việt nếu lead dùng tiếng Anh/quốc tế
  if (lead.language && lead.language !== 'vi') {
    try {
      const translation = await geminiService.translateToVietnamese(content);
      if (translation) {
        userMsg.translation = translation;
      }
    } catch (e) {
      console.error('Lỗi khi dịch webhook WhatsApp:', e);
    }
  }
  lead.messages.push(userMsg);

  // Nếu đang bật tự động trả lời bằng AI (Chatting)
  if (lead.status === 'Chatting') {
    try {
      // Định dạng lịch sử trò chuyện
      const chatHistory = lead.messages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        content: m.content
      }));

      // Chạy Chatbot AI
      const aiResponse = await geminiService.runChatbot(chatHistory, lead.language || 'vi');

      // Thêm phản hồi của AI
      const aiMsg = {
        id: 'msg_model_' + Date.now(),
        sender: 'model',
        content: aiResponse.reply,
        timestamp: new Date().toISOString()
      };
      lead.messages.push(aiMsg);

      // Gửi banner báo giá nếu cần
      if (aiResponse.send_price_banner) {
        const config = readConfig();
        const leadLang = lead.language || 'vi';
        const bannerPath = leadLang === 'vi'
          ? (config.price_banner_path_vi || config.price_banner_path || '/uploads/pricing_banner.png')
          : (config.price_banner_path || '/uploads/pricing_banner.png');

        const bannerMsg = {
          id: 'msg_banner_' + Date.now(),
          sender: 'model',
          content: '[Hệ thống gửi Banner Báo Giá]',
          mediaUrl: bannerPath,
          timestamp: new Date().toISOString()
        };
        lead.messages.push(bannerMsg);

        // Gửi qua Twilio
        const fullBannerUrl = req.protocol + '://' + req.get('host') + bannerPath;
        await whatsappService.sendWhatsAppMessage(lead.phone, "Ảnh báo giá đính kèm", fullBannerUrl);
      }

      // Đổi trạng thái nếu đặt lịch
      if (aiResponse.trigger_coach_booking) {
        lead.status = 'Awaiting Booking';
      }

      // Gửi câu trả lời của AI đến khách qua Twilio
      await whatsappService.sendWhatsAppMessage(lead.phone, aiResponse.reply);

    } catch (error) {
      console.error('Lỗi tự động trả lời webhook:', error);
    }
  }

  db.leads[leadIndex] = lead;
  writeDB(db);

  // Phản hồi Twilio XML trống để tránh gửi tin nhắn rác
  res.type('text/xml').send('<Response></Response>');
});

// ==================== DISCORD NOTIFICATION SYSTEM ====================
const https = require('https');

// Hàm gửi webhook thông báo lên Discord
function sendDiscordWebhook(webhookUrl, lead, startDateTime) {
  return new Promise((resolve) => {
    const duration = parseInt(lead.bookingDetails.durationMinutes) || 120;
    const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);

    const formatOptions = {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    };
    const startStr = startDateTime.toLocaleString('vi-VN', formatOptions);
    const endStr = endDateTime.toLocaleString('vi-VN', formatOptions);

    const embed = {
      title: "🎾 THÔNG BÁO LỊCH TẬP TENNIS SẮP BẮT ĐẦU",
      description: `🔔 Buổi tập của học viên **${lead.name || 'Ẩn danh'}** sẽ diễn ra sau ít hơn 15 phút nữa!`,
      color: 13958196, // #D4FC34 - Màu bóng tennis
      fields: [
        {
          name: "👤 Học viên",
          value: lead.name || "Khách hàng ẩn danh",
          inline: true
        },
        {
          name: "📞 Số điện thoại",
          value: lead.phone || "Không có",
          inline: true
        },
        {
          name: "📱 Nền tảng liên hệ",
          value: lead.platform || "Zalo",
          inline: true
        },
        {
          name: "⏰ Thời gian bắt đầu",
          value: `**${startStr}**`,
          inline: true
        },
        {
          name: "⏰ Thời gian kết thúc",
          value: `**${endStr}**`,
          inline: true
        },
        {
          name: "⏱️ Thời lượng",
          value: `${duration} phút`,
          inline: true
        },
        {
          name: "📝 Ghi chú lịch dạy",
          value: lead.bookingDetails.notes || "Không có ghi chú thêm.",
          inline: false
        }
      ],
      footer: {
        text: "Tennis AI Sales Assistant - Nhắc lịch tự động"
      },
      timestamp: new Date().toISOString()
    };

    const payload = JSON.stringify({ embeds: [embed] });

    try {
      const url = new URL(webhookUrl);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Discord] Đã gửi thông báo thành công cho ${lead.name}`);
            resolve(true);
          } else {
            console.error(`[Discord] Gửi Webhook thất bại: HTTP ${res.statusCode} - ${responseBody}`);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[Discord] Lỗi kết nối khi gửi Webhook:`, error);
        resolve(false);
      });

      req.write(payload);
      req.end();
    } catch (err) {
      console.error(`[Discord] Lỗi xử lý Webhook URL:`, err);
      resolve(false);
    }
  });
}

// Lập lịch quét DB gửi thông báo Discord mỗi 60 giây
function startDiscordNotificationScheduler() {
  console.log('[Discord] Đã kích hoạt tiến trình quét lịch dạy nhắc nhở (chu kỳ 60s)...');
  setInterval(async () => {
    try {
      const db = readDB();
      const config = readConfig();
      const webhookUrl = config.discord_webhook_url;

      if (!webhookUrl) {
        return; // Bỏ qua nếu chưa cấu hình Discord Webhook
      }

      let dbChanged = false;
      const now = new Date();

      for (let i = 0; i < db.leads.length; i++) {
        const lead = db.leads[i];
        if (lead.status === 'Booked' && lead.bookingDetails && lead.bookingDetails.date && lead.bookingDetails.time) {
          // Bỏ qua nếu đã gửi thông báo rồi
          if (lead.bookingDetails.discordNotified) {
            continue;
          }

          // Phân tích thời gian bắt đầu học theo giờ Việt Nam
          const startDateTime = new Date(`${lead.bookingDetails.date}T${lead.bookingDetails.time}:00+07:00`);
          const timeDiffMs = startDateTime.getTime() - now.getTime();
          const timeDiffMins = timeDiffMs / (1000 * 60);

          // Gửi thông báo nếu thời gian bắt đầu trong vòng 15 phút tới và chưa quá muộn (trong vòng 30 phút qua)
          if (timeDiffMins <= 15 && timeDiffMins > -30) {
            console.log(`[Discord] Phát hiện lịch dạy sắp diễn ra của ${lead.name} (${lead.phone}) lúc ${lead.bookingDetails.time}. Đang gửi thông báo...`);
            const success = await sendDiscordWebhook(webhookUrl, lead, startDateTime);
            if (success) {
              lead.bookingDetails.discordNotified = true;
              dbChanged = true;
            }
          }
        }
      }

      if (dbChanged) {
        writeDB(db);
      }
    } catch (error) {
      console.error('[Discord] Gặp lỗi khi chạy trình lập lịch:', error);
    }
  }, 60000);
}

// Kích hoạt scheduler
startDiscordNotificationScheduler();

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`Tennis AI Sales Assistant Server đang chạy tại: http://localhost:${PORT}`);
});
