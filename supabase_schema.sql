-- 1. Bảng lưu trữ thông tin học viên (leads)
CREATE TABLE leads (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    country_code TEXT,
    phone_body TEXT,
    name TEXT,
    notes TEXT,
    platform TEXT NOT NULL,
    screenshot_path TEXT,
    status TEXT NOT NULL DEFAULT 'New',
    language TEXT DEFAULT 'vi',
    booking_details JSONB,
    suggested_reply JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Bảng lưu trữ lịch sử tin nhắn (messages)
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sender TEXT NOT NULL, -- 'user', 'model', 'system'
    content TEXT NOT NULL,
    translation TEXT,
    media_url TEXT,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- 3. Chỉ mục (index) giúp tăng tốc độ truy vấn
CREATE INDEX idx_messages_lead_id ON messages(lead_id);

-- 4. Tắt Row-Level Security (RLS) để Anon Key có thể truy cập đọc/ghi trực tiếp
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
