// tmp/test-webhook.js
import { POST } from "../app/api/webhook/gmail/route.js";

async function test() {
    const payload = {
        message: {
            data: Buffer.from(JSON.stringify({ 
                emailAddress: "servicehub000@gmail.com", 
                historyId: "12345678" 
            })).toString('base64'),
            messageId: "message-id-123",
            publishTime: new Date().toISOString()
        },
        subscription: "projects/my-project/subscriptions/my-sub"
    };

    const mockRequest = {
        json: async () => payload
    };

    try {
        console.log("Sending mock webhook payload...");
        const response = await POST(mockRequest);
        const json = await response.json();
        console.log("Response status:", response.status);
        console.log("Response data:", json);
    } catch (e) {
        console.error("Test failed:", e);
    }
}

test();
