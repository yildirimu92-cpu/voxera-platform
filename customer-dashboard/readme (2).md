# voxera-dashboard

Voxera AI Phone Assistant Dashboard.

## Security setup

This dashboard reads and writes data directly via Supabase (RLS protected) and no longer uses Airtable.


### Frontend key configuration

Set values in `index.html` (or inject globally before app init):

- `window.VOXERA_SUPABASE_URL`
- `window.VOXERA_SUPABASE_ANON_KEY`

Both values must belong to the same Supabase project.

If you see `Unregistered API key`:
1. rotate/copy the latest **Anon Public Key** in Supabase,
2. verify URL + key are from the same project,
3. trigger a Netlify deploy,
4. hard-reload the browser (`Ctrl/Cmd+Shift+R`).

### Dashboard vs. Admin panel

The dashboard does **not** read data from the admin frontend directly.  
Both apps must point to the **same Supabase project** and tables (`customers`, `call_logs`).
If Admin and Dashboard are configured against different Supabase projects, data will not match.
