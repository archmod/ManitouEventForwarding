import express from "express";
import axios from "axios";
import { Request, Response } from "express";

const app = express();
const PORT = 8084;

// ⚠️ Disable TLS certificate verification globally (expired/self-signed OK)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

app.use(express.json());

interface UseTimeDetails {
  time: string; // Time from Manitou
  offset: number; // Integer seconds (can be + or -)
  duration: number; // Integer in seconds
  format?: number; // Optional: 1 = ISO 8601
}

interface ForwardEventRequest {
  url: string;
  useBody?: any | null;
  useHeaders?: Record<string, string>;
  useRequest?: "POST" | "PUT" | "GET" | "PATCH";
  useId?: string | null; // Typically manitou account number
  useReturnAddress?: string | null; // For sending the response body on as a POST
  useTimeDetails?: UseTimeDetails | null; // For time-based URL parameter injection
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

    let callbackStatus: { posted?: boolean; status?: number; data?: any; error?: any } | undefined;

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
      case "PATCH": {
        response = await axios.patch(url, useBody ?? undefined, {
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
    console.log(">> Upstream response body:", JSON.stringify(response?.data, null, 2));

    // 2) If we have a return address, POST the wrapped response body there
    if (useReturnAddress && response) {
      const originalData = response.data;

      // Resolve actual callback URL
      let callbackUrl: string | null = useReturnAddress;

      if (useReturnAddress === "PERMACONN") {
        const firstChar = useId?.charAt(0);
        console.log(">> PERMACONN mode enabled. useId first character:", firstChar);

        if (firstChar === "W") {
          callbackUrl = "https://10.0.0.79:22635";
        } else if (firstChar !== "W") {
          callbackUrl = "https://10.0.0.79:22636";
        } else {
          console.error("❌ PERMACONN mode: Unknown useId prefix. Expected 'W' or 'F', got:", firstChar);
          callbackStatus = {
            posted: false,
            error: `PERMACONN mode: Unknown useId prefix '${firstChar}'. Expected 'W' or 'F'.`,
          };
          callbackUrl = null;
        }
      }

      if (callbackUrl) {
        // REQUIRED STRUCTURE:
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
        console.log("\n================ CALLBACK POST DEBUG ================");
        console.log(">> Resolved callback URL:", callbackUrl);
        console.log(">> Callback payload:\n", JSON.stringify(callbackPayload, null, 2));
        console.log("=====================================================\n");

        try {
          const cbResp = await axios.post(callbackUrl, callbackPayload, {
            headers: {
              "content-type": "application/json",
              ...useHeaders,
            },
          });

          // 🔥 Log response from returnAddress
          console.log(">> Callback response status:", cbResp.status);
          console.log(">> Callback response body:", JSON.stringify(cbResp.data, null, 2));

          callbackStatus = {
            posted: true,
            status: cbResp.status,
            data: cbResp.data,
          };
        } catch (cbErr: any) {
          console.error("❌ Callback POST failed:", cbErr.message);
          console.error("❌ Callback error response body:", cbErr.response?.data);

          callbackStatus = {
            posted: false,
            error: cbErr.response?.data || cbErr.message,
          };
        }
      } else {
        console.log(">> Callback URL not resolved (likely PERMACONN prefix issue). Skipping callback POST.");
      }
    } else {
      console.log(">> No useReturnAddress provided or no upstream response. Skipping callback POST.");
    }

    // 3) Respond to the original caller
    res.status(200).json({
      message: "Request forwarded successfully",
      useId,
      response: response?.data,
      callback: callbackStatus, // info about callback POST (if any)
    });
  } catch (error: any) {
    console.error("❌ Forwarding failed:", error.response?.data || error.message);

    res.status(500).json({
      error: "Failed to forward request",
      useId,
      details: error.response?.data || error.message,
    });
  }
});

/**
 * /forwardEventTime - Forward requests with time-based URL parameter injection
 *
 * This route extends the functionality of /forwardEvent by adding support for dynamic
 * timestamp calculation and URL parameter substitution, specifically designed for
 * retrieving camera footage from time-based APIs.
 *
 * KEY DIFFERENCES FROM /forwardEvent:
 * - Supports `useTimeDetails` parameter for automatic timestamp calculation
 * - Automatically replaces {a} and {b} placeholders in URLs with calculated timestamps
 * - Calculates start/end times based on base time + offset + duration
 *
 * HOW IT WORKS:
 * 1. Receives a URL with placeholders: "...?startTimestamp={a}&endTimestamp={b}"
 * 2. Uses `useTimeDetails` to calculate timestamps:
 *    - startTime = time + offset (in seconds)
 *    - endTime = startTime + duration (in seconds)
 * 3. Replaces {a} with startTime and {b} with endTime
 * 4. Makes the request to the final URL
 * 5. Optionally forwards response to useReturnAddress (same as /forwardEvent)
 *
 * EXAMPLE useTimeDetails:
 * {
 *   "time": "2026-02-12T10:30:00Z",  // Base event time from Manitou
 *   "offset": -60,                    // Start 60 seconds before event
 *   "duration": 300,                  // Retrieve 5 minutes of footage
 *   "format": 1                       // 1 = ISO 8601, otherwise Unix timestamp (ms)
 * }
 *
 * All other functionality (useReturnAddress, PERMACONN, headers, etc.) works identically to /forwardEvent.
 */
app.post("/forwardEventTime", async (req: Request<{}, {}, ForwardEventRequest>, res: Response) => {
  const {
    url,
    useBody = undefined,
    useHeaders = {},
    useRequest = "POST",
    useId = null,
    useReturnAddress = null,
    useTimeDetails = null,
  } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing required field: 'url'" });
  }

  // Process time details and inject into URL if provided
  let finalUrl = url;
  if (useTimeDetails) {
    console.log(">> useTimeDetails:", JSON.stringify(useTimeDetails, null, 2));

    const { time, offset, duration, format = 1 } = useTimeDetails;

    // Parse the time from Manitou
    const baseTime = new Date(time);
    if (isNaN(baseTime.getTime())) {
      return res.status(400).json({ error: "Invalid time format in useTimeDetails.time" });
    }

    // Calculate start and end timestamps
    const startTime = new Date(baseTime.getTime() + offset * 1000);
    const endTime = new Date(startTime.getTime() + duration * 1000);

    // Format timestamps based on format type
    let startTimestamp: string;
    let endTimestamp: string;

    if (format === 1) {
      // ISO 8601 format
      startTimestamp = startTime.toISOString();
      endTimestamp = endTime.toISOString();
    } else {
      // Default to Unix timestamp (milliseconds)
      startTimestamp = startTime.getTime().toString();
      endTimestamp = endTime.getTime().toString();
    }

    console.log(">> Calculated startTimestamp:", startTimestamp);
    console.log(">> Calculated endTimestamp:", endTimestamp);

    // Replace {a} and {b} in the URL
    finalUrl = url.replace("{a}", encodeURIComponent(startTimestamp)).replace("{b}", encodeURIComponent(endTimestamp));
    console.log(">> Final URL after substitution:", finalUrl);
  }

  console.log(">> Forwarding to URL:", finalUrl);
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

    let callbackStatus: { posted?: boolean; status?: number; data?: any; error?: any } | undefined;

    // 1) Forward the incoming request to the target URL
    switch (useRequest) {
      case "PUT": {
        response = await axios.put(finalUrl, useBody ?? undefined, {
          headers: useHeaders,
        });
        break;
      }
      case "GET": {
        response = await axios.get(finalUrl, {
          headers: useHeaders,
        });
        break;
      }
      case "PATCH": {
        response = await axios.patch(finalUrl, useBody ?? undefined, {
          headers: useHeaders,
        });
        break;
      }
      default: {
        // POST by default
        response = await axios.post(finalUrl, useBody ?? undefined, {
          headers: useHeaders,
        });
      }
    }

    console.log("✅ Forwarding succeeded with status:", response?.status);
    console.log(">> Upstream response body:", JSON.stringify(response?.data, null, 2));

    // 2) If we have a return address, POST the wrapped response body there
    if (useReturnAddress && response) {
      const originalData = response.data;

      // Resolve actual callback URL
      let callbackUrl: string | null = useReturnAddress;

      if (useReturnAddress === "PERMACONN") {
        const firstChar = useId?.charAt(0);
        console.log(">> PERMACONN mode enabled. useId first character:", firstChar);

        if (firstChar === "W") {
          callbackUrl = "https://10.0.0.79:22635";
        } else if (firstChar !== "W") {
          callbackUrl = "https://10.0.0.79:22636";
        } else {
          console.error("❌ PERMACONN mode: Unknown useId prefix. Expected 'W' or 'F', got:", firstChar);
          callbackStatus = {
            posted: false,
            error: `PERMACONN mode: Unknown useId prefix '${firstChar}'. Expected 'W' or 'F'.`,
          };
          callbackUrl = null;
        }
      }

      if (callbackUrl) {
        // REQUIRED STRUCTURE:
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
        console.log("\n================ CALLBACK POST DEBUG ================");
        console.log(">> Resolved callback URL:", callbackUrl);
        console.log(">> Callback payload:\n", JSON.stringify(callbackPayload, null, 2));
        console.log("=====================================================\n");

        try {
          const cbResp = await axios.post(callbackUrl, callbackPayload, {
            headers: {
              "content-type": "application/json",
              ...useHeaders,
            },
          });

          // 🔥 Log response from returnAddress
          console.log(">> Callback response status:", cbResp.status);
          console.log(">> Callback response body:", JSON.stringify(cbResp.data, null, 2));

          callbackStatus = {
            posted: true,
            status: cbResp.status,
            data: cbResp.data,
          };
        } catch (cbErr: any) {
          console.error("❌ Callback POST failed:", cbErr.message);
          console.error("❌ Callback error response body:", cbErr.response?.data);

          callbackStatus = {
            posted: false,
            error: cbErr.response?.data || cbErr.message,
          };
        }
      } else {
        console.log(">> Callback URL not resolved (likely PERMACONN prefix issue). Skipping callback POST.");
      }
    } else {
      console.log(">> No useReturnAddress provided or no upstream response. Skipping callback POST.");
    }

    // 3) Respond to the original caller
    res.status(200).json({
      message: "Request forwarded successfully",
      useId,
      response: response?.data,
      callback: callbackStatus, // info about callback POST (if any)
    });
  } catch (error: any) {
    console.error("❌ Forwarding failed:", error.response?.data || error.message);

    res.status(500).json({
      error: "Failed to forward request",
      useId,
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
