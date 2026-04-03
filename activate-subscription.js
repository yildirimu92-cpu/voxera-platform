// Check if the customer status was 'pending' before activation
if (customer.status === 'pending') {
    // Trigger send-welcome only for first activation
    fetch('/send-welcome')
        .then(response => response.json())
        .then(data => console.log('Welcome email sent:', data))
        .catch(error => console.error('Error sending welcome email:', error));
} else {
    // Skip send-welcome call for re-activation
    console.log('Re-activation detected; skipping welcome email.');
}