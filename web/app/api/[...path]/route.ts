import type { NextRequest } from "next/server";

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const target = `${process.env.GRAPH_API_URL || "http://127.0.0.1:8000"}/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("origin")
          ? { Origin: request.headers.get("origin")! }
          : {}),
      },
      body: request.method === "GET" ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
      cache: "no-store",
      redirect: "error",
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["content-type", "content-disposition"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      {
        code: "offline",
        message: "Нет соединения с локальным сервисом.",
        retryable: true,
        request_id: crypto.randomUUID(),
      },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
