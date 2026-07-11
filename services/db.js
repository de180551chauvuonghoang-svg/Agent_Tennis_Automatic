const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const dbPath = path.join(__dirname, '..', 'database.json');
const configPath = path.join(__dirname, '..', 'config.json');

// Đọc cấu hình hệ thống
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

// Khởi tạo Supabase Client
let supabase = null;
function getSupabaseClient() {
  const config = readConfig();
  if (config.supabase_url && config.supabase_key) {
    if (!supabase || supabase.supabaseUrl !== config.supabase_url) {
      supabase = createClient(config.supabase_url, config.supabase_key);
    }
    return supabase;
  }
  return null;
}

// ==================== CƠ CHẾ DỰ PHÒNG JSON FILE CỤC BỘ ====================
function readLocalDB() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (error) {
    return { leads: [] };
  }
}

function writeLocalDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

// ==================== CÁC HÀM XỬ LÝ DỮ LIỆU CHUẨN ====================

/**
 * Lấy toàn bộ danh sách Leads kèm lịch sử tin nhắn
 * Sắp xếp theo thứ tự lead mới nhất ở đầu
 */
async function getLeads() {
  const client = getSupabaseClient();
  if (!client) {
    const local = readLocalDB();
    return local.leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  try {
    const { data, error } = await client
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
        messages: (lead.messages || []).map(m => ({
          id: m.id,
          sender: m.sender,
          content: m.content,
          translation: m.translation,
          mediaUrl: m.media_url,
          timestamp: m.timestamp
        }))
      };
      
      // Sắp xếp tin nhắn của học viên từ cũ đến mới (chronological)
      formattedLead.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      return formattedLead;
    });
  } catch (error) {
    console.error('[Supabase] getLeads lỗi, chuyển sang fallback local:', error.message);
    const local = readLocalDB();
    return local.leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

/**
 * Thêm mới khách hàng (Lead)
 */
async function createLead(leadData) {
  const client = getSupabaseClient();
  if (!client) {
    const local = readLocalDB();
    const existing = local.leads.find(l => l.phone === leadData.phone);
    if (existing) {
      throw new Error('Số điện thoại đã tồn tại trong hệ thống');
    }
    const newLead = {
      ...leadData,
      id: leadData.id || 'lead_' + Date.now(),
      status: leadData.status || 'New',
      messages: leadData.messages || [],
      createdAt: leadData.createdAt || new Date().toISOString()
    };
    local.leads.unshift(newLead);
    writeLocalDB(local);
    return newLead;
  }

  try {
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
      created_at: leadData.createdAt || new Date().toISOString()
    };

    const { error } = await client
      .from('leads')
      .insert([newLead]);

    if (error) {
      if (error.code === '23505') { // Lỗi trùng UNIQUE constraint (phone)
        throw new Error('Số điện thoại đã tồn tại trong hệ thống');
      }
      throw error;
    }

    return {
      ...leadData,
      id: newLead.id,
      status: newLead.status,
      messages: [],
      createdAt: newLead.created_at
    };
  } catch (error) {
    console.error('[Supabase] createLead lỗi:', error.message);
    throw error;
  }
}

/**
 * Cập nhật thông tin khách hàng (Lead)
 */
async function updateLead(leadId, updates) {
  const client = getSupabaseClient();
  if (!client) {
    const local = readLocalDB();
    const idx = local.leads.findIndex(l => l.id === leadId);
    if (idx === -1) throw new Error('Không tìm thấy khách hàng');
    
    local.leads[idx] = {
      ...local.leads[idx],
      ...updates
    };
    writeLocalDB(local);
    return local.leads[idx];
  }

  try {
    const mappedUpdates = {};
    if (updates.status !== undefined) mappedUpdates.status = updates.status;
    if (updates.language !== undefined) mappedUpdates.language = updates.language;
    if (updates.bookingDetails !== undefined) mappedUpdates.booking_details = updates.bookingDetails;
    if (updates.name !== undefined) mappedUpdates.name = updates.name;
    if (updates.notes !== undefined) mappedUpdates.notes = updates.notes;
    if (updates.platform !== undefined) mappedUpdates.platform = updates.platform;

    const { data, error } = await client
      .from('leads')
      .update(mappedUpdates)
      .eq('id', leadId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Không tìm thấy khách hàng');
    return data[0];
  } catch (error) {
    console.error('[Supabase] updateLead lỗi:', error.message);
    throw error;
  }
}

/**
 * Xóa vĩnh viễn khách hàng
 */
async function deleteLead(leadId) {
  const client = getSupabaseClient();
  if (!client) {
    const local = readLocalDB();
    const initialLength = local.leads.length;
    local.leads = local.leads.filter(l => l.id !== leadId);
    if (local.leads.length === initialLength) {
      throw new Error('Không tìm thấy khách hàng');
    }
    writeLocalDB(local);
    return true;
  }

  try {
    const { error } = await client
      .from('leads')
      .delete()
      .eq('id', leadId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[Supabase] deleteLead lỗi:', error.message);
    throw error;
  }
}

/**
 * Thêm tin nhắn mới vào cuộc hội thoại
 */
async function addMessage(leadId, message) {
  const client = getSupabaseClient();
  if (!client) {
    const local = readLocalDB();
    const idx = local.leads.findIndex(l => l.id === leadId);
    if (idx === -1) throw new Error('Không tìm thấy khách hàng');
    
    const newMsg = {
      id: message.id || 'msg_' + Date.now(),
      sender: message.sender,
      content: message.content,
      translation: message.translation || null,
      mediaUrl: message.mediaUrl || null,
      timestamp: message.timestamp || new Date().toISOString()
    };
    
    local.leads[idx].messages.push(newMsg);
    writeLocalDB(local);
    return newMsg;
  }

  try {
    const newMsg = {
      id: message.id || 'msg_' + Date.now(),
      lead_id: leadId,
      sender: message.sender,
      content: message.content,
      translation: message.translation || null,
      media_url: message.mediaUrl || null,
      timestamp: message.timestamp || new Date().toISOString()
    };

    const { error } = await client
      .from('messages')
      .insert([newMsg]);

    if (error) throw error;
    return newMsg;
  } catch (error) {
    console.error('[Supabase] addMessage lỗi:', error.message);
    throw error;
  }
}

module.exports = {
  getLeads,
  createLead,
  updateLead,
  deleteLead,
  addMessage
};
