import { Client, Databases, ID } from "appwrite";

export default async ({ req, res, log, error }) => {
  log("FUNCTION HIT - Method: " + req.method);

  // --- 1. HANDLE META VERIFICATION (GET) ---
  if (req.method === 'GET') {
    const query = req.query;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];


    const MY_VERIFY_TOKEN = process.env.My_Verify_Token; 

    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
      log("Webhook Verified by Meta!");
      return res.text(challenge, 200); // Return ONLY the challenge string
    } else {
      error("Verification failed. Token mismatch.");
      return res.text("Forbidden", 403);
    }
  }

  // --- 2. HANDLE INCOMING MESSAGES (POST) ---
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      log("No WhatsApp message found in payload");
      return res.json({ status: "ignored" });
    }

    const from = message.from;
    const userText = message.text?.body?.toLowerCase() || "";
    log(`Incoming from ${from}: ${userText}`);

    // Init Appwrite
    const client = new Client()
      .setEndpoint("https://cloud.appwrite.io/v1")
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const db = new Databases(client);

    // FAQ Search Logic
    const faqResponse = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FAQ_COLLECTION_ID
    );

    let replyText = "Sorry, I don't have an answer yet. Contact admin. 09035449227";
    let foundInFaq = false;

    for (const faq of faqResponse.documents) {
      if (userText.includes(faq.question.toLowerCase()) || (faq.keywords && faq.keywords.toLowerCase().includes(userText))) {
        replyText = faq.answer;
        foundInFaq = true;
        break;
      }
    }

    // Save to Interactions
    await db.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_INTERACTIONS_COLLECTION_ID,
      ID.unique(),
      {
        user_number: from,
        message: userText,
        reply: replyText,
        found_in_faq: foundInFaq,
        created_at: new Date().toISOString()
      }
    );

    // Send WhatsApp Reply
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText }
        })
      });
    }

    return res.json({ status: "success" });

  } catch (err) {
    error("FUNCTION ERROR: " + err.message);
    return res.json({ status: "error", message: err.message }, 500);
  }
};
