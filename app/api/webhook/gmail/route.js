import { syncOnce } from "@/lib/sync";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request) {
    try {
        const body = await request.json();
        const message = body?.message;
        
        if (message && message.data) {
            const dataBuffer = Buffer.from(message.data, 'base64');
            const dataStr = dataBuffer.toString('utf-8');
            const data = JSON.parse(dataStr);
            
            logger.debug({ historyId: data.historyId, email: data.emailAddress }, "[WEBHOOK] Received push notification");
            
            // Trigger sync using the incoming historyId for efficient incremental sync
            syncOnce(data.historyId).catch(err => logger.error({ err }, "[WEBHOOK] Error triggering syncOnce from webhook"));
            
            return Response.json({ success: true, historyId: data.historyId });
        }
        
        return Response.json({ error: "Invalid payload" }, { status: 400 });
    } catch (error) {
        logger.error({ err: error }, "[WEBHOOK] Error processing webhook");
        return Response.json({ error: "Internal server error" }, { status: 500 });
    }
}
