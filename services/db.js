const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://gpytrbppvznoxldsptea.supabase.co";
const supabaseKey = "sb_publishable_gOArZ6lNcr62dbgBmXvKqg_ytGT_ztY";

const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== DB SERVICE METHODS ====================

/**
 * Lấy toàn bộ danh sách Leads kèm lịch sử tin nhắn
 */
async function getLeads() {
  const { data, error } = await supabase
    .from('leads')
    .select('*, messages(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map(lead => {
    const formattedLead = {
      id: lead.id,
      phone: lead.phone,
      countryCode: lead.country_code,
      phoneBody: lead.phone_body,
      name: lead.name,
      notes: lead.notes,
      platform: lead.platform,
      screenshotPath: lead.screenshot_path,
      status: lead.status,
      language: lead.language,
      bookingDetails: lead.booking_details,
      createdAt: lead.created_at,
      suggestedReply: lead.suggested_reply, // Lưu câu trả lời gợi ý trực tiếp trong Supabase
      messages: (lead.messages || []).map(m => ({
        id: m.id,
        sender: m.sender,
        content: m.content,
        translation: m.translation,
        mediaUrl: m.media_url,
        timestamp: m.timestamp
      }))
    };
    
    // Sắp xếp tin nhắn theo thời gian tăng dần
    formattedLead.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return formattedLead;
  });
}

/**
 * Thêm mới hoặc cập nhật một Lead (sử dụng upsert để tránh trùng lặp)
 */
async function createLead(leadData) {
  const newLead = {
    id: leadData.id || 'lead_' + Date.now(),
    phone: leadData.phone,
    country_code: leadData.countryCode || '',
    phone_body: leadData.phoneBody || '',
    name: leadData.name || '',
    notes: leadData.notes || '',
    platform: leadData.platform || 'Zalo',
    screenshot_path: leadData.screenshotPath || '',
    status: leadData.status || 'New',
    language: leadData.language || 'vi',
    booking_details: leadData.bookingDetails || null,
    suggested_reply: leadData.suggestedReply || null,
    created_at: leadData.createdAt || new Date().toISOString()
  };

  const { error } = await supabase
    .from('leads')
    .upsert([newLead], { onConflict: 'phone' });

  if (error) throw error;

  return {
    ...leadData,
    id: newLead.id,
    status: newLead.status,
    messages: leadData.messages || [],
    createdAt: newLead.created_at
  };
}

/**
 * Cập nhật thông tin khách hàng (Lead)
 */
async function updateLead(leadId, updates) {
  const mappedUpdates = {};
  if (updates.status !== undefined) mappedUpdates.status = updates.status;
  if (updates.language !== undefined) mappedUpdates.language = updates.language;
  if (updates.bookingDetails !== undefined) mappedUpdates.booking_details = updates.bookingDetails;
  if (updates.name !== undefined) mappedUpdates.name = updates.name;
  if (updates.notes !== undefined) mappedUpdates.notes = updates.notes;
  if (updates.platform !== undefined) mappedUpdates.platform = updates.platform;
  if (updates.suggestedReply !== undefined) mappedUpdates.suggested_reply = updates.suggestedReply;

  const { data, error } = await supabase
    .from('leads')
    .update(mappedUpdates)
    .eq('id', leadId)
    .select();

  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Không tìm thấy khách hàng');
  return data[0];
}

/**
 * Xóa vĩnh viễn khách hàng
 */
async function deleteLead(leadId) {
  const { error } = await supabase
    .from('leads')
    .delete()
    .eq('id', leadId);

  if (error) throw error;
  return true;
}

/**
 * Thêm tin nhắn mới vào cuộc hội thoại
 */
async function addMessage(leadId, message) {
  const newMsg = {
    id: message.id || 'msg_' + Date.now(),
    lead_id: leadId,
    sender: message.sender,
    content: message.content,
    translation: message.translation || null,
    media_url: message.mediaUrl || null,
    timestamp: message.timestamp || new Date().toISOString()
  };

  const { error } = await supabase
    .from('messages')
    .insert([newMsg]);

  if (error) throw error;
  return newMsg;
}

module.exports = {
  getLeads,
  createLead,
  updateLead,
  deleteLead,
  addMessage
};
