const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Đọc cấu hình động để luôn lấy cấu hình mới nhất
function getConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error('Lỗi khi đọc file config.json:', error);
    return {};
  }
}

// Khởi tạo Gemini AI Client
function getGenAI() {
  const config = getConfig();
  const apiKey = config.gemini_api_key || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('API Key của Gemini chưa được cấu hình. Vui lòng thiết lập trong Cài đặt.');
  }
  return new GoogleGenerativeAI(apiKey);
}

// Chuyển đổi file cục bộ sang định dạng Gemini
function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType,
    },
  };
}

// ==================== CÁC HÀM XỬ LÝ QUA GROQ CLOUD ====================

/**
 * OCR bằng mô hình Vision của Groq (llama-3.2-11b-vision-preview)
 */
async function performGroqOCR(apiKey, filePath, mimeType) {
  try {
    const base64Data = Buffer.from(fs.readFileSync(filePath)).toString('base64');
    
    const prompt = `
Bạn là một trợ lý AI chuyên nghiệp có nhiệm vụ trích xuất thông tin khách hàng từ ảnh chụp màn hình do đối tác giới thiệu gửi đến.
Hãy phân tích kỹ hình ảnh và trích xuất các thông tin sau:
1. Mã quốc gia (countryCode): Trích xuất RIÊNG mã quốc gia của số điện thoại, bao gồm dấu +. Ví dụ: "+84" cho Việt Nam, "+86" cho Trung Quốc, "+1" cho Mỹ/Canada, "+971" cho UAE. Nếu số bắt đầu bằng 0 (như 0912...) thì mã quốc gia là "+84".
2. Số thuê bao (phoneBody): Chỉ lấy phần số thuê bao SAU mã quốc gia, KHÔNG bao gồm mã quốc gia. Loại bỏ mọi khoảng trắng, dấu chấm, dấu gạch ngang. Ví dụ: nếu số là "+86 138 2430 1352" thì phoneBody là "13824301352". Nếu số bắt đầu bằng 0, bỏ số 0 đầu tiên đó.
3. Họ tên khách hàng (name): Nếu trong ảnh có tên khách hàng, hãy trích xuất. Nếu không có, trả về null.
4. Ghi chú bổ sung (notes): Trích xuất bất kỳ thông tin nào khác liên quan đến nhu cầu học, trình độ, thời gian rảnh, người giới thiệu hoặc địa điểm nếu có.

Yêu cầu trả về kết quả dưới định dạng JSON với cấu trúc chính xác như sau:
{
  "countryCode": "mã quốc gia, ví dụ '+84' hoặc '+86' hoặc '+1'",
  "phoneBody": "số thuê bao không có mã quốc gia, ví dụ '912345678' hoặc '13824301352'",
  "name": "Họ và tên khách hàng hoặc null",
  "notes": "Các ghi chú trích xuất được hoặc chuỗi rỗng"
}
`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`
                }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Lỗi kết nối API Groq Cloud');
    }

    const contentText = data.choices[0].message.content;
    console.log('Groq OCR Raw Response:', contentText);
    return JSON.parse(contentText);
  } catch (error) {
    console.error('Lỗi khi chạy Groq OCR:', error);
    throw error;
  }
}
/**
 * Chatbot trả lời tự động bằng mô hình Llama của Groq (llama-3.3-70b-versatile)
 */
async function runGroqChatbot(apiKey, messages, config, language = 'vi') {
  try {
    // Xác định ngôn ngữ trả lời
    const LANG_MAP = {
      en: 'English',
      vi: 'Vietnamese',
      ar: 'Arabic',
      fr: 'French',
      zh: 'Chinese (Simplified)',
      ru: 'Russian'
    };
    const langName = LANG_MAP[language] || 'English';
    const langInstruction = language === 'vi'
      ? 'Trả lời bằng tiếng Việt tự nhiên, lịch sự, xưng hô anh/chị và em/trợ lý.'
      : `You MUST reply ONLY in ${langName}. Use natural, friendly, professional tone appropriate for ${langName} speakers. Address the customer respectfully.`;

    const faqText = `
- Coach name: ${config.coach_name}
- Court / training location: ${config.faq.court_location}
- Lesson duration: ${config.faq.lesson_duration}
- Coach experience & certifications: ${config.faq.coach_experience}
- Teaching levels & target students: ${config.faq.teaching_levels}
- General teaching method introduction: ${config.faq.general_intro}
`;

    const pDetails = language === 'vi'
      ? (config.pricing_details_vi || config.pricing_details || '')
      : (config.pricing_details || config.pricing_details_vi || '');

    const pricingText = language === 'vi'
      ? `Thông tin học phí tham khảo: ${pDetails}`
      : `Tuition fee information: ${pDetails}`;

    const systemInstruction = `
You are the smart, friendly AI Sales Assistant of tennis coach ${config.coach_name}. You are chatting directly with a prospective student.
Your goal is to answer their questions based on the FAQ below and help the coach schedule a lesson.

${langInstruction}

Strictly follow these rules:
1. FAQ RESPONSES: Only answer questions about location, lesson duration, levels, and coach experience based on:
${faqText}
If a question is outside your knowledge, politely say you don't have that information and the coach will contact them directly.

2. PRICING POLICY (VERY IMPORTANT):
- NEVER proactively mention fees or pricing unless the client directly asks.
- ONLY when the client explicitly asks about pricing (e.g. "how much?", "what’s the fee?"), briefly summarize based on: "${pricingText}".
- When you share pricing, you MUST set "send_price_banner": true in your JSON response. Otherwise it must be false.

3. BOOKING POLICY (VERY IMPORTANT):
- You CANNOT confirm a schedule or agree on lesson times yourself.
- When a client expresses intent to book (e.g. "I want to sign up", "let’s schedule a session"), reply politely that coach ${config.coach_name} will contact them directly to finalize the schedule.
- You MUST set "trigger_coach_booking": true in your JSON response. Otherwise it must be false.

4. Response format MUST be valid JSON:
{
  "reply": "Your reply to the client in ${langName}",
  "send_price_banner": true_or_false,
  "trigger_coach_booking": true_or_false
}
`;

    // Chuẩn bị danh sách message theo chuẩn OpenAI / Groq
    const groqMessages = [
      { role: 'system', content: systemInstruction }
    ];

    messages.forEach(msg => {
      groqMessages.push({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.content
      });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        response_format: { type: 'json_object' }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Lỗi kết nối API Groq Cloud');
    }

    const contentText = data.choices[0].message.content;
    console.log('Groq Chat Raw Response:', contentText);
    return JSON.parse(contentText);
  } catch (error) {
    console.error('Lỗi khi chạy Groq Chatbot:', error);
    throw error;
  }
}

// ==================== CÁC API PHÂN PHỐI (DISPATCHERS) ====================

/**
 * Thực hiện OCR từ ảnh chụp màn hình để trích xuất SĐT, tên và ghi chú
 * @param {string} filePath Đường dẫn ảnh cục bộ
 * @param {string} mimeType Định dạng ảnh (image/png, image/jpeg, v.v.)
 * @returns {Promise<{phone: string, name: string, notes: string}>}
 */
async function performOCR(filePath, mimeType) {
  const config = getConfig();
  const geminiKey = config.gemini_api_key;
  const groqKey = config.groq_api_key;

  // Nếu có API key Gemini, chạy Gemini
  if (geminiKey) {
    try {
      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const prompt = `
Bạn là một trợ lý AI chuyên nghiệp có nhiệm vụ trích xuất thông tin khách hàng từ ảnh chụp màn hình do đối tác giới thiệu gửi đến.
Hãy phân tích kỹ hình ảnh và trích xuất các thông tin sau:
1. Mã quốc gia (countryCode): Trích xuất RIÊNG mã quốc gia của số điện thoại, bao gồm dấu +. Ví dụ: "+84" cho Việt Nam, "+86" cho Trung Quốc, "+1" cho Mỹ/Canada, "+971" cho UAE. Nếu số bắt đầu bằng 0 (như 0912...) thì mã quốc gia là "+84".
2. Số thuê bao (phoneBody): Chỉ lấy phần số thuê bao SAU mã quốc gia, KHÔNG bao gồm mã quốc gia. Loại bỏ mọi khoảng trắng, dấu chấm, dấu gạch ngang. Ví dụ: nếu số là "+86 138 2430 1352" thì phoneBody là "13824301352". Nếu số bắt đầu bằng 0, bỏ số 0 đầu tiên đó.
3. Họ tên khách hàng (name): Nếu trong ảnh có tên khách hàng, hãy trích xuất. Nếu không có, trả về null.
4. Ghi chú bổ sung (notes): Trích xuất bất kỳ thông tin nào khác liên quan đến nhu cầu học, trình độ, thời gian rảnh, người giới thiệu hoặc địa điểm nếu có.

Yêu cầu trả về kết quả dưới định dạng JSON với cấu trúc chính xác như sau:
{
  "countryCode": "mã quốc gia, ví dụ '+84' hoặc '+86' hoặc '+1'",
  "phoneBody": "số thuê bao không có mã quốc gia, ví dụ '912345678' hoặc '13824301352'",
  "name": "Họ và tên khách hàng hoặc null",
  "notes": "Các ghi chú trích xuất được hoặc chuỗi rỗng"
}
`;

      const imagePart = fileToGenerativePart(filePath, mimeType);
      const result = await model.generateContent({
        contents: [prompt, imagePart],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const responseText = result.response.text();
      console.log('Gemini OCR Raw Response:', responseText);
      return JSON.parse(responseText);
    } catch (error) {
      console.error('Lỗi trong dịch vụ Gemini OCR, thử chuyển hướng nếu có Groq:', error);
      if (groqKey) {
        return performGroqOCR(groqKey, filePath, mimeType);
      }
      throw error;
    }
  } 
  
  // Nếu có Groq Key mà không có Gemini, chạy Groq
  if (groqKey) {
    return performGroqOCR(groqKey, filePath, mimeType);
  }

  throw new Error('Chưa cấu hình API Key cho Gemini hoặc Groq. Vui lòng thiết lập trong Cài đặt.');
}

/**
 * Xử lý hội thoại tự động thông qua Chatbot Agent
 * @param {Array<{role: string, content: string}>} messages Lịch sử chat (role: 'user' hoặc 'model')
 * @param {string} language Mã ngôn ngữ: 'vi' | 'en' | 'ar' | 'fr' | 'zh' | 'ru'
 * @returns {Promise<{reply: string, send_price_banner: boolean, trigger_coach_booking: boolean}>}
 */
async function runChatbot(messages, language = 'vi') {
  const config = getConfig();
  const geminiKey = config.gemini_api_key;
  const groqKey = config.groq_api_key;

  // Xác định ngôn ngữ trả lời
  const LANG_MAP = {
    en: 'English',
    vi: 'Vietnamese (tiếng Việt)',
    ar: 'Arabic (عربي)',
    fr: 'French (français)',
    zh: 'Chinese Simplified (中文)',
    ru: 'Russian (русский)'
  };
  const langName = LANG_MAP[language] || 'English';
  const langInstruction = language === 'vi'
    ? 'Trả lời bằng tiếng Việt tự nhiên, lịch sự, xưng hô anh/chị và em/trợ lý.'
    : `You MUST reply ONLY in ${langName}. Use natural, friendly, professional tone appropriate for ${langName} speakers.`;

  // Nếu có API key Gemini, chạy Gemini
  if (geminiKey) {
    try {
      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const faqText = language === 'vi' ? `
- Tên huấn luyện viên (HLV): ${config.coach_name}
- Địa điểm dạy học: ${config.faq.court_location}
- Thời lượng buổi học: ${config.faq.lesson_duration}
- Kinh nghiệm và chứng chỉ HLV: ${config.faq.coach_experience}
- Trình độ và đối tượng giảng dạy: ${config.faq.teaching_levels}
- Giới thiệu chung phương pháp dạy: ${config.faq.general_intro}
` : `
- Coach name: ${config.coach_name}
- Court / training location: ${config.faq.court_location}
- Lesson duration: ${config.faq.lesson_duration}
- Coach experience & certifications: ${config.faq.coach_experience}
- Teaching levels & target students: ${config.faq.teaching_levels}
- General teaching method introduction: ${config.faq.general_intro}
`;

      const pDetails = language === 'vi'
        ? (config.pricing_details_vi || config.pricing_details || '')
        : (config.pricing_details || config.pricing_details_vi || '');

      const pricingText = language === 'vi' ? `
- Thông tin học phí tham khảo: ${pDetails}
` : `
- Tuition fee information: ${pDetails}
`;

      const systemInstruction = language === 'vi' ? `
Bạn là Trợ lý AI Bán hàng thông minh, thân thiện của HLV tennis ${config.coach_name}. Bạn đang trò chuyện trực tiếp với khách hàng tiềm năng.
Nhiệm vụ của bạn là chăm sóc khách hàng, trả lời các câu hỏi của họ dựa trên thông tin FAQ được cung cấp và hướng tới việc giúp HLV chốt lịch dạy học.

Hãy tuân thủ nghiêm ngặt các quy tắc sau:
1. TRẢ LỜI FAQ: Chỉ trả lời các câu hỏi về địa điểm học, thời lượng, trình độ, kinh nghiệm của HLV dựa TRÊN thông tin FAQ dưới đây:
${faqText}
Nếu khách hỏi những câu hỏi ngoài tầm hiểu biết hoặc không có trong thông tin trên, hãy trả lời lịch sự rằng bạn chưa nắm rõ thông tin đó và sẽ nhắn HLV trả lời trực tiếp cho khách sớm nhất.

2. CHÍNH SÁCH BÁO GIÁ (CỰC KỲ QUAN TRỌNG):
- Tuyệt đối KHÔNG được chủ động đề cập đến tiền bạc, học phí, chi phí hay gửi báo giá khi khách hàng chưa trực tiếp hỏi.
- CHỈ khi khách hàng hỏi trực tiếp về giá cả, học phí, chi phí (ví dụ: "học phí bao nhiêu?", "học phí thế nào em?", "rổ giá sao bạn?"), bạn mới trả lời tóm tắt ngắn gọn mức học phí dựa trên thông tin này: "${pricingText}".
- Đồng thời, khi khách hỏi giá, bạn BẮT BUỘC phải đặt cờ hiệu "send_price_banner": true trong JSON phản hồi để hệ thống tự động đính kèm Banner Báo Giá dạng ảnh gửi cho khách. Nếu khách không hỏi giá, cờ hiệu này bắt buộc phải là false.

3. CHÍNH SÁCH ĐẶT LỊCH HỌC (CỰC KỲ QUAN TRỌNG):
- Bạn KHÔNG được tự ý chốt lịch, thống nhất ngày giờ học, thời gian tập luyện với khách.
- Khi khách hàng bày tỏ mong muốn đặt lịch học, hẹn ngày giờ, hẹn buổi test (ví dụ: "cho mình đăng ký học nhé", "mình muốn học vào tối thứ 7", "khi nào thì bắt đầu học được?", "chốt lịch giúp mình nhé"), bạn phải trả lời lịch sự: "Dạ, để sắp xếp giờ học và sân tập phù hợp nhất với anh/chị, HLV ${config.coach_name} sẽ liên hệ trực tiếp với anh/chị ngay để thống nhất lịch cụ thể nhé ạ!"
- Đồng thời, bạn BẮT BUỘC phải đặt cờ hiệu "trigger_coach_booking": true trong JSON phản hồi để báo cho hệ thống chuyển quyền trò chuyện về cho HLV và hiển thị cảnh báo để HLV vào chốt lịch. Nếu khách chưa muốn đặt lịch, cờ hiệu này là false.

4. Định dạng kết quả trả về bắt buộc là JSON hợp lệ chứa các trường sau:
{
  "reply": "Nội dung câu trả lời của bạn gửi cho khách hàng bằng tiếng Việt tự nhiên, lịch sự, xưng hô anh/chị và em/trợ lý.",
  "send_price_banner": true_hoac_false,
  "trigger_coach_booking": true_hoac_false
}
` : `
You are the smart, friendly AI Sales Assistant of tennis coach ${config.coach_name}. You are chatting directly with a prospective student.
Your goal is to answer their questions based on the FAQ below and help the coach schedule a lesson.

${langInstruction}

Strictly follow these rules:
1. FAQ RESPONSES: Only answer questions about location, lesson duration, levels, and coach experience based on:
${faqText}
If a question is outside your knowledge, politely say you don't have that information and the coach will contact them directly.

2. PRICING POLICY (VERY IMPORTANT):
- NEVER proactively mention fees or pricing unless the client directly asks.
- ONLY when the client explicitly asks about pricing (e.g. "how much?", "what’s the fee?"), briefly summarize based on: "${pricingText}".
- When you share pricing, you MUST set "send_price_banner": true in your JSON response. Otherwise it must be false.

3. BOOKING POLICY (VERY IMPORTANT):
- You CANNOT confirm a schedule or agree on lesson times yourself.
- When a client expresses intent to book (e.g. "I want to sign up", "let’s schedule a session"), reply politely that coach ${config.coach_name} will contact them directly to finalize the schedule.
- You MUST set "trigger_coach_booking": true in your JSON response. Otherwise it must be false.

4. Response format MUST be valid JSON:
{
  "reply": "Your reply to the client in ${langName}",
  "send_price_banner": true_or_false,
  "trigger_coach_booking": true_or_false
}
`;

      const contents = [
        {
          role: 'user',
          parts: [{ text: systemInstruction }]
        },
        {
          role: 'model',
          parts: [{ text: language === 'vi'
            ? "Tôi đã hiểu rõ các quy tắc hoạt động của Trợ lý AI Bán hàng. Tôi sẽ phục vụ khách hàng chu đáo và tuân thủ tuyệt đối quy tắc báo giá và đặt lịch học."
            : "I understand the rules of the AI Sales Assistant. I will assist the client and strictly follow the pricing and booking policies."
          }]
        }
      ];

      messages.forEach(msg => {
        contents.push({
          role: msg.role === 'model' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      });

      const result = await model.generateContent({
        contents: contents,
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const responseText = result.response.text();
      console.log('Gemini Chat Raw Response:', responseText);
      return JSON.parse(responseText);
    } catch (error) {
      console.error('Lỗi trong dịch vụ Gemini Chatbot, thử chuyển hướng nếu có Groq:', error);
      if (groqKey) {
        return runGroqChatbot(groqKey, messages, config, language);
      }
      throw error;
    }
  }

  // Nếu có Groq Key mà không có Gemini, chạy Groq
  if (groqKey) {
    return runGroqChatbot(groqKey, messages, config, language);
  }

  throw new Error('Chưa cấu hình API Key cho Gemini hoặc Groq. Vui lòng thiết lập trong Cài đặt.');
}

/**
 * Dịch câu hỏi tiếng Anh của khách sang tiếng Việt
 */
async function translateToVietnamese(text) {
  const config = getConfig();
  const geminiKey = config.gemini_api_key;
  const groqKey = config.groq_api_key;

  const prompt = `Bạn là một dịch thuật viên chuyên nghiệp. Hãy dịch câu hỏi/tin nhắn tiếng Anh sau của khách hàng sang tiếng Việt một cách tự nhiên, lịch sự và chính xác. Trả về DUY NHẤT nội dung dịch, không thêm lời dẫn hay giải thích nào khác.\n\nTin nhắn: "${text}"`;

  if (geminiKey) {
    try {
      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (e) {
      console.error('Lỗi khi dịch bằng Gemini, thử Groq:', e);
    }
  }

  if (groqKey) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      if (response.ok) {
        return data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.error('Lỗi khi dịch bằng Groq:', e);
    }
  }

  return '';
}

module.exports = {
  performOCR,
  runChatbot,
  translateToVietnamese,
};
