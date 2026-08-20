let invoices = [];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const secret = process.env.FR_IMPORT_TOKEN;
  const auth = req.headers.authorization || "";
  const queryToken = req.query?.token || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : queryToken;

  if (!secret || token !== secret) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  if (req.method === "GET") {
    if (req.query?.mode !== "pull") {
      return res.status(400).json({
        ok: false,
        error: "mode=pull required"
      });
    }

    return res.status(200).json({
      ok: true,
      invoices
    });
  }

  if (req.method === "POST") {
    try {
      const invoice = req.body;

      if (!invoice || !invoice.customer_name) {
        return res.status(400).json({
          ok: false,
          error: "customer_name fehlt"
        });
      }

      invoice.created_at = new Date().toISOString();
      invoice.updated_at = invoice.created_at;

      invoices.unshift(invoice);

      return res.status(200).json({
        ok: true,
        message: "FR Rechnung gespeichert",
        invoice
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  return res.status(405).json({
    ok: false,
    error: "Method not allowed"
  });
}
