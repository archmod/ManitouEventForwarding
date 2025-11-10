import express from "express";
import axios from "axios";
import { Request, Response } from "express";

const app = express();
const PORT = 8084;

app.use(express.json());

interface ForwardEventRequest {
  url: string;
  useBody?: any | null;
  useHeaders?: Record<string, string>;
  useRequest?: "POST" | "PUT" | "GET";
  useId?: string | null;
  useReturnAddress?: string | null;
}

app.post("/forwardEvent", async (req: Request<{}, {}, ForwardEventRequest>, res: Response) => {
  const {
    url,
    useBody = undefined,
    useHeaders = {},
    useRequest = "POST",
    useId = null,
    useReturnAddress = null,
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: 'url'" });
  }

  console.log(">> Forwarding to URL:", url);
  console.log(">> Forwarding body:", JSON.stringify(useBody, null, 2));
  console.log(">> Forwarding headers:", JSON.stringify(useHeaders, null, 2));
  console.log(">> useId:", useId);
  console.log(">> useReturnAddress:", useReturnAddress);

  try {
    let response;
    let callbackStatus: { posted?: boolean; status?: number; data?: any; error?: any } | undefined;

    switch (useRequest) {
      case "PUT": {
        response = await axios.put(url, useBody ?? undefined, { headers: useHeaders });
        break;
      }
      case "GET": {
        // 1) Get data
        console.log(">> Performing GET request to:", url);
        response = await axios.get(url, { headers: useHeaders });

        // 2) Post the data back to useReturnAddress with useId included
        if (!useReturnAddress) {
          console.log("useReturnAddress is null");
          break;
        }

        // Build payload that includes the useId
        const callbackPayload = {
          useId, // <- required in the callback
          data: response.data, // the data you fetched
        };

        try {
          const cbResp = await axios.post(useReturnAddress, callbackPayload, {
            // ensure JSON; merge any caller headers (caller may rely on auth)
            headers: { "content-type": "application/json", ...useHeaders },
          });
          callbackStatus = { posted: true, status: cbResp.status, data: cbResp.data };
          console.log("✅ Callback POST sent:", cbResp.status);
        } catch (cbErr: any) {
          callbackStatus = {
            posted: false,
            error: cbErr.response?.data || cbErr.message,
          };
          console.error("❌ Callback POST failed:", cbErr.response?.data || cbErr.message);
        }
        break;
      }
      default: {
        response = await axios.post(url, useBody ?? undefined, { headers: useHeaders });
      }
    }

    res.status(200).json({
      message: "Request forwarded successfully",
      useId,
      response: response?.data,
      callback: callbackStatus, // present only for GET case
    });
    console.log("✅ Forwarding succeeded:", response?.data);
  } catch (error: any) {
    res.status(500).json({
      error: "Failed to forward request",
      useId,
      details: error.response?.data || error.message,
    });
    console.error("❌ Forwarding failed:", error.response?.data || error.message);
  }
});

app.get("/", (_req, res) => {
  res.send("Hello from TypeScript backend!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
