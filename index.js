import { Client, Databases, ID, Query } from "node-appwrite";

export default async (context) => {
  const { req, res, log, error } = context;

  // 1. WhatsApp Webhook Verification (Meta setup)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      log("Webhook Verified Successfully");
      return res.text(challenge);
    }
    return res.text("Verification failed", 403);
  }

  // 2. Main Logic for Incoming Messages
  log("FUNCTION HIT: Processing message...");

  try {
    // Parse payload safely
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      log("Payload received but no message found.");
      return res.json({ status: "ignored" });
    }

    const from = message.from;
    const userText = (message.text?.body || "").toLowerCase().trim();
    log(`Message from ${from}: "${userText}"`);

    // 3. Initialize Server SDK
    const client = new Client()
      .setEndpoint("https://cloud.appwrite.io/v1")
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY); // .setKey is used in node-appwrite

    const db = new Databases(client);

    // 4. Search FAQ Collection
    const faqResponse = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FAQ_COLLECTION_ID,
      [Query.limit(1000)]
    );

    let replyText = "Sorry, I don't have an answer for that yet. Type 'help' to contact us.";
    let foundInFaq = false;

    for (const faq of faqResponse.documents) {
      const question = (faq.question || "").toLowerCase();
      const keywords = (faq.keywords || "").toLowerCase();

      if (question.includes(userText) || keywords.includes(userText) || userText.includes(question)) {
        replyText = faq.answer;
        foundInFaq = true;
        break;
      }
    }

    // 5. Always Log to Interactions Collection
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

    // 6. Send Meta Reply (only if credentials exist)
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      log("Sending response to Meta API...");
      const waUrl = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      
      const response = await fetch(waUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText }
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        error("Meta API Error: " + JSON.stringify(errData));
      }
    } else {
      log("Meta credentials not set; skipping WhatsApp send.");
    }

    return res.json({ status: "success", reply: replyText });

  } catch (err) {
    error("Fatal Function Error: " + err.message);
    return res.json({ status: "error", message: err.message }, 500);
  }
};
