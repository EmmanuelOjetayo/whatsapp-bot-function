import fetch from "node-fetch";
import { Client, Databases, Query, ID } from "appwrite";

export default async ({ req, res, log, error }) => {
  try {
    // 1️⃣ Parse WhatsApp webhook payload
    const body = JSON.parse(req.bodyRaw || "{}");
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.json({ status: "no message received" });
    }

    const from = message.from; // user phone number
    const userText = message.text?.body?.toLowerCase();
    log(`Message from ${from}: ${userText}`);

    // 2️⃣ Initialize Appwrite client
    const client = new Client()
      .setEndpoint("https://fra.cloud.appwrite.io/v1")
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const db = new Databases(client);

    // 3️⃣ Search FAQ collection for exact match
    const faqResult = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FAQ_COLLECTION_ID,
      [Query.search("question", userText), Query.limit(1)]
    );

    let replyText = "";
    let foundInFaq = faqResult.total > 0;

    if (foundInFaq) {
      // Direct answer from FAQ
      replyText = faqResult.documents[0].answer;
    } else {
      // Fallback reply if no FAQ found
      replyText = "Sorry, I don't know the answer yet. Please DM the admin or wait.";
    }

    // 4️⃣ Log all interactions
    await db.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_INTERACTIONS_COLLECTION_ID,
      ID.unique(),
      {
        user_number: from,
        message: userText,
        reply: replyText,
        timestamp: new Date().toISOString(),
        found_in_faq: foundInFaq
      }
    );

    // 5️⃣ Send reply back to WhatsApp
    await fetch(
      `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
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
      }
    );

    return res.json({ status: "success", reply: replyText });

  } catch (err) {
    error(err.message);
    return res.json({ status: "error", message: err.message }, 500);
  }
};
