export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const importToken = process.env.FR_IMPORT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

  const auth = req.headers.authorization || "";
  const queryToken = req.query?.token || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : queryToken;

  if (!importToken || token !== importToken) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  if (!supabaseUrl || !supabaseSecret) {
    return res.status(500).json({
      ok: false,
      error: "Supabase config missing"
    });
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: supabaseSecret,
    Authorization: `Bearer ${supabaseSecret}`
  };

  if (req.method === "POST") {
    try {
      const invoice = req.body;

      if (!invoice || !invoice.customer_name) {
        return res.status(400).json({
          ok: false,
          error: "customer_name fehlt"
        });
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/fr_imports`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            invoice
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          ok: false,
          error: data
        });
      }

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

  if (req.method === "GET") {
    try {
      const mode = req.query?.mode || "";

      if (mode === "clear") {
        const clear = await fetch(
          `${supabaseUrl}/rest/v1/fr_imports?id=gt.0`,
          {
            method: "DELETE",
            headers: {
              ...headers,
              Prefer: "return=minimal"
            }
          }
        );

        if (!clear.ok) {
          const err = await clear.text();

          return res.status(clear.status).json({
            ok: false,
            error: err
          });
        }

        return res.status(200).json({
          ok: true,
          cleared: true
        });
      }

      if (mode !== "pull") {
        return res.status(400).json({
          ok: false,
          error: "mode=pull or mode=clear required"
        });
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/fr_imports?select=id,created_at,invoice&order=created_at.asc`,
        {
          method: "GET",
          headers
        }
      );

      const rows = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          ok: false,
          error: rows
        });
      }

      // Posle uspešnog čitanja brišemo import red
      // da se stari računi više ne vraćaju.
      if (Array.isArray(rows) && rows.length) {
        const ids = rows
          .map(row => row.id)
          .filter(id => id !== undefined && id !== null);

        if (ids.length) {
          const idList = `(${ids.join(",")})`;

          const del = await fetch(
            `${supabaseUrl}/rest/v1/fr_imports?id=in.${encodeURIComponent(idList)}`,
            {
              method: "DELETE",
              headers: {
                ...headers,
                Prefer: "return=minimal"
              }
            }
          );

          if (!del.ok) {
            const err = await del.text();

            return res.status(500).json({
              ok: false,
              error: "Queue delete failed: " + err
            });
          }
        }
      }

      return res.status(200).json({
        ok: true,
        invoices: (rows || []).map(row => ({
          ...row.invoice,
          created_at: row.created_at
        }))
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
