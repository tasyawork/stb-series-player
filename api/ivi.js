export default async function handler(request, response) {
  const incoming = new URL(request.url, "http://localhost");
  const path = incoming.searchParams.get("p") || "";
  incoming.searchParams.delete("p");
  const target = new URL(`https://api.ivi.ru/mobileapi/${path}`);
  incoming.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const upstream = await fetch(target, { headers: { Accept: "application/json" } });
  const body = await upstream.text();
  response.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  response.status(upstream.status).send(body);
}
