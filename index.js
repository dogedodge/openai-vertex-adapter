require("dotenv").config();
const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const app = express();
const PORT = process.env.SERVER_PORT || 3000;
const { log } = require("./logger");

app.use(express.json({ limit: "50mb" }));

const ai = new GoogleGenAI({
  // apiKey: process.env.GOOGLE_API_KEY,
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION,
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: { message: "Unauthorized", type: "authentication_error" },
    });
  }
  // OpenAI-style API key accepted, but we use GOOGLE_API_KEY internally
  next();
};

app.use("/v1", authMiddleware);

app.get("/v1/models", (req, res) => {
  const models = [
    { id: "gemini-3-pro-preview", object: "model" },
    { id: "gemini-2.5-pro", object: "model" },
    { id: "gemini-2.5-flash", object: "model" },
    { id: "gemini-1.5-pro", object: "model" },
  ];
  res.json({ object: "list", data: models });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { model, messages } = req.body;
    // console.log(JSON.stringify(req.body, null, 2));
    log({ type: "request", body: req.body });

    if (
      !model ||
      !messages ||
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return res.status(400).json({
        error: {
          message: "Invalid request: model and messages required",
          type: "invalid_request_error",
        },
      });
    }

    // Helper function to convert OpenAI content to Google GenAI parts
    const contentToParts = (content) => {
      if (typeof content === "string") {
        return [{ text: content }];
      } else if (Array.isArray(content)) {
        return content.map((item) => ({ text: item.text }));
      } else {
        // Fallback for unexpected types
        return [{ text: String(content) }];
      }
    };

    // Map OpenAI-style messages to Google GenAI contents
    const contents = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: contentToParts(msg.content),
    }));

    log({ type: "transformed-request", contents });

    // Streaming response
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const response = await ai.models.generateContentStream({
      model: model,
      contents: contents,
    });

    let fullText = "";
    let first = true;

    for await (const chunk of response) {
      fullText += chunk.text;
      const delta = first
        ? { role: "assistant", content: chunk.text }
        : { content: chunk.text };
      first = false;

      const data = {
        id: "chatcmpl-" + Date.now(),
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta,
            finish_reason: null,
          },
        ],
      };
      res.write("data: " + JSON.stringify(data) + "\n\n");
    }

    // Send final chunk with finish_reason and usage
    const finalData = {
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: messages.length * 10,
        completion_tokens: Math.ceil(fullText.length / 4),
        total_tokens: messages.length * 10 + Math.ceil(fullText.length / 4),
      },
    };
    res.write("data: " + JSON.stringify(finalData) + "\n\n");
    log({
      type: "response",
      fullText,
      usage: finalData.usage,
    });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error(error);
    log({
      type: "error",
      error: error.message || "An unknown error occurred.",
    });
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({
        error: { message: "Internal server error", type: "internal_error" },
      });
    }
  }
});

app.get("/", (req, res) => {
  res.send("OpenAI-compatible API Adapter for Vertex AI");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
