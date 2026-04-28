const { createClient } = require('@supabase/supabase-js');

class SupabaseStorage {
  constructor() {
    this._client = null;
    this._initialized = false;
  }

  _init() {
    if (this._initialized) return;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (url && key) {
      this._client = createClient(url, key);
      this._initialized = true;
    }
  }

  isAvailable() {
    this._init();
    return !!this._client;
  }

  // Save any vertical's enquiry/booking/lead into the enquiries table
  async saveEnquiry({ vertical, phone_number, status, data, reference_id, customer_id }) {
    this._init();
    if (!this._client) return { success: false, error: 'Supabase not configured' };

    const payload = {
      vertical,
      phone_number,
      status: status || 'new',
      data: data || {},
      reference_id: reference_id || null,
      customer_id: customer_id || null,
    };

    const { data: result, error } = await this._client
      .from('enquiries')
      .insert(payload)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: result };
  }

  async getEnquiry(id) {
    this._init();
    if (!this._client) return null;

    const { data, error } = await this._client
      .from('enquiries')
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data;
  }

  async listEnquiries(filters = {}) {
    this._init();
    if (!this._client) return [];

    let query = this._client.from('enquiries').select('*');

    if (filters.vertical) query = query.eq('vertical', filters.vertical);
    if (filters.phone_number) query = query.eq('phone_number', filters.phone_number);
    if (filters.status) query = query.eq('status', filters.status);

    query = query.order('created_at', { ascending: false });

    if (filters.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) return [];
    return data || [];
  }

  async updateEnquiryStatus(id, newStatus) {
    this._init();
    if (!this._client) return { success: false, error: 'Supabase not configured' };

    const { data, error } = await this._client
      .from('enquiries')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  }

  async getEnquiryStats() {
    this._init();
    if (!this._client) return {};

    const { data, error } = await this._client
      .from('enquiries')
      .select('vertical, status');

    if (error) return {};

    const stats = { total: data.length, byVertical: {}, byStatus: {} };
    for (const row of data) {
      stats.byVertical[row.vertical] = (stats.byVertical[row.vertical] || 0) + 1;
      stats.byStatus[row.status] = (stats.byStatus[row.status] || 0) + 1;
    }
    return stats;
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------

  async upsertCustomer({ phone_number, name, vertical }) {
    this._init();
    if (!this._client) return { success: false, error: 'Supabase not configured' };

    // Check if customer exists
    const { data: existing } = await this._client
      .from('customers')
      .select('id, total_enquiries, profile_data')
      .eq('phone_number', phone_number)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      // Update existing
      const { data, error } = await this._client
        .from('customers')
        .update({
          name: name || undefined,
          total_enquiries: existing.total_enquiries + 1,
          last_vertical: vertical,
          last_enquiry_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, data, created: false };
    } else {
      // Create new
      const { data, error } = await this._client
        .from('customers')
        .insert({
          phone_number,
          name: name || null,
          total_enquiries: 1,
          last_vertical: vertical,
          last_enquiry_at: now,
        })
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, data, created: true };
    }
  }

  async getCustomer(phoneNumber) {
    this._init();
    if (!this._client) return null;

    const { data, error } = await this._client
      .from('customers')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();

    if (error) return null;
    return data;
  }

  async listCustomers(filters = {}) {
    this._init();
    if (!this._client) return [];

    let query = this._client.from('customers').select('*');

    if (filters.vertical) query = query.eq('last_vertical', filters.vertical);
    query = query.order('last_enquiry_at', { ascending: false });
    if (filters.limit) query = query.limit(filters.limit);

    const { data, error } = await query;
    if (error) return [];
    return data || [];
  }
}

module.exports = new SupabaseStorage();
