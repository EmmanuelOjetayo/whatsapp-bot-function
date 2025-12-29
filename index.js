import { Client, Databases, ID } from "appwrite";

export default async ({ req, res, log, error }) => {
  // 1. WhatsApp Webhook Verification (GET Request)
  // Meta sends a GET request to verify your endpoint.
  if (req.method === "GET") {
    const query = req.query;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    // You should set WHATSAPP_VERIFY_TOKEN in your Appwrite Function Variables
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      log("Webhook Verified!");
      return res.text(challenge);
    } else {
      return res.text("Verification failed", 403);
    }
  }

  // 2. Handle Incoming Messages (POST Request)
  log("FUNCTION HIT: Processing Webhook Payload");

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    // Safety check for the specific WhatsApp payload structure
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      log("No WhatsApp message found in payload. Check structure.");
      return res.json({ status: "ignored", message: "No message data" });
    }

    const from = message.from;
    const userText = (message.text?.body || "").toLowerCase().trim();

    log(`Incoming message from ${from}: ${userText}`);

    // 3. Init Appwrite client
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

    let replyText = "Sorry, I don’t have an answer yet. Please contact the admin.";
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

    // 5. Log interaction to DB
    try {
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
      log("Interaction saved to DB");
    } catch (dbErr) {
      error("Database logging failed: " + dbErr.message);
      // We don't stop execution here so the message can still be sent
    }

    // 6. Send WhatsApp reply ONLY if credentials exist
    if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      log("Sending WhatsApp reply via Meta API...");

      const waResponse = await fetch(
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

      const waData = await waResponse.json();
      if (!waResponse.ok) {
        error("Meta API Error: " + JSON.stringify(waData));
      } else {
        log("WhatsApp message sent successfully");
      }
    } else {
      log("WhatsApp credentials missing — skipping Meta API call");
    }

    return res.json({
      status: "success",
      reply: replyText,
      sentToWhatsApp: !!(process.env.WHATSAPP_TOKEN)
    });

  } catch (err) {
    error("FUNCTION ERROR: " + err.message);
    return res.json(
      { status: "error", message: "Internal server error" },
      500
    );
  }
};
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
