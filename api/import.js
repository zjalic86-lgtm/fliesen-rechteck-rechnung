export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "POST required"
    });
  }

  const secret = process.env.FR_IMPORT_SECRET;

  if (secret) {
    const auth = req.headers.authorization || "";

    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }
  }

  try {
    const invoice = req.body;

    if (!invoice || !invoice.customer_name) {
      return res.status(400).json({
        ok: false,
        error: "customer_name fehlt"
      });
    }

    return res.status(200).json({
      ok: true,
      message: "FR Rechnung empfangen",
      invoice
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
