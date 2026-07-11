const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const geminiService = require('./services/gemini');
const zaloService = require('./services/zalo');
const whatsappService = require('./services/whatsapp');
const googleService = require('./services/google');
const dbService = require('./services/db');

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
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await dbService.getLeads();
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
      const cc = ocrData.countryCode.trim();
      const pb = ocrData.phoneBody.replace(/\s/g, '');
      rawPhone = cc + pb;
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
    const leads = await dbService.getLeads();
    const existing = leads.find(l => l.phone === newLead.phone && newLead.phone !== '');
    if (existing) {
      return res.json({
        success: true,
        isDuplicate: true,
        existingLead: existing,
        ocrData: newLead
      });
    }

    // Lưu ngay lập tức vào database sau khi OCR xong
    const savedLead = await dbService.createLead(newLead);
    res.json({ success: true, lead: savedLead });
  } catch (error) {
    console.error('Lỗi khi chạy OCR:', error);
    res.status(500).json({ error: 'Không thể xử lý ảnh bằng OCR. Hãy thử điền tay thông tin.' });
  }
});

// Lưu khách hàng mới vào Database
app.post('/api/leads', async (req, res) => {
  const leadData = req.body;
  
  if (!leadData.phone) {
    return res.status(400).json({ error: 'Số điện thoại là bắt buộc' });
  }

  try {
    const newLead = await dbService.createLead(leadData);
    res.json({ success: true, lead: newLead });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Xóa khách hàng
app.delete('/api/leads/:id', async (req, res) => {
  try {
    await dbService.deleteLead(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// 3. Quản lý hội thoại và AI Chatbot

// Gửi tin nhắn chào mừng & bắt đầu chat
app.post('/api/leads/start-chat', async (req, res) => {
  const { id, language } = req.body;
  const leads = await dbService.getLeads();
  const lead = leads.find(l => l.id === id);

  if (!lead) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

  const config = readConfig();

  // Tạo nội dung tin nhắn chào theo template ngôn ngữ
  const effectiveLang = language || lead.language || 'vi';
  let greetingTemplate;
  if (effectiveLang === 'vi') {
    greetingTemplate = config.greeting_template || '';
  } else {
    greetingTemplate = config.greeting_template_en || '';
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

  const updates = {
    status: 'Chatting'
  };
  if (language) updates.language = language;

  // Xóa câu gợi ý (nếu có) khi bắt đầu chat tự động
  updates.suggestedReply = null;

  try {
    await dbService.updateLead(id, updates);
    await dbService.addMessage(id, greetingMsg);

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

    const updatedLeads = await dbService.getLeads();
    res.json({ 
      success: true, 
      lead: updatedLeads.find(l => l.id === id), 
      chatLink: link,
      apiSent: !sendResult.simulated,
      apiError: sendResult.error || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Nhận tin nhắn thủ công từ HLV gửi đi từ Dashboard
app.post('/api/chat/send-manual', async (req, res) => {
  const { leadId, content } = req.body;
  const leads = await dbService.getLeads();
  const lead = leads.find(l => l.id === leadId);

  if (!lead) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

  const manualMsg = {
    id: 'msg_' + Date.now(),
    sender: 'model',
    content: content,
    timestamp: new Date().toISOString()
  };

  try {
    await dbService.addMessage(leadId, manualMsg);
    // Xóa câu gợi ý AI cũ khi HLV đã phản hồi thủ công
    await dbService.updateLead(leadId, { suggestedReply: null });

    // Gửi tin nhắn đi qua API nếu có kết nối
    if (lead.platform === 'Zalo') {
      await zaloService.sendZaloMessage(lead.phone, content);
    } else {
      await whatsappService.sendWhatsAppMessage(lead.phone, content);
    }

    const updatedLeads = await dbService.getLeads();
    res.json({ success: true, messages: updatedLeads.find(l => l.id === leadId).messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mô phỏng tin nhắn từ khách gửi đến (dùng để Test hệ thống)
app.post('/api/chat/simulate-message', async (req, res) => {
  const { leadId, content } = req.body;
  const leads = await dbService.getLeads();
  const lead = leads.find(l => l.id === leadId);

  if (!lead) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }

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

  try {
    await dbService.addMessage(leadId, userMsg);

    // Tải lại lead sau khi thêm tin nhắn
    let updatedLeads = await dbService.getLeads();
    let updatedLead = updatedLeads.find(l => l.id === leadId);

    // Nếu trạng thái không phải Chatting (AI tự trả lời đã tắt hoặc chờ chốt lịch)
    if (updatedLead.status !== 'Chatting') {
      try {
        const chatHistory = updatedLead.messages.map(m => ({
          role: m.sender === 'user' ? 'user' : 'model',
          content: m.content
        }));
        const aiResponse = await geminiService.runChatbot(chatHistory, updatedLead.language || 'vi');
        const suggestedReply = {
          content: aiResponse.reply,
          send_price_banner: aiResponse.send_price_banner || false,
          trigger_coach_booking: aiResponse.trigger_coach_booking || false,
          timestamp: new Date().toISOString()
        };
        await dbService.updateLead(leadId, { suggestedReply });
      } catch (error) {
        console.error('Lỗi sinh đề xuất trả lời AI:', error);
      }

      const finalLeads = await dbService.getLeads();
      return res.json({ success: true, lead: finalLeads.find(l => l.id === leadId), replySimulated: false });
    }

    // 2. Chạy Chatbot AI Gemini khi đang ở trạng thái Chatting tự động
    const chatHistory = updatedLead.messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'model',
      content: m.content
    }));

    const aiResponse = await geminiService.runChatbot(chatHistory, updatedLead.language || 'vi');

    // 3. Thêm tin nhắn trả lời của AI (model)
    const aiMsg = {
      id: 'msg_model_' + Date.now(),
      sender: 'model',
      content: aiResponse.reply,
      timestamp: new Date().toISOString()
    };
    await dbService.addMessage(leadId, aiMsg);

    // 4. Nếu AI yêu cầu gửi banner báo giá
    let bannerSent = false;
    if (aiResponse.send_price_banner) {
      const config = readConfig();
      const leadLang = updatedLead.language || 'vi';
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
      await dbService.addMessage(leadId, bannerMsg);
      bannerSent = true;

      // Gửi banner qua API nếu được thiết lập
      const fullBannerUrl = req.protocol + '://' + req.get('host') + bannerPath;
      if (updatedLead.platform === 'Zalo') {
        await zaloService.sendZaloMessage(updatedLead.phone, "Ảnh báo giá đính kèm", fullBannerUrl);
      } else {
        await whatsappService.sendWhatsAppMessage(updatedLead.phone, "Ảnh báo giá đính kèm", fullBannerUrl);
      }
    }

    // 5. Nếu AI phát hiện mong muốn đặt lịch học
    if (aiResponse.trigger_coach_booking) {
      await dbService.updateLead(leadId, { status: 'Awaiting Booking' });
    }

    // Gửi phản hồi chính của AI qua API thực tế nếu có cấu hình
    if (updatedLead.platform === 'Zalo') {
      await zaloService.sendZaloMessage(updatedLead.phone, aiResponse.reply);
    } else {
      await whatsappService.sendWhatsAppMessage(updatedLead.phone, aiResponse.reply);
    }

    const finalLeads = await dbService.getLeads();
    res.json({ 
      success: true, 
      lead: finalLeads.find(l => l.id === leadId), 
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
  const leads = await dbService.getLeads();
  const lead = leads.find(l => l.id === leadId);

  if (!lead) {
    return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  }
  
  try {
    // 1. Tạo sự kiện Google Calendar (với múi giờ Việt Nam an toàn +07:00)
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

    const bookingDetails = {
      date,
      time,
      durationMinutes,
      notes,
      calendarLink: calendarResult.eventLink || null,
      syncedCRM: crmResult.success && !crmResult.simulated,
      discordNotified: false
    };

    // 3. Cập nhật trạng thái khách hàng thành Booked và xóa gợi ý cũ
    await dbService.updateLead(leadId, {
      status: 'Booked',
      bookingDetails,
      suggestedReply: null
    });

    // Thêm tin nhắn hệ thống thông báo chốt lịch thành công
    const systemMsg = {
      id: 'msg_sys_' + Date.now(),
      sender: 'system',
      content: `Lịch học đã được chốt: ngày ${date} lúc ${time} (${durationMinutes} phút). Đã đồng bộ Google Calendar & CRM.`,
      timestamp: new Date().toISOString()
    };
    await dbService.addMessage(leadId, systemMsg);

    const finalLeads = await dbService.getLeads();
    res.json({ 
      success: true, 
      lead: finalLeads.find(l => l.id === leadId),
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
  const twilioFrom = req.body.From;
  const content = req.body.Body;
  
  if (!twilioFrom || !content) {
    return res.status(400).send('Invalid request');
  }

  const rawPhone = twilioFrom.replace('whatsapp:', '');
  const { phone } = normalizePhoneNumber(rawPhone);

  const leads = await dbService.getLeads();
  let lead = leads.find(l => l.phone === phone);

  if (!lead) {
    // Tạo lead mới tự động nếu chưa có
    const id = 'lead_' + Date.now();
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

    const newLeadData = {
      id,
      phone,
      countryCode: finalCountryCode,
      phoneBody: finalPhoneBody,
      name: 'Khách hàng WhatsApp',
      notes: 'Tự động tạo từ tin nhắn WhatsApp mới',
      platform: 'WhatsApp',
      screenshotPath: '',
      status: 'Chatting',
      language: 'en',
      messages: []
    };
    
    lead = await dbService.createLead(newLeadData);
  }

  const userMsg = {
    id: 'msg_user_' + Date.now(),
    sender: 'user',
    content: content,
    timestamp: new Date().toISOString()
  };

  // Dịch sang tiếng Việt nếu cần
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

  try {
    await dbService.addMessage(lead.id, userMsg);

    // Tải lại lead với tin nhắn mới nhất
    const updatedLeads = await dbService.getLeads();
    const updatedLead = updatedLeads.find(l => l.id === lead.id);

    // Nếu đang bật tự động trả lời bằng AI (Chatting)
    if (updatedLead.status === 'Chatting') {
      const chatHistory = updatedLead.messages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        content: m.content
      }));

      const aiResponse = await geminiService.runChatbot(chatHistory, updatedLead.language || 'vi');

      const aiMsg = {
        id: 'msg_model_' + Date.now(),
        sender: 'model',
        content: aiResponse.reply,
        timestamp: new Date().toISOString()
      };
      await dbService.addMessage(updatedLead.id, aiMsg);

      // Gửi banner báo giá nếu cần
      if (aiResponse.send_price_banner) {
        const config = readConfig();
        const leadLang = updatedLead.language || 'vi';
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
        await dbService.addMessage(updatedLead.id, bannerMsg);

        const fullBannerUrl = req.protocol + '://' + req.get('host') + bannerPath;
        await whatsappService.sendWhatsAppMessage(updatedLead.phone, "Ảnh báo giá đính kèm", fullBannerUrl);
      }

      if (aiResponse.trigger_coach_booking) {
        await dbService.updateLead(updatedLead.id, { status: 'Awaiting Booking' });
      }

      await whatsappService.sendWhatsAppMessage(updatedLead.phone, aiResponse.reply);
    } else {
      // AI Tự trả lời đang tắt -> Sinh câu đề xuất gợi ý cho HLV
      const chatHistory = updatedLead.messages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        content: m.content
      }));
      const aiResponse = await geminiService.runChatbot(chatHistory, updatedLead.language || 'vi');
      const suggestedReply = {
        content: aiResponse.reply,
        send_price_banner: aiResponse.send_price_banner || false,
        trigger_coach_booking: aiResponse.trigger_coach_booking || false,
        timestamp: new Date().toISOString()
      };
      await dbService.updateLead(updatedLead.id, { suggestedReply });
    }
  } catch (error) {
    console.error('Lỗi khi xử lý webhook tin nhắn WhatsApp:', error);
  }

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
      const leads = await dbService.getLeads();
      const config = readConfig();
      const webhookUrl = config.discord_webhook_url;

      if (!webhookUrl) {
        return;
      }

      const now = new Date();

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (lead.status === 'Booked' && lead.bookingDetails && lead.bookingDetails.date && lead.bookingDetails.time) {
          if (lead.bookingDetails.discordNotified) {
            continue;
          }

          const startDateTime = new Date(`${lead.bookingDetails.date}T${lead.bookingDetails.time}:00+07:00`);
          const timeDiffMs = startDateTime.getTime() - now.getTime();
          const timeDiffMins = timeDiffMs / (1000 * 60);

          if (timeDiffMins <= 15 && timeDiffMins > -30) {
            console.log(`[Discord] Phát hiện lịch dạy sắp diễn ra của ${lead.name} (${lead.phone}) lúc ${lead.bookingDetails.time}. Đang gửi thông báo...`);
            const success = await sendDiscordWebhook(webhookUrl, lead, startDateTime);
            if (success) {
              const updatedBookingDetails = {
                ...lead.bookingDetails,
                discordNotified: true
              };
              await dbService.updateLead(lead.id, { bookingDetails: updatedBookingDetails });
            }
          }
        }
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
