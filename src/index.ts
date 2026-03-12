import axios from "axios";
import express, { Request, Response } from "express";

const app = express();
const PORT = 8084;

// ⚠️ Disable TLS certificate verification globally (expired/self-signed OK)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

app.use(express.json());

type HttpMethod = "POST" | "PUT" | "GET" | "PATCH";

interface UseTimeDetails {
  time: string; // Time from Manitou
  offset: number; // Integer seconds (can be + or -)
  duration: number; // Integer in seconds
  format?: number; // Optional: 1 = ISO 8601
}

interface ForwardEventRequest {
  url: string;
  useBody?: unknown | null;
  useHeaders?: Record<string, string>;
  useRequest?: HttpMethod;
  useId?: string | null; // Typically manitou account number
  useReturnAddress?: string | null; // For sending the response body on as a POST
  useTimeDetails?: UseTimeDetails | null; // For time-based URL parameter injection
}

interface CallbackStatus {
  posted: boolean;
  status?: number;
  data?: unknown;
  error?: unknown;
}

interface ForwardResult {
  responseData: unknown;
  callbackStatus?: CallbackStatus;
}

interface AxiosLikeError {
  message?: string;
  response?: {
    data?: unknown;
  };
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return typeof error === "object" && error !== null && ("message" in error || "response" in error);
}

function logForwardingInput(params: {
  url: string;
  method: HttpMethod;
  body: unknown;
  headers: Record<string, string>;
  useId: string | null;
  useReturnAddress: string | null;
}): void {
  const { url, method, body, headers, useId, useReturnAddress } = params;

  console.log(">> Forwarding to URL:", url);
  console.log(">> Forwarding method:", method);
  console.log(">> Forwarding body:", JSON.stringify(body, null, 2));
  console.log(">> Forwarding headers:", JSON.stringify(headers, null, 2));
  console.log(">> useId:", useId);
  console.log(">> useReturnAddress:", useReturnAddress);
}

function resolvePermaconnCallbackUrl(useId: string | null): string | null {
  const firstChar = useId?.charAt(0);
  console.log(">> PERMACONN mode enabled. useId first character:", firstChar);

  if (firstChar === "W") {
    return "https://10.0.0.79:22635";
  }

  if (firstChar === "F") {
    return "https://10.0.0.79:22636";
  }

  return null;
}

async function forwardRequest(
  url: string,
  method: HttpMethod,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  switch (method) {
    case "PUT":
      return axios.put(url, body ?? undefined, { headers });
    case "GET":
      return axios.get(url, { headers });
    case "PATCH":
      return axios.patch(url, body ?? undefined, { headers });
    default:
      return axios.post(url, body ?? undefined, { headers });
  }
}

async function postCallback(params: {
  useReturnAddress: string;
  useId: string | null;
  responseData: unknown;
  useHeaders: Record<string, string>;
}): Promise<CallbackStatus> {
  const { useReturnAddress, useId, responseData, useHeaders } = params;

  const callbackUrl = useReturnAddress === "PERMACONN" ? resolvePermaconnCallbackUrl(useId) : useReturnAddress;

  if (!callbackUrl) {
    console.error("❌ PERMACONN mode: Unknown useId prefix. Expected 'W' or 'F'.");
    return {
      posted: false,
      error: "PERMACONN mode: Unknown useId prefix. Expected 'W' or 'F'.",
    };
  }

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
      returnBody: responseData,
    },
  };

  console.log("\n================ CALLBACK POST DEBUG ================");
  console.log(">> Resolved callback URL:", callbackUrl);
  console.log(">> Callback payload:\n", JSON.stringify(callbackPayload, null, 2));
  console.log("=====================================================\n");

  try {
    const callbackResponse = await axios.post(callbackUrl, callbackPayload, {
      headers: {
        "content-type": "application/json",
        ...useHeaders,
      },
    });

    console.log(">> Callback response status:", callbackResponse.status);
    console.log(">> Callback response body:", JSON.stringify(callbackResponse.data, null, 2));

    return {
      posted: true,
      status: callbackResponse.status,
      data: callbackResponse.data,
    };
  } catch (error: unknown) {
    if (isAxiosLikeError(error)) {
      console.error("❌ Callback POST failed:", error.message);
      console.error("❌ Callback error response body:", error.response?.data);

      return {
        posted: false,
        error: error.response?.data || error.message,
      };
    }

    console.error("❌ Callback POST failed with unknown error");
    return {
      posted: false,
      error: "Unknown callback error",
    };
  }
}

async function handleForwarding(params: {
  url: string;
  useBody: unknown;
  useHeaders: Record<string, string>;
  useRequest: HttpMethod;
  useId: string | null;
  useReturnAddress: string | null;
}): Promise<ForwardResult> {
  const { url, useBody, useHeaders, useRequest, useId, useReturnAddress } = params;

  logForwardingInput({
    url,
    method: useRequest,
    body: useBody,
    headers: useHeaders,
    useId,
    useReturnAddress,
  });

  const response = await forwardRequest(url, useRequest, useBody, useHeaders);
  console.log("✅ Forwarding succeeded with status:", response.status);
  console.log(">> Upstream response body:", JSON.stringify(response.data, null, 2));

  if (!useReturnAddress) {
    console.log(">> No useReturnAddress provided. Skipping callback POST.");
    return { responseData: response.data };
  }

  const callbackStatus = await postCallback({
    useReturnAddress,
    useId,
    responseData: response.data,
    useHeaders,
  });

  return {
    responseData: response.data,
    callbackStatus,
  };
}

function buildTimedUrl(url: string, useTimeDetails: UseTimeDetails): string {
  const { time, offset, duration, format = 1 } = useTimeDetails;

  const baseTime = new Date(time);
  if (Number.isNaN(baseTime.getTime())) {
    throw new Error("Invalid time format in useTimeDetails.time");
  }

  const startTime = new Date(baseTime.getTime() + offset * 1000);
  const endTime = new Date(startTime.getTime() + duration * 1000);

  const startTimestamp = format === 1 ? startTime.toISOString() : startTime.getTime().toString();
  const endTimestamp = format === 1 ? endTime.toISOString() : endTime.getTime().toString();

  console.log(">> Calculated startTimestamp:", startTimestamp);
  console.log(">> Calculated endTimestamp:", endTimestamp);

  const finalUrl = url
    .replace("{a}", encodeURIComponent(startTimestamp))
    .replace("{b}", encodeURIComponent(endTimestamp));
  console.log(">> Final URL after substitution:", finalUrl);

  return finalUrl;
}

function getErrorDetails(error: unknown): unknown {
  if (isAxiosLikeError(error)) {
    return error.response?.data || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
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

  try {
    const { responseData, callbackStatus } = await handleForwarding({
      url,
      useBody,
      useHeaders,
      useRequest,
      useId,
      useReturnAddress,
    });

    return res.status(200).json({
      message: "Request forwarded successfully",
      useId,
      response: responseData,
      callback: callbackStatus,
    });
  } catch (error: unknown) {
    const details = getErrorDetails(error);
    console.error("❌ Forwarding failed:", details);

    return res.status(500).json({
      error: "Failed to forward request",
      useId,
      details,
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

  try {
    let finalUrl = url;
    if (useTimeDetails) {
      console.log(">> useTimeDetails:", JSON.stringify(useTimeDetails, null, 2));
      finalUrl = buildTimedUrl(url, useTimeDetails);
    }

    const { responseData, callbackStatus } = await handleForwarding({
      url: finalUrl,
      useBody,
      useHeaders,
      useRequest,
      useId,
      useReturnAddress,
    });

    return res.status(200).json({
      message: "Request forwarded successfully",
      useId,
      response: responseData,
      callback: callbackStatus,
    });
  } catch (error: unknown) {
    const details = getErrorDetails(error);
    console.error("❌ Forwarding failed:", details);

    const statusCode = details === "Invalid time format in useTimeDetails.time" ? 400 : 500;

    return res.status(statusCode).json({
      error: statusCode === 400 ? "Invalid time details" : "Failed to forward request",
      useId,
      details,
    });
  }
});

app.get("/", (_req, res) => {
  res.send("Hello from TypeScript backend!");
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
