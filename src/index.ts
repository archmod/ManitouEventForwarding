import express from "express";
import axios from "axios";
import { Request, Response } from "express";

const app = express();
const PORT = 8084;

app.use(express.json());

app.post("/forwardEvent", async (req: Request, res: Response) => {
  console.log("----- Incoming Request to /forwardEvent -----");
  console.log("Method:", req.method);
  console.log("Path:", req.originalUrl);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Query Params:", req.query);
  console.log("Body (parsed):", JSON.stringify(req.body, null, 2));

  // Extract with default fallbacks
  const url: string = req.body.url;
  const useBody: any = req.body.useBody || {};
  const useHeaders: Record<string, string> = req.body.useHeaders || {};
  const useRequest: string = req.body.useRequest || "POST";

  // Validate only that `url` is present
  if (!url) {
    console.error("❌ Missing required field: 'url'");
    return res.status(400).json({
      error: "Missing required field: 'url'",
    });
  }

  console.log(">> Forwarding to URL:", url);
  console.log(">> Forwarding body:", JSON.stringify(useBody, null, 2));
  console.log(">> Forwarding headers:", JSON.stringify(useHeaders, null, 2));

  // we are using a post request
  if (useRequest === "POST") {
    try {
      const response = await axios.post(url, useBody, {
        headers: useHeaders,
      });

      console.log("✅ Request successfully forwarded");
      res.status(200).json({
        message: "Request forwarded successfully",
        response: response.data,
      });
    } catch (error: any) {
      console.error("❌ Error forwarding request:", error.response?.data || error.message);
      res.status(500).json({
        error: "Failed to forward request",
        details: error.response?.data || error.message,
      });
    }
  }
  // We are using a put request
  if (useRequest === "PUT") {
    try {
      const response = await axios.post(url, useBody, {
        headers: useHeaders,
      });

      console.log("✅ PUTRequest successfully forwarded");
      res.status(200).json({
        message: "Request forwarded successfully",
        response: response.data,
      });
    } catch (error: any) {
      console.error("❌ Error forwarding request:", error.response?.data || error.message);
      res.status(500).json({
        error: "Failed to forward request",
        details: error.response?.data || error.message,
      });
    }
  }
});

app.get("/", (_req, res) => {
  res.send("Hello from TypeScript backend!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
