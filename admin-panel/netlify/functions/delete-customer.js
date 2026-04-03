// existing code lines before deletion of contracts...

// After contracts are deleted (line 91)

// 1.5. subscription_id references in customers löschen (FK-Constraint auflösen)
const { error: clearSubsRefErr } = await sbAdmin
  .from('customers')
  .update({ subscription_id: null })
  .eq('id', customer_id);

if (clearSubsRefErr) throw new Error('subscription_id Referenzen löschen fehlgeschlagen: ' + clearSubsRefErr.message);
console.log(`[delete-customer] ✅ subscription_id Referenzen gelöscht`);
steps_completed.push('clear_subscription_refs');

// Continue with the rest of the file structure...

// existing code lines after clearing subscription_id and before deleting subscriptions...