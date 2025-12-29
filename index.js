import { Client, Databases, ID } from "appwrite";

export default async (context) => {
  const { req, res, log, error } = context;

  // 1. WhatsApp Webhook Verification (GET Request)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      log("Webhook Verified!");
      return res.text(challenge);
    }
    return res.text("Verification failed", 403);
  }

  // 2. Handle Incoming Messages (POST Request)
  log("FUNCTION HIT");

  try {
    // Appwrite sometimes parses req.body automatically. 
    // If it's already an object, use it; otherwise, parse it.
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      log("No WhatsApp message found in payload.");
      return res.json({ status: "ignored" });
    }

    const from = message.from;
    const userText = (message.text?.body || "").toLowerCase().trim();

    // 3. Init Appwrite
    const client = new Client()
      .setEndpoint("https://cloud.appwrite.io/v1")
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setApiKey(process.env.APPWRITE_API_KEY);

    const db = new Databases(client);

    // 4. Load FAQs
    const faqResponse = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FAQ_COLLECTION_ID
    );

    let replyText = "Sorry, I don’t have an answer yet.";
    let foundInFaq = false;

    for (const faq of faqResponse.documents) {
      const questionText = (faq.question || "").toLowerCase();
      if (questionText.includes(userText) || userText.includes(questionText)) {
        replyText = faq.answer;
        foundInFaq = true;
        break;
      }
    }

    // 5. Log interaction
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

    // 6. Conditional Meta Send
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      await fetch(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
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
        }
      );
    }

    return res.json({ status: "success", reply: replyText });

  } catch (err) {
    error("Error: " + err.message);
    return res.json({ status: "error", error: err.message }, 500);
  }
};
