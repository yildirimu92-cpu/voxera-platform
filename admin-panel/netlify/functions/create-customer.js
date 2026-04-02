import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  try {
    const { email, customer_name, tel_nr, voxera_number, plan } = JSON.parse(event.body);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Auth User erstellen
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true
    });

    if (authError) throw authError;

    const userId = authUser.user.id;

    // 2. Customer erstellen
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert([
        {
          id: userId,
          customer_name,
          tel_nr,
          voxera_number,
          plan,
          email,
          status: 'active'
        }
      ])
      .select()
      .single();

    if (customerError) {
      // rollback user
      await supabase.auth.admin.deleteUser(userId);
      throw customerError;
    }

    // 3. public.users erstellen
    const { error: userError } = await supabase
      .from('users')
      .insert([
        {
          id: userId,
          email,
          customer_id: customer.id,
          role: 'customer',
          is_admin: false
        }
      ]);

    if (userError) {
      await supabase.auth.admin.deleteUser(userId);
      throw userError;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
