import fetch from "node-fetch";
import { Client, Databases, ID } from "appwrite";

export default async ({ req, res, log, error }) => {
  log("FUNCTION HIT");

  try {
    // 1. Parse webhook payload safely
    const body = JSON.parse(req.bodyRaw || "{}");
    const message =
      body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      log("No WhatsApp message found in payload");
      return res.json({ status: "ignored" });
    }

    const from = message.from;
    const userText = message.text?.body?.toLowerCase() || "";

    log(`Incoming message from ${from}: ${userText}`);

    // 2. Init Appwrite client
    const client = new Client()
      .setEndpoint("https://cloud.appwrite.io/v1")
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const db = new Databases(client);

    // 3. Load FAQs (simple approach)
    const faqResponse = await db.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_FAQ_COLLECTION_ID,
      []
    );

    let replyText =
      "Sorry, I don’t have an answer yet. Please contact the admin.";
    let foundInFaq = false;

    for (const faq of faqResponse.documents) {
      const questionText = (faq.question || "").toLowerCase();
      const keywords = (faq.keywords || "").toLowerCase();

      if (
        questionText.includes(userText) ||
        keywords.includes(userText) ||
        userText.includes(questionText)
      ) {
        replyText = faq.answer;
        foundInFaq = true;
        break;
      }
    }

    // 4. Log interaction ALWAYS
    await db.createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_INTERACTIONS_COLLECTION_ID,
      ID.unique(),
      {
        user_number: from,
        user_message: userText,
        bot_reply: replyText,
        found_in_faq: foundInFaq,
        created_at: new Date().toISOString()
      }
    );

    log("Interaction saved to DB");

    // 5. Send WhatsApp reply ONLY if credentials exist
    if (
      process.env.WHATSAPP_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID
    ) {
      log("Sending WhatsApp reply");

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
    } else {
      log("WhatsApp credentials missing — message not sent");
    }

    return res.json({
      status: "success",
      reply: replyText,
      foundInFaq
    });
  } catch (err) {
    error("FUNCTION ERROR: " + err.message);
    return res.json(
      { status: "error", message: err.message },
      500
    );
  }
};
