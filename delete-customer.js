// Assuming you have access to the necessary modules and functions

async function deleteCustomer(customerId) {
    try {
        // Step 1: Delete contracts for the customer
        await deleteContracts(customerId);

        // Step 2: Clear the subscription_id FK
        await clearSubscriptionId(customerId);

        // Step 3: Delete subscriptions for the customer
        await deleteSubscriptions(customerId);

    } catch (error) {
        console.error('Error deleting customer:', error);
        throw error;
    }
}

async function deleteContracts(customerId) {
    // Logic for deleting contracts
}

async function clearSubscriptionId(customerId) {
    // Logic for clearing subscription_id FK
}

async function deleteSubscriptions(customerId) {
    // Logic for deleting subscriptions
}