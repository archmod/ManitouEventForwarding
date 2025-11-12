import express from "express";
import axios from "axios";
import { Request, Response } from "express";

const app = express();
const PORT = 8084;

// ⚠️ Disable TLS certificate verification globally (expired/self-signed OK)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

app.use(express.json());

interface ForwardEventRequest {
  url: string;
  useBody?: any | null;
  useHeaders?: Record<string, string>;
  useRequest?: "POST" | "PUT" | "GET";
  useId?: string | null; // Typically manitou account number
  useReturnAddress?: string | null; // For sending the response body on as a POST
}

app.post(
  "/forwardEvent",
  async (req: Request<{}, {}, ForwardEventRequest>, res: Response) => {
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
    console.log(">> Forwarding method:", useRequest);
    console.log(">> Forwarding body:", JSON.stringify(useBody, null, 2));
    console.log(">> Forwarding headers:", JSON.stringify(useHeaders, null, 2));
    console.log(">> useId:", useId);
    console.log(">> useReturnAddress:", useReturnAddress);

    try {
      let response:
        | {
            status: number;
            data: any;
          }
        | undefined;

      let callbackStatus:
        | { posted?: boolean; status?: number; data?: any; error?: any }
        | undefined;

      // 1) Forward the incoming request to the target URL
      switch (useRequest) {
        case "PUT": {
          response = await axios.put(url, useBody ?? undefined, {
            headers: useHeaders,
          });
          break;
        }
        case "GET": {
          response = await axios.get(url, {
            headers: useHeaders,
          });
          break;
        }
        default: {
          // POST by default
          response = await axios.post(url, useBody ?? undefined, {
            headers: useHeaders,
          });
        }
      }

      console.log("✅ Forwarding succeeded with status:", response?.status);
      console.log(
        ">> Upstream response body:",
        JSON.stringify(response?.data, null, 2)
      );

      // 2) If we have a return address, POST the wrapped response body there
      if (useReturnAddress && response) {
        const originalData = response.data;

        // 👇 REQUIRED STRUCTURE:
        // {
        //   signal: {
        //     useId: <useId>,
        //     returnBody: <originalData>
        //   }
        // }
        const callbackPayload = {
          signal: {
            useId,
            returnBody: originalData,
          },
        };

        // 🔥 Log what we are posting back
        console.log(
          "\n================ CALLBACK POST DEBUG ================"
        );
        console.log(">> Posting callback to returnAddress:", useReturnAddress);
        console.log(
          ">> Callback payload:\n",
          JSON.stringify(callbackPayload, null, 2)
        );
        console.log(
          "=====================================================\n"
        );

        try {
          const cbResp = await axios.post(useReturnAddress, callbackPayload, {
            headers: {
              "content-type": "application/json",
              ...useHeaders,
            },
          });

          // 🔥 Log response from returnAddress
          console.log(">> Callback response status:", cbResp.status);
          console.log(
            ">> Callback response body:",
            JSON.stringify(cbResp.data, null, 2)
          );

          callbackStatus = {
            posted: true,
            status: cbResp.status,
            data: cbResp.data,
          };
        } catch (cbErr: any) {
          console.error("❌ Callback POST failed:", cbErr.message);
          console.error(
            "❌ Callback error response body:",
            cbErr.response?.data
          );

          callbackStatus = {
            posted: false,
            error: cbErr.response?.data || cbErr.message,
          };
        }
      } else {
        console.log(
          ">> No useReturnAddress provided or no upstream response. Skipping callback POST."
        );
      }

      // 3) Respond to the original caller
      res.status(200).json({
        message: "Request forwarded successfully",
        useId,
        response: response?.data,
        callback: callbackStatus, // info about callback POST (if any)
      });
    } catch (error: any) {
      console.error(
        "❌ Forwarding failed:",
        error.response?.data || error.message
      );

      res.status(500).json({
        error: "Failed to forward request",
        useId,
        details: error.response?.data || error.message,
      });
    }
  }
);

app.get("/", (_req, res) => {
  res.send("Hello from TypeScript backend!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
