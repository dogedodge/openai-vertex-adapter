require("dotenv").config();
const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

if (!process.env.GOOGLE_API_KEY) {
  console.error("GOOGLE_API_KEY environment variable is required");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

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
    { id: "gemini-1.5-pro", object: "model" },
    { id: "gemini-1.5-flash", object: "model" },
    { id: "gemini-pro", object: "model" },
  ];
  res.json({ object: "list", data: models });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { model, messages, max_tokens, temperature, ...other } = req.body;

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

    const vertexModelName = model; // assume model names match, e.g. gemini-1.5-pro

    const generativeModel = genAI.getGenerativeModel({
      model: vertexModelName,
    });

    const chat = generativeModel.startChat({ history: [] });

    // Add history
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      if (msg.role === "user") {
        chat.history.push({ role: "user", parts: [{ text: msg.content }] });
      } else if (msg.role === "assistant") {
        chat.history.push({ role: "model", parts: [{ text: msg.content }] });
      }
    }

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;
    const text = response.text();

    res.json({
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: messages.length * 10,
        completion_tokens: text.length / 4,
        total_tokens: messages.length * 10 + text.length / 4,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: { message: "Internal server error", type: "internal_error" },
    });
  }
});

app.get("/", (req, res) => {
  res.send("OpenAI-compatible API Adapter for Vertex AI");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
