// Các biến toàn cục quản lý trạng thái giao diện
let currentTab = 'dashboard';
let leadsList = [];
let activeChatLeadId = null;
let systemConfig = {};
let hiddenLeads = JSON.parse(localStorage.getItem('hiddenLeads') || '[]');
// Định dạng số điện thoại hiển thị đẹp mắt theo nền tảng
// platform: 'Zalo' → mã vùng +84 | 'WhatsApp' → giữ nguyên mã vùng quốc tế
function formatPhoneForDisplay(phoneStr, platform) {
  if (!phoneStr) return '';
  let clean = phoneStr.replace(/[^\d+]/g, '').trim();

  // ── ZALO: Luôn hiển thị dạng +84 ────────────────────────────────
  if (platform === 'Zalo') {
    // Chuẩn hóa về chuỗi 9 chữ số cuối (bỏ đầu 0 hoặc +84)
    let local = clean;
    if (local.startsWith('+84')) local = local.slice(3);
    else if (local.startsWith('84') && local.length > 9) local = local.slice(2);
    else if (local.startsWith('0')) local = local.slice(1);

    // Định dạng +84 xxx xxx xxx
    if (local.length === 9) {
      return `+84 ${local.slice(0,3)} ${local.slice(3,6)} ${local.slice(6)}`;
    }
    // Fallback
    return `+84 ${local}`;
  }

  // ── WHATSAPP: Giữ nguyên mã vùng quốc tế, tách nhóm đẹp ────────
  // Đảm bảo có dấu +
  if (!clean.startsWith('+')) clean = '+' + clean;
  const digits = clean.slice(1); // bỏ dấu +

  // +971 UAE → +971 XX XXX XXXX
  if (digits.startsWith('971') && digits.length === 12) {
    return `+971 ${digits.slice(3,5)} ${digits.slice(5,8)} ${digits.slice(8)}`;
  }
  // +1 US/CA → +1 (XXX) XXX-XXXX
  if (digits.startsWith('1') && digits.length === 11) {
    return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  // +44 UK → +44 XXXX XXXXXX
  if (digits.startsWith('44') && digits.length === 12) {
    return `+44 ${digits.slice(2,6)} ${digits.slice(6)}`;
  }
  // +84 VN (WhatsApp) → +84 XXX XXX XXX
  if (digits.startsWith('84') && digits.length === 11) {
    return `+84 ${digits.slice(2,5)} ${digits.slice(5,8)} ${digits.slice(8)}`;
  }
  // +86 China → +86 XXX XXXX XXXX
  if (digits.startsWith('86') && digits.length === 13) {
    return `+86 ${digits.slice(2,5)} ${digits.slice(5,9)} ${digits.slice(9)}`;
  }
  // +60 Malaysia → +60 XX XXXX XXXX
  if (digits.startsWith('60') && (digits.length === 11 || digits.length === 12)) {
    return `+60 ${digits.slice(2,4)} ${digits.slice(4,8)} ${digits.slice(8)}`;
  }
  // +65 Singapore → +65 XXXX XXXX
  if (digits.startsWith('65') && digits.length === 10) {
    return `+65 ${digits.slice(2,6)} ${digits.slice(6)}`;
  }
  // Fallback: detect country code length by known 1/2/3 digit prefixes, group rest 3-3-4
  if (digits.length >= 9) {
    // 3-digit country codes: 971, 966, 852, 853, 855, 856, 880...
    const threeDigitCC = ['971','966','852','853','855','856','880','886','855'];
    const ccLen = threeDigitCC.some(cc => digits.startsWith(cc)) ? 3 : 2;
    const cc = digits.slice(0, ccLen);
    const rest = digits.slice(ccLen);
    const grouped = rest.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
    return `+${cc} ${grouped}`;
  }

  return phoneStr;
}

// Khởi chạy khi DOM đã load
document.addEventListener('DOMContentLoaded', () => {
  // Cập nhật Icons Lucide
  lucide.createIcons();
  
  // Tải dữ liệu ban đầu
  fetchConfig();
  fetchLeads();
  
  // Thiết lập các Event Handlers
  setupTabNavigation();
  setupOCRHandlers();
  setupChatHandlers();
  setupSettingsHandlers();
  setupBookingHandlers();

  // Thiết lập Real-time WebSockets với Socket.io
  setupSocketConnection();

  // Định kỳ tải danh sách Leads mỗi 10 giây để giữ dữ liệu cập nhật
  setInterval(fetchLeads, 10000);
});

// ==================== TẢI DỮ LIỆU TỪ SERVER ====================

async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    systemConfig = await response.json();
    
    // Cập nhật thông tin lên giao diện
    document.getElementById('summary-coach-name').textContent = `HLV ${systemConfig.coach_name || 'Nguyễn Văn A'}`;
    
    // Đổ dữ liệu vào trang Cài đặt
    document.getElementById('set-coach-name').value = systemConfig.coach_name || '';
    document.getElementById('set-greeting').value = systemConfig.greeting_template || '';
    document.getElementById('set-greeting-en').value = systemConfig.greeting_template_en || '';
    document.getElementById('set-faq-location').value = systemConfig.faq?.court_location || '';
    document.getElementById('set-faq-duration').value = systemConfig.faq?.lesson_duration || '';
    document.getElementById('set-faq-levels').value = systemConfig.faq?.teaching_levels || '';
    document.getElementById('set-faq-experience').value = systemConfig.faq?.coach_experience || '';
    document.getElementById('set-faq-intro').value = systemConfig.faq?.general_intro || '';
    document.getElementById('set-pricing-details').value = systemConfig.pricing_details || '';
    document.getElementById('set-pricing-details-vi').value = systemConfig.pricing_details_vi || '';
    
    // Đổ dữ liệu API Keys
    document.getElementById('set-gemini-key').value = systemConfig.gemini_api_key || '';
    document.getElementById('set-groq-key').value = systemConfig.groq_api_key || '';
    document.getElementById('set-google-sheets-id').value = systemConfig.google_sheets_id || '';
    document.getElementById('set-google-calendar-id').value = systemConfig.google_calendar_id || 'primary';
    document.getElementById('set-google-email').value = systemConfig.google_credentials?.client_email || '';
    document.getElementById('set-google-key').value = systemConfig.google_credentials?.private_key || '';
    document.getElementById('set-discord-webhook').value = systemConfig.discord_webhook_url || '';

    // Cập nhật preview banner tiếng Anh
    const bannerImg = document.getElementById('banner-preview-img');
    const noBannerImg = document.getElementById('banner-no-img');
    if (systemConfig.price_banner_path) {
      bannerImg.src = systemConfig.price_banner_path + '?t=' + Date.now();
      bannerImg.style.display = 'block';
      noBannerImg.style.display = 'none';
    } else {
      bannerImg.style.display = 'none';
      noBannerImg.style.display = 'flex';
    }

    // Cập nhật preview banner tiếng Việt
    const bannerImgVi = document.getElementById('banner-preview-img-vi');
    const noBannerImgVi = document.getElementById('banner-no-img-vi');
    if (systemConfig.price_banner_path_vi) {
      bannerImgVi.src = systemConfig.price_banner_path_vi + '?t=' + Date.now();
      bannerImgVi.style.display = 'block';
      noBannerImgVi.style.display = 'none';
    } else {
      bannerImgVi.style.display = 'none';
      noBannerImgVi.style.display = 'flex';
    }
  } catch (error) {
    console.error('Không thể tải cấu hình:', error);
  }
}

async function fetchLeads() {
  try {
    const response = await fetch('/api/leads');
    const allLeads = await response.json();
    
    // Lọc bỏ các lead bị ẩn mềm
    leadsList = allLeads.filter(l => !hiddenLeads.includes(l.id));

    // Cập nhật số lượng lead đã ẩn trong trang Cài đặt
    const restoreBadge = document.getElementById('hidden-leads-count');
    if (restoreBadge) {
      restoreBadge.textContent = hiddenLeads.length;
    }
    
    // Render danh sách trên Dashboard và Chat Sidebar
    renderLeadsProgress();
    renderChatSidebar();
    updateMetrics();

    // Nếu đang mở chat mà lead bị ẩn đi, đóng khung chat
    if (activeChatLeadId && hiddenLeads.includes(activeChatLeadId)) {
      activeChatLeadId = null;
      document.getElementById('chat-placeholder').style.display = 'flex';
      document.getElementById('chat-content').style.display = 'none';
    } else if (activeChatLeadId) {
      const activeLead = leadsList.find(l => l.id === activeChatLeadId);
      if (activeLead) {
        renderChatWindow(activeLead);
      }
    }
  } catch (error) {
    console.error('Không thể tải danh sách Leads:', error);
  }
}

// Cập nhật các con số thống kê
function updateMetrics() {
  const total = leadsList.length;
  const chatting = leadsList.filter(l => l.status === 'Chatting').length;
  const awaiting = leadsList.filter(l => l.status === 'Awaiting Booking').length;
  const booked = leadsList.filter(l => l.status === 'Booked').length;

  document.getElementById('metric-total-leads').textContent = total;
  document.getElementById('metric-chatting-leads').textContent = chatting;
  document.getElementById('metric-awaiting-leads').textContent = awaiting;
  document.getElementById('metric-booked-leads').textContent = booked;

  // Cập nhật số lượng thông báo chốt lịch trên tab Chathub
  const badge = document.getElementById('chat-notification-badge');
  if (awaiting > 0) {
    badge.textContent = awaiting;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ==================== ĐIỀU HƯỚNG TABS ====================

function setupTabNavigation() {
  const buttons = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.tab-panel');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      // Xóa active cũ
      buttons.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      // Active tab mới
      btn.classList.add('active');
      document.getElementById(`tab-${targetTab}`).classList.add('active');
      currentTab = targetTab;

      // Đóng sidebar nếu đang hiển thị trên mobile/tablet
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && window.innerWidth <= 1024) {
        sidebar.classList.remove('open');
      }

      // Đổi tiêu đề header tương ứng
      if (targetTab === 'dashboard') {
        pageTitle.textContent = 'Tổng quan hệ thống';
        pageSubtitle.textContent = 'Quản lý và tiếp nhận học viên tiềm năng';
        fetchLeads(); // Reload leads
      } else if (targetTab === 'chathub') {
        pageTitle.textContent = 'Hộp thư chat';
        pageSubtitle.textContent = 'Tương tác trực tiếp và quản lý hội thoại AI';
        fetchLeads(); // Reload chats
      } else if (targetTab === 'settings') {
        pageTitle.textContent = 'Cấu hình Trợ lý';
        pageSubtitle.textContent = 'Thiết lập FAQ bài học, giá cả và các khóa kết nối API';
      }
    });
  });
}

// ==================== XỬ LÝ OCR UPLOADER ====================

function setupOCRHandlers() {
  const dropZone = document.getElementById('ocr-drop-zone');
  const fileInput = document.getElementById('ocr-file-input');
  const previewContainer = document.getElementById('ocr-preview-container');
  const imagePreview = document.getElementById('ocr-image-preview');
  const resultForm = document.getElementById('ocr-result-form');
  const duplicateWarning = document.getElementById('duplicate-warning');
  
  const btnCancel = document.getElementById('btn-ocr-cancel');
  const btnProcess = document.getElementById('btn-ocr-process');
  const btnReset = document.getElementById('btn-ocr-reset');
  const btnSaveStart = document.getElementById('btn-ocr-save-start');
  
  let selectedFile = null;

  // Hiện/ẩn selector ngôn ngữ tuỳ theo nền tảng
  const platformSel = document.getElementById('ocr-platform');
  const langGroup = document.getElementById('language-selector-group');
  function updateLanguageVisibility() {
    if (platformSel.value === 'WhatsApp') {
      langGroup.style.display = 'block';
      // Animate in
      langGroup.style.opacity = '0';
      langGroup.style.transform = 'translateY(-6px)';
      requestAnimationFrame(() => {
        langGroup.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        langGroup.style.opacity = '1';
        langGroup.style.transform = 'translateY(0)';
      });
    } else {
      langGroup.style.opacity = '0';
      langGroup.style.transform = 'translateY(-6px)';
      setTimeout(() => { langGroup.style.display = 'none'; }, 220);
    }
  }
  platformSel.addEventListener('change', updateLanguageVisibility);

  // Bấm vào vùng upload để chọn file
  dropZone.addEventListener('click', () => fileInput.click());

  // Kéo thả file
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--color-tennis)';
    dropZone.style.background = 'var(--color-tennis-bg)';
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'rgba(212, 252, 52, 0.3)';
    dropZone.style.background = 'rgba(255, 255, 255, 0.01)';
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'rgba(212, 252, 52, 0.3)';
    dropZone.style.background = 'rgba(255, 255, 255, 0.01)';
    
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  // Hỗ trợ Dán ảnh chụp màn hình trực tiếp từ Clipboard (Ctrl + V)
  document.addEventListener('paste', (e) => {
    // Chỉ hoạt động khi đang ở màn hình Dashboard tổng quan
    if (currentTab !== 'dashboard') return;

    const items = (e.clipboardData || window.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        handleFileSelected(file);
        break; // Chỉ lấy ảnh đầu tiên
      }
    }
  });

  function handleFileSelected(file) {
    if (!file.type.startsWith('image/')) {
      alert('Vui lòng chỉ chọn tệp ảnh chụp màn hình.');
      return;
    }
    selectedFile = file;
    
    // Hiển thị ảnh preview
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.src = e.target.result;
      dropZone.style.display = 'none';
      previewContainer.style.display = 'flex';
      resultForm.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  btnCancel.addEventListener('click', () => {
    resetOCRState();
  });

  // Gửi ảnh lên backend chạy OCR Gemini
  btnProcess.addEventListener('click', async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('screenshot', selectedFile);

    document.getElementById('ocr-loading').style.display = 'flex';

    try {
      const response = await fetch('/api/leads/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      document.getElementById('ocr-loading').style.display = 'none';

      if (!response.ok) {
        throw new Error(data.error || 'Lỗi khi chạy OCR');
      }

      previewContainer.style.display = 'none';
      resultForm.style.display = 'flex';

      // Điền thông tin trích xuất vào form
      const leadData = data.isDuplicate ? data.ocrData : data.lead;

      // Tách phone thành countryCode + phoneBody
      let ocrCountryCode = leadData.countryCode || '';
      let ocrPhoneBody = leadData.phoneBody || '';
      if (!ocrCountryCode) {
        const rawStr = (leadData.phone || '').replace(/[\s\-\.]/g, '');
        if (rawStr.startsWith('+')) {
          const m = rawStr.match(/^(\+\d{1,3})(\d+)$/);
          if (m) { ocrCountryCode = m[1]; ocrPhoneBody = m[2]; }
          else { ocrCountryCode = '+84'; ocrPhoneBody = rawStr.slice(3); }
        } else if (rawStr.startsWith('84') && rawStr.length > 9) {
          ocrCountryCode = '+84'; ocrPhoneBody = rawStr.slice(2);
        } else if (rawStr.startsWith('0')) {
          ocrCountryCode = '+84'; ocrPhoneBody = rawStr.slice(1);
        } else {
          ocrCountryCode = '+84'; ocrPhoneBody = rawStr;
        }
      }
      document.getElementById('ocr-country-code').value = ocrCountryCode;
      document.getElementById('ocr-phone-body').value = ocrPhoneBody;
      document.getElementById('ocr-name').value = leadData.name || '';
      
      // Bắt buộc HLV phải tự chọn Zalo hoặc WhatsApp nếu là số Việt Nam
      let detectedPlatform = leadData.platform || 'Zalo';
      if (ocrCountryCode === '+84' || ocrPhoneBody.startsWith('0')) {
        detectedPlatform = '';
      } else {
        detectedPlatform = 'WhatsApp';
      }
      document.getElementById('ocr-platform').value = detectedPlatform;
      document.getElementById('ocr-notes').value = leadData.notes || '';
      
      updateLanguageVisibility();

      // Xử lý nếu trùng SĐT
      if (data.isDuplicate) {
        duplicateWarning.style.display = 'flex';
        document.getElementById('btn-view-duplicate').onclick = () => {
          resetOCRState();
          openLeadInChat(data.existingLead.id);
        };
        btnSaveStart.disabled = true;
      } else {
        duplicateWarning.style.display = 'none';
        btnSaveStart.disabled = false;
        
        // Lưu thông tin lead tạm thời vào button
        btnSaveStart.onclick = () => saveLeadAndStartChat(leadData);
      }

    } catch (error) {
      document.getElementById('ocr-loading').style.display = 'none';
      alert('Không thể thực hiện OCR tự động: ' + error.message + '\nBạn có thể tự điền tay thông tin bằng cách đóng preview.');
      // Cho phép điền tay
      previewContainer.style.display = 'none';
      resultForm.style.display = 'flex';
      duplicateWarning.style.display = 'none';
      btnSaveStart.disabled = false;
      
      btnSaveStart.onclick = () => {
        const cc = document.getElementById('ocr-country-code').value.trim();
        const pb = document.getElementById('ocr-phone-body').value.replace(/\s/g, '');
        const manualLead = {
          phone: cc && pb ? cc + pb : pb,
          name: document.getElementById('ocr-name').value,
          platform: document.getElementById('ocr-platform').value,
          notes: document.getElementById('ocr-notes').value
        };
        saveLeadAndStartChat(manualLead);
      };
    }
  });

  btnReset.addEventListener('click', () => {
    resetOCRState();
  });

  function resetOCRState() {
    selectedFile = null;
    fileInput.value = '';
    dropZone.style.display = 'flex';
    previewContainer.style.display = 'none';
    resultForm.style.display = 'none';
    duplicateWarning.style.display = 'none';
  }

  // Lưu khách hàng mới & kích hoạt nhắn tin chào mừng
  async function saveLeadAndStartChat(leadData) {
    // Thu thập lại thông tin từ form (HLV có thể đã sửa)
    const countryCode = document.getElementById('ocr-country-code').value.trim();
    const phoneBody = document.getElementById('ocr-phone-body').value.replace(/\s/g, '');
    const phone = countryCode && phoneBody ? countryCode + phoneBody : phoneBody;
    const name = document.getElementById('ocr-name').value.trim();
    const platform = document.getElementById('ocr-platform').value;
    const notes = document.getElementById('ocr-notes').value.trim();
    // Ngôn ngữ: chỉ áp dụng cho WhatsApp, Zalo mặc định là 'vi'
    const language = platform === 'WhatsApp'
      ? (document.getElementById('ocr-language').value || 'en')
      : 'vi';

    if (!phoneBody) {
      alert('Vui lòng nhập số điện thoại khách hàng.');
      return;
    }
    if (!countryCode || !countryCode.startsWith('+')) {
      alert('Vui lòng nhập mã quốc gia đúng định dạng (ví dụ: +84, +86, +1).');
      return;
    }
    if (!platform) {
      alert('Vui lòng chọn nền tảng kết nối (Zalo hoặc WhatsApp) cho khách hàng.');
      return;
    }

    try {
      // 1. Tạo Lead mới (lưu số thô, bỏ khoảng trắng format)
      const rawPhone = phone.replace(/\s/g, '');
      const saveResponse = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...leadData, 
          phone: rawPhone, 
          countryCode: countryCode, 
          phoneBody: phoneBody, 
          name, 
          platform, 
          notes, 
          language 
        })
      });
      const saveResult = await saveResponse.json();
      if (!saveResponse.ok) throw new Error(saveResult.error);

      // 2. Gọi API bắt đầu chat chào mừng (kèm language)
      const chatResponse = await fetch('/api/leads/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: saveResult.lead.id, language })
      });
      const chatResult = await chatResponse.json();
      
      // Reset giao diện OCR
      resetOCRState();
      
      // Chuyển sang Tab Chat Hub và hiển thị hội thoại
      openLeadInChat(saveResult.lead.id);

      // Nếu chạy giả lập (không cấu hình API) -> Hiển thị link deep link mở ứng dụng
      if (!chatResult.apiSent) {
        alert('Đã khởi tạo hội thoại thành công!\nHệ thống chạy ở chế độ Đồng Hành (Interactive Helper).\nBạn hãy nhấp vào nút "Mở App Nhắn" ở góc trên hộp chat để gửi tin nhắn chào mừng đã được soạn sẵn sang app Zalo/WhatsApp của mình nhé.');
      }

    } catch (error) {
      alert('Lỗi lưu khách hàng: ' + error.message);
    }
  }
}

// Chuyển tab và mở trực tiếp hội thoại của Lead cụ thể
function openLeadInChat(leadId) {
  // Click tab chathub
  document.querySelector('.nav-btn[data-tab="chathub"]').click();
  activeChatLeadId = leadId;
  fetchLeads();
  
  const chathubContainer = document.querySelector('.chathub-container');
  if (chathubContainer) {
    chathubContainer.classList.add('chat-open');
  }
}

// ==================== HIỂN THỊ DANH SÁCH LEADS (PROGRESS) ====================

function renderLeadsProgress() {
  const container = document.getElementById('leads-list');
  const activeFilterBtn = document.querySelector('.filter-btn.active');
  const filter = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';

  // Lọc Leads theo trạng thái
  let filteredLeads = leadsList;
  if (filter !== 'all') {
    filteredLeads = leadsList.filter(l => l.status === filter);
  }

  if (filteredLeads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="users-round"></i>
        <p>Không tìm thấy khách hàng nào ở trạng thái này.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = '';
  filteredLeads.forEach(lead => {
    const card = document.createElement('div');
    card.className = `lead-card ${lead.status === 'Awaiting Booking' ? 'pulse-border' : ''}`;
    
    // Xác định Status Badge
    let statusText = 'Mới';
    let statusClass = 'new';
    if (lead.status === 'Chatting') { statusText = 'Đang nhắn AI'; statusClass = 'chatting'; }
    else if (lead.status === 'Awaiting Booking') { statusText = 'Chờ HLV chốt'; statusClass = 'awaiting'; }
    else if (lead.status === 'Booked') { statusText = 'Đã chốt'; statusClass = 'booked'; }

    // Avatar và Platform icon
    const avatarChar = lead.name ? lead.name.charAt(0).toUpperCase() : 'K';
    const platIcon = lead.platform === 'Zalo' ? 'message-circle' : 'phone-call';
    const platClass = lead.platform.toLowerCase();

    card.innerHTML = `
      <div class="lead-profile-info">
        <div class="lead-avatar-circle ${platClass}">
          ${avatarChar}
        </div>
        <div class="lead-text-meta">
          <h4>${lead.name || 'Khách hàng ẩn danh'}</h4>
          <p>
            <span class="phone-display">${formatPhoneForDisplay(lead.phone, lead.platform)}</span>
            <span class="platform-badge ${platClass}">${lead.platform}</span>
          </p>
        </div>
      </div>
      <div class="lead-actions">
        <span class="status-badge ${statusClass}">${statusText}</span>
        ${lead.status === 'New' ? `
          <button class="btn btn-tennis btn-xs" onclick="event.stopPropagation(); startChatFromButton('${lead.id}')">
            <i data-lucide="message-square-plus" style="width:14px;height:14px;"></i> Bắt đầu chat
          </button>
        ` : `
          <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation(); openLeadInChat('${lead.id}')">
            <i data-lucide="message-square" style="width:14px;height:14px;"></i> Xem chat
          </button>
        `}
        <button class="btn btn-secondary btn-xs btn-delete-lead" onclick="hideLead('${lead.id}', event)" title="Ẩn khách hàng" style="padding: 4px; color: var(--color-red); border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05);">
          <i data-lucide="x" style="width:14px;height:14px;"></i>
        </button>
        <button class="btn btn-secondary btn-xs btn-delete-lead" onclick="deleteLeadPermanently('${lead.id}', event)" title="Xóa vĩnh viễn khỏi database" style="padding: 4px; color: var(--color-text-muted); border-color: rgba(100, 100, 100, 0.2); background: rgba(100, 100, 100, 0.05);">
          <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        </button>
      </div>
    `;

    // Toàn bộ card đều có thể click để mở chat
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      if (lead.status === 'New') {
        startChatFromButton(lead.id);
      } else {
        openLeadInChat(lead.id);
      }
    });

    container.appendChild(card);
  });

  lucide.createIcons();
}

// Bắt đầu chat từ button danh sách leads
window.startChatFromButton = async function(leadId) {
  try {
    const response = await fetch('/api/leads/start-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: leadId })
    });
    const result = await response.json();
    openLeadInChat(leadId);
    if (!result.apiSent) {
      alert('Đã khởi tạo hội thoại!\nVui lòng bấm "Mở App Nhắn" ở góc trên hộp chat để gửi tin nhắn chào.');
    }
  } catch (error) {
    alert('Không thể bắt đầu chat: ' + error.message);
  }
};

// Cài đặt nút lọc danh sách leads
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderLeadsProgress();
  });
});

// ==================== CHAT HUB (SIDEBAR & WINDOW) ====================

function renderChatSidebar() {
  const container = document.getElementById('chat-list');
  
  // Chỉ hiển thị các Leads đã có hội thoại (Chatting, Awaiting Booking, Booked)
  const chatLeads = leadsList.filter(l => l.status !== 'New');

  if (chatLeads.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Chưa có hội thoại nào được bắt đầu.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  chatLeads.forEach(lead => {
    const item = document.createElement('div');
    item.className = `chat-item ${lead.id === activeChatLeadId ? 'active' : ''}`;
    
    // Màu viền hoặc nhấp nháy cho trường hợp chờ chốt lịch
    if (lead.status === 'Awaiting Booking') {
      item.style.borderLeft = '3px solid var(--color-orange)';
    }

    const avatarChar = lead.name ? lead.name.charAt(0).toUpperCase() : 'K';
    const lastMsg = lead.messages.length > 0 ? lead.messages[lead.messages.length - 1].content : 'Chưa có tin nhắn...';

    // Status icon
    let statusDot = '';
    if (lead.status === 'Awaiting Booking') {
      statusDot = `<span class="indicator-dot" style="background: var(--color-orange); box-shadow: 0 0 6px var(--color-orange); margin-left: 8px;"></span>`;
    }

    item.innerHTML = `
      <div class="chat-item-profile">
        <div class="client-avatar" style="width:34px;height:34px;font-size:0.8rem;">${avatarChar}</div>
        <div class="chat-item-meta">
          <h4>${lead.name || 'Khách hàng'}</h4>
          <p style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${lastMsg}</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="platform-badge ${lead.platform.toLowerCase()}" style="font-size:0.6rem;padding:0px 4px;">${lead.platform}</span>
        ${statusDot}
        <button class="btn-delete-chat" onclick="hideLead('${lead.id}', event)" title="Ẩn hội thoại" style="background:transparent; border:none; color:var(--color-text-muted); cursor:pointer; padding:2px; display:inline-flex; align-items:center; transition:var(--transition-smooth);">
          <i data-lucide="x" style="width:12px;height:12px;"></i>
        </button>
      </div>
    `;

    item.addEventListener('click', () => {
      activeChatLeadId = lead.id;
      // Cập nhật giao diện active
      document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      renderChatWindow(lead);

      const chathubContainer = document.querySelector('.chathub-container');
      if (chathubContainer) {
        chathubContainer.classList.add('chat-open');
      }
    });

    container.appendChild(item);
  });
}

function renderChatWindow(lead) {
  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-content').style.display = 'flex';

  // Cập nhật Header thông tin khách
  document.getElementById('chat-client-name').textContent = lead.name || 'Khách hàng ẩn danh';
  document.getElementById('chat-client-phone').textContent = formatPhoneForDisplay(lead.phone, lead.platform);
  document.getElementById('chat-avatar').textContent = lead.name ? lead.name.charAt(0).toUpperCase() : 'K';
  
  const platformTag = document.getElementById('chat-client-platform');
  platformTag.textContent = lead.platform;
  platformTag.className = `platform-tag ${lead.platform.toLowerCase()}`;

  // Nút mở link Deep Link Zalo/WhatsApp
  const deepLinkBtn = document.getElementById('btn-open-deep-link');
  let link = '';
  // Tạo nội dung tin nhắn chào hoặc tin nhắn cuối cùng để copy nhanh
  const lastMsgText = lead.messages.length > 0 ? lead.messages[lead.messages.length - 1].content : '';
  if (lead.platform === 'Zalo') {
    link = `https://zalo.me/${lead.phone.replace(/\D/g, '')}`;
  } else {
    // WhatsApp link: tìm tin nhắn gần nhất của AI (bỏ qua tin nhắn hệ thống gửi banner)
    let latestModelMsg = '';
    for (let i = lead.messages.length - 1; i >= 0; i--) {
      const msg = lead.messages[i];
      if (msg.sender === 'model' && msg.content && !msg.content.includes('[Hệ thống gửi Banner')) {
        latestModelMsg = msg.content;
        break;
      }
    }
    const textToSend = latestModelMsg || (lead.messages.length > 0 ? lead.messages[0].content : '');
    const rawDigits = lead.phone.replace(/\D/g, ''); // chỉ giữ chữ số
    link = `https://wa.me/${rawDigits}?text=${encodeURIComponent(textToSend)}`;
  }
  deepLinkBtn.href = link;

  // Toggle AI Active
  const aiToggle = document.getElementById('toggle-ai-active');
  // AI sẽ không phản hồi nếu status là Awaiting Booking hoặc Booked
  aiToggle.checked = lead.status === 'Chatting';
  
  // Vô hiệu hóa toggle nếu đã Booked
  if (lead.status === 'Booked') {
    aiToggle.disabled = true;
    document.getElementById('ai-toggle-label').textContent = 'Lịch học đã chốt:';
  } else {
    aiToggle.disabled = false;
    document.getElementById('ai-toggle-label').textContent = 'AI Tự động trả lời:';
  }

  // Banner cảnh báo Đặt lịch học (Awaiting Booking)
  const bookingBanner = document.getElementById('booking-alert-banner');
  if (lead.status === 'Awaiting Booking') {
    bookingBanner.style.display = 'flex';
  } else {
    bookingBanner.style.display = 'none';
  }

  // Hiển thị gợi ý trả lời từ AI
  const suggestedBox = document.getElementById('suggested-reply-box');
  const suggestedText = document.getElementById('suggested-reply-text');
  if (lead.suggestedReply && lead.suggestedReply.content) {
    suggestedBox.style.display = 'block';
    suggestedText.textContent = lead.suggestedReply.content;
    
    const btnUse = document.getElementById('btn-use-suggestion');
    const newBtnUse = btnUse.cloneNode(true);
    btnUse.parentNode.replaceChild(newBtnUse, btnUse);
    newBtnUse.addEventListener('click', () => {
      const hlvInput = document.getElementById('hlv-message-input');
      hlvInput.value = lead.suggestedReply.content;
      hlvInput.focus();
    });
  } else {
    suggestedBox.style.display = 'none';
  }

  // Render lịch sử hội thoại
  const messagesContainer = document.getElementById('chat-messages-container');
  messagesContainer.innerHTML = '';

  if (lead.messages.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-state">
        <p>Hội thoại trống.</p>
      </div>
    `;
    return;
  }

  lead.messages.forEach(msg => {
    const bubble = document.createElement('div');
    
    // Phân loại kiểu bong bóng tin nhắn
    if (msg.sender === 'user') {
      bubble.className = 'message-bubble incoming';
    } else if (msg.sender === 'model') {
      bubble.className = 'message-bubble outgoing';
    } else {
      bubble.className = 'message-bubble system-msg';
    }

    // Thời gian gửi
    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';

    // Xử lý tin nhắn có hình ảnh Banner
    let mediaHTML = '';
    if (msg.mediaUrl) {
      mediaHTML = `<img src="${msg.mediaUrl}" class="msg-banner-image" alt="Pricing Banner" onclick="window.open('${msg.mediaUrl}')">`;
    }

    // Xử lý bản dịch nếu có (dành cho câu hỏi tiếng nước ngoài dịch sang tiếng Việt)
    let translationHTML = '';
    if (msg.translation) {
      translationHTML = `
        <div class="message-translation" style="font-size: 0.8rem; color: var(--color-tennis); border-top: 1px dashed rgba(255,255,255,0.12); margin-top: 6px; padding-top: 4px; font-style: italic; display: flex; align-items: center; gap: 4px;">
          <i data-lucide="languages" style="width: 12px; height: 12px;"></i>
          <span>Dịch: ${msg.translation}</span>
        </div>
      `;
    }

    bubble.innerHTML = `
      <div>${msg.content}</div>
      ${translationHTML}
      ${mediaHTML}
      <span class="msg-time">${timeStr}</span>
    `;
    messagesContainer.appendChild(bubble);
  });

  // Tự động cuộn xuống dưới cùng
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

// Thiết lập gửi tin nhắn (thực tế & mô phỏng)
function setupChatHandlers() {
  const btnSendManual = document.getElementById('btn-send-manual');
  const hlvInput = document.getElementById('hlv-message-input');
  
  const btnSendSim = document.getElementById('btn-send-sim');
  const simInput = document.getElementById('sim-message-input');
  
  const aiToggle = document.getElementById('toggle-ai-active');

  // Gửi tin nhắn thủ công (HLV gửi)
  btnSendManual.addEventListener('click', sendManualMessage);
  hlvInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendManualMessage();
    }
  });

  async function sendManualMessage() {
    const content = hlvInput.value.trim();
    if (!content || !activeChatLeadId) return;

    hlvInput.value = '';

    try {
      const response = await fetch('/api/chat/send-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: activeChatLeadId, content })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      
      fetchLeads(); // Cập nhật lại khung chat
    } catch (error) {
      alert('Không thể gửi tin nhắn: ' + error.message);
    }
  }

  // Giả lập Khách nhắn (Để test phản hồi AI)
  btnSendSim.addEventListener('click', simulateClientMessage);
  simInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      simulateClientMessage();
    }
  });

  async function simulateClientMessage() {
    const content = simInput.value.trim();
    if (!content || !activeChatLeadId) return;

    simInput.value = '';

    try {
      const response = await fetch('/api/chat/simulate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: activeChatLeadId, content })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      
      // Phát âm thanh nếu chuyển trạng thái Awaiting Booking (Khách muốn đặt lịch)
      if (result.lead.status === 'Awaiting Booking' && result.replySimulated) {
        document.getElementById('notification-sound').play().catch(e => console.log('Không thể phát âm thanh:', e));
      }

      fetchLeads(); // Cập nhật lại cuộc trò chuyện
    } catch (error) {
      alert('Lỗi giả lập chat: ' + error.message);
    }
  }

  // Bật/tắt chế độ AI tự trả lời
  aiToggle.addEventListener('change', async () => {
    if (!activeChatLeadId) return;
    
    const lead = leadsList.find(l => l.id === activeChatLeadId);
    if (!lead) return;

    // Chuyển đổi trạng thái lead để bật/tắt AI
    let newStatus = aiToggle.checked ? 'Chatting' : 'Awaiting Booking';
    
    try {
      // Cập nhật trạng thái lead lên database
      const updateResponse = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...lead,
          status: newStatus
        })
      });
      
      fetchLeads();
    } catch (e) {
      console.error('Lỗi khi bật/tắt AI:', e);
    }
  });
}

// ==================== POPUP MODAL: CHỐT LỊCH HỌC ====================

function setupBookingHandlers() {
  const modal = document.getElementById('booking-modal');
  const btnClose = document.getElementById('btn-close-booking-modal');
  const btnCancel = document.getElementById('btn-cancel-booking');
  const btnTrigger = document.getElementById('btn-trigger-booking-modal');
  const form = document.getElementById('form-confirm-booking');
  
  // Mở modal từ banner chathub
  btnTrigger.addEventListener('click', () => {
    if (!activeChatLeadId) return;
    const lead = leadsList.find(l => l.id === activeChatLeadId);
    if (!lead) return;

    document.getElementById('booking-lead-id').value = lead.id;
    document.getElementById('booking-client-name').value = lead.name || 'Khách hàng ẩn danh';
    document.getElementById('booking-client-phone').value = lead.phone;
    
    // Set ngày mặc định là ngày mai
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('booking-date').value = tomorrow.toISOString().split('T')[0];
    document.getElementById('booking-time').value = "17:00"; // Giờ tập tennis phổ biến
    
    modal.classList.add('active');
  });

  // Đóng modal
  const closeModal = () => modal.classList.remove('active');
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  // Submit form chốt lịch học
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const leadId = document.getElementById('booking-lead-id').value;
    const date = document.getElementById('booking-date').value;
    const time = document.getElementById('booking-time').value;
    const durationMinutes = document.getElementById('booking-duration').value;
    const notes = document.getElementById('booking-notes').value.trim();

    document.getElementById('booking-loading').style.display = 'flex';

    try {
      const response = await fetch('/api/leads/confirm-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, date, time, durationMinutes, notes })
      });
      
      const result = await response.json();
      document.getElementById('booking-loading').style.display = 'none';

      if (!response.ok) {
        throw new Error(result.error || 'Lỗi chốt lịch');
      }

      closeModal();
      alert(`Đã chốt lịch học tennis thành công!\nSự kiện đã được tạo trên Google Calendar và đồng bộ sang CRM.`);
      
      fetchLeads(); // Reload
    } catch (error) {
      document.getElementById('booking-loading').style.display = 'none';
      alert('Không thể chốt lịch: ' + error.message);
    }
  });
}

// ==================== TRANG CÀI ĐẶT CẤU HÌNH (SETTINGS) ====================

function setupSettingsHandlers() {
  const formFaq = document.getElementById('form-settings-faq');
  const formApi = document.getElementById('form-settings-api');
  
  const btnUploadBanner = document.getElementById('btn-upload-banner');
  const bannerFileInput = document.getElementById('banner-file-input');
  
  const btnToggleGeminiKey = document.getElementById('btn-toggle-gemini-key');
  const btnToggleGroqKey = document.getElementById('btn-toggle-groq-key');

  // Toggle ẩn hiện Gemini API Key
  btnToggleGeminiKey.addEventListener('click', () => {
    const keyInput = document.getElementById('set-gemini-key');
    const eyeIcon = btnToggleGeminiKey.querySelector('i');
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      eyeIcon.setAttribute('data-lucide', 'eye-off');
    } else {
      keyInput.type = 'password';
      eyeIcon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  });

  // Toggle ẩn hiện Groq API Key
  btnToggleGroqKey.addEventListener('click', () => {
    const keyInput = document.getElementById('set-groq-key');
    const eyeIcon = btnToggleGroqKey.querySelector('i');
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      eyeIcon.setAttribute('data-lucide', 'eye-off');
    } else {
      keyInput.type = 'password';
      eyeIcon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
  });

  // Lưu thiết lập FAQ
  formFaq.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const updatedFaq = {
      coach_name: document.getElementById('set-coach-name').value.trim(),
      greeting_template: document.getElementById('set-greeting').value.trim(),
      greeting_template_en: document.getElementById('set-greeting-en').value.trim(),
      faq: {
        court_location: document.getElementById('set-faq-location').value.trim(),
        lesson_duration: document.getElementById('set-faq-duration').value.trim(),
        teaching_levels: document.getElementById('set-faq-levels').value.trim(),
        coach_experience: document.getElementById('set-faq-experience').value.trim(),
        general_intro: document.getElementById('set-faq-intro').value.trim()
      },
      pricing_details: document.getElementById('set-pricing-details').value.trim(),
      pricing_details_vi: document.getElementById('set-pricing-details-vi').value.trim()
    };

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFaq)
      });
      
      if (response.ok) {
        alert('Đã lưu các cài đặt thông tin FAQ & Huấn luyện viên thành công!');
        fetchConfig();
      } else {
        throw new Error('Lỗi từ server');
      }
    } catch (error) {
      alert('Không thể lưu cài đặt FAQ: ' + error.message);
    }
  });

  // Lưu thiết lập kết nối API
  formApi.addEventListener('submit', async (e) => {
    e.preventDefault();

    const updatedApi = {
      gemini_api_key: document.getElementById('set-gemini-key').value.trim(),
      groq_api_key: document.getElementById('set-groq-key').value.trim(),
      google_sheets_id: document.getElementById('set-google-sheets-id').value.trim(),
      google_calendar_id: document.getElementById('set-google-calendar-id').value.trim(),
      discord_webhook_url: document.getElementById('set-discord-webhook').value.trim(),
      google_credentials: {
        client_email: document.getElementById('set-google-email').value.trim(),
        private_key: document.getElementById('set-google-key').value.trim()
      }
    };

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedApi)
      });

      if (response.ok) {
        alert('Đã cập nhật cấu hình API & kết nối Google thành công!');
        fetchConfig();
      } else {
        throw new Error('Lỗi từ server');
      }
    } catch (error) {
      alert('Không thể lưu cài đặt API: ' + error.message);
    }
  });

  // Tải ảnh Banner Báo giá mới lên (tiếng Anh / quốc tế)
  btnUploadBanner.addEventListener('click', () => {
    bannerFileInput.click();
  });

  bannerFileInput.addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('banner', file);
    try {
      const response = await fetch('/api/config/upload-banner', { method: 'POST', body: formData });
      const data = await response.json();
      if (response.ok) {
        alert('Đã tải lên Banner tiếng Anh thành công!');
        fetchConfig();
      } else throw new Error(data.error || 'Lỗi tải ảnh');
    } catch (error) {
      alert('Không thể tải ảnh banner: ' + error.message);
    }
  });

  // Tải ảnh Banner Báo giá tiếng Việt
  const btnUploadBannerVi = document.getElementById('btn-upload-banner-vi');
  const bannerFileInputVi = document.getElementById('banner-file-input-vi');

  btnUploadBannerVi.addEventListener('click', () => {
    bannerFileInputVi.click();
  });

  bannerFileInputVi.addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('banner', file);
    try {
      const response = await fetch('/api/config/upload-banner-vi', { method: 'POST', body: formData });
      const data = await response.json();
      if (response.ok) {
        alert('Đã tải lên Banner Tiếng Việt thành công!');
        fetchConfig();
      } else throw new Error(data.error || 'Lỗi tải ảnh');
    } catch (error) {
      alert('Không thể tải ảnh banner tiếng Việt: ' + error.message);
    }
  });
}

// ==================== QUẢN LÝ ẨN/HIỆN LEADS (SOFT-DELETE) ====================

window.hideLead = function(leadId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  
  if (confirm('Bạn có chắc chắn muốn ẩn khách hàng này khỏi giao diện không? (Dữ liệu vẫn được lưu trữ ở database)')) {
    if (!hiddenLeads.includes(leadId)) {
      hiddenLeads.push(leadId);
      localStorage.setItem('hiddenLeads', JSON.stringify(hiddenLeads));
      fetchLeads();
    }
  }
};

window.restoreHiddenLeads = function() {
  if (hiddenLeads.length === 0) {
    alert('Không có khách hàng nào đang bị ẩn.');
    return;
  }
  
  if (confirm('Bạn có chắc chắn muốn khôi phục hiển thị cho tất cả khách hàng đã ẩn không?')) {
    hiddenLeads = [];
    localStorage.removeItem('hiddenLeads');
    fetchLeads();
    alert('Đã khôi phục tất cả khách hàng thành công!');
  }
};

window.deleteLeadPermanently = async function(leadId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  if (!confirm('Bạn có chắc chắc muốn XÓA VĨNH VIỄN khách hàng này khỏi database không?\n\n⚠️ Hành động này KHÔNG THỂ hoàn tác! Toàn bộ lịch sử nhắn tin sẽ bị xóa.')) return;

  try {
    const response = await fetch(`/api/leads/${leadId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Lỗi khi xóa');
    }

    // Nếu lead đang được chọn trong chat, reset khung chat
    if (activeChatLeadId === leadId) {
      activeChatLeadId = null;
      document.getElementById('chat-placeholder').style.display = 'flex';
      document.getElementById('chat-content').style.display = 'none';
    }

    // Xóa khỏi danh sách ẩn nếu có
    hiddenLeads = hiddenLeads.filter(id => id !== leadId);
    localStorage.setItem('hiddenLeads', JSON.stringify(hiddenLeads));

    fetchLeads();
  } catch (error) {
    alert('Không thể xóa: ' + error.message);
  }
};

// ==================== REAL-TIME WEBSOCKETS (SOCKET.IO) ====================
function setupSocketConnection() {
  if (typeof io === 'undefined') {
    console.warn('[Socket.io] Thư viện io chưa được tải.');
    return;
  }

  const socket = io();

  socket.on('connect', () => {
    console.log('[Socket.io] Đã kết nối thành công với server thời gian thực.');
  });

  socket.on('lead_update', (updatedLead) => {
    console.log('[Socket.io] Nhận tín hiệu cập nhật khách hàng:', updatedLead);
    if (!updatedLead) return;

    // Tìm xem lead có tồn tại trong danh sách hiện tại không
    const idx = leadsList.findIndex(l => l.id === updatedLead.id);
    
    // Kiểm tra xem tin nhắn cuối cùng có phải là tin mới đến từ khách hàng không
    let isNewIncomingMessage = false;
    if (updatedLead.messages && updatedLead.messages.length > 0) {
      const lastMsg = updatedLead.messages[updatedLead.messages.length - 1];
      const oldLead = idx !== -1 ? leadsList[idx] : null;
      const oldLastMsg = oldLead && oldLead.messages && oldLead.messages.length > 0
        ? oldLead.messages[oldLead.messages.length - 1]
        : null;

      // Nếu tin nhắn mới nhất là từ 'user' và khác tin nhắn cũ của khách
      if (lastMsg.sender === 'user' && (!oldLastMsg || oldLastMsg.id !== lastMsg.id)) {
        isNewIncomingMessage = true;
      }
    }

    if (idx !== -1) {
      // Cập nhật thông tin khách hàng cũ
      leadsList[idx] = updatedLead;
    } else {
      // Thêm mới nếu chưa có và không bị ẩn mềm
      if (!hiddenLeads.includes(updatedLead.id)) {
        leadsList.unshift(updatedLead);
      }
    }

    // Tải lại các số liệu thống kê & Sidebar
    renderLeadsProgress();
    renderChatSidebar();
    updateMetrics();

    // Nếu đang mở chat đúng khách hàng này, re-render khung chat
    if (activeChatLeadId === updatedLead.id) {
      renderChatWindow(updatedLead);
    }

    // Nếu là tin nhắn mới từ khách, phát âm thanh thông báo và thay đổi title
    if (isNewIncomingMessage) {
      playNotificationSound();
      flashTitleNotification(updatedLead.name || 'Khách hàng');
    }
  });

  socket.on('lead_delete', (deletedLeadId) => {
    console.log('[Socket.io] Nhận tín hiệu xóa khách hàng:', deletedLeadId);
    leadsList = leadsList.filter(l => l.id !== deletedLeadId);

    renderLeadsProgress();
    renderChatSidebar();
    updateMetrics();

    if (activeChatLeadId === deletedLeadId) {
      activeChatLeadId = null;
      document.getElementById('chat-placeholder').style.display = 'flex';
      document.getElementById('chat-content').style.display = 'none';
    }
  });
}

function playNotificationSound() {
  const audio = document.getElementById('notification-sound');
  if (audio) {
    audio.currentTime = 0;
    // Chạy play() trong một tương tác người dùng hoặc bắt lỗi autoplay policy của trình duyệt
    audio.play().catch(e => console.warn('[Socket.io] Autoplay bị chặn bởi trình duyệt, cần click tương tác trước:', e));
  }
}

let flashInterval = null;
function flashTitleNotification(senderName) {
  const originalTitle = document.title;
  if (flashInterval) clearInterval(flashInterval);
  
  let showAlt = true;
  flashInterval = setInterval(() => {
    document.title = showAlt ? `💬 Tin nhắn từ ${senderName}` : originalTitle;
    showAlt = !showAlt;
  }, 1000);

  // Dừng nhấp nháy khi người dùng click chuột vào cửa sổ trình duyệt
  const stopFlash = () => {
    clearInterval(flashInterval);
    document.title = originalTitle;
    window.removeEventListener('focus', stopFlash);
    window.removeEventListener('click', stopFlash);
  };
  window.addEventListener('focus', stopFlash);
  window.addEventListener('click', stopFlash);
}
