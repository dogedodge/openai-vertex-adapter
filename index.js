require("dotenv").config();
const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const app = express();
const PORT = process.env.SERVER_PORT || 3000;
const { log } = require("./logger");

app.use(express.json({ limit: "10mb" }));

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION,
});

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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const response = await ai.models.generateContentStream({
      model: model,
      contents: contents,
    });

    let fullText = "";
    let first = true;
    let usageMetadata;

    for await (const chunk of response) {
      if (chunk.usageMetadata) {
        usageMetadata = chunk.usageMetadata;
      }

      const chunkText = chunk.text;
      if (chunkText) {
        fullText += chunkText;
        const delta = first
          ? { role: "assistant", content: chunkText }
          : { content: chunkText };
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
    }

    // Send final chunk with finish_reason and usage
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    if (usageMetadata) {
      promptTokens = usageMetadata.promptTokenCount;
      completionTokens = usageMetadata.candidatesTokenCount;
      totalTokens = usageMetadata.totalTokenCount;
    } else {
      // Fallback to estimation if usageMetadata is not available
      const promptCharLength = messages.reduce((acc, msg) => {
        if (typeof msg.content === "string") {
          return acc + msg.content.length;
        }
        if (Array.isArray(msg.content)) {
          return (
            acc +
            msg.content.reduce(
              (sum, part) => sum + (part.text ? part.text.length : 0),
              0
            )
          );
        }
        return acc;
      }, 0);
      promptTokens = Math.ceil(promptCharLength / 4);
      completionTokens = Math.ceil(fullText.length / 4);
      totalTokens = promptTokens + completionTokens;
    }

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
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    };
    res.write("data: " + JSON.stringify(finalData) + "\n\n");
    log({
      type: "response",
      fullText,
      usage: finalData.usage,
    });
    console.log("Usage:", finalData.usage);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error(error);
    log({
      type: "error",
      error: error.message || "An unknown error occurred.",
    });
    if (res.headersSent) {
      const errorData = {
        error: {
          message: error.message || "An error occurred during streaming.",
          type: "internal_error",
        },
      };
      res.write("data: " + JSON.stringify(errorData) + "\n\n");
      res.write("data: [DONE]\n\n");
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
