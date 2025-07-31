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

  // 👇 Update: destructure new keys from request body
  const { useBody, useHeaders, url } = req.body;

  // ✅ Validate payload
  if (!url || !useBody || !useHeaders) {
    console.error("❌ Missing required fields: 'url', 'useBody', or 'useHeaders'");
    return res.status(400).json({
      error: "Missing required fields: 'url', 'useBody', or 'useHeaders'",
    });
  }

  // ✅ Log forwarded components
  console.log(">> Forwarding to URL:", url);
  console.log(">> Forwarding body:", JSON.stringify(useBody, null, 2));
  console.log(">> Forwarding headers:", JSON.stringify(useHeaders, null, 2));

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
});

app.get("/", (_req, res) => {
  res.send("Hello from TypeScript backend!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
