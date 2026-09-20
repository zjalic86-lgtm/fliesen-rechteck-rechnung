export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const importToken = String(process.env.FR_IMPORT_TOKEN || "").trim();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

  const auth = req.headers?.authorization;
  const queryToken = req.query?.token;
  const bearer = typeof auth === "string"
    ? /^Bearer[ \t]+(.+)$/i.exec(auth.trim())
    : null;

  const token = bearer
    ? bearer[1].trim()
    : (!auth && typeof queryToken === "string" ? queryToken.trim() : "");

  function authError(status, code, message) {
    console.warn(JSON.stringify({
      event: "fr_import_auth",
      code,
      method: req.method
    }));

    return res.status(status).json({
      ok: false,
      error: message,
      code
    });
  }

  if (!importToken) {
    return authError(
      503,
      "FR_IMPORT_NOT_CONFIGURED",
      "FR_IMPORT_TOKEN fehlt im aktiven Deployment. In Vercel speichern und neu deployen."
    );
  }

  if (auth && !bearer) {
    return authError(
      401,
      "FR_AUTH_FORMAT",
      "Authorization muss Bearer verwenden. Im GPT API-Schluessel und Bearer auswaehlen."
    );
  }

  if (!token) {
    return authError(
      401,
      "FR_TOKEN_MISSING",
      "Kein Import-Schluessel gesendet. Schluessel in GPT oder FR-App speichern."
    );
  }

  if (token !== importToken) {
    return authError(
      401,
      "FR_TOKEN_MISMATCH",
      "Import-Schluessel stimmt nicht mit dem aktiven Vercel-Deployment ueberein."
    );
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
      const document = req.body;

      if (!document || !document.customer_name) {
        return res.status(400).json({
          ok: false,
          error: "customer_name fehlt"
        });
      }

      const documentType =
        document.document_type === "Angebot"
          ? "Angebot"
          : "Rechnung";

      const savedDocument = {
        ...document,
        document_type: documentType
      };

      const response = await fetch(
        `${supabaseUrl}/rest/v1/fr_imports`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            invoice: savedDocument
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
        message:
          documentType === "Angebot"
            ? "FR Angebot gespeichert"
            : "FR Rechnung gespeichert",
        document_type: documentType,
        invoice: savedDocument
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
          document_type:
            row.invoice?.document_type || "Rechnung",
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
